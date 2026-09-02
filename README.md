# SVG Studio

A local server where a human and an AI agent iteratively design SVGs together.
The agent works in plain `.svg` files, the browser shows every change live, and
nothing enters history unless *you* commit it.

## Quick start

```bash
npm install
npm start          # http://localhost:3000
npm run dev        # same, with node --watch auto-restart on server changes
npm test           # API self-test — spawns its own server on a free port, no setup
```

## How it works

Every design is just a folder of files — no database:

```
public/svgs/
├── .focus.json                # which project the user 🎯-targeted for agents
└── <project-name>/
    ├── current.svg            # the working copy — always what's displayed live
    ├── meta.json              # name, description, lineage (forks)
    ├── versions/              # explicit human-committed checkpoints (vNNN-label.svg)
    └── options/               # transient agent-proposed alternatives (option-X-label.svg)
```

Because designs are plain files, a coding agent participates with ordinary file tools,
and the browser live-reloads whatever changes — the server polls file mtimes (~800ms)
and pushes SSE events, and the UI fully resyncs whenever its connection (re)opens.
In practice that means you never wait on the agent or refresh: while it edits the
🎯-targeted project's `current.svg`, keep doing anything else — the targeted `current.svg` canvas is simply
up to date whenever you look.

## Features

- **Projects** — one folder per SVG; create and delete (with confirmation) from the sidebar
- **Load SVG** — ⬆ Load SVG imports a local `.svg` file as a brand-new project
  (named after the file), ready to iterate on
- **Human-gated commits** — Commit copies `current.svg` into `versions/vNNN-<label>.svg`;
  agents may suggest a commit but never make one
- **History & rollback** — preview any snapshot, restore it as the new working copy
  (non-destructive), bulk-delete versions with an explicit confirmation listing;
  versions can be renamed (✎ keeps their vNNN number)
