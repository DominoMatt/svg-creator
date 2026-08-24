// Self-contained API test for SVG Studio's current workflow.
// Spawns its own server on a free port, exercises every endpoint the UI and
// agents rely on, restores shared state (.focus.json), and removes its
// throwaway project. Run with: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NAME = 'zz-selftest'; // throwaway project; deleted in cleanup
let PORT;
let child;

const B = () => `http://localhost:${PORT}`;

function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

async function req(method, p, body, ct = 'application/json') {
  const res = await fetch(B() + p, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': ct },
    body:
      body === undefined
        ? undefined
        : typeof body === 'string'
          ? body
          : JSON.stringify(body)
  });
  return res;
}

before(async () => {
  PORT = await freePort();
  child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore'
  });
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`${B()}/api/projects`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error('server did not start on port ' + PORT);
});

after(async () => {
  await req('DELETE', `/api/projects/${NAME}`, { confirm: true }).catch(() => {});
  child?.kill();
});

/* ---------------- projects ---------------- */

test('create + list project', async () => {
  await req('DELETE', `/api/projects/${NAME}`, { confirm: true }).catch(() => {});
  const r = await req('POST', '/api/projects', { name: NAME });
  assert.ok(r.ok, 'create failed');
  const list = await (await req('GET', '/api/projects')).json();
  assert.ok(list.some((p) => p.name === NAME));
});

test('reject invalid project name', async () => {
  const r = await req('GET', '/api/projects/bad%2Fname/current');
  assert.equal(r.status, 400);
});

/* ---------------- current working copy ---------------- */

const svg1 =
  '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="18" fill="steelblue"/></svg>';
const svg2 =
  '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="tomato"/></svg>';

test('write current — raw svg body', async () => {
  const r = await req('PUT', `/api/projects/${NAME}/current`, svg1, 'image/svg+xml');
  assert.equal((await r.json()).ok, true);
  const back = await (await req('GET', `/api/projects/${NAME}/current`)).text();
  assert.ok(back.includes('steelblue'));
});

test('write current — json body', async () => {
  const r = await req('PUT', `/api/projects/${NAME}/current`, { svg: svg2 });
  assert.equal((await r.json()).ok, true);
  const back = await (await req('GET', `/api/projects/${NAME}/current`)).text();
  assert.ok(back.includes('tomato'));
});

test('reject write without svg markup', async () => {
  const r = await req('PUT', `/api/projects/${NAME}/current`, { svg: 'not svg' });
  assert.equal(r.status, 400);
});

/* ---------------- options (file-tools path) ---------------- */

const optionSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="18" fill="goldenrod"/></svg>';
const OPTION_ID = 'option-a-golden.svg';

test('option written straight to disk becomes visible via API', async () => {
  // AGENTS.md rule 8: agents submit options by writing files. The mtime
  // poller (~800ms) is what makes that visible to live clients.
  const dir = path.join(ROOT, 'public', 'svgs', NAME, 'options');
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, OPTION_ID), optionSvg);
  await new Promise((r) => setTimeout(r, 1500)); // poller interval + debounce
  const opts = await (await req('GET', `/api/projects/${NAME}/options`)).json();
  assert.ok(opts.some((o) => o.id === OPTION_ID), JSON.stringify(opts));
});

test('select promotes an option into current', async () => {
  const r = await req('POST', `/api/projects/${NAME}/select`, { option: OPTION_ID });
  assert.equal((await r.json()).ok, true);
  const back = await (await req('GET', `/api/projects/${NAME}/current`)).text();
  assert.ok(back.includes('goldenrod'));
});

test('select rejects invalid option id', async () => {
  const r = await req('POST', `/api/projects/${NAME}/select`, { option: '../escape.svg' });
  assert.equal(r.status, 400);
});

/* ---------------- commits & versions ---------------- */

test('commit creates a vNNN version', async () => {
  const r = await req('POST', `/api/projects/${NAME}/commit`, { label: 'selftest' });
  const body = await r.json();
  assert.match(body.id || '', /^v001-[A-Za-z0-9_-]+\.svg$/);
  const versions = await (await req('GET', `/api/projects/${NAME}/versions`)).json();
  assert.equal(versions.length, 1);
  assert.equal(versions[0].id, body.id);
});

test('rollback restores a version into current', async () => {
  // move current somewhere else first so rollback has something to undo
  await req('PUT', `/api/projects/${NAME}/current`, { svg: svg1 });
  const versions = await (await req('GET', `/api/projects/${NAME}/versions`)).json();
  const id = versions[0].id; // newest first
  const r = await req('POST', `/api/projects/${NAME}/rollback/${id}`, {});
  assert.equal((await r.json()).ok, true);
  const back = await (await req('GET', `/api/projects/${NAME}/current`)).text();
  assert.ok(back.includes('goldenrod'), 'current should match rolled-back version');
});

/* ---------------- delete guard ---------------- */

test('project delete requires confirm flag', async () => {
  const r = await req('DELETE', `/api/projects/${NAME}`, {});
  assert.equal(r.status, 400);
});

/* ---------------- focus round-trip ---------------- */

test('focus set + restore leaves .focus.json untouched', async () => {
  const orig = ((await (await req('GET', '/api/focus')).json()).project) ?? null;
  await req('PUT', '/api/focus', { project: NAME });
  assert.equal(((await (await req('GET', '/api/focus')).json()).project), NAME);
  await req('PUT', '/api/focus', { project: orig });
  assert.equal(((await (await req('GET', '/api/focus')).json()).project) ?? null, orig);
});
