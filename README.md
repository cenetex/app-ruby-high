# Ruby High

> A school where the teachers grade you in their own voice. Chase rare questions, bank grades, and keep the yearbook.

Ruby High is an [elizaOS](https://elizaos.dev) app and a standalone Node service. Ruby hosts the school; specialist faculty (Sally Science, Professor Edward) teach their domains; six AI classmates sit beside you. You play a generated character with four stats, walk between four rooms, answer rarity-rolled questions, and graduate after Senior year.

**For the product story, the mechanics, the cast, and the roadmap, see [`DESIGN.md`](./DESIGN.md).** This file is the runbook.

Production is on **Fly.io**; see [`infra/fly-deploy.md`](./infra/fly-deploy.md).
AWS App Runner is legacy / manual-only; see [`infra/README.md`](./infra/README.md).

## Run it locally

```bash
npm install
npm run build
npm run dev:server
```

Open http://127.0.0.1:3000/api/apps/ruby-high/viewer. Sign in with OpenRouter (PKCE, your own key, no card). The API key lives in your browser's localStorage; the server never holds it.

### Dev endpoints

No eliza runtime needed for these:

- `GET /dev/pick` — draw a question for the active faculty.
- `GET /dev/pick?faculty=sally-science&difficulty=hard` — filter the draw.
- `GET /dev/faculty` — roster + question counts.
- `GET /dev/clear` — wipe the board (keeps score).
- `GET /dev/reset` — wipe the session (score + history).

## Wire it into a character

```ts
import rubyHighPlugin from "@cenetex/app-ruby-high";

export const character = {
  name: "Ruby",
  plugins: [rubyHighPlugin /* , ...others */],
};
```

The plugin registers four services (`FacultyService`, `RubyHighService`, `AuthService`, `ChatService`) backed by the content-pack registry under `src/content/`.

## Configuration

| Knob | Default | Notes |
|---|---|---|
| `PORT` | `8080` | HTTP port. |
| `HOST` | `0.0.0.0` | Bind address. |
| `RUBY_HIGH_PUBLIC_BASE` | `http://localhost:3000` | Public URL the app is reachable at. **Must be HTTPS in production** — OpenRouter rejects HTTP callbacks. |
| `RUBY_HIGH_STORE_BACKEND` | `json` | `json` for local dev (atomic file at `~/.ruby-high/state.json`), `dynamodb` for production. |
| `RUBY_HIGH_STATE_PATH` | `~/.ruby-high/state.json` | JSON-backend file path. |
| `RUBY_HIGH_DYNAMO_TABLE` | — | Required when backend is `dynamodb`. |
| `AWS_REGION` | — | Required when backend is `dynamodb`. |
| `RUBY_HIGH_STATE_TTL_SECONDS` | 90 days | DynamoDB TTL for idle sessions. |
| `RUBY_HIGH_STUDENT_MODEL` | `anthropic/claude-haiku-4.5` | Model used for NPC opinion responses. |
| `RUBY_HIGH_OPENROUTER_REFERER` | `https://ruby-high.local` | Sent in OpenRouter request headers. |
| `RUBY_HIGH_OPENROUTER_TITLE` | `Ruby High` | Sent in OpenRouter request headers. |

The `/health` route returns 200 once the services have booted; configure your platform's healthcheck against it. The server trusts `x-forwarded-*` headers from the first hop for proto, host, and client IP.

No `OPENROUTER_API_KEY` is needed on the server — each user authenticates with their own key via PKCE.

## Tests

```bash
npm test
```

18 test files covering the rarity/bonus progression mechanic, the cohort, mentor mode, advantage roll, the phase machine, opinion grading, the chat layer, both store backends, the rate limiter, the Anki parser + distractor generator, pack routes, and the content-pack registry.

## Deploy

The current production deploy is **Fly.io**, driven locally by `npm run deploy`:

```bash
npm run deploy
```

The App Runner workflow is retained as a legacy manual fallback only. The container itself is host-agnostic — anywhere that speaks Docker, sets `PORT`, and populates `x-forwarded-*` works.

For the IAM trust policies, the DynamoDB bootstrap, and the manual deploy fallback, see [`infra/README.md`](./infra/README.md).

## License

MIT for the code. The mechanics layer is **CC BY 4.0** — see [`DESIGN.md`](./DESIGN.md) §6 and §12.
