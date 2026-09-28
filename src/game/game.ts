import * as THREE from 'three';
import { FIXED_DT, PHYS } from '../core/config.ts';
import { clamp, damp, lerp, rng, smoothstep } from '../core/math.ts';
import { AudioEngine } from '../audio/audio.ts';
import { Particles, seaSplash } from '../fx/particles.ts';
import { PostFX } from '../fx/postfx.ts';
import { SpeedLines } from '../fx/speedlines.ts';
import { Rider, makePrediction } from '../physics/rider.ts';
import type { RiderEvent, RiderInput } from '../physics/rider.ts';
import { RISE_TIME, Sharks } from '../sharks/sharks.ts';
import type { HuntInfo } from '../sharks/sharks.ts';
import { LEVEL } from '../track/level.ts';
import { Track } from '../track/track.ts';
import { Hud, formatTime } from '../ui/hud.ts';
import { buildClouds } from '../world/clouds.ts';
import type { Clouds } from '../world/clouds.ts';
import { buildEnvironment, buildOcean } from '../world/environment.ts';
import type { Ocean } from '../world/environment.ts';
import { buildScenery, trackCentre } from '../world/scenery.ts';
import { buildTrackVisuals } from '../world/trackMesh.ts';
import type { TrackVisuals } from '../world/trackMesh.ts';
import { botInput } from './bot.ts';
import { CameraRig } from './cameraRig.ts';
import { Input } from './input.ts';

type Phase = 'menu' | 'countdown' | 'ride' | 'eaten' | 'over' | 'finished';

export interface GameOptions {
  /** the bot rides (testing) */
  autopilot: boolean;
  /** gap (segment index) the bot deliberately botches, -1 = none */
  miss: number;
  /** checkpoint index for the first run */
  startCheckpoint: number;
}

export interface World {
  scene: THREE.Scene;
  track: Track;
  visuals: TrackVisuals;
  ocean: Ocean;
  clouds: Clouds;
  sharks: Sharks;
}

const SHARK_COUNT = 5;
const COUNT_STEP = 0.8;
const BEST_KEY = 'high-slide.best';

