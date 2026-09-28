import * as THREE from 'three';
import { PHYS } from '../core/config.ts';
import { rng } from '../core/math.ts';
import { DS, get3, makeFrame, type Segment, type Track } from '../track/track.ts';
import type { CheckpointDef } from '../track/level.ts';
import {
  SLIDE_TILE,
  catchTexture,
  checkerTexture,
  hazardTexture,
  labelTexture,
  slideTexture,
  waterFilmTexture,
} from './textures.ts';

const LIP = PHYS.lipAngle;
const SHELL = 0.3;
const HAZARD_LEN = 26;
const CATCH_MARK = 44;

interface ProfilePt {
  x: number;
  y: number;
  u: number;
}

type Profile = (r: number) => ProfilePt[];

const innerProfile = (steps: number, from = -LIP, to = LIP): Profile => (r) => {
  const pts: ProfilePt[] = [];
  for (let k = 0; k <= steps; k++) {
    const u = k / steps;
    const th = from + (to - from) * u;
    pts.push({ x: r * Math.sin(th), y: r * (1 - Math.cos(th)), u: (th + LIP) / (2 * LIP) });
  }
  return pts;
};

const outerProfile: Profile = (r) => {
  const pts: ProfilePt[] = [];
  const ax = (th: number, rad: number, u: number) =>
    pts.push({ x: rad * Math.sin(th), y: r - rad * Math.cos(th), u });
  const bead = 5 * (Math.PI / 180);
  ax(LIP, r, 0);
  ax(LIP + bead, r + 0.06, 0.02);
  ax(LIP + bead, r + SHELL - 0.04, 0.04);
  ax(LIP, r + SHELL, 0.06);
  const n = 18;
  for (let k = 1; k < n; k++) {
    const th = LIP - (2 * LIP * k) / n;
    ax(th, r + SHELL, 0.06 + (0.88 * k) / n);
  }
  ax(-LIP, r + SHELL, 0.94);
  ax(-LIP - bead, r + SHELL - 0.04, 0.96);
  ax(-LIP - bead, r + 0.06, 0.98);
  ax(-LIP, r, 1);
  return pts;
};

const keelProfile: Profile = () => [
  { x: 0.55, y: -SHELL + 0.05, u: 0 },
  { x: 0.55, y: -1.25, u: 0.3 },
  { x: -0.55, y: -1.25, u: 0.7 },
  { x: -0.55, y: -SHELL + 0.05, u: 1 },
];

