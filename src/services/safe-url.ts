import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";

export interface SafeImageAddress {
  address: string;
  family: 4 | 6;
}

export type SafeImageLookup = (hostname: string) => Promise<SafeImageAddress[]>;
export type SafeImageRequest = (
  url: URL,
  address: SafeImageAddress,
  signal: AbortSignal,
) => Promise<Response>;

export interface SafeImageFetchOptions {
  maxBytes?: number;
  maxRedirects?: number;
  timeoutMs?: number;
  lookup?: SafeImageLookup;
  request?: SafeImageRequest;
}

/** True when the address is private, loopback, link-local, or reserved. */
export function isBlockedAddress(address: string): boolean {
  const v = isIP(address);
  if (v === 4) {
    const parts = address.split(".").map((part) => Number(part));
    const [a = 0, b = 0, c = 0] = parts;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    );
  }
  if (v === 6) {
    const normalized = address.toLowerCase();
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped?.[1]) return isBlockedAddress(mapped[1]);
    return (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      /^fe[89ab]/.test(normalized) ||
      normalized.startsWith("ff") ||
      normalized === "2001:db8::" ||
      normalized.startsWith("2001:db8:")
    );
  }
  return true;
}

/** Validate an image URL is safe to fetch: https-only, no localhost,
 *  and the resolved IPs are not private/loopback/link-local. */
async function defaultSafeImageLookup(hostname: string): Promise<SafeImageAddress[]> {
  if (isIP(hostname)) {
    return [{ address: hostname, family: isIP(hostname) as 4 | 6 }];
  }
  return (await lookup(hostname, { all: true, verbatim: true }))
    .filter((entry): entry is SafeImageAddress => entry.family === 4 || entry.family === 6)
    .map((entry) => ({ address: entry.address, family: entry.family }));
}

async function resolveSafeImageUrl(raw: string, resolver: SafeImageLookup): Promise<{
  url: URL;
  address: SafeImageAddress;
}> {
  const url = new URL(raw);
  if (url.protocol !== "https:") {
    throw new Error("Image URL must use https");
  }
  if (url.username || url.password) throw new Error("Image URL credentials are not allowed.");
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!hostname) throw new Error("Image URL has no hostname");
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("Image URL host is not allowed.");
  }

  let addresses: SafeImageAddress[];
  try {
    addresses = await resolver(hostname);
  } catch {
    throw new Error("Image URL host could not be resolved.");
  }
  if (addresses.length === 0 || addresses.some((entry) => isBlockedAddress(entry.address))) {
    throw new Error("Image URL host resolves to a private or reserved address.");
  }
  return { url, address: addresses[0]! };
}

/** Validate an image URL without downloading it. */
export async function assertSafeImageUrl(raw: string): Promise<void> {
  await resolveSafeImageUrl(raw, defaultSafeImageLookup);
}

async function requestPinnedImage(
  url: URL,
  address: SafeImageAddress,
  signal: AbortSignal,
): Promise<Response> {
  return await new Promise<Response>((resolve, reject) => {
    const req = request(url, {
      method: "GET",
      headers: { Accept: "image/*" },
      signal,
      family: address.family,
      // TLS still validates against url.hostname, but the socket cannot run a
      // second DNS lookup and switch to an unvalidated address.
      lookup: ((_hostname: string, _options: unknown, callback: (
        error: NodeJS.ErrnoException | null,
        resolvedAddress: string,
        family: number,
      ) => void) => callback(null, address.address, address.family)) as never,
    }, (incoming) => {
      const headers = new Headers();
      for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
        const name = incoming.rawHeaders[index];
        const value = incoming.rawHeaders[index + 1];
        if (name && value != null) headers.append(name, value);
      }
      const status = incoming.statusCode ?? 502;
      const bodyAllowed = status !== 204 && status !== 205 && status !== 304;
      if (!bodyAllowed) incoming.resume();
      resolve(new Response(
        bodyAllowed ? Readable.toWeb(incoming) as ReadableStream<Uint8Array> : null,
        { status, statusText: incoming.statusMessage, headers },
      ));
    });
    req.once("error", reject);
    req.end();
  });
}

async function discardResponse(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

async function readLimitedImageResponse(response: Response, maxBytes: number): Promise<Buffer> {
  const declaredLength = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await discardResponse(response);
    throw new Error("Remote image is too large.");
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error("Remote image is too large.");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

/** Fetch a bounded image over a DNS-pinned HTTPS connection. */
export async function fetchSafeImageBuffer(raw: string, options: SafeImageFetchOptions = {}): Promise<Buffer> {
  const maxBytes = Math.max(1, Math.floor(options.maxBytes ?? 10 * 1024 * 1024));
  const maxRedirects = Math.max(0, Math.floor(options.maxRedirects ?? 3));
  const timeoutMs = Math.max(1, Math.floor(options.timeoutMs ?? 15_000));
  const resolver = options.lookup ?? defaultSafeImageLookup;
  const requester = options.request ?? requestPinnedImage;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let current = raw;
    for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
      const resolved = await resolveSafeImageUrl(current, resolver);
      const response = await requester(resolved.url, resolved.address, controller.signal);
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (redirects >= maxRedirects) {
          await discardResponse(response);
          throw new Error("Image URL redirected too many times.");
        }
        const location = response.headers.get("location")?.trim();
        await discardResponse(response);
        if (!location) throw new Error("Image URL redirected without a location.");
        current = new URL(location, resolved.url).toString();
        continue;
      }
      if (!response.ok) {
        await discardResponse(response);
        throw new Error(`Failed to fetch image: ${response.status}`);
      }
      return await readLimitedImageResponse(response, maxBytes);
    }
    throw new Error("Image URL redirected too many times.");
  } finally {
    clearTimeout(timeout);
  }
}
