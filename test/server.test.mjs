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

/* ---------------- temp-current (file-tree working copy) ---------------- */

test('temp-current starts absent (404)', async () => {
  const r = await req('GET', `/api/projects/${NAME}/temp-current`);
  assert.equal(r.status, 404);
});

test('PUT temp-current stages without touching current', async () => {
  // current is svg2 (tomato) from the earlier test.
  const staged = svg1.replace('steelblue', 'seagreen');
  const r = await req('PUT', `/api/projects/${NAME}/temp-current`, staged, 'image/svg+xml');
  assert.equal((await r.json()).ok, true);
  const back = await (await req('GET', `/api/projects/${NAME}/temp-current`)).text();
  assert.ok(back.includes('seagreen'), 'temp-current should hold the staged content');
  // current.svg must be untouched.
  const cur = await (await req('GET', `/api/projects/${NAME}/current`)).text();
  assert.ok(cur.includes('tomato'), 'current.svg should be unchanged by staging');
});

test('file-tree lists tempCurrent', async () => {
  const data = await (await req('GET', '/api/file-tree')).json();
  const p = data.projects.find((x) => x.name === NAME);
  assert.ok(p.tempCurrent && p.tempCurrent.includes('seagreen'), 'file-tree should expose tempCurrent');
});

test('push moves temp-current into current and clears it', async () => {
  const r = await req('POST', `/api/projects/${NAME}/temp-current/push`);
  assert.equal((await r.json()).ok, true);
  const cur = await (await req('GET', `/api/projects/${NAME}/current`)).text();
  assert.ok(cur.includes('seagreen'), 'current.svg should now hold the pushed content');
  const temp = await req('GET', `/api/projects/${NAME}/temp-current`);
  assert.equal(temp.status, 404, 'temp-current should be removed after push');
});

test('push with no temp-current reports 404', async () => {
  const r = await req('POST', `/api/projects/${NAME}/temp-current/push`);
  assert.equal(r.status, 404);
});

test('discard removes temp-current without touching current', async () => {
  await req('PUT', `/api/projects/${NAME}/temp-current`, svg2, 'image/svg+xml');
  const r = await req('DELETE', `/api/projects/${NAME}/temp-current`);
  assert.equal((await r.json()).ok, true);
  const temp = await req('GET', `/api/projects/${NAME}/temp-current`);
  assert.equal(temp.status, 404, 'temp-current should be gone after discard');
  const cur = await (await req('GET', `/api/projects/${NAME}/current`)).text();
  assert.ok(cur.includes('seagreen'), 'current.svg should be untouched by discard');
});

test('temp-current rejects non-svg body', async () => {
  const r = await req('PUT', `/api/projects/${NAME}/temp-current`, { svg: 'nope' });
  assert.equal(r.status, 400);
});

/* ---------------- options (file-tools path) ---------------- */

const optionSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="18" fill="goldenrod"/></svg>';
const OPTION_ID = 'option-a-golden.svg';

