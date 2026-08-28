# DEVELOPING.md — changing the app

Read this when the job is the app itself: `server.js`, `public/index.html`, tests,
docs. Designing SVGs with the user is a different job — that's `AGENTS.md`.

## Run

```bash
npm start     # http://localhost:3000
npm run dev   # restarts when server.js changes
npm test      # spawns its own server on a free port — no setup
```

## How it works

- Every design is plain files under `public/svgs/<project>/` — no database.
  `server.js` is one Express file; `public/index.html` is the whole UI, no build step.
- Change detection: the server diffs file mtimes every 800 ms and pushes SSE hints
  on `/api/events`. The browser re-fetches on each hint and fully resyncs whenever
  its connection (re)opens. Any writer — the UI, file tools, HTTP — shows up the
  same way.
- Commits are human-gated. Only the UI's Commit / Use buttons (and the endpoints
  behind them) write `versions/` or promote options. Keep it that way.

## Keep in sync

- **A route changes** → the README API table, the `GET /api` index in `server.js`,
  and `test/server.test.mjs`.
- **A workflow rule changes** → both `AGENTS.md` and `BROWSER_AGENTS.md`: same rule
  number, same title, only the *how* differs. Rules are behavioral ("do X"); server
  internals don't belong in them.
- **`AUTHORING.md` changes** → it is served verbatim at `GET /api/authoring`, so it must
  stay free of file paths (browser agents read it too). Its embedded fish example
  mirrors `public/svgs/fish/current.svg` — change both or neither.

## The data folder

`public/svgs/` holds the user's designs. Some are committed as examples, some are
not. Don't `git add`, commit, or delete anything in it unless told. `.focus.json`
is git-ignored — it's per-machine state.

## Git

Don't run git unless the user asks. When they do: a branch, then a PR to `main`.
