import * as THREE from 'three';
import { Game, buildWorld } from './game/game.ts';
import { Hud } from './ui/hud.ts';
import { applyTranslations, getLanguage, setLanguage, t } from './i18n.ts';

const nextFrame = () =>
  new Promise<void>((resolve) => {
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      resolve();
    };
    requestAnimationFrame(go);
    // rAF stalls in background tabs; don't let loading hang on it
    setTimeout(go, 100);
  });

function createRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer | null {
  try {
    const r = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.5;
    r.setSize(window.innerWidth, window.innerHeight, false);
    return r;
  } catch {
    return null;
  }
}

async function main(hud: Hud): Promise<void> {
  let game: Game | null = null;
  document.querySelectorAll<HTMLButtonElement>('[data-language-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      setLanguage(getLanguage() === 'en' ? 'zh' : 'en');
      applyTranslations();
      game?.refreshLanguage();
    });
  });
  const canvas = document.getElementById('view');
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('missing canvas');
  const renderer = createRenderer(canvas);
  if (!renderer) {
    hud.loadingError(t('webglError'));
    return;
  }
  const progress = async (p: number, text: string) => {
    hud.setLoading(p, text);
    await nextFrame();
  };
  const world = await buildWorld(renderer, progress);
  await progress(0.85, t('loadShaders'));
  const params = new URLSearchParams(location.search);
  game = new Game(renderer, hud, world, {
    autopilot: params.has('autopilot'),
    miss: params.has('miss') ? Number(params.get('miss')) : -1,
    startCheckpoint: clampInt(Number(params.get('cp') ?? 0), 0, 3),
  });
  await game.compile();
  await progress(1, t('ready'));
  hud.hideLoading();
  game.showMenu();
  if (params.has('debug')) (window as unknown as { __game: Game }).__game = game;
  renderer.setAnimationLoop((t) => game.frame(t / 1000));
}

function clampInt(v: number, lo: number, hi: number): number {
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.floor(v))) : lo;
}

const hud = new Hud();
applyTranslations();
main(hud).catch(() => {
  hud.loadingError(t('loadError'));
});
