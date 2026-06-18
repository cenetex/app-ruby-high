# Ruby High — Fly.io deploy

Fly.io is the production deploy target. It's the cost-engineering move
for this app: scales to zero on idle, ~300-500ms cold start, same Docker
image, free tier covers the daily-cadence traffic profile.

The app config lives at [`fly.toml`](../fly.toml). Runtime state lives in
SQLite on the Fly volume mounted at `/data`; the archived App Runner and
DynamoDB runbooks live in [`infra/README.md`](./README.md).

## One-time bootstrap

### 1. Create the Fly volume

`fly.toml` mounts a volume named `ruby_high_data` at `/data`, and
production sets `RUBY_HIGH_STATE_PATH=/data/ruby-high.db`.

```sh
flyctl volumes create ruby_high_data --app ruby-high --region iad --size 1
```

### 2. Configure optional portrait storage

AI portraits and diplomas can be stored externally instead of inline in
SQLite rows. Set `RUBY_HIGH_PORTRAITS_BUCKET` in `fly.toml` and provide
matching provider credentials only when that bucket is enabled. When no
bucket is configured, generated images stay inline and the server rejects
oversized image refs before persisting them.

### 3. Set the GitHub deploy token

Automatic production deploys run from
[`deploy-fly.yml`](../.github/workflows/deploy-fly.yml). Add a
repository secret named `FLY_API_TOKEN` with a Fly deploy token before
enabling push-to-main deploys.

```sh
flyctl auth token
```

PRs targeting `main` run typecheck, tests, and build. Merging to
`main` deploys `ruby-high` to Fly and then runs the production smoke
checks against `https://ruby-high.fly.dev`.

### 4. Deploy manually

```sh
flyctl deploy --app ruby-high
```

The first deploy builds the image, ships it to Fly's registry, and
boots one machine. Subsequent traffic-induced wake-ups reuse that
image until the next `flyctl deploy`.

### 5. Update the OpenRouter callback

In your OpenRouter settings, add `https://ruby-high.fly.dev/api/apps/ruby-high/auth/callback` to the allowed redirect URIs (or replace the existing App Runner one if you're cutting over rather than running both).

### 6. Configure Privy account sign-in

In the Privy dashboard, configure the Ruby High app for email login and embedded wallet creation. Add these app domains/origins:

- `https://ruby-high.fly.dev`
- `https://ruby-high.ai`
- `https://www.ruby-high.ai`
- `http://localhost:3000` for local development, preferably in a separate dev Privy app

Then set the app credentials on Fly:

```sh
flyctl secrets set --app ruby-high \
  RUBY_HIGH_PRIVY_APP_ID=<privy app id> \
  RUBY_HIGH_PRIVY_CLIENT_ID=<privy client id> \
  RUBY_HIGH_PRIVY_APP_SECRET=<privy app secret>
```

`RUBY_HIGH_PRIVY_APP_SECRET` is the preferred server verifier because the API can also fetch linked user/wallet details. `RUBY_HIGH_PRIVY_VERIFICATION_KEY` is supported as a fallback verifier, but the identity token then needs to include enough linked account detail for wallet display. The viewer defaults `RUBY_HIGH_PRIVY_LOGIN_METHODS` to `wallet`; every configured method must also be enabled in the Privy dashboard.

## Day-to-day

```sh
flyctl status --app ruby-high                  # is it up / sleeping
flyctl logs --app ruby-high                    # tail
flyctl deploy --app ruby-high                  # build + ship + roll
flyctl secrets list --app ruby-high            # what's set
flyctl secrets set --app ruby-high KEY=value   # update one
```

## What's set in fly.toml vs. as a secret

[Secrets, set via `flyctl secrets set`]

| Key | Why secret |
|---|---|
| `RUBY_HIGH_PUBLIC_BASE` | Tied to the deploy URL; staging vs. prod differ. |
| `RUBY_HIGH_PRIVY_APP_ID` / `RUBY_HIGH_PRIVY_CLIENT_ID` | Privy app identifiers; stored with secrets so staging/prod can differ without editing `fly.toml`. |
| `RUBY_HIGH_PRIVY_LOGIN_METHODS` | Optional public login-method allowlist, kept with the Privy app configuration. |
| `RUBY_HIGH_PRIVY_APP_SECRET` / `RUBY_HIGH_PRIVY_VERIFICATION_KEY` | Server-side Privy token verification. |
| `RUBY_HIGH_OPENROUTER_API_KEY` | Enables hosted AI Day Passes and hosted image generation. |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | Only needed when `RUBY_HIGH_PORTRAITS_BUCKET` points at S3. |
| `RUBY_HIGH_STRIPE_SECRET_KEY` / `RUBY_HIGH_STRIPE_WEBHOOK_SECRET` | Enables web Hall Pass checkout and webhook fulfillment. |
| `RUBY_HIGH_REVENUECAT_WEBHOOK_AUTH` | Enables mobile/IAP Hall Pass webhook fulfillment. |

[Env, set in `fly.toml [env]`]

| Key | Value |
|---|---|
| `PORT` | `8080` |
| `HOST` | `0.0.0.0` |
| `NODE_ENV` | `production` |
| `RUBY_HIGH_STORE_BACKEND` | `sqlite` |
| `RUBY_HIGH_STATE_PATH` | `/data/ruby-high.db` |
| `RUBY_HIGH_PORTRAITS_BUCKET` | Optional external image bucket. |
| `RUBY_HIGH_PORTRAITS_REGION` | Region for the optional external image bucket. |

## Cost sanity check

Fly machine config: `shared-cpu-1x` × 512 MB. With `min_machines_running = 0` and `auto_stop_machines = "stop"`:

- Idle (most of the day): $0.
- Active (player open in the app): ~$0.0000022/sec while running. A 30-min daily session per user = ~$0.004/user/day = ~$0.12/user/month before even touching the free tier.
- SQLite volume: roughly the cost of the smallest Fly volume, with local writes.

Roughly $0-2/month operating cost for this product as long as the user count stays small. Compare ~$50-65/month always-on for App Runner.

## App Runner Archive

The App Runner and DynamoDB deployment path is retained only for
historical reference in [`infra/README.md`](./README.md). Use
[`scripts/migrate-dynamo-to-sqlite.mjs`](../scripts/migrate-dynamo-to-sqlite.mjs)
when recovering an old DynamoDB export into the current SQLite store.
