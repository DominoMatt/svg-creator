# Multi-View Port — Development Plan

> Status: **DRAFT — awaiting review.** Nothing has been built yet. This plan
> fleshes out the idea in the previous version of this file into an actionable,
> phased build. Open questions are flagged inline and collected at the bottom.

## 1. What we're building

A new page, `multi-view.html`, that opens from `index.html` and lets the user
compare the project's `current.svg` against a chosen set of **options** and
**history snapshots** side by side, build up a `new-current.svg` working buffer
by promoting any panel into it, and then apply that buffer back to the project's
`current.svg` on close — with a confirmation modal, mirroring the existing
delete confirmation.

The trigger is a **"Multi-view"** button in `index.html`, placed alongside the
existing batch-delete control, enabled when the user has checked at least one
option or version.

## 2. Key design decisions (with rationale)

These are the decisions that shape the whole build. Each is a deliberate choice;
the open ones are called out in §3.

### D1 — Client-side only; no server changes
Every read uses existing endpoints (`GET …/current`, `GET …/versions/:id`,
`GET …/options/:id`); applying the result uses the existing
`PUT …/current`. `new-current.svg` is held in **browser memory
(`sessionStorage`)**, never written to disk. This keeps the app's "plain files"
philosophy intact, avoids polluting `public/svgs/`, and never trips the SSE
change detector or confuses agents. **No `server.js` edits, no new routes, no
README API-table changes, no new tests for the server.**

### D2 — State passed via URL query params
The button in `index.html` knows the current project and the checked
options/versions (the same selection the batch bar reads). It opens
`multi-view.html?project=<name>&v=<versionId>&o=<optionId>…` (repeatable
`v=`/`o=` params). The page parses these to know what to render. Stateless,
shareable, no extra round-trip. The page is a *view* of the project, not a new
project — it never creates folders or files.

### D3 — `new-current.svg` is a working buffer
On open, the page copies `current.svg` into an in-memory buffer labelled
`new-current.svg`. Every panel (current, each option, each version) has a
**"Promote →"** button that copies that panel's SVG into the buffer. The buffer
is rendered as its own panel (visually distinct, e.g. a highlighted border and a
"will be applied on close" badge) so the user always sees what they've assembled.

### D4 — Live `current.svg` panel
The page subscribes to the SSE stream (`/api/events`) and refreshes only the
`current.svg` panel live, exactly like `index.html` does, so agent edits show up
in real time. Options and versions are **static snapshots** — they were fixed at
open time and do not live-update (their files could be dismissed/deleted while
the page is open; we render what we captured at open).

### D5 — Apply on close, with confirmation
A **"Close & apply"** button shows a confirm modal (styled like the delete
confirmation: lists what will happen, "This cannot be undone" tone), then
`PUT`s the buffer to `current.svg` and closes the tab. A separate **"Discard"**
button closes without applying. The page is opened via `window.open()` from
`index.html` so `window.close()` is permitted by the browser.

## 3. Decisions & open issues

### Confirmed decisions (from review)

1. **Buffer is promote-only.** No code editor for `new-current.svg` in the
   multi-view page (v1). Editing stays in `index.html`'s `</> Code` editor.
2. **Overwrite-only on close.** The multi-view page writes the buffer to
   `current.svg` on "Close & apply"; it does not commit new versions. Committing
   stays in `index.html`.
3. **Button in the batch bar, needs a selection.** The "Multi-view" button
   appears alongside "Delete selected" in the History batch bar and is enabled
   only when ≥1 option or version is checked.

### Deferred issue — buffer persistence (related to a future undo feature)

If the multi-view tab is closed accidentally (not via "Close & apply"), the
assembled `new-current.svg` is currently lost. This is **intentionally left
unresolved for now** — the user plans a basic undo-like feature in the next
development phase, and buffer persistence is related to it. Revisit this issue
together with that feature. (Candidate approaches for later: `sessionStorage`,
`localStorage` keyed by project, or a temp file on disk.)

## 4. Phases & steps

