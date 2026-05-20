import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { VIEWER_FRAME_ANCESTORS_DIRECTIVE } from "../viewer.js";
import {
  APP_ROUTE_PREFIX,
  ASSETS_PREFIX,
  MANIFEST_PATH,
  VIEWER_PATH,
} from "./constants.js";

const SERVICE_WORKER_CACHE = "ruby-high-pwa-v4";
const VIEWER_SECURITY_CSP_DIRECTIVES = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "form-action 'self'",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "font-src 'self' data:",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https: http://localhost:* http://127.0.0.1:* http://[::1]:* ws://localhost:* ws://127.0.0.1:* ws://[::1]:* wss:",
  "frame-src 'self' https: http://localhost:* http://127.0.0.1:* http://[::1]:*",
  VIEWER_FRAME_ANCESTORS_DIRECTIVE,
] as const;

const FIRST_BELL_PAGE_FILES = Object.fromEntries(
  Array.from({ length: 12 }, (_, index) => {
    const page = String(index + 1).padStart(2, "0");
    return [
      `comics/first-bell/page-${page}.jpg`,
      { file: `comics/first-bell/page-${page}.jpg`, mime: "image/jpeg" },
    ];
  }),
) as Record<string, { file: string; mime: string }>;

const NFT_CARD_IMAGE_IDS = [
  "lyra",
  "sami",
  "ravi",
  "indra",
  "mika",
  "noor",
  "ruby",
  "sally-science",
  "professor-edward",
  "captain-null",
  "eliza",
  "rati",
  "item-hall-pass",
  "item-flashcards",
  "item-library-card",
  "item-lab-flask",
  "item-lunch-tray",
  "item-notebook",
  "location-homeroom",
  "location-science-lab",
  "location-library",
  "location-cafeteria",
  "location-greenhouse",
  "location-courtyard",
] as const;

const NFT_CARD_IMAGE_FILES = Object.fromEntries(
  NFT_CARD_IMAGE_IDS.map((id) => [
    `nft/cards/${id}.png`,
    { file: `nft/cards/${id}.png`, mime: "image/png" },
  ]),
) as Record<string, { file: string; mime: string }>;

