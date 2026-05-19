# Ruby High Landing

Static Cloudflare Pages surface for `rubyhighai.com`.

Local preview:

```sh
RUBY_HIGH_LANDING_HOSTS=localhost PORT=4175 npm run dev:server
```

Cloudflare Pages:

- Project root/output directory: `landing`
- Build command: none
- Runtime app CTA: `https://ruby-high.ai/api/apps/ruby-high/viewer`

Keep app runtime, auth, billing, and API traffic on `ruby-high.ai`. The `_redirects` file forwards old Ruby High app paths from the landing domain to the runtime domain during the compatibility window.
