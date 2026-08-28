# Ruby High

> A school where the teachers grade you in their own voice. Clear daily classes, bank grades, and keep the yearbook.

Ruby High is a standalone Node service and installable SPA. Ruby hosts the school; specialist faculty (Sally Science, Professor Edward) teach their domains; six AI classmates sit beside you. You play a generated character, build school disciplines and virtues, walk between rooms, clear daily classes and practice questions, collect hidden First Bell comic pages, track your standing on the classroom cohort leaderboard, and graduate after Senior year.

**For the product story, mechanics, cast, and roadmap, see [`DESIGN.md`](./DESIGN.md).** For the revenue plan and distribution pipeline, see [`ROADMAP.md`](./ROADMAP.md). This file is the runbook.

Production is on **Fly.io** with SQLite on a Fly Volume; see [`infra/fly-deploy.md`](./infra/fly-deploy.md). The legacy DynamoDB backend and App Runner deployment are archived in [`infra/README.md`](./infra/README.md); the AWS exit migration is documented in [`docs/aws-exit-migration.md`](./docs/aws-exit-migration.md). Public-world service-state migration and rollback notes live in [`docs/world-state-runbook.md`](./docs/world-state-runbook.md).

The two-wave first-class activation study is documented in [`docs/activation-playtest.md`](./docs/activation-playtest.md), including tracked invitation links, privacy boundaries, observation prompts, and decision thresholds.
The current dependency-security disposition is recorded in [`docs/dependabot-triage-2026-08-09.md`](./docs/dependabot-triage-2026-08-09.md), separating the Fly runtime from plugin build tooling and offline visual-scene packages.

## Run it locally

```bash
npm install
npm run build
npm run dev:server
```

Open http://127.0.0.1:3000/api/apps/ruby-high/viewer. Normal play starts with a Ruby High session cookie; OpenRouter sign-in is available for BYOK AI (PKCE, your own key, no card). If Privy is configured, the Account button signs the player in and can connect or reuse a Solana wallet; this build does not auto-create one on login. Browser-owned OpenRouter keys default to sessionStorage, can opt into localStorage persistence with `rh_openrouter_persist=1`, and are never held by the server. Game state, auth sessions, and session-scoped packs persist through the configured store (SQLite in production, JSON file in local dev); teacher chat transcripts are process-local and reset on server restart/deploy. Requires Node ≥24 for the built-in `node:sqlite` module.

## Ruby High 2.0 C wedge

The first C implementation lives in `ruby2/c`. It is a deterministic engine
and native SDL slice, not the final sokol client yet. It proves fixed-size
state, effect payload reduction, the Source/Sense/Sync/Signal disciplines,
RPN branch gates, item validation, empty-start inventory slots, whole-campus
pointcrawl navigation, ranker-curated two-button action trays with four-button
class moments, two-option conversation branches, Yearbook candidate eviction,
archetype resolution, companion locks, gameplay divergence tests, and the first
Captain Null trace resolver. `play-llm` adds the local Ollama
vertical slice: deterministic approach-choice gameplay with bounded
speech-bubble lines from `ruby-high-local` and authored fallback copy if the
model is unavailable or leaks analysis instead of JSON.

```bash
make -C ruby2/c test
make -C ruby2/c gameplay-test
make -C ruby2/c llm-test
make -C ruby2/c run
make -C ruby2/c play
make -C ruby2/c play-llm
make -C ruby2/c native-smoke
make -C ruby2/c native-run
```

The standalone viewer is installable as a PWA from `/api/apps/ruby-high/viewer`. The service worker is scoped to `/api/apps/ruby-high/`, caches the shell and core assets, and keeps auth, chat, pack management, and session state requests network-only. Full offline gameplay still requires the Ruby High server because the authoritative school state lives there.

## Offline SPA

Ruby High also has a static SPA build for browser-only offline testing:

```bash
npm run build:spa
npm run spa:dev
```

Open http://127.0.0.1:4173. This build packages the same viewer shell with a browser-local offline API shim backed by `localStorage` and the bundled Ruby/Sally/Edward question banks. Core classroom play, character creation, room switching, Merit Stars, and local persistence work without the hosted server. OpenRouter auth, Hall Pass purchases, portrait/diploma image generation, teacher publishing, and hosted account sync still require the Node service.

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

