export type ScreenId = 'screen-start' | 'screen-pause' | 'screen-over' | 'screen-finish';
export type MsgKind = 'good' | 'warn' | 'bad' | 'cp' | '';

export interface HudData {
  altitude: number;
  maxAltitude: number;
  speed: number;
  g: number;
  air: number;
  /** 0..1 along the whole course */
  progress: number;
  checkpoint: number;
  checkpoints: number;
  time: number;
  deaths: number;
  edgeLeft: number;
  edgeRight: number;
}

export interface ReticleData {
  x: number;
  y: number;
  kind: 'land' | 'sea';
  text: string;
}

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`missing #${id}`);
  return e as T;
}

export function formatTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
}

/** DOM overlay: gauges, messages, landing reticle, jaws, fades and modal screens. */
export class Hud {
  private readonly root = el('hud');
  private readonly altVal = el('alt-val');
  private readonly altFill = el('alt-fill');
  private readonly altMark = el('alt-mark');
  private readonly altGauge = this.altVal.closest('.gauge') as HTMLElement;
  private readonly spdVal = el('spd-val');
  private readonly gVal = el('g-val');
  private readonly airVal = el('air-val');
  private readonly progTrack = el('prog-track');
  private readonly progFill = el('prog-fill');
  private readonly progDot = el('prog-dot');
  private readonly cpVal = el('cp-val');
  private readonly timeVal = el('time-val');
  private readonly deathVal = el('death-val');
  private readonly edgeL = el('edge-l');
  private readonly edgeR = el('edge-r');
  private readonly reticle = el('reticle');
  private readonly reticleTxt = el('reticle-txt');
  private readonly msg = el('msg');
  private readonly subMsg = el('sub-msg');
  private readonly hint = el('hint');
  private readonly jawsEl = el('jaws');
  private readonly jawTop = this.jawsEl.querySelector('.jaw.top') as SVGElement;
  private readonly jawBottom = this.jawsEl.querySelector('.jaw.bottom') as SVGElement;
  private readonly fadeEl = el('fade');
  private readonly loading = el('loading');
  private readonly loadFill = el('load-fill');
  private readonly loadTxt = el('load-txt');
  private readonly cpTicks: HTMLElement[] = [];
  private msgTimer = 0;
  private subTimer = 0;
  private open: HTMLElement | null = null;
  private returnFocus: HTMLElement | null = null;
  private last = { alt: '', spd: '', g: '', air: '', time: '', cp: '', death: '' };

