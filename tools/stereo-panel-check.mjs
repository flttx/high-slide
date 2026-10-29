import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

assert.ok(process.env.PORT, 'Set PORT to the high-slide dev server');
const origin = `http://127.0.0.1:${process.env.PORT}`;
mkdirSync('tools/shots', { recursive: true });
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true, args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'],
  defaultViewport: { width: 1280, height: 900 },
});
try {
  await browser.defaultBrowserContext().overridePermissions(origin, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${origin}/?debug`);
  await page.waitForFunction(() => window.__game, { timeout: 120000 });
  await page.evaluate(() => window.__game.renderer.setAnimationLoop(null));
  await page.focus('#btn-start');
  await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.hasAttribute('data-stereo-settings')), true);
  await page.keyboard.press('Enter');
  assert.equal(await page.$eval('#stereo-panel', e => e.open), true);
  assert.equal(await page.$eval('#stereo-pitch', e => e.value), '10.0298');
  assert.equal(await page.$eval('#stereo-slant', e => e.value), '0.27781');
  assert.equal(await page.$eval('#stereo-preview', e => e.disabled), true);
  await page.focus('#stereo-views'); await page.keyboard.press('ArrowUp');
  assert.equal(await page.$eval('#stereo-views', e => e.value), '25', 'native number editing');
  assert.equal(await page.evaluate(() => window.__game.input.pressed('ArrowUp')), false, 'editing must not steer the game');
  const frozen = await page.evaluate(() => {
    const g = window.__game, before = g.gameTime;
    g.frame(10); g.frame(10.05);
    return before === g.gameTime;
  });
  assert.equal(frozen, true, 'panel freezes simulation');
  const fill = async values => page.evaluate(values => {
    for (const [key, value] of Object.entries(values)) {
      const input = document.querySelector(`#stereo-${key}`);
      input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, values);
  await fill({ pitch: 101 });
  await page.click('#stereo-form button[type=submit]');
  assert.equal(await page.evaluate(() => window.__game.fx.interleaveConfig.pitch), 10.0298, 'invalid input must not apply');
  await fill({ pitch: 10.04, slant: 0.28, offset: 2, views: 12, span: 0.08, focus: 12, scale: 0.125 });
  await page.click('#stereo-reverse');
  assert.equal(await page.evaluate(() => window.__game.fx.interleaveConfig.pitch), 10.0298, 'draft values do not rebuild rendering');
  await page.click('#stereo-form button[type=submit]');
  const expected = { pitch: 10.04, slant: 0.28, offset: 2, views: 12, span: 0.08, focus: 12, scale: 0.125, reverse: true };
  assert.deepEqual(await page.evaluate(() => window.__game.fx.interleaveConfig), expected);
  await page.select('#stereo-mode', 'view');
  const resources = await page.evaluate(() => {
    const g = window.__game;
    window.previousStereoMap = g.fx.interleave.map;
    g.renderer.info.autoReset = false; g.renderer.info.reset();
    const slider = document.querySelector('#stereo-preview');
    slider.value = '12'; slider.dispatchEvent(new Event('input', { bubbles: true }));
    const result = { calls: g.renderer.info.render.calls, view: g.fx.previewView, mapUnchanged: g.fx.interleave.map === window.previousStereoMap };
    g.renderer.info.autoReset = true;
    return result;
  });
  assert.equal(resources.view, 11); assert.equal(resources.mapUnchanged, true);
  assert.ok(resources.calls > 0 && resources.calls < 200, `single view should draw once, got ${resources.calls} calls`);
  await fill({ span: 0.09 }); await page.click('#stereo-form button[type=submit]');
  expected.span = 0.09;
  assert.equal(await page.evaluate(() => window.__game.fx.interleave.map === window.previousStereoMap), true, 'camera changes reuse mapping');
  const link = await page.$eval('#stereo-link', e => e.value);
  assert.equal(new URL(link).searchParams.get('previewView'), '12');
  assert.equal(new URL(link).searchParams.get('reverse'), '1');
  await page.click('#stereo-copy');
  await page.waitForFunction(() => document.querySelector('#stereo-status').textContent.includes('copied'));
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), link, 'native clipboard copy');
  await page.$eval('#stereo-panel', e => { e.scrollTop = 0; });
  await page.screenshot({ path: 'tools/shots/stereo-panel-desktop.png' });
  await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('denied'); } } }); });
  await page.click('#stereo-copy');
  await page.waitForFunction(() => document.querySelector('#stereo-status').textContent.includes('manually'));
  assert.equal(await page.evaluate(() => document.activeElement.id), 'stereo-link');
  await fill({ views: 4 }); await page.click('#stereo-form button[type=submit]');
  assert.equal(await page.evaluate(() => window.__game.fx.previewView), 3, 'fewer views clamp active preview');
  assert.equal(await page.$eval('#stereo-preview', e => e.value), '4');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#stereo-panel').open && !document.body.classList.contains('stereo-calibrating'));
  assert.equal(await page.evaluate(() => document.activeElement.hasAttribute('data-stereo-settings')), true, 'focus returns to opener');
  await page.goto(link);
  await page.waitForFunction(() => window.__game, { timeout: 120000 });
  await page.evaluate(() => window.__game.renderer.setAnimationLoop(null));
  assert.deepEqual(await page.evaluate(() => window.__game.fx.interleaveConfig), expected, 'configuration link round trip');
  assert.equal(await page.evaluate(() => window.__game.fx.previewView), 11);
  await page.click('#language-toggle');
  await page.click('#stereo-settings');
  assert.equal(await page.$eval('#stereo-title', e => e.textContent), '3D 调参');
  await page.select('#stereo-mode', 'normal');
  await page.select('#stereo-mode', 'interleave');
  assert.deepEqual(await page.evaluate(() => window.__game.fx.interleaveConfig), expected, 'mode toggles preserve calibration');
  await page.setViewport({ width: 390, height: 844 });
  const fits = await page.$eval('#stereo-panel', e => {
    const rect = e.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight && e.scrollWidth === e.clientWidth;
  });
  assert.equal(fits, true, 'narrow panel fits viewport without horizontal scrolling');
  await page.screenshot({ path: 'tools/shots/stereo-panel-mobile.png' });
  await page.click('#stereo-reset');
  const reset = await page.evaluate(() => window.__game.fx.interleaveConfig);
  assert.equal(reset.pitch, 10.0298); assert.equal(reset.slant, 0.27781); assert.equal(reset.views, 24); assert.equal(reset.reverse, false);
  await page.click('#stereo-close');
  await page.waitForFunction(() => !document.querySelector('#stereo-panel').open);
  await page.evaluate(() => {
    const g = window.__game; g.hud.hideScreen(); g.phase = 'ride'; g.paused = false;
  });
  await page.click('#stereo-settings');
  assert.equal(await page.evaluate(() => window.__game.paused), true, 'opening while riding pauses the game');
  const airTime = await page.evaluate(() => window.__game.rider.airTime);
  await page.evaluate(() => { window.__game.frame(20); window.__game.frame(20.05); });
  assert.equal(await page.evaluate(() => window.__game.rider.airTime), airTime, 'calibration must not consume airborne time');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#stereo-panel').open);
  assert.equal(await page.evaluate(() => window.__game.paused), true, 'closing returns to pause; no surprise resume');
  assert.deepEqual(errors, []);
  console.log('PASS panel: keyboard, pause, invalid/draft inputs, apply, single-view draw count, map reuse, copy fallback, URL round trip, reset, Chinese, and narrow viewport', resources);
} finally { await browser.close(); }
