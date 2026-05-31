import type { Grade } from "../types.js";
import { GRADES, GRADE_LABELS } from "../types.js";
import type { RubyHighService, YearbookShareCard } from "../services/ruby-high-service.js";
import { APP_DISPLAY_NAME, APP_ROUTE_PREFIX } from "./constants.js";
import type { RouteContext } from "./context.js";

const YEARBOOK_PREFIX = `${APP_ROUTE_PREFIX}/yearbook`;

function gradeFromPath(value: string | undefined): Grade | null {
  return GRADES.includes(value as Grade) ? value as Grade : null;
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

function cardTitle(card: YearbookShareCard): string {
  return `${card.characterName} - ${GRADE_LABELS[card.grade] ?? card.grade} Yearbook`;
}

function summaryLine(card: YearbookShareCard): string {
  const total = Math.max(0, Math.floor(Number(card.summary.total ?? 0)));
  const correct = Math.max(0, Math.floor(Number(card.summary.correct ?? 0)));
  return total > 0 ? `${correct}/${total} questions passed` : "Year sealed";
}

function subjectRows(card: YearbookShareCard): string[] {
  return Object.entries(card.subjectScores ?? {})
    .map(([faculty, score]) => {
      const total = Math.max(0, Math.floor(Number(score.total ?? 0)));
      const correct = Math.max(0, Math.floor(Number(score.correct ?? 0)));
      const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
      return `${faculty}: ${pct}%`;
    })
    .slice(0, 6);
}

function renderHtml(ctx: RouteContext, card: YearbookShareCard): string {
  const title = cardTitle(card);
  const svgUrl = absoluteUrl(ctx, `${YEARBOOK_PREFIX}/${card.shareId}/${card.grade}?format=svg`);
  const completed = new Date(card.completedAt).toISOString().slice(0, 10);
  const superlatives = card.superlatives.length > 0
    ? card.superlatives.map((line) => `<li>${escapeHtml(line)}</li>`).join("")
    : "<li>Paper card sealed.</li>";
  const subjects = subjectRows(card).map((line) => `<li>${escapeHtml(line)}</li>`).join("");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(summaryLine(card))}">
  <meta property="og:image" content="${escapeHtml(svgUrl)}">
  <meta name="twitter:card" content="summary_large_image">
  <style>
    :root { color-scheme: light; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f4efe5; color: #251d1a; font: 16px/1.5 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { width: min(720px, calc(100vw - 32px)); padding: 32px; }
    article { border: 2px solid #251d1a; border-radius: 8px; background: #fffaf1; box-shadow: 0 18px 38px rgba(37,29,26,0.18); overflow: hidden; }
    header { padding: 28px 28px 20px; background: #c9252d; color: #fffaf1; }
    h1 { margin: 0; font-size: 34px; line-height: 1.05; letter-spacing: 0; }
    .meta { margin-top: 8px; font-weight: 700; }
    section { padding: 24px 28px; }
    .quote { font-size: 20px; font-weight: 700; margin: 0 0 18px; }
    dl { display: grid; grid-template-columns: 130px 1fr; gap: 8px 18px; margin: 0 0 20px; }
    dt { font-weight: 800; }
    dd { margin: 0; }
    ul { margin: 0; padding-left: 20px; }
    footer { padding: 16px 28px; border-top: 1px solid rgba(37,29,26,0.18); font-weight: 800; }
  </style>
</head>
<body>
  <main>
    <article>
      <header>
        <h1>${escapeHtml(card.characterName)}</h1>
        <div class="meta">${escapeHtml(GRADE_LABELS[card.grade] ?? card.grade)} - ${escapeHtml(APP_DISPLAY_NAME)}</div>
      </header>
      <section>
        ${card.flavorQuote ? `<p class="quote">"${escapeHtml(card.flavorQuote)}"</p>` : ""}
        <dl>
          <dt>Completed</dt><dd>${escapeHtml(completed)}</dd>
          <dt>Summary</dt><dd>${escapeHtml(summaryLine(card))}</dd>
          <dt>Playbook</dt><dd>${escapeHtml(card.playbookId ?? "student")}</dd>
        </dl>
        <h2>Superlatives</h2>
        <ul>${superlatives}</ul>
        ${subjects ? `<h2>Class Marks</h2><ul>${subjects}</ul>` : ""}
      </section>
      <footer>Ruby High yearbook card</footer>
    </article>
  </main>
</body>
</html>`;
}

function renderSvg(card: YearbookShareCard): string {
  const title = cardTitle(card);
  const lines = [
    title,
    summaryLine(card),
    card.flavorQuote ? `"${card.flavorQuote}"` : "Paper card sealed.",
    ...card.superlatives.slice(0, 4),
  ].map((line) => escapeHtml(line).slice(0, 92));
  const text = lines.map((line, index) =>
    `<text x="64" y="${120 + index * 58}" font-size="${index === 0 ? 42 : 26}" font-weight="${index === 0 ? 800 : 650}" fill="${index === 0 ? "#fffaf1" : "#251d1a"}">${line}</text>`
  ).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#fffaf1"/>
  <rect width="1200" height="190" fill="#c9252d"/>
  <rect x="32" y="32" width="1136" height="566" rx="18" fill="none" stroke="#251d1a" stroke-width="4"/>
  ${text}
  <text x="64" y="560" font-size="24" font-weight="800" fill="#6c5d52">${escapeHtml(APP_DISPLAY_NAME)} yearbook</text>
</svg>`;
}

export async function handleYearbookRoutes(ctx: RouteContext, ruby: RubyHighService): Promise<boolean> {
  if (!ctx.pathname.startsWith(YEARBOOK_PREFIX)) return false;
  if (ctx.method !== "GET" && ctx.method !== "HEAD") {
    ctx.error(ctx.res, "Method not allowed", 405);
    return true;
  }
  const sub = ctx.pathname.slice(YEARBOOK_PREFIX.length);
  const match = sub.match(/^\/([^/]+)\/([^/]+)$/);
  const shareId = match?.[1] ? decodeURIComponent(match[1]) : "";
  const grade = gradeFromPath(match?.[2]);
  if (!shareId || !grade) {
    ctx.error(ctx.res, "Yearbook card not found.", 404);
    return true;
  }
  const card = ruby.findYearbookShare(shareId, grade);
  if (!card) {
    ctx.error(ctx.res, "Yearbook card not found.", 404);
    return true;
  }
  const format = ctx.url?.searchParams.get("format")?.toLowerCase() ?? "html";
  if (format === "json") {
    ctx.json(ctx.res, { ok: true, card });
    return true;
  }
  if (format === "svg") {
    setTextResponse(ctx, 200, "image/svg+xml; charset=utf-8", renderSvg(card));
    return true;
  }
  if (format === "png") {
    ctx.error(ctx.res, "PNG yearbook rendering is not configured in this build. Use format=svg.", 501);
    return true;
  }
  setTextResponse(ctx, 200, "text/html; charset=utf-8", renderHtml(ctx, card));
  return true;
}

// ── Report card SVG rendering ──────────────────────────────────────────────

export function renderReportCardSvg(student: {
  name: string;
  playbookId: string;
  grade: string;
  stats: { head: number; heart: number; hustle: number; honor: number };
  classGrades: Record<string, string>;
  yearbookCount: number;
}): string {
  const gradeLabel = { "9": "Freshman", "10": "Sophomore", "11": "Junior", "12": "Senior" }[student.grade] ?? `Grade ${student.grade}`;
  const statNames = { head: "HEAD", heart: "HEART", hustle: "HUSTLE", honor: "HONOR" };
  const statsText = Object.entries(student.stats)
    .map(([k, v]) => `${(statNames as any)[k] ?? k}: ${v >= 0 ? "+" : ""}${v}`)
    .join("  ·  ");
  const gradesText = Object.entries(student.classGrades)
    .map(([fac, grade]) => `${fac}: ${grade}`)
    .join("  ·  ") || "No classes completed yet";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">
  <defs>
    <filter id="chalk"><feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="3" result="noise"/><feDisplacementMap in="SourceGraphic" in2="noise" scale="2"/></filter>
  </defs>
  <!-- Chalkboard background -->
  <rect width="1200" height="675" fill="#1a3a2a"/>
  <rect x="24" y="24" width="1152" height="627" rx="12" fill="none" stroke="#f0e6c5" stroke-width="3" opacity="0.3"/>
  <!-- Ruby High header -->
  <text x="80" y="90" font-family="Georgia,serif" font-size="48" font-weight="700" fill="#f0e6c5" filter="url(#chalk)">Ruby High · Report Card</text>
  <line x1="80" y1="110" x2="1120" y2="110" stroke="#f0e6c5" stroke-width="1" opacity="0.25"/>
  <!-- Student info -->
  <text x="80" y="170" font-family="Georgia,serif" font-size="52" font-weight="700" fill="#fff" filter="url(#chalk)">${escapeXml(student.name)}</text>
  <text x="80" y="220" font-family="Georgia,serif" font-size="26" fill="#c4b896">${escapeXml(student.playbookId)} · ${gradeLabel} · ${student.yearbookCount}/4 years sealed</text>
  <!-- Stats row -->
  <text x="80" y="290" font-family="monospace" font-size="22" fill="#e8dcc8" opacity="0.85">${escapeXml(statsText)}</text>
  <!-- Class grades -->
  <rect x="60" y="330" width="1080" height="2" fill="#f0e6c5" opacity="0.15"/>
  <text x="80" y="390" font-family="Georgia,serif" font-size="22" fill="#c4b896">Class Marks</text>
  <text x="80" y="440" font-family="monospace" font-size="26" fill="#f0e6c5" filter="url(#chalk)">${escapeXml(gradesText)}</text>
  <!-- Footer -->
  <line x1="80" y1="520" x2="1120" y2="520" stroke="#f0e6c5" stroke-width="1" opacity="0.15"/>
  <text x="80" y="570" font-family="Georgia,serif" font-size="18" fill="#8a7d6b">ruby-high.ai · Generated ${new Date().toISOString().slice(0, 10)}</text>
  <!-- Ruby stamp -->
  <text x="980" y="570" font-family="Georgia,serif" font-size="20" fill="#c9252d" opacity="0.6" font-style="italic">ruby</text>
</svg>`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
