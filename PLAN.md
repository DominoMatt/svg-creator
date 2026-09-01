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
