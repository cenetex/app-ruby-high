import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { log } from "./logger.js";

const DEFAULT_PUBLIC_BASE = "http://localhost:3000";
const GENERATED_PORTRAIT_CACHE_CONTROL = "public, max-age=31536000, immutable";
const GENERATED_PORTRAIT_BUCKET_FALLBACK = "ruby-high-portraits";

export type GeneratedPortraitKind = "portrait" | "diploma" | "graduation-photo";

export interface GeneratedPortraitAsset {
  body: Buffer;
  mime: string;
  etag: string;
  cacheControl: string;
}

type GeneratedPortraitAssetLoader = (name: string) => Promise<GeneratedPortraitAsset | null>;

const GENERATED_PORTRAIT_KINDS = new Set<GeneratedPortraitKind>([
  "portrait",
  "diploma",
  "graduation-photo",
]);
const GENERATED_PORTRAIT_KEY_RE = /^(portrait|diploma|graduation-photo)\/([a-f0-9]{32})\.(png|jpg|webp)$/;

let portraitS3Client: S3Client | null = null;
let generatedPortraitAssetLoaderOverride: GeneratedPortraitAssetLoader | null = null;

export function publicBaseUrl(): string {
  const raw = (
    process.env.RUBY_HIGH_PUBLIC_BASE?.trim()
    || process.env.RUBY_HIGH_PUBLIC_BASE_URL?.trim()
    || DEFAULT_PUBLIC_BASE
  );
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString().replace(/\/+$/, "");
    }
  } catch {
    // Fall through to the local dev default.
  }
  return DEFAULT_PUBLIC_BASE;
}

function getPortraitS3Client(): S3Client | null {
  const bucket = process.env.RUBY_HIGH_PORTRAITS_BUCKET;
  if (!bucket) return null;
  if (portraitS3Client) return portraitS3Client;
  portraitS3Client = new S3Client({
    region: process.env.RUBY_HIGH_PORTRAITS_REGION ?? process.env.AWS_REGION ?? "us-east-1",
    ...(process.env.AWS_ENDPOINT_URL_S3 ? { endpoint: process.env.AWS_ENDPOINT_URL_S3, forcePathStyle: true } : {}),
  });
  return portraitS3Client;
}

function normalizeGeneratedPortraitKind(kind: GeneratedPortraitKind): GeneratedPortraitKind {
  if (!GENERATED_PORTRAIT_KINDS.has(kind)) throw new Error(`Unsupported generated portrait kind: ${String(kind)}`);
  return kind;
}

function generatedPortraitMimeForExt(ext: string): string {
  if (ext === "jpg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  return "image/png";
}

function generatedPortraitExtForMime(mime: string): "png" | "jpg" | "webp" {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  return "png";
}

export function generatedPortraitAssetPath(kind: GeneratedPortraitKind, hash: string, ext: string): string {
  const cleanKind = normalizeGeneratedPortraitKind(kind);
  if (!/^[a-f0-9]{32}$/.test(hash)) throw new Error(`Invalid generated portrait hash: ${hash}`);
  if (!/^(png|jpg|webp)$/.test(ext)) throw new Error(`Invalid generated portrait extension: ${ext}`);
  return `/api/apps/ruby-high/assets/generated/${cleanKind}/${hash}.${ext}`;
}

export function generatedPortraitAssetUrl(kind: GeneratedPortraitKind, hash: string, ext: string): string {
  return `${publicBaseUrl()}${generatedPortraitAssetPath(kind, hash, ext)}`;
}

function generatedPortraitPublicUrl(kind: GeneratedPortraitKind, hash: string, ext: string, key: string): string {
  const explicitBase = process.env.RUBY_HIGH_PORTRAITS_PUBLIC_BASE?.trim();
  if (explicitBase) return explicitBase.replace(/\/+$/, "") + "/" + key;
  return generatedPortraitAssetPath(kind, hash, ext);
}

export async function maybeUploadPortrait(dataUrl: string, kind: GeneratedPortraitKind): Promise<string> {
  const bucket = process.env.RUBY_HIGH_PORTRAITS_BUCKET;
  const client = getPortraitS3Client();
  if (!bucket || !client) return dataUrl;

  const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl);
  if (!match) return dataUrl;

  const mime = match[1] ?? "image/png";
  const bytes = Buffer.from(match[2] ?? "", "base64");
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 32);
  const ext = generatedPortraitExtForMime(mime);
  const key = `${normalizeGeneratedPortraitKind(kind)}/${hash}.${ext}`;
  try {
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: bytes,
      ContentType: mime,
      CacheControl: GENERATED_PORTRAIT_CACHE_CONTROL,
    }));
  } catch (err) {
    log.error("portrait.s3-upload-failed", err, { kind, bucket, key, bytes: bytes.length });
    throw new Error("portrait upload failed: " + (err instanceof Error ? err.message : String(err)));
  }
  return generatedPortraitPublicUrl(kind, hash, ext, key);
}

