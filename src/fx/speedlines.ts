import * as THREE from 'three';
import { rng } from '../core/math.ts';

/**
 * World-space streaks that are spawned in a tube ahead of the camera and stretched along the
 * rider's velocity, so they whip past faster the faster you go (works for falling, too).
 */
export class SpeedLines {
  readonly mesh: THREE.LineSegments;
  private readonly count: number;
  private readonly anchors: THREE.Vector3[] = [];
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly rand = rng(5);
  private readonly _fwd = new THREE.Vector3();
  private readonly _rel = new THREE.Vector3();
  private readonly _u = new THREE.Vector3();
  private readonly _w = new THREE.Vector3();

  constructor(count = 240) {
    this.count = count;
    this.pos = new Float32Array(count * 6);
    this.col = new Float32Array(count * 6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.LineSegments(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
    for (let i = 0; i < count; i++) this.anchors.push(new THREE.Vector3(1e9, 1e9, 1e9));
  }

  private respawn(a: THREE.Vector3, cam: THREE.Vector3, dir: THREE.Vector3, near: boolean): void {
    const r = this.rand;
    // orthonormal basis around the travel direction
    this._u.set(0, 1, 0);
    if (Math.abs(dir.y) > 0.9) this._u.set(1, 0, 0);
    this._w.crossVectors(dir, this._u).normalize();
    this._u.crossVectors(this._w, dir).normalize();
    const ang = r() * Math.PI * 2;
    const rad = 1.6 + Math.pow(r(), 0.7) * 9;
    const dist = near ? r() * 60 : 35 + r() * 30;
    a.copy(cam)
      .addScaledVector(dir, dist)
      .addScaledVector(this._u, Math.cos(ang) * rad)
      .addScaledVector(this._w, Math.sin(ang) * rad);
  }

  /** intensity 0..1 */
  update(cam: THREE.Vector3, vel: THREE.Vector3, intensity: number): void {
    const speed = vel.length();
    const dir = this._fwd.copy(vel).multiplyScalar(1 / Math.max(1e-3, speed));
    const len = Math.min(9, speed * 0.075);
    for (let i = 0; i < this.count; i++) {
      const a = this.anchors[i];
      const rel = this._rel.copy(a).sub(cam);
      const along = rel.dot(dir);
      if (along < -4 || rel.lengthSq() > 70 * 70) this.respawn(a, cam, dir, rel.lengthSq() > 1e10);
      const o = i * 6;
      this.pos[o] = a.x;
      this.pos[o + 1] = a.y;
      this.pos[o + 2] = a.z;
      this.pos[o + 3] = a.x - dir.x * len;
      this.pos[o + 4] = a.y - dir.y * len;
      this.pos[o + 5] = a.z - dir.z * len;
      // fade in at the far end so lines don't pop
      const fade = Math.min(1, Math.max(0, (65 - along) / 20));
      const c = intensity * fade * 0.55;
      this.col[o] = c;
      this.col[o + 1] = c;
      this.col[o + 2] = c;
      this.col[o + 3] = 0;
      this.col[o + 4] = 0;
      this.col[o + 5] = 0;
    }
    const g = this.mesh.geometry;
    (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    this.mesh.visible = intensity > 0.01;
  }
}
