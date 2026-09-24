import * as THREE from 'three';
import { softDotTexture } from '../world/textures.ts';

/** CPU-simulated point sprites (spray, splashes, foam). */
export class Particles {
  readonly points: THREE.Points;
  private readonly max: number;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly size: Float32Array;
  private readonly data: Float32Array;
  private readonly drag: Float32Array;
  private readonly geo: THREE.BufferGeometry;
  private head = 0;
  gravity = 9.81;

  constructor(max: number, color: THREE.ColorRepresentation, opacity = 0.85) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max).fill(1);
    this.size = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.data = new Float32Array(max * 2);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('pdata', new THREE.BufferAttribute(this.data, 2).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        { uMap: { value: null }, uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity }, uScale: { value: 600 } },
      ]),
      vertexShader: /* glsl */ `
        attribute vec2 pdata; // size, alpha
        uniform float uScale;
        varying float vAlpha;
        #include <fog_pars_vertex>
        void main() {
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = pdata.x * uScale / max(0.3, -mvPosition.z);
          // droplets brushing past the lens would read as huge blobs: fade them out
          vAlpha = pdata.y * smoothstep(0.35, 1.6, -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        uniform vec3 uColor;
        uniform float uOpacity;
        varying float vAlpha;
        #include <fog_pars_fragment>
        void main() {
          float a = texture2D(uMap, gl_PointCoord).a * vAlpha * uOpacity;
          if (a < 0.01) discard;
          gl_FragColor = vec4(uColor, a);
          #include <fog_fragment>
        }
      `,
      fog: true,
      transparent: true,
      depthWrite: false,
    });
    mat.uniforms.uMap.value = softDotTexture();
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
  }

  setPixelScale(h: number, fov: number): void {
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value = h / (2 * Math.tan((fov * Math.PI) / 360));
  }

  spawn(p: THREE.Vector3, v: THREE.Vector3, life: number, size: number, drag = 0.5): void {
    const i = this.head;
    this.head = (this.head + 1) % this.max;
    this.pos[i * 3] = p.x;
    this.pos[i * 3 + 1] = p.y;
    this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x;
    this.vel[i * 3 + 1] = v.y;
    this.vel[i * 3 + 2] = v.z;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size[i] = size;
    this.drag[i] = drag;
  }

  update(dt: number): void {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        this.data[i * 2 + 1] = 0;
        continue;
      }
      this.life[i] -= dt;
      const k = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= k;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - this.gravity * dt;
      this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const u = this.life[i] / this.maxLife[i];
      this.data[i * 2] = this.size[i] * (1.6 - 0.6 * u);
      this.data[i * 2 + 1] = Math.min(1, u * 3) * u;
    }
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('pdata') as THREE.BufferAttribute).needsUpdate = true;
  }

  clear(): void {
    this.life.fill(0);
  }
}

const _p = new THREE.Vector3();
const _v = new THREE.Vector3();

/** Big crown splash on the sea surface. */
export function seaSplash(ps: Particles, at: THREE.Vector3, scale: number, rand: () => number): void {
  for (let i = 0; i < 260 * scale; i++) {
    const a = rand() * Math.PI * 2;
    const r = rand() * 3 * scale;
    const up = 8 + rand() * 22 * scale;
    const out = 3 + rand() * 9 * scale;
    _p.set(at.x + Math.cos(a) * r, Math.max(0.2, at.y), at.z + Math.sin(a) * r);
    _v.set(Math.cos(a) * out, up, Math.sin(a) * out);
    ps.spawn(_p, _v, 1.2 + rand() * 1.6, 0.5 + rand() * 1.4 * scale, 0.35);
  }
}