function extrude(seg: Segment, i0: number, i1: number, profile: Profile, vScale: number, lift = 0): THREE.BufferGeometry {
  const rings = i1 - i0 + 1;
  const probe = profile(seg.radius[i0]);
  const m = probe.length;
  const pos = new Float32Array(rings * m * 3);
  const uv = new Float32Array(rings * m * 2);
  const P = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3();
  for (let ri = 0; ri < rings; ri++) {
    const i = i0 + ri;
    get3(seg.pos, i, P);
    get3(seg.nrm, i, N);
    get3(seg.bin, i, B);
    const prof = profile(seg.radius[i]);
    for (let k = 0; k < m; k++) {
      const q = prof[k];
      const o = (ri * m + k) * 3;
      const y = q.y + lift;
      pos[o] = P.x + B.x * q.x + N.x * y;
      pos[o + 1] = P.y + B.y * q.x + N.y * y;
      pos[o + 2] = P.z + B.z * q.x + N.z * y;
      uv[(ri * m + k) * 2] = q.u;
      uv[(ri * m + k) * 2 + 1] = (i * DS) / vScale;
    }
  }
  const idx: number[] = [];
  for (let ri = 0; ri < rings - 1; ri++)
    for (let k = 0; k < m - 1; k++) {
      const a = ri * m + k, b = a + 1, c = a + m, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

function capGeometry(seg: Segment, i: number, flip: boolean): THREE.BufferGeometry {
  // closes the U-shaped shell between inner and outer profile at a segment end
  const inner = innerProfile(24)(seg.radius[i]);
  const P = get3(seg.pos, i, new THREE.Vector3());
  const N = get3(seg.nrm, i, new THREE.Vector3());
  const B = get3(seg.bin, i, new THREE.Vector3());
  const r = seg.radius[i];
  const pos: number[] = [];
  const w = (x: number, y: number) => {
    pos.push(P.x + B.x * x + N.x * y, P.y + B.y * x + N.y * y, P.z + B.z * x + N.z * y);
  };
  for (let k = 0; k < inner.length - 1; k++) {
    const t0 = -LIP + (2 * LIP * k) / (inner.length - 1);
    const t1 = -LIP + (2 * LIP * (k + 1)) / (inner.length - 1);
    const a = inner[k], b = inner[k + 1];
    const oa = { x: (r + SHELL) * Math.sin(t0), y: r - (r + SHELL) * Math.cos(t0) };
    const ob = { x: (r + SHELL) * Math.sin(t1), y: r - (r + SHELL) * Math.cos(t1) };
    const quad = [a, b, ob, a, ob, oa];
    const order = flip ? [0, 2, 1, 3, 5, 4] : [0, 1, 2, 3, 4, 5];
    for (const o of order) w(quad[o].x, quad[o].y);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

export function frameMatrix(seg: Segment, s: number, out: THREE.Matrix4, track: Track): THREE.Matrix4 {
  const f = track.frameAt(seg.index, s, makeFrame());
  const back = f.t.clone().negate();
  out.makeBasis(f.b, f.n, back);
  out.setPosition(f.p);
  return out;
}

export interface TrackVisuals {
  group: THREE.Group;
  checkpointGates: THREE.Group[];
  finishGate: THREE.Group;
  update(time: number): void;
  setCheckpointActive(i: number, on?: boolean): void;
}

export function buildTrackVisuals(track: Track, checkpoints: CheckpointDef[], envMap: THREE.Texture | null): TrackVisuals {
  const group = new THREE.Group();
  group.name = 'track';

  const slideMat = new THREE.MeshPhysicalMaterial({
    map: slideTexture(),
    roughness: 0.32,
    clearcoat: 0.65,
    clearcoatRoughness: 0.24,
    metalness: 0.0,
    envMap,
    envMapIntensity: 1.1,
  });
  const hazardMat = new THREE.MeshStandardMaterial({ map: hazardTexture(), roughness: 0.3, envMap, envMapIntensity: 0.9 });
  const catchMat = new THREE.MeshStandardMaterial({ map: catchTexture(), roughness: 0.2, envMap, envMapIntensity: 1.0 });
  const shellMat = new THREE.MeshStandardMaterial({ color: 0xe8531e, roughness: 0.42, metalness: 0.05, envMap, envMapIntensity: 0.8 });
  const keelMat = new THREE.MeshStandardMaterial({ color: 0x6f7780, roughness: 0.6, metalness: 0.6, envMap, envMapIntensity: 0.6 });
  const filmTex = waterFilmTexture();
  const filmMat = new THREE.MeshBasicMaterial({
    color: 0xbfe8ff,
    alphaMap: filmTex,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });

  const inner = innerProfile(28);
  const ribs: THREE.Matrix4[] = [];
  const ribFrame = new THREE.Matrix4();
  const ribLocal = new THREE.Matrix4();
  const ribRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2 - LIP);
  for (const seg of track.segments) {
    const last = seg.count - 1;
    const hazardStart = seg.gap ? Math.max(0, last - Math.round(HAZARD_LEN / DS)) : last;
    const catchEnd = seg.isCatch ? Math.round(CATCH_MARK / DS) : 0;
    const ranges: [number, number, THREE.Material][] = [];
    if (catchEnd > 0) ranges.push([0, catchEnd, catchMat]);
    ranges.push([catchEnd, hazardStart, slideMat]);
    if (hazardStart < last) ranges.push([hazardStart, last, hazardMat]);
    for (const [a, b, mat] of ranges) {
      if (b <= a) continue;
      const mesh = new THREE.Mesh(extrude(seg, a, b, inner, SLIDE_TILE), mat);
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    const outer = new THREE.Mesh(extrude(seg, 0, last, outerProfile, 20), shellMat);
    group.add(outer);
    const keel = new THREE.Mesh(extrude(seg, 0, last, keelProfile, 20), keelMat);
    group.add(keel);
    group.add(new THREE.Mesh(capGeometry(seg, 0, false), shellMat));
    group.add(new THREE.Mesh(capGeometry(seg, last, true), shellMat));
    // Match the panel seams; keep the reinforcement below the riding surface.
    for (let s = SLIDE_TILE; s < seg.length - SLIDE_TILE; s += SLIDE_TILE) {
      const r = track.frameAt(seg.index, s, makeFrame()).r;
      const radius = r + SHELL + 0.06;
      frameMatrix(seg, s, ribFrame, track);
      ribLocal.compose(new THREE.Vector3(0, r, 0), ribRotation, new THREE.Vector3(radius, radius, 3));
      ribs.push(ribFrame.clone().multiply(ribLocal));
    }
    const film = new THREE.Mesh(extrude(seg, 0, last, innerProfile(8, -0.55, 0.55), 30, 0.025), filmMat);
    film.renderOrder = 2;
    group.add(film);
  }

  const ribMesh = new THREE.InstancedMesh(new THREE.TorusGeometry(1, 0.022, 4, 18, 2 * LIP), shellMat, ribs.length);
  ribs.forEach((matrix, i) => ribMesh.setMatrixAt(i, matrix));
  ribMesh.computeBoundingSphere();
  group.add(ribMesh);

  // ---- lip marker lights (streak past at speed) ----
  const lightGeo = new THREE.SphereGeometry(0.075, 8, 6);
  const warmMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 1.1, 0.75) });
  const redMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.25, 0.12) });
  const greenMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 2.4, 0.65) });
  const warm: THREE.Matrix4[] = [];
  const red: THREE.Matrix4[] = [];
  const green: THREE.Matrix4[] = [];
  const P = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3();
  for (const seg of track.segments) {
    const last = seg.count - 1;
    for (let i = 2; i < last; i += 6) {
      get3(seg.pos, i, P);
      get3(seg.nrm, i, N);
      get3(seg.bin, i, B);
      const r = seg.radius[i] + 0.18;
      const list = seg.gap && i > last - HAZARD_LEN ? red : seg.isCatch && i < CATCH_MARK ? green : warm;
      for (const sgn of [-1, 1]) {
        const th = sgn * (LIP + 0.03);
        const m = new THREE.Matrix4().makeTranslation(
          P.x + B.x * r * Math.sin(th) + N.x * (seg.radius[i] - r * Math.cos(th)),
          P.y + B.y * r * Math.sin(th) + N.y * (seg.radius[i] - r * Math.cos(th)),
          P.z + B.z * r * Math.sin(th) + N.z * (seg.radius[i] - r * Math.cos(th)),
        );
        list.push(m);
      }
    }
  }
  const mkInst = (mats: THREE.Matrix4[], mat: THREE.Material) => {
    const im = new THREE.InstancedMesh(lightGeo, mat, mats.length);
    mats.forEach((m, i) => im.setMatrixAt(i, m));
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    group.add(im);
    return im;
  };
  mkInst(warm, warmMat);
  mkInst(red, redMat);
  mkInst(green, greenMat);

  // ---- support pylons down to the sea ----
  const pylonGeo = new THREE.CylinderGeometry(1, 1.25, 1, 10, 1, true);
  pylonGeo.translate(0, -0.5, 0);
  const pylonMat = new THREE.MeshStandardMaterial({ color: 0x99958b, roughness: 0.92, metalness: 0, envMap, envMapIntensity: 0.5 });
  const pylons: THREE.Matrix4[] = [];
  const foam: THREE.Matrix4[] = [];
  const ghostPts: THREE.Vector3[] = track.segments.flatMap((s) => s.gap?.ghost ?? []);
  for (const seg of track.segments) {
    const last = seg.count - 1;
    const step = Math.round(115 / DS);
    for (let i = seg.isCatch ? 60 : 20; i < last - 30; i += step) {
      get3(seg.pos, i, P);
      get3(seg.nrm, i, N);
      const top = P.clone().addScaledVector(N, -1.2);
      const h = top.y + 3;
      let blocked = false;
      for (const other of track.segments) {
        if (blocked) break;
        for (let j = 0; j < other.count; j += 3) {
          const oy = other.pos[j * 3 + 1];
          if (oy > top.y - 5) continue;
          const dx = other.pos[j * 3] - top.x, dz = other.pos[j * 3 + 2] - top.z;
          if (dx * dx + dz * dz < 12 * 12) {
            blocked = true;
            break;
          }
        }
      }
      for (const g of ghostPts) {
        const dx = g.x - top.x, dz = g.z - top.z;
        if (g.y < top.y && dx * dx + dz * dz < 14 * 14) blocked = true;
      }
      if (blocked) continue;
      const rad = 0.55 + h * 0.0032;
      pylons.push(new THREE.Matrix4().compose(top, new THREE.Quaternion(), new THREE.Vector3(rad, h, rad)));
      foam.push(new THREE.Matrix4().compose(new THREE.Vector3(top.x, 0.06, top.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2), new THREE.Vector3(rad * 2.4, rad * 2.4, 1)));
    }
  }
  {
    const im = new THREE.InstancedMesh(pylonGeo, pylonMat, pylons.length);
    pylons.forEach((m, i) => im.setMatrixAt(i, m));
    im.computeBoundingSphere();
    group.add(im);
    const foamMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false,
      // Separate foam from the sea in depth without drawing through foreground objects.
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const fm = new THREE.InstancedMesh(new THREE.RingGeometry(1, 1.9, 24), foamMat, foam.length);
    foam.forEach((m, i) => fm.setMatrixAt(i, m));
    fm.computeBoundingSphere();
    group.add(fm);
  }

  // ---- gap guide hoops ----
  const hoopGeo = new THREE.TorusGeometry(2.3, 0.07, 6, 40);
  const hoopMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 2.2, 2.6), transparent: true, opacity: 0.55, depthWrite: false });
  const hoops: THREE.Matrix4[] = [];
  for (const seg of track.segments) {
    const g = seg.gap;
    if (!g) continue;
    const pts = g.ghost;
    const n = Math.round(g.time * 20);
    for (let k = 5; k < n - 2; k += 6) {
      const a = pts[k];
      const b = pts[Math.min(pts.length - 1, k + 1)];
      const dir = b.clone().sub(a).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      hoops.push(new THREE.Matrix4().compose(a.clone().add(new THREE.Vector3(0, 0.9, 0)), q, new THREE.Vector3(1, 1, 1)));
    }
  }
  const hoopMesh = new THREE.InstancedMesh(hoopGeo, hoopMat, hoops.length);
  hoops.forEach((m, i) => hoopMesh.setMatrixAt(i, m));
  hoopMesh.computeBoundingSphere();
  group.add(hoopMesh);

  // ---- checkpoint gates ----
  const postMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.4, metalness: 0.4, envMap });
  const gates: THREE.Group[] = [];
  const bannerOff = labelTexture('CHECKPOINT', '#0b2a4a', '#7fd4ff');
  const bannerOn = labelTexture('✓ CHECKPOINT', '#0b3d22', '#7dff9e');
  const mkArch = (seg: Segment, s: number, width: number, banner: THREE.Texture): THREE.Group => {
    const gg = new THREE.Group();
    const m = frameMatrix(seg, s, new THREE.Matrix4(), track);
    m.decompose(gg.position, gg.quaternion, gg.scale);
    const r = seg.radius[Math.min(seg.count - 1, Math.round(s))];
    const hgt = r + 5.2;
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, hgt + 1.5, 10), postMat);
      post.position.set(sx * (r + width), hgt / 2 - 1.5, 0);
      gg.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(2 * (r + width) + 0.6, 0.35, 0.35), postMat);
    beam.position.set(0, hgt, 0);
    gg.add(beam);
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(2 * r + 1.5, (2 * r + 1.5) * 0.19),
      new THREE.MeshBasicMaterial({ map: banner, side: THREE.DoubleSide, toneMapped: false }),
    );
    panel.position.set(0, hgt - 0.95, 0.05);
    panel.name = 'banner';
    gg.add(panel);
    const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 2.4, 3.2), transparent: true, opacity: 0.8 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r + 0.9, 0.09, 8, 64, Math.PI), ringMat);
    ring.position.set(0, r, 0);
    ring.name = 'ring';
    gg.add(ring);
    group.add(gg);
    return gg;
  };
  checkpoints.forEach((cp, i) => {
    if (i === 0) {
      gates.push(new THREE.Group());
      return;
    }
    gates.push(mkArch(track.segments[cp.seg], cp.s, 0.7, bannerOff));
  });
  const finishGate = mkArch(track.last, track.finishS, 1.2, labelTexture('FINISH', '#101010', '#ffffff'));
  {
    const chk = new THREE.Mesh(
      new THREE.PlaneGeometry(2 * track.last.radius[0] + 2.2, 0.9),
      new THREE.MeshBasicMaterial({ map: checkerTexture(), side: THREE.DoubleSide }),
    );
    chk.position.set(0, track.last.radius[0] + 5.2 + 0.65, 0.05);
    finishGate.add(chk);
  }

  // ---- start tower + finish pier ----
  buildStartTower(track, group, envMap);
  buildFinishPier(track, group, envMap);

  const setCheckpointActive = (i: number, on = true) => {
    const gate = gates[i];
    if (!gate) return;
    const banner = gate.getObjectByName('banner') as THREE.Mesh | undefined;
    if (banner) (banner.material as THREE.MeshBasicMaterial).map = on ? bannerOn : bannerOff;
    const ring = gate.getObjectByName('ring') as THREE.Mesh | undefined;
    if (ring) {
      const c = (ring.material as THREE.MeshBasicMaterial).color;
      if (on) c.setRGB(0.5, 4, 1.2);
      else c.setRGB(0.4, 2.4, 3.2);
    }
  };

  const update = (time: number) => {
    filmTex.offset.y = -time * 0.9;
    const blink = 0.5 + 0.5 * Math.sin(time * 9);
    redMat.color.setRGB(1 + 2 * blink, 0.25, 0.12);
    hoopMat.opacity = 0.35 + 0.25 * Math.sin(time * 4);
  };

  return { group, checkpointGates: gates, finishGate, update, setCheckpointActive };
}

