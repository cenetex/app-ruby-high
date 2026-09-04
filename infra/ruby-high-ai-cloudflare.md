# ruby-high.ai Cloudflare Setup

## DNS Import

Import [`cloudflare-ruby-high-ai.zone`](./cloudflare-ruby-high-ai.zone) into the `ruby-high.ai` Cloudflare zone.

The records point the new apex and `www` host at the current Fly app:

| Name | Type | Target |
|---|---|---|
| `ruby-high.ai` | `A` | `66.241.124.163` |
| `ruby-high.ai` | `AAAA` | `2a09:8280:1::110:305:0` |
| `www.ruby-high.ai` | `A` | `66.241.124.163` |
| `www.ruby-high.ai` | `AAAA` | `2a09:8280:1::110:305:0` |
| `_fly-ownership.ruby-high.ai` | `TXT` | `app-56xn59q` |
| `_fly-ownership.www.ruby-high.ai` | `TXT` | `app-56xn59q` |
| `_acme-challenge.ruby-high.ai` | `CNAME` | `ruby-high.ai.56xn59q.flydns.net` |
| `_acme-challenge.www.ruby-high.ai` | `CNAME` | `www.ruby-high.ai.56xn59q.flydns.net` |

`rubyhighai.com` is no longer under our control and is treated as dead — do not depend on it for anything. `ruby-high.ai` is the canonical host and serves both the landing page (at `/`) and the runtime app (under `/api/apps/ruby-high/*`).

Cloudflare DNS imports do not encode the orange-cloud proxy state. After import, leave the A/AAAA records DNS-only while Fly certificate issuance is being checked, then switch `ruby-high.ai` and `www.ruby-high.ai` to **Proxied** if you want Cloudflare Redirect Rules, WAF, or cache controls to run at the edge. Keep the `_fly-ownership` TXT records if Cloudflare proxying is enabled.

## Fly Certificates

After the DNS import, ask Fly to issue certificates for both hosts:

```sh
flyctl certs create ruby-high.ai --app ruby-high
flyctl certs create www.ruby-high.ai --app ruby-high
flyctl certs show ruby-high.ai --app ruby-high
flyctl certs show www.ruby-high.ai --app ruby-high
```

The import file already includes the ACME CNAME and ownership TXT records returned by `flyctl certs setup` on 2026-05-19. If Fly returns different validation records later, replace these with the exact current values before retrying the certificate check.

## Forwarding

The Ruby High server sends a permanent `308` redirect from alternate public hosts to `https://ruby-high.ai`. It preserves the path and query string. Health checks remain available on the Fly host.

You can also use a Cloudflare Redirect Rule for an earlier edge redirect:

| Rule | When incoming request matches | Redirect target |
|---|---|---|
| `www to apex` | Hostname equals `www.ruby-high.ai` | `https://ruby-high.ai${uri.path_and_query}` |
