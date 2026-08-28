export interface ClassReportRendererDeps {
  document: Pick<Document, "createElement">;
  teacherShortName(faculty: unknown, fallback?: string): string;
  gradeLabel(grade: unknown): string;
  letterGradeForScore(score: unknown): string;
  letterGradePasses(grade: unknown): boolean;
  todayCorrectSummary(today: unknown): { value: string; detail: string };
  formatClassScore(score: unknown): string;
  postClassState(telemetry: unknown): { essayReady?: boolean; socialReady?: boolean; practiceReady?: boolean };
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
  investigationLabel?: string;
  investigation?: string;
  relationshipLabel?: string;
  relationship?: string;
  memoryLabel?: string;
  memory?: string;
  followUp?: string;
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
    const episodeTitle = String(recordValue(result, "episodeTitle") || "").trim();
    const finalOutcome = result
      ? recordValue(result, "forfeit")
        ? "final answer missing"
        : recordValue(result, "wasCorrect")
          ? "final answer passed"
          : "final answer needs work"
      : "";
    const completedClasses = positiveWhole(recordValue(result, "completedClasses") ?? recordValue(progress, "completedClasses"));
    const requiredClasses = positiveWhole(recordValue(result, "requiredClasses") ?? recordValue(progress, "requiredClasses"));
    const remainingClasses = Math.max(0, requiredClasses - completedClasses);
    const progressCopy = requiredClasses <= 0
      ? `Today’s ${teacherName} class is recorded.`
      : remainingClasses === 0
        ? `You passed ${teacherName}’s ${grade} course. You completed ${completedClasses} of ${requiredClasses} required class days.`
        : `You completed ${completedClasses} of ${requiredClasses} required ${teacherName} class days for ${grade}. Pass ${remainingClasses} more ${remainingClasses === 1 ? "day" : "days"} to finish the course.`;
    const relationship = String(recordValue(result, "relationshipDetail") || "").trim();
    const investigation = String(recordValue(result, "investigationDetail") || "").trim();
    const investigationConfidence = String(recordValue(result, "investigationConfidence") || "").trim();
    const memory = String(recordValue(result, "memoryDetail") || "").trim();
    const followUp = String(recordValue(result, "followUp") || "").trim();
    return {
      classLetter,
      passedToday,
      teacherName,
      title: episodeTitle || `${teacherName} class result`,
      outcomeLine: `${passedToday ? "Class passed" : "Class needs work"}${finalOutcome ? ` · ${finalOutcome}` : ""} · ${grade} · ${correctSummary.value}`,
      promptLine: prompt ? `Final prompt: ${prompt}` : "Today’s graded class is complete.",
      observationLabel: `What ${teacherName} noticed`,
      observation: String(recordValue(result, "teacherObservation") || `${teacherName} recorded ${correctSummary.value} for today’s class.`),
      consequenceLabel: String(recordValue(result, "consequenceLabel") || (passedToday ? "Class saved" : "Saved for review")),
      consequence: String(recordValue(result, "consequenceDetail") || `${grade} with ${teacherName}: ${classLetter}, ${correctSummary.value}.`),
      ...(investigation ? {
        investigationLabel: `${String(recordValue(result, "investigationLabel") || "How you investigated")}${investigationConfidence ? ` · ${investigationConfidence} confidence` : ""}`,
        investigation,
      } : {}),
      ...(relationship ? {
        relationshipLabel: String(recordValue(result, "relationshipLabel") || `${teacherName} remembers`),
        relationship,
      } : {}),
      ...(memory ? {
        memoryLabel: String(recordValue(result, "memoryTitle") || "Case memory"),
        memory,
      } : {}),
      ...(followUp ? { followUp } : {}),
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
      if (view.investigationLabel && view.investigation) {
        addResultSection(sections, "investigation", view.investigationLabel, view.investigation);
      }
      addResultSection(sections, "consequence", view.consequenceLabel, view.consequence);
      if (view.relationshipLabel && view.relationship) {
        addResultSection(sections, "relationship", view.relationshipLabel, view.relationship);
      }
      if (view.memoryLabel && view.memory) {
        addResultSection(sections, "memory", view.memoryLabel, view.memory);
      }
      if (view.followUp) {
        addResultSection(sections, "follow-up", "Next review", view.followUp);
      }
      addResultSection(sections, "progress", view.progressLabel, view.progress);
      wrap.appendChild(sections);

      const metrics = deps.document.createElement("div");
      metrics.className = "class-report-metrics";
      addMetric(metrics, "correct", view.correctValue, view.correctDetail);
      addMetric(metrics, "score", view.scoreValue, "class score");
      wrap.appendChild(metrics);
      return wrap;
    },
    buildNextStep(telemetry): HTMLElement {
      const state = deps.postClassState(telemetry);
      const signupRequired = deps.guestSignupRequired(telemetry);
      const wrap = deps.document.createElement("div");
      wrap.className = "class-report-next" + (signupRequired ? " is-signup" : state.essayReady ? " is-essay" : state.socialReady ? " is-social" : state.practiceReady ? " is-practice" : "");
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
      } else if (state.essayReady) {
        title.textContent = "Your graded essay is ready";
        body.textContent = "Write it next to finish this year's requirements and start the ceremony.";
      } else if (state.socialReady) {
        title.textContent = "Finish today’s reflection";
        body.textContent = "After that, you can keep practising. Return tomorrow for the next graded class.";
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
