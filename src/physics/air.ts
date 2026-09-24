import { Vector3 } from 'three';
import { GRAVITY, PHYS } from '../core/config.ts';

const _h = new Vector3();
const _r = new Vector3();

/**
 * One explicit step of free flight with quadratic drag and a little "sky-diver" air control.
 * steer: -1..1 (right +), throttle: -1..1 (forward +). Mutates pos/vel, returns heading.
 */
export function airStep(
  pos: Vector3,
  vel: Vector3,
  steer: number,
  throttle: number,
  dt: number,
  heading: Vector3,
  gravityScale = 1,
): void {
  _h.set(vel.x, 0, vel.z);
  const hl = _h.length();
  if (hl > 0.5) heading.copy(_h).multiplyScalar(1 / hl);
  // right = heading x up
  _r.set(-heading.z, 0, heading.x);
  const sp = vel.length();
  const k = PHYS.airDrag * sp;
  const ax = -k * vel.x + _r.x * steer * PHYS.airLateral + heading.x * throttle * PHYS.airForward;
  const ay = -k * vel.y - GRAVITY * gravityScale;
  const az = -k * vel.z + _r.z * steer * PHYS.airLateral + heading.z * throttle * PHYS.airForward;
  vel.x += ax * dt;
  vel.y += ay * dt;
  vel.z += az * dt;
  pos.x += vel.x * dt;
  pos.y += vel.y * dt;
  pos.z += vel.z * dt;
}