test('option written straight to disk becomes visible via API', async () => {
  // AGENTS.md rule 3: agents submit options by writing files. The mtime
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

/* ---------------- undo (old-current.svg) ---------------- */

const OLD_CURRENT = 'old-current.svg';
const oldPath = () => path.join(ROOT, 'public', 'svgs', NAME, OLD_CURRENT);

test('PUT captures the previous current into old-current.svg', async () => {
  // current is goldenrod (from rollback); overwrite with svg1 → old-current should be goldenrod
  await req('PUT', `/api/projects/${NAME}/current`, { svg: svg1 });
  const old = await fsp.readFile(oldPath(), 'utf8');
  assert.ok(old.includes('goldenrod'), 'old-current should hold the pre-overwrite content');
  const cur = await (await req('GET', `/api/projects/${NAME}/current`)).text();
  assert.ok(cur.includes('steelblue'), 'current should now be svg1');
});

test('undo swaps current back to old-current', async () => {
  const r = await req('POST', `/api/projects/${NAME}/undo`, {});
  const body = await r.json();
  assert.equal(body.ok, true);
  assert.equal(body.undone, true);
  const cur = await (await req('GET', `/api/projects/${NAME}/current`)).text();
  assert.ok(cur.includes('goldenrod'), 'current should be the pre-overwrite content after undo');
  // The swap is symmetric: old-current now holds what current had (svg1).
  const old = await fsp.readFile(oldPath(), 'utf8');
  assert.ok(old.includes('steelblue'), 'old-current should hold the swapped-out content');
});

test('undo again swaps back (toggle works both directions)', async () => {
  const r = await req('POST', `/api/projects/${NAME}/undo`, {});
  const body = await r.json();
  assert.equal(body.undone, true);
  const cur = await (await req('GET', `/api/projects/${NAME}/current`)).text();
  assert.ok(cur.includes('steelblue'), 'second undo should restore svg1');
});

test('undo with no old-current.svg reports undone:false', async () => {
  await fsp.rm(oldPath(), { force: true });
  const r = await req('POST', `/api/projects/${NAME}/undo`, {});
  assert.equal(r.status, 404);
  const body = await r.json();
  assert.equal(body.ok, true);
  assert.equal(body.undone, false);
});

test('projects list reports hasOldCurrent', async () => {
  // Recreate an old-current so the flag is true.
  await req('PUT', `/api/projects/${NAME}/current`, { svg: svg2 });
  const list = await (await req('GET', '/api/projects')).json();
  const p = list.find((x) => x.name === NAME);
  assert.ok(p, 'project should exist');
  assert.equal(p.hasOldCurrent, true, 'hasOldCurrent should be true after an overwrite');
});

/* ---------------- delete guard ---------------- */

test('project delete requires confirm flag', async () => {
  const r = await req('DELETE', `/api/projects/${NAME}`, {});
  assert.equal(r.status, 400);
});

/* ---------------- options POST (HTTP-agent path) ---------------- */

test('POST options assigns sequential letters on an empty tray', async () => {
  await req('DELETE', `/api/projects/${NAME}/options`, {}); // start from empty
  const r = await req('POST', `/api/projects/${NAME}/options`, {
    options: [
      { label: 'warm-palette', svg: optionSvg },
      { label: 'cool-palette', svg: svg2 }
    ]
  });
  assert.equal(r.status, 201);
  const body = await r.json();
  assert.deepEqual(body.created, ['option-a-warm-palette.svg', 'option-b-cool-palette.svg']);
  const opts = await (await req('GET', `/api/projects/${NAME}/options`)).json();
  assert.ok(
    opts.some((o) => o.id === 'option-a-warm-palette.svg' && o.committed === false),
    JSON.stringify(opts)
  );
});

test('POST options continues past highest letter (a,b,z → aa)', async () => {
  const dir = path.join(ROOT, 'public', 'svgs', NAME, 'options');
  await fsp.mkdir(dir, { recursive: true });
  for (const id of ['option-a-one.svg', 'option-b-two.svg', 'option-z-three.svg']) {
    await fsp.writeFile(path.join(dir, id), optionSvg);
  }
  const r = await req('POST', `/api/projects/${NAME}/options`, { label: 'fourth', svg: optionSvg });
  assert.equal(r.status, 201);
  assert.deepEqual((await r.json()).created, ['option-aa-fourth.svg']);
});

test('duplicate labels in one round get distinct letters', async () => {
  const r = await req('POST', `/api/projects/${NAME}/options`, {
    options: [
      { label: 'same', svg: optionSvg },
      { label: 'same', svg: svg2 }
    ]
  });
  assert.equal(r.status, 201);
  const created = (await r.json()).created;
  assert.equal(created.length, 2);
  assert.notEqual(created[0], created[1]);
  assert.match(created[0], /^option-[a-z]{1,2}-same\.svg$/);
});

test('POST options rejects bad input without writing anything', async () => {
  const before = (await (await req('GET', `/api/projects/${NAME}/options`)).json()).length;
  assert.equal((await req('POST', '/api/projects/bad%2Fname/options', { label: 'x', svg: optionSvg })).status, 400);
  assert.equal((await req('POST', `/api/projects/${NAME}/options`, { label: 'x', svg: 'not svg' })).status, 400);
  assert.equal((await req('POST', `/api/projects/${NAME}/options`, { label: '///', svg: optionSvg })).status, 400);
  assert.equal((await req('POST', `/api/projects/${NAME}/options`, {})).status, 400);
  const after = (await (await req('GET', `/api/projects/${NAME}/options`)).json()).length;
  assert.equal(after, before, 'no files should be written for rejected rounds');
});

test('POST options caps rounds at 6; exactly 6 succeeds', async () => {
  const seven = Array.from({ length: 7 }, (_, i) => ({ label: `round${i}`, svg: optionSvg }));
  assert.equal((await req('POST', `/api/projects/${NAME}/options`, { options: seven })).status, 400);
  const r = await req('POST', `/api/projects/${NAME}/options`, { options: seven.slice(0, 6) });
  assert.equal(r.status, 201);
  assert.equal((await r.json()).created.length, 6);
});

test('POST round leaves the ✓-tracker (state.json) untouched', async () => {
  await req('DELETE', `/api/projects/${NAME}/options`, {}); // removes dir incl. state.json
  const r = await req('POST', `/api/projects/${NAME}/options`, { label: 'tracker-check', svg: optionSvg });
  assert.equal(r.status, 201);
  await assert.rejects(
    fsp.access(path.join(ROOT, 'public', 'svgs', NAME, 'options', 'state.json')),
    { code: 'ENOENT' }
  );
});

test('✓-mark is dropped when the option file is deleted by hand', async () => {
  // A file-tool agent clears the tray by deleting option files (AGENTS.md
  // rule 3) without knowing about state.json. The server prunes stale marks
  // on read so a later option reusing the name starts unmarked.
  const dir = path.join(ROOT, 'public', 'svgs', NAME, 'options');
  await req('DELETE', `/api/projects/${NAME}/options`, {});
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, OPTION_ID), optionSvg);
  await req('POST', `/api/projects/${NAME}/commit`, { option: OPTION_ID });
  let opts = await (await req('GET', `/api/projects/${NAME}/options`)).json();
  assert.equal(opts.find((o) => o.id === OPTION_ID)?.committed, true);
  await fsp.rm(path.join(dir, OPTION_ID));
  await req('GET', `/api/projects/${NAME}/options`); // prune happens here
  await fsp.writeFile(path.join(dir, OPTION_ID), svg2); // same name, new content
  opts = await (await req('GET', `/api/projects/${NAME}/options`)).json();
  assert.equal(opts.find((o) => o.id === OPTION_ID)?.committed, false);
});