const ASSET_FILES: Record<string, { file: string; mime: string; source?: "assets" | "dist"; cacheControl?: string }> = {
  "privy-client.js": { file: "viewer-privy-client.js", mime: "text/javascript; charset=utf-8", source: "dist", cacheControl: "no-store" },
  "privy-client.global.js": { file: "viewer-privy-client.global.js", mime: "text/javascript; charset=utf-8", source: "dist", cacheControl: "no-store" },
  "logo.png": { file: "ruby-high-logo.png", mime: "image/png" },
  "ruby-high-logo.png": { file: "ruby-high-logo.png", mime: "image/png" },
  "nft/ruby-high-pack.png": { file: "nft/ruby-high-pack.png", mime: "image/png" },
  "nft/ruby-high-pack-promo.png": { file: "nft/ruby-high-pack-promo.png", mime: "image/png" },
  "nft/ruby-high-student-cards.png": { file: "nft/ruby-high-student-cards.png", mime: "image/png" },
  "nft/ruby-high-teacher-cards.png": { file: "nft/ruby-high-teacher-cards.png", mime: "image/png" },
  "nft/ruby-high-special-teacher-cards.png": { file: "nft/ruby-high-special-teacher-cards.png", mime: "image/png" },
  "nft/ruby-high-item-cards.png": { file: "nft/ruby-high-item-cards.png", mime: "image/png" },
  "nft/ruby-high-location-cards.png": { file: "nft/ruby-high-location-cards.png", mime: "image/png" },
  ...NFT_CARD_IMAGE_FILES,
  "ruby.png": { file: "ruby-classroom.png", mime: "image/png" },
  "welcome-hall-passes.png": { file: "welcome-hall-passes.png", mime: "image/png" },
  "teachers/ruby.png": { file: "teachers/ruby.png", mime: "image/png" },
  "teachers/ruby-sticker.png": { file: "teachers/ruby-sticker.png", mime: "image/png" },
  "teachers/sally-science.png": { file: "teachers/sally-science.png", mime: "image/png" },
  "teachers/sally-science-sticker.png": { file: "teachers/sally-science-sticker.png", mime: "image/png" },
  "teachers/professor-edward.png": { file: "teachers/professor-edward.png", mime: "image/png" },
  "teachers/professor-edward-sticker.png": { file: "teachers/professor-edward-sticker.png", mime: "image/png" },
  "teachers/ruby-face.png": { file: "teachers/ruby-face.png", mime: "image/png" },
  "teachers/ruby-face-sticker.png": { file: "teachers/ruby-face-sticker.png", mime: "image/png" },
  "teachers/ruby-full.png": { file: "teachers/ruby-full.png", mime: "image/png" },
  "teachers/ruby-full-sticker.png": { file: "teachers/ruby-full-sticker.png", mime: "image/png" },
  "teachers/sally-science-face.png": { file: "teachers/sally-science-face.png", mime: "image/png" },
  "teachers/sally-science-face-sticker.png": { file: "teachers/sally-science-face-sticker.png", mime: "image/png" },
  "teachers/sally-science-full.png": { file: "teachers/sally-science-full.png", mime: "image/png" },
  "teachers/sally-science-full-sticker.png": { file: "teachers/sally-science-full-sticker.png", mime: "image/png" },
  "teachers/professor-edward-face.png": { file: "teachers/professor-edward-face.png", mime: "image/png" },
  "teachers/professor-edward-face-sticker.png": { file: "teachers/professor-edward-face-sticker.png", mime: "image/png" },
  "teachers/professor-edward-full.png": { file: "teachers/professor-edward-full.png", mime: "image/png" },
  "teachers/professor-edward-full-sticker.png": { file: "teachers/professor-edward-full-sticker.png", mime: "image/png" },
  "students/lyra-face.png":  { file: "students/lyra-face.png",  mime: "image/png" },
  "students/lyra-full.png":  { file: "students/lyra-full.png",  mime: "image/png" },
  "students/sami-face.png":  { file: "students/sami-face.png",  mime: "image/png" },
  "students/sami-full.png":  { file: "students/sami-full.png",  mime: "image/png" },
  "students/ravi-face.png":  { file: "students/ravi-face.png",  mime: "image/png" },
  "students/ravi-full.png":  { file: "students/ravi-full.png",  mime: "image/png" },
  "students/indra-face.png": { file: "students/indra-face.png", mime: "image/png" },
  "students/indra-full.png": { file: "students/indra-full.png", mime: "image/png" },
  "students/mika-face.png":  { file: "students/mika-face.png",  mime: "image/png" },
  "students/mika-full.png":  { file: "students/mika-full.png",  mime: "image/png" },
  "students/noor-face.png":  { file: "students/noor-face.png",  mime: "image/png" },
  "students/noor-full.png":  { file: "students/noor-full.png",  mime: "image/png" },
  "fonts/caveat-regular.ttf": { file: "fonts/caveat-regular.ttf", mime: "font/ttf" },
  "fonts/crafty-girls-regular.ttf": { file: "fonts/crafty-girls-regular.ttf", mime: "font/ttf" },
  "fonts/give-you-glory-regular.ttf": { file: "fonts/give-you-glory-regular.ttf", mime: "font/ttf" },
  "fonts/schoolbell-regular.ttf": { file: "fonts/schoolbell-regular.ttf", mime: "font/ttf" },
  ...FIRST_BELL_PAGE_FILES,
};

const PWA_CORE_ASSET_NAMES = [
  "logo.png",
  "ruby.png",
  "fonts/caveat-regular.ttf",
  "fonts/crafty-girls-regular.ttf",
  "fonts/give-you-glory-regular.ttf",
  "fonts/schoolbell-regular.ttf",
] as const;

function headerIncludes(value: string | string[] | null | undefined, token: string): boolean {
  const needle = token.toLowerCase();
  const raw = Array.isArray(value) ? value.join(",") : (value ?? "");
  return raw
    .split(",")
    .some((part) => part.trim().toLowerCase().split(";", 1)[0] === needle);
}

