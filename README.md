# Ruby High

> A school where the teachers grade you in their own voice. Clear daily classes, bank grades, and keep the yearbook.

Ruby High is an [elizaOS](https://elizaos.dev) app and a standalone Node service. Ruby hosts the school; specialist faculty (Sally Science, Professor Edward) teach their domains; six AI classmates sit beside you. You play a generated character with four stats, walk between four rooms, clear daily classes and practice questions, collect hidden First Bell comic pages, and graduate after Senior year.

**For the product story, the mechanics, the cast, and the roadmap, see [`DESIGN.md`](./DESIGN.md).** This file is the runbook.

Production is on **Fly.io**; see [`infra/fly-deploy.md`](./infra/fly-deploy.md).
AWS App Runner is legacy / manual-only; see [`infra/README.md`](./infra/README.md).

## Run it locally

```bash
npm install
npm run build
npm run dev:server
```

Open http://127.0.0.1:3000/api/apps/ruby-high/viewer. Normal play starts with a Ruby High session cookie; OpenRouter sign-in is still available for BYOK AI (PKCE, your own key, no card). If Privy is configured, the Account button signs the player in by email, creates or reuses an embedded wallet, and stores only the verified Privy user/wallet identity server-side. Browser-owned OpenRouter keys still live in localStorage; the server never holds them. Game state, auth sessions, and session-scoped packs persist through the configured store; teacher chat transcripts are process-local and reset on server restart/deploy.

The standalone viewer is installable as a PWA from `/api/apps/ruby-high/viewer`. The service worker is scoped to `/api/apps/ruby-high/`, caches the shell and core assets, and keeps auth, chat, pack management, and session state requests network-only. Full offline gameplay still requires the Ruby High server because the authoritative school state lives there.

## Offline SPA and native builds

Ruby High also has a static SPA build for native packaging:

```bash
npm run build:spa
npm run spa:dev
```

Open http://127.0.0.1:4173. This build packages the same viewer shell with a browser-local offline API shim backed by `localStorage` and the bundled Ruby/Sally/Edward question banks. Core classroom play, character creation, room switching, Merit Stars, and local persistence work without the hosted server. In the native Tauri shell, text AI talks to an Ollama OpenAI-compatible server at `http://127.0.0.1:11434/v1` by default. OpenRouter auth, Hall Pass purchases, portrait/diploma image generation, teacher publishing, and hosted account sync still require the Node service.

For offline text AI, run Ruby High against a local OpenAI-compatible chat-completions server such as Ollama:

```bash
ollama create ruby-high-local -f /path/to/Modelfile
ollama serve
RUBY_HIGH_LLM_PROVIDER=local \
RUBY_HIGH_LLM_BASE_URL=http://127.0.0.1:11434/v1 \
RUBY_HIGH_LLM_MODEL=ruby-high-local \
npm run dev:server
```

Local mode removes the OpenRouter key requirement for text chat, teacher turns, NPC chimes, character text, opinion grading, and multiple-choice distractors for source cards. Portrait and diploma image generation still use the OpenRouter image endpoint. A browser-owned OpenRouter key stays BYOK/free-to-Ruby-High; the optional server-hosted image path spends Hall Passes.

The native SPA uses the same default local model and lets you override the local endpoint in DevTools:

```js
localStorage.setItem("ruby-high:local-llm-base", "http://127.0.0.1:11434/v1");
localStorage.setItem("ruby-high:local-llm-model", "ruby-high-local");
```

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

CI builds `dist-spa/` once, then reuses that artifact for Tauri and Capacitor jobs. The `native:*:build:ci` scripts merge `src-tauri/tauri.ci.conf.json` to skip Tauri's frontend rebuild step.

### Dev endpoints

No eliza runtime needed for these:

- `GET /dev/pick` — draw a question for the active faculty.
- `GET /dev/pick?faculty=sally-science&difficulty=hard` — filter the draw.
- `GET /dev/faculty` — roster + question counts.
- `GET /dev/clear` — wipe the board (keeps Merit Stars).
- `GET /dev/reset` — wipe the session (Merit Stars + history).

### Production app endpoints

- `GET /api/apps/ruby-high/admin/metrics` returns a compact JSON snapshot for retention tuning: auth users/sessions, Ruby High sessions/progression, and in-process log counters. It is disabled until `RUBY_HIGH_ADMIN_TOKEN` is set and accepts either `Authorization: Bearer <token>` or the exact token value.
- `GET /api/apps/ruby-high/yearbook/:shareId/:grade` renders a static public yearbook card for a sealed grade. Sealed year cards expose Open/Copy controls in the viewer. `?format=json` returns card data and `?format=svg` returns the social image. `?format=png` is intentionally 501 until server-side raster rendering is configured.

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
| `RUBY_HIGH_PRIVY_APP_ID` | — | Enables Privy account sign-in when set with `RUBY_HIGH_PRIVY_CLIENT_ID` and one server verifier secret. |
| `RUBY_HIGH_PRIVY_CLIENT_ID` | — | Public Privy client id embedded in the viewer so the browser SDK can initialize. |
| `RUBY_HIGH_PRIVY_APP_SECRET` | — | Preferred server-side Privy secret for verifying tokens and fetching linked wallet/user details. Set via secrets only. |
| `RUBY_HIGH_PRIVY_VERIFICATION_KEY` | — | Optional JWT verification-key fallback for deployments that do not use `RUBY_HIGH_PRIVY_APP_SECRET`. |
| `RUBY_HIGH_STORE_BACKEND` | `json` | `json` for local dev (atomic file at `~/.ruby-high/state.json`), `dynamodb` for production. |
| `RUBY_HIGH_STATE_PATH` | `~/.ruby-high/state.json` | JSON-backend file path. |
| `RUBY_HIGH_DYNAMO_TABLE` | — | Required when backend is `dynamodb`. |
| `AWS_REGION` | — | Required when backend is `dynamodb`. |
| `RUBY_HIGH_STATE_TTL_SECONDS` | 90 days | DynamoDB TTL for idle sessions. |
| `RUBY_HIGH_ADMIN_TOKEN` | — | Enables `/api/apps/ruby-high/admin/metrics`. Keep this in secrets only. |
| `RUBY_HIGH_LLM_PROVIDER` | `openrouter` | Set to `local` to use a local OpenAI-compatible `/v1/chat/completions` endpoint. Also inferred as `local` when `RUBY_HIGH_LLM_BASE_URL` is set. |
| `RUBY_HIGH_LLM_BASE_URL` | `http://127.0.0.1:11434/v1` in local mode | Local OpenAI-compatible base URL. Values ending in `/v1` or `/chat/completions` are both accepted. |
| `RUBY_HIGH_LLM_MODEL` | `ruby-high-local` in local mode | Model id sent to the local endpoint. Many single-model servers ignore it, but OpenAI-compatible servers require the field. |
| `RUBY_HIGH_LLM_API_KEY` | `local` in local mode | Optional bearer token for local servers configured with an API key. |
| `RUBY_HIGH_STUDENT_MODEL` | `anthropic/claude-haiku-4.5` | Model used for NPC opinion responses. |
| `RUBY_HIGH_OPENROUTER_API_KEY` | — | Optional server-side OpenRouter key for hosted AI Access and hosted portrait/diploma generation. Server-hosted text AI is available only while the signed-in session has active AI Access. Browser-owned OpenRouter keys remain BYOK and do not spend Hall Passes. |
| `RUBY_HIGH_OPENROUTER_REFERER` | `https://ruby-high.local` | Sent in OpenRouter request headers. |
| `RUBY_HIGH_OPENROUTER_TITLE` | `Ruby High` | Sent in OpenRouter request headers. |
| `RUBY_HIGH_STRIPE_SECRET_KEY` | — | Enables web Hall Pass purchases via Stripe Checkout. |
| `RUBY_HIGH_STRIPE_WEBHOOK_SECRET` | — | Required for `/api/apps/ruby-high/billing/stripe/webhook` to grant Hall Passes after paid Checkout Sessions. |
| `RUBY_HIGH_STRIPE_CURRENCY` | `usd` | Currency for built-in Hall Pass packs. |
| `RUBY_HIGH_HALL_PASS_5_CENTS` | `199` | Price for 5 Hall Passes. |
| `RUBY_HIGH_HALL_PASS_20_CENTS` | `699` | Price for 20 Hall Passes. |
| `RUBY_HIGH_HALL_PASS_50_CENTS` | `1499` | Price for 50 Hall Passes. |
| `RUBY_HIGH_HALL_PASS_100_CENTS` | `2499` | Price for 100 Hall Passes. |
| `RUBY_HIGH_HOSTED_AI_HALL_PASS_COST` | `1` | Hall Pass cost to activate server-hosted text AI for one timed window. |
| `RUBY_HIGH_HOSTED_AI_DURATION_HOURS` | `168` | Hosted AI Access duration. Ignored when `RUBY_HIGH_HOSTED_AI_DURATION_MS` is set. |
| `RUBY_HIGH_HOSTED_AI_DURATION_MS` | — | Optional exact hosted AI pass duration override. |
| `RUBY_HIGH_QUESTION_GENERATION_HALL_PASS_COST` | `1` | Hall Pass cost for server-hosted Generate More Questions when the browser has no OpenRouter key. |
| `RUBY_HIGH_MORE_QUESTIONS_COUNT` | `6` | Default number of cards requested by Generate More Questions. |
| `RUBY_HIGH_PORTRAIT_HALL_PASS_COST` | `1` | Hall Pass cost for server-hosted custom portraits. |
| `RUBY_HIGH_DIPLOMA_HALL_PASS_COST` | `3` | Hall Pass cost for server-hosted diploma images. |
| `RUBY_HIGH_HOSTED_IMAGE_PENDING_TTL_MS` | `900000` | Timeout before a stuck pending hosted-image charge is failed and refunded. |
| `RUBY_HIGH_COURSE_SLOT_HALL_PASS_COST` | `3` | Hall Pass cost to reserve/publish one creator course slot. The legacy `RUBY_HIGH_COURSE_GENERATION_HALL_PASS_COST` is still honored as a fallback. |
| `RUBY_HIGH_REVENUECAT_WEBHOOK_AUTH` | — | Required Authorization header value for `/api/apps/ruby-high/billing/revenuecat/webhook`. The route accepts either this exact value or `Bearer <value>`. |
| `RUBY_HIGH_REVENUECAT_VIRTUAL_CURRENCY_CODE` | `HLP` | RevenueCat Virtual Currency code to credit as Hall Passes when using RevenueCat Virtual Currency events. |
| `RUBY_HIGH_CREATOR_DEFAULT_MODEL` | `anthropic/claude-haiku-4.5` | Default OpenRouter model for local teacher drafts created in Edit Pack. |
| `RUBY_HIGH_DRAFT_GENERATIONS_PER_DAY` | `5` | Per-teacher daily cap for draft question/course generation. |
| `RUBY_HIGH_COURSE_GENERATION_QUESTION_COUNT` | `18` | Default number of questions requested by AI course generation, clamped to 4–24. |
| `RUBY_HIGH_ALLOW_HTTP_MATERIAL_URLS` | — | Set to `true` only in trusted local/dev environments. Remote course-material imports require HTTPS by default and reject localhost/private/reserved hosts. |
| `RUBY_HIGH_EVAL_MODEL` | `openai/gpt-4.1-mini` | LLM-judge model for `npm run eval:voice` when an OpenRouter key is available. |
| `RUBY_HIGH_EVAL_REQUIRE_API` | — | Set to `1` to make `npm run eval:voice` fail when no `RUBY_HIGH_OPENROUTER_API_KEY` is configured. |
| `RUBY_HIGH_RATI_BASE_URL` | `https://swarm.rati.chat/api/v1` | OpenAI-compatible RATi/aws-swarm base URL for persisted RATi-backed teacher packs. |
| `RUBY_HIGH_RATI_INTERNAL_API_KEY` | — | Internal server-to-server RATi credential for persisted RATi-backed teacher packs. The legacy `RUBY_HIGH_RATI_API_KEY` is no longer read. |
| `RUBY_HIGH_RATI_SUPPORTS_TOOLS` | `true` | Whether RATi-backed teachers receive Ruby High board tools. Set `false` only for an older chat-only RATi backend. |
| `RUBY_HIGH_RATI_TIMEOUT_MS` | `60000` | Timeout for RATi chat calls. |

The `/health` route is readiness: it returns 200 only after services have booted, so the platform should not route first-load traffic while Ruby High is hydrating. `/livez` is a process-liveness probe. The server trusts `x-forwarded-*` headers from the first hop for proto, host, and client IP.

No OpenRouter key is required on the server for normal play: each user can authenticate with their own key via PKCE, or use a Privy account for persistent identity/wallet ownership when Privy is configured. Ruby High no longer lists, creates, imports, or grants RATi avatars. `RUBY_HIGH_OPENROUTER_API_KEY` enables hosted text AI only for sessions that spend a Hall Pass on AI Access, and enables hosted image generation with per-image Hall Pass costs. Edit Pack no longer lists/imports live RATi models from a server key; new local teacher drafts become OpenRouter-backed packs, while existing RATi-backed packs use `RUBY_HIGH_RATI_INTERNAL_API_KEY` only for server-to-server runtime calls.

## Billing and Hall Passes

Ruby High now has two currencies:

- **Merit Stars** are earned by play and mirror the visible session-score payout.
- **Hall Passes** are paid/entitlement currency for hosted AI windows, creator course slots, extra student slots, and hosted image generation.

Web purchases use Stripe Checkout:

- `GET /api/apps/ruby-high/billing/products` returns Hall Pass packs, AI Access cost/duration, and hosted image costs.
- `POST /api/apps/ruby-high/billing/ai-pass` spends Hall Passes to activate server-hosted text AI for the signed-in Ruby High cookie session. A second call while active returns the existing expiry and does not spend again.
- Publishing a draft course reserves a creator course slot for 3 Hall Passes. BYOK/local course generation does not spend Hall Passes.
- Generate More Questions is free with browser OpenRouter or local LLM access; when it uses the server-hosted OpenRouter key, it spends 1 Hall Pass per run.
- Unlocking an extra student slot costs 1 Hall Pass and grants a Photo Day credit; hosted character portraits consume that credit before spending a Hall Pass.
- `POST /api/apps/ruby-high/billing/checkout` creates a Stripe Checkout Session for the signed-in Ruby High cookie session.
- `POST /api/apps/ruby-high/billing/stripe/webhook` verifies Stripe signatures and grants Hall Passes idempotently from Checkout metadata.

Stripe webhook events to send: `checkout.session.completed` and, if using asynchronous payment methods, `checkout.session.async_payment_succeeded`.

For iOS and Android, do not use Stripe for digital in-app currency. Create matching consumable in-app purchase products in App Store Connect and Google Play Console, validate receipts/purchase tokens server-side, then call the same Hall Pass grant path. RevenueCat can replace most receipt-validation boilerplate; the Ruby High server remains the authority that credits the wallet after validation.

RevenueCat setup:

- Use one Offering for the shop, for example `hall_passes`, with consumable packages for `hall_pass_5`, `hall_pass_20`, `hall_pass_50`, and `hall_pass_100`. Product IDs with app prefixes are okay if they end in those IDs.
- Set the RevenueCat app user ID to the Ruby High state key (`rh:user:<userId>`). If the app sends just `<userId>`, the server prefixes it to `rh:user:<userId>`. Anonymous RevenueCat IDs are ignored for wallet fulfillment.
- Add a webhook pointing at `/api/apps/ruby-high/billing/revenuecat/webhook` and set its Authorization header to `Bearer <RUBY_HIGH_REVENUECAT_WEBHOOK_AUTH>` or exactly the configured value.
- Send `NON_RENEWING_PURCHASE` events to grant Hall Passes and `CANCELLATION` events to revoke refunded Hall Passes. Refund events only debit a wallet when they match a previously recorded RevenueCat transaction; refund-first events are marked so a delayed purchase webhook for the same transaction cannot credit a refunded purchase. If using RevenueCat Virtual Currency, send `VIRTUAL_CURRENCY_TRANSACTION` events and set the currency code to `HLP` or configure `RUBY_HIGH_REVENUECAT_VIRTUAL_CURRENCY_CODE`.

## Tests

```bash
npm test
npm run check:full
npm run eval:voice
```

`check:full` runs typecheck, the Vitest suite, and the offline SPA build. `eval:voice` builds the package and runs the faculty-voice smoke harness; without an OpenRouter key it still verifies the local reference set and exits successfully unless `RUBY_HIGH_EVAL_REQUIRE_API=1`.

The suite covers the daily-class progression mechanic, the cohort, mentor mode, advantage roll, the phase machine, opinion grading, the chat layer, both store backends, the rate limiter, source-card distractor generation, pack routes, yearbook/admin routes, and the content-pack registry.

## Deploy

The current production deploy is **Fly.io**, driven locally by `npm run deploy`:

```bash
npm run deploy
```

The App Runner workflow is retained as a legacy manual fallback only. The container itself is host-agnostic — anywhere that speaks Docker, sets `PORT`, and populates `x-forwarded-*` works.

For the IAM trust policies, the DynamoDB bootstrap, and the manual deploy fallback, see [`infra/README.md`](./infra/README.md).

## License

MIT for the code. The mechanics layer is **CC BY 4.0** — see [`DESIGN.md`](./DESIGN.md) §6 and §12.
