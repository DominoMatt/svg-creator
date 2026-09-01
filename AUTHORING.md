# AUTHORING.md — how to write the SVG itself

Your rulebook says *when* to edit and *how* to deliver. This file says how the markup
should be written so that the next edit — yours or the user's — is small.

The SVG source is the shared workspace. The user reads it in the code view, and every
ask ("make the eye bigger", "move the tail back") has to land on one obvious place in
the markup. Structure the drawing so that it does.

## The example — the `fish` project

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300" viewBox="0 0 160 240">
  <!-- fish: drawn facing left around the center of its body (0,0); the transform stands it upright -->
  <g id="fish" transform="translate(80 105) rotate(90)"
     fill="#ffffff" stroke="#000000" stroke-width="4" stroke-linejoin="round" stroke-linecap="round">
    <!-- fins come first so the body paints over their roots -->
    <path id="tail" d="M 52 -16 L 104 -48 C 96 -26 96 26 104 48 L 52 16 Z"/>
    <!-- dorsal-fin and belly-fin are near-mirrors but stay separate: they get reshaped independently -->
    <path id="dorsal-fin" d="M -18 -38 Q -4 -58 16 -72 L 36 -32"/>
    <path id="belly-fin" d="M -10 42 Q -4 60 14 68 L 34 32"/>
    <g id="body">
      <path id="body-outline" d="M -70 0 C -58 -70 58 -70 70 0 C 58 70 -58 70 -70 0 Z"/>
      <path id="head-line" d="M -18 -32 Q -30 0 -16 30" fill="none" stroke-width="3"/>
      <g id="gills" fill="none" stroke-width="2">
        <!-- gill -->
        <path d="M -12 -24 Q 0 -8 -12 8"/>
        <path d="M 4 -19 Q 12 -8 4 3"/>
      </g>
      <path id="mouth" d="M -68 1 Q -58 8 -48 4" fill="none" stroke-width="3.5"/>
      <!-- eye: drawn around (0,0), placed on the head with one translate -->
      <g id="eye" transform="translate(-40 -14)">
        <circle id="sclera" r="11" stroke-width="2"/>
        <circle id="pupil" r="4.5" fill="#000000" stroke="none"/>
        <circle id="highlight" cx="-2" cy="-2" r="1.5" stroke="none"/>
      </g>
    </g>
  </g>
</svg>
```

What to copy from it:

- **Every nameable part has an `id`.** A part is a `<g>` when it has sub-parts, a single
  shape otherwise. The `id` is how the user and you refer to it — kebab-case nouns from
  the subject (`dorsal-fin`, `pupil`), unique in the drawing. A comment may add a note;
  it is never the name.
- **Nesting mirrors the subject.** `fish` › `body` › `eye` › `pupil`. Indent to match,
  and keep the indentation in what you send — the person reads this source, and
  flattened markup hides the hierarchy from them.
- **A part is drawn around its own origin and placed with `transform`.** The eye's
  circles sit at `(0,0)`; `translate(-40 -14)` puts the eye on the head. Move, rotate,
  or flip a part by editing its `transform` — never by rewriting its coordinates.
- **Inside a part, coordinates are absolute (uppercase path commands) in that part's
  local frame.** Edits stay local: changing one point moves one point. Don't write
  lowercase (relative) commands — one edit shifts every point after it, and they can't
  be checked by reading. Leave them alone only where an imported drawing already has them.
- **Paint order is source order.** Later elements paint on top. Fins come before the
  body so the body covers their roots.
- **A top-level component is self-contained.** Its `<g>` carries the fill, stroke, and
  stroke-width its parts share; parts override where they differ. The root `<svg>`
  carries only `xmlns`, size, and `viewBox`. Anyone can copy the `<g>` into another
  drawing and it renders the same.
- **Integers, one decimal at most.** Size the `viewBox` to the content so numbers stay
  small.

## A bigger drawing — the structure only

"A pelican riding a bicycle", path data elided:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
  <defs>
    <!-- wheel: drawn once around (0,0), used twice below -->
    <g id="wheel" fill="none" stroke="#000000" stroke-width="3">
      <circle id="tire" r="40"/>
      <g id="spokes">…</g>
      <circle id="hub" r="4"/>
    </g>
  </defs>

  <!-- pelican-back: the far leg sits behind the frame, so it paints before the bicycle -->
  <g id="pelican-back" transform="translate(190 120)" fill="#ffffff" stroke="#000000" stroke-width="4">
    <path id="far-leg" d="…"/>
  </g>

  <g id="bicycle" transform="translate(200 210)" fill="none" stroke="#000000" stroke-width="4">
    <use id="rear-wheel" href="#wheel" transform="translate(-70 0)"/>
    <use id="front-wheel" href="#wheel" transform="translate(70 0)"/>
    <path id="frame" d="…"/>
    <path id="handlebars" d="…"/>
    <path id="saddle" d="…"/>
    <g id="pedals">…</g>
  </g>

  <!-- pelican-front: everything else, same transform as pelican-back -->
  <g id="pelican-front" transform="translate(190 120)" fill="#ffffff" stroke="#000000" stroke-width="4">
    <path id="near-leg" d="…"/>
    <path id="pelican-body" d="…"/>
    <g id="wing" transform="translate(10 -10)">…</g>
    <g id="head" transform="translate(40 -60)">
      <path id="head-outline" d="…"/>
      <path id="beak" d="…"/>
      <g id="eye" transform="translate(6 -6)">…</g>
    </g>
  </g>
</svg>
```

