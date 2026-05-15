# Ruby High

> A school where the teachers grade you in their own voice. Clear daily classes, bank grades, and keep the yearbook.

Ruby High is an [elizaOS](https://elizaos.dev) app and a standalone Node service. Ruby hosts the school; specialist faculty (Sally Science, Professor Edward) teach their domains; six AI classmates sit beside you. You play a generated character with four stats, walk between four rooms, clear daily classes and practice questions, and graduate after Senior year.

**For the product story, the mechanics, the cast, and the roadmap, see [`DESIGN.md`](./DESIGN.md).** This file is the runbook.

Production is on **Fly.io**; see [`infra/fly-deploy.md`](./infra/fly-deploy.md).
AWS App Runner is legacy / manual-only; see [`infra/README.md`](./infra/README.md).

## Run it locally

```bash
npm install
npm run build
npm run dev:server
```

Open http://127.0.0.1:3000/api/apps/ruby-high/viewer. Sign in with OpenRouter (PKCE, your own key, no card). The API key lives in your browser's localStorage; the server never holds it. Game state, auth sessions, and session-scoped packs persist through the configured store; teacher chat transcripts are process-local and reset on server restart/deploy.

The standalone viewer is installable as a PWA from `/api/apps/ruby-high/viewer`. The service worker is scoped to `/api/apps/ruby-high/`, caches the shell and core assets, and keeps auth, chat, pack management, and session state requests network-only. Full offline gameplay still requires the Ruby High server because the authoritative school state lives there.

## Offline SPA and native builds

Ruby High also has a static SPA build for native packaging:

```bash
npm run build:spa
npm run spa:dev
```

Open http://127.0.0.1:4173. This build packages the same viewer shell with a browser-local offline API shim backed by `localStorage` and the bundled Ruby/Sally/Edward question banks. Core classroom play, character creation, room switching, scoring, and local persistence work without the hosted server. AI chat, OpenRouter auth, Anki/PDF imports, and hosted account sync still require the Node service.

Native wrappers share `dist-spa/`:

```bash
# macOS / Windows / Linux via Tauri. Run each target on its native OS.
npm run native:desktop:build
npm run native:osx:build
npm run native:windows:build
npm run native:linux:build

# iOS / Android via Capacitor. Initialize the platform once, then build/open.
npm run native:mobile:init:ios
npm run native:mobile:init:android
npm run native:ios:build
npm run native:android:build
```

Desktop builds require Rust plus the platform WebView toolchain. iOS builds require Xcode; Android builds require Android Studio/JDK. Generated mobile projects live in `ios/` and `android/` after the init commands.

GitHub Actions builds these same targets in `.github/workflows/native-builds.yml` on PRs, pushes to `main`, and manual dispatch. The workflow uploads `ruby-high-spa`, `ruby-high-desktop-*`, `ruby-high-android-debug`, and `ruby-high-ios-simulator` artifacts. The iOS artifact is an unsigned simulator build; signed App Store/TestFlight builds still need Apple signing credentials.

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
| `RUBY_HIGH_RATI_BASE_URL` | `https://swarm.rati.chat/api/v1` | OpenAI-compatible RATi/aws-swarm base URL for connected teachers. |
| `RUBY_HIGH_RATI_API_KEY` | — | Server-side RATi key used to list/connect live teachers. Never sent to the browser or stored in packs. |
| `RUBY_HIGH_RATI_SUPPORTS_TOOLS` | `true` | Whether RATi connected teachers receive Ruby High board tools. Set `false` only for an older chat-only RATi backend. |
| `RUBY_HIGH_RATI_TIMEOUT_MS` | `60000` | Timeout for RATi model listing and chat calls. |
| `RUBY_HIGH_CONNECTED_TEACHER_QUESTION_COUNT` | `8` | Number of seed questions a connected teacher must generate when imported. Set `0` to skip seed-bank generation. |

The `/health` route is readiness: it returns 200 only after services have booted, so the platform should not route first-load traffic while Ruby High is hydrating. `/livez` is a process-liveness probe. The server trusts `x-forwarded-*` headers from the first hop for proto, host, and client IP.

No `OPENROUTER_API_KEY` is needed on the server — each user authenticates with their own key via PKCE. RATi connected teachers are the exception: they use the server-side `RUBY_HIGH_RATI_API_KEY` and can receive Ruby High board tools through the OpenAI-compatible RATi route.

## Tests

```bash
npm test
```

The suite covers the daily-class progression mechanic, the cohort, mentor mode, advantage roll, the phase machine, opinion grading, the chat layer, both store backends, the rate limiter, source-card distractor generation, pack routes, and the content-pack registry.

## Deploy

The current production deploy is **Fly.io**, driven locally by `npm run deploy`:

```bash
npm run deploy
```

The App Runner workflow is retained as a legacy manual fallback only. The container itself is host-agnostic — anywhere that speaks Docker, sets `PORT`, and populates `x-forwarded-*` works.

For the IAM trust policies, the DynamoDB bootstrap, and the manual deploy fallback, see [`infra/README.md`](./infra/README.md).

## License

MIT for the code. The mechanics layer is **CC BY 4.0** — see [`DESIGN.md`](./DESIGN.md) §6 and §12.
