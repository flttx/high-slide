// Browser regression: PORT=5176 node tools/i18n-check.mjs (requires a running dev server).
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'],
  defaultViewport: { width: 1280, height: 720 },
});

try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });

  await page.goto(`http://127.0.0.1:${process.env.PORT ?? 5173}/?debug`);
  await page.evaluate(() => localStorage.removeItem('high-slide.language'));
  await page.reload();
  await page.waitForFunction(() => window.__game, { timeout: 120000 });
  await page.evaluate(() => window.__game.renderer.setAnimationLoop(null));

  let state = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    title: document.title,
    start: document.querySelector('#btn-start')?.textContent?.trim(),
    toggle: document.querySelector('#language-toggle')?.textContent,
    position: getComputedStyle(document.querySelector('#language-toggle')).position,
  }));
  assert.equal(state.lang, 'en', 'English should be the default locale');
  assert.equal(state.title, 'MEGALODON DROP');
  assert.match(state.start, /Start slide/);
  assert.equal(state.toggle, '中文');
  assert.equal(state.position, 'fixed', 'language switch should stay fixed on screen');

  await page.click('#language-toggle');
  state = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    title: document.title,
    start: document.querySelector('#btn-start')?.textContent?.trim(),
  }));
  assert.equal(state.lang, 'zh-CN');
  assert.equal(state.title, '巨齿鲨：深渊滑梯 · MEGALODON DROP');
  assert.match(state.start, /开始滑行/);

  await page.evaluate(() => {
    window.__game.hud.update({ altitude: 100, maxAltitude: 1680, speed: 0, g: 1, air: 0, progress: 0, checkpoint: 1, checkpoints: 3, time: 0, deaths: 2, edgeLeft: 0, edgeRight: 0 }, 0);
  });
  state = await page.evaluate(() => ({ checkpoint: document.querySelector('#cp-val')?.textContent, deaths: document.querySelector('#death-val')?.textContent }));
  assert.equal(state.checkpoint, '检查点 1/3');
  assert.equal(state.deaths, '葬身鲨腹 ×2');

  await page.click('#language-toggle');
  await page.evaluate(() => {
    window.__game.hud.update({ altitude: 100, maxAltitude: 1680, speed: 0, g: 1, air: 0, progress: 0, checkpoint: 1, checkpoints: 3, time: 0, deaths: 2, edgeLeft: 0, edgeRight: 0 }, 0);
  });
  state = await page.evaluate(() => ({ lang: document.documentElement.lang, checkpoint: document.querySelector('#cp-val')?.textContent, deaths: document.querySelector('#death-val')?.textContent }));
  assert.equal(state.lang, 'en');
  assert.equal(state.checkpoint, 'Checkpoint 1/3');
  assert.equal(state.deaths, 'Eaten ×2');

  await page.reload();
  await page.waitForFunction(() => window.__game, { timeout: 120000 });
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'en', 'the selected locale should persist across reloads');
  assert.deepEqual(errors, [], `browser errors: ${errors.join('; ')}`);
  console.log('Localization regression passed: English default, Chinese toggle, HUD strings, persistence, and no browser errors.');
} finally {
  await browser.close();
}
