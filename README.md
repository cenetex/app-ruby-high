# Ruby High

> Every weekday, three teachers post one new question. One of them is an essay, graded by a character with taste. Your grade is yours to keep.

Ruby High is an elizaOS app and standalone Node service. **Ruby is the host of a small school.** Specialist faculty (Sally Science, Professor Edward) teach their domains. Six AI classmates sit beside you. You play a generated character with four stats, walk between four rooms, and answer questions across four years until you graduate.

The product is built around one bet: **the second session is the product.** Most AI demos are one-shot. Ruby High is structured to be returned to — every weekday, on schedule, for the same kind of small graded moment that Wordle made habitual, but with a character on the other side of the grade.

See [`DESIGN.md`](./DESIGN.md) for the strategic thesis, [`RPG-DESIGN.md`](./RPG-DESIGN.md) for the mechanics layer.

## Why this is different

| Product class | Voice | Judgment that matters | Daily cadence | A grade you can keep |
|---|:---:|:---:|:---:|:---:|
| Tutoring chatbots (ChatGPT, Khan-style) | weak | yes | no | no |
| AI roleplay (AI Dungeon, c.ai) | strong | no | no | no |
| Daily quizzes (Wordle, NYT) | none | yes | yes | streak only |
| **Ruby High** | **strong** | **yes** | **yes** | **yes** |

The combination is the product. Each ingredient on its own is commodity.

## The three pillars

### 1. The Daily

Every weekday at the same hour, the school is in session. Each teacher posts **one** question — Sally a STEM problem, Edward a passage to discuss, Ruby a piece of school lore. One of them is the **Essay of the Day**: an opinion-mode prompt, no A/B/C/D, just a 2–3 sentence written response.

You can answer all three in any order. Skip a day, your streak breaks. Hit five days in a row of essays, the teacher who graded you the most starts addressing you by name in the lounge.

### 2. Qualitative grading

Multiple choice is the on-ramp. The headline is **opinion mode**: you write a few sentences, your AI classmates write theirs, and the teacher grades all four responses in their own voice with a score (0–10), a comment, and one named "best response."

> *"Honor — measured, even where the second sentence wobbles. The point about Bishop's stillness against Lowell's noise is exactly right. Score: 8."*
> — Professor Edward

This is the artifact other AI products do not produce. ChatGPT will give you feedback; it will not give you **Edward's** feedback. The taste is the moat.

### 3. The Yearbook

Every grade you complete produces a **yearbook page**: your character, the teachers you studied under, your highest-graded essay, the classmate who graded best beside you, the day you finished. It is a real persistent artifact written into the schema (`PlayerCharacter.yearbook`) and intended to be sharable.

Graduation (finishing all four years) closes the run and unlocks **mentor mode** — a future character of yours can quote your old answer.

## What ships today (v0.5.0)

- OpenRouter PKCE login. Each user pays for their own LLM tokens; no key ever touches the browser.
- Character creation: 6 PbtA-style playbooks, randomized name + personality + sticker portrait, 4 stats (HEAD / HEART / HUSTLE / HONOR).
- Four rooms: homeroom, science, library, Teachers' Lounge.
- Three teachers (Ruby, Sally Science, Professor Edward) and six classmates (Lyra, Sami, Ravi, Indra, Mika, Noor), each with a distinct voice.
- **Multiple choice** with dice-resolved scoring (`2d6 + HEAD`). The student-LLM never sees the answer key — cheating is structurally impossible.
- **Opinion mode** with full LLM-graded essays from the active teacher.
- 5 correct = grade complete. 4 grades to graduate.
- Persistent state, per-user via the `rh_session` cookie.
- Production deploy: Dockerfile → ECR → AWS App Runner via the GHA workflow at `.github/workflows/deploy.yml`. Host-agnostic container; runs anywhere that speaks Docker + sets `PORT` + populates `x-forwarded-*`.

## What ships next (the four-week plan)

| Sprint | Ship |
|---|---|
| **W1** | Event log (sign-in, question, answer, grade, session). Basic per-IP rate limiting. |
| **W2** | The Daily v0: cron-driven daily question drop. Streak counter on the character card. |
| **W3** | Yearbook v0: graduation screen + persistent yearbook page + share card. |
| **W4** | Qualitative grade history: every essay grade you've received, archived per teacher, viewable on the report card. |

After that: classmates progressing on a wall clock while you're away (so coming back means catching up to your friends), then the tournament expansion described in `DESIGN.md`.

## Architecture

