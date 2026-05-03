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

The Fly app authenticates to DynamoDB with static access keys. Use a
dedicated IAM user with least-privilege scope (the policy in
[`iam-fly-policy.json`](./iam-fly-policy.json) only allows the four
operations the `DynamoStateStore` actually performs, on the one table).

```sh
aws iam create-user --user-name ruby-high-fly

aws iam put-user-policy \
  --user-name ruby-high-fly \
  --policy-name dynamodb-state \
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

### 3. Deploy

```sh
flyctl deploy --app ruby-high
```

The first deploy builds the image, ships it to Fly's registry, and
boots one machine. Subsequent traffic-induced wake-ups reuse that
image until the next `flyctl deploy`.

### 4. Update the OpenRouter callback

In your OpenRouter settings, add `https://ruby-high.fly.dev/api/apps/ruby-high/auth/callback` to the allowed redirect URIs (or replace the existing App Runner one if you're cutting over rather than running both).

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
