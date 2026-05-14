import { createHash } from "node:crypto";
import { TokenBucket } from "../services/rate-limit.js";
import { log } from "../services/logger.js";
import type { RouteContext } from "./context.js";

const DEFAULT_REPO = "cenetex/app-ruby-high";
const MAX_DESCRIPTION_CHARS = 4_000;
const MAX_CONTEXT_CHARS = 1_000;
const MAX_ERROR_CHARS = 280;
const BUG_REPORT_LIMITER = new TokenBucket(3, 1 / 120);

type BugReportContext = {
  url?: unknown;
  userAgent?: unknown;
  timestamp?: unknown;
  session?: unknown;
  aiEnabled?: unknown;
  character?: unknown;
  grade?: unknown;
  faculty?: unknown;
  viewport?: unknown;
  recentErrors?: unknown;
};

type BugReportBody = {
  description?: unknown;
  context?: BugReportContext | null;
} | null;

function firstHeader(value: string | string[] | null | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function redactSecrets(input: string): string {
  return input
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-[redacted]")
    .replace(/([?&](?:code|state|access_token|id_token|token|key)=)[^&\s)]+/gi, "$1[redacted]")
    .replace(/\b(authorization|bearer|token|api[_-]?key)(["':=\s]+)([A-Za-z0-9._~+/-]{12,})/gi, "$1$2[redacted]");
}

function cleanText(value: unknown, maxChars: number): string {
  if (typeof value !== "string") return "";
  return redactSecrets(value.replace(/\u0000/g, "").trim()).slice(0, maxChars);
}

function cleanScalar(value: unknown, maxChars = MAX_CONTEXT_CHARS): string {
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return cleanText(value, maxChars);
}

function cleanErrors(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => cleanText(entry, MAX_ERROR_CHARS))
    .filter(Boolean)
    .slice(-5);
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

function makeIssueTitle(description: string): string {
  const firstLine = description
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  const suffix = (firstLine || "Ruby High bug report").replace(/\s+/g, " ").slice(0, 88);
  return `[bug] ${suffix}`;
}

function makeIssueBody(description: string, context: BugReportContext | null): string {
  const recentErrors = cleanErrors(context?.recentErrors);
  const rows = [
    "**What happened?**",
    description || "_No description provided._",
    "",
    "---",
    "**Auto-collected context**",
    `- url: ${cleanScalar(context?.url) || "unknown"}`,
    `- user-agent: ${cleanScalar(context?.userAgent) || "unknown"}`,
    `- timestamp: ${cleanScalar(context?.timestamp) || new Date().toISOString()}`,
    `- session: ${cleanScalar(context?.session) || "unknown"}`,
    `- ai enabled: ${cleanScalar(context?.aiEnabled) || "unknown"}`,
    `- character: ${cleanScalar(context?.character) || "none"}`,
    `- grade: ${cleanScalar(context?.grade) || "unknown"}`,
    `- faculty: ${cleanScalar(context?.faculty) || "unknown"}`,
    `- viewport: ${cleanScalar(context?.viewport) || "unknown"}`,
    "",
    "**Recent console errors**",
  ];
  if (recentErrors.length) {
    rows.push("```", recentErrors.join("\n"), "```");
  } else {
    rows.push("_(none in this session)_");
  }
  return rows.join("\n");
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

  const key = rateKey(ctx);
  if (!BUG_REPORT_LIMITER.take(key)) {
    const retryAfter = BUG_REPORT_LIMITER.retryAfterSeconds(key);
    const res = ctx.res as { setHeader?: (name: string, value: string) => void };
    res.setHeader?.("Retry-After", String(Math.max(1, retryAfter)));
    ctx.error(ctx.res, "Too many bug reports — wait a moment and try again.", 429);
    return true;
  }

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

  const description = cleanText(body?.description, MAX_DESCRIPTION_CHARS);
  const issueBody = makeIssueBody(description, body?.context ?? null);
  const issueTitle = makeIssueTitle(description);

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
