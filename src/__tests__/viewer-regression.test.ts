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

    expect(html).toContain('title="Passed daily classes needed for this year"');
    expect(html).toContain('title="Subjects cleared with a C or better this year"');
    expect(script).toContain('streakCount + "/" + streakReq + " daily classes"');
    expect(script).toContain('subjects.met + "/" + subjects.total + " subjects cleared"');
    expect(script).toContain('formatWholeNumber(t.scorePoints || 0) + " score"');
  });

  it("routes the post-class Practice button to a practice board or teacher advance", () => {
    const script = inlineScript(renderedViewer());

    expect(script).toContain("async function startPostClassPractice(postClass)");
    expect(script).toContain('await command({ type: "pick", mode: "practice" })');
    expect(script).toContain('intent: "advance"');
    expect(script).toContain('runAgentTurn("manual"');
    expect(script).toContain("if (postClass.report)");
  });

  it("builds the class report with full-body teacher standee art and graded-question count", () => {
    const script = inlineScript(renderedViewer());

    expect(script).toContain("function buildClassReportCard");
    expect(script).toContain("class-report-teacher-art");
    expect(script).toContain('teacherAssetUrl(artAssetId, "full-sticker")');
    expect(script).toContain('addMetric("graded"');
    expect(script).toContain('"questions"');
  });

  it("stages class report teachers as full-body standees in front of the report card", () => {
    expect(cssRule('.blackboard-panel[data-question-type="class-report"] .board')).toContain("overflow: visible");
    expect(cssRule(".board .class-report-card")).toContain("overflow: visible");
    expect(cssRule(".board .class-report-card")).toContain("position: relative");
    expect(cssRule(".board .class-report-metric")).toContain("overflow: visible");
    expect(cssRule(".board .class-report-metric .v")).toContain("overflow: visible");

    expect(cssRule(".board .class-report-main")).toContain("overflow: visible");
    expect(cssRule(".board .class-report-teacher-art")).toContain("position: absolute");
    expect(cssRule(".board .class-report-teacher-art")).toContain("height: clamp(176px, 27vw, 236px)");
    expect(cssRule(".board .class-report-teacher-art")).toContain("drop-shadow");
    expect(cssRule(".board .class-report-teacher-art img")).toContain("height: 100%");
    expect(cssRule(".board .class-report-teacher-art img")).toContain("max-width: none");
  });
});