The offline SPA uses the same default local model and lets you override the local endpoint in DevTools:

```js
localStorage.setItem("ruby-high:local-llm-base", "http://127.0.0.1:11434/v1");
localStorage.setItem("ruby-high:local-llm-model", "ruby-high-local");
```

Native desktop/mobile packaging is intentionally not part of the current retention-truth build. Reintroduce it only when public-web retention data justifies that surface.

### Dev endpoints

No hosted account or OpenRouter key is needed for these:

- `GET /dev/pick` — draw a question for the active faculty.
- `GET /dev/pick?faculty=sally-science&difficulty=hard` — filter the draw.
- `GET /dev/faculty` — roster + question counts.
- `GET /dev/clear` — wipe the board (keeps Merit Stars).
- `GET /dev/reset` — wipe the session (Merit Stars + history).

### Production app endpoints

- `GET /api/apps/ruby-high/admin` renders a browser dashboard for the token-gated usage snapshot, 14-day charts, and an operator overview. Paste the admin token once; the page stores it locally and calls admin endpoints with a Bearer header.
- `POST /api/apps/ruby-high/metrics/event` records first-party viewer events. The bundled viewer sends durable `app_open` on boot and `session_resume` after returning from five-plus minutes inactive.
- `GET /api/apps/ruby-high/admin/metrics` returns a compact JSON snapshot for retention tuning: auth identity records/sessions, visitor counts, 14-day auth/play/event series, Ruby High session progression, visitor and character D1 retention, durable metric events, public-read/live-stream ops, and in-process log counters. `auth.users` is identity records, not unique humans. It is disabled until `RUBY_HIGH_ADMIN_TOKEN` is set and accepts either `Authorization: Bearer <token>` or the exact token value.
- `GET /api/apps/ruby-high/admin/metrics/schema` publishes the current admin metrics contract (`ruby-high-admin-metrics.v10`): field semantics, reliability levels, caveats, and the durable event streams for traffic, onboarding, retention, funnel, commerce, LLM, and errors.
- `GET /api/apps/ruby-high/admin/overview` returns a token-gated LLM-generated operator overview built only from aggregate metrics. It requires the normal server LLM credential.
- `GET /api/apps/ruby-high/yearbook/:shareId/:grade` renders a static public yearbook card for a sealed grade. Sealed year cards expose Open/Copy controls in the viewer. `?format=json` returns card data, `?format=svg` returns the fallback social image, and `?format=png` serves or redirects to the generated yearbook image when present before falling back to SVG.
- `GET /api/apps/ruby-high/cohort/:grade` renders the classroom cohort leaderboard for the current grade, scoped to active sessions at that year level.
- `GET /api/apps/ruby-high/world` returns the privacy-filtered shared school activity model: active classrooms, honor-roll cohorts, recent school events, and low curriculum pools. `?limit=` caps recent events.
- `GET /api/apps/ruby-high/world/events` streams the same shared school activity model as SSE frames; `?live=1` keeps the stream open briefly for viewer refreshes and future multiplayer clients.
- `/api/apps/ruby-high/agent/v1` is the versioned agent surface. It uses a human-approved device code, scoped bearer credentials, isolated student state, idempotent mutations, answer-key redaction, bounded autonomy settings, events, revocation, and one-time viewer launches.

## Service Wiring

The standalone server starts the school, faculty, auth, chat, agent-access, and configured social services backed by the content-pack registry under `src/content/`. Ruby High Original is always the base school; public creator packs rotate into one Guest Faculty course automatically each week. The curated roster includes Eliza's 96-question ElizaOS Systems Lab and Seraph's Project 89 Signal & Timeline Lab, with 24 hand-curated multiple-choice questions plus a 60-card upper-grade research corpus. Seraph's course teaches story-world literacy, source verification, memetic systems, human-AI agency, coordination, and bounded intervention while explicitly separating immersive lore from verified real-world claims. Eliza remains available as a collectible teacher card.

All hosted text/agent paths default to `openai/gpt-5.6-luna` through OpenRouter, including faculty dialogue and tool use, NPC opinion chimes, guest faculty, character text, social posts, creator drafts, and voice evaluation. Course and question-bank generation use `openai/gpt-5.6-terra`. Image generation keeps its dedicated image-capable models.

