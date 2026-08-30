import { viewerBootstrapScript } from "./viewer-parts/bootstrap.js";
import { viewerHtmlBody } from "./viewer-parts/html.js";

export const VIEWER_FRAME_ANCESTORS_DIRECTIVE =
  "frame-ancestors 'self' http://localhost:* http://127.0.0.1:* " +
  "https://localhost:* https://127.0.0.1:*";

export interface ViewerRenderOptions {
  agentName: string;
  sessionId: string;
  apiBase: string;
  role: "agent" | "human";
  build?: string;
  privy?: {
    appId: string;
    clientId: string;
    loginMethods?: string[];
  };
}

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
  const build = (opts.build ?? "dev").trim();
  const assetVersion = build && build !== "dev" ? `?v=${encodeURIComponent(build)}` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#1a1c25" />
<meta name="application-name" content="Ruby High" />
<meta name="mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-title" content="Ruby High" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<link rel="manifest" href="${safeApiBase}/manifest.webmanifest" />
<link rel="icon" type="image/webp" href="${safeApiBase}/assets/optimized/ruby-high-app-icon.webp${assetVersion}" />
<link rel="apple-touch-icon" href="${safeApiBase}/assets/optimized/ruby-high-app-icon.webp${assetVersion}" />
<link rel="stylesheet" href="${safeApiBase}/assets/viewer.css${assetVersion}" />
<title>Ruby High — ${safeAgent}</title>
</head>
<body>
${viewerHtmlBody(opts)}
<script>${viewerBootstrapScript(opts)}</script>
<script src="${safeApiBase}/assets/viewer-client.js${assetVersion}" defer></script>
</body>
</html>`;
}
