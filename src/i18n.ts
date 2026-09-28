const en = {
  gameName: 'MEGALODON DROP',
  canvasLabel: 'Game view: first-person high-altitude slide',
  altitude: 'Altitude', speed: 'Speed', airborne: 'Airborne', progress: 'Progress',
  checkpointCount: 'Checkpoint {current}/{total}', deathCount: 'Eaten ×{count}',
  controlsHint: 'A/D or ←/→ steer · W tuck to accelerate · S spread out to brake · Mouse look · Esc pause',
  loadingTitle: 'MEGALODON DROP', loading: 'Building the world…',
  loadTrack: 'Laying out the 1,680 m slide…', loadWorld: 'Creating the sky and ocean…',
  loadTrackCheckpoints: 'Building the slide and checkpoints…', loadClouds: 'Gathering the clouds…',
  loadShark: 'Waking the megalodon…', loadShaders: 'Compiling shaders…', ready: 'Ready',
  webglError: 'Could not start WebGL. Use a recent version of Chrome, Edge, or Firefox with hardware acceleration enabled.',
  loadError: 'Could not load the game. Refresh the page to try again.',
  startTagline: 'Race the gaps. Evade the megalodon. · 1,680 m above sea level',
  story: 'Launch from a platform above the clouds and race down an open slide toward the ocean. The slide breaks apart several times. Adjust your position in free fall and land on the next section below. ',
  storyEmphasis: 'A megalodon is waiting for you to make a mistake.',
  steerHelp: 'Steer (hugging the wall too high can throw you off)',
  speedHelp: 'Tuck to accelerate', speedHelpS: 'Spread out to brake',
  airHelp: 'You can steer, accelerate, and brake in the air. Aim for the ', landing: 'green landing marker',
  lookHelp: 'Look with the mouse · pause with Esc · mute with M',
  start: 'Start slide', startAria: 'Start game', languageSwitch: '中文', languageAria: 'Switch language to Chinese',
  sharkFallback: 'Could not load the megalodon model. Using the simplified model.', bestTime: 'Best time',
  paused: 'Paused', resume: 'Resume', resumeAria: 'Resume game', checkpointRestart: 'Restart at checkpoint', checkpointRestartAria: 'Restart from checkpoint',
  muteOn: 'Sound: on', muteOff: 'Sound: off', muteAria: 'Toggle sound',
  gameOver: 'GAME OVER', eatenByShark: 'The megalodon swallowed you whole', fallHeight: 'Fall height', eaten: 'Eaten by shark',
  respawnPoint: 'Respawn point', startPoint: 'Start', checkpoint: 'Checkpoint {index}', deaths: '{count} times',
  respawn: 'Respawn at checkpoint', respawnAria: 'Respawn at the latest checkpoint', restart: 'Restart from start', restartAria: 'Restart from the beginning',
  finishTitle: 'You made it!', finishDesc: 'You slid from 1,680 m above the ocean to the finish dock',
  playAgain: 'Play again', playAgainAria: 'Play again',
  totalTime: 'Total time', topSpeed: 'Top speed', longestAir: 'Longest airtime', maxG: 'Max G-force',
  go: 'GO!', leavingCheckpoint: 'Starting at checkpoint {index}', doomTitle: 'Megalodon approaching!', doomSub: 'You can no longer reach the slide…',
  checkpointReached: 'Checkpoint {current}/{total}', checkpointSub: 'You will respawn here if you hit the ocean',
  jump: 'Jump!', jumpHelp: 'A/D steer · W accelerate · S brake · aim for the green landing marker',
  flyoff: 'Thrown off the slide!', flyoffHelp: 'Steer quickly and look for the slide below',
  closeCall: 'That was close!', perfectLanding: 'Perfect landing!', reachedFinish: 'Finish line!',
  landingTime: 'Landing in {seconds}s', shark: 'Shark!', adjust: 'Adjust your direction',
  noScript: 'This game requires JavaScript and WebGL.',
} as const;

