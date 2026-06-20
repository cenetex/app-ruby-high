export interface EssayReport {
  score?: unknown;
  passed?: boolean;
  prompt?: unknown;
  subject?: string;
  faculty?: unknown;
  gradedAt?: unknown;
  comment?: unknown;
  bestResponder?: string;
  bestResponderScore?: unknown;
  response?: unknown;
}

export interface ReportMetric {
  label?: string;
  value?: string;
  detail?: string;
  met?: boolean;
}

export interface ReportCardRendererDeps {
  document: Pick<Document, "createElement">;
  essayLetter(score: unknown): string;
  clipEssayText(text: unknown, max: number): string;
  facultyLabel(faculty: unknown): string;
  essayScoreText(score: unknown): string;
  formatSealedDate(ts: unknown): string;
  essayResponderName(id: string | undefined): string;
  essayRivalryText(recent: EssayReport[]): string;
  buildCareerMetrics(rows: ReportMetric[]): HTMLElement;
}

export interface ReportCardRenderer {
  buildEntry(report: EssayReport): HTMLElement;
  buildCard(reports: EssayReport[]): HTMLElement;
}

export function createReportCardRenderer(deps: ReportCardRendererDeps): ReportCardRenderer {
  function essayAverage(reports: EssayReport[]): number | null {
    const scores = reports
      .map((r) => Number(r.score))
      .filter((n) => Number.isFinite(n));
    if (scores.length === 0) return null;
    return scores.reduce((sum, n) => sum + n, 0) / scores.length;
  }

  const renderer: ReportCardRenderer = {
    buildEntry(report): HTMLElement {
      const row = deps.document.createElement("article");
      row.className = "report-entry" + (report.passed ? " is-passed" : "");

      const grade = deps.document.createElement("div");
      grade.className = "report-entry-grade";
      grade.textContent = deps.essayLetter(report.score);
      row.appendChild(grade);

      const body = deps.document.createElement("div");
      body.className = "report-entry-body";

      const title = deps.document.createElement("div");
      title.className = "report-entry-title";
      title.textContent = deps.clipEssayText(report.prompt, 72) || "Essay";
      body.appendChild(title);

      const meta = deps.document.createElement("div");
      meta.className = "report-entry-meta";
      const subject = report.subject ? " \u00b7 " + report.subject : "";
      meta.textContent = deps.facultyLabel(report.faculty) + subject + " \u00b7 " + deps.essayScoreText(report.score) + " \u00b7 " + deps.formatSealedDate(report.gradedAt);
      body.appendChild(meta);

      if (report.comment) {
        const comment = deps.document.createElement("div");
        comment.className = "report-entry-comment";
        comment.textContent = deps.clipEssayText(report.comment, 104);
        body.appendChild(comment);
      }

      const foot = deps.document.createElement("div");
      foot.className = "report-entry-foot";
      if (report.bestResponder) {
        const best = deps.document.createElement("span");
        best.textContent = "Best: " + deps.essayResponderName(report.bestResponder)
          + (Number.isFinite(Number(report.bestResponderScore)) ? " " + deps.essayScoreText(report.bestResponderScore) : "");
        foot.appendChild(best);
      }
      if (report.response) {
        const yours = deps.document.createElement("span");
        yours.textContent = "You: " + deps.clipEssayText(report.response, 58);
        foot.appendChild(yours);
      }
      if (foot.children.length > 0) body.appendChild(foot);

      row.appendChild(body);
      return row;
    },
    buildCard(reports): HTMLElement {
      const recent = reports.slice(-5).reverse();
      const visible = recent.slice(0, 3);
      const avg = essayAverage(reports);
      const playerWins = reports.filter((r) => r.bestResponder === "player").length;
      const topScore = reports
        .map((r) => Number(r.score))
        .filter((n) => Number.isFinite(n))
        .sort((a, b) => b - a)[0];

      const card = deps.document.createElement("div");
      card.className = "ccg-card is-report-card";

      const role = deps.document.createElement("span");
      role.className = "ccg-role report";
      role.textContent = "report";
      card.appendChild(role);

      const body = deps.document.createElement("div");
      body.className = "ccg-body";

      const nameEl = deps.document.createElement("div");
      nameEl.className = "ccg-name";
      nameEl.textContent = "Report Card";
      body.appendChild(nameEl);

      const sub = deps.document.createElement("div");
      sub.className = "ccg-subtitle";
      sub.textContent = reports.length
        ? reports.length + " essays \u00b7 average " + deps.essayScoreText(avg)
        : "No graded essays yet";
      body.appendChild(sub);

      body.appendChild(deps.buildCareerMetrics([
        { label: "essays", value: String(reports.length), detail: "graded", met: reports.length > 0 },
        { label: "average", value: deps.essayScoreText(avg), detail: "teacher score", met: Number(avg) >= 7 },
        { label: "top", value: Number.isFinite(Number(topScore)) ? deps.essayScoreText(topScore) : "\u2014", detail: playerWins + " class wins", met: playerWins > 0 },
      ]));

      if (reports.length === 0) {
        const empty = deps.document.createElement("div");
        empty.className = "report-empty";
        empty.textContent = "Your first graded essay will land here.";
        body.appendChild(empty);
      } else {
        const rivalry = deps.document.createElement("div");
        rivalry.className = "report-rivalry";
        rivalry.textContent = deps.essayRivalryText(recent);
        body.appendChild(rivalry);

        const list = deps.document.createElement("div");
        list.className = "report-list";
        visible.forEach((report) => list.appendChild(renderer.buildEntry(report)));
        body.appendChild(list);
      }

      card.appendChild(body);
      return card;
    },
  };
  return renderer;
}
