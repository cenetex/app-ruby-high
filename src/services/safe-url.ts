import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

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
export async function assertSafeImageUrl(raw: string): Promise<void> {
  const url = new URL(raw);
  if (url.protocol !== "https:") {
    throw new Error("Image URL must use https");
  }
  const hostname = url.hostname.toLowerCase();
  if (!hostname) throw new Error("Image URL has no hostname");
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("Image URL host is not allowed.");
  }

  let addresses: string[];
  try {
    addresses = isIP(hostname)
      ? [hostname]
      : (await lookup(hostname, { all: true, verbatim: false })).map((e) => e.address);
  } catch {
    throw new Error("Image URL host could not be resolved.");
  }
  if (addresses.length === 0 || addresses.some(isBlockedAddress)) {
    throw new Error("Image URL host resolves to a private or reserved address.");
  }
}
