import { interleaveParams, readInterleaveConfig } from '../fx/interleave.ts';
import type { InterleaveConfig } from '../fx/interleave.ts';
import type { PostFX } from '../fx/postfx.ts';
import { t } from '../i18n.ts';

const fields = ['pitch', 'slant', 'offset', 'views', 'span', 'focus', 'scale'] as const;

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing stereo control: ${id}`);
  return node as T;
}

/** Calibration pauses gameplay; native dialog keeps editing keys out of the game. */
export class StereoPanel {
  private readonly dialog = element<HTMLDialogElement>('stereo-panel');
  private readonly form = element<HTMLFormElement>('stereo-form');
  private readonly mode = element<HTMLSelectElement>('stereo-mode');
  private readonly preview = element<HTMLInputElement>('stereo-preview');
  private readonly status = element<HTMLElement>('stereo-status');
  private readonly link = element<HTMLInputElement>('stereo-link');
  private readonly fx: PostFX;
  private readonly render: (resize: boolean) => void;
  private returnFocus: HTMLElement | null = null;

  get open(): boolean { return this.dialog.open; }

  constructor(fx: PostFX, beforeOpen: () => void, render: (resize: boolean) => void) {
    this.fx = fx; this.render = render;
    document.querySelectorAll('[data-stereo-settings]').forEach(button => button.addEventListener('click', () => {
      this.returnFocus = button instanceof HTMLElement ? button : null;
      beforeOpen();
      this.fill();
      this.status.textContent = '';
      document.body.classList.add('stereo-calibrating');
      this.dialog.showModal();
    }));
    this.dialog.addEventListener('close', () => {
      document.body.classList.remove('stereo-calibrating');
      this.returnFocus?.focus();
    });
    this.dialog.addEventListener('keydown', e => e.stopPropagation());
    element<HTMLButtonElement>('stereo-close').addEventListener('click', () => this.dialog.close());
    this.form.addEventListener('submit', e => { e.preventDefault(); this.apply(); });
    this.form.addEventListener('input', e => {
      if (e.target instanceof HTMLInputElement && e.target !== this.preview && e.target !== this.link) {
        this.status.textContent = t('stereoPending');
      }
    });
    this.mode.addEventListener('change', () => this.changeMode());
    this.preview.addEventListener('input', () => {
      this.fx.setPreviewView(Number(this.preview.value) - 1);
      this.render(false);
      this.refreshPreview();
      this.refreshLink();
    });
    element<HTMLButtonElement>('stereo-reset').addEventListener('click', () => {
      this.fx.setInterleaveConfig(readInterleaveConfig(new URLSearchParams()));
      this.fx.setPreviewView(-1);
      this.render(true);
      this.fill();
      this.status.textContent = t('stereoResetDone');
    });
    element<HTMLButtonElement>('stereo-copy').addEventListener('click', () => {
      this.refreshLink();
      void this.copyLink();
    });
  }

  private fill(): void {
    const config = this.fx.interleaveConfig;
    for (const key of fields) element<HTMLInputElement>(`stereo-${key}`).value = String(config[key]);
    element<HTMLInputElement>('stereo-reverse').checked = config.reverse;
    this.mode.value = !this.fx.interleaved ? 'normal' : this.fx.previewView >= 0 ? 'view' : 'interleave';
    this.preview.value = String(Math.max(0, this.fx.previewView) + 1);
    this.refreshPreview(); this.refreshLink();
  }

  private apply(): void {
    if (!this.form.reportValidity()) return;
    const config: InterleaveConfig = this.fx.interleaveConfig;
    for (const key of fields) {
      const value = element<HTMLInputElement>(`stereo-${key}`).valueAsNumber;
      if (!Number.isFinite(value)) { this.status.textContent = t('stereoInvalid'); return; }
      config[key] = value;
    }
    config.reverse = element<HTMLInputElement>('stereo-reverse').checked;
    this.fx.setInterleaveConfig(config);
    this.render(true);
    this.refreshPreview(); this.refreshLink();
    this.status.textContent = t('stereoApplied');
  }

  private changeMode(): void {
    this.fx.setInterleaved(this.mode.value !== 'normal');
    this.fx.setPreviewView(this.mode.value === 'view' ? Number(this.preview.value) - 1 : -1);
    this.render(true);
    this.refreshPreview(); this.refreshLink();
  }

  private refreshPreview(): void {
    this.preview.max = String(this.fx.interleaveConfig.views);
    this.preview.value = String(Math.min(Number(this.preview.value), this.fx.interleaveConfig.views));
    this.preview.disabled = this.mode.value !== 'view';
    element<HTMLOutputElement>('stereo-view-label').textContent = t('stereoViewNumber', {
      current: this.preview.value, total: this.fx.interleaveConfig.views,
    });
  }

  private refreshLink(): void {
    const url = new URL(location.href);
    interleaveParams(this.fx.interleaveConfig).forEach((value, key) => url.searchParams.set(key, value));
    url.searchParams.delete('interleave'); url.searchParams.delete('previewView');
    if (this.fx.interleaved) url.searchParams.set('interleave', '');
    if (this.fx.interleaved && this.fx.previewView >= 0) url.searchParams.set('previewView', String(this.fx.previewView + 1));
    this.link.value = url.href;
  }

  private async copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.link.value);
      this.status.textContent = t('stereoCopied');
    } catch {
      this.link.focus(); this.link.select();
      this.status.textContent = t('stereoCopyFallback');
    }
  }
}
