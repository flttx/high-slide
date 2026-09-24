import { Vector3 } from 'three';
import { GRAVITY, PHYS } from '../core/config.ts';
import { DEG, clamp, lerp, smoothstep } from '../core/math.ts';
import { airStep } from '../physics/air.ts';
import type { GapDef, LevelDef, SegmentDef } from './level.ts';

export const DS = 1; // sample spacing (m)
const CATCH_LEN = 46;
const CATCH_BACK = 8;
const GAP_WINDOW = 0.8;
const MAX_BANK = 68 * DEG;
/** Turns are banked for a slower rider so real speed pushes you up the outer wall. */
const BANK_SPEED = 0.9;

export interface Frame {
  p: Vector3;
  t: Vector3;
  n: Vector3;
  b: Vector3;
  k: Vector3;
  r: number;
  vd: number;
}

export function makeFrame(): Frame {
  return { p: new Vector3(), t: new Vector3(), n: new Vector3(), b: new Vector3(), k: new Vector3(), r: 4, vd: 0 };
}

export interface GapInfo extends GapDef {
  /** Designed flight (world points, 20 Hz) including the lateral correction. */
  ghost: Vector3[];
  /** Constant steer needed to follow the ghost. */
  steer: number;
  exitSpeed: number;
}

export interface Segment {
  index: number;
  count: number;
  length: number;
  pos: Float64Array;
  tan: Float64Array;
  nrm: Float64Array;
  bin: Float64Array;
  curv: Float64Array;
  radius: Float64Array;
  vd: Float64Array;
  bank: Float64Array;
  isCatch: boolean;
  gap?: GapInfo;
  min: Vector3;
  max: Vector3;
}

export interface LandingHit {
  seg: number;
  s: number;
  x: number;
}

const UP = new Vector3(0, 1, 0);
const G = new Vector3(0, -GRAVITY, 0);

function dirFrom(yaw: number, pitch: number, out: Vector3): Vector3 {
  const cp = Math.cos(pitch);
  return out.set(Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp);
}

interface Pose {
  pos: Vector3;
  yaw: number;
  pitch: number;
}

function set3(a: Float64Array, i: number, v: Vector3): void {
  a[i * 3] = v.x;
  a[i * 3 + 1] = v.y;
  a[i * 3 + 2] = v.z;
}

export function get3(a: Float64Array, i: number, out: Vector3): Vector3 {
  return out.set(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]);
}

