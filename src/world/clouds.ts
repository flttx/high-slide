import * as THREE from 'three';
import { rng } from '../core/math.ts';
import { cloudAtlas } from './textures.ts';

export const CLOUD_BASE = 560;
export const CLOUD_TOP = 650;

export interface Clouds {
  mesh: THREE.Mesh;
  update(camera: THREE.Camera, time: number): void;
  /** 0..1 how deeply the camera is inside a cloud puff. */
  density(p: THREE.Vector3): number;
}

interface Puff {
  p: THREE.Vector3;
  size: number;
  rot: number;
  tile: number;
  alpha: number;
}

export function buildClouds(centre: THREE.Vector3): Clouds {
  const r = rng(77);
  const puffs: Puff[] = [];
  const add = (x: number, y: number, z: number, size: number, alpha: number) =>
    puffs.push({ p: new THREE.Vector3(x, y, z), size, rot: r() * Math.PI * 2, tile: Math.floor(r() * 4), alpha });
  // main deck around the course, arranged in clumps so there are holes to see the sea through
  for (let c = 0; c < 110; c++) {
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r()) * 3800;
    const cx = centre.x + Math.cos(a) * d, cz = centre.z + Math.sin(a) * d;
    const n = 3 + Math.floor(r() * 5);
    for (let k = 0; k < n; k++) {
      add(
        cx + (r() - 0.5) * 260,
        CLOUD_BASE + r() * (CLOUD_TOP - CLOUD_BASE),
        cz + (r() - 0.5) * 260,
        120 + r() * 200,
        0.75 + r() * 0.25,
      );
    }
  }
  // distant sea of clouds
  for (let c = 0; c < 260; c++) {
    const a = r() * Math.PI * 2;
    const d = 4000 + r() * 16000;
    add(centre.x + Math.cos(a) * d, CLOUD_BASE + r() * 120, centre.z + Math.sin(a) * d, 500 + r() * 900, 0.9);
  }
  // a few low wisps near the sea for depth
  for (let c = 0; c < 70; c++) {
    const a = r() * Math.PI * 2;
    const d = 500 + r() * 5000;
    add(centre.x + Math.cos(a) * d, 90 + r() * 160, centre.z + Math.sin(a) * d, 80 + r() * 140, 0.35);
  }

  const count = puffs.length;
  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.getAttribute('position'));
  geo.setAttribute('uv', base.getAttribute('uv'));
  const iPos = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
  const iData = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
  iPos.setUsage(THREE.DynamicDrawUsage);
  iData.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iPos', iPos);
  geo.setAttribute('iData', iData);
  geo.instanceCount = count;

  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uMap: { value: null },
        uLit: { value: new THREE.Color(1.25, 1.12, 0.98) },
        uShade: { value: new THREE.Color(0.52, 0.58, 0.7) },
      },
    ]),
    vertexShader: /* glsl */ `
      attribute vec3 iPos;
      attribute vec4 iData; // size, rot, tile, alpha
      varying vec2 vUv;
      varying float vAlpha;
      #include <fog_pars_vertex>
      void main() {
        float size = iData.x;
        float c = cos(iData.y), s = sin(iData.y);
        vec2 q = vec2(c * position.x - s * position.y, s * position.x + c * position.y) * size;
        vec4 mvCenter = viewMatrix * vec4(iPos, 1.0);
        vec4 mvPosition = mvCenter + vec4(q.x, q.y * 0.62, 0.0, 0.0);
        float tile = iData.z;
        vUv = uv * 0.5 + vec2(mod(tile, 2.0), floor(tile / 2.0)) * 0.5;
        float d = -mvCenter.z;
        // fade out puffs that are about to swallow the camera
        vAlpha = iData.w * smoothstep(size * 0.18, size * 0.6, d);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform vec3 uLit;
      uniform vec3 uShade;
      varying vec2 vUv;
      varying float vAlpha;
      #include <fog_pars_fragment>
      void main() {
        vec4 t = texture2D(uMap, vUv);
        float a = t.a * vAlpha;
        if (a < 0.01) discard;
        vec3 col = mix(uShade, uLit, smoothstep(0.55, 0.98, t.r));
        gl_FragColor = vec4(col, a);
        #include <fog_fragment>
      }
    `,
    fog: true,
    transparent: true,
    depthWrite: false,
  });
  mat.uniforms.uMap.value = cloudAtlas();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;

  const order = puffs.map((_, i) => i);
  const dist = new Float32Array(count);
  let lastSort = -1;
  const camPos = new THREE.Vector3();
  const writeAll = () => {
    for (let k = 0; k < count; k++) {
      const pf = puffs[order[k]];
      iPos.setXYZ(k, pf.p.x, pf.p.y, pf.p.z);
      iData.setXYZW(k, pf.size, pf.rot, pf.tile, pf.alpha);
    }
    iPos.needsUpdate = true;
    iData.needsUpdate = true;
  };
  writeAll();

  const update = (camera: THREE.Camera, time: number) => {
    camera.getWorldPosition(camPos);
    if (time - lastSort < 0.25) return;
    lastSort = time;
    for (let i = 0; i < count; i++) dist[i] = puffs[i].p.distanceToSquared(camPos);
    order.sort((a, b) => dist[b] - dist[a]);
    writeAll();
  };

  const density = (p: THREE.Vector3) => {
    if (p.y < CLOUD_BASE - 120 || p.y > CLOUD_TOP + 120) return 0;
    let d = 0;
    for (const pf of puffs) {
      const dx = pf.p.x - p.x, dy = (pf.p.y - p.y) * 1.6, dz = pf.p.z - p.z;
      const rr = pf.size * 0.42;
      const q = (dx * dx + dy * dy + dz * dz) / (rr * rr);
      if (q < 1) d = Math.max(d, (1 - q) * pf.alpha);
    }
    return Math.min(1, d * 1.4);
  };

  return { mesh, update, density };
}
