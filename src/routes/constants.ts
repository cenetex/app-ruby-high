export const APP_NAME = "@cenetex/app-ruby-high";
export const APP_DISPLAY_NAME = "Ruby High";
export const APP_ROUTE_PREFIX = "/api/apps/ruby-high";
export const VIEWER_PATH = `${APP_ROUTE_PREFIX}/viewer`;
export const ASSETS_PREFIX = `${APP_ROUTE_PREFIX}/assets/`;
export const MANIFEST_PATH = `${APP_ROUTE_PREFIX}/manifest.webmanifest`;
export const SERVICE_WORKER_PATH = `${APP_ROUTE_PREFIX}/service-worker.js`;
export const BUG_REPORT_PATH = `${APP_ROUTE_PREFIX}/bug-report`;

// X (Twitter) social integration — per-teacher OAuth 2.0 PKCE
export const X_SOCIAL_PREFIX = `${APP_ROUTE_PREFIX}/x`;
export const X_SOCIAL_CONNECT_PATH = `${X_SOCIAL_PREFIX}/connect`;
export const X_SOCIAL_CALLBACK_PATH = `${X_SOCIAL_PREFIX}/callback`;
