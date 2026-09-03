# Lightweight SVG Studio Agent — Project Plan

## Vision

A minimal Python agent (<4B parameter model compatible) that drives the SVG Studio **entirely via HTTP API**. No file access, no browser automation, no shell — just `fetch()` equivalents over HTTP. The agent reads conventions, composes SVG markup, and pushes changes through the same endpoints a browser agent uses.

---

## Why This Exists

- **Codespace/container agents** can't use the file-tool workflow (AGENTS.md) — the `public/svgs/` directory isn't on their filesystem
- **Small models** (<4B params) excel at structured text manipulation (SVG markup) but struggle with complex toolchains
- **HTTP is universal** — every language/runtime has a client; no SDK needed
- **The server already speaks agent** — `/api/conventions`, `/api/authoring`, and all write endpoints are designed for this

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     LIGHTWEIGHT AGENT                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ HTTP Client  │  │ Markup Engine│  │ Workflow Controller  │  │
│  │ (httpx)      │  │ (string ops) │  │ (read→think→write)   │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘  │
│         │                 │                     │              │
│         │                 │         ┌───────────┴───────────┐  │
│         │                 │         ▼                       │  │
│         │                 │  ┌──────────────┐               │  │
│         │                 │  │  LLM Backend │  (optional)   │  │
│         │                 │  │ (llama-cpp)  │               │  │
│         │                 │  └──────────────┘               │  │
│         └─────────────────┼─────────────────────┘              │
│                           ▼                                    │
│              ┌────────────────────────┐                        │
│              │   SVG Studio Server    │                        │
│              │   (Express, :3000)     │                        │
│              │   REST + SSE           │                        │
│              └────────────────────────┘                        │
└─────────────────────────────────────────────────────────────────┘
```

**Four components, minimal dependencies:**

| Component | Responsibility | Dependencies |
|-----------|----------------|--------------|
| `HTTPClient` | Thin async wrapper: GET/PUT/POST/DELETE + SSE listener | `httpx` |
| `MarkupEngine` | SVG string manipulation: find by `id`, edit `transform`, replace attributes, compose new parts | stdlib only |
| `WorkflowController` | Orchestrates the read-think-write loop; enforces conventions | stdlib + `pydantic` |
| `LLMBackend` | **Optional** — pluggable backend for subjective/creative instructions | `llama-cpp-python` (embedded) **or** `httpx` (Ollama HTTP) |

**Two modes of operation:**

| Mode | When Used | Implementation |
|------|-----------|----------------|
| **Deterministic** (default) | Precise edits: "stroke-width 2", "fill red", "move eye up 5" | `MarkupEngine` regex/string ops |
| **LLM-assisted** | Subjective: "friendlier", "warmer", "more dynamic" | `LLMBackend` — **pluggable**: embedded or Ollama |

### LLMBackend — Pluggable Interface

```python
# src/svg_agent/llm_backend.py
from abc import ABC, abstractmethod

class LLMBackend(ABC):
    @abstractmethod
    def complete(self, prompt: str, max_tokens: int = 512) -> str: ...
    
    @abstractmethod
    def stream(self, prompt: str, max_tokens: int = 512): ...

# Implementation 1: Embedded (llama-cpp-python)
class EmbeddedLLM(LLMBackend):
    def __init__(self, model_path: str, n_ctx: int = 4096):
        from llama_cpp import Llama
        self.llm = Llama(model_path=model_path, n_ctx=n_ctx, n_threads=4, verbose=False)
    
    def complete(self, prompt: str, max_tokens: int = 512) -> str:
        out = self.llm(prompt, max_tokens=max_tokens, temperature=0.1, stop=["</svg>"])
        return out["choices"][0]["text"]
    
    def stream(self, prompt: str, max_tokens: int = 512):
        for chunk in self.llm(prompt, max_tokens=max_tokens, temperature=0.1, stream=True):
            yield chunk["choices"][0]["text"]

