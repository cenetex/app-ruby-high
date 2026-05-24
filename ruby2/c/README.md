# Ruby High 2.0 C Wedge

This is a narrow C implementation of the Ruby High 2.0 design contract. It is
not the graphical client yet. It proves the deterministic engine pieces first:

- fixed-size state
- shared effect reducer
- Source/Sense/Sync/Signal discipline tracking
- Head/Heart/Hustle/Honor virtue tracking for identity and archetype reads
- RPN branch-gate evaluation over a flat state variable surface
- server-validated item use
- empty-start inventory slots with collectable room items
- milestone-only Yearbook candidate generation with bounded insertion and eviction
- archetype resolution
- single active companion selection
- trace-based Captain Null outcome resolution through the same four discipline buttons
- a deterministic Week One text simulation
- a first MUD-shaped world kernel with rooms, exits, NPC placement, object
  presence, action discovery, and an event queue
- a command-level world action path, so UI choices are resolved as structured
  commands instead of requiring one enum forever
- a Day One school-day director that makes Homeroom guided without forbidding
  exploration outright
- split event visibility for player-facing output versus internal simulation
  traces
- a bounded micro-agent intent resolver for NPC move, speak, inspect, and
  remember requests
- a deterministic social-simulation pass where each NPC gets a local
  perception packet, authored agenda rules produce legal candidate intents, and
  the tiny ranker selects one accepted NPC move per tick
- a first bridge from world events into LLM performance requests
- a llama.cpp-first performance layer for speech-bubble lines, with the older
  Ollama/OpenAI-compatible HTTP path kept as an explicit fallback backend
- a legal-candidate ranker scaffold for ordering already valid actions,
  agent agendas, LLM pregen branches, and Yearbook candidates
- a UI snapshot scaffold that exposes room, time, clocks, disciplines, present
  people, present objects, legal actions, and visible events as JSON
- a C-owned visual presentation contract layered onto the UI snapshot: focus
  speech/blackboard alternation, notebook strip, bottom four-button action tray,
  side inventory slots, and per-character witness reaction bubbles with stable
  anchors and color themes
- room-specific blackboard quiz sessions in Science Lab and Library after
  Homeroom resolves, each using four discipline-aligned approach choices
- a first native SDL2 visual slice that consumes the C snapshot directly,
  handles `Next`/`Speech`, mouse clicks, and `1`-`4` keyboard choices, and can
  write an offscreen BMP frame for verification without running the browser
- a native visual UI layer with cached macOS text rasterization, reusable scene
  layout records, button flash feedback, and a LaunchServices `.app` bundle for
  normal foreground-window launches on macOS
- a split native renderer module that owns SDL drawing, hit testing, text
  texture caching, scene layout, result toasts, and co-present witness bubbles
- native SDL action consequences can start a non-blocking AI performance job
  for the latest co-present event; authored fallback lines remain visible
  immediately and a validated generated line can replace the active bubble
- an architecture review for scaling the current C wedge into a content-driven
  engine

Build and run:

```sh
make -C ruby2/c
make -C ruby2/c test
make -C ruby2/c gameplay-test
make -C ruby2/c llm-test
make -C ruby2/c ranker-test
make -C ruby2/c ui-test
make -C ruby2/c run
make -C ruby2/c play
make -C ruby2/c play-world
make -C ruby2/c ui-snapshot
make -C ruby2/c native-assets
make -C ruby2/c native-smoke
make -C ruby2/c native-frame
make -C ruby2/c native-app
make -C ruby2/c native-run
make -C ruby2/c native-run-ai
make -C ruby2/c native-macos-app
make -C ruby2/c native-open
make -C ruby2/c play-llm
```

To run the native app against a local OpenAI-compatible/Ollama endpoint:

```sh
RUBY2_LLM_BACKEND=http \
RUBY2_LLM_MODEL=ruby-high-local \
RUBY2_LLM_TIMEOUT_SECONDS=6 \
make -C ruby2/c native-run
```

Equivalent convenience target:

```sh
make -C ruby2/c native-run-ai
```

