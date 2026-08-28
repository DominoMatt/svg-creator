# AGENTS.md — working in svg-creator

SVG Studio is a local app (`npm start`, http://localhost:3000) where a person and an
agent design SVGs together. Designs are plain files under `public/svgs/`; the
browser shows every change live.

## Which job are you doing?

- **Designing SVGs with the user** — they mention a project, shape, color, option,
  version, or commit → follow this file. Touch only `public/svgs/**`.
- **Changing the app** — server, UI, tests, docs, endpoints → read
  [DEVELOPING.md](DEVELOPING.md). Leave `public/svgs/**` alone; it's the user's data.
- Not sure ("fix the eye")? Ask one question.

Agents that reach the app through a browser follow [BROWSER_AGENTS.md](BROWSER_AGENTS.md)
instead — it's served to them at `GET /api/conventions`.

## The files

```
public/svgs/
├── .focus.json            # { "project": "<name>" } — the user's 🎯 target for agents
└── <project>/
    ├── current.svg        # working copy — what the browser shows
    ├── meta.json          # name, description, fork lineage
    ├── versions/          # user-committed checkpoints: vNNN-<label>.svg
    └── options/           # your proposals: option-<letter>-<label>.svg
```

## Rules

1. **Find the target.** A project named in chat wins — and rewrite `.focus.json` to
   match, even if it already does, so the 🎯 marker follows. Otherwise use the
   project in `.focus.json`. None set? Ask. What's on the user's screen is not the
   target. The name must be an existing folder under `public/svgs/`.
2. **Read before writing.** `current.svg`, the newest file in `versions/`, and
   `meta.json`. Re-read at the start of every turn — the user may have changed things.
3. **Edit or propose.** One obvious result (a stroke width, a named color, a text
   edit) → change `current.svg` directly. Open-ended ("friendlier", "warmer") → write
   2–3 files into `options/` and let the user pick in the browser. New options append
   to the tray; clear it only when asked. Write the markup the way
   [AUTHORING.md](AUTHORING.md) shows — named parts, placed by `transform`.
4. **Never finalize.** Don't copy anything into `versions/`, and don't copy an option
   into `current.svg`. Suggest it: "Looks good — want to commit this as v004?"
5. **Check your work.** Re-read what you wrote before saying it's ready. Broken
   markup renders as a blank canvas.
6. **Say it's ready.** The browser updates by itself within a second — no refresh
   instructions, no waiting, no polling.
7. **Naming.** Labels use letters, digits, `-`, `_` — keep them short. Options are
   `option-<letter>-<label>.svg`; letters run `a`…`z`, `aa`, `ab`, … and continue
   past the highest letter already in `options/` (start at `a` only when it's empty).
8. **Stay in your lane.** File tools only: read, create, edit, delete under
   `public/svgs/`. No terminal commands, no HTTP calls, no git. "Commit" means the
   studio's Commit button, never `git commit` — run git only when the user says "git".
