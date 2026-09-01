# File Tree View — Actionable Plan

## Overview

A new `file-tree.html` page that presents a scrollable file tree sidebar alongside a canvas view. The tree "decompresses" SVG elements into a navigable outline, showing groups, paths, and other elements as tree nodes.

## Design Decisions

- **Performance**: Load everything upfront (no lazy-loading). Simplest approach; fine for hand-crafted SVGs.
- **Editing in tree** (rename, delete, reorder): Deferred — open issue for later.
- **Drag-and-drop reordering**: Deferred — open issue for later.
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
11. ⬜ Rename dialog (Phase 5)
12. ⬜ Test with `fish` and `fish-variant`

---

## Phase 5: Element Rename (dialog)

A dialog lets the user name/rename an SVG element — setting its `id` and/or its
comment. This is how red-dot (unnamed) elements get named, and how existing
elements get renamed.

### 5.1 Status dots (done)
Each element node shows a status dot **after** its label:
- 🔴 **Red** — no `id`, no comment (falls back to element type)
- 🟡 **Yellow** — comment-driven label (no `id`, has a comment)
- 🟢 **Green** — has a proper `id`

Comment-driven labels are truncated to the first 10 chars.

### 5.2 Rename dialog
- Triggered by clicking a node (or a rename affordance on the node)
- A modal dialog with **two text fields**:
  - **id** field — pre-populated with the element's current `id`, blank if none
  - **comment** field — pre-populated with the element's current comment, blank if none
- Both fields are editable; the user can fill either or both

### 5.3 Save semantics
- **Writes only on Save** (dialog confirm) — no live rewriting of `current.svg`
  on keystroke
- If an `id` is provided → added/updated on the element → node turns green
- If a comment is provided → added/updated as the comment preceding the element
- If a field is left blank → that attribute is **not** added (blank id = no id;
  blank comment = no comment)
- **Uniqueness check**: the new `id` must not collide with any other `id` in the
  drawing; duplicates are rejected with an error

### 5.4 Persistence
- The change edits `current.svg` on disk
- Should go through the existing `PUT /api/projects/:project/current` endpoint
  (which captures undo state via `writeCurrent`) so the change is undoable
- The tree re-parses and re-renders after save

---

## Open Issues (deferred)

- Drag-and-drop reordering of elements
- Delete nodes from the tree
