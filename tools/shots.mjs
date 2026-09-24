// Automated browser run: node tools/shots.mjs <name> "<query>" [maxSeconds]
// Loads the dev server, starts a run, logs state transitions and saves screenshots to tools/shots/.
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const [name = 'auto', query = 'autopilot', maxS = '240'] = process.argv.slice(2);
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const out = fileURLToPath(new URL('./shots/', import.meta.url));
mkdirSync(out, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--autoplay-policy=no-user-gesture-required', '--window-size=1280,720'],
  defaultViewport: { width: 1280, height: 720 },
});
const errors = [];
try {
  const page = await browser.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('response', (r) => {
    if (r.status() >= 400) errors.push(`http ${r.status()}: ${r.url()}`);
  });
  await page.goto(`http://127.0.0.1:5173/?debug&${query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => '__game' in window, { timeout: 120000 });
  const shot = async (tag) => {
    await page.screenshot({ path: `${out}${name}-${tag}.png` });
  };
  await new Promise((r) => setTimeout(r, 1500));
  await shot('menu');
  await page.click('#btn-start');
  const t0 = Date.now();
  let prev = '';
  const seen = new Set();
  let frames = 0;
  while (Date.now() - t0 < Number(maxS) * 1000) {
    await new Promise((r) => setTimeout(r, 250));
    const s = await page.evaluate(() => {
      const g = window.__game;
      const st = g.debugState();
      return st;
    });
    const key = `${s.phase}/${s.mode}/seg${s.seg}/doomed=${s.doomed}/cp${s.checkpoint}`;
    if (key !== prev) {
      console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s ${key} y=${s.y} v=${s.speed}km/h run=${s.runTime}s T=${s.timeLeft}`);
      prev = key;
    }
    const tags = [];
    if (s.phase === 'countdown') tags.push('countdown');
    if (s.phase === 'ride' && s.mode === 'track' && s.speed > 150) tags.push(`fast-seg${s.seg}`);
    if (s.phase === 'ride' && s.mode === 'air') tags.push(`air-seg${s.seg}`);
    if (s.doomed && s.timeLeft < 6) tags.push('doom-early');
    if (s.doomed && s.timeLeft < 2.2) tags.push('doom-rise');
    for (const k of [1.2, 0.6, 0.3, 0.12]) if (s.doomed && s.timeLeft < k) tags.push(`doom-${k}`);
    if (s.phase === 'eaten') tags.push('eaten');
    if (s.phase === 'over') tags.push('over');
    if (s.phase === 'finished') tags.push('finish');
    for (const t of tags) {
      if (seen.has(t)) continue;
      seen.add(t);
      await shot(t);
    }
    frames++;
    if (s.phase === 'over' || s.phase === 'finished') {
      await new Promise((r) => setTimeout(r, 800));
      await shot(`${s.phase}-final`);
      console.log('screen text:', await page.evaluate(() => document.querySelector('.screen:not(.hidden)')?.textContent?.replace(/\s+/g, ' ').trim()));
      if (s.phase === 'over' && query.includes('respawn')) {
        await page.click('#btn-respawn');
        await new Promise((r) => setTimeout(r, 4000));
        console.log('after respawn:', JSON.stringify(await page.evaluate(() => window.__game.debugState())));
        await shot('respawned');
      }
      break;
    }
  }
  console.log(`polls=${frames}`);
} finally {
  await browser.close();
  console.log(errors.length ? `console issues:\n${errors.slice(0, 20).join('\n')}` : 'no console errors');
}
