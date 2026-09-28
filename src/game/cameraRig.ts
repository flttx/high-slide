import * as THREE from 'three';
import { clamp, damp, lerp, smoothstep } from '../core/math.ts';
import type { Rider } from '../physics/rider.ts';
import { makeFrame, type Track } from '../track/track.ts';

export interface RigInput {
  steer: number;
  throttle: number;
  lookYaw: number;
  lookPitch: number;
  /** world point the head is drawn towards (shark mouth), with weight 0..1 */
  lookAt: THREE.Vector3 | null;
  lookAtWeight: number;
  /** extra FOV (deg) for dramatic moments */
  fovBoost: number;
}

const UP = new THREE.Vector3(0, 1, 0);
const SKIN = 0xe3ae8a;

/**
 * First-person rider: a body that follows the slide / flight, a head with free look,
 * visible legs and arms, speed-dependent FOV and layered camera shake.
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  readonly body = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly legs: THREE.Group[] = [];
  private readonly knees: THREE.Group[] = [];
  private readonly arms: THREE.Group[] = [];
  private readonly q = new THREE.Quaternion();
  private readonly qTarget = new THREE.Quaternion();
  private readonly m = new THREE.Matrix4();
  private readonly f = new THREE.Vector3();
  private readonly u = new THREE.Vector3();
  private readonly r = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly ahead = makeFrame();
  private readonly eye = new THREE.Vector3();
  private impulse = 0;
  private fovKick = 0;
  private airBlend = 0;
  private lift = 0;
  private roll = 0;
  private initialised = false;
  baseFov = 74;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(this.baseFov, aspect, 0.12, 60000);
    this.head.position.set(0, 0.58, 0.32);
    this.head.add(this.camera);
    this.body.add(this.head);
    this.buildBody();
  }

  private buildBody(): void {
    const skin = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.6 });
    const trunks = new THREE.MeshStandardMaterial({ color: 0xff3b5c, roughness: 0.7 });
    const band = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
    const hips = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.16, 4, 12), trunks);
    hips.rotation.z = Math.PI / 2;
    hips.position.set(0, 0.05, 0.02);
    this.body.add(hips);
    // reclined against the slide: hips forward, chest rising back towards the head
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.2, 4, 12), skin);
    torso.position.set(0, 0.17, 0.12);
    torso.rotation.x = 0.5;
    this.body.add(torso);
    for (const sx of [-1, 1]) {
      // legs: thigh in trunks, then bare shin + foot, pointing down the slide (-z)
      const leg = new THREE.Group();
      leg.position.set(sx * 0.1, 0.05, -0.02);
      const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.28, 4, 10), trunks);
      thigh.rotation.x = Math.PI / 2;
      thigh.position.z = -0.2;
      leg.add(thigh);
      const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.088, 0.088, 0.03, 12), band);
      stripe.rotation.x = Math.PI / 2;
      stripe.position.z = -0.38;
      leg.add(stripe);
      const knee = new THREE.Group();
      knee.position.z = -0.41;
      leg.add(knee);
      this.knees.push(knee);
      const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.068, 0.46, 4, 10), skin);
      shin.rotation.x = Math.PI / 2;
      shin.position.z = -0.29;
      knee.add(shin);
      const foot = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.14, 4, 8), skin);
      foot.position.set(0, 0.07, -0.57);
      foot.rotation.x = -0.25;
      knee.add(foot);
      this.body.add(leg);
      this.legs.push(leg);

      const arm = new THREE.Group();
      arm.position.set(sx * 0.19, 0.34, 0.2);
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.052, 0.26, 4, 8), skin);
      upper.position.set(0, -0.17, 0);
      arm.add(upper);
      const lower = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.24, 4, 8), skin);
      lower.position.set(0, -0.44, -0.04);
      arm.add(lower);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.058, 10, 8), skin);
      hand.scale.set(0.8, 1.2, 0.5);
      hand.position.set(0, -0.62, -0.05);
      arm.add(hand);
      this.body.add(arm);
      this.arms.push(arm);
    }
    this.body.traverse((o) => {
      if (o instanceof THREE.Mesh) o.frustumCulled = false;
    });
  }

  /** Landing / impact thump (0..1+). */
  kick(amount: number): void {
    this.impulse = Math.min(1.5, this.impulse + amount);
    this.fovKick = Math.max(this.fovKick, amount * 5);
  }

  /** Snap orientation next frame (after respawn). */
  reset(): void {
    this.initialised = false;
    this.impulse = 0;
    this.fovKick = 0;
    this.airBlend = 0;
    this.lift = 0;
    this.roll = 0;
  }

  getEye(out: THREE.Vector3): THREE.Vector3 {
    return this.camera.getWorldPosition(out);
  }

  update(dt: number, time: number, rider: Rider, track: Track, inp: RigInput): void {
    const onTrack = rider.mode === 'track' || rider.mode === 'done';
    this.airBlend += ((onTrack ? 0 : 1) - this.airBlend) * damp(onTrack ? 9 : 3, dt);
    const speed = rider.vel.length();
    const f = this.f;
    const u = this.u;
    if (onTrack) {
      const fr = rider.frame;
      // look slightly ahead along the slide so turns are anticipated
      const seg = track.segments[rider.seg];
      const sA = Math.min(seg.length, rider.s + clamp(rider.v * 0.45, 4, 26));
      track.frameAt(rider.seg, sA, this.ahead);
      f.copy(fr.t).lerp(this.ahead.t, 0.45).normalize();
      rider.innerNormal(u);
      u.lerp(UP, 0.15);
    } else {
      // free fall: gaze follows the flight path, drifting down as you drop
      this.tmp.copy(rider.vel).normalize();
      f.copy(rider.heading).lerp(this.tmp, 0.6).normalize();
      u.copy(UP);
    }
    if (inp.lookAt && inp.lookAtWeight > 0) {
      this.tmp.copy(inp.lookAt).sub(rider.pos).normalize();
      f.lerp(this.tmp, inp.lookAtWeight).normalize();
      u.lerp(UP, inp.lookAtWeight);
    }
    if (!onTrack) {
      // looking steeply down in free fall: screen-up follows the direction of travel
      const steep = smoothstep(0.6, 0.97, -f.y);
      if (steep > 0) u.lerp(rider.heading, steep).normalize();
    }
    // orthonormalise: right = f x u, up = right x f
    const r = this.r.crossVectors(f, u);
    if (r.lengthSq() < 1e-6) r.set(1, 0, 0);
    r.normalize();
    u.crossVectors(r, f).normalize();
    this.tmp.copy(f).negate();
    this.m.makeBasis(r, u, this.tmp);
    this.qTarget.setFromRotationMatrix(this.m);
    // lean into steering (a little on the slide, more like a sky-diver in the air)
    const rollT = -inp.steer * lerp(0.07, 0.32, this.airBlend);
    this.roll += (rollT - this.roll) * damp(6, dt);
    this.qTarget.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), this.roll));
    if (!this.initialised) {
      this.q.copy(this.qTarget);
      this.initialised = true;
    } else {
      const rate = onTrack ? 16 : inp.lookAtWeight > 0 ? 3.5 : 4;
      this.q.slerp(this.qTarget, damp(rate, dt));
    }
    this.body.quaternion.copy(this.q);

    // weightlessness on crests lifts you off the seat; heavy compressions push you down
    const g = onTrack ? rider.gForce : 0;
    const liftT = onTrack ? clamp((0.75 - g) * 0.12, -0.08, 0.1) : 0.06;
    this.lift += (liftT - this.lift) * damp(10, dt);
    this.body.position.copy(rider.pos).addScaledVector(u, this.lift);

    // --- shake ---
    this.impulse *= Math.exp(-dt * 5);
    const sp = clamp(speed / 60, 0, 1.6);
    const rough = onTrack ? 0.0025 + sp * sp * 0.006 : 0.0015 + sp * sp * 0.004;
    const amp = rough + this.impulse * 0.05;
    const n = (a: number, b: number) => Math.sin(time * a) * 0.6 + Math.sin(time * b + 1.7) * 0.4;
    const baseDown = lerp(-0.2, -0.28, this.airBlend);
    this.head.rotation.set(
      baseDown + inp.lookPitch * (1 - inp.lookAtWeight * 0.7) + n(37, 61) * amp - this.impulse * 0.04,
      inp.lookYaw * (1 - inp.lookAtWeight * 0.7) + n(29, 53) * amp,
      n(23, 47) * amp * 0.6,
      'YXZ',
    );
    this.head.position.set(0, 0.58 - this.impulse * 0.05, 0.32);

    // limbs: gripping the slide vs flailing in the air
    const air = this.airBlend;
    const fall = smoothstep(0.25, 1.4, rider.airTime);
    for (let i = 0; i < 2; i++) {
      const sx = i === 0 ? -1 : 1;
      const ph = rider.airTime * 3.4 + i * 1.2;
      const leg = this.legs[i];
      leg.rotation.set(
        lerp(0.02 * Math.sin(time * 31 + i) * sp, lerp(0.28, 0.14, fall) + 0.06 * Math.sin(ph), air) - inp.throttle * 0.08 * (1 - air),
        // Legs point along -Z: opposite yaw signs keep each foot outside its hip.
        -sx * lerp(0.13, 0.28, fall) * air,
        0,
      );
      // Tuck on takeoff, then relax the knees into a separated falling pose.
      this.knees[i].rotation.x = -(lerp(0.38, 0.2, fall) + 0.06 * Math.sin(ph + 0.5)) * air;
      const arm = this.arms[i];
      arm.rotation.set(
        lerp(0.55 - inp.throttle * 0.35, 0.3 + 0.4 * Math.sin(ph * 1.2), air),
        0,
        lerp(sx * 0.35 + (sx === Math.sign(inp.steer) ? 0.1 : -0.05) * Math.abs(inp.steer), sx * (1.5 + 0.35 * Math.sin(ph + 1)), air),
      );
    }

    // --- FOV: speed, tuck, falling, drama ---
    this.fovKick *= Math.exp(-dt * 4);
    const fov =
      this.baseFov +
      clamp((speed - 12) / 50, 0, 1) * 18 +
      Math.max(0, inp.throttle) * 3 * (1 - air) +
      air * 6 +
      inp.fovBoost -
      this.fovKick;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov += (fov - this.camera.fov) * damp(4, dt);
      this.camera.updateProjectionMatrix();
    }
    this.body.updateMatrixWorld(true);
    this.camera.getWorldPosition(this.eye);
  }

  get eyePosition(): THREE.Vector3 {
    return this.eye;
  }
}