# Implementation 2: Ollama HTTP API
class OllamaLLM(LLMBackend):
    def __init__(self, base_url: str = "http://localhost:11434", model: str = "qwen2.5-coder:3b"):
        import httpx
        self.client = httpx.AsyncClient(base_url=base_url, timeout=60.0)
        self.model = model
    
    async def complete(self, prompt: str, max_tokens: int = 512) -> str:
        resp = await self.client.post("/api/generate", json={
            "model": self.model, "prompt": prompt, "stream": False,
            "options": {"num_predict": max_tokens, "temperature": 0.1}
        })
        return resp.json()["response"]
    
    async def stream(self, prompt: str, max_tokens: int = 512):
        async with self.client.stream("POST", "/api/generate", json={
            "model": self.model, "prompt": prompt, "stream": True,
            "options": {"num_predict": max_tokens, "temperature": 0.1}
        }) as resp:
            async for line in resp.aiter_lines():
                if line:
                    import json
                    yield json.loads(line).get("response", "")

# Factory — choose at runtime
def create_llm_backend(config: dict) -> LLMBackend:
    backend_type = config.get("type", "embedded")
    if backend_type == "embedded":
        return EmbeddedLLM(config["model_path"])
    elif backend_type == "ollama":
        return OllamaLLM(config.get("base_url"), config.get("model", "qwen2.5-coder:3b"))
    else:
        raise ValueError(f"Unknown LLM backend: {backend_type}")
```

**Configuration (CLI or config file):**
```yaml
# config.yaml
llm:
  type: "embedded"        # or "ollama"
  model_path: "models/minicpm5-1b-q4_k_m.gguf"  # for embedded
  # base_url: "http://localhost:11434"          # for ollama
  # model: "qwen2.5-coder:3b"                   # for ollama
```

---

## Core Capabilities (MVP)

### 1. Discovery & Setup
- `GET /api` → full endpoint catalog
- `GET /api/conventions` → workflow rules (markdown)
- `GET /api/authoring` → SVG structure guide (markdown)
- `GET /api/focus` / `PUT /api/focus` → get/set target project

### 2. Read Path
- `GET /api/projects/:name/current` → raw SVG (working copy)
- `GET /api/projects/:name/versions` → version history
- `GET /api/projects/:name/versions/:id` → specific version SVG
- `GET /api/projects/:name/options` → option tray
- `GET /api/projects/:name/options/:id` → single option SVG

### 3. Write Path
- `PUT /api/projects/:name/current` → direct edit (raw SVG body)
- `POST /api/projects/:name/options` → propose 2–3 variants (`{options: [{label, svg}]}`)
- `POST /api/projects/:name/select` → promote option → current
- `POST /api/projects/:name/commit` → commit current or option to versions
- `POST /api/projects/:name/rollback/:id` → restore version as current
- `POST /api/projects/:name/undo` → swap current ↔ old-current

### 4. Live Updates (Optional)
- `GET /api/events` → SSE stream for `current-changed`, `options-changed`, etc.
- Fallback: polling `GET /api/projects` on interval

---

## Markup Engine Design

**Principle:** SVG is text. The engine never parses XML — it uses string/regex operations on well-formed markup (per AUTHORING.md conventions).

### Operations Needed

| Operation | Approach |
|-----------|----------|
| Find element by `id` | Regex: `id="element-id"` → locate containing tag |
| Edit `transform` attribute | Regex replace within the element's opening tag |
| Edit any attribute (`stroke-width`, `fill`, etc.) | Same — attribute-level regex |
| Insert new sibling | Find parent `<g>`, inject before `</g>` |
| Replace entire element | Locate open+close tags, swap content |
| Compose new component | Template strings with `id`, `transform`, path data |

### Why Not an XML Parser?
- AUTHORING.md mandates **one element per line, indentation = nesting**
- This makes line/string operations reliable and predictable
- No dependency on `lxml`/`xml.etree` — keeps agent <4B friendly
- Server validates SVG on write (rejects malformed)

---

## Workflow Controller — The Read-Think-Write Loop

```python
async def run_task(instruction: str, project: str = None):
    # 1. RESOLVE TARGET
    project = project or await get_focus()
    if not project:
        raise NeedProjectError("Specify project or set focus")
    
    # 2. LOAD CONTEXT (once per session)
    if not self.conventions:
        self.conventions = await get("/api/conventions")
        self.authoring = await get("/api/authoring")
    
    # 3. READ CURRENT STATE
    current_svg = await get_current(project)
    versions = await get_versions(project)
    options = await get_options(project)
    
    # 4. THINK — compose new markup
    if is_obvious_change(instruction):
        # Deterministic path — no LLM needed
        new_svg = self.markup_engine.modify(current_svg, instruction)
    else:
        # Subjective path — use pluggable LLM backend
        if not self.llm_backend:
            self.llm_backend = create_llm_backend(self.config.llm)
        
        prompt = self.build_prompt(instruction, current_svg)
        new_svg = await self.llm_backend.complete(prompt)
    
    # 5. WRITE — direct or propose
    if is_obvious_change(instruction):
        await put_current(project, new_svg)
        await verify(project, new_svg)
        return {"action": "direct_edit", "status": "done"}
    else:
        variants = self.markup_engine.generate_variants(current_svg, instruction)
        await post_options(project, variants)
        return {"action": "proposed", "options": [v.label for v in variants]}