- **Undo** — every overwrite of `current.svg` (Save, option promote, version restore,
  multi-view Close & apply, or an agent's file-tool write) first captures the old
  content into `old-current.svg`; the **↩ Undo** button in the pill swaps the two back.
  Press it again to toggle. The slot is per-project, git-ignored, and invisible in the
  sidebar
- **Rename projects** — ✎ next to each project in the sidebar; history moves with it
  and the agent 🎯 target follows the rename
- **Forks** — branch from the current state or any committed version into a fresh
  project; lineage recorded in the fork's `meta.json`
- **Options rounds** — agents propose alternatives as files in `options/`; compare side
  by side, promote ("Use") or ✓ commit straight from the tray, dismiss one or all.
  New proposals append to the tray until you clear them (✕ / Dismiss all, or ask the
  agent); committed options stay marked ✓
- **Multi-view** — check any options/versions and click **Multi-view** in the History
  bar to open a side-by-side comparison page (`multi-view.html`): `current.svg` (live)
  plus each selected item. Promote any panel into a `new-current.svg` buffer, then
  **Close & apply** overwrites the project's `current.svg` — choose **Apply** (keep
  your current focus) or **Apply (force focus)** (jump back to this project), or
  **Close**/**Discard** to leave it unchanged. A human-only view — it never writes
  files until you confirm
- **File tree** — 🌳 File tree opens a human-only page (`file-tree.html`) that
  "decompresses" every project's SVG into a scrollable, hierarchical outline
  (groups, paths, shapes) beside a canvas of the selected project. Click a node to
  highlight the matching element on the canvas; versions and options appear as tree
  nodes. It's a structural editor: rename an element's `id`/comment, delete nodes,
  create groups, and drag-and-drop to reorder or nest (cross-parent moves included).
  Edits made here stage into a `temp-current` buffer — **Push to current**
  applies them (capturing an undo slot), **Discard** drops them
- **Raw source editor** — `</>` Code toggles editable SVG source; Save (or Ctrl/Cmd+S)
  writes it back and the rendered view refreshes. Works on empty projects too: paste SVG
  source into a brand-new project and Save creates `current.svg`. Live updates pause
  while editing so agent writes can't clobber in-progress edits
- **Save / export** — ⬇ Save downloads the current SVG (or the previewed snapshot);
  ⬇ Save all writes the whole project into a real folder of plain `.svg` files via the
  File System Access API (per-file download fallback elsewhere) — deliberately no zip
- **Agent targeting** — 🎯 Target marks which project agents should edit
  (persisted as `public/svgs/.focus.json`); deleting the targeted project clears it,
  and the sidebar says so when no target is set
- **Agent bootstrap** — 🤖 in the header opens a copyable prompt that tells a browser
  agent what the app is, gives it this server's URL, and points it at the live docs
  (`/api/conventions`, `/api/authoring`, `/api`)
- **Connection status** — a pill in the header shows whether the browser is connected
  to the server; it reconnects automatically and resyncs everything on reconnect, and
  clicking it forces an immediate reconnect + resync

## HTTP API

The UI uses these endpoints; they mirror the files on disk, so scripts and agents
can use them too.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api` | Route index — machine-readable endpoint list; points agents at `/api/conventions` |
| `GET` | `/api/projects` | List all SVG projects |
| `GET` | `/api/file-tree` | All projects with `current.svg` + staged `temp-current` + versions + options, parsed for the file-tree view |
| `POST` | `/api/projects` | Create a new project `{ name }` |
| `DELETE` | `/api/projects/:name` | Delete entire project — requires `{confirm: true}`; UI asks first |
| `POST` | `/api/projects/:name/rename` | Rename project `{ name }` — folder renamed; agent 🎯 target follows |
| `GET` | `/api/projects/:name/current` | Fetch working copy |
| `PUT` | `/api/projects/:name/current` | Write working copy (accepts raw SVG or `{"svg": "..."}`) |
| `GET` | `/api/projects/:name/temp-current` | Fetch the file-tree's staged working copy (404 if none) |
| `PUT` | `/api/projects/:name/temp-current` | Stage a working copy for the file-tree view (no undo slot captured) |
| `POST` | `/api/projects/:name/temp-current/push` | Push the staged copy into `current.svg` (captures undo slot) and clear it |
| `DELETE` | `/api/projects/:name/temp-current` | Discard the staged copy without touching `current.svg` |
| `GET` | `/api/projects/:name/options` | List pending options (+ committed flags) |
| `POST` | `/api/projects/:name/options` | Submit an options round `{options: [{label, svg}]}` or singular `{label, svg}` — server assigns sequential letters; max 6 per round |
| `GET` | `/api/projects/:name/options/:id` | Fetch one option's SVG |
| `DELETE` | `/api/projects/:name/options` | Dismiss all options |
| `DELETE` | `/api/projects/:name/options/:id` | Dismiss one option |
| `POST` | `/api/projects/:name/options/delete` | Bulk-dismiss options `{ids, confirm: true}` — UI confirms first |
| `POST` | `/api/projects/:name/select` | Promote an option to `current.svg` (option stays in tray) |
| `POST` | `/api/projects/:name/commit` | Commit current → `versions/vNNN-<label>.svg`; or direct-commit an option via `{option: id}` (✓ marked, stays in tray) |
| `GET` | `/api/projects/:name/versions` | List versions (+ timestamps, labels) |
| `GET` | `/api/projects/:name/versions/:id` | Fetch one version |
| `PUT` | `/api/projects/:name/versions/:id` | Direct-write a version file (used by ⬆ Load project import) |
| `POST` | `/api/projects/:name/versions/:id/rename` | Rename a version's label `{ label }` — keeps its vNNN number |
| `POST` | `/api/projects/:name/versions/delete` | Bulk-delete versions `{ids, confirm: true}` — UI confirms first |
| `POST` | `/api/projects/:name/rollback/:id` | Restore version as current (no auto-commit) |
| `POST` | `/api/projects/:name/undo` | Swap `current.svg` with `old-current.svg` (undo last overwrite); `undone:false` when there's nothing to undo |
| `POST` | `/api/projects/:name/fork` | Fork to new project `{ name, version? }` — fresh history, lineage in meta.json |
| `GET` | `/api/focus` | Which project the user 🎯-targeted for agents |
| `PUT` | `/api/focus` | Set agent target `{ project }` — written by the UI Target button |
| `GET` | `/api/events` | SSE stream — events: `projects-changed`, `current-changed`, `versions-changed`, `options-changed`, `focus-changed` |
| `GET` | `/api/conventions` | Browser-agent workflow rules (read-only `BROWSER_AGENTS.md` mirror, always current) |
| `GET` | `/api/authoring` | How to structure SVG markup (read-only `AUTHORING.md` mirror, always current) |

## Working with an AI agent

Three doors, picked by what the agent can reach and what the job is:

- **Coding agent designing SVGs with you** → [AGENTS.md](AGENTS.md). It works in
  `public/svgs/` with plain file tools: reads before writing, proposes options for
  open-ended asks, edits directly for simple ones, never commits, moves the 🎯 target
  when you name a project in chat.
- **Browser agent** (reaches the app through the page) → [BROWSER_AGENTS.md](BROWSER_AGENTS.md),
  served live at `GET /api/conventions`. Same rules, expressed as API calls — the
  file is written so the agent uses the API even if it happens to have file tools.
- **Coding agent changing the app itself** → [DEVELOPING.md](DEVELOPING.md).

Both designing doors share [AUTHORING.md](AUTHORING.md) (served at `GET /api/authoring`):
how the SVG markup itself should be structured — named parts in nested groups, each
drawn around its own origin and placed by `transform` — so that "make the eye bigger"
lands on one obvious place in the source. The `fish` project is its worked example.