import { describe, expect, it } from "vitest";
import { renderViewerHtml } from "../viewer.js";
import { VIEWER_CSS } from "../viewer-parts/css.js";

function renderedViewer(opts: Partial<Parameters<typeof renderViewerHtml>[0]> = {}): string {
  return renderViewerHtml({
    agentName: "Ruby",
    sessionId: "rh:test-viewer",
    apiBase: "/api/apps/ruby-high",
    role: "human",
    ...opts,
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
    expect(script).toContain('["localhost", "127.0.0.1", "::1"].includes(window.location.hostname)');
    expect(script).toContain("navigator.serviceWorker.getRegistrations()");
    expect(script).toContain('navigator.serviceWorker.register(apiBase + "/service-worker.js", { scope: apiBase + "/" })');
  });

  it("wires the Privy account UI through the lazy widget bundle", () => {
    const html = renderedViewer({ privy: { appId: "privy-app-test", clientId: "privy-client-test" } });
    const script = inlineScript(html);

    expect(() => new Function(script)).not.toThrow();
    expect(html).toContain('id="privy-action"');
    expect(html).toContain('id="signin-privy"');
    expect(html).toContain('id="privy-overlay"');
    expect(html).toContain('id="privy-login-widget"');
    expect(html).toContain('id="account-ai-action"');
    expect(html).toContain("Connect OpenRouter");
    expect(html).toContain('id="account-create-character"');
    expect(html).toContain('id="account-history-list"');
    expect(html).toContain('id="account-comics"');
    expect(script).toContain('const privyConfig = {"appId":"privy-app-test","clientId":"privy-client-test"};');
    expect(script).toContain('const PRIVY_CLIENT_URL = apiBase + "/assets/privy-client.js"');
    expect(script).toContain("import(PRIVY_CLIENT_URL)");
    expect(script).toContain("createRubyHighPrivyClient(privyConfig)");
    expect(script).toContain("client.login()");
    expect(script).toContain("startPrivyLogin");
    expect(script).toContain('apiBase + "/auth/privy"');
    expect(script).toContain("initializePrivyFromStoredSession();");
    expect(script).not.toContain("sendEmailCode");
    expect(script).not.toContain("loginWithEmailCode");
  });

  it("makes Account the character home before wallet, history, comics, and AI access", () => {
    const html = renderedViewer({ privy: { appId: "privy-app-test", clientId: "privy-client-test" } });
    const script = inlineScript(html);
    const characters = html.indexOf('class="account-section account-character-section"');
    const wallet = html.indexOf('class="account-section account-wallet-section"');
    const history = html.indexOf('id="account-history-list"');
    const comics = html.indexOf('class="account-section account-comics-section"');
    const ai = html.indexOf('class="account-section account-ai-section"');

    expect(characters).toBeGreaterThan(-1);
    expect(wallet).toBeGreaterThan(characters);
    expect(history).toBeGreaterThan(wallet);
    expect(comics).toBeGreaterThan(history);
    expect(ai).toBeGreaterThan(comics);
    expect(script).toContain("function openCharacterCreationFromAccount()");
    expect(html).toContain('id="blackboard-empty-action"');
    expect(script).toContain("Create your first Ruby High student.");
    expect(script).toContain('els.blackboardEmptyAction.addEventListener("click", openCharacterCreationFromAccount)');
    expect(script).toContain("function maybeShowWelcomeHallPassPopup");
    expect(script).toContain('const WELCOME_HALL_PASS_ART_URL = apiBase + "/assets/welcome-hall-passes.png"');
    expect(VIEWER_CSS).toContain(".welcome-hall-pass-art");
    expect(script).toContain("Roll your first student and try a custom portrait");
    expect(script).not.toContain("Roll your character to start today's class.");
  });

  it("labels offline classroom advance as Continue instead of Chat", () => {
    const script = inlineScript(renderedViewer());

    expect(script).toContain('offlineClassroom ? "Continue" : "Chat"');
    expect(script).toContain('const advanceLabel = teacherChatEnabled() ? "Chat" : "Continue";');
    expect(script).toContain("Connect OpenRouter for hints.");
    expect(script).not.toContain("Connect or enable AI for hints.");
  });

  it("keeps opinion submit, waiting refresh, and force-grade paths wired in the client", () => {
    const script = inlineScript(renderedViewer());

    expect(script).toContain('/api/apps/ruby-high/chat/opinion-submit');
    expect(script).toContain('event === "waiting" || event === "opinion-graded"');
    expect(script).toContain("refreshSessionAfterStreamEvent();");
    expect(script).toContain("body: JSON.stringify({ force: true })");
    expect(script).toContain("opinionGradeFired = true");
  });

  it("keeps stream refreshes from holding the Chat/Practice busy lock", () => {
    const script = inlineScript(renderedViewer());
    const consumeStart = script.indexOf("async function consumeSseStream");
    const consumeEnd = script.indexOf("async function sendChatMessage");
    const consumeBody = script.slice(consumeStart, consumeEnd);

    expect(script).toContain("function withViewerTimeoutSignal");
    expect(script).toContain("const SESSION_REFRESH_TIMEOUT_MS = 8000");
    expect(script).toContain("function createViewerApiClient");
    expect(script).toContain("const apiClient = createViewerApiClient");
    expect(script).toContain("function imageRequestId(prefix)");
    expect(script).toContain("function createViewerTurnController");
    expect(script).toContain("const turnController = createViewerTurnController");
    expect(script).toContain("function syncNextButtonDisabled()");
    expect(script).toContain("const manualTurn = turnController.beginManual()");
    expect(script).toContain("const agentTurn = turnController.beginAgent(false)");
    expect(script).toContain("const buttonTurn = turnController.beginButtonAction()");
    expect(script).toContain("turnController.syncControls()");
    expect(script).toContain("if (!els.chatInput.disabled) els.chatInput.focus();");
    expect(script).not.toContain("els.chatInput.disabled = !teacherChatEnabled()");
    expect(consumeBody).toContain("refreshSessionAfterStreamEvent();");
    expect(consumeBody).not.toContain("await fetchSession(");
    expect(script).not.toContain("let agentBusy =");
    expect(script).not.toContain("let manualChatBusy =");
  });

  it("keeps SSE streams bounded so stale network reads cannot hold the UI lock forever", () => {
    const script = inlineScript(renderedViewer());

    expect(script).toContain("function chatStreamStillCurrent(opts)");
    expect(script).toContain("const watchdog = setTimeout");
    expect(script).toContain("reader.cancel()");
    expect(script).toContain("clearTimeout(watchdog)");
    expect(script).toContain("opts.streamSeq !== state.streamSeq");
    expect(script).toContain("turnController.nextStreamGuard(targetFaculty)");
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
    expect(script).toContain('walletSummaryText(t)');
    expect(script).toContain('" Merit Stars · "');
  });

  it("keeps answer reveals until player advance and uses room completion dots", () => {
    const script = inlineScript(renderedViewer());

    expect(script).not.toContain("clearResolvedBoardAfterTeacherTurn");
    expect(script).toContain("function buildRoomCompletionMeter(fac)");
    expect(script).toContain("function earnedCourseGrade(progress)");
    expect(script).toContain("function subjectProgressShortLabel(progress)");
    expect(script).toContain("if (phase === \"revealed\")");
    expect(script).not.toContain("subjectMark.textContent = fac.courseGrade");
    expect(script).not.toContain("const grade = spec.grade || \"F\"");
    expect(script).not.toContain("(\" + cg.grade + \")");
    expect(cssRule(".channel-row.room-row")).toContain("min-height: 52px");
    expect(cssRule(".room-row-meta")).toContain("flex-direction: column");
  });

  it("uses one teacher pfp source for channel thumbs and class chat bubbles", () => {
    const script = inlineScript(renderedViewer());

    expect(script).toContain("function teacherSmallAvatarUrl(facultyOrId)");
    expect(script).toContain('return teacherPortraitUrl(facultyOrId, "face");');
    expect(script).toContain("avatarImgSrc = teacherSmallAvatarUrl(facultyId)");
    expect(script).toContain("const thumbUrl = teacherSmallAvatarUrl(fac);");
    expect(script).toContain('+ ":" + (f.assetTeacherId || "") + ":" + (f.profileImageUrl || "")');
    expect(script).not.toContain("function teacherStickerUrl");
    expect(script).not.toContain('avatarImgSrc = teacherPortraitUrl(facultyId, "")');
  });

  it("routes bug reports through the first-party issue endpoint", () => {
    const html = renderedViewer();
    const script = inlineScript(html);

    expect(html).toContain('title="Something broken? Send a bug report."');
    expect(html).toContain('id="bug-report-form"');
    expect(script).toContain('apiBase + "/bug-report"');
    expect(script).toContain("RECENT_ERRORS");
    expect(script).not.toContain("github.com/cenetex/app-ruby-high/issues/new");
    expect(script).not.toContain("mailto:hello@ratimics.com");
  });

  it("keeps the pack library as one-click rows without install vocabulary", () => {
    const html = renderedViewer();
    const script = inlineScript(html);

    expect(html).toContain("Click a pack to use it in the classroom.");
    expect(cssRule(".pack-grid")).toContain("display: flex");
    expect(cssRule(".pack-grid")).toContain("flex-direction: column");
    expect(cssRule(".pack-grid")).not.toContain("grid-template-columns");
    expect(cssRule(".pack-card-item")).toContain("grid-template-columns: minmax(0, 1fr) auto");
    expect(script).toContain('card.addEventListener("click", () => {');
    expect(script).toContain('state.textContent = pack.active ? "Using now" : "Use"');
    expect(script).toContain('"Switching classroom pack..."');
    expect(script).toContain("async function deleteLibraryPack");
    expect(script).toContain("deleteDraftPack");
    expect(script).toContain("deletePublishedPack");
    expect(script).toContain("pack.canDelete");
    expect(script).toContain("pack.draftId || pack.id");
    expect(cssRule(".pack-card-actions .pack-action.danger")).toContain("#ff8c8c");
    expect(script).not.toContain('document.createTextNode("Enabled")');
    expect(script).not.toContain("togglePackInstall");
    expect(script).not.toContain("activeBtn.textContent");
    expect(script).not.toContain('"Activating pack..."');
    expect(script).not.toContain('"Active pack switched. Reloading..."');
  });

  it("opens New Teacher as a card-based teacher roll before saving", () => {
    const script = inlineScript(renderedViewer());

    expect(script).toContain("function startDraftTeacherCreation()");
    expect(script).toContain("Teacher Roll");
    expect(script).toContain("teacher-image-preset");
    expect(script).toContain("Custom");
    expect(script).toContain('saveBtn.textContent = "Save"');
    expect(script).toContain("teacher-button-spinner");
    expect(script).toContain("function cancelTeacherImageGeneration");
    expect(script).toContain("confirmHostedCreditSpend");
    expect(script).toContain("Hosted image generation spends");
    expect(script).toContain("Cancel generation");
    expect(script).toContain("function updatePendingTeacherRollField");
    expect(script).toContain("profileImageUrl = regen.has(\"image\") ? \"\" : (prev.profileImageUrl || \"\")");
    expect(script).toContain("function openRouterAiEnabled()");
    expect(script).toContain('openRouterGenerationMessage("generating teacher images")');
    expect(script).toContain("/api/apps/ruby-high/chat/teacher/portrait");
    expect(script).toContain('requestId: imageRequestId("teacher-portrait")');
    expect(script).toContain('requestId: imageRequestId("character-portrait")');
    expect(script).toContain('requestId: imageRequestId("diploma")');
    expect(script).toContain("stats: pendingTeacherRoll.stats");
    expect(script).toContain("subject: pendingTeacherRoll.subject");
    expect(script).toContain("quote: pendingTeacherRoll.quote");
    expect(script).toContain('makeRow("Stats", "stats", buildTeacherStatPills(roll.stats)');
    expect(script).toContain("input.disabled = packImportBusy");
    expect(script).toContain("saveBtn.disabled = packImportBusy || pendingTeacherImageBusy || packQuestionGenerationBusy");
    expect(script).toContain("clientRequestId: prev.clientRequestId || newPackClientRequestId(\"teacher\")");
    expect(script).toContain("retryPackNetworkWrite(\"Adding teacher\"");
    expect(script).toContain("friendlyFetchFailureMessage(err)");
    expect(script).not.toContain('addBtn.textContent = "Add Teacher"');
    expect(script).not.toContain('cancelBtn.textContent = "Cancel"');
    expect(script).not.toContain('body: JSON.stringify({ displayName: "New Teacher" })');
  });

  it("uses paid course generation for draft pack setup", () => {
    const html = renderedViewer();
    const script = inlineScript(html);

    expect(html).toContain('id="pack-course-generator"');
    expect(html).toContain('id="course-materials-input"');
    expect(html).toContain('id="course-generation-progress"');
    expect(html).toContain('id="course-generation-checklist"');
    expect(html).toContain("Add course materials here");
    expect(html).toContain("Generate (3 Hall Passes)");
    expect(html).toContain('id="course-generate-btn"');
    expect(html).toContain('class="pack-teacher-tab pack-new-teacher-tab"');
    expect(html).toContain('class="pack-teacher-avatar pack-new-teacher-avatar">+</span>');
    expect(script).toContain("async generateCourse(draftId, payload, options)");
    expect(script).toContain('"/course/generate"');
    expect(script).toContain("COURSE_GENERATION_HALL_PASS_COST = 3");
    expect(script).toContain("COURSE_GENERATION_STEPS");
    expect(script).toContain("Generate teacher portrait");
    expect(script).toContain("function startCourseGenerationProgress()");
    expect(script).toContain("function finishCourseGenerationProgress()");
    expect(script).toContain("function generateCourseFromMaterials()");
    expect(script).toContain("function runCourseGeneration(teacher)");
    expect(script).toContain('label.textContent = packQuestionGenerationBusy ? "Generating" : "Generate (3 Hall Passes)"');
    expect(script).toContain("teacherGenerateQuestionsBtn.disabled = packImportBusy || packQuestionGenerationBusy || !selectedDraftTeacher() || !canGenerateCourse");
    expect(script).toContain("applyHallPassBalance(data.hallPasses, data.entitlements)");
    expect(script).toContain("function deleteDraftTeacher(teacherId)");
    expect(script).toContain("packStudioClient.deleteTeacher");
    expect(script).toContain("function editDraftTeacher(teacherId)");
    expect(script).toContain('selectDraftTeacher(teacherId, { tab: "settings", focus: true })');
    expect(script).toContain('edit.textContent = "Edit"');
    expect(script).toContain('del.textContent = "Delete"');
    expect(script).toContain("Cancel generation before closing.");
    expect(script).not.toContain("Generate Questions");
  });

  it("routes the post-class Practice button to a practice board or teacher advance", () => {
    const script = inlineScript(renderedViewer());

    expect(script).toContain("async function startPostClassPractice(postClass)");
    expect(script).toContain('type: "pick"');
    expect(script).toContain('mode: "practice"');
    expect(script).toContain("faculty: lastTelemetry && lastTelemetry.faculty");
    expect(script).toContain('intent: "advance"');
    expect(script).toContain('runAgentTurn("manual"');
    expect(script).toContain("if (postClass.report)");
    expect(script).toContain("function subjectDisplayName(fid, progress)");
    expect(script).toContain("subjectDisplayName(cg.facultyId, cg.progress)");
  });

  it("builds the class report with full-body teacher standee art and a score metric", () => {
    const script = inlineScript(renderedViewer());

    expect(script).toContain("function buildClassReportCard");
    expect(script).toContain("function shouldShowClassReport");
    expect(script).toContain("shownClassReportKey = classReportKey(lastTelemetry)");
    expect(script).toContain("class-report-teacher-art");
    expect(script).toContain('teacherAssetUrl(artAssetId, "full-sticker")');
    expect(script).toContain('addMetric("score"');
    expect(script).not.toContain('addMetric("score / grade"');
    expect(script).not.toContain('addMetric("questions"');
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
