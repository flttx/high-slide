import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { clamp, damp, lerp, rng, smoothstep } from '../core/math.ts';

/** Target body length in metres (a properly oversized megalodon). */
const SHARK_LENGTH = 24;
const WATER_TINT = new THREE.Color(0.004, 0.026, 0.04);
export const RISE_TIME = 2.3;
/** Seconds before the rise when the hunter comes up and waits, jaws open, under the impact point. */
const WAIT_TIME = 3.5;
const HUNT_SPEED = 34;

type SharkState = 'idle' | 'hunt' | 'eat' | 'dive';

interface Shark {
  root: THREE.Group;
  mixer: THREE.AnimationMixer | null;
  swim: THREE.AnimationAction | null;
  jaw: THREE.AnimationAction | null;
  /** fallback rig: lower jaw pivot */
  jawPivot: THREE.Object3D | null;
  mouth: THREE.Object3D;
  state: SharkState;
  pos: THREE.Vector3;
  yaw: number;
  pitch: number;
  roll: number;
  speed: number;
  jawOpen: number;
  timer: number;
  /** mouth height / time-to-impact when the final rise began */
  riseFrom: number | null;
  riseT0: number;
  wander: { cx: number; cz: number; r: number; phase: number; depth: number; dir: number; rate: number };
}

export interface HuntInfo {
  /** predicted impact point on the sea */
  point: THREE.Vector3;
  /** seconds (game time) until impact */
  timeLeft: number;
  rider: THREE.Vector3;
}

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');

function tintUnderwater(mat: THREE.Material): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWaterTint = { value: WATER_TINT };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vUwY;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvUwY = (modelMatrix * vec4(transformed, 1.0)).y;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vUwY;\nuniform vec3 uWaterTint;')
      .replace(
        '#include <fog_fragment>',
        `float uwD = max(0.0, -vUwY);
        float uwK = 1.0 - exp(-uwD * 0.075);
        gl_FragColor.rgb = mix(gl_FragColor.rgb * mix(1.0, 0.55, step(0.001, uwD)), uWaterTint, uwK);
        #include <fog_fragment>`,
      );
  };
  mat.needsUpdate = true;
}

/** Low-poly stand-in used if the GLB cannot be loaded. */
function fallbackShark(): { model: THREE.Group; mouth: THREE.Object3D; jawPivot: THREE.Object3D } {
  const model = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0x5b6670, roughness: 0.7 });
  const belly = new THREE.MeshStandardMaterial({ color: 0xd9d4c8, roughness: 0.8 });
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    pts.push(new THREE.Vector2(Math.sin(Math.PI * Math.pow(t, 0.8)) * 1.9 * (1 - t * 0.5) + 0.02, (t - 0.5) * 16));
  }
  const body = new THREE.Mesh(new THREE.LatheGeometry(pts, 20), skin);
  body.rotation.x = -Math.PI / 2;
  model.add(body);
  const fin = new THREE.Mesh(new THREE.ConeGeometry(0.9, 2.8, 4), skin);
  fin.position.set(0, 2.2, 0.5);
  fin.scale.set(0.3, 1, 1);
  model.add(fin);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.8, 4, 4), skin);
  tail.position.set(0, 1.4, -7.6);
  tail.rotation.x = -0.6;
  tail.scale.set(0.2, 1, 1);
  model.add(tail);
  const jawPivot = new THREE.Group();
  jawPivot.position.set(0, -0.5, 5.5);
  const jaw = new THREE.Mesh(new THREE.ConeGeometry(1.3, 3, 12, 1, true), belly);
  jaw.rotation.x = Math.PI / 2;
  jaw.position.z = 1.3;
  jaw.scale.set(1, 1, 0.45);
  jawPivot.add(jaw);
  model.add(jawPivot);
  const mouth = new THREE.Object3D();
  mouth.position.set(0, 0, 7.4);
  model.add(mouth);
  model.scale.setScalar(SHARK_LENGTH / 16);
  return { model, mouth, jawPivot };
}

function findClip(clips: THREE.AnimationClip[], name: string): THREE.AnimationClip | null {
  const n = name.toLowerCase();
  return clips.find((c) => c.name.toLowerCase() === n) ?? clips.find((c) => c.name.toLowerCase().includes(n)) ?? null;
}

export class Sharks {
  readonly group = new THREE.Group();
  readonly sharks: Shark[] = [];
  private hunter: Shark | null = null;
  private readonly rand = rng(31);
  private readonly centre: THREE.Vector3;
  private readonly spread: number;
  ready = false;
  usedFallback = false;
  /** splash requests for the game's particle system */
  readonly splashes: { at: THREE.Vector3; scale: number }[] = [];