## ElizaOS agents

The ElizaOS app ships as [`@rati-osf/plugin-ruby-high`](https://www.npmjs.com/package/@rati-osf/plugin-ruby-high) (`elizaos plugins add @rati-osf/plugin-ruby-high`), released from [`cenetex/plugin-ruby-high`](https://github.com/cenetex/plugin-ruby-high) — **the plugin lives entirely in that repo; this one owns the server it talks to.** It is registered as an elizaOS app in [`elizaOS/eliza#17350`](https://github.com/elizaOS/eliza/pull/17350). It supports enrollment, classes, answers, progress, explicit public presence, and scheduled attendance through the same authoritative game engine as human players.

Scheduled play is opt-in and server-bounded: 15–1440 minute intervals, at most two classes, eight actions, and two model calls per run. It defaults to one class, six actions, one model call, no public presence, and the Guest Faculty allowlist. The plugin's app view exposes current work, its last scheduler stop reason, an autonomy toggle, and a one-time spectate-and-steer launch.

## Configuration

| Knob | Default | Notes |
|---|---|---|
| `PORT` | `8080` | HTTP port. |
| `HOST` | `0.0.0.0` | Bind address. |
| `RUBY_HIGH_PUBLIC_BASE` | `http://localhost:3000` (dev) | Public URL the app is reachable at. Required and enforced as HTTPS in production. |
| `RUBY_HIGH_TRUST_PROXY` | `false` | Trust proxy-provided client IP, host, and protocol headers. Enable only when the server is reachable exclusively through a trusted reverse proxy; Fly enables it explicitly. |
| `RUBY_HIGH_PRIVY_APP_ID` | — | Enables Privy account sign-in when set with `RUBY_HIGH_PRIVY_CLIENT_ID` and one server verifier secret. |
| `RUBY_HIGH_PRIVY_CLIENT_ID` | — | Public Privy client id embedded in the viewer so the browser SDK can initialize. |
| `RUBY_HIGH_PRIVY_LOGIN_METHODS` | `email,wallet,google,twitter,passkey` | Comma-separated Privy login methods shown in the viewer. Use `google` for Gmail sign-in. Each method must also be enabled in the Privy dashboard. |
| `RUBY_HIGH_PRIVY_APP_SECRET` | — | Preferred server-side Privy secret for verifying tokens and fetching linked wallet/user details. Set via secrets only. |
| `RUBY_HIGH_PRIVY_VERIFICATION_KEY` | — | Optional JWT verification-key fallback for deployments that do not use `RUBY_HIGH_PRIVY_APP_SECRET`. |
| `RUBY_HIGH_STORE_BACKEND` | `json` | `json` for local dev (atomic file at `~/.ruby-high/state.json`), `sqlite` for production (Fly Volume at `/data/ruby-high.db`). The legacy `dynamodb` backend is archived. |
| `RUBY_HIGH_STATE_PATH` | `~/.ruby-high/state.json` | State file path. For the `sqlite` backend this is the db file path (e.g. `/data/ruby-high.db`). |
| `RUBY_HIGH_X_SCHEDULED_POSTS_ENABLED` | `0` | Set to `1` to let the first connected teacher publish one LLM-written classroom/teacher-lounge update per 24 hours. Each update composes a dynamic, identity-locked campus photo from canonical faculty/classmate art, with the static teacher portrait as a generation fallback, and appends a deterministic viewer link with a mode-specific acquisition ref. The job uses only aggregate public-world activity, skips empty or duplicate context, persists its cadence across restarts, and backs off six hours after a failed attempt. |
| `RUBY_HIGH_STATE_TTL_SECONDS` | 90 days | TTL for idle sessions (SQLite `kv_expires` index). |
| `RUBY_HIGH_DYNAMO_TABLE` | — | Legacy: required when backend is `dynamodb`. Ignored for `sqlite`/`json`. |
| `AWS_REGION` | — | Legacy state-store region. Still used for Tigris portrait storage when `RUBY_HIGH_PORTRAITS_BUCKET` is set. |
| `RUBY_HIGH_ADMIN_TOKEN` | — | Enables `/api/apps/ruby-high/admin/metrics`. Keep this in secrets only. |
| `RUBY_HIGH_AGENT_TOKEN_SECRET` | random per process | Optional stable HMAC secret for agent device-token issuance across a server restart. Existing issued bearer tokens remain valid from their stored hashes. Set this through the deployment secret manager. |
| `RUBY_HIGH_METRICS_TRUST_START` | — | Optional ISO date/time shown in admin metric quality notes after a metrics reset or schema migration. |
| `RUBY_HIGH_LLM_PROVIDER` | `openrouter` | Set to `local` to use a local OpenAI-compatible `/v1/chat/completions` endpoint. Also inferred as `local` when `RUBY_HIGH_LLM_BASE_URL` is set. |
| `RUBY_HIGH_LLM_BASE_URL` | `http://127.0.0.1:11434/v1` in local mode | Local OpenAI-compatible base URL. Values ending in `/v1` or `/chat/completions` are both accepted. |
| `RUBY_HIGH_LLM_MODEL` | `ruby-high-local` in local mode | Model id sent to the local endpoint. Many single-model servers ignore it, but OpenAI-compatible servers require the field. |
| `RUBY_HIGH_LLM_API_KEY` | `local` in local mode | Optional bearer token for local servers configured with an API key. |
| `RUBY_HIGH_STUDENT_MODEL` | `openai/gpt-5.6-luna` | Model used for NPC opinion responses and other lightweight student/character text. |
| `RUBY_HIGH_OPENROUTER_API_KEY` | — | Optional server-side OpenRouter key for sponsored text AI plus hosted portrait/diploma generation. Server-hosted text chat is globally available when configured and player chat spends Merit Stars; browser-owned OpenRouter keys remain BYOK and do not spend Hall Passes. |
| `RUBY_HIGH_OPENROUTER_REFERER` | `https://ruby-high.local` | Sent in OpenRouter request headers. |
| `RUBY_HIGH_OPENROUTER_TITLE` | `Ruby High` | Sent in OpenRouter request headers. |
| `RUBY_HIGH_STRIPE_SECRET_KEY` | — | Enables web Hall Pass purchases via Stripe Checkout. |
| `RUBY_HIGH_STRIPE_WEBHOOK_SECRET` | — | Required for `/api/apps/ruby-high/billing/stripe/webhook` to grant Hall Passes after paid Checkout Sessions. |
| `RUBY_HIGH_STRIPE_CURRENCY` | `usd` | Currency for built-in Hall Pass packs. |
| `RUBY_HIGH_HALL_PASS_5_CENTS` | `199` | Price for 5 Hall Passes. |
| `RUBY_HIGH_HALL_PASS_20_CENTS` | `699` | Price for 20 Hall Passes. |
| `RUBY_HIGH_HALL_PASS_50_CENTS` | `1499` | Price for 50 Hall Passes. |
| `RUBY_HIGH_HALL_PASS_100_CENTS` | `2499` | Price for 100 Hall Passes. |
| `RUBY_HIGH_SOLANA_RPC_URL` | `https://api.mainnet-beta.solana.com` | Solana JSON-RPC endpoint used to prepare and verify native-SOL pack purchases. |
| `RUBY_HIGH_SOLANA_NFT_RPC_URL` | `RUBY_HIGH_SOLANA_RPC_URL` | Optional separate RPC endpoint for NFT minting. |
| `RUBY_HIGH_SOLANA_OWNERSHIP_RPC_URL` | `RUBY_HIGH_SOLANA_NFT_RPC_URL` | Optional dedicated read endpoint for batched current-owner verification. The authenticated CosyWorld export falls through to the NFT endpoint and public mainnet RPC when a candidate is unavailable or quota-limited. |
| `RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY` | — | Server mint authority secret key for Metaplex Core pack and card NFTs. Also drives creator attribution in served JSON metadata. Set via secrets only. |
| `RUBY_HIGH_COSYWORLD_EXPORT_TOKEN` | — | Bearer token required by the internal CosyWorld wallet-card ownership export. Set via secrets only. |
| `RUBY_HIGH_NFT_METADATA_STORAGE` | — | Optional durable metadata JSON upload mode. Set to `arweave` for direct AR uploads; unset keeps app-hosted metadata JSON. |
| `RUBY_HIGH_NFT_METADATA_ARWEAVE_JWK` | — | Arweave RSA JWK JSON used when `RUBY_HIGH_NFT_METADATA_STORAGE=arweave`. `RUBY_HIGH_ARWEAVE_JWK`, `RUBY_HIGH_ARWEAVE_WALLET_JWK`, and `ARWEAVE_JWK` are also accepted. |
| `RUBY_HIGH_NFT_METADATA_GATEWAY` | `https://arweave.net` | Gateway prefix returned for uploaded metadata JSON. |
| `RUBY_HIGH_PACK_REVEAL_SECRET` | `RUBY_HIGH_SOLANA_NFT_AUTHORITY_SECRET_KEY` | Server-only HMAC secret for deterministic pack-to-card mapping. Set a stable production secret so the mapping remains fair and non-public. |
| `RUBY_HIGH_SOLANA_CORE_COLLECTION_ADDRESS` | — | Metaplex Core collection address for Ruby High pack NFTs. Create once with `npm run nft:create-core-collection`, then set this value. |
| `RUBY_HIGH_SOLANA_CORE_CARD_COLLECTION_ADDRESS` | — | Metaplex Core collection address for Ruby High: First Bell card NFTs. Create once with `npm run nft:create-card-collection`, then set this value. |
| `RUBY_HIGH_SOLANA_TREASURY_OWNER` | `AtPVyHp52LqHy1rnMu5fUx9eWpDMrr2DnC3C3mdFc54j` | Treasury wallet that receives native SOL for pack purchases. |
| `RUBY_HIGH_SOLANA_PACK_1_SOL` | `0.01` (development only) | Native SOL price for one five-card pack. All four pack prices are required explicitly in production. |
| `RUBY_HIGH_SOLANA_PACK_3_SOL` | `0.028` (development only) | Native SOL price for three packs. All four pack prices are required explicitly in production. |
| `RUBY_HIGH_SOLANA_PACK_5_SOL` | `0.045` (development only) | Native SOL price for five packs. All four pack prices are required explicitly in production. |
| `RUBY_HIGH_SOLANA_PACK_10_SOL` | `0.085` (development only) | Native SOL price for ten packs. All four pack prices are required explicitly in production. |
| `RUBY_HIGH_HOSTED_AI_HALL_PASS_COST` | `1` | Legacy only. Server-hosted text AI no longer sells timed activation windows. |
| `RUBY_HIGH_HOSTED_AI_DURATION_HOURS` | `168` | Legacy only. Server-hosted text AI is sponsored when `RUBY_HIGH_OPENROUTER_API_KEY` is configured. |
| `RUBY_HIGH_HOSTED_AI_DURATION_MS` | — | Legacy only. Server-hosted text AI is sponsored when `RUBY_HIGH_OPENROUTER_API_KEY` is configured. |
| `RUBY_HIGH_QUESTION_GENERATION_HALL_PASS_COST` | `1` | Hall Pass cost for server-hosted Generate More Questions when the browser has no OpenRouter key. |
| `RUBY_HIGH_MORE_QUESTIONS_COUNT` | `6` | Default number of cards requested by Generate More Questions. |
| `RUBY_HIGH_PORTRAIT_HALL_PASS_COST` | `1` | Hall Pass cost for server-hosted custom portraits. |
| `RUBY_HIGH_DIPLOMA_HALL_PASS_COST` | `3` | Hall Pass cost for server-hosted diploma images. |
| `RUBY_HIGH_HOSTED_IMAGE_PENDING_TTL_MS` | `900000` | Timeout before a stuck pending hosted-image charge is failed and refunded. |
| `RUBY_HIGH_COURSE_SLOT_HALL_PASS_COST` | `3` | Hall Pass cost to reserve/publish one creator course slot. The legacy `RUBY_HIGH_COURSE_GENERATION_HALL_PASS_COST` is still honored as a fallback. |
| `RUBY_HIGH_REVENUECAT_WEBHOOK_AUTH` | — | Required Authorization header value for `/api/apps/ruby-high/billing/revenuecat/webhook`. The route accepts either this exact value or `Bearer <value>`. |
| `RUBY_HIGH_REVENUECAT_VIRTUAL_CURRENCY_CODE` | `HLP` | RevenueCat Virtual Currency code to credit as Hall Passes when using RevenueCat Virtual Currency events. |
| `RUBY_HIGH_CREATOR_DEFAULT_MODEL` | `openai/gpt-5.6-luna` | Default OpenRouter model for local teacher drafts created in Edit Pack. |
| `RUBY_HIGH_COURSE_MODEL` | `openai/gpt-5.6-terra` | Model used for course and question-bank generation. |
| `RUBY_HIGH_DRAFT_GENERATIONS_PER_DAY` | `5` | Per-teacher daily cap for draft question/course generation. |
| `RUBY_HIGH_COURSE_GENERATION_QUESTION_COUNT` | `18` | Default number of questions requested by AI course generation, clamped to 4–24. |
| `RUBY_HIGH_ALLOW_HTTP_MATERIAL_URLS` | — | Set to `true` only in trusted local/dev environments. Remote course-material imports require HTTPS by default and reject localhost/private/reserved hosts. |
| `RUBY_HIGH_ALLOWED_MATERIAL_HOSTS` | `raw.githubusercontent.com,gist.githubusercontent.com` | Comma-separated list of additional trusted hosts for remote course-material imports. GitHub blob URLs are normalized to `raw.githubusercontent.com`. |
| `RUBY_HIGH_EVAL_MODEL` | `openai/gpt-5.6-luna` | LLM-judge model for `npm run eval:voice` when an OpenRouter key is available. |
| `RUBY_HIGH_EVAL_REQUIRE_API` | — | Set to `1` to make `npm run eval:voice` fail when no `RUBY_HIGH_OPENROUTER_API_KEY` is configured. |

The `/health` route is readiness: it returns 200 only after services have booted, so the platform should not route first-load traffic while Ruby High is hydrating. `/livez` is a process-liveness probe. Forwarded proxy headers are ignored unless `RUBY_HIGH_TRUST_PROXY` is explicitly enabled.

No OpenRouter key is required on the server for normal play: each user can authenticate with their own key via PKCE, or use a Privy account for persistent identity/wallet ownership when Privy is configured. `RUBY_HIGH_OPENROUTER_API_KEY` sponsors server-hosted text AI for signed-in players, while player-authored chat spends Merit Stars. The same key enables hosted image generation with per-image Hall Pass costs. Edit Pack creates OpenRouter-backed local teacher drafts; Ruby High does not list, import, grant, or call external avatar/agent backends.

## Billing and Hall Passes

Ruby High now has two currencies:

- **Merit Stars** are earned by play and mirror the visible session-score payout.
- **Hall Passes** are paid/entitlement currency for hosted image generation, creator course slots, extra student slots, and card features. Stripe Checkout, card burns, and RevenueCat in-app purchases credit Hall Passes; Solana pack purchases create collectible packs and cards instead.

Web purchases use Stripe Checkout for Hall Passes only:

- `GET /api/apps/ruby-high/billing/products` returns Hall Pass top-ups, hosted image costs, and the separate Solana pack quote surface.
- `POST /api/apps/ruby-high/billing/ai-pass` is retired and returns `410`; server-hosted text AI is sponsored when configured, and player chat spends Merit Stars.
- Publishing a draft course reserves a creator course slot for 3 Hall Passes. BYOK/local course generation does not spend Hall Passes.
- Course visibility is enforced end to end: private courses are owner-only, unlisted courses are link-accessible but omitted from discovery/rotation, and only public courses enter search or weekly Guest Faculty rotation.
- Publishing validates question structure, explanations, duplicate prompts, grade gates, source metadata, and public-course difficulty/stat balance before spending a course slot.
- Generate More Questions is free with browser OpenRouter or local LLM access; when it uses the server-hosted OpenRouter key, it spends 1 Hall Pass per run.
- Unlocking an extra student slot costs 1 Hall Pass and grants a Photo Day credit; hosted character portraits consume that credit before spending a Hall Pass.
- `POST /api/apps/ruby-high/billing/checkout` creates a Stripe Checkout Session for Hall Passes for the signed-in Ruby High cookie session.
- `POST /api/apps/ruby-high/billing/stripe/webhook` verifies Stripe signatures and grants Hall Passes idempotently from Checkout metadata. Stripe does not sell card packs or Solana collectibles.
- `POST /api/apps/ruby-high/billing/card-burn` verifies owner-signed card burns and credits 5 Hall Passes per burned card. Hosted features then spend Hall Passes normally.

Stripe webhook events to send: `checkout.session.completed`; `checkout.session.async_payment_succeeded` when using asynchronous payment methods; `refund.created`, `refund.updated`, `refund.failed`, and `charge.refunded` for refunds; and `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`, `charge.dispute.funds_withdrawn`, plus `charge.dispute.funds_reinstated` for disputes. Refund and dispute events reconcile the paid Hall Pass grant by PaymentIntent id and are idempotent across Stripe retries. Inquiry/warning disputes do not revoke Hall Passes unless Stripe reports that funds were withdrawn.

Solana purchases are separate from Stripe and use native SOL to mint a Metaplex Core pack NFT:

- The default treasury wallet is `AtPVyHp52LqHy1rnMu5fUx9eWpDMrr2DnC3C3mdFc54j`.
- Development fallback prices are `0.01`, `0.028`, `0.045`, and `0.085` SOL for 1, 3, 5, and 10 packs. Production checkout stays disabled until all four prices are set explicitly; price them against the 25-Hall-Pass redemption floor per pack rather than relying on these development values.
- Create the Core collection once with `npm run nft:create-core-collection`, then set `RUBY_HIGH_SOLANA_CORE_COLLECTION_ADDRESS` to the printed address.
- Create the Core card collection once with `npm run nft:create-card-collection`, then set `RUBY_HIGH_SOLANA_CORE_CARD_COLLECTION_ADDRESS` to the printed address.
- The current First Bell runtime manifest has 24 mintable profiles and a 12-profile alternate-art expansion, for 36 draft profiles total in `src/services/hall-pass-card-catalog.ts`. Revealed metadata includes `Set`, `Set Code`, `Set Number`, `Card Profile ID`, `Card Name`, `Subject`, media traits, and creator attribution. Reveal proof data stays under `properties.provenance` instead of visible marketplace traits.
- Wallet-facing card crops are plain images, not cards inside cards: students, teachers, and specials are tall avatar crops; items are square; locations are wide. Regenerate crops with `npm run nft:crop-cards` after changing source art. Use `node scripts/generate-nft-grok-art.mjs --parallel 3 --ids <ids>` to refresh Grok source art through OpenRouter before cropping. Run `node scripts/generate-nft-grok-art.mjs --ids brand-eliza-plugin-icon,brand-eliza-plugin-launch` to refresh the elizaOS app icon and launch key art from Ruby, Eliza, the wordmark, and the science-lab references.
- Opening a pack marks the Core pack as opened, switches its metadata to opened artwork, and reveals five deterministic in-app cards immediately. Each pack has one teacher, three different students, and one campus or special card. Pack/card records and receipts carry `packRevealVersion`, `catalogHash`, `commitment`, `entropySource`, and reveal-time `revealSeed` provenance; see [`docs/nft/NFT_PROVABLY_FAIR_V1_2.md`](./docs/nft/NFT_PROVABLY_FAIR_V1_2.md) for the current algorithm.
- The current v1.2 entropy source is an auditable server-commit bridge, not decentralized randomness. Existing v1.1 packs keep their original reveal algorithm. The next hardening step is a Solana pack-opening program that commits the open request and payment/authority lock first, then settles from Switchboard randomness.
- Marketplace submission copy, collection addresses, and Magic Eden verification steps are tracked in [`docs/nft/NFT_MARKETPLACE_VERIFICATION.md`](./docs/nft/NFT_MARKETPLACE_VERIFICATION.md).
- To mint pack and collection JSON directly on Arweave, fund the Arweave wallet, set `RUBY_HIGH_NFT_METADATA_STORAGE=arweave`, add the JWK secret, and verify the resulting metadata URI.
- Wallet-signed pack checkout is atomic: the prepared transaction transfers native SOL to the treasury with the Ruby High payment reference and creates the Metaplex Core pack NFT. The connected wallet is the fee payer, and Ruby High co-signs only the pack authority/asset parts.
- Revealed in-app cards can be minted on Solana one at a time. Minting is optional; the connected wallet is the fee payer and recipient, and mint preparation returns the same card identity already shown in Ruby High.
- Owner-signed card burns are prepared one card per wallet prompt and preflighted before signing; `POST /api/apps/ruby-high/billing/card-burn` verifies the burn signature and credits 5 Hall Passes per burned card.
- `POST /api/apps/ruby-high/billing/solana/quote` accepts the connected owner wallet and returns the treasury wallet, per-session payment reference, SOL amount, atomic purchase transaction, and Solana Pay URL for a selected pack.
- `POST /api/apps/ruby-high/billing/solana/confirm` accepts the signed purchase signature and owner wallet, then verifies the payment reference, buyer, pack asset, and treasury lamport receipt before recording the pack idempotently.

Native billing is not wired in the current public-web build. If iOS or Android comes back, do not use Stripe for digital in-app currency; create matching consumable in-app purchase products in App Store Connect and Google Play Console, validate receipts/purchase tokens server-side, then call the same Hall Pass grant path. RevenueCat can replace most receipt-validation boilerplate; the Ruby High server remains the authority that credits the wallet after validation.

RevenueCat setup:

- Use one Offering for the shop, for example `hall_passes`, with consumable packages for `hall_pass_5`, `hall_pass_20`, `hall_pass_50`, and `hall_pass_100`. Product IDs with app prefixes are okay if they end in those IDs.
- Set the RevenueCat app user ID to the Ruby High state key (`rh:user:<userId>`). If the app sends just `<userId>`, the server prefixes it to `rh:user:<userId>`. Anonymous RevenueCat IDs are ignored for wallet fulfillment.
- Add a webhook pointing at `/api/apps/ruby-high/billing/revenuecat/webhook` and set its Authorization header to `Bearer <RUBY_HIGH_REVENUECAT_WEBHOOK_AUTH>` or exactly the configured value.
- Send `NON_RENEWING_PURCHASE` events to grant Hall Passes and `CANCELLATION` events to revoke refunded Hall Passes. Refund events only debit a wallet when they match a previously recorded RevenueCat transaction; refund-first events are marked so a delayed purchase webhook for the same transaction cannot credit a refunded purchase. If using RevenueCat Virtual Currency, send `VIRTUAL_CURRENCY_TRANSACTION` events and set the currency code to `HLP` or configure `RUBY_HIGH_REVENUECAT_VIRTUAL_CURRENCY_CODE`.

## Tests

```bash
npm test
npm run check:full
npm run test:browser
npm run eval:voice
```

`check:full` runs typecheck, the Vitest suite, and the offline SPA build. `test:browser` is the opt-in Playwright smoke target; it builds and launches the dev server, boots the viewer in Chromium, exercises guest play, account tabs, responsive framing, school activity feed rollover, comic unlock modals, and the Privy bundle load path. The `browser-smoke` GitHub Actions workflow runs the same target manually and on PRs that touch viewer/browser files. `eval:voice` builds the package and runs the faculty-voice smoke harness; without an OpenRouter key it still verifies the local reference set and exits successfully unless `RUBY_HIGH_EVAL_REQUIRE_API=1`.

The suite covers the daily-class progression mechanic, the cohort, mentor mode, advantage roll, the phase machine, opinion grading with praise-gate detection, the chat layer, both store backends, the rate limiter, source-card distractor generation, pack routes, yearbook/admin/cohort routes, and the content-pack registry.

## Deploy

The current production deploy is **Fly.io**, driven locally by `npm run deploy`:

```bash
npm run deploy
```

The container itself is host-agnostic — anywhere that speaks Docker, sets `PORT`, and populates `x-forwarded-*` works. The legacy App Runner workflow and DynamoDB bootstrap are archived in [`infra/README.md`](./infra/README.md).

## License

MIT for the code, copyright RATi Open Software Foundation. The Ruby High characters (Ruby, Sally Science, Professor Edward, and the six student cast) and their artwork are dedicated to the public domain under **CC0 1.0** — see [`CC0-CHARACTERS.md`](./CC0-CHARACTERS.md). The mechanics layer is **CC BY 4.0** — see [`DESIGN.md`](./DESIGN.md) §6 and §12.
