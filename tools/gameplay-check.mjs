// Browser regression: PORT=5176 node tools/gameplay-check.mjs (requires a running dev server).
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: 1280, height: 720 },
});
mkdirSync('tools/shots', { recursive: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  for (const [name, query, expected] of [
    ['gaps', 'autopilot', 'finished'],
    ['shortcut', 'autopilot', 'finished'],
    ['high', 'autopilot&miss=0', 'over'],
    ['middle', 'autopilot&cp=2&miss=4', 'over'],
    ['low', 'autopilot&cp=3&miss=7', 'over'],
  ]) {
    await page.goto(`http://127.0.0.1:${process.env.PORT ?? 5173}/?debug&${query}`);
    await page.waitForFunction(() => window.__game, { timeout: 120000 });
    await page.evaluate(name => {
      const g = window.__game;
      g.renderer.setAnimationLoop(null);
      window.checkVector = g.rider.pos.constructor;
      window.checkTime = g.last;
      window.checkPresent = g.present.bind(g);
      window.checkFrames = 0;
      window.checkSeen = new Set();
      window.checkDoom = null;
      window.checkBite = null;
      window.checkAimMin = 1;
      window.checkEarlyWarning = false;
      window.checkGapSegments = new Set();
      window.checkLandings = [];
      window.checkPause = name === 'middle';
      if (name === 'shortcut') {
        const control = g.control.bind(g);
        g.control = () => {
          const command = control();
          if (g.rider.mode === 'track') command.throttle = 1;
          return command;
        };
      }
      // Advance every physics frame; omit redundant rendering between captured states.
      g.present = dt => { if (++window.checkFrames % 6 === 0) window.checkPresent(dt * 6); };
    }, name);
    await page.click('#btn-start');
    let result;
    for (let batch = 0; batch < 180; batch++) {
      result = await page.evaluate(() => {
        const g = window.__game, V = window.checkVector;
        let tag;
        for (let i = 0; i < 120; i++) {
          window.checkTime += 1 / 60;
          const oldPhase = g.phase;
          const oldMode = g.rider.mode;
          g.frame(window.checkTime);
          const r = g.rider, gap = g.track.segments[r.graceSeg]?.gap;
          if (oldMode === 'air' && r.mode === 'track') window.checkLandings.push(r.seg);
          if (window.checkPause && r.mode === 'air' && r.airTime > 0.5) {
            const airTime = r.airTime;
            g.paused = true;
            for (let j = 0; j < 600; j++) { window.checkTime += 1 / 60; g.frame(window.checkTime); }
            g.paused = false;
            if (r.airTime !== airTime) throw new Error('Pause advanced flight physics');
            window.checkPause = false;
          }
          if (r.mode === 'air' && gap && r.airTime <= gap.time) {
            window.checkGapSegments.add(r.graceSeg);
            if (g.doomed || g.world.sharks.hunting) window.checkEarlyWarning = true;
          }
          if (g.doomed && !window.checkDoom) window.checkDoom = {air:r.airTime,vy:r.vel.y,gap:gap?.time};
          const hunter = g.world.sharks.sharks.find(s => s.state === 'hunt');
          if (hunter && g.hunt.timeLeft < 0.5 && g.hunt.timeLeft > 0.15) {
            const mouth = g.world.sharks.mouthPosition(new V());
            const entry = new V(0, -Math.sin(hunter.mouthTilt), Math.cos(hunter.mouthTilt)).applyQuaternion(hunter.root.quaternion);
            const towardRider = r.pos.clone().sub(mouth).normalize();
            window.checkAimMin = Math.min(window.checkAimMin, entry.dot(towardRider));
          }
          if (g.phase === 'eaten' && oldPhase !== 'eaten') {
            window.checkBite = {offset:g.biteOffset.length(),follow:g.followMouth};
          }
          const candidate = g.phase === 'finished' || g.phase === 'over' ? g.phase
            : g.phase === 'eaten' ? 'bite'
            : g.doomed && g.hunt.timeLeft < 0.12 ? 'entry'
            : g.doomed && g.hunt.timeLeft < 0.3 ? 'approach'
            : g.doomed && g.hunt.timeLeft < 0.6 ? 'mouth'
            : r.mode === 'air' && r.airTime > 0.5 && !g.doomed ? `jump-${r.seg}` : null;
          if (candidate && !window.checkSeen.has(candidate)) {
            window.checkSeen.add(candidate); tag = candidate; break;
          }
        }
        window.checkPresent(1 / 60);
        const reticle = document.getElementById('reticle');
        if (!g.doomed && !reticle.classList.contains('hidden') && /坠海|鲨鱼/.test(reticle.textContent)) window.checkEarlyWarning = true;
        return { ...g.debugState(), tag, firstDoom:window.checkDoom, early:window.checkEarlyWarning,
          jumps:window.checkGapSegments.size, landings:window.checkLandings, aimMin:window.checkAimMin, bite:window.checkBite };
      });
      if (result.tag) await page.screenshot({ path: `tools/shots/flight-${name}-${result.tag}.png` });
      assert.equal(result.early, false, `${name}: normal gap flight triggered a fall warning`);
      if (result.phase === 'over' || result.phase === 'finished') break;
    }
    assert.equal(result.phase, expected, `${name}: route did not finish`);
    if (expected === 'finished') {
      assert.equal(result.firstDoom, null);
      assert.equal(result.checkpoint, 3);
      if (name === 'gaps') assert.equal(result.jumps, 8);
      else assert.ok(result.landings.some((seg, i) => seg > (result.landings[i - 1] ?? 0) + 1), 'High-speed route did not reach a shortcut');
    } else {
      assert.ok(result.firstDoom.air >= result.firstDoom.gap);
      assert.ok(result.firstDoom.vy < 0);
      assert.ok(result.aimMin > 0.94, `${name}: mouth faces away from rider (${result.aimMin})`);
      assert.equal(result.bite.follow, true);
      assert.ok(result.bite.offset < 5, `${name}: bite snaps rider sideways into the mouth`);
    }
    console.log(`PASS ${name}`, JSON.stringify(result));
    if (name === 'middle') {
      await page.click('#btn-respawn');
      const respawn = await page.evaluate(() => {
        const g = window.__game;
        for (let i = 0; i < 240; i++) { window.checkTime += 1 / 60; g.frame(window.checkTime); }
        return g.debugState();
      });
      assert.equal(respawn.phase, 'ride'); assert.equal(respawn.checkpoint, 2); assert.equal(respawn.seg, 4);
      console.log('PASS checkpoint respawn', JSON.stringify(respawn));
    }
  }
  // Fixed impact point: animated GLB and fallback mouth must both stay centred and face the prey.
  const alignment = await page.evaluate(async () => {
    const { Sharks } = await import('/src/sharks/sharks.ts');
    const V = window.checkVector, reports = [];
    const fallback = new Sharks(new V(), 100);
    await fallback.load('data:application/json,%7B%7D', 1);
    if (!fallback.usedFallback) throw new Error('Fallback fixture did not activate');
    for (const [name, sharks] of [['glb', window.__game.world.sharks], ['fallback', fallback]]) {
      sharks.resetAll(0);
      const point = new V(100, 0, 100);
      sharks.startHunt(point, 4);
      for (let i = 0; i <= 240; i++) {
        const t = i / 60, left = Math.max(0, 4 - t);
        sharks.update(1 / 60, t, {point,timeLeft:left,rider:new V(100 + left * 2,3.2 + left * 50,100)});
      }
      const mouth = sharks.mouthPosition(new V());
      reports.push({name,horizontal:Math.hypot(mouth.x-point.x,mouth.z-point.z),height:mouth.y});
    }
    return reports;
  });
  for (const report of alignment) {
    assert.ok(report.horizontal < 0.25, JSON.stringify(report));
    assert.ok(Math.abs(report.height - 3.2) < 0.001, JSON.stringify(report));
  }
  assert.deepEqual(errors, []);
  console.log('PASS animated mouth alignment', JSON.stringify(alignment));
} finally { await browser.close(); }
