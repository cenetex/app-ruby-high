# Ruby High Landing

Static landing surface served at the root of `ruby-high.ai` by the runtime server (`scripts/server.mjs` → `scripts/landing.mjs`). The Fly app handles `/`, `/index.html`, `/styles.css`, and `/assets/*` from this directory; everything under `/api/apps/ruby-high/*` is the app itself.

Local preview:

```sh
PORT=3000 npm run dev:server
# then open http://localhost:3000/
```

Updating copy or assets:

- Edit `index.html` / `styles.css` / `assets/*` in place.
- Bump the `?v=` cache-buster on `styles.css` when the stylesheet changes.
- Push to `main` — `deploy-fly.yml` ships it with the rest of the app.

The CTA links (`Attend today's class`, footer) stay same-origin so they work behind any host that points at the Fly app.
