// Render the 16:9 submission cover from the captured gameplay still.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const root = fileURLToPath(new URL('.', import.meta.url));
const background = await readFile(join(root, 'visual-01-high-altitude.png'));
const dataUrl = `data:image/png;base64,${background.toString('base64')}`;
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'],
  defaultViewport: { width: 2560, height: 1440, deviceScaleFactor: 1 },
});

try {
  const page = await browser.newPage();
  await page.setContent(`<!doctype html>
    <html><head><meta charset="utf-8"><style>
      * { box-sizing: border-box; }
      html, body { margin: 0; width: 2560px; height: 1440px; overflow: hidden; }
      body { position: relative; color: #f8fbff; font-family: "Segoe UI", Arial, sans-serif; }
      .scene { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
      .shade { position: absolute; inset: 0; background:
        linear-gradient(90deg, rgba(4, 19, 37, .76) 0%, rgba(5, 28, 49, .58) 32%, rgba(5, 28, 49, .15) 62%, transparent 78%),
        linear-gradient(180deg, rgba(4, 17, 31, .28), transparent 29%, transparent 70%, rgba(3, 15, 28, .20)); }
      .content { position: absolute; left: 144px; top: 173px; width: 1320px; }
      .eyebrow { display: flex; align-items: center; gap: 20px; color: #9beaff; font-size: 27px; font-weight: 700; letter-spacing: 8px; text-transform: uppercase; }
      .eyebrow::before { content: ""; display: block; width: 68px; height: 5px; background: #35d5ff; border-radius: 5px; }
      h1 { margin: 34px 0 0 -8px; font-size: 148px; line-height: .91; letter-spacing: -7px; font-weight: 900; text-shadow: 0 5px 32px rgba(1, 10, 20, .32); }
      h1 span { display: block; }
      h1 span:last-child { color: #a8f0ff; }
      .rule { width: 126px; height: 7px; margin: 43px 0 25px; background: #ff694e; border-radius: 8px; }
      .tagline { margin: 0; font-size: 34px; font-weight: 700; letter-spacing: 1px; text-shadow: 0 3px 18px rgba(0, 0, 0, .45); }
      .descriptor { margin: 24px 0 0; color: rgba(237, 247, 255, .84); font-size: 23px; letter-spacing: 5px; text-transform: uppercase; }
    </style></head><body>
      <img class="scene" src="${dataUrl}" alt="">
      <div class="shade"></div>
      <main class="content">
        <div class="eyebrow">TRIPOTHON S1 · GAME</div>
        <h1><span>MEGALODON</span><span>DROP</span></h1>
        <div class="rule"></div>
        <p class="tagline">Race the gaps. Evade the megalodon.</p>
        <p class="descriptor">A first-person high-altitude slide</p>
      </main>
    </body></html>`, { waitUntil: 'load' });
  await page.screenshot({ path: join(root, 'cover.jpg'), type: 'jpeg', quality: 94 });
} finally {
  await browser.close();
}
