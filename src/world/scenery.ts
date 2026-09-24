import * as THREE from 'three';
import { rng } from '../core/math.ts';
import type { Track } from '../track/track.ts';

/** Cheap 3D value noise + fbm (deterministic, no deps). */
function hash3(x: number, y: number, z: number): number {
  let h = (x * 374761393 + y * 668265263 + z * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function vnoise(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  let r = 0;
  for (let dz = 0; dz <= 1; dz++)
    for (let dy = 0; dy <= 1; dy++)
      for (let dx = 0; dx <= 1; dx++) {
        const wt = (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
        r += wt * hash3(xi + dx, yi + dy, zi + dz);
      }
  return r;
}

function fbm(x: number, y: number, z: number, oct = 5): number {
  let a = 0.5, f = 1, s = 0;
  for (let i = 0; i < oct; i++) {
    s += a * vnoise(x * f, y * f, z * f);
    f *= 2.03;
    a *= 0.5;
  }
  return s;
}

const GRASS = new THREE.Color(0x3f6b34);
const ROCK = new THREE.Color(0x6e6a62);
const DARKROCK = new THREE.Color(0x3b3935);
const SAND = new THREE.Color(0xcdb98f);

function rockMesh(radius: number, height: number, seed: number, detail: number, grassy: boolean, envMap: THREE.Texture | null): THREE.Mesh {
  const geo = new THREE.IcosahedronGeometry(1, detail);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const cols = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = fbm(v.x * 2.1 + seed, v.y * 2.1, v.z * 2.1 - seed);
    const ridge = 1 - Math.abs(fbm(v.x * 5 + seed * 3, v.y * 5, v.z * 5) * 2 - 1);
    let y = v.y;
    // pillar-ish: steep sides, bulky top
    const k = 0.75 + n * 0.55 + ridge * 0.12;
    const px = v.x * radius * k;
    const pz = v.z * radius * k;
    y = y > -0.2 ? Math.pow(Math.max(0, (y + 0.2) / 1.2), 0.55) * height * (0.8 + n * 0.4) : y * 40;
    pos.setXYZ(i, px, y, pz);
    const up = v.y;
    if (y < 3) c.copy(SAND);
    else if (grassy && up > 0.55 + (n - 0.5) * 0.4) c.copy(GRASS).lerp(ROCK, ridge * 0.4);
    else c.copy(ROCK).lerp(DARKROCK, ridge * 0.7 + (1 - n) * 0.3);
    cols[i * 3] = c.r;
    cols[i * 3 + 1] = c.g;
    cols[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true, envMap, envMapIntensity: 0.25 });
  return new THREE.Mesh(geo, mat);
}

export function buildScenery(track: Track, envMap: THREE.Texture | null): THREE.Group {
  const group = new THREE.Group();
  const r = rng(2024);
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (const s of track.segments) {
    min.min(s.min);
    max.max(s.max);
  }
  const centre = min.clone().add(max).multiplyScalar(0.5);

  // distant islands on the horizon
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + r() * 0.5;
    const d = 7000 + r() * 9000;
    const island = rockMesh(700 + r() * 1400, 250 + r() * 650, i * 13.7, 4, true, envMap);
    island.position.set(centre.x + Math.cos(a) * d, -2, centre.z + Math.sin(a) * d);
    island.rotation.y = r() * Math.PI;
    group.add(island);
  }

  // sea stacks near the course for close-range scale, kept clear of the slide
  const samples: THREE.Vector3[] = [];
  for (const s of track.segments) for (let i = 0; i < s.count; i += 4) samples.push(new THREE.Vector3(s.pos[i * 3], s.pos[i * 3 + 1], s.pos[i * 3 + 2]));
  let placed = 0;
  for (let tries = 0; tries < 400 && placed < 14; tries++) {
    const x = min.x - 400 + r() * (max.x - min.x + 800);
    const z = min.z - 400 + r() * (max.z - min.z + 800);
    const rad = 22 + r() * 45;
    const h = 60 + r() * 260;
    let ok = true;
    for (const p of samples) {
      const dx = p.x - x, dz = p.z - z;
      const clear = rad * 1.6 + 45;
      if (dx * dx + dz * dz < clear * clear && p.y < h + 80) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    const stack = rockMesh(rad, h, 100 + tries, 3, h < 150, envMap);
    stack.position.set(x, -3, z);
    stack.rotation.y = r() * Math.PI;
    group.add(stack);
    // foam collar
    const foam = new THREE.Mesh(
      new THREE.RingGeometry(rad * 1.05, rad * 1.5, 40),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    foam.rotation.x = -Math.PI / 2;
    foam.position.set(x, 0.1, z);
    group.add(foam);
    placed++;
  }
  return group;
}

export function trackCentre(track: Track): THREE.Vector3 {
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (const s of track.segments) {
    min.min(s.min);
    max.max(s.max);
  }
  return min.add(max).multiplyScalar(0.5);
}
