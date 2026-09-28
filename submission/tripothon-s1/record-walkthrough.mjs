// Capture a continuous, narrated Tripothon walkthrough from the live game.
// Start Vite first: npm run dev -- --port 5177 --strictPort
import { mkdirSync, createWriteStream, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const root = fileURLToPath(new URL('.', import.meta.url));
const work = join(root, 'work');
const port = process.env.PORT ?? '5177';
const fpsOut = 30;
const runSeconds = 116;
const missSection = 4;
const speedup = 2.5;
const rawFile = join(work, 'capture.mjpeg');
const narrationFile = join(work, 'walkthrough-narration.wav');
const videoFile = join(root, 'walkthrough.mp4');

mkdirSync(work, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: 2560, height: 1440, deviceScaleFactor: 1 },
});

const page = await browser.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
await page.evaluateOnNewDocument(() => localStorage.removeItem('high-slide.language'));
await page.goto(`http://127.0.0.1:${port}/?debug&autopilot&miss=${missSection}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game, { timeout: 120000 });
const initial = await page.evaluate(() => ({ lang: document.documentElement.lang, phase: window.__game.phase }));
if (initial.lang !== 'en' || initial.phase !== 'menu') throw new Error(`Expected English start menu, got ${JSON.stringify(initial)}`);

const client = await page.createCDPSession();
const raw = createWriteStream(rawFile);
let frameCount = 0;
let frameError = null;
client.on('Page.screencastFrame', ({ data, sessionId }) => {
  frameCount++;
  raw.write(Buffer.from(data, 'base64'));
  void client.send('Page.screencastFrameAck', { sessionId }).catch(error => { frameError ??= error; });
});
raw.on('error', error => { frameError ??= error; });
await client.send('Page.enable');
await client.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });

const captureTags = new Set();
const saved = [];
const takeStill = async (tag) => {
  if (captureTags.has(tag)) return;
  captureTags.add(tag);
  const path = join(root, `${tag}.png`);
  await page.screenshot({ path, type: 'png' });
  saved.push({ tag, path });
  console.log(`Captured ${tag}`);
};

await page.evaluate(multiplier => {
  const game = window.__game;
  game.renderer.setAnimationLoop(null);
  const present = game.present.bind(game);
  let presentFrame = 0;
  game.present = dt => {
    presentFrame++;
    if (presentFrame % 2 === 0) present(dt * 2);
  };
  window.realLast = 0;
  window.virtualLast = performance.now() / 1000;
  window.captureSpeed = multiplier;
  game.renderer.setAnimationLoop(now => {
    if (window.realLast !== 0) window.virtualLast += ((now - window.realLast) / 1000) * window.captureSpeed;
    window.realLast = now;
    game.frame(window.virtualLast);
  });
}, speedup);

console.log('Recording a continuous 1080p walkthrough.');
await new Promise(resolve => setTimeout(resolve, 3000));
const startedAt = Date.now();
await page.click('#btn-start');
let respawned = false;
let overAt = 0;
let finalState = null;
while ((Date.now() - startedAt) / 1000 < runSeconds) {
  const state = await page.evaluate(() => window.__game.debugState());
  finalState = state;
  if (state.phase === 'ride' && state.mode === 'track' && state.seg === 0 && state.runTime > 4) {
    await takeStill('visual-01-high-altitude');
  }
  if (state.phase === 'ride' && state.mode === 'air' && state.seg === 0 && !state.doomed) {
    await takeStill('visual-02-first-gap');
  }
  if (state.phase === 'ride' && state.mode === 'track' && state.seg === 2 && !state.doomed) {
    await takeStill('visual-03-open-ocean-track');
  }
  if (state.phase === 'ride' && state.doomed && state.timeLeft < 1.3 && state.timeLeft > 0.5) {
    await takeStill('visual-04-megalodon-approach');
  }
  if (state.phase === 'over' && !respawned) {
    if (overAt === 0) {
      overAt = Date.now();
      await takeStill('visual-05-game-over');
    }
    if (Date.now() - overAt > 1800) {
      await page.evaluate(() => { window.__game.opts.miss = -1; });
      await page.click('#btn-respawn');
      respawned = true;
      console.log('Disabled the scripted miss and respawned from the reached checkpoint.');
    }
  }
  if (respawned && state.phase === 'ride' && state.mode === 'track' && state.seg >= missSection) {
    await takeStill('visual-06-checkpoint-respawn');
  }
  if (state.phase === 'finished') await takeStill('visual-07-finish');
  await new Promise(resolve => setTimeout(resolve, 300));
}

await client.send('Page.stopScreencast');
raw.end();
await once(raw, 'close');
await browser.close();
if (frameError) throw frameError;
if (frameCount < 300) throw new Error(`Only captured ${frameCount} frames; refusing to create a low-quality video.`);
if (!respawned) throw new Error('The scripted failure and checkpoint respawn were not shown in the recording.');
if (!captureTags.has('visual-07-finish')) throw new Error(`The complete run did not reach the finish during the walkthrough: ${JSON.stringify(finalState)}`);
if (errors.length) throw new Error(`Browser errors: ${errors.slice(0, 5).join('; ')}`);

const seconds = (Date.now() - startedAt) / 1000 + 3;
const inputRate = frameCount / seconds;
const narrationSize = statSync(narrationFile).size;
if (narrationSize === 0) throw new Error('Narration audio is empty.');
console.log(`Captured ${frameCount} frames at an effective ${inputRate.toFixed(2)} fps over ${seconds.toFixed(1)} seconds.`);

const ffmpeg = spawn('ffmpeg', [
  '-y', '-hide_banner', '-loglevel', 'error',
  '-f', 'mjpeg', '-r', inputRate.toFixed(8), '-i', rawFile,
  '-i', narrationFile,
  '-vf', `fps=${fpsOut}`,
  '-filter_complex', `[1:a]adelay=2200:all=1,apad,atrim=0:${seconds.toFixed(2)},afade=t=out:st=${Math.max(0, seconds - 2).toFixed(2)}:d=2,volume=0.92[audio]`,
  '-map', '0:v:0', '-map', '[audio]',
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '160k', '-t', seconds.toFixed(2), '-movflags', '+faststart', videoFile,
], { stdio: ['ignore', 'inherit', 'inherit'] });
const [exitCode] = await once(ffmpeg, 'close');
if (exitCode !== 0) throw new Error(`ffmpeg exited with status ${exitCode}`);
console.log(`Wrote ${videoFile}`);
console.log(`Stills: ${saved.map(({ tag }) => tag).join(', ')}`);
