import { clamp, damp } from '../core/math.ts';

const LEFT = ['KeyA', 'ArrowLeft'];
const RIGHT = ['KeyD', 'ArrowRight'];
const TUCK = ['KeyW', 'ArrowUp'];
const BRAKE = ['KeyS', 'ArrowDown'];
const CAPTURED = new Set([...LEFT, ...RIGHT, ...TUCK, ...BRAKE, 'Space']);

/** Keyboard + mouse (pointer-lock look) + gamepad + touch, merged into analog controls. */
export class Input {
  /** -1..1, + = right */
  steer = 0;
  /** -1..1, + = tuck / lean forward, - = brake / spread */
  throttle = 0;
  /** head look offsets (rad) */
  lookYaw = 0;
  lookPitch = 0;
  enabled = true;

  private readonly keys = new Set<string>();
  private readonly edges = new Set<string>();
  private mouseDX = 0;
  private mouseDY = 0;
  private lastMouse = -10;
  private touchSteer = 0;
  private touchTuck = false;
  private readonly padPrev: boolean[] = [];
  /** browsers refuse re-locking for ~1 s after Esc; retry later instead of giving up */
  private lockRetryAt = 0;
  private readonly el: HTMLElement;

  constructor(el: HTMLElement) {
    this.el = el;
    window.addEventListener('keydown', (e) => {
      if (CAPTURED.has(e.code)) e.preventDefault();
      if (!e.repeat) this.edges.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== this.el) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    const onTouch = (e: TouchEvent) => {
      if (!this.enabled) return;
      let s = 0;
      for (const t of Array.from(e.touches)) s += t.clientX < window.innerWidth / 2 ? -1 : 1;
      this.touchSteer = clamp(s, -1, 1);
      this.touchTuck = e.touches.length >= 2 && s === 0;
    };
    el.addEventListener('touchstart', onTouch, { passive: true });
    el.addEventListener('touchmove', onTouch, { passive: true });
    el.addEventListener('touchend', onTouch, { passive: true });
  }

  requestPointerLock(): void {
    if (performance.now() < this.lockRetryAt || document.pointerLockElement === this.el || !this.el.requestPointerLock) return;
    // pointer lock is optional (unavailable in some iframes); keyboard steering still works
    Promise.resolve()
      .then(() => this.el.requestPointerLock())
      .catch(() => {
        this.lockRetryAt = performance.now() + 1500;
      });
  }

  releasePointerLock(): void {
    if (document.pointerLockElement === this.el) document.exitPointerLock();
  }

  /** Edge-triggered key press since the last call to update(). */
  pressed(...codes: string[]): boolean {
    return codes.some((c) => this.edges.has(c));
  }

  private down(codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  update(dt: number, time: number): void {
    let steerT = 0;
    let throttleT = 0;
    if (this.down(LEFT)) steerT -= 1;
    if (this.down(RIGHT)) steerT += 1;
    if (this.down(TUCK)) throttleT += 1;
    if (this.down(BRAKE)) throttleT -= 1;
    if (this.touchSteer !== 0) steerT = this.touchSteer;
    if (this.touchTuck) throttleT = 1;

    let lookX = 0;
    let lookY = 0;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad) continue;
      const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85);
      const sx = dz(pad.axes[0] ?? 0);
      if (sx !== 0) steerT = sx;
      const rt = pad.buttons[7]?.value ?? 0;
      const lt = pad.buttons[6]?.value ?? 0;
      if (rt > 0.05 || lt > 0.05) throttleT = rt - lt;
      lookX = dz(pad.axes[2] ?? 0);
      lookY = dz(pad.axes[3] ?? 0);
      const map: [number, string][] = [
        [9, 'Escape'],
        [0, 'Enter'],
        [3, 'KeyR'],
      ];
      for (const [bi, code] of map) {
        const b = pad.buttons[bi]?.pressed ?? false;
        if (b && !this.padPrev[bi]) this.edges.add(code);
        this.padPrev[bi] = b;
      }
      break;
    }
    if (!this.enabled) {
      steerT = 0;
      throttleT = 0;
    }
    // keyboard gets a short ramp so steering feels analog
    this.steer += (steerT - this.steer) * damp(Math.abs(steerT) > Math.abs(this.steer) ? 9 : 14, dt);
    this.throttle += (throttleT - this.throttle) * damp(8, dt);

    if (this.mouseDX !== 0 || this.mouseDY !== 0) this.lastMouse = time;
    this.lookYaw = clamp(this.lookYaw - this.mouseDX * 0.0022 - lookX * dt * 2.2, -1.9, 1.9);
    this.lookPitch = clamp(this.lookPitch - this.mouseDY * 0.0022 - lookY * dt * 1.8, -1.2, 0.9);
    this.mouseDX = 0;
    this.mouseDY = 0;
    // head recentres when the player lets go of the mouse / stick
    if (time - this.lastMouse > 0.6 && lookX === 0 && lookY === 0) {
      const k = damp(2.5, dt);
      this.lookYaw -= this.lookYaw * k;
      this.lookPitch -= this.lookPitch * k;
    }
  }

  /** Call at the end of a frame so edge presses are seen by exactly one frame. */
  endFrame(): void {
    this.edges.clear();
  }
}
