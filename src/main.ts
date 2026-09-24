import * as THREE from 'three';
import { Game, buildWorld } from './game/game.ts';
import { Hud } from './ui/hud.ts';

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
  const canvas = document.getElementById('view');
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('missing canvas');
  const renderer = createRenderer(canvas);
  if (!renderer) {
    hud.loadingError('无法启动 WebGL。请使用最新版 Chrome / Edge / Firefox，并开启硬件加速。');
    return;
  }
  const progress = async (p: number, text: string) => {
    hud.setLoading(p, text);
    await nextFrame();
  };
  const world = await buildWorld(renderer, progress);
  await progress(0.85, '正在编译着色器…');
  const params = new URLSearchParams(location.search);
  const game = new Game(renderer, hud, world, {
    autopilot: params.has('autopilot'),
    miss: params.has('miss') ? Number(params.get('miss')) : -1,
    startCheckpoint: clampInt(Number(params.get('cp') ?? 0), 0, 3),
  });
  await game.compile();
  await progress(1, '准备就绪');
  hud.hideLoading();
  game.showMenu();
  if (params.has('debug')) (window as unknown as { __game: Game }).__game = game;
  renderer.setAnimationLoop((t) => game.frame(t / 1000));
}

function clampInt(v: number, lo: number, hi: number): number {
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.floor(v))) : lo;
}

const hud = new Hud();
main(hud).catch(() => {
  hud.loadingError('加载失败，请刷新页面重试。');
});
