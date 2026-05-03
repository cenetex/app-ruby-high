# Ruby High — AWS deploy infra

The GHA workflow at `.github/workflows/deploy.yml` builds the Docker image,
pushes it to ECR (`022118847419.dkr.ecr.us-east-1.amazonaws.com/ruby-high`),
and triggers App Runner to roll the new image. It assumes role
`arn:aws:iam::022118847419:role/github-actions-ruby-high` via OIDC.

## One-time IAM setup

Run these once (admin creds required) to create the OIDC role the workflow assumes:

```sh
aws iam create-role \
  --role-name github-actions-ruby-high \
  --assume-role-policy-document file://infra/iam-trust-policy.json \
  --description "GHA OIDC role for cenetex/app-ruby-high — pushes ECR images and deploys App Runner."

aws iam put-role-policy \
  --role-name github-actions-ruby-high \
  --policy-name ruby-high-deploy \
  --policy-document file://infra/iam-deploy-policy.json
```

Trust scope: `cenetex/app-ruby-high` on `refs/heads/main`, any `v*` tag, or
the `production` environment. Update `infra/iam-trust-policy.json` and
re-`update-assume-role-policy` to broaden.

The OIDC provider (`token.actions.githubusercontent.com`) is already
registered in account `022118847419` — same one used by `aws-swarm-github-actions`
and the other repo-scoped roles.

## Existing infrastructure

- **ECR repo:** `ruby-high` (`022118847419.dkr.ecr.us-east-1.amazonaws.com/ruby-high`)
- **App Runner service:** `ruby-high` — `arn:aws:apprunner:us-east-1:022118847419:service/ruby-high/db79290276f34aa8b93b853f9ea4a9f9`
- **Public URL:** https://cigheyunk9.us-east-1.awsapprunner.com
- **Image-pull role for App Runner:** `AppRunnerECRAccessRole` (already exists; the workflow passes it on each update)

## State storage backends

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

### Schema (managed by the workflow)

- Primary key: `pk` (string) — the session id (`rh:user:<token>` or `rh:anonymous`).
- TTL attribute: `expiresAt` (seconds-since-epoch; the store writes this).
- Billing: on-demand (the app's traffic is bursty, items are 5–20 KB).

### Production bootstrap (one-time)

The deploy workflow skips all DynamoDB work by default — it only provisions
the table and configures App Runner to use it when the
`RUBY_HIGH_STORE_BACKEND` repo Variable is set to `dynamodb`. To turn
DynamoDB on, do this once **in this order** (steps 1–3 must precede step 4,
otherwise the deploy fails on the first IAM check):

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

**2. Grant the App Runner instance role permission to use the table.**
The instance role is the one App Runner runs the container as (separate
from the ECR access role). Add to its policy:

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

**3. Flip the workflow to use it.** In the repo Settings → Secrets and
variables → Actions → Variables tab, add:

| Variable | Value |
|---|---|
| `RUBY_HIGH_STORE_BACKEND` | `dynamodb` |
| `RUBY_HIGH_DYNAMO_TABLE` | `ruby-high-state` (or whatever you named it) |
| `RUBY_HIGH_PUBLIC_BASE` | `https://your-app-runner-url` (used for OpenRouter PKCE callback) |

**4. Run the deploy.** On the first run with the variable set, the workflow
creates the table (using the IAM grant from step 1), then updates App
Runner with the DynamoDB env vars (which the instance role from step 2
authorizes at runtime). Subsequent deploys are no-ops on the table side
(idempotent DescribeTable check).

Why this ordering: the table-create step and the App Runner env-var step
are both gated on the same repo Variable, so they happen together. If you
flip the variable before the IAM grants are in place, the deploy fails
loudly at the first AWS API call rather than silently misconfiguring.

## Production caveats

- **JSON backend is per-container-lifetime only.** Use the DynamoDB backend in production. The default JSON-file path is fine for local dev.
- **API keys still live in process memory.** A redeploy or VM restart wipes authenticated sessions; users sign in again. Migrating these to DynamoDB is a separate, smaller PR.
- **Rate limiting is in place** for LLM-burning endpoints (60/min per `(ip, cookie)` for chat; 8 burst, 1 per 30s for portrait gen). Auth endpoints are unbounded by design — keep an eye on them.

## Manual deploy (without GHA)

```sh
docker buildx build --platform linux/amd64 \
  -t 022118847419.dkr.ecr.us-east-1.amazonaws.com/ruby-high:vX.Y.Z \
  -t 022118847419.dkr.ecr.us-east-1.amazonaws.com/ruby-high:latest \
  --push .

aws apprunner update-service \
  --service-arn arn:aws:apprunner:us-east-1:022118847419:service/ruby-high/db79290276f34aa8b93b853f9ea4a9f9 \
  --source-configuration '{"ImageRepository":{"ImageIdentifier":"022118847419.dkr.ecr.us-east-1.amazonaws.com/ruby-high:vX.Y.Z","ImageRepositoryType":"ECR","ImageConfiguration":{"Port":"8080","RuntimeEnvironmentVariables":{"NODE_ENV":"production"}}},"AutoDeploymentsEnabled":false,"AuthenticationConfiguration":{"AccessRoleArn":"arn:aws:iam::022118847419:role/AppRunnerECRAccessRole"}}' \
  --region us-east-1
```