```

### Decision: Direct Edit vs. Propose Options

| Instruction Type | Action | Example |
|------------------|--------|---------|
| **Obvious** | `PUT /current` | "stroke-width 2", "fill red", "move eye up 5" |
| **Subjective** | `POST /options` | "friendlier", "warmer", "more dynamic" |
| **Structural** | `POST /options` | "add wings", "split body into parts" |

---

## Project Structure (New Repo)

```
svg-studio-agent/
├── pyproject.toml           # deps: httpx, pydantic, rich, llama-cpp-python
├── src/
│   └── svg_agent/
│       ├── __init__.py
│       ├── client.py        # HTTPClient + SSE
│       ├── markup.py        # MarkupEngine
│       ├── workflow.py      # WorkflowController
│       ├── conventions.py   # Parsed conventions/authoring (cached)
│       ├── llm_backend.py   # Embedded LLM (llama-cpp-python)
│       └── cli.py           # Typer/Click entrypoint
├── models/                  # GGUF model files (gitignored)
│   └── .gitkeep
├── tests/
│   ├── test_markup.py
│   ├── test_workflow.py
│   ├── test_llm_backend.py
│   └── fixtures/
│       └── sample.svg
├── examples/
│   ├── quickstart.py
│   └── interactive.py
└── README.md
```

---

## Dependencies (Minimal)

| Package | Purpose | Why |
|---------|---------|-----|
| `httpx` | Async HTTP + SSE | Standard, supports both sync/async |
| `pydantic` | Response models | Type safety for API contracts |
| `rich` | CLI output | Pretty logs, progress, tables |
| `typer` | CLI framework | Optional — can use `argparse` |
| `llama-cpp-python` | **Optional** embedded LLM inference | GGUF models, CPU/GPU/Metal, streaming |

**Total deps: 4 required + 1 optional** — `llama-cpp-python` is the only compiled extension (wheels available for Linux/macOS/Windows, CPU and CUDA). **Ollama backend uses only `httpx` (already required).**

### Model File (Not a PyPI Dependency — Only for Embedded Backend)

| File | Size | Source |
|------|------|--------|
| `minicpm5-1b-q4_k_m.gguf` | ~800 MB | Hugging Face / manual conversion |

Place in `models/` (gitignored). Loaded lazily on first subjective instruction. **Not needed if using Ollama backend.**

---

## CLI Interface

```bash
# One-shot commands
svg-agent edit fish "stroke-width 2"
svg-agent propose fish "warmer colors" --count 3
svg-agent commit fish --label "thinner-strokes"
svg-agent rollback fish v003-original
svg-agent undo fish

