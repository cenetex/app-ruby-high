export interface RouteContext {
  method: string;
  pathname: string;
  url?: URL;
  runtime: unknown | null;
  res: unknown;
  error: (response: unknown, message: string, status?: number) => void;
  json: (response: unknown, data: unknown, status?: number) => void;
  readJsonBody: () => Promise<unknown>;
  /** Raw request body, required for signature-verified webhooks. */
  readRawBody?: () => Promise<string>;
  /** Raw incoming Cookie header. If absent, auth + chat features are unavailable but the rest of the app keeps working. */
  cookieHeader?: string | null;
  /** Raw User-Agent request header. Stored only in clipped durable metrics metadata. */
  userAgentHeader?: string | string[] | null;
  /** Raw browser-local visitor id header. Stored only after server-side hashing. */
  visitorHeader?: string | string[] | null;
  /** Raw value of the `X-Openrouter-Key` header, if the client sent one.
   *  This is the browser-owned OpenRouter API key. The viewer defaults to
   *  sessionStorage, honors localStorage only after explicit persistence
   *  opt-in, and attaches the key to same-origin LLM-touching requests. The
   *  server never persists it. */
  apiKeyHeader?: string | null;
  /** Builds an absolute callback URL for OAuth redirects. */
  callbackUrlBuilder?: (path: string) => string;
  /** True when the response is being served over HTTPS (controls Secure cookie flag). */
  isSecure?: boolean;
  /** Best-known client IP (x-forwarded-for or socket.remoteAddress). Used for
   *  rate limiting in the chat layer. Optional - when absent, rate limiting
   *  falls back to per-cookie keys only. */
  clientIp?: string | null;
  /** Request Content-Type. Mutation endpoints use this to reject non-JSON browser posts. */
  contentTypeHeader?: string | string[] | null;
  /** Raw Origin request header, when present. */
  originHeader?: string | string[] | null;
  /** Raw Authorization request header, when present. */
  authorizationHeader?: string | string[] | null;
  /** Raw Stripe-Signature request header, when present. */
  stripeSignatureHeader?: string | string[] | null;
  /** Raw If-None-Match request header. Static asset routes use it to return
   *  304 Not Modified when the client's cached ETag matches. Optional - if
   *  absent, assets always serve the full body (correct, just not cached). */
  ifNoneMatch?: string | null;
  /** Raw Last-Event-ID request header from EventSource reconnects. SSE
   *  routes use it to resume after the last event a browser observed. */
  lastEventIdHeader?: string | string[] | null;
  /** Raw Accept-Encoding request header. Used to compress large viewer HTML. */
  acceptEncoding?: string | string[] | null;
}
