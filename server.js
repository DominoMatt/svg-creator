const express = require('express');
const path = require('path');
const fsp = require('fs/promises');

const app = express();
const PORT = process.env.PORT || 3000;
const SVG_DIR = path.join(__dirname, 'public', 'svgs');

// Ensure base directory exists
fsp.mkdir(SVG_DIR, { recursive: true }).catch(() => {});

app.use(express.json({ limit: '2mb' }));
app.use(express.text({ type: ['image/svg+xml', 'text/plain'], limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Every /api response passively advertises where the agent workflow rules
// live (RFC 8288 Link header). Cheap discovery for harnesses that inspect
// headers; body-level discovery is covered by GET /api below.
app.use('/api', (_req, res, next) => {
  res.set('Link', '</api/conventions>; rel="help"');
  next();
});

/* ---------------- helpers ---------------- */

const PROJECT_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const VERSION_ID_RE = /^v\d{3}-[a-zA-Z0-9_-]+\.svg$/;

function safeProjectPath(name) {
  if (!PROJECT_NAME_RE.test(name)) return null;
  const p = path.join(SVG_DIR, name);
  return p.startsWith(SVG_DIR + path.sep) ? p : null;
}

function getProjectDir(req, res) {
  const dir = safeProjectPath(req.params.project);
  if (!dir) {
    res.status(400).json({ error: 'Invalid project name' });
    return null;
  }
  return dir;
}

function sanitizeLabel(label, fallback = 'untitled') {
  const s = String(label || '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return s || fallback;
}

async function listProjectNames() {
  try {
    const entries = await fsp.readdir(SVG_DIR, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  } catch {
    return [];
  }
}

/* ---------------- SSE live updates ---------------- */

let clients = [];

app.get('/api/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
  res.flushHeaders();
  res.write('retry: 1000\n\n'); // reconnect quickly after a server restart
  clients.push(res);
  req.on('close', () => {
    clients = clients.filter((c) => c !== res);
  });
});

function broadcast(event, payload) {
  const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const c of clients) c.write(data);
}

// Comment-ping keeps intermediaries from idling the stream out and flushes
// dead sockets so closed connections leave the clients list promptly.
setInterval(() => {
  for (const c of clients) c.write(': ping\n\n');
}, 20000);

const pendingEvents = new Map();
function broadcastDebounced(event, payload) {
  const key = event + ':' + (payload.project || '');
  clearTimeout(pendingEvents.get(key));
  pendingEvents.set(
    key,
    setTimeout(() => {
      pendingEvents.delete(key);
      broadcast(event, payload);
    }, 150)
  );
}

/* Classify a changed file path (relative to SVG_DIR) into an SSE event. */
function classifyChange(relPath) {
  if (relPath === '.focus.json') return ['focus-changed', {}];
  const parts = relPath.split('/');
  if (parts.length === 1) return ['projects-changed', {}];
  const [project, ...rest] = parts;
  const sub = rest.join('/');
  if (!sub || sub === 'meta.json') return ['projects-changed', { project }];
  if (sub === 'current.svg') return ['current-changed', { project }];
  if (sub.startsWith('versions/')) return ['versions-changed', { project }];
  if (sub.startsWith('options/')) return ['options-changed', { project }];
  return ['projects-changed', { project }];
}

/* Change detection: diff an mtime snapshot of the svgs tree every 800ms.
   Polling (instead of fs.watch) behaves identically everywhere, including
   container/bind-mount filesystems that never deliver watch events, and is
   cheap for local-sized projects. Missed windows don't matter: the browser
   fully resyncs whenever its SSE connection (re)opens. */
async function scanTree() {
  const snapshot = {};
  async function walk(dir, rel) {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      // skip dotfiles except .focus.json (tracked so focus changes reach the UI)
      if (e.name.startsWith('.') && e.name !== '.focus.json') continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        await walk(path.join(dir, e.name), r);
      } else {
        try {
          snapshot[r] = (await fsp.stat(path.join(dir, e.name))).mtimeMs;
        } catch {}
      }
    }
  }
  await walk(SVG_DIR, '');
  return snapshot;
}

let lastScan = null;
async function pollChanges() {
  const next = await scanTree();
  if (lastScan) {
    const keys = new Set([...Object.keys(lastScan), ...Object.keys(next)]);
    for (const k of keys) {
      if (lastScan[k] !== next[k]) {
        const [event, payload] = classifyChange(k);
        broadcastDebounced(event, payload);
      }
    }
  }
  lastScan = next;
}
setInterval(pollChanges, 800);
pollChanges();

/* ---------------- projects ---------------- */

app.get('/api/projects', async (_req, res) => {
  try {
    const names = await listProjectNames();
    const projects = await Promise.all(
      names.map(async (name) => {
        const dir = safeProjectPath(name);
        let versionCount = 0;
        let hasCurrent = false;
        let forkedFrom = null;
        try {
          versionCount = (await fsp.readdir(path.join(dir, 'versions'))).filter((f) => f.endsWith('.svg')).length;
        } catch {}
        try {
          await fsp.access(path.join(dir, 'current.svg'));
          hasCurrent = true;
        } catch {}
        try {
          const meta = JSON.parse(await fsp.readFile(path.join(dir, 'meta.json'), 'utf8'));
          forkedFrom = meta.forkedFrom || null;
        } catch {}
        return { name, hasCurrent, versionCount, forkedFrom };
      })
    );
    res.json(projects);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/projects', async (req, res) => {
  const name = String((req.body && req.body.name) || '').trim();
  if (!PROJECT_NAME_RE.test(name)) {
    return res.status(400).json({ error: 'Invalid name: use letters, numbers, "-" and "_" only' });
  }
  const dir = safeProjectPath(name);
  try {
    try {
      await fsp.access(dir);
      return res.status(409).json({ error: `Project "${name}" already exists` });
    } catch {}
    await fsp.mkdir(path.join(dir, 'versions'), { recursive: true });
    await fsp.writeFile(
      path.join(dir, 'meta.json'),
      JSON.stringify({ name, description: '', created: new Date().toISOString() }, null, 2)
    );
    res.status(201).json({ name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------- agent target ("focus") ----------------
   The user explicitly clicks the 🎯 Target button in the UI to tell agents
   which project to modify. Stored as .focus.json inside svgs/ so agents can
   read it via HTTP (GET /api/focus) or straight from the filesystem. */
const FOCUS_FILE = path.join(SVG_DIR, '.focus.json');

async function readFocusRaw() {
  try {
    const data = JSON.parse(await fsp.readFile(FOCUS_FILE, 'utf8'));
    return data.project || null;
  } catch {
    return null;
  }
}

// A focus naming a folder that no longer exists (deleted by hand, or a typo
// written by a file-tool agent) reads as "no target" rather than a dead name.
async function readFocus() {
  const name = await readFocusRaw();
  const dir = name ? safeProjectPath(String(name)) : null;
  if (!dir) return null;
  try {
    await fsp.access(dir);
    return name;
  } catch {
    return null;
  }
}

app.get('/api/focus', async (_req, res) => {
  res.json({ project: await readFocus() });
});

app.put('/api/focus', async (req, res) => {
  const name = req.body ? req.body.project : null;
  if (name != null) {
    if (!PROJECT_NAME_RE.test(String(name))) {
      return res.status(400).json({ error: 'Invalid project name' });
    }
    try {
      await fsp.access(safeProjectPath(String(name)));
    } catch {
      return res.status(404).json({ error: 'Project not found' });
    }
  }
  await fsp.writeFile(FOCUS_FILE, JSON.stringify({ project: name ?? null }, null, 2));
  res.json({ project: name ?? null });
});

// Delete an entire project (current.svg, versions/, options/, meta.json).
// Requires {"confirm": true} as a server-side guard; the UI asks the user first.
app.delete('/api/projects/:project', async (req, res) => {
  const dir = getProjectDir(req, res);
  if (!dir) return;
  if (!(req.body && req.body.confirm === true)) {
    return res.status(400).json({ error: 'Confirmation required: {"confirm": true}' });
  }
  try {
    await fsp.rm(dir, { recursive: true, force: true });
    // Deleting the 🎯-targeted project clears the target so no agent
    // inherits a dangling focus.
    if ((await readFocusRaw()) === req.params.project) {
      await fsp.writeFile(FOCUS_FILE, JSON.stringify({ project: null }, null, 2));
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------- API discovery ----------------
   Front door for HTTP-mode agents that know only the origin: one GET reveals
   the whole surface and points at the workflow rules. Hand-maintained to stay
   terse — keep in sync with the routes below and the README table. */
app.get('/api', (_req, res) => {
  res.json({
    name: 'SVG Studio',
    startHere: { conventions: '/api/conventions', authoring: '/api/authoring' },
    events: '/api/events',
    endpoints: [
      ['GET', '/api/projects', 'list projects'],
      ['POST', '/api/projects', 'create project {name}'],
      ['DELETE', '/api/projects/:name', 'delete project {confirm:true}'],
      ['POST', '/api/projects/:name/rename', 'rename project {name}'],
      ['GET|PUT', '/api/projects/:name/current', 'working copy (raw SVG or {svg})'],
      ['GET|POST', '/api/projects/:name/options', 'list tray | submit round {options:[{label,svg}]}, max 6'],
      ['GET|DELETE', '/api/projects/:name/options/:id', 'fetch | dismiss one option'],
      ['DELETE', '/api/projects/:name/options', 'dismiss all options'],
      ['POST', '/api/projects/:name/options/delete', 'bulk-dismiss {ids, confirm:true}'],
      ['POST', '/api/projects/:name/select', 'promote option to current {option:id}'],
      ['POST', '/api/projects/:name/commit', 'commit current or an option {label?, option?}'],
      ['GET', '/api/projects/:name/versions', 'list versions'],
      ['GET|PUT', '/api/projects/:name/versions/:id', 'fetch | direct-write version'],
      ['POST', '/api/projects/:name/versions/:id/rename', '{label}; keeps vNNN number'],
      ['POST', '/api/projects/:name/versions/delete', 'bulk-delete {ids, confirm:true}'],
      ['POST', '/api/projects/:name/rollback/:id', 'restore version as current (no auto-commit)'],
      ['POST', '/api/projects/:name/fork', 'fork to new project {name, version?}'],
      ['GET|PUT', '/api/focus', 'agent 🎯 target {project}'],
      ['GET', '/api/conventions', 'workflow rules — read first'],
      ['GET', '/api/authoring', 'how to structure the SVG markup — read before composing'],
      ['GET', '/api/events', 'SSE change stream']
    ].map(([method, path, purpose]) => ({ method, path, purpose }))
  });
});

/* ---------------- agent conventions (BROWSER_AGENTS.md mirror) ----------------
   HTTP-mode agents have no filesystem to read BROWSER_AGENTS.md from, so this
   read-only endpoint is their only channel for the workflow rules. Read
   per-request (never cached) so rule edits apply immediately; BROWSER_AGENTS.md
   itself stays editable via file tools/git — GET only, never PUT. */
app.get('/api/conventions', async (_req, res) => {
  try {
    const data = await fsp.readFile(path.join(__dirname, 'BROWSER_AGENTS.md'), 'utf8');
    res.set('Content-Type', 'text/markdown; charset=utf-8');
    res.send(data);
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'Conventions file not found' });
    res.status(500).json({ error: err.message });
  }
});

// AUTHORING.md mirror — how to structure the SVG markup itself. Same contract
// as /api/conventions: read per-request, GET only.
app.get('/api/authoring', async (_req, res) => {
  try {
    const data = await fsp.readFile(path.join(__dirname, 'AUTHORING.md'), 'utf8');
    res.set('Content-Type', 'text/markdown; charset=utf-8');
    res.send(data);
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'Authoring guide not found' });
    res.status(500).json({ error: err.message });
  }
});

/* ---------------- current working copy ---------------- */

app.get('/api/projects/:project/current', async (req, res) => {
  const dir = getProjectDir(req, res);
  if (!dir) return;
  try {
    const data = await fsp.readFile(path.join(dir, 'current.svg'), 'utf8');
    res.set('Content-Type', 'image/svg+xml');
    res.send(data);
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'No current.svg yet' });
    res.status(500).json({ error: err.message });
  }
});

// Agent-friendly write: raw SVG body or {"svg": "..."}
app.put('/api/projects/:project/current', async (req, res) => {
  const dir = getProjectDir(req, res);
  if (!dir) return;
  const svg = typeof req.body === 'string' ? req.body : req.body && req.body.svg;
  if (!svg || !String(svg).includes('<svg')) {
    return res.status(400).json({ error: 'Body must contain SVG markup' });
  }
  try {
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, 'current.svg'), String(svg));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------- commits & versions ---------------- */

app.post('/api/projects/:project/commit', async (req, res) => {
  const dir = getProjectDir(req, res);
  if (!dir) return;
  const label = req.body && req.body.label;
  const optionId = req.body && req.body.option;
  // Direct commit: an option can be committed straight to history without
  // being promoted to current.svg first.
  if (optionId != null && !OPTION_ID_RE.test(String(optionId))) {
    return res.status(400).json({ error: 'Invalid option id' });
  }
  try {
    const sourcePath = optionId
      ? path.join(dir, 'options', String(optionId))
      : path.join(dir, 'current.svg');
    const svg = await fsp.readFile(sourcePath, 'utf8');
    const versionsDir = path.join(dir, 'versions');
    await fsp.mkdir(versionsDir, { recursive: true });
    const existing = await fsp.readdir(versionsDir);
    const maxNum = existing.reduce((m, f) => {
      const match = f.match(/^v(\d+)/);
      return match ? Math.max(m, parseInt(match[1], 10)) : m;
    }, 0);
    const effectiveLabel = label || (optionId
      ? String(optionId).replace(/^option-[a-z]{1,2}-/, '').replace(/\.svg$/, '')
      : undefined);
    const id = `v${String(maxNum + 1).padStart(3, '0')}-${sanitizeLabel(effectiveLabel)}.svg`;
    await fsp.writeFile(path.join(versionsDir, id), svg);
    if (optionId) {
      const optionsDir = path.join(dir, 'options');
      const committed = new Set(await readCommittedIds(optionsDir));
      committed.add(String(optionId));
      await writeCommittedIds(optionsDir, [...committed]);
    }
    res.status(201).json({ id });
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.status(404).json({ error: optionId ? 'Option not found' : 'No current.svg to commit' });
    }
    res.status(500).json({ error: err.message });
  }
});

// Direct-write a version file (used by "Load project" folder import)
app.put('/api/projects/:project/versions/:id', async (req, res) => {
  const dir = getProjectDir(req, res);
  if (!dir) return;
  const id = req.params.id;
  if (!VERSION_ID_RE.test(id)) {
    return res.status(400).json({ error: 'Invalid version id' });
  }
  const svg = typeof req.body === 'string' ? req.body : req.body && req.body.svg;
  if (!svg || !String(svg).includes('<svg')) {
    return res.status(400).json({ error: 'Body must contain SVG markup' });
  }
  try {
    const versionsDir = path.join(dir, 'versions');
    await fsp.mkdir(versionsDir, { recursive: true });
    await fsp.writeFile(path.join(versionsDir, id), String(svg));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/projects/:project/versions', async (req, res) => {
  const dir = getProjectDir(req, res);
  if (!dir) return;
  try {
    const files = await fsp.readdir(path.join(dir, 'versions'));
    const versions = [];
    for (const f of files.filter((f) => f.endsWith('.svg')).sort()) {
      const st = await fsp.stat(path.join(dir, 'versions', f));
      versions.push({ id: f, committedAt: st.mtime.toISOString(), size: st.size });
    }
    res.json(versions.reverse()); // newest first
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/projects/:project/versions/:id', async (req, res) => {
  const dir = getProjectDir(req, res);
  if (!dir) return;
  const id = req.params.id;
  if (!VERSION_ID_RE.test(id)) return res.status(400).json({ error: 'Invalid version id' });
  try {
    const data = await fsp.readFile(path.join(dir, 'versions', id), 'utf8');
    res.set('Content-Type', 'image/svg+xml');
    res.send(data);
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'Version not found' });
    res.status(500).json({ error: err.message });
  }
});

/* ---------------- options (AI-proposed alternatives) ---------------- */

const OPTION_ID_RE = /^option-[a-z]{1,2}-[a-zA-Z0-9_-]+\.svg$/;
const OPTIONS_STATE_FILE = 'state.json'; // inside options/; tracks which options were committed

/* Option letters are bijective base-26: a…z, then aa, ab, … The server assigns
   them (clients send labels only) so concurrent submitters can't collide and
   HTTP agents don't need letter math. Pure core kept testable. */
function lettersToIndex(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 96);
  return n;
}

function indexToLetters(n) {
  let s = '';
  while (n > 0) {
    s = String.fromCharCode(97 + ((n - 1) % 26)) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function nextLettersFrom(existingIds, count) {
  let max = 0;
  for (const id of existingIds) {
    const m = /^option-([a-z]{1,2})-/.exec(String(id));
    if (m) max = Math.max(max, lettersToIndex(m[1]));
  }
  return Array.from({ length: count }, (_, i) => indexToLetters(max + i + 1));
}

async function nextOptionLetters(optionsDir, count) {
  let files = [];
  try {
    files = await fsp.readdir(optionsDir);
  } catch {}
  return nextLettersFrom(files, count);
}

async function readCommittedIds(optionsDir) {
  try {
    const s = JSON.parse(await fsp.readFile(path.join(optionsDir, OPTIONS_STATE_FILE), 'utf8'));
    return Array.isArray(s.committed) ? s.committed : [];
  } catch {
    return [];
  }
}

async function writeCommittedIds(optionsDir, ids) {
  await fsp.writeFile(
    path.join(optionsDir, OPTIONS_STATE_FILE),
    JSON.stringify({ committed: ids }, null, 2)
  );
}

app.get('/api/projects/:project/options', async (req, res) => {
  const dir = getProjectDir(req, res);
  if (!dir) return;
  try {
    const optionsDir = path.join(dir, 'options');
    let files = [];
    try {
      files = (await fsp.readdir(optionsDir)).filter((f) => f.endsWith('.svg')).sort();
    } catch {}
    const committed = new Set(await readCommittedIds(optionsDir));
    // Prune ✓-marks whose file is gone (e.g. a file-tool agent cleared the
    // tray) so a later option reusing the name can't inherit a stale ✓.
    const live = [...committed].filter((id) => files.includes(id));
    if (live.length !== committed.size) {
      await writeCommittedIds(optionsDir, live);
      committed.clear();
      for (const id of live) committed.add(id);
    }
    const options = [];
    for (const f of files) {
      const st = await fsp.stat(path.join(optionsDir, f));
      options.push({ id: f, proposedAt: st.mtime.toISOString(), committed: committed.has(f) });
    }
    res.json(options);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Submit an options round over HTTP (the file-tools path still works too —
// see AGENTS.md rule 3). Clients send labels only; the server assigns the
// sequential option letters so concurrent submitters can't collide.
const MAX_OPTIONS_PER_ROUND = 6;

app.post('/api/projects/:project/options', async (req, res) => {
  const dir = getProjectDir(req, res);
  if (!dir) return;
  const body = req.body || {};
  // Round shape {"options":[{label,svg},…]} or singular shorthand {label,svg}
  const items = Array.isArray(body.options) ? body.options : body.svg != null ? [body] : null;
  if (!items || !items.length) {
    return res.status(400).json({ error: 'Body must be {"options": [{"label", "svg"}]} or {"label", "svg"}' });
  }
  if (items.length > MAX_OPTIONS_PER_ROUND) {
    return res.status(400).json({
      error: `Round too large: max ${MAX_OPTIONS_PER_ROUND} options per POST — split into multiple rounds`
    });
  }
  for (let i = 0; i < items.length; i++) {
    const it = items[i] || {};
    if (!it.svg || !String(it.svg).includes('<svg')) {
      return res.status(400).json({ error: `options[${i}]: body must contain SVG markup` });
    }
    if (!sanitizeLabel(it.label, '')) {
      return res.status(400).json({ error: `options[${i}]: label required (letters, numbers, "-" and "_")` });
    }
  }
  try {
    const optionsDir = path.join(dir, 'options');
    await fsp.mkdir(optionsDir, { recursive: true });
    const letters = await nextOptionLetters(optionsDir, items.length);
    const created = [];
    const failed = [];
    // Write the whole round before broadcasting so the tray pops in complete.
    for (let i = 0; i < items.length; i++) {
      const id = `option-${letters[i]}-${sanitizeLabel(items[i].label)}.svg`;
      if (!OPTION_ID_RE.test(id)) {
        failed.push(id || `option-${letters[i]}-<invalid>`);
        continue;
      }
      try {
        await fsp.writeFile(path.join(optionsDir, id), String(items[i].svg));
        created.push(id);
      } catch {
        failed.push(id); // forgiving: keep what succeeded, report the rest
      }
    }
    if (created.length) broadcastDebounced('options-changed', { project: req.params.project });
    res.status(201).json({ ok: created.length > 0, created, ...(failed.length ? { failed } : {}) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Dismiss all options
app.delete('/api/projects/:project/options', async (req, res) => {
  const dir = getProjectDir(req, res);
  if (!dir) return;
  try {
    await fsp.rm(path.join(dir, 'options'), { recursive: true, force: true });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fetch a single option's SVG content
app.get('/api/projects/:project/options/:id', async (req, res) => {
  const dir = getProjectDir(req, res);
  if (!dir) return;
  const id = req.params.id;
  if (!OPTION_ID_RE.test(id)) return res.status(400).json({ error: 'Invalid option id' });
  try {
    const data = await fsp.readFile(path.join(dir, 'options', id), 'utf8');
    res.set('Content-Type', 'image/svg+xml');
    res.send(data);
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'Option not found' });
    res.status(500).json({ error: err.message });
  }
});

// Dismiss a single option
app.delete('/api/projects/:project/options/:id', async (req, res) => {
  const dir = getProjectDir(req, res);
  if (!dir) return;
  const id = req.params.id;
  if (!OPTION_ID_RE.test(id)) return res.status(400).json({ error: 'Invalid option id' });
  try {
    await fsp.rm(path.join(dir, 'options', id), { force: true });
    const optionsDir = path.join(dir, 'options');
    const committed = new Set(await readCommittedIds(optionsDir));
    committed.delete(id);
    await writeCommittedIds(optionsDir, [...committed]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk-dismiss options. Mirrors POST /versions/delete: requires
// {"ids": [...], "confirm": true} as a server-side guard; the UI shows a
// confirmation dialog listing what will be removed first. Also drops the ids
// from state.json so their ✓-committed marks don't linger.
app.post('/api/projects/:project/options/delete', async (req, res) => {
  const dir = getProjectDir(req, res);
  if (!dir) return;
  const ids = req.body && Array.isArray(req.body.ids) ? req.body.ids : null;
  if (!ids || !ids.length) {
    return res.status(400).json({ error: 'Body must be {"ids": ["option-a-..."], "confirm": true}' });
  }
  if ((req.body && req.body.confirm) !== true) {
    return res.status(400).json({ error: 'Confirmation required: {"confirm": true}' });
  }
  for (const id of ids) {
    if (!OPTION_ID_RE.test(String(id))) return res.status(400).json({ error: `Invalid option id: ${id}` });
  }
  try {
    const optionsDir = path.join(dir, 'options');
    let deleted = 0;
    for (const id of ids) {
      await fsp.rm(path.join(optionsDir, String(id)), { force: true });
      deleted++;
    }
    const committed = new Set(await readCommittedIds(optionsDir));
    for (const id of ids) committed.delete(String(id));
    await writeCommittedIds(optionsDir, [...committed]);
    res.json({ ok: true, deleted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Promote an option into current.svg. The option itself stays in the tray.
app.post('/api/projects/:project/select', async (req, res) => {
  const dir = getProjectDir(req, res);
  if (!dir) return;
  const id = req.body && req.body.option;
  if (!id || !OPTION_ID_RE.test(String(id))) {
    return res.status(400).json({ error: 'Body must be {"option": "<option id>"}' });
  }
  try {
    const svg = await fsp.readFile(path.join(dir, 'options', String(id)), 'utf8');
    await fsp.writeFile(path.join(dir, 'current.svg'), svg);
    res.json({ ok: true, selected: id });
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'Option not found' });
    res.status(500).json({ error: err.message });
  }
});

// Bulk-delete committed versions. Requires {"confirm": true} as a server-side
// guard; the UI shows a confirmation dialog listing what will be removed first.
app.post('/api/projects/:project/versions/delete', async (req, res) => {
  const dir = getProjectDir(req, res);
  if (!dir) return;
  const ids = req.body && Array.isArray(req.body.ids) ? req.body.ids : null;
  if (!ids || !ids.length) {
    return res.status(400).json({ error: 'Body must be {"ids": ["vNNN-..."], "confirm": true}' });
  }
  if ((req.body && req.body.confirm) !== true) {
    return res.status(400).json({ error: 'Confirmation required: {"confirm": true}' });
  }
  for (const id of ids) {
    if (!VERSION_ID_RE.test(String(id))) return res.status(400).json({ error: `Invalid version id: ${id}` });
  }
  try {
    let deleted = 0;
    for (const id of ids) {
      await fsp.rm(path.join(dir, 'versions', String(id)), { force: true });
      deleted++;
    }
    res.json({ ok: true, deleted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Rollback restores a version into current.svg. It does NOT auto-commit:
// commits stay human-gated, so the user can iterate from the restored point
// and decide whether the restored state deserves its own version entry.
app.post('/api/projects/:project/rollback/:id', async (req, res) => {
  const dir = getProjectDir(req, res);
  if (!dir) return;
  const id = req.params.id;
  if (!VERSION_ID_RE.test(id)) return res.status(400).json({ error: 'Invalid version id' });
  try {
    const svg = await fsp.readFile(path.join(dir, 'versions', id), 'utf8');
    await fsp.writeFile(path.join(dir, 'current.svg'), svg);
    res.json({ ok: true, restoredFrom: id });
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'Version not found' });
    res.status(500).json({ error: err.message });
  }
});

// Fork a project (from its current state or a specific version) into a new
// independent project with fresh history. The fork records its origin in
// meta.json so lineage stays traceable.
app.post('/api/projects/:project/fork', async (req, res) => {
  const dir = getProjectDir(req, res);
  if (!dir) return;
  const name = String((req.body && req.body.name) || '').trim();
  const version = req.body && req.body.version;
  if (!PROJECT_NAME_RE.test(name)) {
    return res.status(400).json({ error: 'Invalid new project name' });
  }
  if (version && !VERSION_ID_RE.test(version)) {
    return res.status(400).json({ error: 'Invalid version id' });
  }
  const dest = safeProjectPath(name);
  try {
    try {
      await fsp.access(dest);
      return res.status(409).json({ error: `Project "${name}" already exists` });
    } catch {}
    const sourcePath = version ? path.join(dir, 'versions', version) : path.join(dir, 'current.svg');
    const svg = await fsp.readFile(sourcePath, 'utf8');
    await fsp.mkdir(path.join(dest, 'versions'), { recursive: true });
    await fsp.writeFile(path.join(dest, 'current.svg'), svg);
    const forkedFrom = { project: req.params.project, version: version || null };
    await fsp.writeFile(
      path.join(dest, 'meta.json'),
      JSON.stringify({ name, description: '', created: new Date().toISOString(), forkedFrom }, null, 2)
    );
    res.status(201).json({ name, forkedFrom });
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'Source not found' });
    res.status(500).json({ error: err.message });
  }
});

// Rename a project folder. If the agent 🎯 target pointed at the old name,
// .focus.json moves with it so agents keep editing the same design.
app.post('/api/projects/:project/rename', async (req, res) => {
  const dir = getProjectDir(req, res);
  if (!dir) return;
  const name = String((req.body && req.body.name) || '').trim();
  if (!PROJECT_NAME_RE.test(name)) {
    return res.status(400).json({ error: 'Invalid new project name' });
  }
  if (name === req.params.project) return res.json({ ok: true, name });
  const dest = safeProjectPath(name);
  try {
    try {
      await fsp.access(dest);
      return res.status(409).json({ error: `Project "${name}" already exists` });
    } catch {}
    await fsp.rename(dir, dest);
    if ((await readFocusRaw()) === req.params.project) {
      await fsp.writeFile(FOCUS_FILE, JSON.stringify({ project: name }, null, 2));
    }
    res.json({ ok: true, name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Rename a version's label while keeping its vNNN number:
// v001-old-label.svg → v001-new-label.svg
app.post('/api/projects/:project/versions/:id/rename', async (req, res) => {
  const dir = getProjectDir(req, res);
  if (!dir) return;
  const id = req.params.id;
  if (!VERSION_ID_RE.test(id)) return res.status(400).json({ error: 'Invalid version id' });
  const label = sanitizeLabel(req.body && req.body.label);
  const newId = `${id.slice(0, 4)}-${label}.svg`;
  if (!VERSION_ID_RE.test(newId)) return res.status(400).json({ error: 'Invalid label' });
  if (newId === id) return res.json({ ok: true, id });
  try {
    const to = path.join(dir, 'versions', newId);
    try {
      await fsp.access(to);
      return res.status(409).json({ error: `Version "${newId.replace(/\.svg$/, '')}" already exists` });
    } catch {}
    await fsp.rename(path.join(dir, 'versions', id), to);
    res.json({ ok: true, id: newId });
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'Version not found' });
    res.status(500).json({ error: err.message });
  }
});

// Unknown API paths get a JSON signpost instead of Express's default HTML
// error, so agents that guess a wrong URL are pointed back to the index
// (and, via the Link header middleware, at the conventions mirror).
app.use('/api', (_req, res) => {
  res.status(404).json({
    error: 'Unknown API endpoint',
    see: '/api',
    conventions: '/api/conventions'
  });
});

app.listen(PORT, () => {
  console.log(`SVG Studio server running at http://localhost:${PORT}`);
  console.log(`Projects directory: ${SVG_DIR}`);
});