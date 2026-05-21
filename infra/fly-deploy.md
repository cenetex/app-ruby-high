# Ruby High — Fly.io deploy

Fly.io is the (cheaper) alternative deploy target alongside the AWS App
Runner runbook in [`README.md`](./README.md). It's the cost-engineering
move for this app: scales to zero on idle, ~300-500ms cold start, same
Docker image, free tier covers the daily-cadence traffic profile.

The app config lives at [`fly.toml`](../fly.toml). State still lives in
the same DynamoDB table that App Runner uses (`ruby-high-state` in
`us-east-1`); the Fly machine reaches AWS over the open internet.

## One-time bootstrap

### 1. Create the dedicated IAM user

The Fly app authenticates to AWS with static access keys. Use a
dedicated IAM user with least-privilege scope (the policy in
[`iam-fly-policy.json`](./iam-fly-policy.json) allows the DynamoDB
operations the `DynamoStateStore` performs on the one
state table, plus `s3:PutObject` on the portraits bucket).

```sh
# Bucket for AI-generated character portraits + diplomas. Their bytes
# are too big to live inline in the DynamoDB character record; a
# single AI portrait can be 200KB-1MB and DDB caps items at 400KB.
aws s3api create-bucket --bucket ruby-high-portraits --region us-east-1

# Allow a bucket policy to grant public read (without disabling
# account-level Block Public Access). Keep ACLs blocked — we don't
# use them; only the bucket policy grants access.
aws s3api put-public-access-block \
  --bucket ruby-high-portraits \
  --public-access-block-configuration \
    'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=false,RestrictPublicBuckets=false'

# Bucket policy: public-read on /portrait/* and /diploma/* only.
cat > /tmp/ruby-high-portraits-policy.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    { "Sid": "PublicReadPortraits", "Effect": "Allow", "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": [
        "arn:aws:s3:::ruby-high-portraits/portrait/*",
        "arn:aws:s3:::ruby-high-portraits/diploma/*"
      ]
    }
  ]
}
EOF
aws s3api put-bucket-policy --bucket ruby-high-portraits \
  --policy file:///tmp/ruby-high-portraits-policy.json

# IAM user + inline policy.
aws iam create-user --user-name ruby-high-fly

aws iam put-user-policy \
  --user-name ruby-high-fly \
  --policy-name ruby-high-fly \
  --policy-document file://infra/iam-fly-policy.json

aws iam create-access-key --user-name ruby-high-fly \
  --query 'AccessKey.{id:AccessKeyId,secret:SecretAccessKey}' \
  --output json
```

The last command prints `{"id": "AKIA...", "secret": "..."}` once. Save
those for step 2; they cannot be retrieved later.

### 2. Set the AWS secrets on Fly

```sh
flyctl secrets set --app ruby-high \
  AWS_ACCESS_KEY_ID=<id from step 1> \
  AWS_SECRET_ACCESS_KEY=<secret from step 1>
```

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
- `https://rubyhighai.com`
- `https://www.rubyhighai.com`
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
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | Credentials. |
| `RUBY_HIGH_DYNAMO_TABLE` | Not strictly secret, but tied to the AWS environment so it lives with the AWS creds. |
| `RUBY_HIGH_PUBLIC_BASE` | Tied to the deploy URL; staging vs. prod differ. |
| `RUBY_HIGH_PRIVY_APP_ID` / `RUBY_HIGH_PRIVY_CLIENT_ID` | Privy app identifiers; stored with secrets so staging/prod can differ without editing `fly.toml`. |
| `RUBY_HIGH_PRIVY_LOGIN_METHODS` | Optional public login-method allowlist, kept with the Privy app configuration. |
| `RUBY_HIGH_PRIVY_APP_SECRET` / `RUBY_HIGH_PRIVY_VERIFICATION_KEY` | Server-side Privy token verification. |
| `RUBY_HIGH_OPENROUTER_API_KEY` | Enables hosted AI Day Passes and hosted image generation. |
| `RUBY_HIGH_STRIPE_SECRET_KEY` / `RUBY_HIGH_STRIPE_WEBHOOK_SECRET` | Enables web Hall Pass checkout and webhook fulfillment. |
| `RUBY_HIGH_REVENUECAT_WEBHOOK_AUTH` | Enables mobile/IAP Hall Pass webhook fulfillment. |

[Env, set in `fly.toml [env]`]

| Key | Value |
|---|---|
| `PORT` | `8080` |
| `HOST` | `0.0.0.0` |
| `NODE_ENV` | `production` |
| `RUBY_HIGH_STORE_BACKEND` | `dynamodb` |
| `AWS_REGION` | `us-east-1` |

## Cost sanity check

Fly machine config: `shared-cpu-1x` × 512 MB. With `min_machines_running = 0` and `auto_stop_machines = "stop"`:

- Idle (most of the day): $0.
- Active (player open in the app): ~$0.0000022/sec while running. A 30-min daily session per user = ~$0.004/user/day = ~$0.12/user/month before even touching the free tier.
- DynamoDB on-demand: pennies a month at this traffic.

Roughly $0-2/month operating cost for this product as long as the user count stays small. Compare ~$50-65/month always-on for App Runner.

## Cutover from App Runner

The two deploys can run side-by-side. Steps to make Fly the primary:

1. Verify Fly is healthy at `https://ruby-high.fly.dev/health`.
2. Update OpenRouter redirect URI to point at Fly.
3. (Optional) Move custom DNS record to Fly.
4. Stop the App Runner service via the console or `aws apprunner pause-service`.

The DynamoDB table is shared, so player state survives the cutover —
sessions opened on App Runner can keep playing on Fly without any
data migration.
