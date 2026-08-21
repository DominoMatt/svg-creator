# AGENTS.md — How to work in svg-creator

This repo runs **SVG Studio**: a local server (`npm start`, port 3000) where a human and
an AI agent iteratively design SVGs. Every project is just files on disk under
`public/svgs/<project>/` — you participate by reading/writing those files with your normal
file tools. The browser UI live-reloads as files change; no restarts, no polling.

```
public/svgs/
├── .focus.json                # which project the user 🎯-targeted for agents
└── <project-name>/
    ├── current.svg            # the working copy — always what's displayed live
    ├── meta.json              # name, description, lineage (forks)
    ├── versions/              # explicit human-committed checkpoints (vNNN-label.svg)
    └── options/               # transient agent-proposed alternatives (option-X-label.svg)
        └── state.json         # server-managed ✓-tracker of committed options
```

Useful HTTP endpoints (mirror the same files, for when REST is more convenient):
`GET|PUT /api/projects/:name/current`, `GET /api/projects/:name/{versions,options}`,
`POST /api/projects/:name/{commit,select,rollback/:id,fork}`, `GET /api/focus`.

## Workflow rules

1. **Read before writing:** check `meta.json` and latest versions to understand context.
2. **Present, don't overwrite blindly:** for *open-ended* modifications, write 2–3 labeled
   files into `options/`; tell the user to look at the browser and pick.
3. **No options for simple asks.** If a request has one obvious result — a stroke-width
   change, a named color swap, a text edit — apply it directly to `current.svg`. Don't
   manufacture alternatives for unambiguous edits; options rounds are for subjective or
   directional feedback ("make it friendlier", "warmer palette") where comparing variants
   actually helps.
4. **Never commit on the user's behalf.** Suggest it instead: *"Looks good — want to commit
   this as v004?"*
5. **Naming:** options are `option-<letters>-<label>.svg`; versions are
   `vNNN-<label>.svg`. Labels use only letters, digits, `-` and `_`
   (`[a-zA-Z0-9_-]`, keep them short) — anything else makes the file appear in
   the UI but breaks its buttons. Option letters are lowercase and sequential:
   `a`…`z`, then `aa`, `ab`, … — continue after the highest letter already in
   `options/` (start at `a` only when the tray is empty).
6. **The user's UI updates automatically.** After writing files, simply tell the
   user the changes are ready to review — no polling, no prodding, no refresh
   instructions.
7. **"Commit" means svg-creator commit** — writing `current.svg` into the project's
   `versions/` folder via the commit endpoint/UI button. It has **nothing to do with git**.
   Only run `git commit` / touch the repository when the user explicitly says
   "git commit" (or similar). When in doubt, ask which one they mean — never conflate them.
8. **Stay quiet: file tools over terminal.** Do all agent work — reading `.focus.json`,
   reading/writing `current.svg`, and submitting options — with file tools
   (`read_file` / create / edit), never terminal commands (`curl`, `cat`, `echo >`).
   Terminal calls spam the user's session and were explicitly rejected. Submitting an
   options round quietly = creating the files directly in
   `public/svgs/<project>/options/` using the naming convention above; the server's
   file poller detects them within ~800ms and the tray updates live.
   **Rounds append by default: leave earlier options in the tray and continue
   the letter sequence past the highest existing one.** Only clear previous
   experiments when the user asks — and when clearing, delete `state.json` (the
   committed-✓ tracker) along with the option files, so a later option reusing a
   letter can't show up falsely marked as already committed.

## Targeting protocol — "quiet focus" *(agreed with user)*

The user marks the project agents should edit by clicking **🎯 Target** in the UI, which
writes `public/svgs/.focus.json`. The file contains exactly:

```json
{ "project": "<project-name>" }
```

(`"project": null` means no target.) When writing it, the name must match an existing
folder under `public/svgs/` — file writes bypass the API's existence check, and a typo
silently hides the 🎯 marker instead of erroring. Agents must resolve the edit target
like this:

1. **If the user names a project in chat, that wins.** Never second-guess an explicit name.
2. **Otherwise, read `.focus.json` quietly** — with file-read tools (`read_file`), *not*
   terminal commands (`curl`, `cat`). Terminal calls are noisy, spam the user's session,
   and were explicitly rejected ("let's do it quietly").
3. **No target set? Ask.** One short question beats guessing and editing the wrong project.
4. **Never assume** the project visible/on-screen in the user's browser is the target —
   there is no automatic selection tracking (tried and removed; see Current State).

**Sync both directions:** when the user names a project in chat, the agent must also
*update* `.focus.json` (again via quiet file edits) so the site's 🎯 marker moves to match.
The server emits a `focus-changed` SSE event when that file changes, and the UI re-renders
the marker live — no refresh needed.

**Always write on chat switch — even if the content looks unchanged.** Skipping the write
when the file "already matches" risks leaving a stale UI marker forever out of sync (this
bug happened). Rewriting the file is idempotent and forces the `focus-changed` event that
resyncs any listening browser. The browser shows a connection status pill and fully
resyncs whenever it (re)connects, so the marker can never stay stale.

---

These rules are the source of truth for how agents work in this repo.
Usage & API docs live in README.md.
