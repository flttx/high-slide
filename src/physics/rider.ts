import { Vector3 } from 'three';
import { GRAVITY, PHYS, SEA_LEVEL } from '../core/config.ts';
import { clamp } from '../core/math.ts';
import { makeFrame, type Frame, type LandingHit, type Track } from '../track/track.ts';
import { airStep } from './air.ts';

export type RiderMode = 'track' | 'air' | 'sea' | 'done';

export interface RiderInput {
  steer: number;
  throttle: number;
}

export type RiderEvent =
  | { type: 'takeoff'; reason: 'gap' | 'flyoff' | 'liftoff'; seg: number }
  | { type: 'land'; seg: number; impact: number }
  | { type: 'sea' }
  | { type: 'finish' };

export interface Prediction {
  kind: 'land' | 'sea' | 'none';
  t: number;
  point: Vector3;
  seg: number;
  s: number;
  x: number;
}

const G = new Vector3(0, -GRAVITY, 0);

export class Rider {
  mode: RiderMode = 'track';
  seg = 0;
  s = 0;
  v = 0;
  theta = 0;
  omega = 0;
  /** hip position (world) */
  pos = new Vector3();
  vel = new Vector3();
  heading = new Vector3(0, 0, 1);
  gForce = 1;
  lateralG = 0;
  airTime = 0;
  trackTime = 0;
  landingGrace = 0;
  graceSeg = -1;
  gravityScale = 1;
  finished = false;
  frame: Frame = makeFrame();
  events: RiderEvent[] = [];

  private readonly track: Track;
  private readonly _F = new Vector3();
  private readonly _d = new Vector3();
  private readonly _nIn = new Vector3();
  private readonly _prev = new Vector3();
  private readonly _hit: LandingHit = { seg: 0, s: 0, x: 0 };

  constructor(track: Track) {
    this.track = track;
  }

  place(seg: number, s: number, speed: number): void {
    this.mode = 'track';
    this.seg = seg;
    this.s = s;
    this.v = speed;
    this.theta = 0;
    this.omega = 0;
    this.airTime = 0;
    this.trackTime = 0;
    this.landingGrace = 0;
    this.gravityScale = 1;
    this.finished = false;
    this.events.length = 0;
    this.syncTrackPose();
  }

  /** Inward normal of the pipe at the rider's lateral position. */
  innerNormal(out: Vector3): Vector3 {
    const f = this.frame;
    return out.copy(f.n).multiplyScalar(Math.cos(this.theta)).addScaledVector(f.b, -Math.sin(this.theta));
  }

  private syncTrackPose(): void {
    const f = this.track.frameAt(this.seg, this.s, this.frame);
    this.track.surfacePoint(f, this.theta, this.pos);
    this.innerNormal(this._nIn);
    this.pos.addScaledVector(this._nIn, PHYS.bodyOffset);
    this._d.copy(f.b).multiplyScalar(Math.cos(this.theta)).addScaledVector(f.n, Math.sin(this.theta));
    this.vel.copy(f.t).multiplyScalar(this.v).addScaledVector(this._d, f.r * this.omega);
    this.heading.set(f.t.x, 0, f.t.z).normalize();
  }

  step(dt: number, input: RiderInput): void {
    if (this.mode === 'track') this.stepTrack(dt, input);
    else if (this.mode === 'air') this.stepAir(dt, input);
  }

  private takeoff(reason: 'gap' | 'flyoff' | 'liftoff'): void {
    this.mode = 'air';
    this.airTime = 0;
    this.landingGrace = reason === 'gap' ? 0 : 0.14;
    this.graceSeg = this.seg;
    this.events.push({ type: 'takeoff', reason, seg: this.seg });
  }

