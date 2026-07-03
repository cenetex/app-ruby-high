import type { RubyHighService, FirstBellShareCard } from "../services/ruby-high-service.js";
import { GRADE_LABELS } from "../types.js";
import { APP_DISPLAY_NAME, APP_ROUTE_PREFIX, VIEWER_PATH } from "./constants.js";
import type { RouteContext } from "./context.js";

export const FIRST_BELL_PREFIX = `${APP_ROUTE_PREFIX}/first-bell`;

function decodePathSegment(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function setTextResponse(ctx: RouteContext, status: number, contentType: string, body: string): void {
  const res = ctx.res as {
    statusCode?: number;
    setHeader?: (name: string, value: string) => void;
    end?: (body?: string) => void;
  };
  res.statusCode = status;
  res.setHeader?.("Content-Type", contentType);
  res.setHeader?.("Cache-Control", "public, max-age=300");
  res.end?.(body);
}

function absoluteUrl(ctx: RouteContext, path: string): string {
  if (ctx.callbackUrlBuilder) return ctx.callbackUrlBuilder(path);
  return new URL(path, ctx.url?.origin ?? "http://127.0.0.1:3000").toString();
}

function cardTitle(card: FirstBellShareCard): string {
  return `${card.characterName}'s First Bell Report`;
}

function gradeLabel(card: FirstBellShareCard): string {
  return card.grade ? GRADE_LABELS[card.grade] ?? `Grade ${card.grade}` : "Ruby High";
}

function summaryLine(card: FirstBellShareCard): string {
  return card.wasCorrect
    ? `${card.characterName} got the first Ruby High answer right.`
    : `${card.characterName} survived the first Ruby High question.`;
}

function renderHtml(ctx: RouteContext, card: FirstBellShareCard): string {
  const title = cardTitle(card);
  const imageUrl = absoluteUrl(ctx, `${FIRST_BELL_PREFIX}/${card.shareId}?format=svg`);
  const playUrl = absoluteUrl(ctx, `${VIEWER_PATH}?ref=fb_${encodeURIComponent(card.shareId)}`);
  const awarded = new Date(card.awardedAt).toISOString().slice(0, 10);
  const stats = card.stats
    ? [
        ["HEAD", card.stats.head],
        ["HEART", card.stats.heart],
        ["HUSTLE", card.stats.hustle],
        ["HONOR", card.stats.honor],
      ]
    : [];
  const statsHtml = stats.map(([key, value]) =>
    `<span><strong>${escapeHtml(key)}</strong> ${escapeHtml(value)}</span>`
  ).join("");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(summaryLine(card))}">
  <meta property="og:image" content="${escapeHtml(imageUrl)}">
  <meta name="twitter:card" content="summary_large_image">
  <style>
    :root { color-scheme: light; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f6f1e8; color: #211a18; font: 16px/1.5 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { width: min(760px, calc(100vw - 32px)); padding: 28px 0; }
    article { border: 2px solid #211a18; border-radius: 8px; background: #fffaf1; box-shadow: 0 18px 38px rgba(33,26,24,0.18); overflow: hidden; }
    header { padding: 28px; background: #b8202f; color: #fffaf1; }
    .kicker { font-weight: 900; text-transform: uppercase; font-size: 13px; letter-spacing: 0.08em; }
    h1 { margin: 8px 0 0; font-size: 38px; line-height: 1.05; letter-spacing: 0; }
    .meta { margin-top: 8px; font-weight: 800; }
    section { padding: 26px 28px; }
    blockquote { margin: 0 0 20px; padding-left: 18px; border-left: 5px solid #b8202f; font-size: 22px; font-weight: 800; line-height: 1.25; }
    dl { display: grid; grid-template-columns: 130px 1fr; gap: 8px 18px; margin: 0; }
    dt { font-weight: 900; }
    dd { margin: 0; }
    .stats { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 20px; }
    .stats span { border: 1px solid rgba(33,26,24,0.22); border-radius: 8px; padding: 8px 10px; background: #f7ead8; }
    .play { display: inline-block; margin-top: 18px; padding: 14px 24px; background: #b8202f; color: #fffaf1; font-weight: 900; text-decoration: none; border-radius: 8px; }
    .play:hover { background: #971927; }
    footer { padding: 16px 28px; border-top: 1px solid rgba(33,26,24,0.16); font-weight: 900; color: #6b584f; }
  </style>
</head>
<body>
  <main>
    <article>
      <header>
        <div class="kicker">First Bell Report</div>
        <h1>${escapeHtml(card.characterName)}</h1>
        <div class="meta">${escapeHtml(gradeLabel(card))} / ${escapeHtml(card.facultyName)} / ${escapeHtml(card.wasCorrect ? "Marked correct" : "Needs a review")}</div>
      </header>
      <section>
        <blockquote>${escapeHtml(card.prompt)}</blockquote>
        <dl>
          <dt>Answer</dt><dd>${escapeHtml(card.answerText)}</dd>
          ${!card.wasCorrect && card.correctAnswerText ? `<dt>Correct</dt><dd>${escapeHtml(card.correctAnswerText)}</dd>` : ""}
          ${card.score != null ? `<dt>Score</dt><dd>${escapeHtml(card.score)}</dd>` : ""}
          <dt>Awarded</dt><dd>${escapeHtml(awarded)}</dd>
        </dl>
        ${card.encouragement ? `<p>${escapeHtml(card.encouragement)}</p>` : ""}
        ${statsHtml ? `<div class="stats">${statsHtml}</div>` : ""}
      </section>
      <footer>${escapeHtml(APP_DISPLAY_NAME)} first question artifact</footer>
    </article>
    <a class="play" href="${escapeHtml(playUrl)}">Play ${escapeHtml(APP_DISPLAY_NAME)}</a>
  </main>
</body>
</html>`;
}

function renderSvg(card: FirstBellShareCard): string {
  const lines = [
    cardTitle(card),
    `${gradeLabel(card)} / ${card.facultyName}`,
    card.wasCorrect ? "Marked correct" : "Needs a review",
    card.prompt,
    `Answer: ${card.answerText}`,
  ].map((line) => escapeHtml(line).slice(0, 88));
  const text = lines.map((line, index) =>
    `<text x="64" y="${114 + index * 70}" font-size="${index === 0 ? 42 : 27}" font-weight="${index === 0 ? 850 : 700}" fill="${index <= 1 ? "#fffaf1" : "#211a18"}">${line}</text>`
  ).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#fffaf1"/>
  <rect width="1200" height="205" fill="#b8202f"/>
  <rect x="32" y="32" width="1136" height="566" rx="18" fill="none" stroke="#211a18" stroke-width="4"/>
  ${text}
  <text x="64" y="560" font-size="24" font-weight="850" fill="#6b584f">${escapeHtml(APP_DISPLAY_NAME)} / First Bell Report</text>
</svg>`;
}

export async function handleFirstBellRoutes(ctx: RouteContext, ruby: RubyHighService): Promise<boolean> {
  if (!ctx.pathname.startsWith(FIRST_BELL_PREFIX)) return false;
  if (ctx.method !== "GET" && ctx.method !== "HEAD") {
    ctx.error(ctx.res, "Method not allowed", 405);
    return true;
  }
  const sub = ctx.pathname.slice(FIRST_BELL_PREFIX.length);
  const match = sub.match(/^\/([^/]+)$/);
  const shareId = match?.[1] ? decodePathSegment(match[1]) : "";
  if (!shareId) {
    ctx.error(ctx.res, "First Bell report not found.", 404);
    return true;
  }
  const card = ruby.findFirstBellShare(shareId);
  if (!card) {
    ctx.error(ctx.res, "First Bell report not found.", 404);
    return true;
  }
  const format = ctx.url?.searchParams.get("format")?.toLowerCase() ?? "html";
  if (format === "json") {
    ctx.json(ctx.res, { ok: true, card });
    return true;
  }
  if (format === "svg" || format === "png") {
    setTextResponse(ctx, 200, "image/svg+xml; charset=utf-8", renderSvg(card));
    return true;
  }
  setTextResponse(ctx, 200, "text/html; charset=utf-8", renderHtml(ctx, card));
  return true;
}