function buildSegment(index: number, def: SegmentDef, pose: Pose, vIn: number, isCatch: boolean): Segment {
  const pieces = isCatch ? [{ len: CATCH_LEN, pitch: pose.pitch / DEG }, ...def.pieces] : def.pieces;
  // 1. integrate the centreline
  const pts: Vector3[] = [];
  const tans: Vector3[] = [];
  let yaw = pose.yaw;
  let pitch = pose.pitch;
  const p = pose.pos.clone();
  pts.push(p.clone());
  tans.push(dirFrom(yaw, pitch, new Vector3()));
  const d = new Vector3();
  for (const pc of pieces) {
    const n = Math.max(1, Math.round(pc.len / DS));
    const p0 = pitch;
    const p1 = pc.pitch !== undefined ? pc.pitch * DEG : pitch;
    const turn = (pc.turn ?? 0) * DEG;
    for (let j = 0; j < n; j++) {
      const t = (j + 1) / n;
      yaw -= turn * (Math.PI / 2) * Math.sin(Math.PI * (j + 0.5) / n) / n;
      pitch = lerp(p0, p1, smoothstep(0, 1, t));
      dirFrom(yaw, pitch, d);
      // midpoint integration keeps arc length ~= DS
      const dm = dirFrom(yaw, lerp(p0, p1, smoothstep(0, 1, (j + 0.5) / n)), new Vector3());
      p.addScaledVector(dm, DS);
      pts.push(p.clone());
      tans.push(d.clone());
    }
    pitch = p1;
  }
  const count = pts.length;
  const length = (count - 1) * DS;
  const seg: Segment = {
    index,
    count,
    length,
    pos: new Float64Array(count * 3),
    tan: new Float64Array(count * 3),
    nrm: new Float64Array(count * 3),
    bin: new Float64Array(count * 3),
    curv: new Float64Array(count * 3),
    radius: new Float64Array(count),
    vd: new Float64Array(count),
    bank: new Float64Array(count),
    isCatch,
    min: new Vector3(Infinity, Infinity, Infinity),
    max: new Vector3(-Infinity, -Infinity, -Infinity),
  };
  const K: Vector3[] = [];
  for (let i = 0; i < count; i++) {
    set3(seg.pos, i, pts[i]);
    set3(seg.tan, i, tans[i]);
    seg.min.min(pts[i]);
    seg.max.max(pts[i]);
    const a = tans[Math.max(0, i - 1)];
    const b = tans[Math.min(count - 1, i + 1)];
    const span = (Math.min(count - 1, i + 1) - Math.max(0, i - 1)) * DS;
    K.push(b.clone().sub(a).multiplyScalar(1 / span));
    set3(seg.curv, i, K[i]);
    const R = def.radius;
    seg.radius[i] = isCatch && def.catchRadius
      ? lerp(def.catchRadius, R, smoothstep(CATCH_LEN * 0.7, CATCH_LEN + 30, i * DS))
      : R;
  }
  // 2. design speed (neutral rider on the centreline)
  const F = new Vector3();
  let v = vIn;
  for (let i = 0; i < count; i++) {
    seg.vd[i] = v;
    F.copy(G).addScaledVector(K[i], -v * v);
    const ft = F.dot(tans[i]);
    const perp = F.clone().addScaledVector(tans[i], -ft).length();
    const a = G.dot(tans[i]) - PHYS.mu * perp - PHYS.drag * v * v;
    v = Math.sqrt(Math.max(v * v + 2 * a * DS, PHYS.minSpeed * PHYS.minSpeed));
  }
  // 3. heart-line banking at design speed
  const n0 = new Vector3();
  const side = new Vector3();
  const raw = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const t = tans[i];
    n0.copy(UP).addScaledVector(t, -UP.dot(t)).normalize();
    side.crossVectors(t, n0);
    const vv = seg.vd[i] * BANK_SPEED;
    F.copy(G).addScaledVector(K[i], -vv * vv).multiplyScalar(-1); // support force direction
    const a = F.dot(n0);
    const b = F.dot(side);
    raw[i] = clamp(Math.atan2(b, Math.max(a, 2)), -MAX_BANK, MAX_BANK);
  }
  const W = 14;
  for (let i = 0; i < count; i++) {
    let acc = 0;
    let wsum = 0;
    for (let j = -W; j <= W; j++) {
      const k = clamp(i + j, 0, count - 1);
      const w = W + 1 - Math.abs(j);
      acc += raw[k] * w;
      wsum += w;
    }
    const phi = acc / wsum;
    seg.bank[i] = phi;
    const t = tans[i];
    n0.copy(UP).addScaledVector(t, -UP.dot(t)).normalize();
    side.crossVectors(t, n0);
    const nn = n0.clone().multiplyScalar(Math.cos(phi)).addScaledVector(side, Math.sin(phi)).normalize();
    set3(seg.nrm, i, nn);
    set3(seg.bin, i, new Vector3().crossVectors(t, nn));
  }
  return seg;
}

