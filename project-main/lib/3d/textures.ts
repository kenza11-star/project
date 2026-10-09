import * as THREE from 'three';

function mk(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, rx: number, ry: number) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 2;
  return t;
}
function noise(g: CanvasRenderingContext2D, w: number, h: number, n: number, a: number) {
  for (let i = 0; i < n; i++) {
    const v = (Math.random() * 80) | 0;
    g.fillStyle = `rgba(${v},${(v * 0.8) | 0},${(v * 0.3) | 0},${Math.random() * a})`;
    g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 1 + Math.random() * 3);
  }
}

export const wallpaper = (rx: number, ry: number) => mk(256, 256, (g) => {
  g.fillStyle = '#a6944a'; g.fillRect(0, 0, 256, 256);
  g.fillStyle = 'rgba(90,75,25,.35)';
  for (let x = 0; x < 256; x += 32) g.fillRect(x, 0, 10, 256);
  g.fillStyle = 'rgba(60,45,15,.2)';
  for (let y = 0; y < 256; y += 64) g.fillRect(0, y, 256, 3);
  noise(g, 256, 256, 2500, 0.35);
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(30,20,0,.45)');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
}, rx, ry);

export const floor = (rx: number, ry: number) => mk(256, 256, (g) => {
  g.fillStyle = '#2a2010'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    const s = 70 + ((Math.random() * 25) | 0);
    g.fillStyle = `rgb(${s + 40},${s + 25},${s - 10})`;
    g.fillRect(i * 64 + 2, j * 64 + 2, 60, 60);
  }
  noise(g, 256, 256, 3000, 0.4);
}, rx, ry);

export const ceiling = (rx: number, ry: number) => mk(256, 256, (g) => {
  g.fillStyle = '#b3a880'; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(60,50,30,.6)'; g.lineWidth = 3;
  g.strokeRect(1, 1, 254, 254); g.beginPath(); g.moveTo(128, 0); g.lineTo(128, 256); g.moveTo(0, 128); g.lineTo(256, 128); g.stroke();
  noise(g, 256, 256, 1200, 0.3);
}, rx, ry);
