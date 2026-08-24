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

## Features

- **Projects** — one folder per SVG; create and delete (with confirmation) from the sidebar
- **Load SVG** — ⬆ Load SVG imports a local `.svg` file as a brand-new project
  (named after the file), ready to iterate on
- **Human-gated commits** — Commit copies `current.svg` into `versions/vNNN-<label>.svg`;
  agents may suggest a commit but never make one
- **History & rollback** — preview any snapshot, restore it as the new working copy
  (non-destructive), bulk-delete versions with an explicit confirmation listing;
  versions can be renamed (✎ keeps their vNNN number)
- **Rename projects** — ✎ next to each project in the sidebar; history moves with it
  and the agent 🎯 target follows the rename
- **Forks** — branch from the current state or any committed version into a fresh
  project; lineage recorded in the fork's `meta.json`
- **Options rounds** — agents propose alternatives as files in `options/`; compare side
  by side, promote ("Use") or ✓ commit straight from the tray, dismiss one or all.
  New proposals append to the tray until you clear them (✕ / Dismiss all, or ask the
  agent); committed options stay marked ✓
- **Raw source editor** — `</>` Code toggles editable SVG source; Save (or Ctrl/Cmd+S)
  writes it back and the rendered view refreshes. Works on empty projects too: paste SVG
  source into a brand-new project and Save creates `current.svg`. Live updates pause
  while editing so agent writes can't clobber in-progress edits
- **Save / export** — ⬇ Save downloads the current SVG (or the previewed snapshot);
  ⬇ Save all writes the whole project into a real folder of plain `.svg` files via the
  File System Access API (per-file download fallback elsewhere) — deliberately no zip
- **Agent targeting** — 🎯 Target marks which project agents should edit
  (persisted as `public/svgs/.focus.json`)
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
| `POST` | `/api/projects` | Create a new project `{ name }` |
| `DELETE` | `/api/projects/:name` | Delete entire project — requires `{confirm: true}`; UI asks first |
| `POST` | `/api/projects/:name/rename` | Rename project `{ name }` — folder renamed; agent 🎯 target follows |
| `GET` | `/api/projects/:name/current` | Fetch working copy |
| `PUT` | `/api/projects/:name/current` | Write working copy (accepts raw SVG or `{"svg": "..."}`) |
| `GET` | `/api/projects/:name/options` | List pending options (+ committed flags) |
| `POST` | `/api/projects/:name/options` | Submit an options round `{options: [{label, svg}]}` or singular `{label, svg}` — server assigns sequential letters; max 6 per round |
| `GET` | `/api/projects/:name/options/:id` | Fetch one option's SVG |
| `DELETE` | `/api/projects/:name/options` | Dismiss all options |
| `DELETE` | `/api/projects/:name/options/:id` | Dismiss one option |
| `POST` | `/api/projects/:name/select` | Promote an option to `current.svg` (option stays in tray) |
| `POST` | `/api/projects/:name/commit` | Commit current → `versions/vNNN-<label>.svg`; or direct-commit an option via `{option: id}` (✓ marked, stays in tray) |
| `GET` | `/api/projects/:name/versions` | List versions (+ timestamps, labels) |
| `GET` | `/api/projects/:name/versions/:id` | Fetch one version |
| `POST` | `/api/projects/:name/versions/:id/rename` | Rename a version's label `{ label }` — keeps its vNNN number |
| `POST` | `/api/projects/:name/versions/delete` | Bulk-delete versions `{ids, confirm: true}` — UI confirms first |
| `POST` | `/api/projects/:name/rollback/:id` | Restore version as current (no auto-commit) |
| `POST` | `/api/projects/:name/fork` | Fork to new project `{ name, version? }` — fresh history, lineage in meta.json |
| `GET` | `/api/focus` | Which project the user 🎯-targeted for agents |
| `PUT` | `/api/focus` | Set agent target `{ project }` — written by the UI Target button |
| `GET` | `/api/events` | SSE stream — events: `projects-changed`, `current-changed`, `versions-changed`, `options-changed`, `focus-changed` |
| `GET` | `/api/conventions` | Agent workflow rules (read-only `AGENTS.md` mirror, always current) |

## Working with an AI agent

Point your coding agent at [AGENTS.md](AGENTS.md) — it defines the workflow: read before
writing, propose several options for open-ended changes (and skip options for trivial
ones), never commit on the user's behalf, prefer quiet file-tool operations over terminal
commands, and resolve the 🎯 target before touching anything.

## More

- [AGENTS.md](AGENTS.md) — agent workflow rules (source of truth)