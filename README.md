# Ruby High

ElizaOS app. **Ruby is the host of a small school.** She greets students and runs the quiz floor. Specialist faculty teach their domains. v0.2 ships **Ruby + Sally Science (STEM) + Professor Edward (mid-century literary theory)** as question authors, persistent quiz state, and a viewer with faculty switching, subject filters, and difficulty pills.

This is part of the Ruby High Tournament arc — see `DESIGN.md` for the full multi-agent tournament design (Milady hosts, elizaOS provides the primitives, aws-swarm provides contestants, $RATI provides the stakes).

## Why a swarm and not one big agent

A specialist who only does Renaissance history can have actual opinions about Renaissance history. A generalist gets generic fast. Ruby High commits to that constraint: every subject is its own character with its own range, audience, and small launch moment. Ruby stays the front door; the cast expands behind her.

## Architecture

| Piece | Where | What it does |
|---|---|---|
| `RubyHighService` | `src/services/ruby-high-service.ts` | Per-session quiz state. Score, asked-question history, current question, last reveal. Persists to `~/.ruby-high/state.json`. |
| `FacultyService` | `src/services/faculty-service.ts` | Loads faculty question packs from `assets/questions/*.json` at boot. `pick({ faculty, subject, difficulty, exclude })` with cascading fallbacks. |
| `StateStore` | `src/services/state-store.ts` | Atomic JSON file persistence (write-tmp + rename). Phase 3+ moves to `@elizaos/plugin-sql`. |
| Question packs | `assets/questions/{ruby,sally-science,professor-edward}.json` | 15 questions each, tagged by subject + difficulty (easy / medium / hard). |
| Actions | `src/actions/` | `POSE_QUESTION`, **`PICK_QUESTION`** *(new)*, `GRADE_ANSWER`, `CLEAR_BOARD`, `HANDOFF_FACULTY`. |
| Viewer | `src/viewer.ts` | Sky background, host portrait, chalkboard, A/B/C/D buttons, faculty bar with chips, subject + difficulty filters, "Pick next" button, accent color follows the active faculty. |
| Routes | `src/routes.ts` | App-bridge launch/refresh, viewer HTML, `/session/:id` GET, `/session/:id/command` POST (`answer` / `pick` / `set-faculty` / `clear` / `reset`), `/assets/:name`. |

### Action shapes

- **`PICK_QUESTION`** — `{ faculty?, subject?, difficulty? }` — draw next question from the active (or specified) faculty pack, never repeat in a session.
- **`POSE_QUESTION`** — `{ prompt, options: { A, B, C, D }, correct, explanation?, subject?, faculty?, difficulty? }` — manual question authoring.
- **`GRADE_ANSWER`** — `{ picked: "A" | "B" | "C" | "D" }`.
- **`CLEAR_BOARD`** — `{}`.
- **`HANDOFF_FACULTY`** — `{ faculty: "ruby" | "sally-science" | "professor-edward" }`.

### Persistence

Quiz state writes to `~/.ruby-high/state.json` on every mutation (atomic tmp + rename). Override the path with `RUBY_HIGH_STATE_PATH=/some/file.json`. Survives dev-server restarts; pick up exactly where you left off.

## Local development

```bash
npm install
npm run build
npm run dev:server     # rebuilds first, or use this skipping a fresh build:
node scripts/dev-server.mjs
```

Then open http://127.0.0.1:4711/api/apps/ruby-high/viewer

### Dev endpoints (no eliza runtime needed)

- `GET /dev/pick` — draw a question for the active faculty.
- `GET /dev/pick?faculty=sally-science&difficulty=hard` — filter the draw.
- `GET /dev/faculty` — roster + question counts.
- `GET /dev/clear` — wipe the board (keeps score).
- `GET /dev/reset` — wipe the session (score + history).

## Wiring into a character

```ts
import rubyHighPlugin from "@cenetex/app-ruby-high";

export const character = {
  name: "Ruby",
  plugins: [rubyHighPlugin /* , ...others */],
  // ...
};
```

The plugin registers two services (`FacultyService` and `RubyHighService`); the runtime instantiates both, then `BoundRubyHighService.start()` defers a microtask to bind the FacultyService into the RubyHighService once both are up. PICK_QUESTION works from the first call.

## Tests

```bash
npm test
```

13 tests covering: pack loading, filter cascade, exclusion, faculty switching, score arithmetic, persistence across a "restart," reset semantics.

## Visual assets

`assets/ruby-high-logo.png` and `assets/ruby-classroom.png` — sourced from Jon's mockups, served at `/api/apps/ruby-high/assets/{logo,ruby}.png`.

