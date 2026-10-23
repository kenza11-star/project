# Verifikasi shader pintu di GPU/WebGL2 sungguhan (Chromium headless via Playwright). Pakai: node scripts/gpu/extract-door.js && python3 scripts/gpu/door-gpu-verify.py [mediump]
# Menyusun kerangka shader MeshStandardMaterial three r164 (urutan chunk sama), menjalankan rantai replace ASLI dari materials.ts, mengompilasi, dan merender daun pintu asli dari GLB.
import json, re, base64, sys
from playwright.sync_api import sync_playwright
import os
ROOT=os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','..'))
OUT=os.path.join(ROOT,'.tmp-gpu'); os.makedirs(OUT,exist_ok=True)
data=json.load(open(OUT+'/data.json'))
src=open(ROOT+'/lib/game/materials.ts').read()
m=re.search(r"private doorWood\(m: Std\) \{.*?m\.onBeforeCompile = \(sh\) => \{(.*?)\n    \};\n    m\.customProgramCacheKey", src, re.S)
assert m, 'blok onBeforeCompile pintu tidak ditemukan'
chain=m.group(1)
wood=base64.b64encode(open(OUT+'/wood.png','rb').read()).decode()
MEDIUMP = len(sys.argv)>1 and sys.argv[1]=='mediump'
HTML = r"""<!doctype html><body style="margin:0;background:#000"><canvas id=c width=1200 height=760></canvas><script>
const D=%DATA%, CHAIN=%CHAIN%, WOOD='data:image/png;base64,%WOOD%', MEDIUMP=%MEDIUMP%;
const logs=[]; window.__logs=logs;
const gl=document.getElementById('c').getContext('webgl2',{antialias:false,preserveDrawingBuffer:true});
// ---- kerangka shader meniru urutan chunk MeshStandardMaterial three r164 (nama variabel & posisi include sama) ----
const VS=`#version 300 es
#define attribute in
#define varying out
uniform mat4 modelMatrix; uniform mat4 modelViewMatrix; uniform mat4 projectionMatrix; uniform mat3 normalMatrix;
attribute vec3 position; attribute vec3 normal; attribute vec2 uv;
#include <common>
varying vec2 vMapUv; varying vec3 vNormal; varying vec3 vViewPosition;
void main(){
  vMapUv = uv;
  #include <beginnormal_vertex>
  vNormal = normalize(normalMatrix * objectNormal);
  #include <begin_vertex>
  vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  vViewPosition = -mvPosition.xyz;
}`;
const FS=`#version 300 es
precision ${MEDIUMP?'mediump':'highp'} float; precision ${MEDIUMP?'mediump':'highp'} int;
#define varying in
#define texture2D texture
#define USE_MAP
layout(location=0) out highp vec4 pc_fragColor;
#include <common>
uniform vec3 diffuse; uniform float roughness; uniform float opacity;
#ifdef USE_MAP
uniform sampler2D map;
#endif
 uniform vec3 uLight; uniform float uOld;
varying vec2 vMapUv; varying vec3 vNormal; varying vec3 vViewPosition;
void main(){
  vec4 diffuseColor = vec4(diffuse, opacity);
  vec3 totalEmissiveRadiance = vec3(0.0);
  #include <map_fragment>
  #include <color_fragment>
  #include <roughnessmap_fragment>
  #include <normal_fragment_begin>
  #include <normal_fragment_maps>
  vec3 V = normalize(vViewPosition);
  float dist = length(vViewPosition);
  vec3 L = V;                               // senter di kamera
  float att = 1.0 / (1.0 + 0.55 * dist * dist);
  float nl = max(dot(normal, L), 0.0);
  vec3 H = normalize(L + V);
  float a = roughnessFactor * roughnessFactor, a2 = a * a;
  float nh = max(dot(normal, H), 0.0), dd = nh * nh * (a2 - 1.0) + 1.0;
  float spec = a2 / (3.14159 * dd * dd) * 0.04 * nl;      // GGX kasar (F0 0.04), tanpa kilap berlebih
  vec3 amb = vec3(1.0, 0.92, 0.65) * 0.16;                // lampu kuning Backrooms (ambien)
  vec3 col = diffuseColor.rgb * (amb + vec3(1.0, 0.97, 0.9) * nl * att * 1.6) + vec3(1.0, 0.97, 0.9) * spec * att * 1.6;
  col = col / (col + 0.65) * 1.55;                       // tone map sederhana
  pc_fragColor = vec4(pow(clamp(col, 0.0, 1.0), vec3(1.0/2.2)), 1.0);
}`;
const CH={
  common:'#define PI 3.141592653589793\n',
  beginnormal_vertex:'vec3 objectNormal = vec3( normal );\n',
  begin_vertex:'vec3 transformed = vec3( position );\n',
  map_fragment:'#ifdef USE_MAP\n\tvec4 sampledDiffuseColor = texture2D( map, vMapUv );\n\tdiffuseColor *= sampledDiffuseColor;\n#endif\n',
  color_fragment:'',
  roughnessmap_fragment:'float roughnessFactor = roughness;\n',
  normal_fragment_begin:'float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;\nvec3 normal = normalize( vNormal );\n',
  normal_fragment_maps:'',
};
const resolve=(s)=>s.replace(/^[ \t]*#include +<([\w\d./]+)>/gm,(m,n)=>{ if(!(n in CH)) throw new Error('chunk tak dikenal '+n); return CH[n]; });
function build(withDoor){
  let vs=VS, fs=FS;
  if(withDoor){
    const sh={uniforms:{},vertexShader:vs,fragmentShader:fs};
    const CFG={MATERIAL_BUMP:1.0}, G=D.glsl, tex=null;
    new Function('sh','G','tex','CFG',CHAIN)(sh,G,tex,CFG);
    vs=sh.vertexShader; fs=sh.fragmentShader; window.__u_dbump=sh.uniforms.u_dbump.value;
    // aturan three: 'attribute float aDoorW' diteruskan apa adanya
  }
  return [resolve(vs),resolve(fs)];
}
function prog(withDoor){
  const [vs,fs]=build(withDoor), mk=(t,s)=>{const sh=gl.createShader(t);gl.shaderSource(sh,s);gl.compileShader(sh);const ok=gl.getShaderParameter(sh,gl.COMPILE_STATUS);const log=gl.getShaderInfoLog(sh);logs.push({stage:t===gl.VERTEX_SHADER?'vertex':'fragment',withDoor,ok,log});return sh;};
  const p=gl.createProgram();gl.attachShader(p,mk(gl.VERTEX_SHADER,vs));gl.attachShader(p,mk(gl.FRAGMENT_SHADER,fs));gl.linkProgram(p);
  const ok=gl.getProgramParameter(p,gl.LINK_STATUS);logs.push({stage:'link',withDoor,ok,log:gl.getProgramInfoLog(p)});
  window['__src'+(withDoor?'New':'Old')]=[vs,fs];
  return ok?p:null;
}
// ---- matriks ----
const M={
  persp(f,a,n,r){const t=1/Math.tan(f/2);return [t/a,0,0,0, 0,t,0,0, 0,0,(r+n)/(n-r),-1, 0,0,2*r*n/(n-r),0];},
  mul(a,b){const o=new Array(16).fill(0);for(let i=0;i<4;i++)for(let j=0;j<4;j++)for(let k=0;k<4;k++)o[j*4+i]+=a[k*4+i]*b[j*4+k];return o;},
  trans(x,y,z){return [1,0,0,0, 0,1,0,0, 0,0,1,0, x,y,z,1];},
  rotY(a){const c=Math.cos(a),s=Math.sin(a);return [c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1];},
  look(e,t,u){const z=norm(sub(e,t)),x=norm(cross(u,z)),y=cross(z,x);return [x[0],y[0],z[0],0, x[1],y[1],z[1],0, x[2],y[2],z[2],0, -dot(x,e),-dot(y,e),-dot(z,e),1];},
};
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]],dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],norm=(a)=>{const l=Math.hypot(...a);return [a[0]/l,a[1]/l,a[2]/l];};
// ---- geometri pintu asli dari GLB ----
const vao=gl.createVertexArray(); gl.bindVertexArray(vao);
const buf=(arr,T,tgt)=>{const b=gl.createBuffer();gl.bindBuffer(tgt,b);gl.bufferData(tgt,new T(arr),gl.STATIC_DRAW);return b;};
const bPos=buf(D.geo.pos,Float32Array,gl.ARRAY_BUFFER), bNrm=buf(D.geo.nrm,Float32Array,gl.ARRAY_BUFFER), bUv=buf(D.geo.uv,Float32Array,gl.ARRAY_BUFFER);
const bIdx=buf(D.geo.idx,Uint16Array,gl.ELEMENT_ARRAY_BUFFER);
const maxZ=Math.max(...D.geo.pos.filter((_,i)=>i%3===2));
const bW=buf(new Array(D.geo.pos.length/3).fill(maxZ),Float32Array,gl.ARRAY_BUFFER); // = MaterialUpgrade.prepDoorGeometry
// ---- texture ----
function texFrom(img){const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.texImage2D(gl.TEXTURE_2D,0,gl.SRGB8_ALPHA8,gl.RGBA,gl.UNSIGNED_BYTE,img);gl.generateMipmap(gl.TEXTURE_2D);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.REPEAT);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);return t;}
function texRaw(b64,sz){const bin=atob(b64),u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,sz,sz,0,gl.RGBA,gl.UNSIGNED_BYTE,u);gl.generateMipmap(gl.TEXTURE_2D);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.REPEAT);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);return t;}
function draw(p,withDoor,tWood,tDoor,vp,view,proj,origin,rotY,tint){
  const [x,y,w,h]=vp; gl.viewport(x,y,w,h); gl.scissor(x,y,w,h); gl.enable(gl.SCISSOR_TEST); gl.enable(gl.DEPTH_TEST);
  gl.clearColor(0.02,0.02,0.02,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
  gl.useProgram(p); gl.bindVertexArray(vao);
  const bind=(name,b,n)=>{const l=gl.getAttribLocation(p,name);if(l<0)return;gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.enableVertexAttribArray(l);gl.vertexAttribPointer(l,n,gl.FLOAT,false,0,0);};
  bind('position',bPos,3);bind('normal',bNrm,3);bind('uv',bUv,2);bind('aDoorW',bW,1);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,bIdx);
  const model=M.mul(M.trans(...origin),M.rotY(rotY)), mv=M.mul(view,model);
  const U=(n)=>gl.getUniformLocation(p,n);
  gl.uniformMatrix4fv(U('modelMatrix'),false,model);gl.uniformMatrix4fv(U('modelViewMatrix'),false,mv);gl.uniformMatrix4fv(U('projectionMatrix'),false,proj);
  gl.uniformMatrix3fv(U('normalMatrix'),false,[mv[0],mv[1],mv[2],mv[4],mv[5],mv[6],mv[8],mv[9],mv[10]]);
  const f=D.factor; gl.uniform3f(U('diffuse'),f[0]*tint[0],f[1]*tint[1],f[2]*tint[2]); gl.uniform1f(U('opacity'),1); gl.uniform1f(U('roughness'),withDoor?0.6:0.6);
  gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,tWood);gl.uniform1i(U('map'),0);
  if(withDoor){gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,tDoor);gl.uniform1i(U('tDoor'),1);gl.uniform1f(U('u_dbump'),window.__u_dbump);}
  gl.drawElements(gl.TRIANGLES,D.geo.idx.length,gl.UNSIGNED_SHORT,0);
}
window.verify=async function(){
  const img=new Image(); img.src=WOOD; await img.decode();
  const tWood=texFrom(img), tDoor=texRaw(D.tex,D.size), pNew=prog(true);
  const tint=[0.82,0.74,0.6], proj=M.persp(0.9,1,0.05,30), W=700, H=700;
  const cv=document.getElementById('c'); const px=new Uint8Array(W*H*4);
  const shot=(view,origin,rot)=>{ draw(pNew,true,tWood,tDoor,[0,0,W,H],view,proj,origin,rot,tint); gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,px); return Uint8Array.from(px); };
  const cmp=(a,b)=>{let sum=0,mx=0,n=0;for(let i=0;i<a.length;i+=4){for(let c=0;c<3;c++){const d=Math.abs(a[i+c]-b[i+c]);sum+=d;if(d>mx)mx=d;n++;}}return {mean:sum/n,max:mx};};
  const out={};
  // 1) tekstur menempel pada daun: pintu diputar theta, kamera tetap  ==  pintu diam, kamera diputar -theta mengelilingi poros engsel
  for(const th of [0.5,1.1]){
    const e=[3.0,1.06,1.2], t=[0,1.06,0.6], c=Math.cos(-th), s=Math.sin(-th), er=[e[0]*c+e[2]*s,e[1],-e[0]*s+e[2]*c], tr=[t[0]*c+t[2]*s,t[1],-t[0]*s+t[2]*c];
    // pintu diputar +th dari kamera e  <=> pintu diam dari kamera yang diputar balik
    const A=shot(M.look(e,t,[0,1,0]),[0,0,0],th), B=shot(M.look(er,tr,[0,1,0]),[0,0,0],0);
    out['attach_'+th]=cmp(A,B);
  }
  // 2) kontrol: pintu yang sama dari sudut kamera berbeda TIDAK identik (uji ini membuktikan perbandingan di atas peka)
  const v=M.look([3.0,1.06,1.2],[0,1.06,0.6],[0,1,0]);
  const base=shot(v,[0,0,0],0.5), moved=shot(v,[0,0,0],0.0); out.control_rotated_vs_static=cmp(base,moved);
  // 3) variasi per pintu: origin berbeda -> pola berbeda; origin sama -> identik
  const v0=M.look([3.4,1.06,0.57],[0,1.06,0.57],[0,1,0]);
  const o1=[16.8,0,3.63], o2=[22.8,0,3.63], vo=(o)=>M.look([o[0]+3.4,1.06,o[2]+0.57],[o[0],1.06,o[2]+0.57],[0,1,0]);
  const a1=shot(vo(o1),o1,0), a1b=shot(vo(o1),o1,0), a2=shot(vo(o2),o2,0);
  out.same_origin=cmp(a1,a1b); out.diff_origin=cmp(a1,a2);
  // 4) tidak bercahaya: render dengan lampu mati (uLight tidak dipakai; cek luma maksimum di area pintu pada ambien rendah via roughness) -> piksel pintu tidak melebihi pantulan wajar
  let mxl=0; for(let i=0;i<a1.length;i+=4){const l=0.2126*a1[i]+0.7152*a1[i+1]+0.0722*a1[i+2]; if(l>mxl)mxl=l;} out.max_luma=mxl;
  let nan=0; for(let i=0;i<a1.length;i++) if(!(a1[i]>=0)) nan++; out.bad_pixels=nan;
  return out;
};
window.run=async function(){
  const img=new Image(); img.src=WOOD; await img.decode();
  const tWood=texFrom(img), tDoor=texRaw(D.tex,D.size);
  const pNew=prog(true), pOld=prog(false);
  window.__ready=!!(pNew&&pOld);
  if(!pNew||!pOld) return false;
  const tint=[0.82,0.74,0.6], proj=M.persp(0.9,1200/760*0.5,0.05,30);   // tiap panel 600x760
  const cam=(dist,cy)=>M.look([dist,cy,0.57],[0,cy,0.57],[0,1,0]);
  // 1) pintu penuh: LAMA (hanya map GLB) vs BARU
  const shots={};
  const full=(withDoor,rot,origin,vpx,view)=>draw(withDoor?pNew:pOld,withDoor,tWood,tDoor,[vpx,0,600,760],view,proj,origin,rot,tint);
  const grab=(name)=>{shots[name]=document.getElementById('c').toDataURL('image/png');};
  const v=cam(3.4,1.06);
  full(false,0,[0,0,0],0,v); full(true,0,[0,0,0],600,v);
  // canvas dibagi dua panel: render ulang tiap panel karena clear scissor; gabungkan di satu frame
  grab('full_old_new');
  // 2) closeup gagang + bagian bawah
  const v2=cam(1.45,0.72); full(false,0,[0,0,0],0,v2); full(true,0,[0,0,0],600,v2); grab('close_low_old_new');
  const v3=cam(1.35,1.0);  full(false,0,[0,0,0],0,v3); full(true,0,[0,0,0],600,v3); grab('close_handle_old_new');
  // 3) pintu berayun: tekstur harus mengikuti daun (kiri 0 deg, kanan 55 deg), kamera tetap
  const v4=M.look([3.2,1.06,1.8],[0,1.06,0.6],[0,1,0]); full(true,0,[0,0,0],0,v4); full(true,-0.96,[0,0,0],600,v4); grab('swing_0_55');
  // 4) variasi antar pintu: empat origin berbeda (hash per pintu)
  const outs=[]; const origins=[[16.8,0,3.63],[22.8,0,3.63],[4.8,0,15.63],[10.2,0,27.2]];
  for(let i=0;i<4;i++){ const o=origins[i], vv=M.look([o[0]+3.4,1.06,o[2]+0.57],[o[0],1.06,o[2]+0.57],[0,1,0]); draw(pNew,true,tWood,tDoor,[i*300,0,300,760],vv,M.persp(0.9,300/760,0.05,30),o,0,tint); }
  grab('variation_4doors');
  // 5) tepi (sisi engsel dan sisi bebas) dilihat miring
  const v5=M.look([1.6,1.8,2.6],[0,1.0,0.57],[0,1,0]); full(false,0,[0,0,0],0,v5); full(true,0,[0,0,0],600,v5); grab('oblique_old_new');
  return shots;
};
</script></body>"""
html = (HTML.replace('%DATA%', json.dumps(data)).replace('%CHAIN%', json.dumps(chain)).replace('%WOOD%', wood).replace('%MEDIUMP%', 'true' if MEDIUMP else 'false'))
tag = 'mediump' if MEDIUMP else 'highp'
open(OUT+f'/page_{tag}.html','w').write(html)
errs=[]
with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=["--use-angle=swiftshader","--use-gl=angle","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"])
    pg = b.new_page(viewport={'width':1200,'height':760})
    pg.on('console', lambda m: errs.append(('console.'+m.type, m.text)) if m.type in ('error','warning') else None)
    pg.on('pageerror', lambda e: errs.append(('pageerror', str(e))))
    pg.goto('file://'+OUT+'/page_%s.html' % tag)
    shots = pg.evaluate("window.run()")
    ver = pg.evaluate("window.verify()")
    json.dump(ver, open(OUT+'/verify_%s.json' % tag,'w'), indent=1); print('VERIFY', tag, json.dumps(ver))
    logs = pg.evaluate("window.__logs")
    res = {'tag':tag,'compile_logs':logs,'page_errors':errs}
    if shots:
        for k,v in shots.items():
            open(OUT+f'/{tag}_{k}.png','wb').write(base64.b64decode(v.split(',')[1]))
        res['shots']=list(shots.keys())
        src_new = pg.evaluate("window.__srcNew")
        open(OUT+f'/final_fragment_{tag}.glsl','w').write(src_new[1]); open(OUT+f'/final_vertex_{tag}.glsl','w').write(src_new[0])
    json.dump(res, open(OUT+f'/result_{tag}.json','w'), indent=1)
    for l in logs: print(l['stage'], 'withDoor=%s'%l['withDoor'], 'OK' if l['ok'] else 'FAIL', (l['log'] or '').strip()[:400])
    print('errors:', errs[:5]); print('shots:', res.get('shots'))
    b.close()
