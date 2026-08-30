import type { ViewerRenderOptions } from "../viewer-shell.js";

export function viewerBootstrapScript(opts: ViewerRenderOptions): string {
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
  return `window.__RUBY_HIGH_BOOTSTRAP__ = ${bootstrap};`;
}

function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/<\//g, "<\\/");
}
