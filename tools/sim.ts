/**
 * Headless level validation: builds the track, prints its profile and lets a bot ride the course
 * with several play styles. Run: npm run sim
 */
import { Vector3 } from 'three';
import { LEVEL } from '../src/track/level.ts';
import { Track, get3 } from '../src/track/track.ts';
import { Rider, makePrediction } from '../src/physics/rider.ts';
import { botInput } from '../src/game/bot.ts';

const track = new Track(LEVEL);
let total = 0;
for (const seg of track.segments) {
  total += seg.length;
  const p0 = get3(seg.pos, 0, new Vector3());
  const p1 = get3(seg.pos, seg.count - 1, new Vector3());
  let vmax = 0;
  let bmax = 0;
  for (let i = 0; i < seg.count; i++) {
    vmax = Math.max(vmax, seg.vd[i]);
    bmax = Math.max(bmax, Math.abs(seg.bank[i]));
  }
  console.log(
    `seg${seg.index} len=${seg.length.toFixed(0)}m y ${p0.y.toFixed(0)}→${p1.y.toFixed(0)}  ` +
      `v ${(seg.vd[0] * 3.6).toFixed(0)}→${(seg.vd[seg.count - 1] * 3.6).toFixed(0)} km/h (max ${(vmax * 3.6).toFixed(0)})  ` +
      `bankMax ${((bmax * 180) / Math.PI).toFixed(0)}°` +
      (seg.gap ? `  gap steer=${seg.gap.steer.toFixed(2)}` : ''),
  );
}
console.log(`total length ${total.toFixed(0)} m, min y ${Math.min(...track.segments.map((s) => s.min.y)).toFixed(1)}`);

// self-clearance: distance between samples of different segments / far-apart samples
let minClear = Infinity;
let where = '';
const segs = track.segments;
for (let a = 0; a < segs.length; a++)
  for (let b = a; b < segs.length; b++) {
    const A = segs[a], B = segs[b];
    for (let i = 0; i < A.count; i += 3)
      for (let j = b === a ? i + 60 : 0; j < B.count; j += 3) {
        if (b === a + 1 && i > A.count - 40 && j < 60) continue; // gap neighbourhood
        const dx = A.pos[i * 3] - B.pos[j * 3], dy = A.pos[i * 3 + 1] - B.pos[j * 3 + 1], dz = A.pos[i * 3 + 2] - B.pos[j * 3 + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < minClear) {
          minClear = d;
          where = `seg${a}@${i} vs seg${b}@${j}`;
        }
      }
  }
console.log(`min clearance between distant track parts: ${minClear.toFixed(1)} m (${where})`);

interface Style {
  name: string;
  throttle: number;
  steerNoise: number;
}
const styles: Style[] = [
  { name: 'neutral', throttle: 0, steerNoise: 0 },
  { name: 'tuck', throttle: 1, steerNoise: 0 },
  { name: 'brake-ish', throttle: -0.4, steerNoise: 0 },
  { name: 'wobbly', throttle: 0.3, steerNoise: 0.5 },
  { name: 'hands-off', throttle: 0, steerNoise: -1 },
];
const pred = makePrediction();
for (const st of styles) {
  const r = new Rider(track);
  r.place(0, LEVEL.checkpoints[0].s, LEVEL.startSpeed);
  const dt = 1 / 120;
  let t = 0;
  let vmax = 0, gmin = 9, gmax = -9, thmax = 0;
  const log: string[] = [];
  let seed = 1;
  while (t < 400 && !r.finished && (r.mode === 'track' || r.mode === 'air')) {
    const inp = botInput(r, track, pred, t);
    seed = (seed * 16807) % 2147483647;
    const noise = st.steerNoise * Math.sin(t * 1.7) * Math.sin(t * 0.37 + 1);
    if (r.mode === 'track') {
      inp.steer = st.steerNoise < 0 ? 0 : Math.max(-1, Math.min(1, inp.steer + noise));
      inp.throttle = st.throttle;
    }
    r.step(dt, inp);
    t += dt;
    for (const e of r.events) {
      if (e.type === 'takeoff') log.push(`${t.toFixed(1)}s takeoff(${e.reason}) seg${e.seg} v=${(r.vel.length() * 3.6).toFixed(0)}`);
      if (e.type === 'land') log.push(`${t.toFixed(1)}s land seg${e.seg} s=${r.s.toFixed(0)} impact=${e.impact.toFixed(1)}`);
      if (e.type === 'sea') log.push(`${t.toFixed(1)}s SEA at y=${r.pos.y.toFixed(1)}`);
    }
    r.events.length = 0;
    if (r.mode === 'track') {
      vmax = Math.max(vmax, r.v);
      if (r.trackTime > 0.2) {
        gmin = Math.min(gmin, r.gForce);
        gmax = Math.max(gmax, r.gForce);
      }
      thmax = Math.max(thmax, Math.abs(r.theta));
    }
  }
  console.log(`\n[${st.name}] result=${r.mode} t=${t.toFixed(1)}s seg=${r.seg} vmax=${(vmax * 3.6).toFixed(0)}km/h G ${gmin.toFixed(2)}..${gmax.toFixed(2)} thetaMax=${((thmax * 180) / Math.PI).toFixed(0)}°`);
  console.log('  ' + log.join('\n  '));
}
