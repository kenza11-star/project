const {md,cw}=require('./_an.js');
for(const nm of ['Door_14','Door_22']){const d=md.doors.find(x=>x.name===nm);console.log(nm,d.cx.toFixed(2),d.cz.toFixed(2),'n',d.nx,d.nz,'level',d.level,'yaw',d.yaw.toFixed(2));
 for(const sg of [1,-1])for(const dist of [0.5,0.9,1.3,1.8]){const x=d.cx+d.nx*sg*dist,z=d.cz+d.nz*sg*dist;const ob=cw.obbs.filter(o=>o.level===d.level&&o.enabled&&o.kind!=='door'&&require('../.tmp-game/collision.js').CollisionWorld.distToObb(o,x,z)<0.3).map(o=>o.id);console.log('  side',sg,'d',dist,'wallblocked',cw.gridBlocked(x,z,0.3,d.level),'obbs',ob.join(','));}}
