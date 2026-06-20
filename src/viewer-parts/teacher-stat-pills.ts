export interface TeacherStatPillsRendererDeps {
  document: Pick<Document, "createElement">;
  statLabel: (key: string) => string;
  fmtStat: (value: number) => string;
}

export interface TeacherStatPillsRenderer {
  build(stats: unknown): HTMLElement;
}

export function createTeacherStatPillsRenderer(
  deps: TeacherStatPillsRendererDeps,
): TeacherStatPillsRenderer {
  function statValue(stats: unknown, key: string): number {
    const raw = stats && typeof stats === "object" ? (stats as Record<string, unknown>)[key] : 0;
    return Number(raw || 0);
  }

  return {
    build(stats): HTMLElement {
      const wrap = deps.document.createElement("div");
      wrap.className = "teacher-stat-pills";
      ["head", "heart", "hustle", "honor"].forEach((key) => {
        const pill = deps.document.createElement("span");
        pill.className = "pill stat " + key;
        pill.textContent = deps.statLabel(key) + " " + deps.fmtStat(statValue(stats, key));
        wrap.appendChild(pill);
      });
      return wrap;
    },
  };
}