function buildStartTower(track: Track, group: THREE.Group, envMap: THREE.Texture | null): void {
  const seg = track.segments[0];
  const P = get3(seg.pos, 0, new THREE.Vector3());
  const T = get3(seg.tan, 0, new THREE.Vector3());
  const yaw = Math.atan2(T.x, T.z);
  const tower = new THREE.Group();
  tower.position.set(P.x, 0, P.z);
  tower.rotation.y = yaw;
  const steel = new THREE.MeshStandardMaterial({ color: 0xd4d8de, roughness: 0.45, metalness: 0.7, envMap, envMapIntensity: 0.7 });
  const red = new THREE.MeshStandardMaterial({ color: 0xd8401c, roughness: 0.5, metalness: 0.3, envMap });
  const top = P.y - 1.4;
  const half = 7;
  // four legs, tapering outwards to the sea
  const legGeo = new THREE.CylinderGeometry(0.6, 1.4, 1, 10);
  const braceGeo = new THREE.CylinderGeometry(0.22, 0.22, 1, 6);
  const baseSpread = 26;
  const corners: THREE.Vector3[][] = [];
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const a = new THREE.Vector3(sx * half, top, sz * half - 6);
      const b = new THREE.Vector3(sx * baseSpread, -4, sz * baseSpread - 6);
      corners.push([a, b]);
      addStrut(tower, legGeo, steel, a, b);
    }
  const levels = Math.floor(top / 45);
  const at = (c: THREE.Vector3[], t: number) => c[0].clone().lerp(c[1], t);
  const order = [0, 1, 3, 2, 0];
  for (let l = 0; l <= levels; l++) {
    const t0 = l / (levels + 1);
    const t1 = (l + 1) / (levels + 1);
    for (let k = 0; k < 4; k++) {
      const c0 = corners[order[k]], c1 = corners[order[k + 1]];
      addStrut(tower, braceGeo, steel, at(c0, t0), at(c1, t0));
      addStrut(tower, braceGeo, steel, at(c0, t0), at(c1, t1));
    }
  }
  // deck + canopy
  const deck = new THREE.Mesh(new THREE.BoxGeometry(half * 2 + 4, 1.2, half * 2 + 10), red);
  deck.position.set(0, top + 0.3, -6);
  tower.add(deck);
  const rail = new THREE.Mesh(new THREE.BoxGeometry(half * 2 + 4, 1.1, 0.12), steel);
  rail.position.set(0, top + 1.4, -6 - half - 4.9);
  tower.add(rail);
  const canopy = new THREE.Mesh(new THREE.ConeGeometry(half * 1.6, 4, 4, 1), red);
  canopy.position.set(0, top + 9, -6);
  canopy.rotation.y = Math.PI / 4;
  tower.add(canopy);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 7, 6), steel);
      post.position.set(sx * (half + 1), top + 4, sz * (half + 4) - 6);
      tower.add(post);
    }
  // beacon
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(8, 0.6, 0.3) }));
  beacon.position.set(0, top + 11.3, -6);
  tower.add(beacon);
  group.add(tower);
}