| Piece | Where | What it does |
|---|---|---|
| `RubyHighService` | `src/services/ruby-high-service.ts` | Per-session state. Score, history, current question, last reveal, NPC roster, active round. |
| `FacultyService` | `src/services/faculty-service.ts` | Loads question packs from `assets/questions/*.json` at boot. `pick({ faculty, subject, difficulty, exclude })`. |
| `ChatService` | `src/services/chat-service.ts` | Streams OpenRouter SSE per-teacher. Owns chat history, tool dispatch, NPC opinion generation. |
| `AuthService` | `src/services/auth-service.ts` | OpenRouter PKCE OAuth → opaque cookie sessions. Keys live in process memory only. |
| `StateStore` | `src/services/state-store.ts` | Atomic JSON file persistence (write-tmp + rename). Phase N: `@elizaos/plugin-sql`. |
| Question packs | `assets/questions/{ruby,sally-science,professor-edward}.json` | 15 questions each, tagged by subject + difficulty. |
| Actions | `src/actions/` | `POSE_QUESTION`, `PICK_QUESTION`, `GRADE_ANSWER`, `CLEAR_BOARD`, `HANDOFF_FACULTY`. |
| Viewer | `src/viewer.ts` | Single-file SPA. Sky background, room rail, chalkboard, A/B/C/D, opinion textarea, lounge. |
| Routes | `src/routes.ts`, `src/chat-routes.ts` | App-bridge, `/session/:id`, command dispatch, auth callback, chat SSE. |

### The dice mechanic

When you pick an answer, the server rolls `2d6 + your HEAD stat`:

| Total | Outcome | Effect |
|---|---|---|
| 10+ | hit | clean correct = +2 XP |
| 7–9 | mixed | correct = +1 XP, wrong = no penalty |
| 6– | miss | wrong = take an `anxious` Condition |

The student-LLM never sees the question's correct answer. NPC accuracy is the same dice + their stat block — they roll before the question is shown to them, so cheating-by-prompt-injection is mathematically impossible.

### Persistence

Quiz state writes to `~/.ruby-high/state.json` on every mutation (atomic tmp + rename). Override the path with `RUBY_HIGH_STATE_PATH=/some/file.json`. Survives dev-server restarts. Per-user keying derives from the `rh_session` cookie (`rh:user:<token>` for signed-in, `rh:anonymous` otherwise).

## Local development

```bash
npm install
npm run build
npm run dev:server
```

Then open http://127.0.0.1:3000/api/apps/ruby-high/viewer

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
};
```

The plugin registers four services (`FacultyService`, `RubyHighService`, `AuthService`, `ChatService`); the runtime instantiates them and the bound subclasses defer microtasks to wire cross-references.

## OpenRouter login + per-teacher chat

Each teacher is also a chatbot. The user signs in with their own OpenRouter account (PKCE), and the active faculty becomes a chatbot with their own voice and system prompt. The teacher drives the chalkboard via tool calls — `pick_from_bank`, `pose_question`, `pose_opinion`, `clear_board`, `handoff_faculty`. When the user picks an answer in the viewer, the teacher gets notified and reacts in character.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/apps/ruby-high/auth/start` | Begin PKCE flow, redirect to OpenRouter |
| GET | `/api/apps/ruby-high/auth/callback` | OpenRouter redirects here |
| GET | `/api/apps/ruby-high/auth/me` | Auth status |
| POST | `/api/apps/ruby-high/auth/logout` | Drop session |
| POST | `/api/apps/ruby-high/chat` | Send a chat message; SSE stream |
| POST | `/api/apps/ruby-high/chat/event` | Teacher-driven turn (channel-enter, answer-graded, lounge-enter) |
| POST | `/api/apps/ruby-high/chat/opinion-submit` | Submit an essay; triggers grading once everyone's in |
| GET | `/api/apps/ruby-high/chat/history?faculty=...` | Per-(session, faculty) history |
| POST | `/api/apps/ruby-high/chat/reset` | Clear history for one teacher |

### Configuration

- `RUBY_HIGH_PUBLIC_BASE` — public URL the dev server is reachable at (used to build the OpenRouter callback). Defaults to `http://localhost:3000`.
- `RUBY_HIGH_OPENROUTER_REFERER` / `RUBY_HIGH_OPENROUTER_TITLE` — sent in OpenRouter request headers; defaults are fine for local dev.
- `RUBY_HIGH_STUDENT_MODEL` — model for NPC chimes + opinion responses. Default `anthropic/claude-haiku-4.5`.

## Tests

```bash
npm test
```

13 tests covering the deterministic core: pack loading, filter cascade, exclusion, faculty switching, score arithmetic, persistence across restart, reset semantics. The chat layer and the dice layer are not yet covered — see the open issues.

## Deploy