const zh: Record<keyof typeof en, string> = {
  gameName: '巨齿鲨：深渊滑梯', canvasLabel: '游戏画面：第一人称高空滑梯',
  altitude: '海拔', speed: '速度', airborne: '空中', progress: '进度',
  checkpointCount: '检查点 {current}/{total}', deathCount: '葬身鲨腹 ×{count}',
  controlsHint: 'A/D 或 ←/→ 转向 · W 俯身加速 · S 张开减速 · 鼠标环顾 · Esc 暂停',
  loadingTitle: '深渊滑梯', loading: '正在生成世界…',
  loadTrack: '正在铺设 1680 米高空滑梯…', loadWorld: '正在生成天空与海洋…',
  loadTrackCheckpoints: '正在搭建滑梯与检查点…', loadClouds: '正在堆积云层…', loadShark: '正在唤醒巨齿鲨…',
  loadShaders: '正在编译着色器…', ready: '准备就绪',
  webglError: '无法启动 WebGL。请使用最新版 Chrome、Edge 或 Firefox，并开启硬件加速。',
  loadError: '加载失败，请刷新页面重试。',
  startTagline: '飞跃断口，躲开巨齿鲨 · 海拔 1680 米',
  story: '从云端之上的跳台出发，沿着开放式滑梯一路冲向大海。滑梯在半空断开数次，你必须在自由落体中调整姿态，落进下方的下一段滑梯。',
  storyEmphasis: '海里的巨齿鲨一直在等你失手。',
  steerHelp: '转向（贴着墙太高会飞出去）', speedHelp: '俯身加速', speedHelpS: '张开四肢减速',
  airHelp: '空中同样可以转向、前冲或减速，瞄准', landing: '绿色落点',
  lookHelp: '鼠标环顾 · Esc 暂停 · M 静音', start: '开始滑行', startAria: '开始游戏',
  languageSwitch: 'English', languageAria: '切换游戏语言为英文',
  sharkFallback: '巨齿鲨模型加载失败，已使用简化模型。', bestTime: '最佳成绩',
  paused: '已暂停', resume: '继续', resumeAria: '继续游戏', checkpointRestart: '回到检查点', checkpointRestartAria: '从检查点重新开始',
  muteOn: '声音：开', muteOff: '声音：关', muteAria: '切换静音', gameOver: 'GAME OVER', eatenByShark: '你被巨齿鲨一口吞下',
  fallHeight: '坠落高度', eaten: '葬身鲨腹', respawnPoint: '复活位置', startPoint: '起点', checkpoint: '检查点 {index}', deaths: '{count} 次',
  respawn: '从检查点复活', respawnAria: '从最近的检查点复活', restart: '从头开始', restartAria: '从起点重新开始',
  finishTitle: '安全抵达！', finishDesc: '你从 1680 米高空一路滑进了终点码头', playAgain: '再来一次', playAgainAria: '再玩一次',
  totalTime: '总用时', topSpeed: '最高速度', longestAir: '最长滞空', maxG: '最大过载',
  go: 'GO!', leavingCheckpoint: '从检查点 {index} 出发', doomTitle: '巨齿鲨逼近！', doomSub: '已经够不到滑梯了……',
  checkpointReached: '检查点 {current}/{total}', checkpointSub: '坠海后将从这里复活', jump: '跳！',
  jumpHelp: 'A/D 调整方向 · W 前冲 · S 减速，对准绿色落点', flyoff: '飞出滑梯！', flyoffHelp: '快调整方向，寻找下方的滑梯',
  closeCall: '死里逃生！', perfectLanding: '完美落地！', reachedFinish: '抵达终点！',
  landingTime: '落点 {seconds}s', shark: '鲨鱼！', adjust: '调整方向', noScript: '本游戏需要启用 JavaScript 与 WebGL。',
};

export type Language = 'en' | 'zh';
export type TranslationKey = keyof typeof en;
type Values = Record<string, string | number>;
const STORAGE_KEY = 'high-slide.language';
let language: Language = readLanguage();

function readLanguage(): Language {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'zh' ? 'zh' : 'en';
  } catch {
    return 'en';
  }
}

export function getLanguage(): Language {
  return language;
}

export function setLanguage(value: Language): void {
  language = value;
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Language selection still applies for this session when storage is unavailable.
  }
}

export function t(key: TranslationKey, values: Values = {}): string {
  return (language === 'en' ? en[key] : zh[key]).replace(/\{(\w+)\}/g, (match, name: string) => String(values[name] ?? match));
}

function isTranslationKey(value: string): value is TranslationKey {
  return Object.prototype.hasOwnProperty.call(en, value);
}

export function applyTranslations(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((node) => {
    const key = node.dataset.i18n;
    if (key && isTranslationKey(key)) node.textContent = t(key);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-aria-label]').forEach((node) => {
    const key = node.dataset.i18nAriaLabel;
    if (key && isTranslationKey(key)) node.setAttribute('aria-label', t(key));
  });
  document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN';
  document.title = language === 'en' ? 'MEGALODON DROP' : `${t('gameName')} · MEGALODON DROP`;
  root.querySelectorAll<HTMLButtonElement>('[data-language-toggle]').forEach((button) => {
    button.textContent = t('languageSwitch');
    button.setAttribute('aria-label', t('languageAria'));
  });
}
