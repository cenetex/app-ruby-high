import { createHash } from "node:crypto";
import { TokenBucket } from "../services/rate-limit.js";
import { log } from "../services/logger.js";
import type { RouteContext } from "./context.js";

const DEFAULT_REPO = "cenetex/app-ruby-high";
const BUG_CATEGORIES = {
  classroom: "A classroom view is broken.",
  gameplay: "A game action failed.",
  account: "Account access failed.",
  purchase: "A purchase or reward failed.",
} as const;
const BUG_REPORT_LIMITER = new TokenBucket(3, 1 / 120);

type BugReportBody = {
  category?: unknown;
  description?: unknown;
  context?: Record<string, unknown> | null;
} | null;

function firstHeader(value: string | string[] | null | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function rateKey(ctx: RouteContext): string {
  const cookieHash = createHash("sha256")
    .update(ctx.cookieHeader || "anon")
    .digest("hex")
    .slice(0, 16);
  return `${ctx.clientIp || "no-ip"}:${cookieHash}`;
}

function parseRepo(raw: string): { owner: string; repo: string } | null {
  const [owner, repo] = raw.split("/");
  if (!owner || !repo) return null;
  const valid = /^[A-Za-z0-9_.-]+$/.test(owner) && /^[A-Za-z0-9_.-]+$/.test(repo);
  return valid ? { owner, repo } : null;
}

function boundedNumber(value: unknown, max: number): string {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max ? String(value) : "unknown";
}

function makeIssueBody(description: string, context: Record<string, unknown> | null): string {
  return [
    "**Problem choice**",
    description,
    "",
    "**App diagnostics**",
    `- timestamp: ${new Date().toISOString()}`,
    `- session: ${typeof context?.session === "boolean" ? String(context.session) : "unknown"}`,
    `- ai enabled: ${typeof context?.aiEnabled === "boolean" ? String(context.aiEnabled) : "unknown"}`,
    `- grade: ${boundedNumber(context?.grade, 12)}`,
    `- viewport width: ${boundedNumber(context?.width, 10000)}`,
    `- viewport height: ${boundedNumber(context?.height, 10000)}`,
    `- browser errors: ${boundedNumber(context?.error, 100)}`,
    `- unhandled rejections: ${boundedNumber(context?.unhandledrejection, 100)}`,
    `- console errors: ${boundedNumber(context?.consoleError, 100)}`,
  ].join("\n");
}

function requestLooksLikeJson(ctx: RouteContext): boolean {
  const contentType = firstHeader(ctx.contentTypeHeader).toLowerCase();
  return contentType.startsWith("application/json");
}

function statusCodeForJsonError(err: unknown): number {
  const statusCode = (err as { statusCode?: unknown })?.statusCode;
  return typeof statusCode === "number" && statusCode >= 400 && statusCode < 500 ? statusCode : 400;
}

function originAllowed(ctx: RouteContext): boolean {
  const origin = firstHeader(ctx.originHeader);
  if (!origin) return true;
  try {
    const originUrl = new URL(origin);
    const candidates = [
      ctx.callbackUrlBuilder ? ctx.callbackUrlBuilder("/") : null,
      ctx.url?.origin ?? null,
    ].filter(Boolean) as string[];
    if (candidates.length === 0) return true;
    return candidates.some((candidate) => {
      const candidateUrl = new URL(candidate);
      return candidateUrl.origin === originUrl.origin
        || (originUrl.protocol === "https:" && candidateUrl.host === originUrl.host);
    });
  } catch {
    return false;
  }
}

export async function handleBugReportRoute(ctx: RouteContext): Promise<true> {
  if (ctx.method !== "POST") {
    ctx.error(ctx.res, "Method not allowed", 405);
    return true;
  }
  if (!requestLooksLikeJson(ctx)) {
    ctx.error(ctx.res, "Bug reports must be sent as JSON.", 415);
    return true;
  }
  if (!originAllowed(ctx)) {
    ctx.error(ctx.res, "Bug report origin is not allowed.", 403);
    return true;
  }

  const key = rateKey(ctx);
  if (!BUG_REPORT_LIMITER.take(key)) {
    const retryAfter = BUG_REPORT_LIMITER.retryAfterSeconds(key);
    const res = ctx.res as { setHeader?: (name: string, value: string) => void };
    res.setHeader?.("Retry-After", String(Math.max(1, retryAfter)));
    ctx.error(ctx.res, "Too many bug reports — wait a moment and try again.", 429);
    return true;
  }

  let body: BugReportBody;
  try {
    body = await ctx.readJsonBody() as BugReportBody;
  } catch (err) {
    const status = statusCodeForJsonError(err);
    ctx.error(
      ctx.res,
      status === 413 ? "Bug report request body is too large." : "Bug report JSON is malformed.",
      status,
    );
    return true;
  }

  const category = body?.category;
  if (body?.description !== undefined || typeof category !== "string" || !Object.hasOwn(BUG_CATEGORIES, category)) {
    ctx.error(ctx.res, "Choose a problem from the report menu.", 400);
    return true;
  }
  const description = BUG_CATEGORIES[category as keyof typeof BUG_CATEGORIES];

  const token = (process.env.RUBY_HIGH_GITHUB_ISSUES_TOKEN || "").trim();
  if (!token) {
    ctx.error(ctx.res, "Bug reporting is not configured on this server yet.", 501);
    return true;
  }
  const parsedRepo = parseRepo(process.env.RUBY_HIGH_GITHUB_ISSUES_REPO || DEFAULT_REPO);
  if (!parsedRepo) {
    ctx.error(ctx.res, "Bug reporting repository is misconfigured.", 500);
    return true;
  }

  const issueBody = makeIssueBody(description, body?.context ?? null);
  const issueTitle = `[bug] ${description}`;

  let response: Response;
  try {
    response = await fetch(`https://api.github.com/repos/${parsedRepo.owner}/${parsedRepo.repo}/issues`, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "ruby-high-bug-reporter",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        title: issueTitle,
        body: issueBody,
        labels: ["bug", "user-report"],
      }),
    });
  } catch (err) {
    log.error("bug-report.github-request-failed", err);
    ctx.error(ctx.res, "Could not reach GitHub to create the bug report.", 502);
    return true;
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    log.error("bug-report.github-create-failed", new Error(text || response.statusText), {
      status: response.status,
      repo: `${parsedRepo.owner}/${parsedRepo.repo}`,
    });
    ctx.error(ctx.res, "GitHub rejected the bug report.", 502);
    return true;
  }

  const issue = await response.json().catch(() => ({})) as { number?: unknown };
  const issueNumber = typeof issue.number === "number" ? issue.number : null;
  log.event("bug-report.created", { repo: `${parsedRepo.owner}/${parsedRepo.repo}`, issueNumber });
  ctx.json(ctx.res, { success: true, issueNumber });
  return true;
}
