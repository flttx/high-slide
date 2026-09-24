import type { Prediction, Rider, RiderInput } from '../physics/rider.ts';
import type { Track } from '../track/track.ts';
import { clamp } from '../core/math.ts';

const STEERS = [-1, -0.5, 0, 0.5, 1];
const THROTTLES = [-1, 0, 1];

let lastPlan = -1;
const plan: RiderInput = { steer: 0, throttle: 0 };

/** Simple autopilot: PD centring on the slide, model-predictive control in the air. */
export function botInput(r: Rider, track: Track, pred: Prediction, time: number): RiderInput {
  if (r.mode === 'track') {
    lastPlan = -1;
    return { steer: clamp(-r.theta * 3 - r.omega * 1.1, -1, 1), throttle: 0 };
  }
  if (lastPlan < 0 || time - lastPlan > 0.1) {
    lastPlan = time;
    let best = Infinity;
    plan.steer = 0;
    plan.throttle = 0;
    for (const st of STEERS)
      for (const th of THROTTLES) {
        r.predict(st, th, 12, 1 / 40, pred);
        if (pred.kind !== 'land' || pred.seg < r.graceSeg) continue;
        const R = track.segments[pred.seg].radius[Math.floor(pred.s)] ?? 4;
        const cost = Math.abs(pred.x) / R + 0.15 * Math.abs(st) + 0.1 * Math.abs(th) - pred.seg * 0.5;
        if (cost < best) {
          best = cost;
          plan.steer = st;
          plan.throttle = th;
        }
      }
  }
  return { steer: plan.steer, throttle: plan.throttle };
}
