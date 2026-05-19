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

This keeps the existing `rubyhighai.com` DNS untouched. During the compatibility window, both the old domain and the new domain can point at the same Fly app.

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

DNS does not perform HTTP forwarding. Use Cloudflare Redirect Rules for host canonicalization:

| Rule | When incoming request matches | Redirect target |
|---|---|---|
| `www to apex` | Hostname equals `www.ruby-high.ai` | `https://ruby-high.ai${uri.path_and_query}` |

When ready to make the old domain canonical, add equivalent redirect rules in the existing `rubyhighai.com` Cloudflare zone:

| Rule | When incoming request matches | Redirect target |
|---|---|---|
| `old apex to new apex` | Hostname equals `rubyhighai.com` | `https://ruby-high.ai${uri.path_and_query}` |
| `old www to new apex` | Hostname equals `www.rubyhighai.com` | `https://ruby-high.ai${uri.path_and_query}` |

Do not add the old-domain redirect rules until the app has accepted `ruby-high.ai` as `RUBY_HIGH_PUBLIC_BASE` and OpenRouter/Privy callback origins include the new host.
