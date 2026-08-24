# PLANS.md — External agent support

Goal: let **external agents** participate in the full SVG Studio workflow. Two
supported modes, both first-class:

1. **Filesystem mode** (today's default — Codespace/editor agents): read/write
   `public/svgs/**` directly per `AGENTS.md`. **Unchanged by this plan.**
2. **HTTP mode** (orchestrators with no disk access — scripts, browser-driving
   agents, remote services): everything works over the existing API *except*
   proposing options rounds — there is no POST endpoint. That is the one
   functional gap.

The server stays a dumb file-and-API service: **no agent runtime, no model proxy,
and no agent UI inside the app's HTML.** The agent lives outside and brings its
own model.

Two workstreams close the gap, plus a docs-sync pass so the three sources of truth
(`AGENTS.md`, `README.md`, inline comments) stay consistent.

---

## Workstream 1 — New endpoints: options POST + conventions GET

### Companion endpoint: `GET /api/conventions`

HTTP-mode agents have no way to *discover* the workflow rules: their hosts don't
auto-load `AGENTS.md`, and they have no filesystem to read it from. This endpoint
is their only channel. Design constraints:

- **GET only, never PUT** — `AGENTS.md` stays editable via file tools/git; the
  endpoint is a read-only mirror (single source of truth unchanged).
- **Dedicated route** reading `<repo>/AGENTS.md` — not broader static serving,
  which would expose `package.json` etc.
- **Read per-request, not cached at startup** — rule edits apply immediately,
  matching the live-reload spirit of the rest of the app.
- Response: `text/markdown; charset=utf-8`; `404` if the file is missing.

### Current state

- Options rounds are created exclusively by writing files into `public/svgs/<project>/options/`.
  `server.js` (~line 432) says this is *deliberate* ("see AGENTS.md rule 8") — that
  decision predates the browser-agent use case and is what we're revising.
- Everything downstream already works over HTTP: listing, fetching, selecting,
  committing, dismissing options.
- Naming rules live in `AGENTS.md` rule 5: `option-<letters>-<label>.svg`, letters
  sequential `a…z` then `aa, ab, …`, continuing past the highest existing letter.
  **No server-side logic implements letter sequencing today** — agents do it by hand.
- Existing building blocks to reuse: `OPTION_ID_RE`, `sanitizeLabel()`,
  `getProjectDir()`, `broadcastDebounced('options-changed', …)`.

### Design decisions

1. **Server assigns option letters; clients never send them.**
   Auto-sequencing removes the collision risk when two agents (or an agent + human
   pasting into the raw editor) submit rounds concurrently, and spares HTTP clients
   from having to implement base-26 letter math. Request carries labels only.

   Algorithm: scan `options/*.svg`, extract letters via `/^option-([a-z]{1,2})-/`,
   map each to its bijective base-26 index (`a=1 … z=26, aa=27 …`), take max+1,
   render back to letters. Empty tray starts at `a`.

2. **Request/response shape** (JSON only, mirroring `commit`/`select` style):

   ```
   POST /api/projects/:name/options
   { "options": [ { "label": "warm-palette", "svg": "<svg …" },
                  { "label": "cool-palette", "svg": "<svg …" } ] }

   → 201 { "ok": true, "created": ["option-a-warm-palette.svg",
                                    "option-b-cool-palette.svg"] }
   ```

   Also accept the singular shorthand `{ "label", "svg" }` for one-option rounds.
   **Rounds are capped at 6 options per POST** (decided 2026-08-24) — cheap guard
   against a runaway agent flooding the tray; larger batches get a `400` asking
   the client to split. Splitting is safe: letters keep sequencing correctly
   across rounds since assignment happens per-request.
   Errors: `400` missing/empty `svg`, invalid project, unsanitizable label, round
   size > 6; `404` unknown project (match existing endpoints' behavior).

3. **Validation stays light**, consistent with the rest of the codebase:
   - label through `sanitizeLabel()` (already enforces `[a-zA-Z0-9_-]`, ≤40 chars);
   - reject empty ids after sanitizing;
   - sanity-check `svg` contains `<svg` (same trust level as `PUT /current`);
   - final filename re-checked against `OPTION_ID_RE` before writing.

4. **Live updates:** rely on the existing mtime poller (~800 ms) as the safety net,
   but call `broadcastDebounced('options-changed', { project })` directly after the
   writes so the tray pops instantly.

5. **Atomicity:** write all files in the round before broadcasting; on a mid-round
   failure, still report which files were created (`201` partial with `failed` array)
   rather than deleting — matches the codebase's forgiving file-tool spirit.

### Implementation steps

1. Add `nextOptionLetters(count)` helper near `OPTIONS_STATE_FILE` helpers:
   readdir → parse existing letters → return the next N letter strings.
2. Add route `app.post('/api/projects/:project/options', …)` in the options section:
   validate body (including the ≤6 cap) → compute letters → sanitize labels →
   build filenames → validate against `OPTION_ID_RE` → mkdir `-p` options dir →
   write files → `broadcastDebounced` → respond `201`.
3. Delete the "there is deliberately no POST endpoint" comment (~line 432).
4. Unit-testable core: keep letter math in a pure function.
5. Add `app.get('/api/conventions', …)`: read `AGENTS.md` from the repo root
   (`path.join(__dirname, 'AGENTS.md')`), send as `text/markdown`; `404` on
   ENOENT. No caching layer.
6. Extend the existing suite (`test/server.test.mjs`, run via `npm test`) with
   cases for both new endpoints — including the letter-sequencing acceptance
   checks above, so they stay locked in as the code evolves.

### Acceptance checks

- Round of 2 on empty tray → `option-a-*`, `option-b-*`; tray appears in UI < 1 s.
- Round after existing `a`,`b`,`z` → continues at `aa` (not `aaa`, not `c`).
- Duplicate label in same round → distinct letters, both created.
- Invalid project / empty svg / garbage label → proper 400s, nothing written.
- Round of 7 → `400`, nothing written; round of exactly 6 → succeeds.
- UI tray shows new options marked uncommitted; ✓-tracker untouched.
- `GET /api/conventions` returns the AGENTS.md text; editing the file is
  reflected on the next request without a server restart.

---

## Workstream 2 — Docs & convention sync

The API change alters two written contracts:

1. **`AGENTS.md` rule 8** — amend to state the quiet channel is *file tools OR the
   HTTP API*, whichever the host environment affords; add the new endpoints to the
   endpoint list at the top; note that HTTP agents get letters assigned by the
   server (they send labels only) and can fetch these rules themselves via
   `GET /api/conventions`.
2. **Staying informed (HTTP agents)** — document both runtime shapes in the same
   rule-8 amendment: turn-based agents re-read state (`GET /api/focus`,
   `…/current`, `…/options`) at the start of each turn; persistent agents may
   subscribe to `GET /api/events`. Events are change-*hints*, not payloads — on
   receipt, re-`GET` the relevant state; harnesses should ignore their own echoes
   and fully resync whenever the stream (re)connects.
3. **`README.md`** — add row(s) to the HTTP API table for both new endpoints.
4. **`server.js`** — replace the stale "deliberately no POST" comment with a
   pointer to the new route.

### Compatibility guarantees (explicit non-goals of change)

- Zero modifications to existing routes, files on disk, or `index.html`.
- The new endpoint is purely additive; file-tool agents see no difference.
- `AGENTS.md`'s file-tools workflow remains the primary documented path for
  Codespace/editor agents.

---

## Out of scope (recorded, not planned)

- **Multi-writer concurrency guard** (ETag/if-match on `PUT /current`): real issue
  once multiple agents write the same project simultaneously, but orthogonal to
  this work; v1 ships with it documented as a known limitation.
- Auth/tokens: local tool, unchanged posture.

(The architectural exclusions — no agent UI in the app's HTML, no server-side
model proxy, no CORS layer — are recorded in the Goal section above.)

## Suggested order

1 → 2 (endpoint first since it defines the docs content).

## Open questions

- Should `POST /options` also accept raw `image/svg+xml` bodies for symmetry with
  `PUT /current`? (Lean no — rounds are inherently multi-file.)
