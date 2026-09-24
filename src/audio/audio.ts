import { clamp } from '../core/math.ts';

/** Per-frame audio drivers. */
export interface AudioState {
  speed: number;
  onTrack: boolean;
  inAir: boolean;
  /** 0..1 how close to flying off the lip */
  edge: number;
  /** 0..1 dread (doomed fall) */
  dread: number;
  /** seconds until the jaws (only when doomed) */
  impactIn: number;
  timeScale: number;
}

interface WindowWithWebkit extends Window {
  webkitAudioContext?: typeof AudioContext;
}

/** Fully synthesised sound: wind, slide rumble, seam clicks, heartbeat, shark ostinato, stingers. */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private hissGain: GainNode | null = null;
  private rumbleGain: GainNode | null = null;
  private rumbleFilter: BiquadFilterNode | null = null;
  private droneGain: GainNode | null = null;
  private seamDist = 0;
  private nextBeat = 0;
  private nextNote = 0;
  private noteFlip = false;
  private muted = false;
  available = true;

  /** Must be called from a user gesture. */
  init(): void {
    if (this.ctx) {
      this.ctx.resume().catch(() => {
        this.available = false;
      });
      return;
    }
    const w: WindowWithWebkit = window;
    const Ctor = window.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) {
      this.available = false;
      return;
    }
    const ctx = new Ctor();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);
    this.master = master;

    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      b = 0.97 * b + 0.03 * white; // a little pink-ish body
      d[i] = white * 0.6 + b * 3;
    }
    this.noise = buf;

    const loop = (filterType: BiquadFilterType, freq: number, q: number): [GainNode, BiquadFilterNode] => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.loopStart = Math.random();
      const f = ctx.createBiquadFilter();
      f.type = filterType;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(master);
      src.start();
      return [g, f];
    };
    [this.windGain, this.windFilter] = loop('bandpass', 500, 0.7);
    [this.hissGain] = loop('highpass', 3500, 0.5);
    [this.rumbleGain, this.rumbleFilter] = loop('lowpass', 180, 1.2);

    // low dread drone
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 41.2;
    const osc2 = ctx.createOscillator();
    osc2.type = 'sawtooth';
    osc2.frequency.value = 41.6;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 160;
    const dg = ctx.createGain();
    dg.gain.value = 0;
    osc.connect(lp);
    osc2.connect(lp);
    lp.connect(dg).connect(master);
    osc.start();
    osc2.start();
    this.droneGain = dg;
    ctx.resume().catch(() => {
      this.available = false;
    });
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  get isMuted(): boolean {
    return this.muted;
  }

  suspend(): void {
    this.ctx?.suspend().catch(() => {
      this.available = false;
    });
  }

  resume(): void {
    this.ctx?.resume().catch(() => {
      this.available = false;
    });
  }

  update(dt: number, s: AudioState): void {
    const ctx = this.ctx;
    if (!ctx || !this.windGain || !this.windFilter || !this.hissGain || !this.rumbleGain || !this.rumbleFilter || !this.droneGain) return;
    const t = ctx.currentTime;
    const sp = clamp(s.speed / 60, 0, 1.6);
    const slow = s.timeScale;
    const wind = (s.inAir ? 0.55 : 0.3) * sp * sp + 0.02;
    this.windGain.gain.setTargetAtTime(wind * (0.4 + 0.6 * slow), t, 0.08);
    this.windFilter.frequency.setTargetAtTime((300 + sp * 900) * (0.5 + 0.5 * slow), t, 0.1);
    this.hissGain.gain.setTargetAtTime(0.05 * sp * sp * slow, t, 0.1);
    this.rumbleGain.gain.setTargetAtTime(s.onTrack ? 0.25 + sp * 0.55 + s.edge * 0.4 : 0, t, 0.05);
    this.rumbleFilter.frequency.setTargetAtTime(120 + sp * 220, t, 0.1);
    this.droneGain.gain.setTargetAtTime(0.22 * s.dread, t, 0.3);

    // panel seams every 2 m -> rhythmic ticks that speed up with you
    if (s.onTrack) {
      this.seamDist += s.speed * dt;
      if (this.seamDist > 2) {
        this.seamDist %= 2;
        this.click(0.05 + sp * 0.08, 900 + Math.random() * 300);
      }
    }

    // heartbeat when on the edge or falling to your doom
    const fear = Math.max(s.edge * 0.8, s.dread);
    if (fear > 0.15) {
      const bpm = 70 + fear * 90;
      if (t >= this.nextBeat) {
        this.beat(0.35 + fear * 0.5);
        this.nextBeat = t + 60 / bpm;
      }
    } else this.nextBeat = t;

    // "da-dum" shark ostinato, accelerating as the jaws get closer
    if (s.dread > 0.05) {
      const interval = clamp(0.15 + s.impactIn * 0.09, 0.14, 0.75) / Math.max(0.35, slow);
      if (t >= this.nextNote) {
        this.noteFlip = !this.noteFlip;
        this.bassNote(this.noteFlip ? 82.41 : 87.31, 0.5 * s.dread);
        this.nextNote = t + interval;
      }
    } else this.nextNote = t;
  }

  private env(g: GainNode, t: number, peak: number, attack: number, decay: number): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  private burst(peak: number, decay: number, type: BiquadFilterType, freq: number, q = 1, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    src.connect(f).connect(g).connect(this.master);
    this.env(g, t, peak, 0.004, decay);
    src.start(t, Math.random() * 1.5);
    src.stop(t + decay + 0.05);
  }

  private tone(freq: number, peak: number, decay: number, type: OscillatorType = 'sine', delay = 0, glideTo = 0): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glideTo > 0) o.frequency.exponentialRampToValueAtTime(glideTo, t + decay);
    const g = ctx.createGain();
    o.connect(g).connect(this.master);
    this.env(g, t, peak, 0.01, decay);
    o.start(t);
    o.stop(t + decay + 0.05);
  }

  private click(peak: number, freq: number): void {
    this.burst(peak, 0.03, 'bandpass', freq, 2);
  }

  private beat(peak: number): void {
    this.tone(58, peak, 0.16, 'sine', 0, 40);
    this.tone(52, peak * 0.7, 0.18, 'sine', 0.2, 36);
  }

  private bassNote(freq: number, peak: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(900, t);
    f.frequency.exponentialRampToValueAtTime(140, t + 0.25);
    const g = ctx.createGain();
    o.connect(f).connect(g).connect(this.master);
    this.env(g, t, peak, 0.01, 0.3);
    o.start(t);
    o.stop(t + 0.35);
  }

  whoosh(): void {
    this.burst(0.5, 0.9, 'bandpass', 700, 0.6);
  }

  land(impact: number): void {
    const k = clamp(impact / 12, 0.2, 1.2);
    this.burst(0.8 * k, 0.35, 'lowpass', 400, 0.8);
    this.tone(90, 0.6 * k, 0.25, 'sine', 0, 45);
    this.burst(0.3 * k, 0.5, 'highpass', 2500, 0.5, 0.02); // water spray
  }

  checkpoint(): void {
    [659.25, 830.61, 987.77, 1318.5].forEach((f, i) => this.tone(f, 0.22, 0.5, 'triangle', i * 0.09));
  }

  countdown(final: boolean): void {
    this.tone(final ? 880 : 440, 0.3, final ? 0.6 : 0.25, 'square');
  }

  warn(): void {
    this.tone(1200, 0.12, 0.12, 'square');
    this.tone(1200, 0.12, 0.12, 'square', 0.16);
  }

  splash(): void {
    this.burst(1.0, 1.4, 'lowpass', 1200, 0.5);
    this.burst(0.5, 1.8, 'highpass', 3000, 0.4, 0.05);
  }

  chomp(): void {
    this.burst(1.2, 0.25, 'lowpass', 700, 1);
    this.tone(70, 1.0, 0.6, 'sawtooth', 0, 30);
    this.burst(0.9, 0.12, 'bandpass', 2500, 3, 0.05); // crunch
    this.burst(0.7, 0.9, 'lowpass', 300, 0.5, 0.12);
    this.tone(41, 0.8, 2.5, 'sawtooth', 0.3, 30);
  }

  finish(): void {
    [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => this.tone(f, 0.25, 0.8, 'triangle', i * 0.12));
  }
}
