# Box3D AI Sandbox

A **natural-language 3D physics playground** inspired by [Box3D](https://github.com/erincatto/box3d). Type what you want in a Cursor-style chat bar — *"Generate 4 boxes from the sky"* — and the sandbox spawns and simulates it.

![UI concept](https://box2d.org/images/logo.svg)

## What you get

| Feature | Details |
|--------|---------|
| **Chat UI** | Dark capsule input bar with `+` settings, model dropdown, and send button (like Cursor) |
| **OpenRouter** | Paste your API key in settings; calls run from the browser |
| **Low-cost models** | Default: `deepseek/deepseek-v4-flash:floor` (~$0.09/M input tokens) |
| **Free fallback** | Simple phrases work without an API key via local parser |
| **3D physics** | Three.js rendering + Rapier WASM (Box3D-style command schema) |
| **Orbit camera** | Drag to rotate, scroll to zoom |

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:5173

1. Click **+** → paste your [OpenRouter API key](https://openrouter.ai/keys)
2. Pick a model (DeepSeek V4 Flash `:floor` is cheapest)
3. Type anything, e.g. **"Generate 4 boxes from the sky"**

### Example prompts

- `Generate 4 boxes from the sky`
- `Drop 10 colorful spheres`
- `Zero gravity space mode`
- `Moon gravity`
- `Explode in the center`
- `Clear everything`
- `Add a big red box at x=3`
- `Spawn 6 capsules in a circle`

---

## How it works

**Script mode** — the AI writes JavaScript that runs in the sandbox:

```
You: "50 block jenga tower + wrecking ball"
  ↓ OpenRouter (DeepSeek)
AI: { "message": "...", "script": "sandbox.clear(); for(...)" }
  ↓ execute in browser (sandbox API only, no fetch/window)
Physics scene updates
```

The AI can use **loops, variables, and logic** — not limited to a fixed command list.

```
┌─────────────────────────────────────────────────────────────┐
│  Chat UI (React)                                            │
│  ┌─────────┐  ┌──────────────────┐  ┌──────┐  ┌────────┐ │
│  │ + Settings│  │ Send follow-up   │  │ Model│  │ Send   │ │
│  └─────────┘  └──────────────────┘  └──────┘  └────────┘ │
└──────────────────────────┬──────────────────────────────────┘
                           │ user prompt
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  AI Layer (OpenRouter)                                      │
│  • System prompt → Box3D command JSON schema                │
│  • Models: DeepSeek V4 Flash, DeepSeek Chat, free tiers   │
│  • Output: { message, commands: [...] }                   │
└──────────────────────────┬──────────────────────────────────┘
                           │ CommandBatch
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Simulation Executor (SandboxWorld)                         │
│  • spawn (box / sphere / capsule)                           │
│  • spawnGround, setGravity, explode, clear, pause           │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Physics + Render                                           │
│  • Rapier3D WASM (browser-ready today)                      │
│  • Three.js WebGL scene                                     │
│  • Future: swap in official Box3D WASM when bindings ship  │
└─────────────────────────────────────────────────────────────┘
```

### Why Rapier instead of Box3D WASM today?

[Box3D](https://github.com/erincatto/box3d) can be built with Emscripten (`emcmake cmake -B build`), but there is **no official npm JS binding yet** (unlike Box2D v3's `box2d-v3-wasm`). Community WASM ports exist ([discussion #36](https://github.com/erincatto/box3d/discussions/36)) but require WebGPU and a custom build.

This sandbox uses a **Box3D-inspired command schema** (`b3World`-style spawn/gravity/step concepts from the [hello guide](https://github.com/erincatto/box3d/blob/main/docs/hello.md)) so you can swap the physics backend when official Box3D WASM bindings land.

### Roadmap to native Box3D

1. **Phase 1 (this repo)** — Chat UI + OpenRouter + command executor + Rapier/Three.js
2. **Phase 2** — Compile Box3D to WASM via Emscripten; expose `b3CreateWorld`, `b3CreateBody`, `b3World_Step` to JS
3. **Phase 3** — Replay recording, joints (revolute, prismatic), shape casts, multithreaded workers

---

## OpenRouter model recommendations

| Use case | Model ID | Cost |
|----------|----------|------|
| **Cheapest** | `deepseek/deepseek-v4-flash:floor` | ~$0.09 / $0.18 per 1M tokens |
| Balanced | `deepseek/deepseek-chat` | ~$0.27 / $0.41 per 1M |
| No API key | Local parser | Free (limited phrases) |
| Free tier | `google/gemma-2-9b-it:free` | $0 (rate limited) |

Append `:floor` to any model slug to route to the cheapest provider automatically ([OpenRouter guide](https://openrouter.ai/blog/tutorials/how-to-get-the-lowest-cost-llm-inference-on-openrouter/)).

Your API key is stored in `localStorage` only — never sent anywhere except OpenRouter.

---

## Command schema

The AI returns JSON like:

```json
{
  "message": "Dropping 4 boxes from the sky!",
  "commands": [
    {
      "action": "spawn",
      "shape": "box",
      "position": { "x": 0, "y": 12, "z": 0 },
      "size": { "x": 1, "y": 1, "z": 1 },
      "fromSky": true,
      "count": 4,
      "color": "#e74c3c"
    }
  ]
}
```

Supported actions: `spawn`, `spawnGround`, `setGravity`, `explode`, `clear`, `pause`.

---

## Project structure

```
src/
  components/     ChatBar, SettingsPanel (Cursor-style UI)
  lib/            OpenRouter client + local fallback parser
  physics/        SandboxWorld (Three.js + Rapier)
  types/          Command schema types
```

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Dev server on port 5173 |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Preview production build |

---

## License

MIT — Box3D engine itself is [MIT](https://github.com/erincatto/box3d) by Erin Catto.
