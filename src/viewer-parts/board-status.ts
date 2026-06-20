export interface BoardSubjectSummaryGrade {
  facultyId?: string;
  grade?: unknown;
  progress?: {
    completedClasses?: unknown;
    requiredClasses?: unknown;
  } | null;
}

export interface BoardSubjectSummary {
  grades?: BoardSubjectSummaryGrade[];
  met?: unknown;
  total?: unknown;
}

export interface BoardSubjectGateMeta {
  label: string;
  icon: string;
}

export interface BoardSubjectChipSpec {
  label: string;
  icon: string;
  grade: unknown;
  met?: boolean;
  pending?: boolean;
}

export interface BoardStatusRendererDeps {
  document: Pick<Document, "createElement">;
  titleView(currentGrade: unknown, summary: BoardSubjectSummary): string;
  subjectGateMetaFor(facultyId: unknown, progress: unknown): BoardSubjectGateMeta;
  subjectProgressShortLabel(progress: unknown): string;
  letterGradePasses(grade: unknown): boolean;
  buildSubjectGradeChip(spec: BoardSubjectChipSpec): HTMLElement;
}

export interface BoardStatusRenderer {
  buildSubjectGrades(currentGrade: unknown, summary: BoardSubjectSummary): HTMLElement | null;
  buildClassStartHeader(currentGrade: unknown, summary: BoardSubjectSummary, statusText?: string, infoText?: string): HTMLElement;
  buildInfoButton(infoText?: string): HTMLElement | null;
}

export function createBoardStatusRenderer(deps: BoardStatusRendererDeps): BoardStatusRenderer {
  function text(value: unknown): string {
    return value == null ? "" : String(value);
  }

  function buildSubjectGradesRow(summary: BoardSubjectSummary): HTMLElement {
    const row = deps.document.createElement("div");
    row.className = "board-subject-grades-row";
    const grades = Array.isArray(summary.grades) ? summary.grades : [];
    for (const g of grades) {
      const meta = deps.subjectGateMetaFor(g.facultyId, g.progress);
      const p = g.progress || {};
      const completed = Number(p.completedClasses || 0);
      const required = Number(p.requiredClasses || 0);
      const met = required > 0 && completed >= required && deps.letterGradePasses(g.grade);
      row.appendChild(deps.buildSubjectGradeChip({
        label: meta.label,
        icon: meta.icon,
        grade: met ? g.grade : deps.subjectProgressShortLabel(p),
        met,
        pending: !met,
      }));
    }
    return row;
  }

  function buildTitle(currentGrade: unknown, summary: BoardSubjectSummary): HTMLElement {
    const heading = deps.document.createElement("div");
    heading.className = "board-subject-grades-title";
    heading.textContent = deps.titleView(currentGrade, summary);
    return heading;
  }

  function buildInfoButton(infoText?: string): HTMLElement | null {
    const trimmed = text(infoText).trim();
    if (!trimmed) return null;
    const button = deps.document.createElement("button");
    button.type = "button";
    button.className = "board-info-button";
    button.setAttribute("aria-label", "Class details");
    button.title = trimmed;
    button.textContent = "i";
    const bubble = deps.document.createElement("span");
    bubble.className = "board-info-popover";
    bubble.setAttribute("aria-hidden", "true");
    bubble.textContent = trimmed;
    button.appendChild(bubble);
    return button;
  }

  return {
    buildSubjectGrades(currentGrade, summary): HTMLElement | null {
      const grades = Array.isArray(summary.grades) ? summary.grades : [];
      if (grades.length < 1) return null;
      const wrap = deps.document.createElement("div");
      wrap.className = "board-subject-grades";
      wrap.appendChild(buildTitle(currentGrade, summary));
      wrap.appendChild(buildSubjectGradesRow(summary));
      return wrap;
    },
    buildInfoButton(infoText): HTMLElement | null {
      return buildInfoButton(infoText);
    },
    buildClassStartHeader(currentGrade, summary, statusText, infoText): HTMLElement {
      const wrap = deps.document.createElement("div");
      wrap.className = "board-empty-header";
      const top = deps.document.createElement("div");
      top.className = "board-empty-topline";
      const grade = deps.document.createElement("div");
      grade.className = "board-empty-grade";
      grade.textContent = deps.titleView(currentGrade, summary);
      top.appendChild(grade);
      const info = buildInfoButton(infoText);
      if (info) top.appendChild(info);
      wrap.appendChild(top);
      const status = deps.document.createElement("div");
      status.className = "board-empty-status";
      status.textContent = statusText || "Today's class ready";
      wrap.appendChild(status);
      wrap.appendChild(buildSubjectGradesRow(summary));
      return wrap;
    },
  };
}
