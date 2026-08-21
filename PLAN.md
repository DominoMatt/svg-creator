# PLAN.md — svg-creator

**Vision:** A local workspace where a human and an AI agent iteratively design SVGs together.
The agent presents work step-by-step, the browser displays every change instantly, and the
human stays in control of what gets kept.

**Status:** M1 (projects & versioning), M2 (options workflow), and M3 (agent conventions +
loop smoke test) are **done**. Day-to-day docs live in [README.md](README.md) — usage,
features, HTTP API, how to run — and [AGENTS.md](AGENTS.md) — the agent workflow rules.
This file is just the roadmap now.

## Agent integration

All agent workflow rules live in [AGENTS.md](AGENTS.md) — the source of truth:
read-before-write, options for open-ended changes vs. direct edits for trivial ones,
human-gated commits, quiet file-tool operations, and the 🎯 quiet-focus targeting
protocol. Keep AGENTS.md authoritative; don't restate the rules here.

---

## Milestones

- **M1 — Projects & versioning:** ✅ done
- **M2 — Options workflow:** ✅ done
- **M3 — Agent conventions (`AGENTS.md`) + full-loop smoke test:** ✅ done
- **M4 — Polish:**
  - [ ] Diff/compare view between any two states
  - [ ] Version annotations/notes in `meta.json`
  - [ ] Keyboard shortcuts (commit, cycle options)
  - [x] ~~Export bundle (zip)~~ → save buttons instead: plain per-file `.svg` downloads
        (⬇ Save / ⬇ Save all / per-version ⬇)

---

## Open questions

1. Do we ever want git integration (real branches/tags per version), or is the folder-based
   history sufficient? *(Folder-based keeps agents simple; git adds safety. Could be both.
   Forks currently cover the "divergent directions" use case without git.)*
2. Multi-user/multi-tab behavior — last-writer-wins is fine for now?

---

## Running

See [README.md](README.md) → Quick start: `npm install && npm start` → http://localhost:3000.
