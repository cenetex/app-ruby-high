# Ruby High Landing

Static landing surface served at the root of `ruby-high.ai` by the runtime server (`scripts/server.mjs` → `scripts/landing.mjs`). The Fly app handles `/`, `/index.html`, and `/styles.css` from this directory. `/assets/*` is served from the repository's shared `assets/` tree; everything under `/api/apps/ruby-high/*` is the app itself.

Local preview:

```sh
PORT=3000 npm run dev:server
# then open http://localhost:3000/
```

Updating copy or assets:

- Edit `index.html` and `styles.css` here; edit shared images and fonts under `../assets/`.
- Bump the `?v=` cache-buster on `styles.css` when the stylesheet changes.
- Push to `main` — `deploy-fly.yml` ships it with the rest of the app.

The CTA links (`Attend today's class`, footer) stay same-origin so they work behind any host that points at the Fly app.

## Outreach

`/share` serves the public invitation kit with channel copy and downloadable
school artwork. Edit `share.html`, `share.css`, and `share.js` here. Bump their
cache versions when changing the assets. The default invitation remains
available when scripts are disabled; copy controls also support manual copy.

The server carries bounded `ref`, `rh_source`, `rh_campaign`, `rh_landing`,
and `rh_entry` values from public pages into every class link. Acquisition
values are normalized against the fixed vocabulary in
`src/services/acquisition-attribution.ts` when the viewer records its visit.
Share-kit links use the canonical public host and the `outreach-v1` campaign.

The rollout sequence and reporting guide live in
[`docs/MARKETING.md`](../docs/MARKETING.md).