test('posted options are fetchable individually', async () => {
  await req('DELETE', `/api/projects/${NAME}/options`, {});
  const r = await req('POST', `/api/projects/${NAME}/options`, { label: 'fetch-me', svg: svg1 });
  const [id] = (await r.json()).created;
  assert.equal(id, 'option-a-fetch-me.svg');
  const back = await (await req('GET', `/api/projects/${NAME}/options/${id}`)).text();
  assert.ok(back.includes('steelblue'));
});

/* ---------------- API discovery ---------------- */

test('GET /api lists the surface and points at conventions', async () => {
  const r = await req('GET', '/api');
  assert.equal(r.status, 200);
  const idx = await r.json();
  assert.equal(idx.name, 'SVG Studio');
  assert.equal(idx.startHere.conventions, '/api/conventions');
  assert.ok(Array.isArray(idx.endpoints) && idx.endpoints.length > 10, 'endpoint list missing');
  assert.ok(
    idx.endpoints.some((e) => e.method.includes('POST') && e.path === '/api/projects/:name/options'),
    'options POST should be listed'
  );
});

test('API responses carry a Link header advertising conventions', async () => {
  const r = await req('GET', '/api/projects');
  assert.equal(r.headers.get('link'), '</api/conventions>; rel="help"');
});

test('unknown /api paths get a JSON signpost + Link header', async () => {
  const r = await req('GET', '/api/nope');
  assert.equal(r.status, 404);
  assert.equal(r.headers.get('link'), '</api/conventions>; rel="help"');
  const body = await r.json();
  assert.equal(body.see, '/api');
  assert.equal(body.conventions, '/api/conventions');
});