function loadBest(): number {
  try {
    const v = Number(localStorage.getItem(BEST_KEY));
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch {
    return 0;
  }
}

function saveBest(t: number): number {
  const best = loadBest();
  if (best > 0 && best <= t) return best;
  try {
    localStorage.setItem(BEST_KEY, String(t));
  } catch {
    return t;
  }
  return t;
}

/** Builds the static world step by step so the loading bar can advance between heavy parts. */
export async function buildWorld(
  renderer: THREE.WebGLRenderer,
  progress: (p: number, text: string) => Promise<void>,
): Promise<World> {
  const scene = new THREE.Scene();
  await progress(0.08, '正在铺设 1680 米高空滑梯…');
  const track = new Track(LEVEL);
  await progress(0.22, '正在生成天空与海洋…');
  const env = buildEnvironment(renderer, scene);
  const ocean = buildOcean(env);
  scene.add(ocean.mesh);
  await progress(0.4, '正在搭建滑梯与检查点…');
  const visuals = buildTrackVisuals(track, LEVEL.checkpoints, env.envMap);
  scene.add(visuals.group);
  scene.add(buildScenery(track, env.envMap));
  await progress(0.55, '正在堆积云层…');
  const centre = trackCentre(track);
  const clouds = buildClouds(centre);
  scene.add(clouds.mesh);
  await progress(0.65, '正在唤醒巨齿鲨…');
  const sharks = new Sharks(new THREE.Vector3(centre.x, 0, centre.z), 500);
  await sharks.load('models/megalodon.glb', SHARK_COUNT);
  scene.add(sharks.group);
  return { scene, track, visuals, ocean, clouds, sharks };
}

/** State machine, fixed-step simulation and all per-frame presentation. */
export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly hud: Hud;
  private readonly world: World;
  private readonly opts: GameOptions;
  private readonly track: Track;
  private readonly rider: Rider;
  private readonly input: Input;
  private readonly rig: CameraRig;
  private readonly fx: PostFX;
  private readonly audio = new AudioEngine();
  private readonly spray = new Particles(6000, 0xeaf6ff, 0.85);
  private readonly lines = new SpeedLines(260);
  private readonly rand = rng(77);
  /** course distance at the start of each segment */
  private readonly cum: number[] = [];
  private readonly total: number;

  private phase: Phase = 'menu';
  private paused = false;
  private firstRun = true;
  private time = 0;
  private gameTime = 0;
  private phaseT = 0;
  private last = -1;
  private acc = 0;
  private timeScale = 1;
  private countStep = -1;
  private cpIndex = 0;
  private deaths = 0;
  private runTime = 0;
  private stats = { maxSpeed: 0, maxAir: 0, maxG: 0 };
  private progress = 0;
  private finishT = -1;
  private gapsJumped = 0;
  private takeoffY = 0;
  private hintFaded = false;
  private hadLock = false;

  private doomed = false;
  private doomT = 0;
  /** extra gravity allowed (latched off once the approach begins) */
  private doomBoost = false;
  private readonly hunt: HuntInfo = { point: new THREE.Vector3(), timeLeft: 0, rider: new THREE.Vector3() };
  private readonly pred = makePrediction();
  private readonly scratch = makePrediction();
  private readonly botPred = makePrediction();
  private predAt = 0;
  private nextPredict = 0;
  private nextDoomCheck = 0;
  private doomGrace = 0.2;
  private readonly cmd: RiderInput = { steer: 0, throttle: 0 };
  private readonly biteOffset = new THREE.Vector3();
  private followMouth = false;

  private edgeK = 0;
  private edgeWarnCd = 0;
  private flash = 0;
  private fade = 0;
  private sprayAcc = 0;
  private readonly v1 = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly v3 = new THREE.Vector3();
  private readonly c2 = new THREE.Vector2();

  constructor(renderer: THREE.WebGLRenderer, hud: Hud, world: World, opts: GameOptions) {
    this.renderer = renderer;
    this.hud = hud;
    this.world = world;
    this.opts = opts;
    this.track = world.track;
    this.rider = new Rider(this.track);
    const canvas = renderer.domElement;
    this.input = new Input(canvas);
    this.rig = new CameraRig(window.innerWidth / Math.max(1, window.innerHeight));
    world.scene.add(this.rig.body, this.spray.points, this.lines.mesh);
    this.fx = new PostFX(renderer, world.scene, this.rig.camera);

    let d = 0;
    for (const seg of this.track.segments) {
      this.cum.push(d);
      d += seg.length;
    }
    this.total = d;
    const gaps = this.track.segments.filter((s) => s.gap).map((s) => (this.cum[s.index] + s.length) / d);
    const cps = LEVEL.checkpoints.slice(1).map((cp) => (this.cum[cp.seg] + cp.s) / d);
    hud.buildTicks(gaps, cps);

    const on = (id: string, fn: () => void) => document.getElementById(id)?.addEventListener('click', fn);
    on('btn-start', () => this.start());
    on('btn-again', () => this.start());
    on('btn-restart', () => this.start());
    on('btn-respawn', () => this.respawn());
    on('btn-restart-p', () => this.respawn());
    on('btn-resume', () => this.resume());
    on('btn-mute', () => this.toggleMute());

    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === canvas;
      if (!locked && this.hadLock) this.pause();
      this.hadLock = locked;
    });
    canvas.addEventListener('click', () => {
      if (!this.paused && (this.phase === 'ride' || this.phase === 'countdown')) this.input.requestPointerLock();
    });
    window.addEventListener('blur', () => this.pause());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.pause();
    });
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  /** Pre-compile materials so the first frames of the ride don't hitch. */
  async compile(): Promise<void> {
    this.rider.place(0, LEVEL.checkpoints[0].s, LEVEL.startSpeed);
    this.present(1 / 60);
    try {
      await this.renderer.compileAsync(this.world.scene, this.rig.camera);
    } catch {
      this.renderer.compile(this.world.scene, this.rig.camera);
    }
  }

  showMenu(): void {
    this.setPhase('menu');
    this.rider.place(0, LEVEL.checkpoints[0].s, LEVEL.startSpeed);
    this.rig.reset();
    this.hud.showHud(false);
    if (this.world.sharks.usedFallback) this.hud.setText('start-note', '巨齿鲨模型加载失败，已使用简化模型。');
    else {
      const best = loadBest();
      if (best > 0) this.hud.setStats('start-note', [['最佳成绩', formatTime(best)]]);
    }
    this.hud.showScreen('screen-start');
  }

  resize(): void {
    const w = window.innerWidth;
    const h = Math.max(1, window.innerHeight);
    this.renderer.setSize(w, h, false);
    this.rig.camera.aspect = w / h;
    this.rig.camera.updateProjectionMatrix();
    this.fx.setSize(w, h);
  }

  // ------------------------------------------------------------------ flow

  private setPhase(p: Phase): void {
    this.phase = p;
    this.phaseT = 0;
  }

  /** Fresh run from the start (or the debug checkpoint on the first run). */
  private start(): void {
    if (this.phase !== 'menu' && this.phase !== 'over' && this.phase !== 'finished') return;
    this.audio.init();
    this.cpIndex = 0;
    this.deaths = 0;
    this.runTime = 0;
    this.stats = { maxSpeed: 0, maxAir: 0, maxG: 0 };
    this.gapsJumped = 0;
    for (let i = 1; i < LEVEL.checkpoints.length; i++) this.world.visuals.setCheckpointActive(i, false);
    if (this.firstRun && this.opts.startCheckpoint > 0) {
      this.cpIndex = this.opts.startCheckpoint;
      for (let i = 1; i <= this.cpIndex; i++) this.world.visuals.setCheckpointActive(i, true);
    }
    this.firstRun = false;
    this.respawn();
  }

  /** Back to the last checkpoint reached, with a short countdown. */
  private respawn(): void {
    if (this.phase === 'menu' || this.phase === 'eaten' || this.phase === 'finished') {
      if (this.phase !== 'menu' || this.firstRun) return;
    }
    const cp = LEVEL.checkpoints[this.cpIndex];
    const seg = this.track.segments[cp.seg];
    const v = this.cpIndex === 0 ? LEVEL.startSpeed : Math.max(PHYS.minSpeed, seg.vd[Math.floor(cp.s)] ?? LEVEL.startSpeed);
    const r = this.rider;
    r.place(cp.seg, cp.s, v);
    this.progress = (this.cum[cp.seg] + cp.s) / this.total;
    this.doomed = false;
    this.followMouth = false;
    this.world.sharks.resetAll(this.gameTime);
    this.spray.clear();
    this.rig.reset();
    this.acc = 0;
    this.timeScale = 1;
    this.finishT = -1;
    this.flash = 0;
    this.fade = 1;
    this.countStep = -1;
    this.pred.kind = 'none';
    this.hud.setJaws(0);
    this.hud.setReticle(null);
    this.hud.clearMessage();
    this.hud.hideScreen();
    this.hud.showHud(true);
    this.paused = false;
    this.audio.resume();
    this.setPhase('countdown');
    this.input.requestPointerLock();
  }

  private pause(): void {
    if (this.paused || (this.phase !== 'ride' && this.phase !== 'countdown')) return;
    this.paused = true;
    this.audio.suspend();
    this.hud.showScreen('screen-pause');
    this.input.releasePointerLock();
  }

  private resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.audio.resume();
    this.hud.hideScreen();
    this.input.requestPointerLock();
  }

  private toggleMute(): void {
    const m = !this.audio.isMuted;
    this.audio.setMuted(m);
    const b = document.getElementById('btn-mute');
    if (b) {
      b.setAttribute('aria-pressed', String(m));
      b.textContent = m ? '声音：关' : '声音：开';
    }
  }

  private handleKeys(): void {
    const i = this.input;
    if (i.pressed('KeyM')) this.toggleMute();
    if (i.pressed('Escape')) {
      if (this.paused) this.resume();
      else this.pause();
    }
    // buttons also react to Enter natively; the phase guards make the second trigger a no-op
    if (i.pressed('KeyR') && (this.phase === 'over' || this.paused || (this.phase === 'ride' && !this.doomed))) this.respawn();
    if (i.pressed('Enter')) {
      if (this.phase === 'menu' || this.phase === 'finished') this.start();
      else if (this.phase === 'over') this.respawn();
    }
  }

  // ------------------------------------------------------------------ frame

  frame(now: number): void {
    const dt = this.last < 0 ? 1 / 60 : clamp(now - this.last, 0, 0.05);
    this.last = now;
    this.time += dt;
    const input = this.input;
    input.enabled = this.phase === 'ride' && !this.paused && !this.opts.autopilot;
    input.update(dt, this.time);
    this.handleKeys();
    if (this.paused) {
      input.endFrame();
      return;
    }
    // the last moments of a doomed fall play in slow motion
    const slow = this.phase === 'ride' && this.doomed && this.hunt.timeLeft < 0.9;
    const tsT = slow ? 0.3 : 1;
    this.timeScale += (tsT - this.timeScale) * damp(slow ? 5 : 3, dt);
    const gdt = dt * this.timeScale;
    this.gameTime += gdt;
    this.phaseT += dt;

    if (this.phase === 'countdown') this.updateCountdown();
    else if (this.phase === 'ride') this.updateRide(gdt);
    else if (this.phase === 'eaten') this.updateEaten(dt);
    this.updateWorld(gdt);
    this.present(dt);
    input.endFrame();
  }

  private updateCountdown(): void {
    const step = Math.floor(this.phaseT / COUNT_STEP);
    if (step === this.countStep) return;
    this.countStep = step;
    if (step >= 3) {
      this.hud.message('GO!', 'good', 0.9);
      this.audio.countdown(true);
      this.setPhase('ride');
    } else {
      this.hud.message(String(3 - step), 'warn', COUNT_STEP - 0.1, step === 0 && this.cpIndex > 0 ? `从检查点 ${this.cpIndex} 出发` : '');
      this.audio.countdown(false);
    }
  }

  private control(): RiderInput {
    const r = this.rider;
    const c = this.cmd;
    if (!this.opts.autopilot) {
      c.steer = this.input.steer;
      c.throttle = this.input.throttle;
    } else {
      // ?miss=N: brake along segment N so the jump falls short, then drift away from the catch
      const missing = this.opts.miss >= 0 && (r.mode === 'air' ? r.graceSeg : r.seg) === this.opts.miss;
      if (missing && r.mode === 'air') {
        c.steer = 1;
        c.throttle = -1;
      } else {
        const b = botInput(r, this.track, this.botPred, this.gameTime);
        c.steer = b.steer;
        c.throttle = missing ? -1 : b.throttle;
      }
    }
    return c;
  }

  private updateRide(gdt: number): void {
    const r = this.rider;
    this.runTime += gdt;
    if (!this.hintFaded && this.runTime > 12) {
      this.hintFaded = true;
      this.hud.fadeHint();
    }
    const cmd = this.control();
    this.acc += gdt;
    let n = 0;
    while (this.acc >= FIXED_DT && n < 24) {
      this.acc -= FIXED_DT;
      n++;
      r.step(FIXED_DT, cmd);
      if (this.checkBite()) break;
      if (r.mode !== 'track' && r.mode !== 'air') break;
    }
    if (n >= 24) this.acc = 0;
    for (const e of r.events) this.onEvent(e);
    r.events.length = 0;
    if (this.phase !== 'ride') return;

    const speed = r.vel.length();
    this.stats.maxSpeed = Math.max(this.stats.maxSpeed, speed);
    if (r.mode === 'track') {
      this.progress = (this.cum[r.seg] + r.s) / this.total;
      if (r.trackTime > 0.25) this.stats.maxG = Math.max(this.stats.maxG, r.gForce);
      this.passCheckpoints();
    } else if (r.mode === 'air') this.updateAir(gdt, cmd);

    if (this.finishT >= 0) {
      this.finishT += gdt;
      if (this.finishT > 4 || r.mode === 'done' || (this.finishT > 1 && r.v < 1.5)) this.showFinish();
    }
  }

  private updateAir(gdt: number, cmd: RiderInput): void {
    const r = this.rider;
    if (this.doomed) this.hunt.timeLeft = Math.max(0, this.hunt.timeLeft - gdt);
    // landing reticle for the current controls, 10 Hz
    if (this.time >= this.nextPredict) {
      this.nextPredict = this.time + 0.1;
      r.predict(cmd.steer, cmd.throttle, 30, 1 / 30, this.pred);
      this.predAt = this.gameTime;
      if (this.doomed && this.pred.kind === 'sea') {
        this.hunt.point.copy(this.pred.point);
        this.hunt.timeLeft = this.pred.t;
      }
    }
    // cheap test first: only if the current controls end in the sea, try every strategy
    if (!this.doomed && r.vel.y < 0 && r.airTime > this.doomGrace && this.pred.kind === 'sea' && this.time >= this.nextDoomCheck) {
      this.nextDoomCheck = this.time + 0.2;
      if (r.isDoomed(this.scratch)) this.startDoom();
    }
    if (!this.doomed) return;
    this.doomT += gdt;
    // long hopeless falls are sped up so the chase stays tight; frozen before the shark rises
    if (this.doomBoost && (r.pos.y < 160 || this.hunt.timeLeft < RISE_TIME + 4.5)) this.doomBoost = false;
    if (this.doomBoost && this.doomT > 1.2) r.gravityScale = Math.min(2.6, r.gravityScale + gdt * 0.9);
    else if (!this.doomBoost) r.gravityScale = Math.max(1, r.gravityScale - gdt * 1.5);
  }

  private startDoom(): void {
    this.doomed = true;
    this.doomT = 0;
    this.doomBoost = true;
    this.hunt.point.copy(this.pred.point);
    this.hunt.timeLeft = this.pred.t;
    this.world.sharks.startHunt(this.hunt.point, this.hunt.timeLeft);
    this.hud.message('巨齿鲨逼近！', 'bad', 2.4, '已经够不到滑梯了……');
    this.audio.warn();
  }

  /** In the jaws (or in the water)? Checked every physics step. */
  private checkBite(): boolean {
    const r = this.rider;
    if (r.mode === 'sea') {
      this.eat();
      return true;
    }
    const sharks = this.world.sharks;
    if (r.mode !== 'air' || !this.doomed || !sharks.hunting) return false;
    const m = sharks.mouthPosition(this.v1);
    if (r.pos.y < m.y + 1.6 && Math.hypot(r.pos.x - m.x, r.pos.z - m.z) < 9) {
      this.eat();
      return true;
    }
    return false;
  }

  private eat(): void {
    if (this.phase !== 'ride') return;
    const r = this.rider;
    const sharks = this.world.sharks;
    if (!sharks.hunting) sharks.startHunt(r.pos, 0);
    const m = sharks.mouthPosition(this.v1);
    this.biteOffset.copy(r.pos).sub(m);
    this.followMouth = this.biteOffset.length() < 14;
    sharks.chomp();
    this.deaths++;
    this.setPhase('eaten');
    this.audio.chomp();
    this.rig.kick(1.3);
    this.hud.clearMessage();
    this.hud.setReticle(null);
    this.timeScale = 1;
    // gaze drops into the throat
    r.vel.set(r.heading.x * 2, -9, r.heading.z * 2);
  }

  private updateEaten(dt: number): void {
    const r = this.rider;
    if (this.followMouth) {
      // dragged into the mouth as the shark lunges and falls back
      this.biteOffset.multiplyScalar(Math.exp(-dt * 7));
      this.world.sharks.mouthPosition(this.v1);
      r.pos.copy(this.v1).add(this.biteOffset);
    }
    if (this.phaseT > 2.1) this.showOver();
  }

  private showOver(): void {
    this.setPhase('over');
    this.hud.setStats('over-stats', [
      ['坠落高度', `${Math.max(0, Math.round(this.takeoffY))} m`],
      ['葬身鲨腹', `${this.deaths} 次`],
      ['复活位置', this.cpIndex === 0 ? '起点' : `检查点 ${this.cpIndex}`],
    ]);
    this.hud.showHud(false);
    this.hud.showScreen('screen-over');
    this.input.releasePointerLock();
  }

  private showFinish(): void {
    this.setPhase('finished');
    const best = saveBest(this.runTime);
    this.hud.setStats('finish-stats', [
      ['总用时', formatTime(this.runTime)],
      ['最佳成绩', formatTime(best)],
      ['葬身鲨腹', `${this.deaths} 次`],
      ['最高速度', `${Math.round(this.stats.maxSpeed * 3.6)} km/h`],
      ['最长滞空', `${this.stats.maxAir.toFixed(1)} s`],
      ['最大过载', `${this.stats.maxG.toFixed(1)} G`],
    ]);
    this.hud.showHud(false);
    this.hud.showScreen('screen-finish');
    this.input.releasePointerLock();
  }

  private passCheckpoints(): void {
    const r = this.rider;
    const cps = LEVEL.checkpoints;
    while (this.cpIndex + 1 < cps.length) {
      const cp = cps[this.cpIndex + 1];
      if (r.seg < cp.seg || (r.seg === cp.seg && r.s < cp.s)) break;
      this.cpIndex++;
      this.world.visuals.setCheckpointActive(this.cpIndex);
      this.audio.checkpoint();
      this.flash = Math.max(this.flash, 0.25);
      this.hud.message(`检查点 ${this.cpIndex}/${cps.length - 1}`, 'cp', 1.8, '坠海后将从这里复活');
    }
  }

  private onEvent(e: RiderEvent): void {
    const r = this.rider;
    if (e.type === 'takeoff') {
      this.audio.whoosh();
      this.takeoffY = r.pos.y;
      this.nextPredict = 0;
      // A designed gap is a jump, even when the current controls predict a miss.
      // Use flight time so pausing cannot consume the authored jump window.
      this.doomGrace = e.reason === 'gap' ? this.track.segments[e.seg].gap?.time ?? 0.2 : 0.2;
      this.nextDoomCheck = this.time + 0.2;
      if (e.reason === 'gap') {
        this.gapsJumped++;
        this.hud.message('跳！', 'warn', 1.1, this.gapsJumped === 1 ? 'A/D 调整方向 · W 前冲 · S 减速，对准绿色落点' : '');
      } else if (e.reason === 'flyoff') {
        this.rig.kick(0.5);
        this.hud.message('飞出滑梯！', 'bad', 1.4, '快调整方向，寻找下方的滑梯');
      }
    } else if (e.type === 'land') {
      const k = clamp(e.impact / 14, 0.15, 1.2);
      this.audio.land(e.impact);
      this.rig.kick(k);
      this.flash = Math.max(this.flash, 0.1 * k);
      this.stats.maxAir = Math.max(this.stats.maxAir, r.airTime);
      this.landingSplash(k);
      r.gravityScale = 1;
      this.pred.kind = 'none';
      if (this.doomed) {
        this.doomed = false;
        this.world.sharks.cancelHunt();
        this.hud.message('死里逃生！', 'good', 1.6);
      } else if (r.airTime > 1.2) this.hud.message('完美落地！', 'good', 1.2);
    } else if (e.type === 'finish') {
      this.finishT = 0;
      this.audio.finish();
      this.flash = 0.35;
      this.hud.message('抵达终点！', 'good', 3);
    }
  }

  // ------------------------------------------------------------------ world + fx

  private landingSplash(k: number): void {
    const r = this.rider;
    const nIn = r.innerNormal(this.v2);
    const f = r.frame;
    for (let i = 0; i < 60 * k; i++) {
      this.v1.copy(r.pos).addScaledVector(f.b, (this.rand() - 0.5) * 2.5).addScaledVector(f.t, this.rand() * 2);
      this.v3
        .copy(f.t)
        .multiplyScalar(r.v * (0.3 + this.rand() * 0.4))
        .addScaledVector(nIn, 2 + this.rand() * 5 * k)
        .addScaledVector(f.b, (this.rand() - 0.5) * 8);
      this.spray.spawn(this.v1, this.v3, 0.5 + this.rand() * 0.5, 0.04 + this.rand() * 0.08, 1.2);
    }
  }

  /** Water film kicked up by the rider's feet; faster = denser, more when riding high on a wall. */
  private emitSpray(gdt: number): void {
    const r = this.rider;
    const f = r.frame;
    const nIn = r.innerNormal(this.v2);
    this.sprayAcc += r.v * gdt * (1.1 + this.edgeK * 2);
    while (this.sprayAcc >= 1) {
      this.sprayAcc -= 1;
      this.v1
        .copy(r.pos)
        .addScaledVector(f.t, 0.9 + this.rand() * 0.8)
        .addScaledVector(f.b, (this.rand() - 0.5) * 0.7);
      this.v3
        .copy(f.t)
        .multiplyScalar(r.v * (0.45 + this.rand() * 0.3))
        .addScaledVector(nIn, 0.8 + this.rand() * 2.4)
        .addScaledVector(f.b, (this.rand() - 0.5) * 2.5);
      this.spray.spawn(this.v1, this.v3, 0.3 + this.rand() * 0.35, 0.025 + this.rand() * 0.05, 0.9);
    }
  }

  private updateWorld(gdt: number): void {
    const r = this.rider;
    const sharks = this.world.sharks;
    this.hunt.rider.copy(r.pos);
    sharks.update(gdt, this.gameTime, this.phase === 'ride' && this.doomed ? this.hunt : null);
    for (const s of sharks.splashes) {
      seaSplash(this.spray, s.at, s.scale, this.rand);
      this.audio.splash();
    }
    sharks.splashes.length = 0;
    if (this.phase === 'ride' && r.mode === 'track') this.emitSpray(gdt);
    this.spray.update(gdt);
  }

  private present(dt: number): void {
    const r = this.rider;
    const w = this.world;
    const rig = this.rig;
    const phase = this.phase;
    const riding = phase === 'ride';
    const dread = this.doomed && riding ? smoothstep(0, 1.2, this.doomT) : 0;

    // --- camera: during a doomed fall the head is pulled towards the impact point, then the jaws
    let lookAt: THREE.Vector3 | null = null;
    let lookW = 0;
    if (this.doomed && riding) {
      const T = this.hunt.timeLeft;
      if (T < RISE_TIME + 3 && w.sharks.hunting) {
        lookAt = w.sharks.mouthPosition(this.v3);
        lookW = lerp(0.5, 0.92, smoothstep(RISE_TIME + 3, 0.6, T));
      } else {
        lookAt = this.hunt.point;
        lookW = 0.5 * smoothstep(0, 0.8, this.doomT);
      }
    }
    // final approach: narrow the FOV so the jaws swell to fill the view
    const approach = this.doomed && riding ? smoothstep(RISE_TIME + 0.8, 0.2, this.hunt.timeLeft) : phase === 'eaten' ? 1 : 0;
    const menu = phase === 'menu';
    rig.update(dt, this.time, r, this.track, {
      steer: riding ? this.cmd.steer : 0,
      throttle: riding ? this.cmd.throttle : 0,
      lookYaw: menu ? Math.sin(this.time * 0.13) * 1.2 : this.input.lookYaw,
      lookPitch: menu ? -0.2 + Math.sin(this.time * 0.09) * 0.2 : this.input.lookPitch,
      lookAt,
      lookAtWeight: lookW,
      fovBoost: dread * 8 - approach * 36,
    });
    const cam = rig.camera;
    const eye = rig.eyePosition;
    w.visuals.update(this.time);
    w.ocean.update(this.time, cam);
    w.clouds.update(cam, this.time);
    const speed = riding || phase === 'countdown' ? r.vel.length() : 0;
    this.lines.update(eye, r.vel, riding ? clamp((speed - 30) / 50, 0, 1) : 0);
    this.spray.setPixelScale(this.renderer.domElement.height, cam.fov);

    // --- edge warnings (theta > 0 = right wall)
    let edgeL = 0;
    let edgeR = 0;
    this.edgeK = 0;
    if (riding && r.mode === 'track') {
      this.edgeK = smoothstep(0.5, 0.92, Math.abs(r.theta) / PHYS.lipAngle);
      if (r.theta < 0) edgeL = this.edgeK;
      else edgeR = this.edgeK;
      this.edgeWarnCd -= dt;
      if (this.edgeK > 0.6 && this.edgeWarnCd <= 0) {
        this.audio.warn();
        this.edgeWarnCd = 1.4;
      }
    }

    // --- landing reticle
    if (riding && r.mode === 'air' && this.pred.kind !== 'none' && approach < 0.4) {
      const p = this.v1.copy(this.pred.point).project(cam);
      if (p.z < 1) {
        const W = window.innerWidth;
        const H = window.innerHeight;
        const left = Math.max(0, this.pred.t - (this.gameTime - this.predAt));
        const land = this.pred.kind === 'land';
        this.hud.setReticle({
          x: clamp((p.x * 0.5 + 0.5) * W, 40, W - 40),
          y: clamp((-p.y * 0.5 + 0.5) * H, 40, H - 40),
          kind: land ? 'land' : 'sea',
          text: land ? `落点 ${left.toFixed(1)}s` : this.doomed ? '鲨鱼！' : '调整方向',
        });
      } else this.hud.setReticle(null);
    } else this.hud.setReticle(null);

    // --- post fx
    const fx = this.fx.params;
    const sp = smoothstep(22, 85, speed);
    const vel = this.v2.copy(r.vel);
    if (speed > 2) {
      const p = vel.normalize().multiplyScalar(10).add(eye).project(cam);
      if (p.z < 1) this.c2.set(clamp(p.x * 0.5 + 0.5, 0.15, 0.85), clamp(p.y * 0.5 + 0.5, 0.15, 0.85));
      else this.c2.set(0.5, 0.5);
    } else this.c2.set(0.5, 0.5);
    fx.center.lerp(this.c2, damp(6, dt));
    const k = damp(6, dt);
    fx.blur += (sp * (r.mode === 'air' ? 1 : 0.85) - fx.blur) * k;
    fx.aberration += (sp * 0.7 + dread * 0.6 - fx.aberration) * k;
    fx.vignette = 0.35 + (riding ? Math.max(0, this.cmd.throttle) * 0.12 : 0) + dread * 0.35;
    fx.danger = Math.max(this.edgeK * 0.45, dread * (0.55 + 0.35 * Math.sin(this.time * 7)));
    fx.desat = dread * 0.4;
    fx.white = w.clouds.density(eye) * 0.9;
    this.flash *= Math.exp(-dt * 5);
    fx.flash = this.flash;
    if (phase === 'eaten' || phase === 'over') {
      const t = phase === 'eaten' ? this.phaseT : 3;
      fx.gore = smoothstep(0.08, 0.35, t) * 0.92;
      fx.black = smoothstep(0.7, 1.9, t) * 0.8;
      this.hud.setJaws(smoothstep(0.1, 0.28, t));
    } else {
      fx.gore = 0;
      fx.black = 0;
    }
    if (phase === 'countdown' || riding) this.fade = Math.max(0, this.fade - dt / 0.6);
    this.hud.setFade(this.fade);

    // --- HUD + audio
    this.hud.update(
      {
        altitude: r.pos.y,
        maxAltitude: LEVEL.start.pos[1],
        speed,
        g: r.mode === 'track' ? r.gForce : 0,
        air: r.mode === 'air' ? r.airTime : 0,
        progress: this.progress,
        checkpoint: this.cpIndex,
        checkpoints: LEVEL.checkpoints.length - 1,
        time: this.runTime,
        deaths: this.deaths,
        edgeLeft: edgeL,
        edgeRight: edgeR,
      },
      dt,
    );
    this.audio.update(dt, {
      speed: riding ? speed : 0,
      onTrack: riding && r.mode === 'track',
      inAir: riding && r.mode === 'air',
      edge: this.edgeK,
      dread,
      impactIn: this.doomed ? this.hunt.timeLeft : 99,
      timeScale: this.timeScale,
    });
    this.fx.render(this.time);
  }

  /** Snapshot for automated checks (?debug). */
  debugState(): Record<string, unknown> {
    const r = this.rider;
    return {
      phase: this.phase,
      paused: this.paused,
      mode: r.mode,
      seg: r.seg,
      s: Math.round(r.s),
      theta: Math.round((r.theta * 180) / Math.PI),
      y: Math.round(r.pos.y),
      speed: Math.round(r.vel.length() * 3.6),
      checkpoint: this.cpIndex,
      deaths: this.deaths,
      doomed: this.doomed,
      hunting: this.world.sharks.hunting,
      timeLeft: Number(this.hunt.timeLeft.toFixed(2)),
      timeScale: Number(this.timeScale.toFixed(2)),
      runTime: Number(this.runTime.toFixed(1)),
      sharksFallback: this.world.sharks.usedFallback,
    };
  }
}