`play-world` is the current world-kernel proof. It is not scripted as one
linear scene function. The loop asks the world for available actions in the
current room, applies the selected action through the world resolver, advances
schedule state, moves NPCs, exposes objects, and emits events. The first slice
covers Hallway, Homeroom, Cafeteria, Ruby, Lyra, Ravi, Noor, the Homeroom answer
card/work order, and the lunch receipt trigger.
Internally, `ruby2_world_apply_action` now compiles legacy action IDs into
`Ruby2WorldCommand`, then applies that command. Rejected commands do not advance
time. The Day One director lets the player wander to the Cafeteria before class,
but the Bell clock escalates and redirects them back to Homeroom instead of
leaving the school day inert.

Micro-agents use `Ruby2AgentIntent` instead of mutating state directly. An agent
may request to move, speak, inspect an object, or remember an event; the world
accepts only legal intents and emits rejection events for impossible actions
such as remote speech, blocked room jumps, or inspecting absent objects. This is
the C-side contract for later LLM-backed avatars: the model can propose a tool
intent, but the deterministic world remains authoritative.
`ruby2_world_step_agents` is the simulation hook: each world turn builds a
local `Ruby2AgentPerception` for each placed NPC, queries authored agenda rules
for legal `Ruby2AgentCandidateIntent` records, ranks those legal candidates, and
submits only the first accepted intent through the world validator. The LLM layer
can perform the accepted speech later, but it cannot make a remote character
speak, move through a blocked route, inspect an absent object, or mutate durable
state directly.

`ruby2_world_event_to_performance_request` is the first bridge between the MUD
kernel and the local-model performance layer. It converts selected visible world
events into `Ruby2PerformanceRequest` packets. The native SDL app and the
`play-llm` harness both consume those packets, so the graphical slice and text
slice share the same character-performance boundary.

`ruby2_ranker_rank_world_actions` is the first tiny-ranker boundary. It receives
only legal actions from `ruby2_world_query_actions`, encodes fixed features, and
returns a reordered legal set. The ranker never creates choices, hides required
choices, mutates state, moves NPCs, or decides durable outcomes. The trace writer
emits JSONL with schema/version fields so later training can reuse the same
legal-option contract.

`ruby2_ui_snapshot_build` is the first renderer-facing contract. It builds a
read-only snapshot from the world and can include ranker-ordered actions. The
snapshot is intentionally plain enough for a text harness, a native C UI, or a
future graphical client to consume without sharing engine internals. It also
owns the first visual layout contract: the focus surface starts as the speaker's
speech bubble and can reveal a blackboard for teacher/problem beats; the action
tray remains a bottom four-button surface; witness reactions are individual
colored bubbles anchored near the student who spoke instead of an unowned chat
stack. The presentation selector only promotes events from the current room and
from co-present characters, so internal NPC movement elsewhere in the school
cannot steal the visible speaker slot.

`play-llm` is the current vertical slice. It keeps all game state deterministic
and asks the local model only for bounded micro-agent lines. The model must
return JSON with a `line` field; if it leaks analysis or returns invalid output,
the simulator uses authored fallback copy instead.
Fixed rail lines stay authored; native inference is reserved for reactive
consequence beats where the character performance can actually vary.
Some beats can opt into a two-pass wake: the first local-model call smooths the
structured wake packet into a first-person inner stream, and the second call
speaks the final bubble. This is intentionally beat-authored through
`smooth_wake`, not automatic for every line.
Visible multiple-choice beats can also start a small background pregen queue.
The vertical slice uses this for the cafeteria choice: while the player is
reading the three options, the simulator speculatively generates the highest
priority consequence line. If that line is ready when the player chooses, the
speech bubble is instant; otherwise the authored fallback line is used and the
game keeps moving. The queue never mutates game state.

The native SDL app now uses the same performance contract after player actions.
The deterministic world resolves the move first, the UI shows an authored
fallback line immediately, and a background SDL thread asks the configured LLM
for a replacement one-line bubble. If the model is unavailable, slow, or returns
unsafe/mechanical text, the fallback stays on screen and play continues.

The C wedge now defaults to `RUBY2_LLM_BACKEND=llama.cpp`. The default build
ships with a no-dependency stub so tests and deterministic gameplay still build
without llama.cpp installed. To compile the native backend, point the Makefile at
a built llama.cpp checkout:

