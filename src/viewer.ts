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

import { VIEWER_CSS } from "./viewer-parts/css.js";
import { viewerClientScript } from "./viewer-parts/script.js";

export {
  renderViewerHtml,
  VIEWER_FRAME_ANCESTORS_DIRECTIVE,
  type ViewerRenderOptions,
} from "./viewer-shell.js";

export function renderViewerCss(): string {
  return VIEWER_CSS;
}

export function renderViewerClientScript(): string {
  return viewerClientScript();
}
