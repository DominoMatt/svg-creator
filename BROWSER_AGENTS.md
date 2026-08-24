# SVG Studio — how agents work here

You reached SVG Studio through a browser, so the app's API — called with
`fetch()` from your JavaScript tool — is your only channel. If you also have
file, shell, or other tools, don't use them for anything to do with SVG Studio —
the app owns its data, and every read and write goes through the endpoints
below. Don't go looking for the app's files.

SVG Studio is where a person and an agent design SVGs together. Each project has a
working copy (`current`), user-committed `versions`, and a tray of agent-proposed
`options`. The user's browser shows every change live.

## Authoring content

You can't drag shapes on a canvas, and no image, file, or rendering tool you may
have helps here. Every visual change is raw SVG markup pushed through the API:

1. **Compose** the SVG source directly (paths, circles, groups — whatever the
   change calls for).
2. **Push** it with `fetch()` from your JavaScript tool, run in the SVG Studio tab:
   `PUT …/current` for direct edits, `POST …/options` for proposals. Never by
   typing markup character-by-character into the app's own code editor, and never
   by navigating a tab to the endpoint — navigation can only GET.
3. **Verify by rendering, not by reading:** open a scratch tab, navigate it straight
   to the raw endpoint (`…/current`, `…/options/:id`, `…/versions/:id`), and
   screenshot/zoom it. These URLs serve the raw `.svg` and the browser renders it
   natively — nothing else is needed. This is your equivalent of a coding agent
   re-reading the file it just wrote; do it before telling the user something is
   ready.

## How to call

Same-origin `fetch()` from the SVG Studio tab, one call at a time. (A dedicated
HTTP/fetch tool, if your harness has one, works the same way.)

```js
// read
const r = await fetch('/api/projects/fish/current'); return await r.text();

// write current
await fetch('/api/projects/fish/current', {
  method: 'PUT', headers: { 'Content-Type': 'image/svg+xml' }, body: svg });

// propose options
await fetch('/api/projects/fish/options', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ options: [{ label: 'warmer', svg: svgA }, { label: 'cooler', svg: svgB }] }) });
```

## The calls you need

`GET /api` is the live index of every endpoint. The workflow uses these:

| Call | Purpose |
|---|---|
| `GET /api/projects` | list projects: `[{name, hasCurrent, versionCount, forkedFrom}]` |
| `GET` / `PUT /api/focus` | the user's 🎯 target: `{project}` |
| `GET` / `PUT /api/projects/:name/current` | the working copy. GET returns raw SVG; PUT takes raw SVG (`Content-Type: image/svg+xml`) or `{svg}` |
| `GET /api/projects/:name/versions` | committed history, newest first |
| `GET /api/projects/:name/versions/:id` | one version's raw SVG |
| `GET` / `POST /api/projects/:name/options` | GET lists the tray; POST submits `{options: [{label, svg}]}` (max 6) or a single `{label, svg}` |
| `GET /api/projects/:name/options/:id` | one option's raw SVG |
| `DELETE /api/projects/:name/options` | clear the tray |

## Rules

1. **Find the target.** A project named in chat wins — and `PUT /api/focus`
   `{project}` to match, so the 🎯 marker follows. Otherwise `GET /api/focus` and use
   that project. None set? Ask. What's on the user's screen is not the target. Focus
   is a signal to agents; it never changes what the canvas shows — don't write it
   for that.
2. **Read before writing.** `GET` the project's `current`, its newest version, and
   its entry in `/api/projects`. Re-`GET` at the start of every turn — the user may
   have changed things.
3. **Edit or propose.** One obvious result (a stroke width, a named color, a text
   edit) → `PUT …/current`. Open-ended ("friendlier", "warmer") → `POST …/options`
   with 2–3 labeled variants and let the user pick in the app. New options append to
   the tray; clear it only when asked. Write the SVG markup in the request body —
   never type it into the app's code editor.
4. **Never finalize.** Don't call `POST …/commit` or `POST …/select`. Suggest it:
   "Looks good — want me to commit this as v004?" and wait for a yes.
5. **Check your work.** Render it as in **Authoring content** step 3 before saying
   it's ready. That's the one time you navigate to an API URL — for looking, not
   calling.
6. **Say it's ready.** The user's app updates by itself within a second — no refresh
   instructions, no polling on their behalf.
7. **Naming.** Labels use letters, digits, `-`, `_` — keep them short. Send labels
   only; the server assigns the option letters.
8. **Stay in your lane.** The API only, one `fetch()` per call — no speculative
   probing, and no file or shell tools even if you have them. Use the page's real
   controls only for what the API can't do: the ⬆ Load SVG / ⬆ Load project file
   pickers. "Commit" means the studio's Commit button; git is out of scope here.