function buildFinishPier(track: Track, group: THREE.Group, envMap: THREE.Texture | null): void {
  const seg = track.last;
  const i = seg.count - 1;
  const P = get3(seg.pos, i, new THREE.Vector3());
  const T = get3(seg.tan, i, new THREE.Vector3());
  const pier = new THREE.Group();
  pier.position.set(P.x, 0, P.z);
  pier.rotation.y = Math.atan2(T.x, T.z);
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a6440, roughness: 0.8, envMap, envMapIntensity: 0.3 });
  const steel = new THREE.MeshStandardMaterial({ color: 0xcfd3d8, roughness: 0.4, metalness: 0.7, envMap });
  const deck = new THREE.Mesh(new THREE.BoxGeometry(34, 1.4, 44), wood);
  deck.position.set(0, P.y - 1.6, 18);
  pier.add(deck);
  const r = rng(9);
  for (let x = -15; x <= 15; x += 10)
    for (let z = -2; z <= 38; z += 10) {
      const h = P.y + 2;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, h, 8), steel);
      leg.position.set(x + (r() - 0.5), h / 2 - 3.5, z);
      pier.add(leg);
    }
  // cheering flags
  const flagCols = [0xff3b30, 0xffcc00, 0x34c759, 0x0a84ff];
  for (let k = 0; k < 8; k++) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 6, 6), steel);
    const x = k < 4 ? -16 : 16;
    const z = 4 + (k % 4) * 10;
    pole.position.set(x, P.y + 2, z);
    pier.add(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(2, 1.2), new THREE.MeshStandardMaterial({ color: flagCols[k % 4], side: THREE.DoubleSide }));
    flag.position.set(x + (k < 4 ? 1 : -1), P.y + 4.3, z);
    pier.add(flag);
  }
  group.add(pier);
}

function addStrut(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, a: THREE.Vector3, b: THREE.Vector3): void {
  const m = new THREE.Mesh(geo, mat);
  const d = b.clone().sub(a);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.scale.set(1, d.length(), 1);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  parent.add(m);
}
