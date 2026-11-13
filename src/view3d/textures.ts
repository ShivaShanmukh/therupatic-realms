// Procedural canvas textures. No external image files, so nothing to license.
import * as THREE from 'three';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!] as const;
}

function toTexture(c: HTMLCanvasElement, repeat: [number, number] = [1, 1], srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function woodFloor(): THREE.Texture {
  const [c, g] = canvas(512, 512);
  const r = rng(7);
  const plankH = 64;
  for (let y = 0; y < 512; y += plankH) {
    let x = -Math.floor(r() * 300);
    while (x < 512) {
      const len = 260 + r() * 240;
      const base = 52 + r() * 18;
      g.fillStyle = `hsl(24, 38%, ${base * 0.42}%)`;
      g.fillRect(x, y, len, plankH);
      for (let i = 0; i < 28; i++) {
        g.strokeStyle = `hsla(22, 40%, ${10 + r() * 14}%, ${0.15 + r() * 0.2})`;
        g.lineWidth = 1 + r() * 1.5;
        const yy = y + r() * plankH;
        g.beginPath();
        g.moveTo(x, yy);
        g.bezierCurveTo(x + len * 0.3, yy + (r() - 0.5) * 8, x + len * 0.6, yy + (r() - 0.5) * 8, x + len, yy);
        g.stroke();
      }
      g.fillStyle = 'rgba(10,5,2,0.6)';
      g.fillRect(x, y, 2, plankH);
      x += len;
    }
    g.fillStyle = 'rgba(10,5,2,0.7)';
    g.fillRect(0, y, 512, 2);
  }
  return toTexture(c, [3, 3]);
}

export function oakPanel(): THREE.Texture {
  const [c, g] = canvas(256, 512);
  const r = rng(11);
  g.fillStyle = '#3b2416';
  g.fillRect(0, 0, 256, 512);
  for (let i = 0; i < 90; i++) {
    g.strokeStyle = `hsla(24, 45%, ${8 + r() * 16}%, ${0.25 + r() * 0.3})`;
    g.lineWidth = 1 + r() * 2;
    const x = r() * 256;
    g.beginPath();
    g.moveTo(x, 0);
    g.bezierCurveTo(x + (r() - 0.5) * 20, 170, x + (r() - 0.5) * 20, 340, x + (r() - 0.5) * 10, 512);
    g.stroke();
  }
  g.fillStyle = 'rgba(0,0,0,0.45)';
  g.fillRect(0, 0, 4, 512);
  return toTexture(c, [6, 1]);
}

export function stone(): THREE.Texture {
  const [c, g] = canvas(512, 512);
  const r = rng(23);
  g.fillStyle = '#6d6259';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 4000; i++) {
    const v = 30 + r() * 25;
    g.fillStyle = `hsla(28, 10%, ${v}%, 0.18)`;
    g.fillRect(r() * 512, r() * 512, 2 + r() * 6, 2 + r() * 6);
  }
  g.strokeStyle = 'rgba(30,24,20,0.5)';
  g.lineWidth = 2;
  for (let y = 0; y < 512; y += 128) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(512, y);
    g.stroke();
    const off = (y / 128) % 2 ? 128 : 0;
    for (let x = off; x < 512; x += 256) {
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x, y + 128);
      g.stroke();
    }
  }
  return toTexture(c, [2, 2]);
}

export function plaster(): THREE.Texture {
  const [c, g] = canvas(256, 256);
  const r = rng(31);
  g.fillStyle = '#8a7462';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2500; i++) {
    g.fillStyle = `hsla(26, 18%, ${38 + r() * 14}%, 0.12)`;
    g.fillRect(r() * 256, r() * 256, 3, 3);
  }
  return toTexture(c, [4, 2]);
}