  constructor() {
    // keep keyboard focus inside the open modal
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab' || !this.open) return;
      const items = Array.from(this.open.querySelectorAll<HTMLElement>('button:not([disabled])'));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (!this.open.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      }
    });
  }

  setLoading(p: number, text: string): void {
    this.loadFill.style.width = `${Math.round(p * 100)}%`;
    this.loadTxt.textContent = text;
  }

  loadingError(text: string): void {
    this.loadTxt.textContent = text;
    this.loading.setAttribute('aria-busy', 'false');
  }

  hideLoading(): void {
    this.loading.setAttribute('aria-busy', 'false');
    this.loading.classList.add('hidden');
  }

  /** Progress-bar ticks: gaps (red) and checkpoints (lit when reached). */
  buildTicks(gaps: number[], checkpoints: number[]): void {
    for (const g of gaps) {
      const t = document.createElement('div');
      t.className = 'prog-tick gap';
      t.style.left = `${g * 100}%`;
      this.progTrack.appendChild(t);
    }
    for (const c of checkpoints) {
      const t = document.createElement('div');
      t.className = 'prog-tick';
      t.style.left = `${c * 100}%`;
      this.progTrack.appendChild(t);
      this.cpTicks.push(t);
    }
  }

  showHud(v: boolean): void {
    this.root.classList.toggle('hidden', !v);
  }

  update(d: HudData, dt: number): void {
    const alt = String(Math.max(0, Math.round(d.altitude)));
    if (alt !== this.last.alt) {
      this.altVal.textContent = alt;
      this.last.alt = alt;
      const k = Math.max(0, Math.min(1, d.altitude / d.maxAltitude));
      this.altFill.style.height = `${k * 100}%`;
      this.altMark.style.bottom = `calc(${k * 100}% - 1px)`;
      this.altGauge.classList.toggle('low', d.altitude < 60);
    }
    const spd = String(Math.round(d.speed * 3.6));
    if (spd !== this.last.spd) this.spdVal.textContent = this.last.spd = spd;
    const g = d.g.toFixed(1);
    if (g !== this.last.g) this.gVal.textContent = this.last.g = g;
    const air = d.air.toFixed(1);
    if (air !== this.last.air) this.airVal.textContent = this.last.air = air;
    const time = formatTime(d.time);
    if (time !== this.last.time) this.timeVal.textContent = this.last.time = time;
    const cp = `检查点 ${d.checkpoint}/${d.checkpoints}`;
    if (cp !== this.last.cp) {
      this.cpVal.textContent = this.last.cp = cp;
      this.cpTicks.forEach((t, i) => t.classList.toggle('on', i < d.checkpoint));
    }
    const death = d.deaths > 0 ? `葬身鲨腹 ×${d.deaths}` : '';
    if (death !== this.last.death) this.deathVal.textContent = this.last.death = death;
    const p = `${(Math.max(0, Math.min(1, d.progress)) * 100).toFixed(2)}%`;
    this.progFill.style.width = p;
    this.progDot.style.left = p;
    this.edgeL.style.opacity = d.edgeLeft.toFixed(2);
    this.edgeR.style.opacity = d.edgeRight.toFixed(2);

    if (this.msgTimer > 0) {
      this.msgTimer -= dt;
      if (this.msgTimer <= 0) this.msg.classList.remove('show');
    }
    if (this.subTimer > 0) {
      this.subTimer -= dt;
      if (this.subTimer <= 0) this.subMsg.classList.remove('show');
    }
  }

  message(text: string, kind: MsgKind, duration = 1.6, sub = ''): void {
    this.msg.textContent = text;
    this.msg.className = `show ${kind}`;
    this.msgTimer = duration;
    if (sub) {
      this.subMsg.textContent = sub;
      this.subMsg.classList.add('show');
      this.subTimer = duration + 0.4;
    }
  }

  clearMessage(): void {
    this.msgTimer = 0;
    this.subTimer = 0;
    this.msg.classList.remove('show');
    this.subMsg.classList.remove('show');
  }

  fadeHint(): void {
    this.hint.style.opacity = '0';
  }

  setReticle(r: ReticleData | null): void {
    if (!r) {
      this.reticle.classList.add('hidden');
      return;
    }
    this.reticle.classList.remove('hidden');
    this.reticle.classList.toggle('sea', r.kind === 'sea');
    this.reticle.style.transform = `translate(${r.x.toFixed(1)}px, ${r.y.toFixed(1)}px)`;
    if (this.reticleTxt.textContent !== r.text) this.reticleTxt.textContent = r.text;
  }

  /** 0 = open, 1 = jaws slammed shut over the screen. */
  setJaws(k: number): void {
    if (k <= 0) {
      this.jawsEl.classList.add('hidden');
      return;
    }
    this.jawsEl.classList.remove('hidden');
    const top = -105 + k * 105 * 0.93;
    this.jawTop.style.transform = `translateY(${top}%)`;
    this.jawBottom.style.transform = `translateY(${-top}%)`;
  }

  setFade(k: number): void {
    this.fadeEl.style.opacity = k.toFixed(3);
  }

  setStats(id: 'over-stats' | 'finish-stats' | 'start-note', lines: [string, string][]): void {
    // built with DOM nodes (no innerHTML): label + bold value per line
    const box = el(id);
    box.replaceChildren();
    lines.forEach(([label, value], i) => {
      if (i > 0) box.appendChild(document.createElement('br'));
      box.appendChild(document.createTextNode(label ? `${label} ` : ''));
      const b = document.createElement('b');
      b.textContent = value;
      box.appendChild(b);
    });
  }

  setText(id: string, text: string): void {
    el(id).textContent = text;
  }

  get openScreen(): ScreenId | null {
    return (this.open?.id as ScreenId | undefined) ?? null;
  }

  /** Open a modal screen and focus its first button; remembers what had focus. */
  showScreen(id: ScreenId): void {
    if (this.open?.id === id) return;
    if (this.open) this.open.classList.add('hidden');
    else this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const s = el(id);
    s.classList.remove('hidden');
    this.open = s;
    const first = s.querySelector<HTMLElement>('button');
    first?.focus();
  }

  /** Close the modal and return focus to where it came from (the game canvas by default). */
  hideScreen(): void {
    if (!this.open) return;
    this.open.classList.add('hidden');
    this.open = null;
    const target = this.returnFocus && document.contains(this.returnFocus) ? this.returnFocus : el('view');
    target.focus();
    this.returnFocus = null;
  }
}