function generatedPortraitBucketNames(): string[] {
  return Array.from(new Set([
    process.env.RUBY_HIGH_PORTRAITS_BUCKET?.trim() || "",
    GENERATED_PORTRAIT_BUCKET_FALLBACK,
  ].filter(Boolean)));
}

function generatedPortraitKeyFromUrl(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  const path = url.pathname.replace(/^\/+/, "");
  for (const bucket of generatedPortraitBucketNames()) {
    const lowerBucket = bucket.toLowerCase();
    if (host === `${lowerBucket}.s3.amazonaws.com` || (host.startsWith(`${lowerBucket}.s3.`) && host.endsWith(".amazonaws.com"))) {
      return path;
    }
    if ((host === "s3.amazonaws.com" || /^s3[.-][a-z0-9-]+\.amazonaws\.com$/.test(host)) && path.startsWith(`${bucket}/`)) {
      return path.slice(bucket.length + 1);
    }
    const endpoint = process.env.AWS_ENDPOINT_URL_S3?.trim();
    if (endpoint) {
      try {
        const endpointUrl = new URL(endpoint);
        if (host === endpointUrl.hostname.toLowerCase() && path.startsWith(`${bucket}/`)) {
          return path.slice(bucket.length + 1);
        }
      } catch {
        // Ignore malformed endpoints; the configured client will surface them on use.
      }
    }
  }
  return null;
}

export function rewriteGeneratedPortraitS3Url(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const key = generatedPortraitKeyFromUrl(url);
    if (!key) return null;
    const match = GENERATED_PORTRAIT_KEY_RE.exec(key);
    if (!match) return null;
    return generatedPortraitAssetPath(match[1] as GeneratedPortraitKind, match[2]!, match[3]!);
  } catch {
    return null;
  }
}

async function s3BodyToBuffer(body: unknown): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  const withByteArray = body as { transformToByteArray?: () => Promise<Uint8Array> };
  if (typeof withByteArray.transformToByteArray === "function") {
    return Buffer.from(await withByteArray.transformToByteArray());
  }
  const withArrayBuffer = body as { arrayBuffer?: () => Promise<ArrayBuffer> };
  if (typeof withArrayBuffer.arrayBuffer === "function") {
    return Buffer.from(await withArrayBuffer.arrayBuffer());
  }
  if (typeof (body as AsyncIterable<Uint8Array | string>)[Symbol.asyncIterator] === "function") {
    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<Uint8Array | string>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  throw new Error("Unsupported generated portrait response body.");
}

function generatedPortraitEtag(etag: string | undefined, body: Buffer): string {
  const clean = etag?.trim();
  if (clean) return clean.startsWith("\"") || clean.startsWith("W/\"") ? clean : `"${clean}"`;
  return `"${createHash("sha1").update(body).digest("base64url").slice(0, 22)}"`;
}

export function setGeneratedPortraitAssetLoaderForTest(loader: GeneratedPortraitAssetLoader | null): () => void {
  const previous = generatedPortraitAssetLoaderOverride;
  generatedPortraitAssetLoaderOverride = loader;
  return () => {
    generatedPortraitAssetLoaderOverride = previous;
  };
}

export async function loadGeneratedPortraitAsset(name: string): Promise<GeneratedPortraitAsset | null> {
  if (generatedPortraitAssetLoaderOverride) return generatedPortraitAssetLoaderOverride(name);
  const match = GENERATED_PORTRAIT_KEY_RE.exec(name);
  if (!match) return null;
  const bucket = process.env.RUBY_HIGH_PORTRAITS_BUCKET;
  const client = getPortraitS3Client();
  if (!bucket || !client) return null;

  const key = `${match[1]}/${match[2]}.${match[3]}`;
  try {
    const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const body = await s3BodyToBuffer(result.Body);
    return {
      body,
      mime: typeof result.ContentType === "string" && result.ContentType.trim()
        ? result.ContentType
        : generatedPortraitMimeForExt(match[3]!),
      etag: generatedPortraitEtag(result.ETag, body),
      cacheControl: typeof result.CacheControl === "string" && result.CacheControl.trim()
        ? result.CacheControl
        : GENERATED_PORTRAIT_CACHE_CONTROL,
    };
  } catch (err) {
    log.error("portrait.s3-load-failed", err, { bucket, key });
    return null;
  }
}