- Two **base components**, `bicycle` and `pelican`, each self-contained and each placed
  by one `translate`.
- **Identical repeats** are drawn once in `<defs>` and placed with `<use>`. Only for
  parts that are truly identical — the fish's two fins stay separate because they get
  reshaped independently. When the user wants one instance changed, replace that
  `<use>` with a copy of the definition and edit the copy.
- **`<use>` refers only to an `id` in the same drawing.** Never `href="other.svg#…"` —
  it breaks the moment the drawing is saved or moved.
- **When paint order splits a component** — something must draw between its parts —
  split it into `-back` and `-front` siblings around that something, with the same
  `transform` on both. Moving the pelican means editing both.

## Procedures

### Drawing from scratch

1. Decompose the ask into components and sub-parts before writing markup. For anything
   beyond a few parts, show the user the list.
2. Choose a `viewBox` and decide where each top-level component goes — its `translate`.
3. Draw each component around its own origin, sub-parts nested, `id`s on everything
   nameable.
4. Order siblings for paint order. Split a component only if something must draw
   between its parts.
5. Check your work (rule 5 in your rulebook), then say it's ready.

### Modifying an existing drawing

1. Find the part by `id`. Edit inside it; leave its siblings alone.
2. Move, rotate, flip, resize → edit its `transform`. Reshape → edit that part's points.
3. Adding something new → add it as a component built as above, even if the rest of the
   drawing isn't.
4. Don't restructure markup you weren't asked to touch. A flat or single-path drawing
   stays that way until conversion is agreed (below).

### Converting a flat drawing into components

Many imported drawings are one path, or a pile of unnamed paths. Convert only when
iterating on it has become painful, and only with the user.

1. Work out what the picture is and what parts it has, then propose the list. The user
   has final artistic license and approves the list before you start.
2. Rebuild it part by part to the structure above, preserving the look. Compare against
   the original as you go.
3. Deliver it as an option, not a direct edit, so the user can compare before adopting it.

## Facts that bite

- `y` grows downward.
- `transform` lists apply right to left: `translate(80 105) rotate(90)` rotates first,
  then moves. Write `translate` first.
- `scale` scales stroke widths too. Size the drawing with `viewBox`, not `scale`; if you
  must scale a part, add `vector-effect="non-scaling-stroke"`.
- `rotate(a)` rotates about the part's origin; `rotate(a cx cy)` about a point.
- `id`s must be unique within the drawing; `<use>` and `href="#…"` resolve to the first
  match.
- Style with attributes (`fill="…"`, `stroke="…"`) on the part, not a `<style>` block —
  a rule in `<style>` splits a part's look across two places, and the part is no longer
  self-contained when copied.
- A missing `xmlns`, an unclosed tag, or a stray `>` renders as a blank canvas.
