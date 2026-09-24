/**
 * Level layout. Each segment is a chain of smooth pieces (constant-curvature-free turns with
 * sine-shaped curvature so there are no jerks). Turn is degrees (+ = right), pitch is the
 * pitch (degrees) reached at the end of the piece. Gaps are computed from a ghost flight so the
 * next segment is always physically reachable.
 */
export interface PieceDef {
  len: number;
  turn?: number;
  pitch?: number;
}

export interface GapDef {
  /** Designed flight time (s) until the landing window. */
  time: number;
  /** Sideways offset (m, + right) the player must steer in the air. */
  lateral: number;
  /** Vertical drop of the landing line below the ghost secant (m). */
  drop?: number;
}

export interface SegmentDef {
  radius: number;
  catchRadius?: number;
  pieces: PieceDef[];
  gap?: GapDef;
}

export interface CheckpointDef {
  seg: number;
  s: number;
}

export interface LevelDef {
  start: { pos: [number, number, number]; yaw: number; pitch: number };
  startSpeed: number;
  segments: SegmentDef[];
  checkpoints: CheckpointDef[];
}

export const LEVEL: LevelDef = {
  start: { pos: [0, 1680, 0], yaw: 0, pitch: -6 },
  startSpeed: 5,
  segments: [
    {
      // 0 — launch tower, near-vertical first drop, two sweeping banked turns, first (straight) jump
      radius: 4.5,
      pieces: [
        { len: 30, pitch: -10 },
        { len: 80, pitch: -52 },
        { len: 70, pitch: -50 },
        { len: 120, pitch: -22 },
        { len: 280, turn: 75, pitch: -15 },
        { len: 70, pitch: -22 },
        { len: 300, turn: -100, pitch: -13 },
        { len: 50, pitch: -14 },
        { len: 80, pitch: 6 },
      ],
      gap: { time: 1.9, lateral: 0, drop: 2.5 },
    },
    {
      // 1 — S-bends then a descending helix, second jump with a sideways offset
      radius: 4.5,
      catchRadius: 8.5,
      pieces: [
        { len: 40, pitch: -18 },
        { len: 180, turn: -55, pitch: -18 },
        { len: 180, turn: 60, pitch: -15 },
        { len: 60, pitch: -22 },
        { len: 660, turn: 290, pitch: -12 },
        { len: 50, pitch: -14 },
        { len: 80, pitch: 6 },
      ],
      gap: { time: 2.1, lateral: 7, drop: 2.5 },
    },
    {
      // 2 — dive through the cloud deck, fast rollers, big offset jump
      radius: 4.5,
      catchRadius: 8.5,
      pieces: [
        { len: 60, pitch: -24 },
        { len: 140, pitch: -46 },
        { len: 120, pitch: -14 },
        { len: 220, turn: 60, pitch: -14 },
        { len: 70, pitch: -22 },
        { len: 90, pitch: -9 },
        { len: 220, turn: -75, pitch: -13 },
        { len: 50, pitch: -12 },
        { len: 80, pitch: 7 },
      ],
      gap: { time: 2.4, lateral: -9, drop: 2.5 },
    },
    {
      // 3 — technical section, quick hop
      radius: 4.5,
      catchRadius: 8.5,
      pieces: [
        { len: 40, pitch: -18 },
        { len: 200, turn: 80, pitch: -16 },
        { len: 200, turn: -80, pitch: -18 },
        { len: 50, pitch: -12 },
        { len: 70, pitch: 5 },
      ],
      gap: { time: 1.7, lateral: 5, drop: 2.5 },
    },
    {
      // 4 — the big dive down to the shark water, last jump
      radius: 4.5,
      catchRadius: 8.5,
      pieces: [
        { len: 70, pitch: -24 },
        { len: 190, pitch: -50 },
        { len: 150, pitch: -12 },
        { len: 220, turn: -80, pitch: -9 },
        { len: 70, pitch: -12 },
        { len: 200, turn: 70, pitch: -7 },
        { len: 50, pitch: -7 },
        { len: 70, pitch: 7 },
      ],
      gap: { time: 2.2, lateral: -6, drop: 2.5 },
    },
    {
      // 5 — skimming the waves to the finish pier
      radius: 4.5,
      catchRadius: 8.5,
      pieces: [
        { len: 40, pitch: -11 },
        { len: 180, turn: 45, pitch: -8 },
        { len: 180, turn: -30, pitch: -5 },
        { len: 110, pitch: -2 },
        { len: 110, pitch: 1 },
        { len: 60, pitch: 0 },
      ],
    },
  ],
  checkpoints: [
    { seg: 0, s: 4 },
    { seg: 1, s: 70 },
    { seg: 2, s: 60 },
    { seg: 4, s: 60 },
  ],
};