export function sendHtmlResponse(
  res: unknown,
  html: string,
  acceptEncoding?: string | string[] | null,
): void {
  const response = res as {
    end: (body?: string | Buffer) => void;
    setHeader: (name: string, value: string) => void;
    statusCode: number;
    removeHeader?: (name: string) => void;
    getHeader?: (name: string) => number | string | string[] | undefined;
  };
  response.statusCode = 200;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.setHeader("Vary", "Accept-Encoding");
  response.removeHeader?.("X-Frame-Options");
  const existingCsp = response.getHeader?.("Content-Security-Policy");
  const normalized =
    typeof existingCsp === "string"
      ? existingCsp.trim()
      : Array.isArray(existingCsp)
        ? existingCsp.join("; ").trim()
        : "";
  response.setHeader("Content-Security-Policy", mergeViewerCsp(normalized));
  if (headerIncludes(acceptEncoding, "gzip")) {
    response.setHeader("Content-Encoding", "gzip");
    response.end(gzipSync(Buffer.from(html, "utf8"), { level: 6 }));
    return;
  }
  response.end(html);
}

function mergeViewerCsp(existing: string): string {
  const directives = existing
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
  const seen = new Set(directives.map((part) => part.split(/\s+/, 1)[0]?.toLowerCase()).filter(Boolean));
  for (const directive of VIEWER_SECURITY_CSP_DIRECTIVES) {
    const name = directive.split(/\s+/, 1)[0]?.toLowerCase();
    if (!name || seen.has(name)) continue;
    directives.push(directive);
    seen.add(name);
  }
  return directives.join("; ");
}

interface CachedAsset {
  body: Buffer;
  mime: string;
  etag: string;
}
const ASSET_CACHE = new Map<string, CachedAsset>();
const ASSET_LOAD_INFLIGHT = new Map<string, Promise<CachedAsset | null>>();

async function loadAsset(name: string): Promise<CachedAsset | null> {
  const cached = ASSET_CACHE.get(name);
  if (cached) return cached;
  const inflight = ASSET_LOAD_INFLIGHT.get(name);
  if (inflight) return inflight;
  const entry = ASSET_FILES[name];
  if (!entry) return null;
  const promise = (async () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const candidates = entry.source === "dist"
      ? [
          resolve(here, "..", entry.file),
          resolve(here, entry.file),
        ]
      : [
          resolve(here, "..", "..", "assets", entry.file),
          resolve(here, "..", "assets", entry.file),
        ];
    for (const path of candidates) {
      try {
        const body = await readFile(path);
        const etag = `"${createHash("sha1").update(body).digest("base64url").slice(0, 22)}"`;
        const record: CachedAsset = { body, mime: entry.mime, etag };
        ASSET_CACHE.set(name, record);
        return record;
      } catch {}
    }
    return null;
  })().finally(() => {
    ASSET_LOAD_INFLIGHT.delete(name);
  });
  ASSET_LOAD_INFLIGHT.set(name, promise);
  return promise;
}

export async function sendAsset(
  res: unknown,
  name: string,
  ifNoneMatch?: string | null,
  includeBody = true,
): Promise<boolean> {
  if (!(name in ASSET_FILES)) return false;
  const asset = await loadAsset(name);
  if (!asset) return false;
  const response = res as {
    end: (body?: Buffer) => void;
    setHeader: (name: string, value: string) => void;
    statusCode: number;
  };
  response.setHeader("Content-Type", asset.mime);
  response.setHeader("ETag", asset.etag);
  response.setHeader("Cache-Control", ASSET_FILES[name]?.cacheControl ?? "public, max-age=86400, stale-while-revalidate=604800");
  if (ifNoneMatch && ifNoneMatch === asset.etag) {
    response.statusCode = 304;
    response.end();
    return true;
  }
  response.statusCode = 200;
  response.end(includeBody ? asset.body : undefined);
  return true;
}