  constructor(centre: THREE.Vector3, spread: number) {
    this.centre = centre.clone();
    this.spread = spread;
  }

  async load(url: string, count: number): Promise<void> {
    let template: THREE.Object3D | null = null;
    let clips: THREE.AnimationClip[] = [];
    try {
      const gltf = await new GLTFLoader().loadAsync(url);
      template = gltf.scene;
      clips = gltf.animations;
    } catch {
      this.usedFallback = true;
    }
    for (let i = 0; i < count; i++) this.spawn(template, clips, i);
    this.ready = true;
  }

  private spawn(template: THREE.Object3D | null, clips: THREE.AnimationClip[], i: number): void {
    const root = new THREE.Group();
    let mouth: THREE.Object3D;
    let mixer: THREE.AnimationMixer | null = null;
    let swim: THREE.AnimationAction | null = null;
    let jaw: THREE.AnimationAction | null = null;
    let jawPivot: THREE.Object3D | null = null;
    if (template) {
      const model = SkeletonUtils.clone(template);
      model.updateMatrixWorld(true); // skinned bounds need current bone matrices
      // normalise: nose along +Z, centred, scaled to SHARK_LENGTH
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const s = SHARK_LENGTH / Math.max(size.z, 0.01);
      const holder = new THREE.Group();
      const c = box.getCenter(new THREE.Vector3());
      model.position.set(-c.x, -c.y, -c.z);
      holder.add(model);
      holder.scale.setScalar(s);
      root.add(holder);
      mouth = model.getObjectByName('MouthPoint') ?? new THREE.Object3D();
      if (!mouth.parent) {
        mouth.position.set(0, 0, box.max.z);
        model.add(mouth);
      }
      model.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.frustumCulled = false;
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          const cloned = mats.map((m) => {
            const mm = m.clone();
            tintUnderwater(mm);
            return mm;
          });
          o.material = Array.isArray(o.material) ? cloned : cloned[0];
        }
      });
      mixer = new THREE.AnimationMixer(model);
      const swimClip = findClip(clips, 'Swim');
      const jawClip = findClip(clips, 'JawOpen');
      if (swimClip) {
        swim = mixer.clipAction(swimClip);
        swim.play();
        swim.time = this.rand() * swimClip.duration;
      }
      if (jawClip) {
        jaw = mixer.clipAction(jawClip);
        jaw.setLoop(THREE.LoopOnce, 1);
        jaw.clampWhenFinished = true;
        jaw.play();
        jaw.paused = true;
        jaw.time = 0;
      }
    } else {
      const fb = fallbackShark();
      fb.model.traverse((o) => {
        if (o instanceof THREE.Mesh) tintUnderwater(o.material as THREE.Material);
      });
      root.add(fb.model);
      mouth = fb.mouth;
      jawPivot = fb.jawPivot;
    }
    this.group.add(root);
    const a = this.rand() * Math.PI * 2;
    const d = 150 + this.rand() * this.spread;
    const shark: Shark = {
      root,
      mixer,
      swim,
      jaw,
      jawPivot,
      mouth,
      state: 'idle',
      pos: new THREE.Vector3(),
      yaw: 0,
      pitch: 0,
      roll: 0,
      speed: 8,
      jawOpen: 0,
      timer: 0,
      riseFrom: null,
      riseT0: RISE_TIME,
      wander: {
        cx: this.centre.x + Math.cos(a) * d,
        cz: this.centre.z + Math.sin(a) * d,
        r: 60 + this.rand() * 140,
        phase: this.rand() * Math.PI * 2,
        // some cruise with the fin out, others lurk deeper
        depth: i % 2 === 0 ? -2.6 : -7 - this.rand() * 6,
        dir: this.rand() < 0.5 ? -1 : 1,
        rate: 0,
      },
    };
    shark.wander.rate = (7 + this.rand() * 4) / shark.wander.r;
    this.idlePose(shark, 0);
    this.sharks.push(shark);
  }

  private idlePose(sh: Shark, time: number): void {
    const w = sh.wander;
    const ang = w.phase + time * w.rate * w.dir;
    const x = w.cx + Math.cos(ang) * w.r;
    const z = w.cz + Math.sin(ang) * w.r * 0.7;
    const y = w.depth + Math.sin(time * 0.3 + w.phase) * 0.6;
    sh.pos.set(x, y, z);
  }

  /** World position of the open mouth. */
  mouthPosition(out: THREE.Vector3): THREE.Vector3 {
    const sh = this.hunter;
    if (!sh) return out.set(0, -1000, 0);
    return sh.mouth.getWorldPosition(out);
  }

  get hunting(): boolean {
    return this.hunter !== null && this.hunter.state === 'hunt';
  }

  /** MouthPoint in the shark's local (unscaled root) frame, from last frame's pose. */
  private mouthLocal(sh: Shark, out: THREE.Vector3): THREE.Vector3 {
    sh.root.updateMatrixWorld(true);
    sh.mouth.getWorldPosition(out);
    return sh.root.worldToLocal(out);
  }

  startHunt(point: THREE.Vector3, timeLeft = Infinity): void {
    if (this.hunter && this.hunter.state === 'hunt') return;
    let best: Shark | null = null;
    let bd = Infinity;
    for (const sh of this.sharks) {
      if (sh.state !== 'idle') continue;
      const d = (sh.pos.x - point.x) ** 2 + (sh.pos.z - point.z) ** 2;
      if (d < bd) {
        bd = d;
        best = sh;
      }
    }
    if (!best) best = this.sharks[0] ?? null;
    if (!best) return;
    // too far to make it in time: reposition unseen in the deep, murky water near the impact point
    const reach = HUNT_SPEED * Math.max(0, timeLeft - RISE_TIME) + 60;
    if (Math.hypot(best.pos.x - point.x, best.pos.z - point.z) > reach) {
      const a = this.rand() * Math.PI * 2;
      best.pos.set(point.x + Math.cos(a) * 45, -40, point.z + Math.sin(a) * 45);
    }
    best.state = 'hunt';
    best.timer = 0;
    best.riseFrom = null;
    this.hunter = best;
  }

  cancelHunt(): void {
    if (this.hunter && this.hunter.state === 'hunt') this.hunter.state = 'dive';
  }

  /** Jaws snap shut; returns the mouth position. */
  chomp(): void {
    const sh = this.hunter;
    if (!sh) return;
    sh.state = 'eat';
    sh.timer = 0;
  }

  resetAll(time: number): void {
    for (const sh of this.sharks) {
      sh.state = 'idle';
      sh.jawOpen = 0;
      sh.pitch = 0;
      sh.roll = 0;
      this.idlePose(sh, time);
    }
    this.hunter = null;
  }

  update(dt: number, time: number, hunt: HuntInfo | null): void {
    for (const sh of this.sharks) {
      sh.timer += dt;
      if (sh.state === 'idle') this.updateIdle(sh, dt, time);
      else if (sh.state === 'hunt') this.updateHunt(sh, dt, hunt);
      else if (sh.state === 'eat') this.updateEat(sh, dt);
      else this.updateDive(sh, dt, time);
      _e.set(-sh.pitch, sh.yaw, sh.roll, 'YXZ');
      sh.root.quaternion.setFromEuler(_e);
      sh.root.position.copy(sh.pos);
      const swimRate = sh.state === 'hunt' ? 1.8 : sh.state === 'idle' ? 0.8 : 1.3;
      if (sh.swim) sh.swim.timeScale = swimRate;
      if (sh.jaw) sh.jaw.time = sh.jawOpen * sh.jaw.getClip().duration * 0.999;
      if (sh.jawPivot) sh.jawPivot.rotation.x = sh.jawOpen * 0.9;
      sh.mixer?.update(dt);
    }
  }

  private face(sh: Shark, dir: THREE.Vector3, dt: number, rate: number): void {
    const yaw = Math.atan2(dir.x, dir.z);
    let dy = yaw - sh.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    const k = damp(rate, dt);
    sh.yaw += dy * k;
    sh.roll += (clamp(-dy * 1.2, -0.5, 0.5) - sh.roll) * k;
    const h = Math.hypot(dir.x, dir.z);
    const pitch = Math.atan2(dir.y, Math.max(h, 1e-4));
    sh.pitch += (pitch - sh.pitch) * k;
  }

  private updateIdle(sh: Shark, dt: number, time: number): void {
    const prev = _w.copy(sh.pos);
    this.idlePose(sh, time);
    const dir = _v.copy(sh.pos).sub(prev);
    if (dir.lengthSq() > 1e-8) this.face(sh, dir, dt, 3);
    sh.jawOpen += (0.08 + 0.08 * Math.sin(time * 0.7 + sh.wander.phase) - sh.jawOpen) * damp(2, dt);
  }

  private updateHunt(sh: Shark, dt: number, hunt: HuntInfo | null): void {
    if (!hunt) return;
    const P = hunt.point;
    const T = Math.max(0, hunt.timeLeft);
    if (T > RISE_TIME) {
      // stalk deep under the impact point, then come up and wait there with the jaws open
      sh.riseFrom = null;
      const waiting = T < RISE_TIME + WAIT_TIME;
      const target = _v.set(P.x, waiting ? -11 : -26, P.z);
      const toT = _w.copy(target).sub(sh.pos);
      const dist = toT.length();
      if (dist > HUNT_SPEED * Math.max(0, T - RISE_TIME) + 90) {
        // reposition out of sight (deep, murky water hides the jump)
        const a = Math.atan2(sh.pos.z - P.z, sh.pos.x - P.x) + (this.rand() - 0.5);
        const r = Math.min(160, 30 + HUNT_SPEED * Math.max(0, T - RISE_TIME) * 0.6);
        sh.pos.set(P.x + Math.cos(a) * r, -34, P.z + Math.sin(a) * r);
      } else {
        const sp = Math.min(HUNT_SPEED, dist / Math.max(0.4, T - RISE_TIME * 0.8));
        if (dist > 1) sh.pos.addScaledVector(toT, (sp * dt) / dist);
        if (!waiting && dist < 25) {
          // circle tightly when already underneath
          sh.pos.x += Math.cos(sh.timer * 1.3) * 6 * dt;
          sh.pos.z += Math.sin(sh.timer * 1.3) * 6 * dt;
        }
        if (dist > 3) this.face(sh, toT, dt, 2.5);
        if (waiting) {
          // nose tilting up towards the falling prey
          sh.pitch += (lerp(0.2, 0.55, smoothstep(12, 2, dist)) - sh.pitch) * damp(1.5, dt);
          sh.roll += (0 - sh.roll) * damp(2, dt);
        }
      }
      sh.jawOpen += ((waiting ? 0.8 : 0.25) - sh.jawOpen) * damp(waiting ? 3 : 2, dt);
      return;
    }
    // rise: nose up, jaws wide, mouth arrives at the surface together with the rider
    const local = this.mouthLocal(sh, _w);
    _e.set(-sh.pitch, sh.yaw, sh.roll, 'YXZ');
    const off = local.applyEuler(_e);
    const cur = _v.copy(sh.pos).add(off);
    if (sh.riseFrom === null) {
      sh.riseFrom = Math.min(cur.y, 0);
      sh.riseT0 = Math.max(T, 0.3);
    }
    const k = clamp(1 - T / sh.riseT0, 0, 1);
    const e = smoothstep(0, 1, k);
    const pitchT = lerp(0.45, 1.3, smoothstep(0, 0.55, k));
    sh.pitch += (pitchT - sh.pitch) * damp(5, dt);
    sh.roll += (0 - sh.roll) * damp(4, dt);
    const kk = damp(3 + k * 12, dt);
    cur.x = lerp(cur.x, P.x, kk);
    cur.z = lerp(cur.z, P.z, kk);
    cur.y = lerp(sh.riseFrom, 3.2, e);
    // solve for the body pivot so that the (rotated) mouth lands on the target
    sh.pos.copy(cur).sub(off);
    sh.jawOpen += (1 - sh.jawOpen) * damp(4 + k * 6, dt);
  }

  private updateEat(sh: Shark, dt: number): void {
    // lunge a touch higher, snap shut, then fall back with a huge splash
    sh.jawOpen += (0 - sh.jawOpen) * damp(18, dt);
    if (sh.timer < 0.5) sh.pos.y += 6 * dt;
    else {
      sh.pos.y -= (sh.timer - 0.5) * 18 * dt;
      sh.pitch += (0.2 - sh.pitch) * damp(1.2, dt);
    }
    if (sh.timer > 0.7 && sh.timer - dt <= 0.7) this.splashes.push({ at: sh.pos.clone().setY(0), scale: 1.6 });
    if (sh.timer > 4) {
      sh.state = 'dive';
      sh.timer = 0;
    }
  }

  private updateDive(sh: Shark, dt: number, time: number): void {
    // sink back and melt into the idle loop
    const prev = _w.copy(sh.pos);
    this.idlePose(sh, time);
    const target = _v.copy(sh.pos);
    sh.pos.copy(prev).lerp(target, damp(0.8, dt));
    const remaining = sh.pos.distanceTo(target);
    const dir = target.sub(prev);
    if (dir.lengthSq() > 1e-6) this.face(sh, dir, dt, 1.5);
    sh.jawOpen += (0.1 - sh.jawOpen) * damp(3, dt);
    if (sh.timer > 6 || remaining < 2) {
      sh.state = 'idle';
      if (this.hunter === sh) this.hunter = null;
    }
  }
}
