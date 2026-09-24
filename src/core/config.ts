export const GRAVITY = 9.81;
export const SEA_LEVEL = 0;

/** Rider physics tuning (SI units, per unit mass). */
export const PHYS = {
  mu: 0.03,
  drag: 0.00115,
  dragTuck: 0.0008,
  dragBrake: 0.0032,
  muBrake: 0.09,
  airDrag: 0.0017,
  steerAccel: 5.5,
  lateralDamping: 1.8,
  airLateral: 7.5,
  airForward: 4,
  /** Open trough: walls only ~0.9 m high so you can see over them to the sea far below. */
  lipAngle: 36 * (Math.PI / 180),
  minSpeed: 5,
  /** Normal force (m/s^2) below which the rider is thrown off the surface. */
  liftoffNormal: -3,
  bodyOffset: 0.18,
};

export const FIXED_DT = 1 / 120;