function flyGap(seg: Segment, gap: GapDef): { info: GapInfo; next: Pose; vIn: number } {
  const last = seg.count - 1;
  const pos = get3(seg.pos, last, new Vector3()).addScaledVector(get3(seg.nrm, last, new Vector3()), PHYS.bodyOffset);
  const exitSpeed = seg.vd[last];
  const vel = get3(seg.tan, last, new Vector3()).multiplyScalar(exitSpeed);
  const steer = clamp((2 * gap.lateral) / (PHYS.airLateral * gap.time * gap.time), -1, 1);
  const heading = new Vector3(vel.x, 0, vel.z).normalize();
  const ghost: Vector3[] = [pos.clone()];
  const dt = 1 / 240;
  const tEnd = gap.time + 1.2;
  let p1: Vector3 | null = null;
  let p2: Vector3 | null = null;
  let v2 = new Vector3();
  let t = 0;
  let step = 0;
  while (t < tEnd) {
    airStep(pos, vel, t < gap.time ? steer : 0, 0, dt, heading);
    t += dt;
    step++;
    if (step % 12 === 0) ghost.push(pos.clone());
    if (!p1 && t >= gap.time - GAP_WINDOW) p1 = pos.clone();
    if (!p2 && t >= gap.time) {
      p2 = pos.clone();
      v2 = vel.clone();
    }
  }
  const a = p1 as Vector3;
  const b = p2 as Vector3;
  const dir = b.clone().sub(a).normalize();
  const start = a.clone().addScaledVector(dir, -CATCH_BACK);
  start.y -= gap.drop ?? 2.5;
  const next: Pose = {
    pos: start,
    yaw: Math.atan2(dir.x, dir.z),
    pitch: Math.asin(clamp(dir.y, -1, 1)),
  };
  return {
    info: { ...gap, ghost, steer, exitSpeed },
    next,
    vIn: Math.max(PHYS.minSpeed, v2.dot(dir) * 0.97),
  };
}

export class Track {
  segments: Segment[] = [];
  private hash = new Map<number, number[]>();
  private readonly cell = 12;

  constructor(def: LevelDef) {
    let pose: Pose = {
      pos: new Vector3(...def.start.pos),
      yaw: def.start.yaw * DEG,
      pitch: def.start.pitch * DEG,
    };
    let vIn = def.startSpeed;
    def.segments.forEach((sd, i) => {
      const seg = buildSegment(i, sd, pose, vIn, i > 0);
      this.segments.push(seg);
      if (sd.gap) {
        const g = flyGap(seg, sd.gap);
        seg.gap = g.info;
        pose = g.next;
        vIn = g.vIn;
      }
    });
    this.buildHash();
  }

  get last(): Segment {
    return this.segments[this.segments.length - 1];
  }

  /** Arc length on the final segment where the finish gate stands. */
  get finishS(): number {
    return this.last.length - 150;
  }

  private key(ix: number, iy: number, iz: number): number {
    return ((ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791)) | 0;
  }

  private buildHash(): void {
    for (const seg of this.segments) {
      for (let i = 0; i < seg.count; i++) {
        const k = this.key(
          Math.floor(seg.pos[i * 3] / this.cell),
          Math.floor(seg.pos[i * 3 + 1] / this.cell),
          Math.floor(seg.pos[i * 3 + 2] / this.cell),
        );
        let list = this.hash.get(k);
        if (!list) this.hash.set(k, (list = []));
        list.push(seg.index, i);
      }
    }
  }

  frameAt(segIndex: number, s: number, out: Frame): Frame {
    const seg = this.segments[segIndex];
    const u = clamp(s / DS, 0, seg.count - 1.0001);
    const i = Math.floor(u);
    const f = u - i;
    const j = i + 1;
    const A = seg.pos, T = seg.tan, N = seg.nrm, C = seg.curv;
    const i3 = i * 3, j3 = j * 3;
    out.p.set(lerp(A[i3], A[j3], f), lerp(A[i3 + 1], A[j3 + 1], f), lerp(A[i3 + 2], A[j3 + 2], f));
    out.t.set(lerp(T[i3], T[j3], f), lerp(T[i3 + 1], T[j3 + 1], f), lerp(T[i3 + 2], T[j3 + 2], f)).normalize();
    out.n.set(lerp(N[i3], N[j3], f), lerp(N[i3 + 1], N[j3 + 1], f), lerp(N[i3 + 2], N[j3 + 2], f));
    out.n.addScaledVector(out.t, -out.n.dot(out.t)).normalize();
    out.b.crossVectors(out.t, out.n);
    out.k.set(lerp(C[i3], C[j3], f), lerp(C[i3 + 1], C[j3 + 1], f), lerp(C[i3 + 2], C[j3 + 2], f));
    out.r = lerp(seg.radius[i], seg.radius[j], f);
    out.vd = lerp(seg.vd[i], seg.vd[j], f);
    return out;
  }

