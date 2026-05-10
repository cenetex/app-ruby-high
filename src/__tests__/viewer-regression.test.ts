import { describe, expect, it } from "vitest";
import { renderViewerHtml } from "../viewer.js";
import { VIEWER_CSS } from "../viewer-parts/css.js";

function renderedViewer(): string {
  return renderViewerHtml({
    agentName: "Ruby",
    sessionId: "rh:test-viewer",
    apiBase: "/api/apps/ruby-high",
    role: "human",
  });
}

function inlineScript(html: string): string {
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!match) throw new Error("viewer HTML has no inline script");
  return match[1]!;
}

function cssRule(selector: string): string {
  const needle = `${selector} {`;
  const start = VIEWER_CSS.indexOf(needle);
  if (start < 0) throw new Error(`missing selector: ${selector}`);
  const open = VIEWER_CSS.indexOf("{", start);
  if (open < 0) throw new Error(`missing rule body: ${selector}`);
  let depth = 0;
  for (let i = open; i < VIEWER_CSS.length; i += 1) {
    const ch = VIEWER_CSS[i];
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return VIEWER_CSS.slice(open + 1, i);
    }
  }
  throw new Error(`unterminated rule: ${selector}`);
}

describe("viewer regression guardrails", () => {
  it("renders parseable inline JS with the critical offline boot and PWA paths", () => {
    const script = inlineScript(renderedViewer());

    expect(() => new Function(script)).not.toThrow();
    expect(script).toContain("/api/apps/ruby-high/auth/guest");
    expect(script).toContain('navigator.serviceWorker.register(apiBase + "/service-worker.js", { scope: apiBase + "/" })');
  });

  it("keeps opinion submit, waiting refresh, and force-grade paths wired in the client", () => {
    const script = inlineScript(renderedViewer());

    expect(script).toContain('/api/apps/ruby-high/chat/opinion-submit');
    expect(script).toContain('event === "waiting" || event === "opinion-graded"');
    expect(script).toContain("fetchSession();");
    expect(script).toContain("body: JSON.stringify({ force: true })");
    expect(script).toContain("opinionGradeFired = true");
  });

  it("keeps SSE streams bounded so stale network reads cannot hold the UI lock forever", () => {
    const script = inlineScript(renderedViewer());

    expect(script).toContain("function chatStreamStillCurrent(opts)");
    expect(script).toContain("const watchdog = setTimeout");
    expect(script).toContain("reader.cancel()");
    expect(script).toContain("clearTimeout(watchdog)");
    expect(script).toContain("opts.streamSeq !== chatStreamSeq");
  });

  it("drops session polls that overlap command requests", () => {
    const script = inlineScript(renderedViewer());

    expect(script).toContain("const seqAtStart = commandSeq");
    expect(script).toContain("const settledAtStart = lastSettledCommandSeq");
    expect(script).toContain("commandSeq !== seqAtStart || lastSettledCommandSeq !== settledAtStart");
  });

  it("uses explicit top status labels instead of ambiguous streak/classes copy", () => {
    const html = renderedViewer();
    const script = inlineScript(html);

    expect(html).toContain('title="Consecutive school days with a passed daily class"');
    expect(html).toContain('title="Subject courses passed with a C or better"');
    expect(script).toContain('streakCount + "/" + streakReq + " school days"');
    expect(script).toContain('classes.met + "/" + classes.total + " courses passed"');
    expect(script).toContain('formatWholeNumber(t.scorePoints || 0) + " score"');
  });

  it("builds the class report with teacher art and a real star meter", () => {
    const script = inlineScript(renderedViewer());

    expect(script).toContain("function buildClassReportCard");
    expect(script).toContain("class-report-teacher-art");
    expect(script).toContain("teacherAssetUrl(artAssetId");
    expect(script).toContain("class-report-star-meter");
    expect(script).toContain('star.textContent = "★"');
    expect(script).toContain('classProgress.setAttribute("aria-label"');
  });

  it("does not crop class report stars or the teacher overlay container", () => {
    expect(cssRule(".board .class-report-card")).toContain("overflow: visible");
    expect(cssRule(".board .class-report-metric")).toContain("overflow: visible");
    expect(cssRule(".board .class-report-metric .v")).toContain("overflow: visible");

    const starMeter = cssRule(".board .class-report-star-meter");
    expect(starMeter).toContain("display: inline-flex");
    expect(starMeter).toContain("width: max-content");
    expect(starMeter).toContain("min-width: max-content");
    expect(starMeter).toContain("max-width: none");
    expect(starMeter).toContain("white-space: nowrap");

    expect(cssRule(".board .class-report-star")).toContain("flex: 0 0 auto");
    expect(cssRule(".board .class-report-teacher-art")).toContain("overflow: hidden");
    expect(cssRule(".board .class-report-teacher-art img")).toContain("object-fit: contain");
  });
});
