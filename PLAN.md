# File Tree View — Actionable Plan

## Overview

A new `file-tree.html` page that presents a scrollable file tree sidebar alongside a canvas view. The tree "decompresses" SVG elements into a navigable outline, showing groups, paths, and other elements as tree nodes.

## Design Decisions

- **Performance**: Load everything upfront (no lazy-loading). Simplest approach; fine for hand-crafted SVGs.
- **Editing in tree**: Rename (id/comment) is done (Phase 5). Reorder, delete, and create groups are implemented (Phase 6).
- **Drag-and-drop reordering**: Implemented — Phase 6. Sibling reorder, cross-parent moves, and nesting into groups all supported.
- **Search/filter**: No.
- **Breadcrumbs**: No.

---

## Phase 1: Core File Tree Page

### 1.1 Create `file-tree.html`
- Two-panel layout (same shape as `index.html`):
  - **Left panel**: Scrollable file tree (replaces the project list / options / history sidebar)
  - **Right panel**: Canvas showing the selected project's `current.svg`
- Reuse existing interaction patterns: SSE for live updates, same fetch helpers

### 1.2 SVG → Tree Parser
A utility function that takes an SVG string and returns a tree:

```
Input:  <svg>…<g id="body"><path id="tail" d="…"/></g>…</svg>
Output:
[
  { type: "g", id: "body", label: "body", children: [
      { type: "path", id: "tail", label: "tail", pathData: "M 52 …" }
  ]}
]
```

