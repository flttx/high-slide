// Fixed views for the glare regression. Start Vite first; PORT and CHROME are optional.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

mkdirSync('tools/shots', { recursive: true });
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'],
  defaultViewport: { width: 1280, height: 720 },
});
try {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${process.env.PORT ?? 5173}/?debug`);
  await page.waitForFunction(() => window.__game, { timeout: 120000 });
  await page.evaluate(() => {
    const g = window.__game;
    g.renderer.setAnimationLoop(null); g.paused = true; g.phase = 'ride';
    g.hud.hideScreen(); g.hud.showHud(true);
  });
  for (const height of [1620, 1470, 820, 700, 162, 70]) {
    const stats = await page.evaluate(height => {
      const g = window.__game;
      let best = { delta: Infinity, seg: 0, s: 0 };
      for (const seg of g.track.segments) for (let i = 0; i < seg.count; i++) {
        const delta = Math.abs(seg.pos[i * 3 + 1] - height);
        if (delta < best.delta) best = { delta, seg: seg.index, s: i };
      }
      g.rider.place(best.seg, best.s, 195 / 3.6); g.rig.reset(); g.time = 110;
      if (height === 162) window.lightingGlareView = { seg: best.seg, s: best.s };
      for (let i = 0; i < 90; i++) g.present(1 / 60);
      const target = g.fx.bloom.renderTargetBright;
      const pixels = new Uint16Array(target.width * target.height * 4);
      g.renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, pixels);
      const half = n => {
        const exponent = (n >> 10) & 31, fraction = n & 1023;
        return (n >> 15 ? -1 : 1) * (exponent === 0 ? fraction * 2 ** -24
          : exponent === 31 ? Infinity : (1 + fraction / 1024) * 2 ** (exponent - 15));
      };
      let peak = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        const luminance = 0.2126 * half(pixels[i]) + 0.7152 * half(pixels[i + 1]) + 0.0722 * half(pixels[i + 2]);
        if (!Number.isFinite(luminance)) throw new Error('Non-finite bloom source');
        peak = Math.max(peak, luminance);
      }
      return { height, peak, cloudWhite: g.fx.params.white };
    }, height);
    assert.ok(stats.peak <= 1.01, `Unbounded sun glare at ${height} m: ${stats.peak}`);
    await page.screenshot({ path: `tools/shots/lighting-fixed-${height}.png` });
    console.log('PASS', JSON.stringify(stats));
  }
  // The same bright scene with bloom toggled must not wash out the foreground track/rider.
  await page.evaluate(() => {
    const g = window.__game;
    const view = window.lightingGlareView;
    g.rider.place(view.seg, view.s, 195 / 3.6); g.rig.reset();
    for (let i = 0; i < 90; i++) g.present(1 / 60);
  });
  const averages = [];
  for (const enabled of [false, true]) {
    await page.evaluate(enabled => {
      const g = window.__game; g.fx.bloom.enabled = enabled; g.fx.render(g.time);
    }, enabled);
    const png = await page.screenshot({ encoding: 'base64' });
    averages.push(await page.evaluate(async png => {
      const blob = new Blob([Uint8Array.from(atob(png), c => c.charCodeAt(0))], { type: 'image/png' });
      const bitmap = await createImageBitmap(blob), canvas = document.createElement('canvas');
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Screenshot decoding unavailable');
      ctx.drawImage(bitmap, 0, 0); bitmap.close();
      const pixels = ctx.getImageData(320, 360, 640, 280).data;
      let sum = 0;
      for (let i = 0; i < pixels.length; i += 4) sum += pixels[i] * 0.2126 + pixels[i + 1] * 0.7152 + pixels[i + 2] * 0.0722;
      return sum / (pixels.length / 4);
    }, png));
  }
  const veil = averages[1] - averages[0];
  assert.ok(veil >= 0 && veil < 12, `Bloom washes out foreground: +${veil.toFixed(2)} / 255`);
  assert.deepEqual(errors, []);
  console.log('PASS foreground readability', JSON.stringify({ withoutBloom: averages[0], withBloom: averages[1], veil }));
} finally { await browser.close(); }
