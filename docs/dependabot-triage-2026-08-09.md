# Dependabot triage — 2026-08-09

## Executive read

GitHub reported 35 open alerts before this pass. They were not 35 production
Ruby High web vulnerabilities:

- 2 alerts belonged to the root lockfile. The high alert was a build-only
  Socket.IO parser; the remaining low alert is an unpatched elliptic dependency
  in the optional Irys/Solana metadata-upload path.
- 3 alerts belonged to the ElizaOS plugin development lockfile. The plugin has
  one peer dependency at runtime and is not copied into the Fly production
  image.
- 30 alerts were duplicated across two frozen Python requirement sets for the
  offline `ruby2/visual-scene` artist tooling. That tooling is explicitly kept
  outside the web app build.

The Fly runtime is built with `npm ci --omit=dev`. A production-only audit now
has zero critical, high, or moderate advisories. It reports only the unpatched
elliptic chain described below.

## Remediated now

| Surface | Alert | Resolution |
| --- | --- | --- |
| Root build tooling | `socket.io-parser` memory exhaustion | Override to 4.2.7 |
| Root build tooling | `hono` request/response issues | Override to 4.12.34 |
| Root build tooling | `nanoid` zero-size generator loop | Override to 3.3.17 |
| ElizaOS plugin dev graph | PDF.js malicious-PDF code execution | Override to 6.2.108 |
| ElizaOS plugin dev graph | esbuild Windows dev-server file read | Override to 0.28.1 |
| ElizaOS plugin dev graph | brace-expansion and nanoid denial of service | Override to 5.0.9 and 3.3.17 |
| Offline visual-scene tooling | Pillow memory corruption, OOB, and decompression-bomb advisories | Pin Pillow 12.3.0 in both requirement sets |
| Offline visual-scene tooling | setuptools Unicode manifest exclusion bypass | Pin setuptools 83.0.0 in both requirement sets |

The Pillow 12.3.0 security release documents the repaired PDF, image,
font, and decompression paths: <https://pillow.readthedocs.io/en/stable/releasenotes/12.3.0.html>.

## Accepted and monitored

`elliptic` 6.6.1 remains in the production dependency graph through
`@irys/upload` / `@irys/upload-solana`. GitHub currently lists no patched
elliptic release for GHSA-848j-6mx2-7j84. Ruby High uses this chain only when
the server is configured to upload NFT image/metadata payloads through Irys;
ordinary viewer, course, auth, analytics, and class traffic does not call it.

This is low severity but genuinely production-shipped. Do not silence it. The
exit condition is an Irys release that removes the affected elliptic/Ethers v5
chain, or migration of metadata signing/upload to a maintained implementation.
Until then, keep Irys wallet secrets server-only, retain the existing bounded
payload validation, and rerun the production audit on every deploy.

The offline requirements still pin PyTorch 2.12.x. GHSA-rrmf-rvhw-rf47 is low
severity, requires use of `torch.jit.script`, and does not affect the deployed
web app. A move to PyTorch 2.13 must be paired with its supported torchvision
release and revalidated against Segment Anything; it is intentionally not
forced as an untested security-only upgrade in this pass.

The plugin development lockfile also retains `elliptic` 6.6.1 through
`@elizaos/core` → `crypto-browserify`. The plugin declares ElizaOS as a peer at
runtime and is not copied into the Fly image, so this is not an internet-facing
Ruby High dependency. It remains visible until the ElizaOS dependency graph
removes the affected package.

## Post-merge recalculation

GitHub recalculated the default branch after commit `ccbedc9`: 32 of the 35
alerts closed. The three remaining alerts are all low severity: root `elliptic`,
plugin-lockfile `elliptic`, and the offline PyTorch pin. These correspond to the
accepted-and-monitored cases above; no critical, high, or moderate Dependabot
alert remains open.

## Verification gates

- Root `npm run audit:prod`: zero critical/high/moderate advisories.
- Root full typecheck, tests, build, and production smoke must pass.
- The elizaOS plugin is no longer vendored here. Its dependency posture is
  gated in [`cenetex/plugin-ruby-high`](https://github.com/cenetex/plugin-ruby-high),
  which runs its own `npm run check` and publishes `@rati-osf/plugin-ruby-high`.
- Dependabot may take time after the commit lands to recalculate and close the
  corresponding GitHub alerts; repository alert count is not used as a proxy
  for the production image audit.
