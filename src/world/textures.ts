import * as THREE from 'three';
import { rng } from '../core/math.ts';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return [c, ctx];
}

function tex(c: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

function grain(ctx: CanvasRenderingContext2D, w: number, h: number, amount: number, seed: number): void {
  const r = rng(seed);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * amount;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

/** Inner slide surface. u = across the pipe (0..1), v = along the slide (1 tile = SLIDE_TILE m). */
export const SLIDE_TILE = 8;

export function slideTexture(): THREE.CanvasTexture {
  const W = 256, H = 1024;
  const [c, ctx] = canvas(W, H);
  ctx.fillStyle = '#f2eee6';
  ctx.fillRect(0, 0, W, H);
  // soft centre sheen band
  const g = ctx.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // orange upper walls with white pin-stripe
  ctx.fillStyle = '#ff5b1f';
  ctx.fillRect(0, 0, W * 0.11, H);
  ctx.fillRect(W * 0.89, 0, W * 0.11, H);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(W * 0.11, 0, 3, H);
  ctx.fillRect(W * 0.89 - 3, 0, 3, H);
  // Faded blue paint keeps the direction readable without looking like lane rails.
  ctx.fillStyle = '#7c9cb0';
  ctx.fillRect(W * 0.2, 0, 3, H);
  ctx.fillRect(W * 0.8 - 3, 0, 3, H);
  // dashed centre line: 1.5 m dash every 4 m
  const mpp = H / SLIDE_TILE;
  for (let m = 0; m < SLIDE_TILE; m += 4) {
    ctx.fillRect(W * 0.5 - 2, m * mpp, 4, 1.5 * mpp);
  }
  // Fine lengthwise wear, deterministic so the surface does not change on reload.
  const wear = rng(19);
  for (let i = 0; i < 80; i++) {
    const x = W * (0.14 + wear() * 0.72);
    const y = wear() * H;
    ctx.fillStyle = `rgba(88,105,108,${0.02 + wear() * 0.035})`;
    ctx.fillRect(x, y, 0.5 + wear(), 8 + wear() * 60);
  }
  // One moulded panel per tile, aligned with the external reinforcement ribs.
  ctx.fillStyle = 'rgba(60,60,70,0.25)';
  ctx.fillRect(0, 0, W, 2);
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillRect(0, 2, W, 1);
  // rivets on the walls
  ctx.fillStyle = 'rgba(40,40,40,0.5)';
  for (let m = 0; m < SLIDE_TILE; m += 1) {
    for (const u of [0.04, 0.96]) {
      ctx.beginPath();
      ctx.arc(u * W, (m + 0.5) * mpp, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  grain(ctx, W, H, 10, 7);
  return tex(c);
}

export function hazardTexture(): THREE.CanvasTexture {
  const W = 256, H = 1024;
  const [c, ctx] = canvas(W, H);
  ctx.fillStyle = '#ffc21a';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#141414';
  const mpp = H / SLIDE_TILE;
  // chevrons pointing along +v (direction of travel)
  for (let m = -1; m < SLIDE_TILE + 1; m += 2) {
    const y = m * mpp;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W / 2, y + 0.9 * mpp);
    ctx.lineTo(W, y);
    ctx.lineTo(W, y + 0.8 * mpp);
    ctx.lineTo(W / 2, y + 1.7 * mpp);
    ctx.lineTo(0, y + 0.8 * mpp);
    ctx.closePath();
    ctx.fill();
  }
  grain(ctx, W, H, 14, 3);
  return tex(c);
}

export function catchTexture(): THREE.CanvasTexture {
  const W = 256, H = 1024;
  const [c, ctx] = canvas(W, H);
  ctx.fillStyle = '#f2f7f2';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#18c46a';
  ctx.fillRect(0, 0, W * 0.16, H);
  ctx.fillRect(W * 0.84, 0, W * 0.16, H);
  const mpp = H / SLIDE_TILE;
  ctx.fillStyle = '#18c46a';
  for (let m = 0; m < SLIDE_TILE; m += 4) {
    const y = m * mpp;
    ctx.beginPath();
    ctx.moveTo(W * 0.22, y);
    ctx.lineTo(W * 0.5, y + 1.3 * mpp);
    ctx.lineTo(W * 0.78, y);
    ctx.lineTo(W * 0.78, y + 0.7 * mpp);
    ctx.lineTo(W * 0.5, y + 2.0 * mpp);
    ctx.lineTo(W * 0.22, y + 0.7 * mpp);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  for (let m = 0; m < SLIDE_TILE; m += 2) ctx.fillRect(0, m * mpp, W, 2);
  grain(ctx, W, H, 10, 5);
  return tex(c);
}

/** Streaky alpha map for the thin sheet of running water on the slide. */
export function waterFilmTexture(): THREE.CanvasTexture {
  const W = 128, H = 512;
  const [c, ctx] = canvas(W, H);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  const r = rng(11);
  for (let i = 0; i < 260; i++) {
    const x = r() * W;
    const y = r() * H;
    const len = 20 + r() * 120;
    const a = 0.08 + r() * 0.35;
    const w = 0.6 + r() * 1.8;
    const grd = ctx.createLinearGradient(0, y, 0, y + len);
    grd.addColorStop(0, `rgba(255,255,255,0)`);
    grd.addColorStop(0.5, `rgba(255,255,255,${a})`);
    grd.addColorStop(1, `rgba(255,255,255,0)`);
    ctx.fillStyle = grd;
    for (const dy of [0, -H, H]) ctx.fillRect(x, y + dy, w, len);
  }
  return tex(c, false);
}

/** Tileable ocean normal map built from integer-wavenumber sinusoids. */
export function oceanNormalTexture(): THREE.DataTexture {
  const N = 256;
  const h = new Float32Array(N * N);
  const r = rng(42);
  const waves: [number, number, number, number][] = [];
  for (let i = 0; i < 48; i++) {
    const k = 2 + Math.floor(Math.pow(r(), 1.6) * 28);
    const ang = r() * Math.PI * 2;
    const kx = Math.round(Math.cos(ang) * k);
    const ky = Math.round(Math.sin(ang) * k);
    if (kx === 0 && ky === 0) continue;
    const amp = 1 / Math.pow(Math.hypot(kx, ky), 1.25);
    waves.push([kx, ky, amp, r() * Math.PI * 2]);
  }
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      let v = 0;
      for (const [kx, ky, a, ph] of waves) {
        const p = ((kx * x + ky * y) / N) * Math.PI * 2 + ph;
        // sharpened crests
        const s = Math.sin(p);
        v += a * (s - 0.35 * s * s * s);
      }
      h[y * N + x] = v;
    }
  const data = new Uint8Array(N * N * 4);
  const strength = 9;
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const hl = h[y * N + ((x - 1 + N) % N)];
      const hr = h[y * N + ((x + 1) % N)];
      const hd = h[((y - 1 + N) % N) * N + x];
      const hu = h[((y + 1) % N) * N + x];
      let nx = (hl - hr) * strength;
      let ny = (hd - hu) * strength;
      let nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      nz /= l;
      const i = (y * N + x) * 4;
      data[i] = (nx * 0.5 + 0.5) * 255;
      data[i + 1] = (ny * 0.5 + 0.5) * 255;
      data[i + 2] = (nz * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/** 2x2 atlas of cumulus puffs (alpha in A, self-shadow in RGB). */
export function cloudAtlas(): THREE.CanvasTexture {
  const S = 256;
  const [c, ctx] = canvas(S * 2, S * 2);
  ctx.clearRect(0, 0, S * 2, S * 2);
  for (let q = 0; q < 4; q++) {
    const ox = (q % 2) * S;
    const oy = Math.floor(q / 2) * S;
    const r = rng(100 + q * 17);
    const blobs = 26 + Math.floor(r() * 12);
    for (let i = 0; i < blobs; i++) {
      const a = r() * Math.PI * 2;
      const d = Math.pow(r(), 0.7) * S * 0.28;
      const x = ox + S / 2 + Math.cos(a) * d * 1.25;
      const y = oy + S / 2 + Math.sin(a) * d * 0.7 - S * 0.02;
      const rad = S * (0.08 + r() * 0.12);
      const shade = Math.round(215 + (1 - (y - oy) / S) * 40);
      const grd = ctx.createRadialGradient(x, y - rad * 0.25, 0, x, y, rad);
      grd.addColorStop(0, `rgba(${shade},${shade},${Math.min(255, shade + 8)},0.55)`);
      grd.addColorStop(0.6, `rgba(${shade - 10},${shade - 10},${shade},0.28)`);
      grd.addColorStop(1, `rgba(${shade - 20},${shade - 20},${shade - 10},0)`);
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const t = tex(c);
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

export function labelTexture(text: string, bg: string, fg: string, w = 1024, h = 192): THREE.CanvasTexture {
  const [c, ctx] = canvas(w, h);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = fg;
  ctx.lineWidth = 10;
  ctx.strokeRect(12, 12, w - 24, h - 24);
  ctx.fillStyle = fg;
  ctx.font = `900 ${Math.round(h * 0.52)}px "Segoe UI", "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2 + 4);
  const t = tex(c);
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

export function checkerTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 64);
  for (let x = 0; x < 16; x++)
    for (let y = 0; y < 4; y++) {
      ctx.fillStyle = (x + y) % 2 ? '#111' : '#fff';
      ctx.fillRect(x * 16, y * 16, 16, 16);
    }
  const t = tex(c);
  t.magFilter = THREE.NearestFilter;
  return t;
}

/** Soft round particle. */
export function softDotTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = tex(c);
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