## OpenRouter login + per-teacher chat (v0.3, 2026-05-01)

Each teacher is also a chatbot. The viewer has a chat panel on the right; the user signs in with their OpenRouter account (PKCE), and the active faculty becomes a chatbot with their own voice and system prompt. The teacher can drive the chalkboard via tool calls — `pick_from_bank`, `pose_question`, `clear_board`, `handoff_faculty`. When the user picks an answer in the viewer, the teacher gets notified and can react in character.

### Auth flow

1. User clicks **Sign in with OpenRouter** → server mints a PKCE verifier/challenge pair and redirects to `https://openrouter.ai/auth?...`.
2. OpenRouter redirects back to `/api/apps/ruby-high/auth/callback?code=...&state=...`.
3. Server exchanges `code` + `code_verifier` at `https://openrouter.ai/api/v1/auth/keys`, gets an API key, stores it server-side keyed by an httpOnly `rh_session` cookie. Key never touches the browser.
4. `/api/apps/ruby-high/chat` (POST, SSE) proxies chat through OpenRouter using the cookie's API key; tool calls dispatch into `RubyHighService`.

### Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/apps/ruby-high/auth/start` | Begin PKCE flow, redirect to OpenRouter |
| GET | `/api/apps/ruby-high/auth/callback` | OpenRouter redirects here |
| GET | `/api/apps/ruby-high/auth/me` | Auth status |
| POST | `/api/apps/ruby-high/auth/logout` | Drop session |
| POST | `/api/apps/ruby-high/chat` | Send a chat message; returns SSE stream of `delta` / `tool` / `error` / `done` events |
| GET | `/api/apps/ruby-high/chat/history?faculty=...` | Per-(session, faculty) history |
| POST | `/api/apps/ruby-high/chat/reset` | Clear history for one teacher |

### Configuration

- `RUBY_HIGH_PUBLIC_BASE` — public URL the dev server is reachable at (used to build the OpenRouter callback). Defaults to `http://127.0.0.1:4711`.
- `RUBY_HIGH_OPENROUTER_REFERER` / `RUBY_HIGH_OPENROUTER_TITLE` — sent in OpenRouter request headers; defaults are fine for local dev.

### Teacher characters

Defined in `src/characters/teachers.ts`:
- **Ruby** — host, generalist, hands off to specialists.
- **Sally Science** — STEM enthusiast, sharp grad-TA energy.
- **Professor Edward** — dry mid-century lit professor.

Default model: `anthropic/claude-haiku-4.5` (overridable per-call).

## Deploy (fly.io)

The repo ships with a production entry point at `scripts/server.mjs`, a
multi-stage `Dockerfile`, and a `fly.toml` ready to launch.

```bash
# 1. Install flyctl
brew install flyctl

# 2. Sign in
fly auth login

# 3. From the repo root, copy the bundled config and create the app
fly launch --copy-config --no-deploy
# Follow the prompts. Pick the region you want; the bundled config defaults to sea.

# 4. Create a volume for the JSON state store (alpha only — see "what's next")
fly volumes create ruby_high_data --size 1

# 5. Deploy
fly deploy

# 6. Once you have the public URL, set it so OAuth callbacks land cleanly
fly secrets set RUBY_HIGH_PUBLIC_BASE=https://YOUR-APP.fly.dev
```

OpenRouter requires the OAuth callback URL to be HTTPS — fly gives you that
out of the box at `https://your-app.fly.dev/api/apps/ruby-high/auth/callback`.
No `OPENROUTER_API_KEY` is needed on the server: each user authenticates with
their own OpenRouter account via PKCE, and the server stores their key
in-process keyed by an httpOnly cookie.

### Production caveats (alpha v0.1)

- **State is a single JSON file** at `/data/state.json` on a fly volume — single
  player at a time. The "per-user state migration" PR replaces this with a
  proper DB before this is multi-tenant safe.
- **API keys live in process memory.** A redeploy or VM restart wipes
  authenticated sessions; users have to sign in again.
- **No rate limiting yet.** Don't post the public URL widely until that lands.

## What's next (Phase 2 — see DESIGN.md)

1. `TournamentService` with the bracket data model.
2. Heartbeat-driven scheduling via `@elizaos/plugin-agent-orchestrator`.
3. Single-elim bracket, humans-only first run.
4. Spectator viewer with bracket rendering + ELO leaderboard.
5. Eventually: agent contestants via aws-swarm endpoint, then prize pools, then $RATI.