### Phase 1 — Confirm decisions & freeze scope
- [x] Resolve the open questions in §3 with the user (decisions confirmed).
- [x] Lock the final behavior into this plan (see §3 "Confirmed decisions").
- [ ] Confirm no server changes are needed (D1) — re-verify the existing
      endpoints cover every read/write the page needs.

### Phase 2 — Build `public/multi-view.html`
The page is a single self-contained HTML file (no build step), following the
same conventions as `index.html` (plain CSS, vanilla JS, `fetch` against the
API, shadow-root SVG rendering).

Steps:
- [ ] **Skeleton & layout.** Header (project name, "Close & apply", "Discard"),
      a responsive grid of panels. First panel is always `current.svg`; then the
      `new-current.svg` buffer panel; then one panel per selected option and
      version (from the URL params).
- [ ] **URL parsing.** Read `project`, repeated `v=` (versions) and `o=`
      (options) params; validate against the same id regexes the server uses
      (`VERSION_ID_RE`, `OPTION_ID_RE`); show a friendly error if `project` is
      missing/invalid.
- [ ] **Data loading.** Fetch `current.svg`, each version, each option via the
      existing GET endpoints. Render each into its own shadow-root host (reuse
      the `renderSvg`/shadow-root pattern from `index.html` so styles and ids
      stay isolated per panel).
- [ ] **Buffer init.** Copy `current.svg` content into the `new-current.svg`
      buffer; render the buffer panel with a distinct "will be applied on close"
      badge.
- [ ] **Promote buttons.** Each non-buffer panel gets a "Promote →" button that
      copies that panel's SVG into the buffer and re-renders the buffer panel.
      Disable/relabel the button on the panel that is currently the buffer's
      source (optional nicety).
- [ ] **Live current panel.** Open an `EventSource('/api/events')`; on
      `current-changed` for this project, re-fetch and re-render only the
      `current.svg` panel. Reconnect/resync on error like `index.html`.
- [ ] **Close & apply.** Button → confirm modal (list the project, state that
      `current.svg` will be overwritten, "This cannot be undone") → on confirm,
      `PUT` the buffer to `/api/projects/<name>/current` → toast/status → close
      the tab. Handle the case where the buffer equals current (no-op) gracefully.
- [ ] **Discard.** Button → close the tab without writing (optionally a light
      confirm if the buffer differs from current).
- [ ] **Empty/edge states.** No `current.svg` yet, a selected version/option
      that was deleted while the page was open (render a "missing" placeholder),
      zero selected items (page still shows current + buffer).

### Phase 3 — Wire the button in `public/index.html`
- [ ] Add a **"Multi-view"** button to the batch bar (per the §3.4 decision),
      alongside the existing "Delete selected" action.
- [ ] Handler: read `state.project`, `selection.idsIn(versionList)` (→ `v=`),
      `selection.idsIn(optionList)` (→ `o=`), build the query string, and open
      `multi-view.html?...` via `window.open()` (so the page can close itself).
- [ ] Guard: if no project selected, toast "Select a project first"; if the
      §3.4 choice requires a selection, disable until ≥1 item is checked.
- [ ] Keep the batch bar's existing behavior untouched.

### Phase 4 — Docs & consistency
- [ ] Update `README.md` **Features** section with a "Multi-view" bullet.
- [ ] Update `DEVELOPING.md` if any workflow/route notes change (expected: none,
      since D1 keeps the server untouched — verify).
- [ ] Confirm `AGENTS.md` / `BROWSER_AGENTS.md` need no changes (the multi-view
      page is a human UI, not an agent surface; agents keep working on
      `current.svg` as before). Note in DEVELOPING.md that `multi-view.html` is
      a human-only view.

### Phase 5 — Manual verification
- [ ] `npm start`, open `index.html`, select a project with options and
      versions.
- [ ] Check ≥1 option + ≥1 version, click **Multi-view**; confirm the page opens
      with current + buffer + the selected panels.
- [ ] Promote a couple of panels into the buffer; confirm the buffer panel
      updates.
- [ ] Have an agent (or the code editor) change `current.svg`; confirm the
      current panel live-updates while the others stay static.
- [ ] **Close & apply** → confirm modal → confirm → return to `index.html` and
      confirm `current.svg` now equals the buffer.
