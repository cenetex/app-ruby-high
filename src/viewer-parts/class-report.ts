export interface ClassReportRendererDeps {
  document: Pick<Document, "createElement">;
  teacherShortName(faculty: unknown, fallback?: string): string;
  letterGradeForScore(score: unknown): string;
  letterGradePasses(grade: unknown): boolean;
  todayCorrectSummary(today: unknown): { value: string; detail: string };
  formatClassScore(score: unknown): string;
  postClassState(telemetry: unknown): { socialReady?: boolean; practiceReady?: boolean };
  guestSignupRequired(telemetry: unknown): boolean;
  knownTeacherAssetId(faculty: unknown): string | null;
  teacherAssetUrl(facultyOrId: unknown, variant: string): string | null;
}

export interface ClassReportRenderer {
  buildCard(faculty: unknown, currentGrade: unknown, progress: unknown): HTMLElement | null;
  buildNextStep(telemetry: unknown): HTMLElement;
}

export function createClassReportRenderer(deps: ClassReportRendererDeps): ClassReportRenderer {
  function recordValue(record: unknown, key: string): unknown {
    return record && typeof record === "object" ? (record as Record<string, unknown>)[key] : undefined;
  }

  function addMetric(parent: HTMLElement, label: string, value: string, detail: string): void {
    const item = deps.document.createElement("div");
    item.className = "class-report-metric";
    const k = deps.document.createElement("span");
    k.className = "k";
    k.textContent = label;
    const v = deps.document.createElement("span");
    v.className = "v";
    v.textContent = value;
    const d = deps.document.createElement("span");
    d.className = "d";
    d.textContent = detail;
    item.appendChild(k);
    item.appendChild(v);
    item.appendChild(d);
    parent.appendChild(item);
  }

  return {
    buildCard(faculty, _currentGrade, progress): HTMLElement | null {
      const today = recordValue(progress, "today");
      if (!progress || !today || recordValue(today, "status") !== "complete") return null;
      const teacherName = deps.teacherShortName(faculty, String(recordValue(progress, "displayName") || ""));
      const classLetter = String(recordValue(today, "letterGrade") || deps.letterGradeForScore(recordValue(today, "score")));
      const passedToday = deps.letterGradePasses(recordValue(today, "letterGrade")) || Number(recordValue(today, "score") || 0) >= 70;
      const wrap = deps.document.createElement("section");
      wrap.className = "class-report-card" + (passedToday ? " is-passed" : " needs-work");

      const main = deps.document.createElement("div");
      main.className = "class-report-main";
      const badge = deps.document.createElement("div");
      badge.className = "class-report-letter";
      badge.textContent = classLetter;
      const titleWrap = deps.document.createElement("div");
      titleWrap.className = "class-report-heading";
      const title = deps.document.createElement("div");
      title.className = "class-report-title";
      title.textContent = "Teacher " + teacherName;
      const subtitle = deps.document.createElement("div");
      subtitle.className = "class-report-subtitle";
      subtitle.textContent = passedToday ? "daily class passed" : "review open";
      titleWrap.appendChild(title);
      titleWrap.appendChild(subtitle);
      main.appendChild(badge);
      main.appendChild(titleWrap);

      const artAssetId = faculty && (recordValue(faculty, "assetTeacherId") || deps.knownTeacherAssetId(faculty));
      if (artAssetId) {
        const art = deps.document.createElement("div");
        art.className = "class-report-teacher-art";
        const img = deps.document.createElement("img");
        img.alt = "";
        img.decoding = "async";
        img.loading = "lazy";
        img.src = deps.teacherAssetUrl(artAssetId, "full-sticker") || "";
        img.onerror = () => art.remove();
        art.appendChild(img);
        main.appendChild(art);
      }

      wrap.appendChild(main);

      const metrics = deps.document.createElement("div");
      metrics.className = "class-report-metrics";
      const correctSummary = deps.todayCorrectSummary(today);
      addMetric(metrics, "correct", correctSummary.value, correctSummary.detail);
      addMetric(metrics, "score", deps.formatClassScore(recordValue(today, "score")), "grade score");
      wrap.appendChild(metrics);
      return wrap;
    },
    buildNextStep(telemetry): HTMLElement {
      const state = deps.postClassState(telemetry);
      const signupRequired = deps.guestSignupRequired(telemetry);
      const wrap = deps.document.createElement("div");
      wrap.className = "class-report-next" + (signupRequired ? " is-signup" : state.socialReady ? " is-social" : state.practiceReady ? " is-practice" : "");
      const mark = deps.document.createElement("span");
      mark.className = "class-report-next-mark";
      wrap.appendChild(mark);
      const copy = deps.document.createElement("div");
      copy.className = "class-report-next-copy";
      const title = deps.document.createElement("div");
      title.className = "class-report-next-title";
      const body = deps.document.createElement("div");
      body.className = "class-report-next-body";
      if (signupRequired) {
        title.textContent = "Sign up to continue";
        body.textContent = "Your guest lesson is complete. Keep your student and unlock the rest of Ruby High.";
      } else if (state.socialReady) {
        title.textContent = "Homeroom reflection";
        body.textContent = "One short prompt before the next class.";
      } else if (state.practiceReady) {
        title.textContent = "Review open";
        body.textContent = "Extra review stays outside today's class record.";
      } else {
        title.textContent = "Daily class complete";
      }
      copy.appendChild(title);
      if (body.textContent) copy.appendChild(body);
      wrap.appendChild(copy);
      return wrap;
    },
  };
}
