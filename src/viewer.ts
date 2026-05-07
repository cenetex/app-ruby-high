// SPA viewer assembler. The viewer used to be a single ~3700-line file
// that bundled HTML, CSS, and JS as one giant template literal. It now
// lives in three focused modules under src/viewer-parts/, and this file
// is the thin frame that stitches them into the final HTML page.
//
// Public surface (kept stable for routes.ts):
//   - renderViewerHtml(opts)
//   - VIEWER_FRAME_ANCESTORS_DIRECTIVE
//   - ViewerRenderOptions
//
// To touch the viewer:
//   - styling → src/viewer-parts/css.ts
//   - structure → src/viewer-parts/html.ts
//   - behavior → src/viewer-parts/script.ts

const VIEWER_FRAME_ANCESTORS_DIRECTIVE =
  "frame-ancestors 'self' http://localhost:* http://127.0.0.1:* " +
  "http://[::1]:* http://[0:0:0:0:0:0:0:1]:* https://localhost:* " +
  "https://127.0.0.1:* https://[::1]:* https://[0:0:0:0:0:0:0:1]:* " +
  "electrobun: capacitor: capacitor-electron: app: tauri: file:";

export { VIEWER_FRAME_ANCESTORS_DIRECTIVE };

export interface ViewerRenderOptions {
  agentName: string;
  sessionId: string;
  apiBase: string;
  role: "agent" | "human";
}

import { VIEWER_CSS } from "./viewer-parts/css.js";
import { viewerHtmlBody } from "./viewer-parts/html.js";
import { viewerScript } from "./viewer-parts/script.js";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderViewerHtml(opts: ViewerRenderOptions): string {
  const safeAgent = escapeHtml(opts.agentName);
  const safeApiBase = escapeHtml(opts.apiBase.replace(/\/$/, ""));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover, user-scalable=no" />
<meta name="theme-color" content="#1a1c25" />
<meta name="application-name" content="Ruby High" />
<meta name="mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-title" content="Ruby High" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<link rel="manifest" href="${safeApiBase}/manifest.webmanifest" />
<link rel="apple-touch-icon" href="${safeApiBase}/assets/ruby.png" />
<title>Ruby High — ${safeAgent}</title>
<style>${VIEWER_CSS}</style>
</head>
<body>
${viewerHtmlBody(opts)}
<script>${viewerScript(opts)}</script>
</body>
</html>`;
}