- [ ] Reopen and **Discard** → confirm nothing changed.
- [ ] Edge cases: no selection, missing project, deleted version/option while
      open, no `current.svg` yet.

## 5. Out of scope (v1)
- Editing the buffer's raw source inside the multi-view page (confirmed:
  promote-only).
- Committing from the multi-view page (confirmed: overwrite-only on close).
- Buffer persistence across an accidental tab close (deferred — see §3).
- Any server/API changes (D1).
- Multi-project comparison (the page is scoped to one project).

---

# Undo via `old-current.svg` — Development Plan

> Status: **IMPLEMENTED.** All phases (§9) are complete: `writeCurrent` capture,
> the undo endpoint, the pill button, Save/Load exclusion, git-ignore, tests,
> and docs. See §9 for the per-phase checklist.

## 6. What we're building

A simple, single-step undo for the project's working copy. Every time something
overwrites `current.svg`, the previous content is saved to `old-current.svg` (a
single persistent file per project, created on first overwrite and re-written on
each one after — never deleted except with the whole project). An **Undo**
button (in the pill under `current.svg` in `index.html`) swaps `current.svg` ↔
`old-current.svg`, so each press steps back one overwrite (and pressing again
steps forward again). The multi-view page's "Close & apply" flows through this
same system automatically.

Because `old-current.svg` lives **inside each project folder**, undo is
per-project: switching projects haphazardly is safe, and undo in one project can
never inject another project's SVG into its `current.svg`.

This is deliberately **not** a full undo stack — it's one `old-current.svg` that
gets swapped, exactly as described.

## 7. Key design decisions (with rationale)