```sh
LLAMA_CPP_DIR=/path/to/llama.cpp make -C ruby2/c clean all
RUBY2_LLM_BACKEND=llama.cpp \
RUBY2_LLAMA_MODEL=/path/to/google_gemma-4-E4B-it-Q4_K_M.gguf \
LLAMA_CPP_DIR=/path/to/llama.cpp \
make -C ruby2/c play-llm
```

The repo-local default model path for `make -C ruby2/c play-llm` is:

```text
ruby2/models/google_gemma-4-E4B-it-Q4_K_M.gguf
```

Current baseline model:

```text
bartowski/google_gemma-4-E4B-it-GGUF
google_gemma-4-E4B-it-Q4_K_M.gguf
SHA256: 51865750adafd22de56994a343d5a887cc1a589b9bae41d62b748c8bd0ca9c76
```

`RUBY2_LLAMA_GPU_LAYERS=0` is the safest smoke-test setting. In this mode the
native backend also passes an empty llama.cpp device list and disables KV/op
offload, so a Metal-enabled build does not try to initialize Metal anyway. The
loaded model and context are reused for the life of the simulator process; each
new speech bubble clears memory and decodes the next bounded prompt instead of
rebuilding the context.

Native llama.cpp environment knobs:

- `RUBY2_LLAMA_MODEL`: GGUF base model path.
- `RUBY2_LLAMA_LORA`: optional Ruby High performance LoRA adapter path.
- `RUBY2_LLAMA_THREADS`: decode thread count, default `8`.
- `RUBY2_LLAMA_CONTEXT`: context length, default `1024` for short speech bubbles.
- `RUBY2_LLAMA_GPU_LAYERS`: GPU offload layers, default `0`.
- `RUBY2_LLAMA_SEED`: deterministic sampling seed.
- `RUBY2_LLM_MAX_TOKENS`: per-line generation budget, default `96`.
- `RUBY2_LLM_WAKE_MAX_TOKENS`: occasional smooth-wake generation budget, default `160`.
- `RUBY2_LLM_WAKE_SMOOTH=0`: disable the extra smooth-wake pass globally.
- `RUBY2_LLM_PREGEN=0`: disable background branch pregen globally.
- `RUBY2_LLM_PREGEN_SPECULATIVE`: number of visible branches to pregen before
  the player requests one, default `1`.
- `RUBY2_PREGEN_DEBUG=1`: print branch-pregen cache hits and misses.
- `RUBY2_LLM_DEBUG=1`: print native timing and raw rejected model output.

The HTTP adapter remains available when you want to test through Ollama or an
OpenAI-compatible endpoint:

```sh
ollama serve
RUBY2_LLM_BACKEND=http \
RUBY2_LLM_BASE_URL=http://127.0.0.1:11434/v1 \
RUBY2_LLM_MODEL=ruby-high-local \
make -C ruby2/c play-llm
```

Use `RUBY2_LLM=0 make -C ruby2/c play-llm` or
`RUBY2_LLM_BACKEND=fallback make -C ruby2/c play-llm` to force authored fallback
lines. Use `RUBY2_LLM_TIMEOUT_SECONDS=40` only for the HTTP backend if the local
model spends extra tokens before the JSON line. Use `RUBY2_LLM_MAX_TOKENS=768`
for models that write hidden reasoning before the JSON object.

The current scope intentionally matches the Wedge -1 / Wedge 0 spirit from
`../DESIGN.md`: prove the rules before overbuilding sokol rendering, asset
streaming, or platform shells. The SDL2 native slice is deliberately small:
it uses the C `Ruby2UiSnapshot` contract as its only game input. The renderer
now separates reusable layout records from draw primitives, caches native text
textures per renderer, and schedules button choices for a short flash before
the deterministic world applies the action. Run `native-frame` to render a
screenshot-like BMP through the C renderer. On macOS, run `native-open` to build
and launch the `.app` bundle as a normal foreground window; `native-run` still
executes the raw binary. Controls are `Space`/`Return` for `Next`/`Speech`,
`1`-`4` for action buttons, mouse click for buttons, and `Esc`/`q` to quit.
