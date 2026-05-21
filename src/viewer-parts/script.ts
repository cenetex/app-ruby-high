import type { ViewerRenderOptions } from "../viewer.js";
import { createViewerApiClient, withViewerTimeoutSignal } from "./api.js";
import { consumeViewerSseStream, parseViewerSseFrames } from "./sse.js";
import { createViewerTurnController } from "./turn-controller.js";
import { runViewerClient } from "./client.js";

// Returns the SPA viewer's inline JS as a string. The heavy browser client
// lives in client.ts as real JavaScript, then gets serialized here so Ruby
// High can keep the current no-extra-asset viewer delivery path.
export function viewerScript(opts: ViewerRenderOptions): string {
  const role = opts.role === "agent" ? "agent" : "human";
  const bootstrap = scriptJson({
    apiBase: opts.apiBase,
    sessionId: opts.sessionId,
    role,
    build: opts.build ?? "dev",
    privyConfig: opts.privy
      ? { appId: opts.privy.appId, clientId: opts.privy.clientId, loginMethods: opts.privy.loginMethods }
      : null,
  });

  return `
(() => {
  const bootstrap = ${bootstrap};
  const withViewerTimeoutSignal = ${withViewerTimeoutSignal.toString()};
  const createViewerApiClient = ${createViewerApiClient.toString()};
  const createViewerTurnController = ${createViewerTurnController.toString()};
  const parseViewerSseFrames = ${parseViewerSseFrames.toString()};
  const consumeViewerSseStream = ${consumeViewerSseStream.toString()};
  const runViewerClient = ${runViewerClient.toString()};
  runViewerClient(bootstrap);
})();`;
}

function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/<\//g, "<\\/");
}