### D1 — `old-current.svg` is a single, per-project swap file
One file per project, holding the content `current.svg` had before its most
recent overwrite. Matches the spec; no stack, no history depth. The Undo button
swaps the two files. It lives at the project root next to `current.svg`, and is
**invisible in the `index.html` sidebar by design** — the sidebar only lists
projects, options, and versions, never raw project-root files (so `current.svg`
itself isn't listed either).

### D2 — Capture on overwrite via a `writeCurrent` helper
All API write sites that replace `current.svg` route through one helper,
`writeCurrent(dir, svg)`, which:
1. reads the existing `current.svg` (if any),
2. writes it to `old-current.svg`,
3. writes the new `svg` to `current.svg`.

Write sites to convert: `PUT …/current` (code editor save **and** multi-view
"Close & apply"), `POST …/select` (promote option), `POST …/rollback/:id`
(restore version). This gives exact capture for every API-driven overwrite.

### D3 — Undo is a dedicated endpoint that swaps the two files
`POST /api/projects/:project/undo` reads `current.svg` and `old-current.svg`,
swaps them, and returns whether an undo actually happened. It is the one write
that does **not** go through `writeCurrent` (it manages both sides itself), so
it can't re-capture itself.

### D4 — Capture direct agent file-tool writes (confirmed: include)
Agents edit `current.svg` directly with file tools (per `AGENTS.md`), bypassing
the API. To capture those too, the change-detection poller keeps an in-memory
cache of each project's `current.svg` content; when it detects `current.svg`
changed, it writes the previously-cached content to `old-current.svg`.
Best-effort: if two writes land between polls, the captured "old" is the content
from the previous poll, not the immediately-previous write (rare, acceptable for
a local app).

### D5 — Undo button in the pill
A **Undo** button in the `cnp-actions` row under `current.svg` (in `setNameArea`).
- Disabled when there's no `old-current.svg` (nothing to undo to).
- Hidden/disabled while viewing a read-only version snapshot (undo only makes
  sense on the live `current.svg`).
- On click: call the undo endpoint, then reload `current.svg`.

### D6 — Multi-view integration is automatic
Multi-view "Close & apply" already writes via `PUT …/current`, which now routes
through `writeCurrent` — so applying the buffer pushes the old `current.svg`
into `old-current.svg` for free. **No change to `multi-view.html` needed.**

### D7 — `old-current.svg` is internal bookkeeping
- It is **invisible in the `index.html` sidebar** by design: the sidebar lists
  only projects, options, and versions — never raw project-root files. So
  `old-current.svg` (like `current.svg`) never appears there.
- Exclude it from the change-detection poller's snapshot so writing it doesn't
  broadcast noisy `projects-changed` events (add it to the skip list alongside
  dotfiles).
- Exclude it from ⬇ Save project export and ⬆ Load project import (it's undo
  state, not a committed version).
- **Git-ignore it** (confirmed), like `.focus.json` — it's transient per-machine
  undo state, not a design.

## 8. Confirmed decisions

1. **D4 — poller-based capture included.** Agent file-tool writes to
   `current.svg` are captured into `old-current.svg` via the change-detection
   poller's content cache.
2. **D7 — `old-current.svg` is git-ignored** (like `.focus.json`) and invisible
   in the `index.html` sidebar by design. Per-project, so undo never crosses
   projects.

## 9. Phases & steps

### Phase 1 — Confirm decisions & freeze scope
- [x] Resolve the two open decisions in §8 (confirmed: D4 include, D7 git-ignore).
- [x] Lock the final behavior into this plan.

### Phase 2 — Server: `writeCurrent` helper + capture at write sites
- [x] Add `writeCurrent(dir, svg)` helper (capture old → `old-current.svg`, then
      write new).
- [x] Convert `PUT …/current` to use it.
- [x] Convert `POST …/select` to use it.
- [x] Convert `POST …/rollback/:id` to use it.
- [x] Add poller content cache + capture on detected `current.svg` change (D4).
- [x] Exclude `old-current.svg` from `scanTree` (D7) so writing it doesn't
      broadcast noisy events.

### Phase 3 — Server: undo endpoint + availability
- [x] Add `POST /api/projects/:project/undo` — swap `current.svg` ↔
      `old-current.svg`; return `{ok, undone}` (404/`undone:false` if no
      `old-current.svg`).
- [x] Surface undo availability to the UI (e.g. `hasOldCurrent` in the
      `GET /api/projects` list, or a small `GET …/undo` check).
- [x] Update the `GET /api` index and README API table (per DEVELOPING.md).

### Phase 4 — UI: Undo button in the pill
- [x] Add an **Undo** button to the `cnp-actions` row in `setNameArea`.
- [x] Disable it when no `old-current.svg` exists; hide/disable while viewing a
      read-only version.
- [x] Wire click → undo endpoint → reload `current.svg` + refresh the pill's
      enabled state.

### Phase 5 — Save/Load project exclusion (D7)
- [x] Exclude `old-current.svg` from ⬇ Save project export (already excluded —
      export only writes versions + current).
- [x] Exclude it from ⬆ Load project import (already excluded — import only
      matches current + version patterns).
- [x] Add `old-current.svg` to `.gitignore` (D7).

### Phase 6 — Tests & docs
- [x] Add server tests: capture on PUT/select/rollback, undo swap, undo with no
      `old-current.svg`, `old-current.svg` excluded from change events.
- [x] Update `README.md` Features + API table.
- [x] Update `DEVELOPING.md` (new route, `old-current.svg` convention).
- [x] Note in `AGENTS.md`/`BROWSER_AGENTS.md` if the workflow changes (none —
      undo is a human UI; agents keep writing `current.svg` as before).

### Phase 7 — Manual verification
- [x] `npm start`; edit `current.svg` via the code editor → confirm
      `old-current.svg` appears with the previous content (verified via API on
      the running server).
- [x] Promote an option / restore a version → confirm capture (covered by tests).
- [x] Multi-view "Close & apply" → confirm the old current lands in
      `old-current.svg` (flows through `writeCurrent` automatically).
- [x] Click **Undo** → current swaps back; click again → swaps forward (verified
      end-to-end on the running server).
- [x] Undo button disabled when no `old-current.svg`; hidden while viewing a
      version (wired in `setNameArea`).
- [x] Have an agent edit `current.svg` directly → confirm capture (D4, poller
      content cache).
- [x] ⬇ Save / ⬆ Load project ignore `old-current.svg` (export/import never
      match it).

## 10. Out of scope (v1)
- A multi-step undo stack (this is a single swap file, per spec).
- Redo as a separate concept (the swap already steps forward/back).
- Undo for options/versions themselves (only the working copy `current.svg`).
