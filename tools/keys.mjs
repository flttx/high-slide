// Keyboard-only smoke test: node tools/keys.mjs
// Starts with Enter, steers with A/D, pauses/resumes with Esc, mutes with M, restarts with R.
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--window-size=1280,720'],
  defaultViewport: { width: 1280, height: 720 },
});
const errors = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('http://127.0.0.1:5173/?debug', { waitUntil: 'load' });
  await page.waitForFunction(() => '__game' in window, { timeout: 120000 });
  const st = () => page.evaluate(() => window.__game.debugState());
  const focused = () => page.evaluate(() => document.activeElement?.id ?? '');
  check('start button focused', (await focused()) === 'btn-start', await focused());
  await page.keyboard.press('Enter');
  await wait(3000);
  let s = await st();
  check('Enter starts the run', s.phase === 'ride', s.phase);
  await page.keyboard.down('KeyD');
  await wait(1200);
  s = await st();
  await page.keyboard.up('KeyD');
  check('D steers to the right wall', s.theta > 5, `theta=${s.theta}`);
  await page.keyboard.down('KeyA');
  await wait(2000);
  s = await st();
  await page.keyboard.up('KeyA');
  check('A steers to the left wall', s.theta < -5, `theta=${s.theta}`);
  await page.keyboard.press('Escape');
  await wait(300);
  s = await st();
  const pauseVisible = await page.evaluate(() => !document.getElementById('screen-pause')?.classList.contains('hidden'));
  check('Esc pauses', s.paused && pauseVisible, `focus=${await focused()}`);
  const t1 = s.runTime;
  await wait(1000);
  check('time frozen while paused', (await st()).runTime === t1);
  await page.keyboard.press('KeyM');
  await wait(200);
  const mute = await page.evaluate(() => [document.getElementById('btn-mute')?.getAttribute('aria-pressed'), document.getElementById('btn-mute')?.textContent]);
  check('M toggles mute', mute[0] === 'true', mute.join(' '));
  await page.keyboard.press('Escape');
  await wait(500);
  s = await st();
  check('Esc resumes', !s.paused && s.runTime > t1, `run=${s.runTime}`);
  await wait(1500);
  await page.keyboard.press('KeyR');
  await wait(400);
  s = await st();
  check('R restarts from checkpoint', s.phase === 'countdown' && s.checkpoint === 0, `${s.phase} s=${s.s}`);
} finally {
  await browser.close();
  console.log(results.join('\n'));
  console.log(errors.length ? `errors:\n${errors.join('\n')}` : 'no page errors');
}