The current production deploy is **AWS App Runner via ECR**, driven by
[`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml). Push to
`main` → GHA assumes an AWS role via OIDC → builds the Docker image → pushes
to ECR → updates the App Runner service → waits for it to settle.

The container itself is host-agnostic. It needs:

| Knob | Where | Notes |
|---|---|---|
| `PORT` | env (Dockerfile defaults to `8080`) | The HTTP port. |
| `HOST` | env (Dockerfile defaults to `0.0.0.0`) | Bind address. |
| `RUBY_HIGH_PUBLIC_BASE` | env | Public URL the app is reachable at. Used to build the OpenRouter PKCE callback. **Must be HTTPS** in production — OpenRouter rejects HTTP callbacks. |
| `RUBY_HIGH_DATA_DIR` | env (optional, JSON backend only) | Where `state.json` lives. Defaults to `~/.ruby-high/state.json` inside the container. |
| `/health` | route | Returns 200 once the services have booted. Configure your platform's healthcheck against it. |
| `x-forwarded-*` | request headers | The server trusts the first hop for proto + host + client-ip. App Runner / a typical reverse proxy / a load balancer all populate these correctly. |

### State storage

Two backends, picked at boot via `RUBY_HIGH_STORE_BACKEND`:

| Backend | When | Env vars |
|---|---|---|
| `json` *(default)* | Local dev. Single JSON file at `~/.ruby-high/state.json` (or `RUBY_HIGH_STATE_PATH`). Ephemeral on App Runner — wiped on every deploy / instance recycle. | `RUBY_HIGH_STATE_PATH` (optional) |
| `dynamodb` | Production. One DynamoDB item per session, keyed by sessionId. Survives container restarts; auto-expires idle sessions via TTL. | `RUBY_HIGH_DYNAMO_TABLE` (required), `AWS_REGION`, `RUBY_HIGH_STATE_TTL_SECONDS` (optional, default 90 days) |

To run with DynamoDB locally:

```bash
RUBY_HIGH_STORE_BACKEND=dynamodb \
RUBY_HIGH_DYNAMO_TABLE=ruby-high-state \
AWS_REGION=us-east-1 \
node scripts/server.mjs
```

#### Production bootstrap (one-time)

The deploy workflow (`.github/workflows/deploy.yml`) creates the table on
every run, idempotently. To turn DynamoDB on in App Runner, do this once:

**1. Grant the GHA OIDC role permission to manage the table.**
Add to the policy attached to `github-actions-ruby-high`:

```json
{
  "Effect": "Allow",
  "Action": [
    "dynamodb:DescribeTable",
    "dynamodb:CreateTable",
    "dynamodb:UpdateTimeToLive",
    "dynamodb:TagResource"
  ],
  "Resource": "arn:aws:dynamodb:us-east-1:*:table/ruby-high-state"
}
```

**2. Run the deploy workflow once** — it'll create the table with the right
schema (PK `pk`, TTL attribute `expiresAt`, on-demand billing).

**3. Grant the App Runner instance role permission to use the table.**
The instance role is the one App Runner runs the container as (separate from
the ECR access role). Add to its policy:

```json
{
  "Effect": "Allow",
  "Action": [
    "dynamodb:Scan",
    "dynamodb:GetItem",
    "dynamodb:PutItem",
    "dynamodb:BatchWriteItem"
  ],
  "Resource": "arn:aws:dynamodb:us-east-1:*:table/ruby-high-state"
}
```

**4. Flip the workflow to use it.** In the repo settings → Variables, add:

| Variable | Value |
|---|---|
| `RUBY_HIGH_STORE_BACKEND` | `dynamodb` |
| `RUBY_HIGH_DYNAMO_TABLE` | `ruby-high-state` (or whatever you named it) |
| `RUBY_HIGH_PUBLIC_BASE` | `https://your-app-runner-url` (used for OpenRouter PKCE callback) |

The next deploy passes those as runtime env vars to App Runner, and the
service starts using DynamoDB. Until you set the variable, the workflow
stays on the JSON-file backend regardless of whether the table exists.

Why opt-in: setting the env var on App Runner before the instance role has
DynamoDB permissions would make the running service crash on the first
state read. Keeping it gated on a repo variable lets you sequence the
three steps above safely.

#### Schema (managed by the workflow)

- Primary key: `pk` (string) — the session id (`rh:user:<token>` or `rh:anonymous`)
- TTL attribute: `expiresAt` (seconds-since-epoch; the store writes this)
- Billing: on-demand (the app's traffic is bursty, items are 5-20 KB)

No `OPENROUTER_API_KEY` is needed on the server — each user authenticates with their own key via PKCE.

### Production caveats (alpha)

- **JSON backend is per-container-lifetime only.** Use the DynamoDB backend in production. The default JSON-file path is fine for local dev.
- **API keys still live in process memory.** A redeploy or VM restart wipes authenticated sessions; users sign in again. Migrating these to DynamoDB is a separate, smaller PR.
- **Rate limiting is in place** for LLM-burning endpoints (60/min per `(ip, cookie)` for chat; 8 burst, 1 per 30s for portrait gen). Auth endpoints are unbounded by design — keep an eye on them.

## License

MIT for the code. The Ruby High RPG mechanics layer (`RPG-DESIGN.md`) is **CC BY 4.0** and inspired by the Apocalypse World / Dungeon World lineage.