  /** Surface point of the pipe for lateral angle theta. */
  surfacePoint(f: Frame, theta: number, out: Vector3): Vector3 {
    return out
      .copy(f.p)
      .addScaledVector(f.b, f.r * Math.sin(theta))
      .addScaledVector(f.n, f.r * (1 - Math.cos(theta)));
  }

  private readonly _best = new Map<number, number>();
  private readonly _bestD = new Map<number, number>();
  private readonly _f = makeFrame();
  private readonly _rel = new Vector3();

  /**
   * Did the moving point prev->cur pass down through a slide surface? Returns the hit (the
   * earliest-segment match) or null.
   */
  checkLanding(prev: Vector3, cur: Vector3, out: LandingHit, skipSeg = -1): boolean {
    const c = this.cell;
    const cx = Math.floor(cur.x / c), cy = Math.floor(cur.y / c), cz = Math.floor(cur.z / c);
    const best = this._best;
    const bestD = this._bestD;
    best.clear();
    bestD.clear();
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const list = this.hash.get(this.key(cx + dx, cy + dy, cz + dz));
          if (!list) continue;
          for (let q = 0; q < list.length; q += 2) {
            const si = list[q];
            if (si === skipSeg) continue;
            const idx = list[q + 1];
            const P = this.segments[si].pos;
            const ex = P[idx * 3] - cur.x, ey = P[idx * 3 + 1] - cur.y, ez = P[idx * 3 + 2] - cur.z;
            const d2 = ex * ex + ey * ey + ez * ez;
            const bd = bestD.get(si);
            if (bd === undefined || d2 < bd) {
              bestD.set(si, d2);
              best.set(si, idx);
            }
          }
        }
    let found = false;
    for (const [si, idx] of best) {
      const seg = this.segments[si];
      if ((bestD.get(si) ?? 1e9) > 100) continue;
      const tx = seg.tan[idx * 3], ty = seg.tan[idx * 3 + 1], tz = seg.tan[idx * 3 + 2];
      const s = idx * DS + ((cur.x - seg.pos[idx * 3]) * tx + (cur.y - seg.pos[idx * 3 + 1]) * ty + (cur.z - seg.pos[idx * 3 + 2]) * tz);
      if (s < 0.3 || s > seg.length - 0.3) continue;
      const f = this.frameAt(si, s, this._f);
      const rel = this._rel;
      rel.subVectors(cur, f.p);
      const x = rel.dot(f.b);
      const y = rel.dot(f.n);
      const lipX = f.r * Math.sin(PHYS.lipAngle);
      if (Math.abs(x) > lipX) continue;
      const ys = f.r - Math.sqrt(f.r * f.r - x * x);
      rel.subVectors(prev, f.p);
      const xp = rel.dot(f.b);
      const yp = rel.dot(f.n);
      const ysp = f.r - Math.sqrt(Math.max(0, f.r * f.r - Math.min(xp * xp, f.r * f.r)));
      if (y <= ys + PHYS.bodyOffset && yp >= ysp - 0.05 && y > ys - 3) {
        if (!found || si < out.seg) {
          out.seg = si;
          out.s = s;
          out.x = x;
          found = true;
        }
      }
    }
    return found;
  }
}