/* ---------------- conventions mirror ---------------- */

test('GET /api/conventions mirrors BROWSER_AGENTS.md as markdown', async () => {
  const r = await req('GET', '/api/conventions');
  assert.equal(r.status, 200);
  assert.ok((r.headers.get('content-type') || '').includes('text/markdown'));
  const text = await r.text();
  const disk = await fsp.readFile(path.join(ROOT, 'BROWSER_AGENTS.md'), 'utf8');
  assert.equal(text, disk);
});

test('GET /api/authoring mirrors AUTHORING.md as markdown', async () => {
  const r = await req('GET', '/api/authoring');
  assert.equal(r.status, 200);
  assert.ok((r.headers.get('content-type') || '').includes('text/markdown'));
  const text = await r.text();
  const disk = await fsp.readFile(path.join(ROOT, 'AUTHORING.md'), 'utf8');
  assert.equal(text, disk);
});

test('AUTHORING.md embeds the fish example verbatim', async () => {
  const doc = await fsp.readFile(path.join(ROOT, 'AUTHORING.md'), 'utf8');
  const fish = await fsp.readFile(path.join(ROOT, 'public', 'svgs', 'fish', 'current.svg'), 'utf8');
  assert.ok(doc.includes(fish.trim()), 'AUTHORING.md fish example drifted from public/svgs/fish/current.svg');
});

test('conventions reflect BROWSER_AGENTS.md edits without a restart', async () => {
  const file = path.join(ROOT, 'BROWSER_AGENTS.md');
  const original = await fsp.readFile(file, 'utf8');
  try {
    await fsp.writeFile(file, original + '\n<!-- selftest-live-edit-marker -->\n');
    const text = await (await req('GET', '/api/conventions')).text();
    assert.ok(text.includes('selftest-live-edit-marker'), 'edit should be visible on next request');
  } finally {
    await fsp.writeFile(file, original); // restore no matter what
  }
});

/* ---------------- focus round-trip ---------------- */

test('focus set + restore leaves .focus.json untouched', async () => {
  const orig = ((await (await req('GET', '/api/focus')).json()).project) ?? null;
  await req('PUT', '/api/focus', { project: NAME });
  assert.equal(((await (await req('GET', '/api/focus')).json()).project), NAME);
  await req('PUT', '/api/focus', { project: orig });
  assert.equal(((await (await req('GET', '/api/focus')).json()).project) ?? null, orig);
});

test('deleting the targeted project clears focus — in the API and on disk', async () => {
  const orig = ((await (await req('GET', '/api/focus')).json()).project) ?? null;
  const tmp = `${NAME}-focus`;
  try {
    await req('POST', '/api/projects', { name: tmp });
    await req('PUT', '/api/focus', { project: tmp });
    assert.equal((await (await req('GET', '/api/focus')).json()).project, tmp);
    await req('DELETE', `/api/projects/${tmp}`, { confirm: true });
    assert.equal((await (await req('GET', '/api/focus')).json()).project, null);
    const onDisk = JSON.parse(await fsp.readFile(path.join(ROOT, 'public', 'svgs', '.focus.json'), 'utf8'));
    assert.equal(onDisk.project, null, 'file-tool agents must not see the dead name either');
  } finally {
    await req('DELETE', `/api/projects/${tmp}`, { confirm: true }).catch(() => {});
    await req('PUT', '/api/focus', { project: orig });
  }
});

test('focus naming a missing project reads as no target', async () => {
  const orig = ((await (await req('GET', '/api/focus')).json()).project) ?? null;
  try {
    await fsp.writeFile(
      path.join(ROOT, 'public', 'svgs', '.focus.json'),
      JSON.stringify({ project: 'zz-does-not-exist' })
    );
    assert.equal((await (await req('GET', '/api/focus')).json()).project, null);
  } finally {
    await req('PUT', '/api/focus', { project: orig });
  }
});