function renderPwaManifest(): Record<string, unknown> {
  return {
    name: "Ruby High",
    short_name: "Ruby High",
    description:
      "A school where the teachers grade you in their own voice. Clear daily classes, bank grades, and keep the yearbook.",
    id: `${APP_ROUTE_PREFIX}/`,
    start_url: VIEWER_PATH,
    scope: `${APP_ROUTE_PREFIX}/`,
    display: "standalone",
    background_color: "#15171f",
    theme_color: "#1a1c25",
    categories: ["education", "games"],
    icons: [
      {
        src: `${ASSETS_PREFIX}ruby.png`,
        sizes: "1280x1280",
        type: "image/png",
        purpose: "any",
      },
    ],
    shortcuts: [
      {
        name: "Open Ruby High",
        short_name: "Ruby High",
        url: VIEWER_PATH,
        icons: [
          {
            src: `${ASSETS_PREFIX}ruby.png`,
            sizes: "1280x1280",
            type: "image/png",
          },
        ],
      },
    ],
  };
}

export function sendManifest(res: unknown, includeBody = true): void {
  const response = res as {
    end: (body?: string | Buffer) => void;
    setHeader: (name: string, value: string) => void;
    statusCode: number;
  };
  response.statusCode = 200;
  response.setHeader("Content-Type", "application/manifest+json; charset=utf-8");
  response.setHeader("Cache-Control", "no-cache");
  response.end(includeBody ? JSON.stringify(renderPwaManifest(), null, 2) : undefined);
}

function renderServiceWorkerJs(): string {
  const coreUrls = [
    MANIFEST_PATH,
    ...PWA_CORE_ASSET_NAMES.map((name) => `${ASSETS_PREFIX}${name}`),
  ];
  return `/* Ruby High PWA service worker. Generated by src/routes/assets.ts. */
const CACHE_NAME = ${JSON.stringify(SERVICE_WORKER_CACHE)};
const APP_BASE = ${JSON.stringify(`${APP_ROUTE_PREFIX}/`)};
const VIEWER_PATH = ${JSON.stringify(VIEWER_PATH)};
const MANIFEST_PATH = ${JSON.stringify(MANIFEST_PATH)};
const ASSET_PREFIX = ${JSON.stringify(ASSETS_PREFIX)};
const CORE_URLS = ${JSON.stringify(coreUrls, null, 2)};

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(CORE_URLS.map(async (url) => {
      try {
        await cache.add(new Request(url, { cache: "reload" }));
      } catch (_err) {
        // A missing optional asset should not prevent installability.
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map((name) => (
      name === CACHE_NAME ? undefined : caches.delete(name)
    )));
    await self.clients.claim();
  })());
});

function isNetworkOnly(url) {
  return url.pathname === VIEWER_PATH
    || url.pathname.startsWith(APP_BASE + "auth/")
    || url.pathname.startsWith(APP_BASE + "chat/")
    || url.pathname.startsWith(APP_BASE + "packs/")
    || url.pathname.startsWith(APP_BASE + "session/")
    || url.pathname === ASSET_PREFIX + "privy-client.js"
    || url.pathname === ASSET_PREFIX + "privy-client.global.js";
}

async function putOk(cache, request, response) {
  if (!response || !response.ok) return;
  if ((response.headers.get("cache-control") || "").toLowerCase().includes("no-store")) return;
  try {
    await cache.put(request, response.clone());
  } catch (_err) {
    // Cache writes can fail under storage pressure; the network response still wins.
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, { ignoreSearch: true });
  const refresh = fetch(request)
    .then(async (response) => {
      await putOk(cache, request, response);
      return response;
    })
    .catch(() => null);
  return cached || await refresh || Response.error();
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(APP_BASE)) return;
  if (isNetworkOnly(url)) return;

  if (url.pathname === MANIFEST_PATH || url.pathname.startsWith(ASSET_PREFIX)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});
`;
}

export function sendServiceWorker(res: unknown, includeBody = true): void {
  const response = res as {
    end: (body?: string | Buffer) => void;
    setHeader: (name: string, value: string) => void;
    statusCode: number;
  };
  response.statusCode = 200;
  response.setHeader("Content-Type", "text/javascript; charset=utf-8");
  response.setHeader("Cache-Control", "no-cache");
  response.setHeader("Service-Worker-Allowed", `${APP_ROUTE_PREFIX}/`);
  response.end(includeBody ? renderServiceWorkerJs() : undefined);
}
