export interface ClassReportRendererDeps {
  document: Pick<Document, "createElement">;
  teacherShortName(faculty: unknown, fallback?: string): string;
  gradeLabel(grade: unknown): string;
  letterGradeForScore(score: unknown): string;
  letterGradePasses(grade: unknown): boolean;
  todayCorrectSummary(today: unknown): { value: string; detail: string };
  formatClassScore(score: unknown): string;
  postClassState(telemetry: unknown): { socialReady?: boolean; practiceReady?: boolean };
  guestSignupRequired(telemetry: unknown): boolean;
  knownTeacherAssetId(faculty: unknown): string | null;
  teacherAssetUrl(facultyOrId: unknown, variant: string): string | null;
}

export interface ClassResultViewModel {
  classLetter: string;
  passedToday: boolean;
  teacherName: string;
  title: string;
  outcomeLine: string;
  promptLine: string;
  observationLabel: string;
  observation: string;
  consequenceLabel: string;
  consequence: string;
  progressLabel: string;
  progress: string;
  correctValue: string;
  correctDetail: string;
  scoreValue: string;
}

export interface ClassReportRenderer {
  buildViewModel(faculty: unknown, currentGrade: unknown, progress: unknown): ClassResultViewModel | null;
  buildCard(faculty: unknown, currentGrade: unknown, progress: unknown): HTMLElement | null;
  buildNextStep(telemetry: unknown): HTMLElement;
}

export function createClassReportRenderer(deps: ClassReportRendererDeps): ClassReportRenderer {
  function recordValue(record: unknown, key: string): unknown {
    return record && typeof record === "object" ? (record as Record<string, unknown>)[key] : undefined;
  }

  function positiveWhole(value: unknown): number {
    const number = Math.floor(Number(value));
    return Number.isFinite(number) && number > 0 ? number : 0;
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

  function addResultSection(parent: HTMLElement, kind: string, labelText: string, bodyText: string): void {
    const item = deps.document.createElement("div");
    item.className = `class-result-section ${kind}`;
    const label = deps.document.createElement("h3");
    label.className = "class-result-label";
    label.textContent = labelText;
    const body = deps.document.createElement("p");
    body.className = "class-result-body";
    body.textContent = bodyText;
    item.appendChild(label);
    item.appendChild(body);
    parent.appendChild(item);
  }

  function buildViewModel(faculty: unknown, currentGrade: unknown, progress: unknown): ClassResultViewModel | null {
    const today = recordValue(progress, "today");
    if (!progress || !today || recordValue(today, "status") !== "complete") return null;
    const teacherName = deps.teacherShortName(faculty, String(recordValue(progress, "displayName") || ""));
    const classLetter = String(recordValue(today, "letterGrade") || deps.letterGradeForScore(recordValue(today, "score")));
    const passedToday = deps.letterGradePasses(classLetter) || Number(recordValue(today, "score") || 0) >= 70;
    const grade = deps.gradeLabel(currentGrade);
    const result = recordValue(today, "result");
    const correctSummary = deps.todayCorrectSummary(today);
    const prompt = String(recordValue(result, "prompt") || "").trim();
    const finalOutcome = result
      ? recordValue(result, "forfeit")
        ? "final response unanswered"
        : recordValue(result, "wasCorrect")
          ? "final response met"
          : "final response missed"
      : "";
    const completedClasses = positiveWhole(recordValue(result, "completedClasses") ?? recordValue(progress, "completedClasses"));
    const requiredClasses = positiveWhole(recordValue(result, "requiredClasses") ?? recordValue(progress, "requiredClasses"));
    const remainingClasses = Math.max(0, requiredClasses - completedClasses);
    const progressCopy = requiredClasses <= 0
      ? `Today’s ${teacherName} class is recorded.`
      : remainingClasses === 0
        ? `${teacherName}’s ${grade} course requirement is cleared: ${completedClasses} of ${requiredClasses} passing class days recorded.`
        : `${completedClasses} of ${requiredClasses} passing ${teacherName} class days are recorded for ${grade}. ${remainingClasses} more ${remainingClasses === 1 ? "day" : "days"} to clear the course.`;
    return {
      classLetter,
      passedToday,
      teacherName,
      title: `${teacherName} class result`,
      outcomeLine: `${passedToday ? "Class passed" : "Class needs review"}${finalOutcome ? ` · ${finalOutcome}` : ""} · ${grade} · ${correctSummary.value}`,
      promptLine: prompt ? `Final prompt: ${prompt}` : "Today’s graded class is complete.",
      observationLabel: `What ${teacherName} noticed`,
      observation: String(recordValue(result, "teacherObservation") || `${teacherName} recorded ${correctSummary.value} on today’s graded cards.`),
      consequenceLabel: String(recordValue(result, "consequenceLabel") || (passedToday ? "Passing class recorded" : "Review mark recorded")),
      consequence: String(recordValue(result, "consequenceDetail") || `${grade} with ${teacherName}: ${classLetter}, ${correctSummary.value}.`),
      progressLabel: "Course progress",
      progress: progressCopy,
      correctValue: correctSummary.value,
      correctDetail: correctSummary.detail,
      scoreValue: deps.formatClassScore(recordValue(today, "score")),
    };
  }

  return {
    buildViewModel,
    buildCard(faculty, currentGrade, progress): HTMLElement | null {
      const view = buildViewModel(faculty, currentGrade, progress);
      if (!view) return null;
      const wrap = deps.document.createElement("section");
      wrap.className = "class-report-card" + (view.passedToday ? " is-passed" : " needs-work");

      const main = deps.document.createElement("div");
      main.className = "class-report-main";
      const badge = deps.document.createElement("div");
      badge.className = "class-report-letter";
      badge.textContent = view.classLetter;
      const titleWrap = deps.document.createElement("div");
      titleWrap.className = "class-report-heading";
      const title = deps.document.createElement("h2");
      title.className = "class-report-title";
      title.textContent = view.title;
      const subtitle = deps.document.createElement("p");
      subtitle.className = "class-report-subtitle";
      subtitle.textContent = view.outcomeLine;
      const prompt = deps.document.createElement("p");
      prompt.className = "class-result-prompt";
      prompt.textContent = view.promptLine;
      titleWrap.appendChild(title);
      titleWrap.appendChild(subtitle);
      titleWrap.appendChild(prompt);
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

      const sections = deps.document.createElement("div");
      sections.className = "class-result-sections";
      addResultSection(sections, "observation", view.observationLabel, view.observation);
      addResultSection(sections, "consequence", view.consequenceLabel, view.consequence);
      addResultSection(sections, "progress", view.progressLabel, view.progress);
      wrap.appendChild(sections);

      const metrics = deps.document.createElement("div");
      metrics.className = "class-report-metrics";
      addMetric(metrics, "correct", view.correctValue, view.correctDetail);
      addMetric(metrics, "score", view.scoreValue, "grade score");
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
        title.textContent = "Finish today’s reflection";
        body.textContent = "Then practice stays open; return tomorrow for the next graded class.";
      } else if (state.practiceReady) {
        title.textContent = "Practice is open now";
        body.textContent = "It will not change today’s class record. Return tomorrow for the next graded class.";
      } else {
        title.textContent = "Today’s graded class is recorded";
        body.textContent = "Return tomorrow for the next graded class.";
      }
      copy.appendChild(title);
      copy.appendChild(body);
      wrap.appendChild(copy);
      return wrap;
    },
  };
}
