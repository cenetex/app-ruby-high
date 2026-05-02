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
