// Tripo v3 helper: text-to-model -> poll -> download.
// Key: env TRIPO_API_KEY, else ~/.tripo/config.json (active profile). Never printed.
//
//   node tools/tripo/tripo.mjs gen tools/tripo/megalodon.json [name]
//   node tools/tripo/tripo.mjs poll <task_id> [name]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'https://openapi.tripo3d.ai/v3';
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'out');

function apiKey() {
  if (process.env.TRIPO_API_KEY) return process.env.TRIPO_API_KEY;
  const cfgPath = join(homedir(), '.tripo', 'config.json');
  if (!existsSync(cfgPath)) throw new Error('No TRIPO_API_KEY and no ~/.tripo/config.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  const key = cfg.profiles?.[cfg.active_profile ?? 'default']?.api_key ?? cfg.api_key;
  if (typeof key !== 'string' || !key) throw new Error('Tripo config has no api_key');
  return key;
}

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`HTTP ${res.status}: non-JSON response`);
  }
  if (!res.ok || json.code !== 0) throw new Error(`HTTP ${res.status} code ${json.code}: ${json.message ?? ''}`);
  return json.data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function download(url, file) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
      writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      process.stdout.write(`saved ${file}\n`);
      return;
    } catch (e) {
      if (attempt >= 4) throw e;
      await sleep(2000 * attempt);
    }
  }
}

async function poll(taskId, name) {
  mkdirSync(OUT, { recursive: true });
  const t0 = Date.now();
  let failures = 0;
  for (;;) {
    let d;
    try {
      d = await api('GET', `/tasks/${taskId}`);
      failures = 0;
    } catch (e) {
      // transient network errors: keep polling for a while
      if (++failures > 12) throw e;
      process.stdout.write(`poll error (${failures}): ${e instanceof Error ? e.message : String(e)}\n`);
      await sleep(5000);
      continue;
    }
    process.stdout.write(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${d.status} ${d.progress ?? ''}\n`);
    if (d.status === 'success') {
      writeFileSync(join(OUT, `${name}.task.json`), JSON.stringify(d, null, 2));
      const o = d.output ?? {};
      const model = o.model_url ?? o.pbr_model_url ?? o.pbr_model ?? o.model;
      if (model) await download(model, join(OUT, `${name}.glb`));
      if (o.rendered_image_url) await download(o.rendered_image_url, join(OUT, `${name}.preview.webp`));
      return d;
    }
    if (['failed', 'cancelled', 'banned', 'expired', 'unknown'].includes(d.status)) {
      throw new Error(`task ${taskId} ended with status ${d.status}`);
    }
    await sleep(5000);
  }
}

async function main() {
  const [cmd, arg, nameArg] = process.argv.slice(2);
  if (cmd === 'gen') {
    const body = JSON.parse(readFileSync(arg, 'utf8'));
    const name = nameArg ?? 'model';
    const d = await api('POST', '/generation/text-to-model', body);
    process.stdout.write(`task ${d.task_id}\n`);
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, `${name}.id`), d.task_id);
    await poll(d.task_id, name);
  } else if (cmd === 'poll') {
    await poll(arg, nameArg ?? 'model');
  } else {
    process.stdout.write('usage: gen <body.json> [name] | poll <task_id> [name]\n');
  }
}

main().catch((e) => {
  process.stderr.write(`tripo: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