Label resolution order:
1. `id` attribute (most reliable — it's the code-level identifier)
2. XML comment preceding the element (inline documentation)
3. Element type (`path`, `circle`, `rect`, etc.) — fallback

### 1.3 Server Endpoint — `GET /api/file-tree`
Returns all projects with their parsed SVG trees:

```json
{
  "projects": [
    {
      "name": "fish",
      "tree": [ /* parsed nodes */ ],
      "versions": ["v001-init.svg"],
      "options": ["option-a-warm.svg"]
    }
  ]
}
```

Reuses existing file-system reads under `public/svgs/`.

---

## Phase 2: Tree UI

### 2.1 Node Rendering
Each tree node displays:
- **Expand/collapse arrow** — only if it has children
- **Icon** — folder-ish for `<g>`, leaf icon for shapes
- **Label** — from comment, `id`, or element type

### 2.2 Expand/Collapse Behavior
| Level              | Default state |
|--------------------|---------------|
| Root project `/fish` | Collapsed |
| `//current`         | Expanded   |
| `///group` (any `<g>`) | Collapsed |
| Leaf elements       | Always visible when parent expanded |

- **One project expanded at a time** — expanding one collapses the others

### 2.3 Selection & Canvas Sync
- Clicking a node **selects** it and highlights the corresponding element on the canvas
- Canvas shows `current.svg` of the currently expanded project
- Clicking a different project root switches the canvas

---

## Phase 3: Versions & Options in the Tree

- Versions and options appear as special sibling nodes under each project root
- Clicking a version/option loads it into the canvas as a **read-only preview**
- "Use" button (or double-click) promotes an option to `current`

---

## Phase 4: Polish

- Match existing app styling (colors, fonts, spacing)
- Tree indentation with subtle guide lines
- Hover and selected states for nodes
- Scrollable tree panel; sticky project headers if needed
- URL query param for deep-linking (`?project=fish`)

---

## Implementation Order

1. ✅ Create `file-tree.html` — basic two-panel layout
2. ✅ Build SVG parser utility (id → comment → type; tracks domPath + source)
3. ✅ Add `GET /api/file-tree` server endpoint
4. ✅ Render tree nodes with expand/collapse
5. ✅ Wire up project switching + canvas display
6. ✅ Element selection highlighting on canvas (by domPath, works for id-less)
7. ✅ Versions & options as tree nodes
8. ✅ Style and polish
9. ✅ Status dots (red/yellow/green) + 10-char comment truncation
10. ✅ Make id-less elements selectable (domPath-based highlighting)
11. ✅ Rename dialog (Phase 5)
12. ✅ Test with `fish` and `fish-variant`

---

## Phase 5: Element Rename (dialog) — ✅ done

A dialog lets the user name/rename an SVG element — setting its `id` and/or its
comment. This is how red-dot (unnamed) elements get named, and how existing
elements get renamed.

### 5.1 Status dots (done)
Each element node shows a status dot **after** its label:
- 🔴 **Red** — no `id`, no comment (falls back to element type)
- 🟡 **Yellow** — comment-driven label (no `id`, has a comment)
- 🟢 **Green** — has a proper `id`

Comment-driven labels are truncated to the first 10 chars.

### 5.2 Rename dialog (done)
- Triggered by clicking a node (or a rename affordance on the node)
- A modal dialog with **two text fields**:
  - **id** field — pre-populated with the element's current `id`, blank if none
  - **comment** field — pre-populated with the element's current comment, blank if none
- Both fields are editable; the user can fill either or both

### 5.3 Save semantics (done)
- **Writes only on Save** (dialog confirm) — no live rewriting of `current.svg`
  on keystroke
- If an `id` is provided → added/updated on the element → node turns green
- If a comment is provided → added/updated as the comment preceding the element
- If a field is left blank → that attribute is **not** added (blank id = no id;
  blank comment = no comment)
- **Uniqueness check**: the new `id` must not collide with any other `id` in the
  drawing; duplicates are rejected with an error

### 5.4 Persistence (done — staged working copy)
- The change is written to `temp-current.svg` (the file-tree working copy), not
  `current.svg` directly
- A **Push to current** button in the header promotes the staged copy into
  `current.svg` via `POST /api/projects/:project/temp-current/push` (which goes
  through `writeCurrent`, so the change is undoable)
- A **Discard** button drops the staged copy without touching `current.svg`
- The tree re-parses and re-renders after save; a dirty marker shows when
  renames are staged

### 5.5 Testing (done)
- ✅ Manual test with `fish` and `fish-variant` — success in the limited test
- ✅ Rename flow verified: open dialog → edit id/comment → save to working copy
  → push to current → tree re-renders with updated status dot

---

## Phase 6: Structural Editing — Reorder, Delete, Create Groups

The file-tree view becomes a full structural editor: drag-and-drop to reorder
elements, delete nodes, and create new `<g>` groups. All edits stage into
`temp-current.svg` (the working copy) and are pushed to `current.svg` only on
explicit "Push to current" — exactly like the rename dialog. This keeps every
structural change undoable and reviewable before it lands.

### Design Decisions

- **Staging, not direct writes.** Every structural edit writes to
  `temp-current.svg` via the existing `PUT /api/projects/:project/temp-current`
  endpoint. The existing Push/Discard buttons already handle promotion.
- **DOM-based edits, then serialize.** Like the rename dialog, edits mutate a
  parsed DOM (`DOMParser` → mutate → `XMLSerializer`), avoiding fragile string
  surgery on the raw source.
- **domPath is the address.** Every node already carries a `domPath` (child
  indices from `<svg>` root). Reorder/delete/create all operate on that path.
- **Only `current` is editable.** Versions and options remain read-only
  previews — structural editing applies only to the working copy of `current`.
- **Paint order = source order.** Reordering in the tree reorders the DOM
  children, which changes paint order (later elements paint on top). This is
  the natural meaning of "reorder" in an SVG.

---

### 6.1 Drag-and-Drop Reordering

**Scope:** Reorder sibling elements within the same parent (a `<g>` or the
`<svg>` root), **and** move elements across parents — drag a group into another
group to renest it, or move a path/line into a group.

**Interaction:**
- A drag handle (⋮⋮) appears on hover for every editable element row
- Drag a node onto another row → a drop indicator shows the insertion point:
  - **Top/bottom edge** of a row → insert before/after that row (works across
    parents — the element lands in the target's parent at that position)
  - **Middle band** of a group row → nest inside that group (append as last
    child); the group auto-expands so the moved element is visible
  - Dropping onto `//current` moves the element to the top level
- Drop → the element moves; the tree re-renders; the canvas updates to show
  the new paint order

**Implementation sketch:**
- `dragstart` on the row → store `{project, domPath}` in `dataTransfer`
- `dragover` on rows → compute the zone (before/after/inside) from pointer Y;
  show the matching indicator
- `drop` → locate both elements in the parsed DOM by `domPath`, then
  `insertBefore` (before/after) or `appendChild` (inside) the dragged element
- Serialize → `PUT temp-current` → re-render tree + canvas
- **Guards:** no self-drop; no dropping a group into its own descendant
  (rejected with a toast)

**Edge cases:**
- Dragging a parent onto its own descendant → reject (would corrupt the tree)
- Dragging onto itself → no-op
- Reordering must preserve the dragged element's own children and attributes

---

### 6.2 Delete Nodes

**Scope:** Delete any editable element (group or leaf) from the working copy.

**Interaction:**
- A delete affordance (🗑 or ✕) appears on hover for every editable element row
- Click → confirmation dialog (native `confirm()` is fine for v1) showing the
  element's label and type
- Confirm → the element is removed from the DOM → serialize → `PUT temp-current`
  → re-render tree + canvas

**Implementation sketch:**
- `removeChild` the element located by `domPath`
- Also remove its preceding comment node (if any) so no orphan comment is left
  behind — reuse the `findPrecedingComment` helper from the rename dialog
- If the deleted element was selected, clear the selection

**Edge cases:**
- Deleting a group deletes all its descendants (expected — confirm dialog
  should mention "and its N children")
- Deleting the last element under a parent leaves an empty `<g>` — allowed, but
  the tree should show it as an empty group (still deletable)
- Deleting a node that has staged changes elsewhere → no conflict; the whole
  working copy is one file

---

### 6.3 Create Groups

**Scope:** Create a new empty `<g>` element, either at the top level of the
drawing or inside an existing group.

**Interaction:**
- A "+ Group" affordance on each group row (and on the `//current` root row)
- Click → a small inline prompt (or reuse the rename dialog pattern) for the
  new group's `id` (optional) and `comment` (optional)
- Confirm → a new `<g>` is inserted as the **last child** of the target group
  (paint order: on top)
- The new group appears in the tree with a red status dot (no id/comment) or
  green/yellow depending on what was provided

**Implementation sketch:**
- `document.createElementNS(SVG_NS, 'g')`
- Set `id` if provided; insert a preceding `<!-- comment -->` if provided
- `appendChild` to the target group (located by `domPath`)
- Serialize → `PUT temp-current` → re-render tree + canvas

**Edge cases:**
- Empty group with no id/comment → red dot, still selectable/renamable
- Empty `<g>` renders as a folder (📁 + expand arrow + "+ Group" affordance),
  not a plain leaf — the parser treats `<g>` as a group even with no children
- New group inherits nothing from its parent (no fill/stroke) — it's a blank
  container; the user can add shapes later or rename it
- Uniqueness check on the new `id` (reuse the rename dialog's check)

---

### 6.4 Shared Infrastructure

These three features share a common pattern that should be factored out:

- **`getWorkingDoc(project)`** — fetch temp-current (fall back to current),
  parse into a DOM, return `{doc, svgString}`
- **`saveWorkingDoc(project, doc)`** — serialize, `PUT temp-current`, re-render
  tree + canvas, toast "Saved to working copy — push to apply"
- **`locateByDomPath(doc, domPath)`** — already exists as `findElementByDomPath`
  (rename dialog); promote it to a shared helper
- **`removePrecedingComment(doc, el)`** — extract from the rename dialog's save
  logic so delete can reuse it

---

### 6.5 Implementation Order

1. ✅ Refactor shared helpers (`getWorkingDoc`, `saveWorkingDoc`, promote
   `findElementByDomPath`, extract `removePrecedingComment`)
2. ✅ Delete nodes (simplest — no drag logic, reuses rename helpers)
3. ✅ Create groups (small — new element + insert)
4. ✅ Drag-and-drop reordering (most complex — drag events, drop indicators,
   sibling-only guard)
5. ✅ Hover affordances (drag handle, delete, +Group) styled consistently
6. ⬜ Test with `fish` and `fish-variant` — reorder fins, delete a part, create
   a group, push, verify paint order + undo

---

## Open Issues (deferred)

- Copy/paste of elements
- Duplicate (clone) an element
- Reordering versions/options in the tree (they're read-only listings)
- Undo within the file-tree view itself (currently relies on the main view's
  Undo after push)