# Interactive session (REPL)
svg-agent shell --project fish
> read
> edit "make the tail bigger"
> propose "friendlier eye" --count 2
> select option-b-friendlier
> commit --label "friendlier-eye"
> exit
```

---

## Testing Strategy

### Unit Tests (No Server)
- `MarkupEngine`: find/replace/transform operations on fixture SVGs
- `WorkflowController`: decision logic (direct vs. propose)
- `ConventionsParser`: extracts rules from markdown

### Integration Tests (Against Live Server)
- Spin up `server.js` on random port (like `test/server.test.mjs`)
- Exercise full read-think-write-verify cycle
- Test SSE reconnection
- Test concurrent edits (agent + UI)

### Fixtures
- `fish/current.svg` — from this repo
- `pelican/` — multi-component example from AUTHORING.md
- Malformed SVG — verify rejection

---

## Non-Goals (Explicitly Out of Scope)

| Not Doing | Reason |
|-----------|--------|
| SVG rendering/preview | Browser does this; agent only composes markup |
| Git operations | Commits are human-gated via UI |
| File watching | Server polls; agent uses SSE or polls `/api/projects` |
| Multi-project orchestration | One agent = one project at a time |
| Natural language → SVG from scratch | That's a different agent; this one *modifies* |
| Authentication | Local-only server; no auth layer |

---

## Milestones

### M1: Core Client + Markup Engine (Week 1)
- [ ] `HTTPClient` with all endpoints + SSE
- [ ] `MarkupEngine`: find by id, edit transform, edit attributes, insert sibling
- [ ] Unit tests on fixture SVGs
- [ ] CLI: `svg-agent edit <project> <instruction>`

### M2: Workflow Controller + Conventions (Week 2)
- [ ] `WorkflowController` read-think-write loop
- [ ] Convention/authoring fetch + cache
- [ ] Direct-edit vs. propose decision logic
- [ ] CLI: `svg-agent propose`, `svg-agent commit`, `svg-agent rollback`

### M3: Pluggable LLM Backend (Week 3)
- [ ] `LLMBackend` abstract interface
- [ ] `EmbeddedLLM` implementation (llama-cpp-python)
- [ ] `OllamaLLM` implementation (HTTP API)
- [ ] Config-driven backend selection
- [ ] Lazy loading on first subjective instruction

### M4: Interactive Shell + Polish (Week 4)
- [ ] REPL mode with history/completion
- [ ] SSE listener for live updates
- [ ] Rich output: diff preview before write, colored logs
- [ ] Integration tests against real server

### M5: Documentation + Examples (Week 5)
- [ ] README with quickstart
- [ ] Example scripts: batch edits, variant generation
- [ ] Agent-onboarding guide (how to feed conventions to a small model)
- [ ] Model recommendations (embedded vs. Ollama)

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Markup engine breaks on unusual SVG | Test against diverse fixtures; fallback to "propose as option" |
| Server API changes | Pin to `/api` index; validate endpoints at startup |
| Small model hallucinates SVG | Strict templates; verify via re-read; never free-form generate |
| SSE drops | Auto-reconnect with backoff; poll fallback |
| Concurrent UI edit conflicts | Detect via SSE `current-changed`; re-read before write |

---

## Success Criteria

1. **Agent edits `fish` project** — changes stroke width, color, transform via `PUT /current`
2. **Agent proposes options** — 3 variants via `POST /options`, user picks in browser
3. **Agent commits version** — `POST /commit` creates `vNNN-label.svg`
4. **Agent rolls back** — `POST /rollback` restores version as current
5. **All via HTTP** — zero file access, zero browser automation
6. **Runs on <4B model** — prompt fits in context; operations are deterministic string ops

---

## Next Steps

1. **Create repo** — `git init svg-studio-agent`
2. **Add `pyproject.toml`** with deps above
3. **Implement `client.py`** — start with `GET /api/conventions` round-trip
4. **Implement `markup.py`** — test against `fish/current.svg` fixture
5. **Wire together in `workflow.py`** — first end-to-end edit

---

## Appendix: Key Server Endpoints Reference

| Verb | Path | Body | Response |
|------|------|------|----------|
| GET | `/api` | — | `{endpoints: [...]}` |
| GET | `/api/conventions` | — | Markdown (BROWSER_AGENTS.md) |
| GET | `/api/authoring` | — | Markdown (AUTHORING.md) |
| GET | `/api/focus` | — | `{project: "name"}` |
| PUT | `/api/focus` | `{project}` | `{project}` |
| GET | `/api/projects/:name/current` | — | Raw SVG |
| PUT | `/api/projects/:name/current` | Raw SVG or `{svg}` | `{ok: true}` |
| GET | `/api/projects/:name/options` | — | `[{id, proposedAt, committed}]` |
| POST | `/api/projects/:name/options` | `{options: [{label, svg}]}` | `{created: [...]}` |
| POST | `/api/projects/:name/select` | `{option: "id"}` | `{ok: true}` |
| POST | `/api/projects/:name/commit` | `{label?, option?}` | `{id: "vNNN-..."}` |
| GET | `/api/projects/:name/versions` | — | `[{id, committedAt, size}]` |
| POST | `/api/projects/:name/rollback/:id` | — | `{ok: true}` |
| POST | `/api/projects/:name/undo` | — | `{ok: true, undone: bool}` |
| GET | `/api/events` | — | SSE stream |

---

*This plan is for a **new, separate repository**. It does not modify `svg-creator`.*