export function rug(): THREE.Texture {
  const [c, g] = canvas(512, 512);
  g.fillStyle = '#5a3a2a';
  g.fillRect(0, 0, 512, 512);
  g.strokeStyle = '#8b6a4a';
  g.lineWidth = 10;
  g.strokeRect(24, 24, 464, 464);
  g.strokeStyle = '#3a2418';
  g.lineWidth = 4;
  g.strokeRect(48, 48, 416, 416);
  const r = rng(5);
  for (let i = 0; i < 6000; i++) {
    g.fillStyle = `hsla(${18 + r() * 14}, 30%, ${22 + r() * 18}%, 0.25)`;
    g.fillRect(r() * 512, r() * 512, 2, 2);
  }
  return toTexture(c);
}

export function fabric(hue = 34, light = 62): THREE.Texture {
  const [c, g] = canvas(128, 128);
  g.fillStyle = `hsl(${hue}, 18%, ${light}%)`;
  g.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 128; y += 2) {
    g.fillStyle = `hsla(${hue}, 15%, ${light - 10}%, 0.25)`;
    g.fillRect(0, y, 128, 1);
  }
  for (let x = 0; x < 128; x += 3) {
    g.fillStyle = `hsla(${hue}, 15%, ${light + 6}%, 0.12)`;
    g.fillRect(x, 0, 1, 128);
  }
  return toTexture(c, [3, 3]);
}

/** Sunset sky with a city silhouette, drawn once onto a big canvas. */
export function citySunset(): THREE.Texture {
  const [c, g] = canvas(2048, 1024);
  const sky = g.createLinearGradient(0, 0, 0, 1024);
  sky.addColorStop(0, '#2a2348');
  sky.addColorStop(0.32, '#6b4a7a');
  sky.addColorStop(0.55, '#d9826a');
  sky.addColorStop(0.7, '#f3b071');
  sky.addColorStop(1, '#f6c98a');
  g.fillStyle = sky;
  g.fillRect(0, 0, 2048, 1024);
  // sun glow
  const sun = g.createRadialGradient(1300, 700, 10, 1300, 700, 420);
  sun.addColorStop(0, 'rgba(255,226,170,0.95)');
  sun.addColorStop(0.2, 'rgba(255,200,140,0.5)');
  sun.addColorStop(1, 'rgba(255,180,120,0)');
  g.fillStyle = sun;
  g.fillRect(0, 0, 2048, 1024);
  const r = rng(99);
  // two layers of buildings
  for (const layer of [
    { base: 760, maxH: 260, color: '#6a4560', lit: 0.12 },
    { base: 1024, maxH: 470, color: '#2c1f33', lit: 0.3 },
  ]) {
    let x = -20;
    while (x < 2048) {
      const w = 50 + r() * 120;
      const h = layer.maxH * (0.35 + r() * 0.65);
      const top = layer.base - h;
      g.fillStyle = layer.color;
      g.fillRect(x, top, w, layer.base - top);
      if (r() > 0.7) g.fillRect(x + w * 0.4, top - 30 - r() * 60, 4, 60);
      for (let wy = top + 12; wy < layer.base - 10; wy += 16) {
        for (let wx = x + 8; wx < x + w - 8; wx += 12) {
          if (r() < layer.lit) {
            g.fillStyle = `rgba(255, ${190 + r() * 40}, ${110 + r() * 40}, ${0.5 + r() * 0.4})`;
            g.fillRect(wx, wy, 5, 7);
          }
        }
      }
      x += w + r() * 6;
    }
  }
  return toTexture(c);
}

/** Subtle pattern for hypothetical panels so A/B differ by more than colour. */
export function panelPattern(kind: 'stripes' | 'dots'): THREE.Texture {
  const [c, g] = canvas(128, 128);
  g.clearRect(0, 0, 128, 128);
  g.fillStyle = 'rgba(255,255,255,0.5)';
  if (kind === 'stripes') {
    g.save();
    g.translate(64, 64);
    g.rotate(-Math.PI / 4);
    for (let i = -128; i < 128; i += 16) g.fillRect(i, -128, 4, 256);
    g.restore();
  } else {
    for (let y = 8; y < 128; y += 16) for (let x = 8; x < 128; x += 16) {
      g.beginPath();
      g.arc(x + ((y / 16) % 2) * 8, y, 2.6, 0, Math.PI * 2);
      g.fill();
    }
  }
  return toTexture(c, [3, 5], false);
}