  private stepTrack(dt: number, input: RiderInput): void {
    const track = this.track;
    const f = track.frameAt(this.seg, this.s, this.frame);
    const R = f.r;
    const v = this.v;
    const F = this._F.copy(G).addScaledVector(f.k, -v * v);
    const th = this.theta;
    const d = this._d.copy(f.b).multiplyScalar(Math.cos(th)).addScaledVector(f.n, Math.sin(th));
    const nIn = this.innerNormal(this._nIn);
    const normal = R * this.omega * this.omega - F.dot(nIn);
    this.gForce = normal / GRAVITY;
    this.lateralG = F.dot(d) / GRAVITY;

    const tuck = Math.max(0, input.throttle);
    const brake = Math.max(0, -input.throttle);
    const isFinal = this.seg === track.segments.length - 1;
    const seg = track.segments[this.seg];
    const autoBrake = isFinal && this.s > seg.length - 150 ? 1 : 0;
    const mu = PHYS.mu + PHYS.muBrake * Math.max(brake, autoBrake * 3);
    const c = PHYS.drag + (PHYS.dragTuck - PHYS.drag) * tuck + (PHYS.dragBrake - PHYS.drag) * brake;
    const lateralV = R * this.omega;
    const fric = mu * Math.max(normal, 0);
    let a = G.dot(f.t) - fric - c * v * v;
    // lateral scrubbing slows you a little too
    a -= 0.02 * lateralV * lateralV;
    this.v = v + a * dt;
    const minV = autoBrake ? 0 : PHYS.minSpeed;
    if (this.v < minV) this.v += (minV - this.v) * Math.min(1, dt * 2);
    if (this.v < 0) this.v = 0;

    const steerA = input.steer * PHYS.steerAccel;
    const alpha = (F.dot(d) + steerA) / R - PHYS.lateralDamping * this.omega - 0.5 * fric * Math.sign(this.omega) * Math.min(1, Math.abs(this.omega) * 4) / R;
    this.omega += alpha * dt;
    this.theta += this.omega * dt;
    this.s += this.v * dt;
    this.trackTime += dt;

    if (Math.abs(this.theta) > PHYS.lipAngle) {
      this.theta = clamp(this.theta, -PHYS.lipAngle, PHYS.lipAngle);
      this.syncTrackPose();
      this.takeoff('flyoff');
      return;
    }
    if (this.s >= seg.length) {
      if (seg.gap) {
        this.s = seg.length;
        this.syncTrackPose();
        this.takeoff('gap');
        return;
      }
      this.s = seg.length;
      this.v = 0;
      this.mode = 'done';
      this.syncTrackPose();
      return;
    }
    this.syncTrackPose();
    if (isFinal && !this.finished && this.s >= track.finishS) {
      this.finished = true;
      this.events.push({ type: 'finish' });
    }
    if (normal < PHYS.liftoffNormal && this.trackTime > 0.3) {
      this.takeoff('liftoff');
    }
  }

  private stepAir(dt: number, input: RiderInput): void {
    this._prev.copy(this.pos);
    airStep(this.pos, this.vel, input.steer, input.throttle, dt, this.heading, this.gravityScale);
    this.airTime += dt;
    this.gForce = 0;
    this.lateralG = 0;
    if (this.landingGrace > 0) this.landingGrace -= dt;
    const skip = this.landingGrace > 0 ? this.graceSeg : -1;
    const hit = this._hit;
    if (this.track.checkLanding(this._prev, this.pos, hit, skip)) {
      this.land(hit);
      return;
    }
    if (this.pos.y <= SEA_LEVEL + 0.5) {
      this.mode = 'sea';
      this.events.push({ type: 'sea' });
    }
  }

  private land(hit: LandingHit): void {
    const f = this.track.frameAt(hit.seg, hit.s, this.frame);
    const R = f.r;
    const theta = Math.asin(clamp(hit.x / R, -1, 1));
    const d = this._d.copy(f.b).multiplyScalar(Math.cos(theta)).addScaledVector(f.n, Math.sin(theta));
    const nIn = this._nIn.copy(f.n).multiplyScalar(Math.cos(theta)).addScaledVector(f.b, -Math.sin(theta));
    const impact = Math.max(0, -this.vel.dot(nIn));
    this.seg = hit.seg;
    this.s = hit.s;
    this.theta = theta;
    this.omega = (this.vel.dot(d) / R) * 0.45;
    this.v = Math.max(PHYS.minSpeed, this.vel.dot(f.t));
    this.mode = 'track';
    this.trackTime = 0;
    this.events.push({ type: 'land', seg: hit.seg, impact });
    this.syncTrackPose();
  }

  private readonly _pp = new Vector3();
  private readonly _pv = new Vector3();
  private readonly _ph = new Vector3();
  private readonly _pprev = new Vector3();

  /** Ballistic look-ahead with constant control. */
  predict(steer: number, throttle: number, maxT: number, dt: number, out: Prediction): Prediction {
    const p = this._pp.copy(this.pos);
    const v = this._pv.copy(this.vel);
    const h = this._ph.copy(this.heading);
    const prev = this._pprev;
    const hit = this._hit;
    let t = 0;
    let grace = this.landingGrace;
    out.kind = 'none';
    while (t < maxT) {
      prev.copy(p);
      airStep(p, v, steer, throttle, dt, h, this.gravityScale);
      t += dt;
      grace -= dt;
      if (this.track.checkLanding(prev, p, hit, grace > 0 ? this.graceSeg : -1)) {
        out.kind = 'land';
        out.t = t;
        out.point.copy(p);
        out.seg = hit.seg;
        out.s = hit.s;
        out.x = hit.x;
        return out;
      }
      if (p.y <= SEA_LEVEL + 0.5) {
        out.kind = 'sea';
        out.t = t;
        out.point.copy(p);
        return out;
      }
    }
    out.t = maxT;
    out.point.copy(p);
    return out;
  }

  /** True if no constant-control strategy lets the rider reach a slide again. */
  isDoomed(scratch: Prediction): boolean {
    for (let st = -1; st <= 1; st++)
      for (let th = -1; th <= 1; th++) {
        this.predict(st, th, 16, 1 / 30, scratch);
        if (scratch.kind !== 'sea') return false;
      }
    return true;
  }
}

export function makePrediction(): Prediction {
  return { kind: 'none', t: 0, point: new Vector3(), seg: -1, s: 0, x: 0 };
}
