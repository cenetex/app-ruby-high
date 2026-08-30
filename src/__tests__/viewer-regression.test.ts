import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderViewerHtml } from "../viewer.js";
import { VIEWER_CSS } from "../viewer-parts/css.js";

const PRIVY_CLIENT_SOURCE = readFileSync(new URL("../viewer-privy-client.ts", import.meta.url), "utf8");

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

function compactScript(value: string): string {
  return value.replace(/\s+/g, "");
}

function expectScriptToContain(script: string, snippet: string): void {
  const compact = compactScript(snippet);
  expect(
    compactScript(script).includes(compact),
    `missing script snippet: ${snippet}`,
  ).toBe(true);
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
  it("gives the labyrinth fixed actions instead of a writing field", () => {
    const html = renderedViewer();
    const script = inlineScript(html);

    expect(html).toContain('id="labyrinth-attribute-grid"');
    expect(html).toContain('id="labyrinth-exit-grid"');
    expect(html).not.toContain('id="labyrinth-action-input"');
    expectScriptToContain(script, 'const moves = [');
    expectScriptToContain(script, '{ id: "head", label: "HEAD"');
    expectScriptToContain(script, '{ id: "heart", label: "HEART"');
    expectScriptToContain(script, '{ id: "hustle", label: "HUSTLE"');
    expectScriptToContain(script, '{ id: "honor", label: "HONOR"');
    expectScriptToContain(script, 'els.typedAnswerForm.hidden = active');
  });

  it("renders parseable inline JS with the critical offline boot and PWA paths", () => {
    const script = inlineScript(renderedViewer());

    expect(() => new Function(script)).not.toThrow();
    expectScriptToContain(script, "/api/apps/ruby-high/auth/guest");
    expectScriptToContain(script, '["localhost", "127.0.0.1", "::1"].includes(window.location.hostname)');
    expectScriptToContain(script, "navigator.serviceWorker.getRegistrations()");
    expectScriptToContain(script, 'navigator.serviceWorker.register(apiBase + "/service-worker.js", { scope: apiBase + "/" })');
    expectScriptToContain(script, "reg.update().catch");
    expectScriptToContain(script, "async function bootInitialSession()");
    expectScriptToContain(script, "function consumeSharedPackFlag()");
    expectScriptToContain(script, 'url.searchParams.get("pack")');
    expectScriptToContain(script, "async function applySharedPackFromUrl(packId)");
    expectScriptToContain(script, "await packStudioClient.installPack(cleanPackId, true)");
    expectScriptToContain(script, "await packStudioClient.setActivePack(cleanPackId)");
    const boot = script.slice(script.indexOf("async function bootInitialSession()"));
    expect(boot.indexOf("await deriveAuth();")).toBeLessThan(boot.indexOf('postViewerMetricEvent("app_open"'));
    expect(boot.indexOf('postViewerMetricEvent("app_open"')).toBeLessThan(boot.indexOf("await fetchSession();"));
    expect(boot.indexOf("await fetchSession();")).toBeLessThan(boot.indexOf("await applySharedPackFromUrl(sharedPackId);"));
    expectScriptToContain(script, "SESSION_RESUME_INACTIVE_MS");
    expectScriptToContain(script, 'postViewerMetricEvent("session_resume"');
    expectScriptToContain(script, 'document.addEventListener("visibilitychange"');
    expectScriptToContain(script, 'window.addEventListener("focus"');
    expectScriptToContain(script, 'window.addEventListener("pageshow"');
  });

  it("captures only bounded acquisition keys and routes the canonical landing into student creation", () => {
    const script = inlineScript(renderedViewer());

    expectScriptToContain(script, "function consumeAcquisitionAttribution()");
    expectScriptToContain(script, '["rh_source", "rh_campaign", "rh_landing", "rh_entry"]');
    expectScriptToContain(script, 'quickRollExperimentLanding = acquisitionAttribution.landingVariant === "quick-roll-v1"');
    expectScriptToContain(script, "Create a student. Complete one class. Get your report.");
    expectScriptToContain(script, "t.current || t.active_round || quickRollExperimentLanding");
    expectScriptToContain(script, 'postViewerMetricEvent("app_open", acquisitionAttribution || {})');
    expectScriptToContain(script, 'keys.forEach((key) => url.searchParams.delete(key))');
    expect(script).not.toContain("document.referrer");
  });

  it("uses an in-app confirmation dialog instead of native browser prompts", () => {
    const html = renderedViewer();
    const script = inlineScript(html);

    expect(html).toContain('id="app-confirm-overlay"');
    expect(html).toContain('role="dialog"');
    expectScriptToContain(script, "function confirmInApp(options)");
    expectScriptToContain(script, "return confirmInApp({");
    expect(VIEWER_CSS).toContain(".app-confirm-overlay");
    expect(VIEWER_CSS).toContain("white-space: pre-line");
    expect(script).not.toContain("window.confirm");
    expect(script).not.toContain("window.alert");
    expect(script).not.toContain("window.prompt");
  });

  it("keeps browser zoom available and makes every sheet keyboard-modal", () => {
    const html = renderedViewer();
    const script = inlineScript(html);

    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />');
    expect(html).not.toContain("maximum-scale");
    expect(html).not.toContain("user-scalable=no");
    expect(script).not.toContain("gesturestart");
    expect(script).not.toContain("gesturechange");
    expect(script).not.toContain('addEventListener("dblclick"');
    expect(VIEWER_CSS).toContain("body { touch-action: auto; }");
    expect(VIEWER_CSS).not.toContain("touch-action: pan-x pan-y");
    expect(VIEWER_CSS).not.toContain("touch-action: manipulation");

    for (const overlayId of [
      "signin-overlay",
      "privy-overlay",
      "sheet-overlay",
      "billing-overlay",
      "bug-report-overlay",
      "pack-overlay",
      "pack-edit-overlay",
    ]) {
      expect(html).toMatch(new RegExp(`id="${overlayId}"[^>]*role="dialog"[^>]*aria-modal="true"`));
    }
    expectScriptToContain(script, "function openViewerModal(overlay, options)");
    expectScriptToContain(script, "function closeViewerModal(overlay, fallbackFocus)");
    expectScriptToContain(script, 'if (!event || event.key !== "Tab") return');
    expectScriptToContain(script, 'els.shell.setAttribute("inert", "")');
  });

  it("uses semantic, named buttons for profile and reroll actions", () => {
    const html = renderedViewer();
    const script = inlineScript(html);

    expect(html).toContain('<button class="you-profile" id="you-profile" type="button" aria-label="Open student card">');
    expectScriptToContain(script, 'els.youProfile.setAttribute("aria-label", "Open " + t.character.name + "\'s student card")');
    expectScriptToContain(script, 'reroll.setAttribute("aria-label", "Try another " + label.toLowerCase())');
    expectScriptToContain(script, 'button.className = "teacher-profile-button"');
    expectScriptToContain(script, 'roomButton.className = "room-row-button"');
  });

  it("omits the legacy School World panel from the main viewer", () => {
    const html = renderedViewer();
    const script = inlineScript(html);
    const clientSource = readFileSync(new URL("../viewer-parts/client.ts", import.meta.url), "utf8");

    expect(html).not.toContain('id="world-panel"');
    expect(html).not.toContain("School World");
    expect(VIEWER_CSS).not.toContain(".world-panel");
    expect(VIEWER_CSS).not.toContain(".world-event-row");
    expect(script).not.toContain("function createViewerWorldController");
    expect(script).not.toContain("function createViewerWorldPanelController");
    expect(script).not.toContain("function renderWorldPanel");
    expect(clientSource).not.toContain("const worldController = createViewerWorldController({");
    expect(clientSource).not.toContain("worldController.attach();");
  });

  it("keeps the board and conversation as separate mobile panes", () => {
    expect(VIEWER_CSS).toContain("@media (max-width: 600px)");
    expect(VIEWER_CSS).toContain("--composer-min: 50px");
    expect(cssRule("main.workspace")).toContain("grid-template-rows: auto auto 1fr auto");
    expect(cssRule(".blackboard-panel")).toContain("overflow: hidden");
    expect(cssRule(".answers-host")).toContain("overflow-y: auto");
    expect(cssRule(".stream")).toContain("overflow-y: auto");
    expect(cssRule(".blackboard-meta .pill.class-mode")).toContain("order: -1");
    expect(cssRule(".blackboard-meta .pill.faculty")).toContain("display: none");
    expect(VIEWER_CSS).not.toContain('.shell[data-mode="round-live"] .world-panel');
  });

  it("shows compacted context, recent conversation, and roll results without scene chrome", () => {
    const html = renderedViewer();
    const script = inlineScript(html);
    const boardAt = html.indexOf('id="blackboard-panel"');
    const streamAt = html.indexOf('id="stream"');

    expect(boardAt).toBeGreaterThan(-1);
    expect(streamAt).toBeGreaterThan(boardAt);
    expect(html).not.toContain('id="classroom-scroll"');
    expect(html).not.toContain('id="scene-summary"');
    expect(html).not.toContain('id="dialogue-log"');
    expect(html).not.toContain('id="scene-latest"');
    expect(VIEWER_CSS).toContain(".conversation-summary");
    expectScriptToContain(script, "function setDialogueCompaction(summary)");
    expectScriptToContain(script, 'node.textContent = "Earlier conversation: " + summary');
    expectScriptToContain(script, 'event === "summary"');
    expectScriptToContain(script, "appendResultChip(t.lastReveal)");
    expectScriptToContain(script, "appendSocialSummary(t.lastReveal, t)");
    expect(script).not.toContain("function archiveLiveDialogue");
    expect(script).not.toContain("function renderSceneSummary");
  });

  it("keeps compact class-flow controls readable, focusable, and viewport-safe", () => {
    const html = renderedViewer();
    const script = inlineScript(html);

    expect(html).toContain(">Create my student</button>");
    expect(html).toContain("Free · no sign-up needed · starts now");
    expect(html).toContain('<svg aria-hidden="true"');
    expect(VIEWER_CSS).toContain("--text-dim:");
    expect(VIEWER_CSS).toContain("--border:");
    expect(VIEWER_CSS).toContain("--bg-card:");
    expect(VIEWER_CSS).toContain("--focus-ring:");
    expect(VIEWER_CSS).toContain("--text-mute: #9ba4ba");
    expect(cssRule(".response-card-grid button")).toContain("min-height: 62px");
    expect(html).toContain('class="response-stepper"');
    expect(html).toContain('<legend class="visually-hidden">Claim</legend>');
    expect(html).toContain('<legend class="visually-hidden">Position</legend>');
    expect(html).not.toContain("Build a case");
    expect(html).not.toContain("No typing");
    expect(html).not.toContain("nothing typed");
    expect(html).not.toContain("Tap a choice to edit");
    expect(VIEWER_CSS).toContain('body :focus-visible:not([disabled]):not([tabindex="-1"])');
    expect(cssRule(".congrats-toast")).toContain("white-space: normal");
    expect(cssRule(".announcements-panel")).toContain("max-height: calc(100dvh");
    expect(cssRule(".announcements-panel")).toContain("overflow-y: auto");
    expect(cssRule(".announcements-panel")).toContain("overflow-x: hidden");
    expect(cssRule(".answer.is-correct")).toContain("opacity: 1");
    expect(cssRule(".answer.C")).toContain("color: #1a2238");
    expectScriptToContain(script, 'status.className = "visually-hidden"');
    expectScriptToContain(script, 'item.setAttribute("aria-current", "step")');
  });

  it("keeps mobile navigation explicit and keyboard-dismissible", () => {
    const html = renderedViewer();
    const script = inlineScript(html);

    expect(html).toContain('id="channels-close"');
    expect(html).toContain('aria-label="Close navigation"');
    expect(html).toContain('aria-controls="channels-rail"');
    expect(html).toContain('aria-expanded="false"');
    expectScriptToContain(script, "function setRailsOpen(open)");
    expectScriptToContain(script, "function syncRailsAccessibility(open)");
    expectScriptToContain(script, 'els.hamburger.setAttribute("aria-expanded", String(open))');
    expectScriptToContain(script, 'els.workspace.toggleAttribute("inert", overlaysWorkspace)');
    expectScriptToContain(script, 'desktopRailsQuery.addEventListener("change", (event) => setRailsOpen(event.matches))');
    expectScriptToContain(script, 'ev.key === "Escape" && window.matchMedia("(max-width: 1099px)").matches');
    expect(cssRule(".channels-close")).toContain("position: absolute");
    expect(cssRule(".onboarding-alt")).toContain("box-shadow: none");
  });

  it("builds the race strip from typed view models", () => {
    const script = inlineScript(renderedViewer());
    const clientSource = readFileSync(new URL("../viewer-parts/client.ts", import.meta.url), "utf8");

    expectScriptToContain(script, "function raceStripView");
    expectScriptToContain(script, "function raceStripPickText");
    expectScriptToContain(script, "function createRaceStripRenderer(deps)");
    expectScriptToContain(clientSource, "const raceStripRenderer = createRaceStripRenderer({");
    expectScriptToContain(clientSource, "viewFor: raceStripView");
    expectScriptToContain(clientSource, "raceStripRenderer.render(t, {");
    expect(clientSource).not.toContain("for (const c of view.cards)");
    expect(clientSource).not.toContain("lt.textContent = c.pickText;");
    expect(clientSource).not.toContain("if (c.showThinking) {");
  });

  it("builds shared CCG character cards from a typed renderer", () => {
    const script = inlineScript(renderedViewer());
    const clientSource = readFileSync(new URL("../viewer-parts/client.ts", import.meta.url), "utf8");

    expectScriptToContain(script, "function createCcgCardRenderer(");
    expectScriptToContain(clientSource, "const ccgCardRenderer = createCcgCardRenderer({");
    expectScriptToContain(clientSource, "return ccgCardRenderer.buildCharacterCard(spec);");
    expectScriptToContain(script, "ccg-card-actions");
    expectScriptToContain(script, "ccg-footer-content");
    const buildCharacterStart = clientSource.indexOf("function buildCharacterCard(spec)");
    const buildCharacterEnd = clientSource.indexOf("const SUBJECT_GATE_ICONS", buildCharacterStart);
    const buildCharacterSource = clientSource.slice(buildCharacterStart, buildCharacterEnd);
    expect(buildCharacterSource).not.toContain('card.className = "ccg-card";');
    expect(buildCharacterSource).not.toContain('actionsRow.className = "ccg-card-actions";');
  });

  it("builds career cards and metric rows from a typed renderer", () => {
    const script = inlineScript(renderedViewer());
    const clientSource = readFileSync(new URL("../viewer-parts/client.ts", import.meta.url), "utf8");

    expectScriptToContain(script, "function createCareerCardRenderer(");
    expectScriptToContain(script, "function createCareerTokensRenderer(");
    expectScriptToContain(clientSource, "const careerCardRenderer = createCareerCardRenderer({");
    expectScriptToContain(clientSource, "const careerTokensRenderer = createCareerTokensRenderer({");
    expectScriptToContain(clientSource, "return careerCardRenderer.buildProfileCard(spec);");
    expectScriptToContain(clientSource, "return careerCardRenderer.buildSchoolCard({");
    expectScriptToContain(clientSource, "return careerCardRenderer.buildMetrics(rows);");
    expectScriptToContain(clientSource, "return careerTokensRenderer.build(spec);");
    expectScriptToContain(script, 'row.className = "career-metric" + (m.met ? " is-met" : "");');
    expectScriptToContain(script, 'chip.className = "career-multiplier is-live is-bonus";');
    const profileCareerStart = clientSource.indexOf("function buildProfileCareerCard(spec)");
    const profileCareerEnd = clientSource.indexOf("function buildCareerTokens", profileCareerStart);
    const profileCareerSource = clientSource.slice(profileCareerStart, profileCareerEnd);
    expect(profileCareerSource).not.toContain('card.className = "ccg-card is-career-card";');
    expect(profileCareerSource).not.toContain('metrics.className = "career-metrics";');
    const careerTokensStart = clientSource.indexOf("function buildCareerTokens(spec)");
    const careerTokensEnd = clientSource.indexOf("function buildCompletedHighSchoolProgression", careerTokensStart);
    const careerTokensSource = clientSource.slice(careerTokensStart, careerTokensEnd);
    expect(careerTokensSource).not.toContain('wrap.className = "career-token-strip";');
    expect(careerTokensSource).not.toContain('dice.className = "career-dice";');
    const schoolCareerStart = clientSource.indexOf("function buildCareerCard(c, graduated)");
    const schoolCareerEnd = clientSource.indexOf("function comicCollectionForTelemetry", schoolCareerStart);
    const schoolCareerSource = clientSource.slice(schoolCareerStart, schoolCareerEnd);
    expect(schoolCareerSource).not.toContain('card.className = "ccg-card is-career-card"');
    expect(schoolCareerSource).not.toContain('ns.className = "ccg-next-step";');
  });

  it("builds sealed paper cards from a typed renderer", () => {
    const script = inlineScript(renderedViewer());
    const clientSource = readFileSync(new URL("../viewer-parts/client.ts", import.meta.url), "utf8");

    expectScriptToContain(script, "function createPaperCardRenderer(");
    expectScriptToContain(clientSource, "const paperCardRenderer = createPaperCardRenderer({");
    expectScriptToContain(clientSource, "return paperCardRenderer.build(entry, liveChar, livePb, playbooks);");
    expectScriptToContain(script, 'card.classList.add("is-paper-card");');
    const paperCardStart = clientSource.indexOf("function buildPaperCard(entry, liveChar, livePb, playbooks)");
    const paperCardEnd = clientSource.indexOf("// formatSealedDate, fmtStat are in client-pure.", paperCardStart);
    const paperCardSource = clientSource.slice(paperCardStart, paperCardEnd);
    expect(paperCardSource).not.toContain("const sealedSubtitle");
    expect(paperCardSource).not.toContain("const card = buildCharacterCard");
  });

  it("builds student pool cards from a typed renderer", () => {
    const script = inlineScript(renderedViewer());
    const clientSource = readFileSync(new URL("../viewer-parts/client.ts", import.meta.url), "utf8");

    expectScriptToContain(script, "function createStudentPoolCardRenderer(");
    expectScriptToContain(clientSource, "const studentPoolCardRenderer = createStudentPoolCardRenderer({");
    expectScriptToContain(clientSource, "return studentPoolCardRenderer.build(pool, playbooks);");
    expectScriptToContain(script, 'card.className = "ccg-card is-student-pool-card";');
    const studentPoolStart = clientSource.indexOf("function buildStudentPoolCard(pool, playbooks)");
    const studentPoolEnd = clientSource.indexOf("// ── Social card grid", studentPoolStart);
    const studentPoolSource = clientSource.slice(studentPoolStart, studentPoolEnd);
    expect(studentPoolSource).not.toContain('list.className = "student-pool-list";');
    expect(studentPoolSource).not.toContain("pool.slice(0, 8).forEach");
  });

  it("builds social card grids from a typed renderer", () => {
    const script = inlineScript(renderedViewer());
    const clientSource = readFileSync(new URL("../viewer-parts/client.ts", import.meta.url), "utf8");

    expectScriptToContain(script, "function createMashGridRenderer(");
    expectScriptToContain(clientSource, "const mashGridRenderer = createMashGridRenderer({");
    expectScriptToContain(clientSource, "return mashGridRenderer.build(c, graduated);");
    expectScriptToContain(script, 'tile.className = "mash-tile";');
    const mashGridStart = clientSource.indexOf("function buildMashGrid(c, graduated)");
    const mashGridEnd = clientSource.indexOf("function essayReportsForCard()", mashGridStart);
    const mashGridSource = clientSource.slice(mashGridStart, mashGridEnd);
    expect(mashGridSource).not.toContain('tile.className = "mash-tile";');
    expect(mashGridSource).not.toContain('tag.className = "mash-resolved-axis";');
  });

  it("builds teacher roll controls from a typed renderer", () => {
    const script = inlineScript(renderedViewer());
    const clientSource = readFileSync(new URL("../viewer-parts/client.ts", import.meta.url), "utf8");

    expectScriptToContain(script, "function createTeacherRollControlsRenderer(");
    expectScriptToContain(clientSource, "const teacherRollControlsRenderer = createTeacherRollControlsRenderer({");
    expectScriptToContain(clientSource, "return teacherRollControlsRenderer.build({");
    expectScriptToContain(script, 'controlsCard.className = "ccg-card is-career-card is-creation-control-card";');
    expect(clientSource.indexOf("const teacherRollControlsRenderer = createTeacherRollControlsRenderer({"))
      .toBeGreaterThan(clientSource.indexOf("const PREGENERATED_TEACHER_ASSETS = ["));
    const controlsStart = clientSource.indexOf("function buildTeacherRollControls()");
    const controlsEnd = clientSource.indexOf("function renderNewTeacherCreation()", controlsStart);
    const controlsSource = clientSource.slice(controlsStart, controlsEnd);
    expect(controlsSource).not.toContain('controlsCard.className = "ccg-card is-career-card is-creation-control-card";');
    expect(controlsSource).not.toContain('choices.className = "teacher-image-presets";');
  });

  it("builds teacher creation decks from a typed renderer", () => {
    const script = inlineScript(renderedViewer());
    const clientSource = readFileSync(new URL("../viewer-parts/client.ts", import.meta.url), "utf8");

    expectScriptToContain(script, "function createTeacherCreationDeckRenderer(");
    expectScriptToContain(clientSource, "const teacherCreationDeckRenderer = createTeacherCreationDeckRenderer({");
    expectScriptToContain(clientSource, "packTeacherDetailEl.appendChild(teacherCreationDeckRenderer.build({");
    expectScriptToContain(script, 'wrap.className = "pack-teacher-roll-deck";');
    const deckStart = clientSource.indexOf("function renderNewTeacherCreation()");
    const deckEnd = clientSource.indexOf("async function generateTeacherImageForPendingRoll()", deckStart);
    const deckSource = clientSource.slice(deckStart, deckEnd);
    expect(deckSource).not.toContain('actionsRow.className = "ccg-card-actions";');
    expect(deckSource).not.toContain('saveBtn.className = "primary teacher-save-button";');
  });

  it("refreshes teacher creation previews from a typed updater", () => {
    const script = inlineScript(renderedViewer());
    const clientSource = readFileSync(new URL("../viewer-parts/client.ts", import.meta.url), "utf8");

    expectScriptToContain(script, "function createTeacherPreviewUpdater(");
    expectScriptToContain(clientSource, "const teacherPreviewUpdater = createTeacherPreviewUpdater({");
    expectScriptToContain(clientSource, "teacherPreviewUpdater.refresh(packTeacherDetailEl, pendingTeacherRoll);");
    expectScriptToContain(script, 'const card = root.querySelector(".is-creation-candidate-card");');
    const refreshStart = clientSource.indexOf("function refreshPendingTeacherPreview()");
    const refreshEnd = clientSource.indexOf("function setPackEditorTabsHidden(hidden)", refreshStart);
    const refreshSource = clientSource.slice(refreshStart, refreshEnd);
    expect(refreshSource).not.toContain('card.querySelector(".ccg-name")');
    expect(refreshSource).not.toContain('renderMarkdownInto(quoteEl');
  });

  it("builds teacher stat pills from a typed renderer", () => {
    const script = inlineScript(renderedViewer());
    const clientSource = readFileSync(new URL("../viewer-parts/client.ts", import.meta.url), "utf8");

    expectScriptToContain(script, "function createTeacherStatPillsRenderer(");
    expectScriptToContain(clientSource, "const teacherStatPillsRenderer = createTeacherStatPillsRenderer({");
    expectScriptToContain(clientSource, "return teacherStatPillsRenderer.build(stats);");
    expectScriptToContain(script, 'wrap.className = "teacher-stat-pills";');
    const statsStart = clientSource.indexOf("function buildTeacherStatPills(stats)");
    const statsEnd = clientSource.indexOf("function differentTeacherAsset(currentAssetId)", statsStart);
    const statsSource = clientSource.slice(statsStart, statsEnd);
    expect(statsSource).not.toContain('wrap.className = "teacher-stat-pills";');
    expect(statsSource).not.toContain('pill.className = "pill stat "');
  });

  it("computes teacher image status from a typed view model", () => {
    const script = inlineScript(renderedViewer());
    const clientSource = readFileSync(new URL("../viewer-parts/client.ts", import.meta.url), "utf8");

    expectScriptToContain(script, "function createTeacherImageStatusView(");
    expectScriptToContain(clientSource, "const teacherImageStatusView = createTeacherImageStatusView({");
    expectScriptToContain(clientSource, "return teacherImageStatusView.reason({");
    expectScriptToContain(clientSource, "return teacherImageStatusView.creditHint({");
    expectScriptToContain(script, "Sign in before generating teacher images.");
    const reasonStart = clientSource.indexOf("function teacherImageGenerationStatusReason()");
    const reasonEnd = clientSource.indexOf("function teacherImageCreditHint()", reasonStart);
    const reasonSource = clientSource.slice(reasonStart, reasonEnd);
    expect(reasonSource).not.toContain('return "Sign in before generating teacher images."');
    expect(reasonSource).not.toContain('openRouterGenerationMessage("generating teacher images")');
  });

  it("builds profile card copy from typed view models", () => {
    const script = inlineScript(renderedViewer());
    const clientSource = readFileSync(new URL("../viewer-parts/client.ts", import.meta.url), "utf8");

    expectScriptToContain(script, "function createProfileCardView(");
    expectScriptToContain(clientSource, "const profileCardView = createProfileCardView({");
    expectScriptToContain(clientSource, "return profileCardView.roomLabel(roomId);");
    expectScriptToContain(clientSource, "profileCardView.teacherProfileCard(fac, teacherFullPortraitUrl(fac.id))");
    expectScriptToContain(clientSource, "profileCardView.teacherCareerCard(fac)");
    expectScriptToContain(clientSource, "profileCardView.studentProfileCard({");
    expectScriptToContain(clientSource, "profileCardView.studentCareerCard({");
    expectScriptToContain(script, "Science Lab · physics, chemistry, biology, and Earth science");
    expectScriptToContain(script, "Every wrong answer has a half-truth folded inside it. We start there.");
    expect(clientSource).not.toContain("const TEACHER_SUBJECT_LINE =");
    expect(clientSource).not.toContain("function studentVibe(id)");
    expect(clientSource).not.toContain("function buildProgressionForNpcArc(");
  });

  it("renders chat messages from a typed renderer", () => {
    const script = inlineScript(renderedViewer());
    const clientSource = readFileSync(new URL("../viewer-parts/client.ts", import.meta.url), "utf8");

    expectScriptToContain(script, "function createChatMessageRenderer(");
    expectScriptToContain(clientSource, "const chatMessageRenderer = createChatMessageRenderer({");
    expectScriptToContain(clientSource, "const rendered = chatMessageRenderer.buildMessage({ kind, name, body, color, avatarUrl: avatarImgSrc });");
    expectScriptToContain(clientSource, "const wrap = chatMessageRenderer.buildSystem(text);");
    expectScriptToContain(clientSource, "const wrap = chatMessageRenderer.buildTool(text);");
    expectScriptToContain(clientSource, "const wrap = chatMessageRenderer.buildEmptyState({ title, body, ctaLabel, ctaAction, heroSrc });");
    expectScriptToContain(script, 'tag.className = "role-tag " + (kind === "teacher" ? "bot" : kind);');
    expectScriptToContain(script, 'body.dataset.markdownRaw = deps.sanitizeVisibleChatText(spec.body || "");');
    expect(clientSource).not.toContain('wrap.className = "msg " + (kind || "bot");');
    expect(clientSource).not.toContain('tag.className = "role-tag bot"');
    expect(clientSource).not.toContain('wrap.innerHTML =');
    expect(clientSource).not.toContain('bodyEl.dataset.markdownRaw = sanitizeVisibleChatText(body || "");');
  });

  it("renders reveal feedback from a typed renderer", () => {
    const script = inlineScript(renderedViewer());
    const clientSource = readFileSync(new URL("../viewer-parts/client.ts", import.meta.url), "utf8");

    expectScriptToContain(script, "function createRevealFeedbackRenderer(");
    expectScriptToContain(clientSource, "const revealFeedbackRenderer = createRevealFeedbackRenderer({");
    expectScriptToContain(clientSource, "const wrap = revealFeedbackRenderer.buildSocialSummary(events);");
    expectScriptToContain(clientSource, "const wrap = revealFeedbackRenderer.buildResult(reveal, questionCounter, relationshipEventsForQuestion(reveal && reveal.questionId));");
    expectScriptToContain(script, 'wrap.className = "msg social-summary";');
    expectScriptToContain(script, 'name.textContent = "Classmate Note";');
    expectScriptToContain(script, 'wrap.className = "msg result class-note-result";');
    expectScriptToContain(script, 'main.className = "class-note-main";');
    expectScriptToContain(script, 'receipts.className = "class-note-receipts";');
    expect(clientSource).not.toContain('function appendMashTickChips');
    expect(clientSource).not.toContain('wrap.className = "msg social-summary";');
    expect(clientSource).not.toContain('wrap.className = "msg result";');
    expect(clientSource).not.toContain('badge.className = "badge-mini " + (reveal.wasCorrect ? "ok" : "bad");');
    expect(script).not.toContain("mash-tick-chip");
  });

  it("builds report cards from a typed renderer", () => {
    const script = inlineScript(renderedViewer());
    const clientSource = readFileSync(new URL("../viewer-parts/client.ts", import.meta.url), "utf8");

    expectScriptToContain(script, "function createReportCardRenderer(");
    expectScriptToContain(clientSource, "const reportCardRenderer = createReportCardRenderer({");
    expectScriptToContain(clientSource, "return reportCardRenderer.buildEntry(report);");
    expectScriptToContain(clientSource, "return reportCardRenderer.buildCard(essayReportsForCard());");
    expectScriptToContain(script, 'card.className = "ccg-card is-report-card";');
    const reportCardStart = clientSource.indexOf("function buildReportCard()");
    const reportCardEnd = clientSource.indexOf("// ── School Career Card builder", reportCardStart);
    const reportCardSource = clientSource.slice(reportCardStart, reportCardEnd);
    expect(reportCardSource).not.toContain('list.className = "report-list";');
    expect(reportCardSource).not.toContain("const avg = essayAverage");
  });

  it("renders character creation stat chips from a typed renderer", () => {
    const script = inlineScript(renderedViewer());
    const clientSource = readFileSync(new URL("../viewer-parts/client.ts", import.meta.url), "utf8");

    expectScriptToContain(script, "function createCreationStatsRenderer(");
    expectScriptToContain(clientSource, "const creationStatsRenderer = createCreationStatsRenderer({");
    expectScriptToContain(clientSource, "creationStatsRenderer.renderInto(parent, stats);");
    expectScriptToContain(script, 'wrap.className = "stat";');
    const creationStatsStart = clientSource.indexOf("function renderCreationStatsInto(parent, stats)");
    const creationStatsEnd = clientSource.indexOf("function renderRolled(c)", creationStatsStart);
    const creationStatsSource = clientSource.slice(creationStatsStart, creationStatsEnd);
    expect(creationStatsSource).not.toContain('wrap.className = "stat";');
    expect(creationStatsSource).not.toContain('ve.className = "v"');
  });

  it("renders character creation reroll rows from a typed renderer", () => {
    const script = inlineScript(renderedViewer());
    const clientSource = readFileSync(new URL("../viewer-parts/client.ts", import.meta.url), "utf8");

    expectScriptToContain(script, "function createCreationRowsRenderer(");
    expectScriptToContain(clientSource, "const creationRowsRenderer = createCreationRowsRenderer({");
    expectScriptToContain(clientSource, "return creationRowsRenderer.buildRow(fields, label, key);");
    expectScriptToContain(script, 'row.className = "creation-row";');
    const makeRowStart = clientSource.indexOf("function makeRow(label, key)");
    const makeRowEnd = clientSource.indexOf('const nameRow = makeRow("Name", "name");', makeRowStart);
    const makeRowSource = clientSource.slice(makeRowStart, makeRowEnd);
    expect(makeRowSource).not.toContain('row.className = "creation-row";');
    expect(makeRowSource).not.toContain('reroll.className = "creation-reroll";');
  });

  it("renders character creation candidate cards from a typed renderer", () => {
    const script = inlineScript(renderedViewer());
    const clientSource = readFileSync(new URL("../viewer-parts/client.ts", import.meta.url), "utf8");

    expectScriptToContain(script, "function createCreationCandidateCardRenderer(");
    expectScriptToContain(clientSource, "const creationCandidateCardRenderer = createCreationCandidateCardRenderer({");
    expectScriptToContain(clientSource, "const candidateCardRefs = creationCandidateCardRenderer.build();");
    expectScriptToContain(script, 'card.className = "ccg-card is-character-card is-creation-candidate-card student-setup";');
    const creationStart = clientSource.indexOf("function renderSheetCreation(playbooks)");
    const controlsStart = clientSource.indexOf("const controlsCard = document.createElement", creationStart);
    const creationCandidateSource = clientSource.slice(creationStart, controlsStart);
    expect(creationCandidateSource).not.toContain('candidateCard.className = "ccg-card is-character-card is-creation-candidate-card";');
    expect(creationCandidateSource).not.toContain('candidateActions.className = "ccg-card-actions";');
  });

  it("renders character creation control cards from a typed renderer", () => {
    const script = inlineScript(renderedViewer());
    const clientSource = readFileSync(new URL("../viewer-parts/client.ts", import.meta.url), "utf8");

    expectScriptToContain(script, "function createCreationControlCardRenderer(");
    expectScriptToContain(clientSource, "const creationControlCardRenderer = createCreationControlCardRenderer({");
    expectScriptToContain(clientSource, "const controlsCardRefs = creationControlCardRenderer.build({");
    expectScriptToContain(script, 'card.className = "ccg-card is-career-card is-creation-control-card student-setup-options";');
    const controlsStart = clientSource.indexOf("const controlsSubtitle =");
    const controlsEnd = clientSource.indexOf("// Control rows:", controlsStart);
    const controlsSource = clientSource.slice(controlsStart, controlsEnd);
    expect(controlsSource).not.toContain('controlsCard.className = "ccg-card is-career-card is-creation-control-card";');
    expect(controlsSource).not.toContain('status.className = "stat-budget";');
  });

  it("renders character creation intro and loading panels from a typed renderer", () => {
    const script = inlineScript(renderedViewer());
    const clientSource = readFileSync(new URL("../viewer-parts/client.ts", import.meta.url), "utf8");

    expectScriptToContain(script, "function createCreationIntroRenderer(");
    expectScriptToContain(clientSource, "const creationIntroRenderer = createCreationIntroRenderer({");
    expectScriptToContain(clientSource, "creationIntroRenderer.renderInto(sheetCard);");
    expectScriptToContain(script, 'loading.className = "creation-loading";');
    const creationStart = clientSource.indexOf("function renderSheetCreation(playbooks)");
    const candidateStart = clientSource.indexOf("const candidateCardRefs = creationCandidateCardRenderer.build();", creationStart);
    const introSource = clientSource.slice(creationStart, candidateStart);
    expect(introSource).not.toContain('loading.className = "creation-loading";');
    expect(introSource).not.toContain('explanation.className = "creation-explanation";');
  });

  it("presents rolled character creation data from a typed renderer", () => {
    const script = inlineScript(renderedViewer());
    const clientSource = readFileSync(new URL("../viewer-parts/client.ts", import.meta.url), "utf8");

    expectScriptToContain(script, "function createCreationRollPresenter(");
    expectScriptToContain(clientSource, "const creationRollPresenter = createCreationRollPresenter({");
    expectScriptToContain(clientSource, "creationRollPresenter.renderRolled(c, playbooks, {");
    expectScriptToContain(script, "candidate.subtitle.textContent = (pb.name || c.playbookId || \"Student\")");
    const renderRolledStart = clientSource.indexOf("function renderRolled(c)");
    const renderRolledEnd = clientSource.indexOf("async function rollComponents", renderRolledStart);
    const renderRolledSource = clientSource.slice(renderRolledStart, renderRolledEnd);
    expect(renderRolledSource).not.toContain("candidateSubtitle.textContent");
    expect(renderRolledSource).not.toContain("statsRow.val.textContent");
  });

  it("renders graduation ceremony shells from a typed renderer", () => {
    const script = inlineScript(renderedViewer());
    const clientSource = readFileSync(new URL("../viewer-parts/client.ts", import.meta.url), "utf8");

    expectScriptToContain(script, "function createGraduationCeremonyRenderer(");
    expectScriptToContain(clientSource, "const graduationCeremonyRenderer = createGraduationCeremonyRenderer({");
    expectScriptToContain(clientSource, "return graduationCeremonyRenderer.build({");
    expectScriptToContain(script, 'wrap.className = spec.onBoard ? "graduation-board-card" : "graduation-ceremony";');
    const ceremonyStart = clientSource.indexOf("function buildGraduationCeremony(c, grade, opts)");
    const ceremonyEnd = clientSource.indexOf("// Fisher-Yates", ceremonyStart);
    const ceremonySource = clientSource.slice(ceremonyStart, ceremonyEnd);
    expect(ceremonySource).not.toContain('hero.className = "graduation-board-hero";');
    expect(ceremonySource).not.toContain('btn.className = "graduation-choice";');
  });

  it("builds blackboard question prompts from typed view models", () => {
    const script = inlineScript(renderedViewer());
    const clientSource = readFileSync(new URL("../viewer-parts/client.ts", import.meta.url), "utf8");

    expectScriptToContain(script, "function questionPromptView");
    expectScriptToContain(clientSource, "const view = questionPromptView(question);");
    expectScriptToContain(clientSource, "view.images.forEach((asset) =>");
    expectScriptToContain(clientSource, "img.src = asset.src;");
    expectScriptToContain(clientSource, "renderMarkdownInto(text, view.prompt);");
  });

  it("builds leaderboard rows from typed view models", () => {
    const script = inlineScript(renderedViewer());
    const clientSource = readFileSync(new URL("../viewer-parts/client.ts", import.meta.url), "utf8");

    expectScriptToContain(script, "function leaderboardView");
    expectScriptToContain(script, "function leaderboardRowView");
    expectScriptToContain(script, "function leaderboardGradeChips");
    expectScriptToContain(script, "function createLeaderboardPanelRenderer(deps)");
    expectScriptToContain(clientSource, "const leaderboardPanelRenderer = createLeaderboardPanelRenderer({");
    expectScriptToContain(clientSource, "viewFor: leaderboardView");
    expectScriptToContain(clientSource, 'honorRow.addEventListener("click", () => showLeaderboard());');
    expectScriptToContain(clientSource, "leaderboardPanelRenderer.render(data, playbooks);");
    const enterLoungeStart = clientSource.indexOf("async function enterLounge()");
    const showLeaderboardStart = clientSource.indexOf("async function showLeaderboard()");
    const postClassStart = clientSource.indexOf("async function startPostClassPractice");
    expect(enterLoungeStart).toBeGreaterThan(-1);
    expect(showLeaderboardStart).toBeGreaterThan(enterLoungeStart);
    expect(postClassStart).toBeGreaterThan(showLeaderboardStart);
    expect(clientSource.slice(enterLoungeStart, showLeaderboardStart).trimEnd()).toMatch(/closeRails\(\);\s*}$/);
    expect(clientSource).not.toContain("header.appendChild(document.createTextNode(view.gradeLabel + \" Classroom \"));");
    expect(clientSource).not.toContain("view.rows.forEach((s) =>");
    expect(clientSource).not.toContain("header.innerHTML = labels[grade]");
  });

  it("builds the top-bar arc indicator from typed view models", () => {
    const script = inlineScript(renderedViewer());
    const clientSource = readFileSync(new URL("../viewer-parts/client.ts", import.meta.url), "utf8");

    expectScriptToContain(script, "function arcIndicatorView");
    expectScriptToContain(script, "function createArcIndicatorRenderer(deps)");
    expectScriptToContain(clientSource, "const arcIndicatorRenderer = createArcIndicatorRenderer({");
    expectScriptToContain(clientSource, "viewFor: arcIndicatorView");
    expectScriptToContain(clientSource, "arcIndicatorRenderer.render(t, {");
    expect(clientSource).not.toContain("walletText: walletSummaryText(t)");
    expect(clientSource).not.toContain("arcScore");
    expect(clientSource).not.toContain("els.arcIndicator.classList.toggle(\"is-graduated\", view.graduated);");
    expect(clientSource).not.toContain("els.arcStreak.classList.toggle(\"is-met\", view.streakMet);");
    expect(clientSource).not.toContain("els.arcXp.classList.toggle(\"is-met\", view.subjectMet);");
  });

  it("builds classmate arc labels and meters from typed helpers", () => {
    const script = inlineScript(renderedViewer());
    const clientSource = readFileSync(new URL("../viewer-parts/client.ts", import.meta.url), "utf8");

    expectScriptToContain(script, "function classmateArcStanding");
    expectScriptToContain(script, "function classmateArcSubtitle");
    expectScriptToContain(script, "function classmateArcProgress");
    expectScriptToContain(script, "function classmateArcProgressLabel");
    expectScriptToContain(script, "function roomCompletionProgressView");
    expectScriptToContain(script, "function roomCompletionProgressLabel");
    expectScriptToContain(script, "function roomChannelRowViews");
    expectScriptToContain(script, "function createRoomChannelRowsController");
    expectScriptToContain(script, "function createClassmateChannelRowsRenderer(");
    expectScriptToContain(clientSource, "return classmateArcSubtitle(entry, currentGrade");
    expectScriptToContain(clientSource, "return classmateArcProgress(entry);");
    expectScriptToContain(clientSource, "return classmateArcProgressLabel(progress);");
    expectScriptToContain(clientSource, "return roomCompletionProgressView(fac);");
    expectScriptToContain(clientSource, "return roomCompletionProgressLabel(fac, progress);");
    expectScriptToContain(clientSource, "const railHumanStudents = publicRoomStudentsForRail(t);");
    expectScriptToContain(clientSource, "const roomViews = roomChannelRowViews(t.rooms || [], roster, cohort, t.faculty, STUDENTS, visibleStudentIds, railHumanStudents);");
    expectScriptToContain(clientSource, "roomChannelRowsController.appendRows(els.channelsList, roomViews, roster);");
    expectScriptToContain(clientSource, "const classmateChannelRowsRenderer = createClassmateChannelRowsRenderer({");
    expectScriptToContain(clientSource, "classmateChannelRowsRenderer.appendSection(els.channelsList, classmateChannelGroups(t, grade));");
    expect(clientSource).not.toContain('row.className = "channel-row student-row";');
    expect(clientSource).not.toContain('meter.className = "student-year-meter";');
  });

  it("keeps human sidebar room placement tied to server presence, not chat history", () => {
    const clientSource = readFileSync(new URL("../viewer-parts/client.ts", import.meta.url), "utf8");

    expectScriptToContain(clientSource, "function publicRoomStudentsForRail(t)");
    expectScriptToContain(clientSource, "(Array.isArray(t && t.public_room_students) ? t.public_room_students : []).forEach(add);");
    expectScriptToContain(clientSource, "function openHumanStudentProfile(human)");
    expectScriptToContain(clientSource, 'if ((npc && npc.kind === "human") || (s && s.kind === "human"))');
    expectScriptToContain(clientSource, 'if (record && record.kind === "human")');
    expectScriptToContain(clientSource, "openHumanStudentProfile(record);");
    expectScriptToContain(clientSource, "const chatHistoryHumanStudentsByFaculty = new Map();");
    expectScriptToContain(clientSource, "function loadRoomHumanHistories(t)");
    expectScriptToContain(clientSource, "chatHistoryHumanStudentsByFaculty.forEach((rows) =>");
    expect(clientSource).not.toContain("chatRoomHumanStudentsByFaculty");
  });

  it("keeps lounge mode out of the empty-board class-start CTA", () => {
    const script = readFileSync(new URL("../viewer-parts/client.ts", import.meta.url), "utf8");

    expectScriptToContain(script, 'const isLounge = !!((faculty && faculty.id === LOUNGE_ID) || (!faculty && lastTelemetry && lastTelemetry.faculty === LOUNGE_ID));');
    expectScriptToContain(script, "Lounge mode: hide blackboard and show the faculty lounge roster.");
    expectScriptToContain(script, "t.faculty === LOUNGE_ID ? \"teachers' lounge\"");
    expectScriptToContain(script, 'const roster = (t.faculty_roster || []).filter((f) => f && f.id !== LOUNGE_ID);');
  });

  it("wires the Privy account UI through the lazy widget bundle", () => {
    const html = renderedViewer({ privy: { appId: "privy-app-test", clientId: "privy-client-test", loginMethods: ["wallet"] } });
    const script = inlineScript(html);
    const clientSource = readFileSync(new URL("../viewer-parts/client.ts", import.meta.url), "utf8");

    expect(() => new Function(script)).not.toThrow();
    expect(html).toContain('id="privy-action"');
    expect(html).not.toContain('id="hall-pass-btn"');
    expect(html).toContain('id="signin-privy"');
    expect(html).toContain('id="privy-overlay"');
    expect(html).not.toContain('id="privy-phantom-login"');
    expect(html).toContain('id="privy-login-widget"');
    expect(html).not.toContain('id="privy-connect-solana"');
    expect(html).not.toContain('id="account-ai-use-pass"');
    expect(html).not.toContain('id="account-ai-action"');
    expect(html).not.toContain('id="account-use-pass"');
    expect(html).toContain('id="account-buy-passes"');
    expect(html).toContain('id="account-buy-card-packs"');
    expect(script).not.toContain("hallPassBtn");
    expect(VIEWER_CSS).not.toContain(".hall-pass-btn");
    expect(html).not.toContain('id="pack-btn"');
    expect(html).not.toContain("Packs &amp; collectibles");
    expect(html).not.toContain('id="arc-score"');
    expect(html).not.toContain('id="account-get-ruby"');
    expect(html).not.toContain("Get $RUBY");
    expect(html).toContain("Show My Student");
    expect(html).toContain("permanently destroy one collectible card");
    expect(html).toContain('id="account-create-character"');
    expect(html).toContain('id="account-history-list"');
    expect(html).toContain('id="account-comics"');
    expectScriptToContain(script, "function welcomeHallPassPopupView(");
    expectScriptToContain(script, "function createWelcomeHallPassPopupRenderer(");
    expectScriptToContain(clientSource, "const welcomeHallPassPopupRenderer = createWelcomeHallPassPopupRenderer({");
    expectScriptToContain(clientSource, "welcomeHallPassPopupRenderer.show(grant, opts);");
    expect(clientSource).not.toContain('overlay.className = "welcome-hall-pass-popup";');
    expect(script).not.toContain("function accountAiPanelView(aiInput, opts)");
    expect(clientSource).not.toContain("const view = accountAiPanelView(ai, {");
    expectScriptToContain(script, "function accountWalletPanelView(walletInput, slotsInput, opts)");
    expectScriptToContain(clientSource, "const view = accountWalletPanelView(walletNumbers(lastTelemetry || {}), slots, {");
    expectScriptToContain(script, "function accountTrustPanelView(payloadInput, connectedWalletInput, buildIdInput)");
    expectScriptToContain(clientSource, "const view = accountTrustPanelView(payload, connectedWallet, buildId || \"dev\");");
    expectScriptToContain(script, "function accountHallPassCardsPanelView(");
    expectScriptToContain(script, "function createAccountHallPassCardsPanelRenderer(");
    expectScriptToContain(clientSource, "const accountHallPassCardsRenderer = createAccountHallPassCardsPanelRenderer({");
    expectScriptToContain(clientSource, "accountHallPassCardsRenderer.render({");
    expectScriptToContain(script, "function accountHallPassPackTileView(packInput, opts)");
    expectScriptToContain(script, "function accountHallPassCardTileView(cardInput)");
    expectScriptToContain(script, "function createAccountCardReaderRenderer(");
    expectScriptToContain(clientSource, "const accountCardReaderRenderer = createAccountCardReaderRenderer({");
    expectScriptToContain(clientSource, "accountCardReaderRenderer.show(card);");
    expectScriptToContain(script, "function hallPassCardProfile(cardInput)");
    expectScriptToContain(script, "function accountHallPassCardReaderView(cardInput, opts)");
    expect(clientSource).not.toContain('overlay.className = "account-card-reader";');
    expect(clientSource).not.toContain("function buildHallPassStats(stats)");
    expectScriptToContain(script, "function billingCardBurnChoiceView(opts)");
    expectScriptToContain(script, "buildCardBurnChoice(opts)");
    expectScriptToContain(clientSource, "return billingProductsRenderer.buildCardBurnChoice({");
    expectScriptToContain(script, "function accountComicPanelView(collectionInput)");
    expectScriptToContain(script, "function createAccountComicPanelRenderer(");
    expectScriptToContain(script, "function createComicReaderRenderer(");
    expectScriptToContain(clientSource, "const comicReaderRenderer = createComicReaderRenderer({");
    expectScriptToContain(clientSource, "comicReaderRenderer.show(collection, unlock, options);");
    expectScriptToContain(clientSource, "const accountComicRenderer = createAccountComicPanelRenderer({");
    expectScriptToContain(clientSource, "accountComicRenderer.render(comicCollectionForTelemetry());");
    expect(clientSource).not.toContain('overlay.className = "comic-reader"');
    expect(clientSource).not.toContain('panel.className = "comic-reader-panel";');
    expectScriptToContain(script, "function accountCharacterCardView(entry, slotNumber, playbooks, currentGrade, fallbackPortraitUrl)");
    expectScriptToContain(script, "function accountEmptyCharacterSlotView(slotNumber, canCreateCharacter)");
    expectScriptToContain(script, "function accountCharacterPanelView(slotsInput, walletInput, opts)");
    expectScriptToContain(script, "function createAccountCharacterPanelRenderer(");
    expectScriptToContain(clientSource, "const accountCharacterRenderer = createAccountCharacterPanelRenderer({");
    expectScriptToContain(clientSource, "accountCharacterRenderer.render({");
    expectScriptToContain(script, "function accountHistoryRowView(tx)");
    expectScriptToContain(script, "function createAccountHistoryPanelRenderer(deps)");
    expectScriptToContain(clientSource, "const accountHistoryRenderer = createAccountHistoryPanelRenderer({");
    expectScriptToContain(clientSource, "accountHistoryRenderer.render(wallet.transactions, { limit: 18 });");
    expectScriptToContain(script, '"build":"dev"');
    expectScriptToContain(script, '"privyConfig":{"appId":"privy-app-test","clientId":"privy-client-test","loginMethods":["wallet"]}');
    expectScriptToContain(script, 'const PRIVY_CLIENT_URL = apiBase + "/assets/privy-client.global.js?v=" + encodeURIComponent(buildId)');
    expectScriptToContain(script, 'const PRIVY_CLIENT_GLOBAL = "RubyHighPrivyClientModule"');
    expectScriptToContain(script, "loadScriptGlobal(PRIVY_CLIENT_URL, PRIVY_CLIENT_GLOBAL)");
    expectScriptToContain(script, "createRubyHighPrivyClient(privyConfig)");
    expect(script).not.toContain("const loadViewerModule = (url) => import(url)");
    expect(script).not.toContain("loadViewerModule(PRIVY_CLIENT_URL)");
    expectScriptToContain(script, "client.login()");
    expectScriptToContain(script, "client.onDiagnostic(reportPrivyDiagnostic)");
    expectScriptToContain(script, 'postViewerMetricEvent("privy_auth_error"');
    expectScriptToContain(script, "client.connectSolanaWallet()");
    expectScriptToContain(script, "function reportPrivyDiagnostic(event)");
    expectScriptToContain(script, "startPrivyLogin");
    expectScriptToContain(script, "startSolanaWalletConnect");
    expectScriptToContain(script, "function friendlyPrivyAccountError(err, fallback)");
    expectScriptToContain(script, "Wallet sign-in is not available. Contact Ruby High support.");
    expect(script).not.toContain('reportStatus(err && err.message ? err.message : "Privy sign-in failed", true)');
    expect(script).not.toContain("client.loginWithPhantom()");
    expect(script).not.toContain("function phantomWalletAvailable()");
    expect(script).not.toContain("Trying Phantom directly...");
    expect(script).not.toContain("startPhantomLogin");
    expectScriptToContain(script, 'apiBase + "/auth/privy"');
    expectScriptToContain(script, "initializePrivyFromStoredSession();");
    expect(script).not.toContain("sendEmailCode");
    expect(script).not.toContain("loginWithEmailCode");
  });

  it("keeps browser-owned OpenRouter keys session-scoped unless persistence is explicit", () => {
    const script = inlineScript(renderedViewer());
    const clientSource = readFileSync(new URL("../viewer-parts/client.ts", import.meta.url), "utf8");

    expectScriptToContain(clientSource, "const AUTH_KEY = \"rh_openrouter_key\"");
    expectScriptToContain(clientSource, "const AUTH_PERSIST = \"rh_openrouter_persist\"");
    expectScriptToContain(clientSource, "return kind === \"local\" ? window.localStorage : window.sessionStorage;");
    expectScriptToContain(clientSource, "function persistentApiKeyStorageEnabled()");
    expectScriptToContain(clientSource, "return storageGet(\"local\", AUTH_PERSIST) === \"1\";");
    expectScriptToContain(clientSource, "function migrateLegacyLocalAuthToSession()");
    expectScriptToContain(clientSource, "if (persistentApiKeyStorageEnabled()) return;");
    expectScriptToContain(clientSource, "storageSet(\"session\", AUTH_KEY, key);");
    expectScriptToContain(clientSource, "storageRemove(\"local\", AUTH_KEY);");
    expectScriptToContain(script, "migrateLegacyLocalAuthToSession();");
    expect(script).not.toContain('localStorage.setItem("rh_openrouter_key"');
  });

  it("keeps Stripe Hall Pass checkout separate from Solana pack checkout", () => {
    const script = inlineScript(renderedViewer({ privy: { appId: "privy-app-test", clientId: "privy-client-test" } }));
    const clientSource = readFileSync(new URL("../viewer-parts/client.ts", import.meta.url), "utf8");

    expectScriptToContain(script, "function connectedSolanaWalletAddress()");
    expectScriptToContain(script, "function selectBillingProduct(productId)");
    expectScriptToContain(script, "function renderAccountHallPassCards()");
    expect(script).not.toContain("DEFAULT_RUBY_TOKEN_MINT");
    expect(script).not.toContain("JUPITER_SOL_TO_RUBY_SWAP_PREFIX");
    expect(script).not.toContain("rubyTokenSwapLink");
    expect(script).not.toContain("getRubyLink: els.accountGetRuby");
    expect(script).not.toContain("configureGetRubyLink,");
    expectScriptToContain(script, "async function ensureSolanaWalletFromAccount()");
    expectScriptToContain(script, "function confirmWalletTransactionPreview(opts)");
    expectScriptToContain(script, "function nftHttpErrorMessage(action, response, data, unchanged)");
    expectScriptToContain(script, "function friendlySolanaActionError(err, unchanged)");
    expectScriptToContain(script, "Ruby High never asks for a seed phrase.");
    expectScriptToContain(script, "Your card was not minted; try again in a minute.");
    expectScriptToContain(script, "accountHallPassCards");
    expectScriptToContain(script, 'buy.addEventListener("click", () => deps.onSelectProduct(recordValue(product, "id")))');
    expectScriptToContain(script, 'mode === "card-packs"');
    expectScriptToContain(script, "function billingProductRowView(");
    expectScriptToContain(script, "function createBillingProductsRenderer(");
    expectScriptToContain(clientSource, "const billingProductsRenderer = createBillingProductsRenderer({");
    expectScriptToContain(clientSource, "billingProductsRenderer.buildProductRow(mode, product, solana, {");
    expectScriptToContain(script, "function billingProductsPanelView(");
    expectScriptToContain(script, "const panelView = billingProductsPanelView(mode, payload, solana, {");
    expectScriptToContain(script, "buildCardPackPaymentChoice(solana, product)");
    expectScriptToContain(script, "buildBillingPaymentChoice(payload, product)");
    expectScriptToContain(script, "function billingHallPassPaymentChoiceView(");
    expectScriptToContain(script, "buildHallPassPaymentChoice(payload, product, opts)");
    expectScriptToContain(clientSource, "return billingProductsRenderer.buildHallPassPaymentChoice(payload, product, { billingBusy });");
    expectScriptToContain(script, "function billingCardPackPaymentChoiceView(");
    expectScriptToContain(script, "buildCardPackPaymentChoice(solana, product, opts)");
    expectScriptToContain(clientSource, "return billingProductsRenderer.buildCardPackPaymentChoice(solana, product, { billingBusy });");
    expect(script).not.toContain("billingRubyMigrationChoiceView");
    expect(script).not.toContain("billing-ruby-migration");
    expect(clientSource).not.toContain("migrateRubyFromBilling");
    expect(clientSource).not.toContain("/billing/ruby-migration/quote");
    expect(clientSource).not.toContain('panel.className = "billing-payment-choice";');
    expect(clientSource).not.toContain('row.className = "billing-product";');
    expect(script).not.toContain("buildGetRubyLink");
    expectScriptToContain(script, "Collectible-pack checkout is not available in this preview.");
    expect(VIEWER_CSS).toContain(".billing-payment-note");
    expect(VIEWER_CSS).not.toContain(".billing-costs .get-ruby-link");
    expect(VIEWER_CSS).not.toContain(".account-section-head .account-token-link");
    expect(VIEWER_CSS).toContain(".account-hall-pass-card");
    expect(script).not.toContain('"Buy " + formatWholeNumber(product.hallPasses || 0) + " Hall Passes."');
    expect(script).not.toContain("Number(entry.hallPasses");
    expectScriptToContain(script, "async function ensureSolanaWalletForBilling(opts)");
    expectScriptToContain(script, "function connectedSolanaWalletAddress() {\n    return privyState.solanaWalletAddress || null;\n  }");
    expectScriptToContain(script, "function knownSolanaOwnerWalletAddress()");
    expectScriptToContain(script, "function appendSolanaProofLink(parent, address, label)");
    expectScriptToContain(script, "function createAccountTrustPanelRenderer(deps)");
    expectScriptToContain(clientSource, "const accountTrustRenderer = createAccountTrustPanelRenderer({");
    expectScriptToContain(clientSource, "accountTrustRenderer.render(view);");
    expectScriptToContain(script, '"Connect a Solana wallet to open packs and reveal Cards."');
    expectScriptToContain(script, '"Signed in · no Solana wallet"');
    expectScriptToContain(script, "function hallPassPacksForTelemetry(t)");
    expectScriptToContain(script, 'pack.status !== "void"');
    expectScriptToContain(script, "function buildPack(pack, opts)");
    expectScriptToContain(script, "No collectible packs or cards in this wallet yet.");
    expectScriptToContain(script, "async function openHallPassPackFromAccount(packId)");
    expectScriptToContain(script, 'apiBase + "/nft/open-pack"');
    expectScriptToContain(script, 'prompt: "You should not need to sign a wallet transaction to open this pack."');
    expectScriptToContain(script, "async function syncWalletPackNftsFromAccount(opts)");
    expectScriptToContain(script, 'apiBase + "/nft/sync-packs"');
    expectScriptToContain(script, "const removedCount = Math.max(0, Math.floor(Number(data.removedCount || 0)))");
    expectScriptToContain(script, 'void syncWalletPackNftsFromAccount({ force: true })');
    expectScriptToContain(script, 'return kind === "active" ? PACK_NFT_ART_URL : PACK_OPENED_NFT_ART_URL;');
    expectScriptToContain(script, "item.className = view.className");
    expectScriptToContain(script, '"These collectible packs are stored on Solana. Open one to reveal five Ruby High cards immediately."');
    expectScriptToContain(script, '"Opened collectible pack"');
    expectScriptToContain(script, '"View pack on Solscan"');
    expectScriptToContain(script, "item.className = view.className");
    expectScriptToContain(script, 'item.type = "button"');
    expectScriptToContain(script, 'item.addEventListener("click", () => deps.openCard(card));');
    expectScriptToContain(script, '"Face-down collectible · reveal on Solana · #"');
    expectScriptToContain(script, '"View Collectible on Solscan"');
    expectScriptToContain(script, "function showHallPassCardReader(card)");
    expectScriptToContain(script, "mintCard: mintHallPassCardFromAccount");
    expectScriptToContain(script, "const render = (nextCard, opts)");
    expectScriptToContain(script, 'const revealedCard = await deps.mintCard(recordValue(currentCard, "id"))');
    expectScriptToContain(script, "render(revealedCard, { flip: true, revealed: true })");
    expectScriptToContain(script, "function hallPassCardById(cardId)");
    expectScriptToContain(script, "function hallPassCardNftImageUrl(card)");
    expectScriptToContain(script, "Opening your pack and revealing five collectible cards...");
    expectScriptToContain(script, 'const PACK_NFT_ART_URL = apiBase + "/assets/nft/ruby-high-pack.png?v=pack-nft-v2"');
    expectScriptToContain(script, 'const PACK_OPENED_NFT_ART_URL = apiBase + "/assets/nft/ruby-high-pack-opened.png?v=opened-v2"');
    expectScriptToContain(script, 'const CARD_BACK_ART_URL = apiBase + "/assets/nft/ruby-high-card-back.png?v=card-back-v1"');
    expectScriptToContain(script, 'const CARD_NFT_ART_VERSION = "card-crop-v1"');
    expectScriptToContain(script, 'apiBase + "/assets/nft/market-cards/"');
    // HALL_PASS_CARDS_PER_PACK is now declared via VIEWER_CONSTANTS destructure
    // by viewer-parts/script.ts → client-pure.ts. Assert both halves so the
    // binding is visible to the IIFE scope at runtime.
    expectScriptToContain(script, '"HALL_PASS_CARDS_PER_PACK":5');
    expect(script).toMatch(/const \{[^}]*\bHALL_PASS_CARDS_PER_PACK\b[^}]*\} = VIEWER_CONSTANTS/);
    expectScriptToContain(script, "function createPackMintProgressController(deps)");
    expectScriptToContain(script, "const packMintProgressController = createPackMintProgressController({");
    expectScriptToContain(script, "function showPackMintProgress(message, options)");
    expectScriptToContain(script, "packMintProgressController.show(message, options)");
    expectScriptToContain(script, "packMintProgressController.update(message)");
    expectScriptToContain(script, "packMintProgressController.hide(delayMs)");
    expectScriptToContain(script, "Creating your collectible pack...");
    expectScriptToContain(script, "Preparing your collectible card...");
    expectScriptToContain(script, "rotate: false");
    expectScriptToContain(script, "updatePackMintProgress(\"Review the card-creation transaction in your wallet...\")");
    expectScriptToContain(script, "setPrivyStatus(\"Review the collectible-card transaction in your wallet.\", false)");
    expect(script).not.toContain("Review the mint preview...");
    expect(script).not.toContain("Confirm the mint in your wallet...");
    expect(clientSource).not.toContain('overlay.className = "pack-mint-overlay";');
    const hallPassRendererConfig = script.slice(
      script.indexOf("const accountHallPassCardsRenderer = createAccountHallPassCardsPanelRenderer({"),
      script.indexOf("const roomChannelRowsController = createRoomChannelRowsController({"),
    );
    expect(hallPassRendererConfig).toContain("PACK_NFT_ART_URL");
    expect(hallPassRendererConfig).toContain("PACK_OPENED_NFT_ART_URL");
    expect(hallPassRendererConfig).toContain("CARD_BACK_ART_URL");
    expect(hallPassRendererConfig).not.toContain("WELCOME_HALL_PASS_ART_URL");
    expect(hallPassRendererConfig).not.toContain("faceDown ? PACK_NFT_ART_URL");
    expect(VIEWER_CSS).toContain(".pack-mint-overlay");
    expect(VIEWER_CSS).toContain("z-index: 130");
    expect(VIEWER_CSS).toContain(".account-pack-tile");
    expect(VIEWER_CSS).toContain(".account-card-tile");
    expect(VIEWER_CSS).toContain(".account-chain-link");
    expect(VIEWER_CSS).toContain("grid-template-columns: repeat(auto-fill, minmax(72px, 1fr))");
    expect(VIEWER_CSS).toContain(".account-card-reader");
    expect(VIEWER_CSS).toContain(".account-card-reader-art.is-flipped");
    expect(VIEWER_CSS).toContain("@keyframes accountCardReaderFlip");
    expect(VIEWER_CSS).toContain(".account-card-tile-reveal");
    expect(VIEWER_CSS).toContain("aspect-ratio: 3 / 4");
    expect(VIEWER_CSS).toContain("aspect-ratio: 1122 / 1402");
    expect(script).not.toContain("mintPurchasedHallPassCards");
    expectScriptToContain(script, "function mintPendingCardNftsFromAccount()");
    expectScriptToContain(script, "function mintHallPassCardFromAccount(cardId)");
    expectScriptToContain(script, 'apiBase + "/nft/mint-card-prepare"');
    expectScriptToContain(script, 'apiBase + "/nft/mint-card-submit"');
    expectScriptToContain(script, 'typeof client.signSolanaTransaction !== "function"');
    expectScriptToContain(script, "client.signSolanaTransaction(preparedData.mint)");
    expectScriptToContain(script, "signedTransactionBase64: signed.signedTransactionBase64");
    expect(script).not.toContain('prompt: "Your wallet should show one card-mint transaction."');
    expectScriptToContain(script, "Mint Collectible");
    expectScriptToContain(script, "return hallPassCardById(cleanCardId) || data.card || null");
    expect(script).not.toContain("remove();\n        void mintHallPassCardFromAccount(card.id);");
    expectScriptToContain(script, "Mint the next revealed collectible card on Solana.");
    expect(script).not.toContain("unmintedCardCount");
    expect(script).not.toContain("/nft/mint-pending");
    expect(script).not.toContain("Mint \" + mintableCount + \" Pending");
    expect(script).not.toContain("Burn for 5 Passes");
    expect(script).not.toContain("burnHallPassCardFromAccount");
    expectScriptToContain(script, 'await startPrivyLogin({ source: "billing" })');
    expectScriptToContain(script, 'await startSolanaWalletConnect({ source: "billing" })');
    expectScriptToContain(script, 'typeof client.paySolanaQuote !== "function"');
    expectScriptToContain(script, 'title: "Connect your Solana wallet?"');
    expectScriptToContain(script, 'title: "Pay for this collectible pack?"');
    expectScriptToContain(script, "Your wallet should show the pack price and a small Solana network fee.");
    expectScriptToContain(script, 'setBillingStatus("Preparing collectible-pack payment...", false)');
    expectScriptToContain(script, "let finalBillingStatus = null");
    expectScriptToContain(script, "if (finalBillingStatus) setBillingStatus(finalBillingStatus[0], finalBillingStatus[1])");
    expectScriptToContain(script, "setPrivyStatus(finalBillingStatus[0], finalBillingStatus[1])");
    expect(script).not.toContain("Get $RUBY in the connected wallet, then try again.");
    expectScriptToContain(script, "await client.paySolanaQuote(data)");
    expect(script).not.toContain('"prepare card mint " + prepared.status');
    expect(script).not.toContain('"solana quote " + r.status');
    expect(PRIVY_CLIENT_SOURCE).toContain('useSignTransaction');
    expect(PRIVY_CLIENT_SOURCE).toContain('/billing/solana/submit');
    expect(PRIVY_CLIENT_SOURCE).toContain('signSolanaTransaction');
    expect(script).not.toContain('buy.textContent = "Pay with wallet"');
    expect(script).not.toContain("if (solanaWalletAddress && solana && solana.configured && solanaProducts.length > 0)");
    expect(script).not.toContain("Solana transaction signature");
    expect(script).not.toContain("paste the transaction");
    expect(script).not.toContain("Pay Crypto");
    expectScriptToContain(script, 'setAccountPane("account");');
    expectScriptToContain(script, 'els.accountBuyPasses.addEventListener("click", () => openBilling({ mode: "hall-passes" }))');
    expectScriptToContain(script, "const checkout = cardPackCheckoutState();");
    expectScriptToContain(script, "if (checkout.loaded && !checkout.ready)");
    expectScriptToContain(script, 'openBilling({ mode: "card-packs" })');
  });

  it("shows a thumbnail selector before burning collectible cards", () => {
    const script = inlineScript(renderedViewer({ privy: { appId: "privy-app-test", clientId: "privy-client-test" } }));
    const clientSource = readFileSync(new URL("../viewer-parts/client.ts", import.meta.url), "utf8");

    expectScriptToContain(script, "function selectHallPassCardsForBurn(cards, needed)");
    expectScriptToContain(script, "function createCardBurnSelector(deps)");
    expectScriptToContain(script, "const cardBurnSelector = createCardBurnSelector({");
    expectScriptToContain(script, "return cardBurnSelector.select(cards, needed);");
    expectScriptToContain(script, 'overlay.className = "card-burn-overlay"');
    expectScriptToContain(script, 'grid.className = "card-burn-grid"');
    expectScriptToContain(script, 'thumb.className = "card-burn-thumb"');
    expectScriptToContain(script, "img.src = deps.cardArtUrl(card)");
    expect(clientSource).not.toContain('overlay.className = "card-burn-overlay";');
    expectScriptToContain(script, "const selectedCards = presetCards.length === needed");
    expectScriptToContain(script, "function buildHallPassCardBurnChoice(hallPassesPerBurnedCard)");
    expectScriptToContain(script, "els.billingProducts.appendChild(buildHallPassCardBurnChoice(hallPassesPerBurnedCard))");
    expectScriptToContain(script, "async function burnHallPassCardFromBilling()");
    expectScriptToContain(script, "body: JSON.stringify({ hallPassBurns: burns })");
    expectScriptToContain(script, "async function convertHallPassCardsToHallPasses(count, opts)");
    expectScriptToContain(script, 'apiBase + "/billing/card-burn"');
    expectScriptToContain(script, 'title: selectedCards.length === 1 ? "Permanently destroy this card?"');
    expectScriptToContain(script, "credit: hallPassCostLabel(hallPassBurnCreditForCards(1))");
    expectScriptToContain(script, 'prompt: "Your wallet should show one transaction that permanently destroys this collectible card."');
    expect(VIEWER_CSS).toContain(".card-burn-overlay");
    expect(VIEWER_CSS).toContain(".card-burn-grid");
    expect(VIEWER_CSS).toContain(".card-burn-thumb img");
  });

  it("keeps Privy modal actions from getting stuck while Privy owns Solana wallet selection", () => {
    expect(PRIVY_CLIENT_SOURCE).toContain("toSolanaWalletConnectors({ shouldAutoConnect: true })");
    expect(PRIVY_CLIENT_SOURCE).toContain("getIdentityToken");
    expect(PRIVY_CLIENT_SOURCE).toContain('const RUBY_HIGH_SOLANA_WALLET_LIST: WalletListEntry[] = ["phantom", "solflare", "backpack", "detected_solana_wallets"];');
    expect(PRIVY_CLIENT_SOURCE).toContain('const DEFAULT_RUBY_HIGH_PRIVY_LOGIN_METHODS: RubyHighPrivyLoginMethod[] = ["email", "wallet", "google", "twitter", "passkey"];');
    expect(PRIVY_CLIENT_SOURCE).toContain("const RUBY_HIGH_PRIVY_LOGIN_METHODS");
    expect(PRIVY_CLIENT_SOURCE).toContain("const loginMethods = loginMethodsForConfig(config);");
    expect(PRIVY_CLIENT_SOURCE).toContain("loginMethods,");
    expect(PRIVY_CLIENT_SOURCE).toContain("loginMethods: props.loginMethods,");
    expect(PRIVY_CLIENT_SOURCE).toContain('walletChainType: "solana-only",');
    expect(PRIVY_CLIENT_SOURCE).toContain('walletChainType: "solana-only"');
    expect(PRIVY_CLIENT_SOURCE).toContain("walletList: RUBY_HIGH_SOLANA_WALLET_LIST");
    expect(PRIVY_CLIENT_SOURCE).toContain('showWalletLoginFirst: loginMethods[0] === "wallet"');
    expect(PRIVY_CLIENT_SOURCE).toContain('ethereum: { createOnLogin: "off" }');
    expect(PRIVY_CLIENT_SOURCE).toContain("const SOLANA_WALLET_READY_TIMEOUT_MS = 5_000;");
    expect(PRIVY_CLIENT_SOURCE).toContain("const solanaWalletsRef = useRef<ConnectedStandardSolanaWallet[]>([]);");
    expect(PRIVY_CLIENT_SOURCE).toContain("waitForSolanaWallets(() => solanaWalletsRef.current)");
    expect(PRIVY_CLIENT_SOURCE).toContain("const raw = record.chainType ?? record.chain_type;");
    expect(PRIVY_CLIENT_SOURCE).toContain('return raw === "ethereum" || raw === "solana" ? raw : null;');
    expect(PRIVY_CLIENT_SOURCE).toContain("const solanaWalletAddress = connectedSolanaWalletAddress;");
    expect(PRIVY_CLIENT_SOURCE).toContain("onDiagnostic(listener)");
    expect(PRIVY_CLIENT_SOURCE).toContain("diagnosticFromError");
    expect(PRIVY_CLIENT_SOURCE).toContain("sanitizeDiagnosticEvent");
    expect(PRIVY_CLIENT_SOURCE).toContain("Connect a Solana wallet through Privy to buy Ruby High packs.");
    expect(PRIVY_CLIENT_SOURCE).not.toContain("useLoginWithSiws");
    expect(PRIVY_CLIENT_SOURCE).not.toContain("loginWithPhantom");
    expect(PRIVY_CLIENT_SOURCE).not.toContain("loginWithInjectedPhantom");
    expect(PRIVY_CLIENT_SOURCE).not.toContain("phantom.siws.authenticate.error");
    expect(PRIVY_CLIENT_SOURCE).not.toContain('walletClientType: "phantom"');
    expect(PRIVY_CLIENT_SOURCE).not.toContain('connectorType: "injected"');
    expect(PRIVY_CLIENT_SOURCE).toContain("identityToken");
    expect(PRIVY_CLIENT_SOURCE).not.toContain("linkedSolanaWallet");
    expect(PRIVY_CLIENT_SOURCE).not.toContain("function solanaWalletFromUser");
    expect(PRIVY_CLIENT_SOURCE).toContain("const PRIVY_ACTION_TIMEOUT_MS = 30_000;");
    expect(PRIVY_CLIENT_SOURCE).toContain("Privy sign-in did not open. Refresh Ruby High and try again.");
    expect(PRIVY_CLIENT_SOURCE).toContain("Solana wallet connection did not open. Refresh Ruby High and try again.");
    expect(PRIVY_CLIENT_SOURCE).toContain("Privy connected a wallet, but did not expose a Solana signer.");
    expect(PRIVY_CLIENT_SOURCE).toContain('diagnosticFromError("privy.login.promise_error"');
    expect(PRIVY_CLIENT_SOURCE).toContain("rejectPendingLogin(err);");
    expect(PRIVY_CLIENT_SOURCE).toContain("Promise.resolve(result).catch((err) => rejectPendingWalletConnect(err))");
    expect(PRIVY_CLIENT_SOURCE).toContain("if (modal.isOpen) {");
    expect(PRIVY_CLIENT_SOURCE).toContain("if (pendingLogin.current) modalOpenedForLogin.current = true;");
    expect(PRIVY_CLIENT_SOURCE).toContain("if (pendingWalletConnect.current) modalOpenedForWalletConnect.current = true;");
    expect(PRIVY_CLIENT_SOURCE).toContain("modalOpenedForLogin.current = false;");
    expect(PRIVY_CLIENT_SOURCE).toContain("modalOpenedForWalletConnect.current = false;");
    expect(PRIVY_CLIENT_SOURCE).toContain('"phantom"');
    expect(PRIVY_CLIENT_SOURCE).not.toContain("readNestedSolanaAddress");
    expect(PRIVY_CLIENT_SOURCE).not.toContain("solanaAddressFromConnectedWallet");
    expect(PRIVY_CLIENT_SOURCE).not.toContain('walletClient === "phantom"');
    expect(PRIVY_CLIENT_SOURCE).not.toContain('walletChainType: "ethereum-and-solana"');
    expect(PRIVY_CLIENT_SOURCE).not.toContain('createOnLogin: "users-without-wallets"');
    expect(PRIVY_CLIENT_SOURCE).not.toContain("modalOpenedForLogin.current = true;\n      login();");
    expect(PRIVY_CLIENT_SOURCE).not.toContain("modalOpenedForWalletConnect.current = true;\n      connectWallet({");
  });

  it("keeps Account reduced to profile, passes, and library panes", () => {
    const html = renderedViewer({ privy: { appId: "privy-app-test", clientId: "privy-client-test" } });
    const script = inlineScript(html);
    const characters = html.indexOf('class="account-section account-character-section"');
    const wallet = html.indexOf('class="account-section account-wallet-section"');
    const cards = html.indexOf('class="account-section account-hall-pass-card-section"');
    const history = html.indexOf('id="account-history-list"');
    const comics = html.indexOf('class="account-section account-comics-section"');

    expect(html).toContain('data-account-tab="account"');
    expect(html).toContain('data-account-tab="wallet"');
    expect(html).toContain('data-account-tab="library"');
    expect(html).not.toContain('data-account-tab="cards"');
    expect(html).not.toContain('data-account-tab="receipts"');
    expect(html).not.toContain('data-account-tab="trust"');
    expect(html).toContain('id="account-trust-list"');
    expect(html).toContain("Account settings");
    expectScriptToContain(script, "function accountPaneItemView(id, activePane)");
    expectScriptToContain(script, "function accountPaneKeyTarget(key, currentIndex, tabCount)");
    expectScriptToContain(script, "function normalizeAccountPane(pane)");
    expectScriptToContain(script, "const view = accountPaneItemView(rawId, active);");
    expectScriptToContain(script, "const targetIndex = accountPaneKeyTarget(event.key, currentIndex, els.accountTabs.length);");
    expect(characters).toBeGreaterThan(-1);
    expect(history).toBeGreaterThan(characters);
    expect(wallet).toBeGreaterThan(history);
    expect(html).not.toContain('class="account-section account-ai-section"');
    expect(cards).toBeGreaterThan(wallet);
    expect(comics).toBeGreaterThan(cards);
    expectScriptToContain(script, "function setAccountPane(pane)");
    expectScriptToContain(script, "function renderAccountTrust()");
    expectScriptToContain(script, "let previousRenderSignature = \"\";");
    expectScriptToContain(script, "function renderSignature(opts, shownPacks, shownCards)");
    expectScriptToContain(script, "if (nextSignature === previousRenderSignature && container.childElementCount > 0) return;");
    expectScriptToContain(script, "function syncComicUnlockModals(t)");
    expectScriptToContain(script, "function syncFirstBellReportModal(t)");
    expectScriptToContain(script, "First Bell Report");
    expectScriptToContain(script, "Copy link");
    expectScriptToContain(script, "function trapModalFocus(event, overlay)");
    expectScriptToContain(script, 'els.shell.setAttribute("inert", "")');
    expectScriptToContain(script, 'els.shell.setAttribute("aria-hidden", "true")');
    expectScriptToContain(script, "restoreModalFocus(previousFocus, els.nextBtn)");
    expectScriptToContain(script, 'kind: "first_bell_report"');
    expectScriptToContain(script, "Comic Page Unlocked");
    expectScriptToContain(script, 'title.appendChild(deps.document.createTextNode(" "));');
    expect(script).not.toContain("FIRST BELL CARD");
    expect(script).not.toContain("First Bell Card Unlocked");
    expect(script).not.toContain("Start Social Card");
    expect(script).not.toContain("Social card ready");
    expect(script).not.toContain("Social card: When a classmate");
    expect(script).not.toContain("social card ready");
    expectScriptToContain(script, "Ruby High never asks for your seed phrase.");
    expect(VIEWER_CSS).toContain(".account-tabs");
    expect(VIEWER_CSS).toContain(".comic-reader.is-reward");
    expect(VIEWER_CSS).toContain(".first-bell-overlay");
    expect(VIEWER_CSS).toContain(".first-bell-portrait img");
    expect(VIEWER_CSS).toContain(".account-workspace");
    expect(VIEWER_CSS).toContain("  .account-empty {\n    grid-column: 1 / -1;");
    expect(VIEWER_CSS).toContain(".account-trust-row");
    expectScriptToContain(script, "function openCharacterCreation()");
    expectScriptToContain(script, "function openCharacterCreationFromAccount()");
    expect(html).toContain('id="blackboard-empty-action"');
    expectScriptToContain(script, "Create your first Ruby High student.");
    expectScriptToContain(script, 'els.blackboardEmptyAction.addEventListener("click", handleBlackboardEmptyAction)');
    expectScriptToContain(script, "function maybeShowWelcomeHallPassPopup");
    expectScriptToContain(script, "function claimWelcomeHallPassesFromBilling()");
    expectScriptToContain(script, 'apiBase + "/billing/welcome"');
    expectScriptToContain(script, "No Hall Passes yet");
    expectScriptToContain(script, "Open Account");
    expectScriptToContain(script, 'if (billingMode === "hall-passes") void claimWelcomeHallPassesFromBilling();');
    expect(script).not.toContain("maybeShowWelcomeHallPassPopup(t);");
    expectScriptToContain(script, 'const WELCOME_HALL_PASS_ART_URL = apiBase + "/assets/welcome-hall-passes.png"');
    expect(VIEWER_CSS).toContain(".welcome-hall-pass-art");
    expectScriptToContain(script, "Create your first student and try a custom portrait");
    expect(script).not.toContain("activateAiPass");
    expect(script).not.toContain('els.accountUsePass.addEventListener("click", () => activateAiPass({ source: "account" }))');
    expect(script).not.toContain("els.accountBuyPasses.disabled = !authed;");
    expect(script).not.toContain("els.accountUsePass.disabled = !authed || billingBusy");
    expect(script).not.toContain("els.accountAiUsePass.disabled = view.primaryDisabled;");
    expect(script).not.toContain("els.accountBuyPasses.disabled = !unlocked || !authed");
    expect(script).not.toContain("els.accountUsePass.disabled = !unlocked || !authed");
    expect(script).not.toContain("els.accountAiUsePass.disabled = !unlocked || view.primaryDisabled");
    expect(script).not.toContain("AI Access active");
    expect(script).not.toContain("Roll your character to start today's class.");
  });

  it("turns completed guest lessons into a signup CTA instead of raw practice errors", () => {
    const script = inlineScript(renderedViewer());

    expectScriptToContain(script, "function guestSignupRequired");
    expectScriptToContain(script, 'if (postClass.report && guestSignupRequired(t)) return "Sign up";');
    expectScriptToContain(script, "function promptGuestSignup");
    expectScriptToContain(script, "Sign up to keep your student");
    expectScriptToContain(script, "Sign up to keep your student");
  });

  it("labels offline classroom advance as Continue instead of Chat", () => {
    const script = inlineScript(renderedViewer());

    expectScriptToContain(script, 'return "Chat " + formatWholeNumber(nextChatCost(t)) + " ⭐";');
    expectScriptToContain(script, 'offlineClassroom ? "Continue" : chatActionLabel(t)');
    expectScriptToContain(script, 'const advanceLabel = teacherChatEnabled() ? chatActionLabel(lastTelemetry) : "Continue";');
    expectScriptToContain(script, "const offlineLiveRound = live && !teacherChatEnabled();");
    expectScriptToContain(script, "ceremonyReady || offlineLiveRound");
    expectScriptToContain(script, "Use an AI key for hints.");
    expect(script).not.toContain("Connect OpenRouter for hints.");
  });

  it("keeps opinion submit, waiting refresh, and force-grade paths wired in the client", () => {
    const script = inlineScript(renderedViewer());

    expectScriptToContain(script, '/api/apps/ruby-high/chat/opinion-submit');
    expectScriptToContain(script, '/api/apps/ruby-high/chat/room-turn');
    expectScriptToContain(script, "setDialogueCompaction(summary)");
    expectScriptToContain(script, 'event === "player-line"');
    expectScriptToContain(script, 'event === "student"');
    expectScriptToContain(script, 'event === "opinion-response"');
    expectScriptToContain(script, 'event === "waiting" || event === "opinion-graded"');
    expectScriptToContain(script, "refreshSessionAfterStreamEvent();");
    expectScriptToContain(script, "body: JSON.stringify({ force: true })");
    expectScriptToContain(script, "opinionGradeFired = true");
  });

  it("renders yearbook portrait elements in the character sheet", () => {
    const script = inlineScript(renderedViewer());
    const clientSource = readFileSync(new URL("../viewer-parts/client.ts", import.meta.url), "utf8");

    expectScriptToContain(script, "function createYearbookArchiveRenderer(");
    expectScriptToContain(script, "function createYearbookShareActionsRenderer(");
    expectScriptToContain(clientSource, "const yearbookArchiveRenderer = createYearbookArchiveRenderer({");
    expectScriptToContain(clientSource, "const yearbookShareActionsRenderer = createYearbookShareActionsRenderer({");
    expectScriptToContain(clientSource, "return yearbookArchiveRenderer.buildArchive(entries, liveChar, livePb, playbooks);");
    expectScriptToContain(clientSource, "return yearbookArchiveRenderer.buildEntry(entry, liveChar, livePb, playbooks);");
    expectScriptToContain(clientSource, "return yearbookShareActionsRenderer.build(share);");
    expectScriptToContain(script, "paper-archive-avatar");
    expect(clientSource).not.toContain('!(grad && y.grade === "12")');
    expect(clientSource).not.toContain('archive.className = "paper-archive";');
    expect(clientSource).not.toContain('item.className = "paper-archive-entry";');
    expect(clientSource).not.toContain('actions.className = "paper-archive-actions";');
  });

  it("keeps stream refreshes from holding the Chat/Practice busy lock", () => {
    const script = inlineScript(renderedViewer());
    const consumeStart = script.indexOf("async function consumeSseStream");
    const consumeEnd = script.indexOf("async function sendChatMessage");
    const consumeBody = script.slice(consumeStart, consumeEnd);

    expectScriptToContain(script, "function withViewerTimeoutSignal");
    expectScriptToContain(script, "const SESSION_REFRESH_TIMEOUT_MS = 8e3");
    expectScriptToContain(script, "function createViewerApiClient");
    expectScriptToContain(script, "const apiClient = createViewerApiClient");
    expectScriptToContain(script, "function imageRequestId(prefix)");
    expectScriptToContain(script, "function createViewerTurnController");
    expectScriptToContain(script, "const turnController = createViewerTurnController");
    expectScriptToContain(script, "function syncNextButtonDisabled()");
    expectScriptToContain(script, "const manualTurn = turnController.beginManual()");
    expectScriptToContain(script, "const agentTurn = turnController.beginAgent(false)");
    expectScriptToContain(script, "const buttonTurn = turnController.beginButtonAction()");
    expectScriptToContain(script, "turnController.syncControls()");
    expectScriptToContain(script, "if (!els.chatInput.disabled) els.chatInput.focus();");
    expect(script).not.toContain("els.chatInput.disabled = !teacherChatEnabled()");
    expectScriptToContain(consumeBody, "refreshSessionAfterStreamEvent();");
    expect(consumeBody).not.toContain("await fetchSession(");
    expect(script).not.toContain("let agentBusy =");
    expect(script).not.toContain("let manualChatBusy =");
  });

  it("keeps SSE streams bounded so stale network reads cannot hold the UI lock forever", () => {
    const script = inlineScript(renderedViewer());

    expectScriptToContain(script, "function chatStreamStillCurrent(opts)");
    expectScriptToContain(script, "const resetWatchdog = () =>");
    expectScriptToContain(script, "watchdog = setTimeout");
    expectScriptToContain(script, "resetWatchdog();");
    expectScriptToContain(script, "reader.cancel()");
    expectScriptToContain(script, "if (watchdog) clearTimeout(watchdog)");
    expectScriptToContain(script, "opts.streamSeq !== state.streamSeq");
    expectScriptToContain(script, "turnController.nextStreamGuard(targetFaculty)");
  });

  it("drops session polls that overlap command requests", () => {
    const script = inlineScript(renderedViewer());

    expectScriptToContain(script, "const seqAtStart = commandSeq");
    expectScriptToContain(script, "const settledAtStart = lastSettledCommandSeq");
    expectScriptToContain(script, "commandSeq !== seqAtStart || lastSettledCommandSeq !== settledAtStart");
  });

  it("uses emoji-only top status indicators with explanatory tooltips", () => {
    const html = renderedViewer();
    const script = inlineScript(html);

    // Tooltips carry the meaning the emoji compresses.
    expect(html).toContain('title="Passed daily classes needed for this year"');
    expect(html).toContain('title="Subjects cleared with a C or better this year"');
    expectScriptToContain(script, '"📚 " + streakCount + "/" + streakReq');
    expectScriptToContain(script, '"✅ " + subjectMet + "/" + subjectTotal');
    expectScriptToContain(script, "arcIndicatorRenderer.render(t, {");
    expectScriptToContain(script, 'walletSummaryText(t)');
    expectScriptToContain(script, '" · 🎫 "');
  });

  it("keeps weekly guest spotlight in the lounge and collapses class-start copy behind info", () => {
    const script = inlineScript(renderedViewer());
    const clientSource = readFileSync(new URL("../viewer-parts/client.ts", import.meta.url), "utf8");

    expectScriptToContain(script, "function createBoardStatusRenderer(");
    expectScriptToContain(script, "buildClassStartHeader(currentGrade, summary, statusText, infoText)");
    expectScriptToContain(script, "function buildBoardClassStartHeader(statusText, infoText)");
    expectScriptToContain(script, "function boardSubjectGradesTitleView(currentGradeInput, summaryInput)");
    expectScriptToContain(script, "function subjectGradeChipView(specInput)");
    expectScriptToContain(script, "const view = subjectGradeChipView(spec);");
    expectScriptToContain(clientSource, "const boardStatusRenderer = createBoardStatusRenderer({");
    expectScriptToContain(clientSource, "return boardStatusRenderer.buildSubjectGrades(t.current_grade, subjectClearSummary());");
    expectScriptToContain(clientSource, "return boardStatusRenderer.buildClassStartHeader(grade, summary, statusText, infoText);");
    expectScriptToContain(script, 'button.className = "board-info-button";');
    expectScriptToContain(script, 'bubble.className = "board-info-popover";');
    expectScriptToContain(script, "const spotlight = buildGuestSpotlight(lastTelemetry);");
    expectScriptToContain(script, "function guestSpotlightView(guestInput)");
    expectScriptToContain(script, "function createGuestSpotlightRenderer(deps)");
    expectScriptToContain(script, "const guestSpotlightRenderer = createGuestSpotlightRenderer({");
    expectScriptToContain(script, "viewFor: guestSpotlightView");
    expectScriptToContain(script, "return guestSpotlightRenderer.build(t);");
    expect(script.match(/buildGuestSpotlight\(/g) ?? []).toHaveLength(2);
    expect(clientSource).not.toContain('wrap.className = "board-empty-header";');
    expect(clientSource).not.toContain('button.className = "board-info-button";');
    expect(clientSource).not.toContain('row.className = "board-subject-grades-row";');
    expect(clientSource).not.toContain('wrap.className = "guest-spotlight";');
    expect(VIEWER_CSS).toContain(".board-info-popover");
    expect(VIEWER_CSS).toContain('.blackboard-panel[data-mode="in-lounge"] .blackboard-empty');
    expect(cssRule(".blackboard-empty")).toContain("flex-direction: column");
  });

  it("keeps answer reveals until player advance and uses room completion dots", () => {
    const script = inlineScript(renderedViewer());

    expect(script).not.toContain("clearResolvedBoardAfterTeacherTurn");
    expectScriptToContain(script, "function appendCompletionMeter(parent, roomView)");
    expectScriptToContain(script, "function earnedCourseGrade(progress)");
    expectScriptToContain(script, "function subjectProgressShortLabel(progress)");
    expectScriptToContain(script, "if (phase === \"revealed\")");
    expect(script).not.toContain("subjectMark.textContent = fac.courseGrade");
    expect(script).not.toContain("const grade = spec.grade || \"F\"");
    expect(script).not.toContain("(\" + cg.grade + \")");
    expect(cssRule(".channel-row.room-row-group")).toContain("min-height: 52px");
    expect(cssRule(".room-row-button")).toContain("cursor: pointer");
    expect(cssRule(".room-row-meta")).toContain("flex-direction: column");
  });

  it("uses one teacher pfp source for channel thumbs and class chat bubbles", () => {
    const script = inlineScript(renderedViewer());

    expectScriptToContain(script, "function teacherSmallAvatarUrl(facultyOrId)");
    expectScriptToContain(script, 'return teacherPortraitUrl(facultyOrId, "face");');
    expectScriptToContain(script, "avatarImgSrc = teacherSmallAvatarUrl(facultyId)");
    expectScriptToContain(script, "const thumbUrl = deps.teacherSmallAvatarUrl(faculty);");
    expectScriptToContain(script, '+ ":" + (f.assetTeacherId || "") + ":" + (f.profileImageUrl || "")');
    expect(script).not.toContain("function teacherStickerUrl");
    expect(script).not.toContain('avatarImgSrc = teacherPortraitUrl(facultyId, "")');
  });

  it("links bugs and questions to Discord support", () => {
    const html = renderedViewer();
    const script = inlineScript(html);

    expect(html).toContain('href="https://discord.gg/uTXaBVfY"');
    expect(html).toContain('title="Bugs or questions? Join the Ruby High Discord."');
    expect(html).toContain(">Bugs / questions</a>");
    expect(html).toContain('id="bug-report-form"');
    expectScriptToContain(script, 'apiBase + "/bug-report"');
    expectScriptToContain(script, "!els.reportBugLink.dataset.discordLink");
    expectScriptToContain(script, "RECENT_ERRORS");
    expect(script).not.toContain("github.com/cenetex/app-ruby-high/issues/new");
    expect(script).not.toContain("mailto:hello@ratimics.com");
  });

  it("keeps the channel footer compact and clips tall student portraits", () => {
    expect(cssRule(".channels-footer")).toContain("flex: 0 0 auto");
    expect(cssRule(".channels-footer .you-avatar")).toContain("position: relative");
    expect(cssRule(".channels-footer .you-avatar")).toContain("overflow: hidden");
    expect(cssRule(".channels-footer .you-avatar img")).toContain("position: absolute");
    expect(cssRule(".channels-footer .you-avatar img")).toContain("inset: 0");
    expect(cssRule(".channels-footer .you-avatar img")).toContain("height: 100% !important");
    expect(cssRule(".channels-footer .you-avatar img")).toContain("object-fit: cover");
    expect(cssRule(".channels-rail .report-bug-link")).toContain("display: inline-flex");
    expect(cssRule(".channels-rail .report-bug-link")).toContain("min-height: 30px");
    expect(cssRule(".channels-rail .report-bug-link")).toContain("padding: 6px 0");
    expect(cssRule(".channels-links")).toContain("flex-wrap: wrap");
    expect(cssRule(".channels-links")).toContain("flex: 0 0 auto");
    expect(VIEWER_CSS).not.toContain("Stack links vertically in the channels footer");
  });

  it("only zooms compact chat avatars for tall portrait images", () => {
    const script = inlineScript(renderedViewer());
    expect(cssRule(".msg .avatar")).toContain("overflow: hidden");
    expect(cssRule(".msg .avatar img")).toContain("object-fit: cover");
    expect(cssRule(".msg .avatar img")).toContain("object-position: center");
    expect(cssRule(".msg .avatar img")).toContain("transform: none");
    expect(cssRule(".msg .avatar.is-tall-avatar img")).toContain("object-position: 50% 18%");
    expect(cssRule(".msg .avatar.is-tall-avatar img")).toContain("transform: scale(2.05)");
    expect(cssRule(".msg .avatar.is-tall-avatar img")).toContain("transform-origin: top center");
    expectScriptToContain(script, "function applyChatAvatarAspectClass");
    expectScriptToContain(script, 'avatar.classList.remove("is-tall-avatar", "is-square-avatar")');
  });

  it("face-crops custom student portraits in compact channel avatars", () => {
    const script = inlineScript(renderedViewer());

    expect(cssRule(".room-student-chip img")).toContain("transform: none");
    expect(cssRule(".room-student-chip.is-custom-portrait img")).toContain("object-position: 50% 18%");
    expect(cssRule(".room-student-chip.is-custom-portrait img")).toContain("transform: scale(2.15)");
    expect(cssRule(".room-student-chip.is-custom-portrait.is-tall-portrait img")).toContain("transform: scale(2.45)");
    expect(cssRule(".room-student-chip.is-custom-portrait.is-wide-portrait img")).toContain("transform: scale(1.55)");
    expect(cssRule(".channel-row .student-thumb.is-custom-portrait img")).toContain("object-position: 50% 18%");
    expect(cssRule(".channel-row .student-thumb.is-custom-portrait img")).toContain("transform: scale(2.1)");
    expect(cssRule(".channel-row .student-thumb.is-custom-portrait.is-tall-portrait img")).toContain("transform: scale(2.45)");
    expect(cssRule(".channel-row .student-thumb.is-custom-portrait.is-wide-portrait img")).toContain("transform: scale(1.6)");
    expectScriptToContain(script, "function applyStudentThumbPortraitClass");
    expectScriptToContain(script, "function applyRoomStudentChipPortraitClass");
    expectScriptToContain(script, 'if (portraitUrl) chip.classList.add("is-custom-portrait")');
    expectScriptToContain(script, "if (portraitUrl) applyRoomStudentChipPortraitClass(chip, img);");
  });

  it("explains public world visibility before the account toggle can publish a profile", () => {
    const html = renderedViewer();
    const script = inlineScript(html);

    expect(html).toContain('id="account-public-world-toggle"');
    expect(html).not.toContain("Student name, grade, playbook, stats, completed class grades, yearbook count, and safe portrait URL.");
    expect(html).not.toContain("Answers, chat text, session id, wallets, AI keys, receipts, and account identity stay off shared school activity.");
    expect(html).toContain('id="account-delete"');
    expect(html).toContain("Permanently delete this account and its school activity.");
    expectScriptToContain(script, "function renderAccountPublicWorld()");
    expectScriptToContain(script, "function accountPublicWorldView(character, opts)");
    expectScriptToContain(script, "function createAccountPublicWorldController(deps)");
    expectScriptToContain(script, "function togglePublicWorldFromAccount()");
    expectScriptToContain(script, "async function deleteAccountFromAccount()");
    expectScriptToContain(script, "const accountPublicWorldController = createAccountPublicWorldController");
    expectScriptToContain(script, "viewFor: accountPublicWorldView");
    expectScriptToContain(script, 'type: "set-public-presence"');
    expectScriptToContain(script, '"/auth/delete-account"');
    expect(cssRule(".account-section-head button.danger")).toContain("#ffb7b7");
    expect(cssRule(".account-public-world-status.is-visible")).toContain("color: #8fdc9b");
  });

  it("keeps installed packs as one-click rows and searches creator packs separately", () => {
    const html = renderedViewer();
    const script = inlineScript(html);

    expect(html).toContain("Let Ruby High choose this week's guest teacher, or choose one from your courses.");
    expect(html).toContain('id="pack-search-input"');
    expect(html).toContain('id="pack-search-btn"');
    expect(html).toContain('id="pack-search-list"');
    expect(html).toContain("Find courses");
    expect(cssRule(".pack-grid")).toContain("display: flex");
    expect(cssRule(".pack-grid")).toContain("flex-direction: column");
    expect(cssRule(".pack-grid")).not.toContain("grid-template-columns");
    expect(cssRule(".pack-search-row")).toContain("grid-template-columns: minmax(0, 1fr) auto");
    expect(cssRule(".pack-card-item")).toContain("grid-template-columns: minmax(0, 1fr) auto");
    expect(VIEWER_CSS).toContain("@media (max-width: 560px)");
    expect(VIEWER_CSS).toContain('grid-template-areas:\n        "head"\n        "meta"\n        "actions";');
    expect(VIEWER_CSS).toContain("grid-template-columns: repeat(auto-fit, minmax(92px, 1fr))");
    expect(VIEWER_CSS).toContain("grid-column: 1 / -1");
    expectScriptToContain(script, 'card.addEventListener("click", () => {');
    expectScriptToContain(script, "function packLibraryCardView(packInput, opts)");
    expectScriptToContain(script, "const view = packLibraryCardView(pack, { draft: isDraft, search: isSearch, busy: packImportBusy });");
    expectScriptToContain(script, "state.textContent = view.stateText");
    expectScriptToContain(script, "view.actions.forEach((action) => {");
    expectScriptToContain(script, "async searchCreatorPacks(query)");
    expectScriptToContain(script, "async function refreshPackSearchResults()");
    expectScriptToContain(script, '"/api/apps/ruby-high/pack-library/search?q="');
    expectScriptToContain(script, "async function installCreatorPack(pack)");
    expect((script.match(/await refreshPackSearchResults\(\);/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expectScriptToContain(script, 'if (action.kind === "search-primary" && pack.installed)');
    expectScriptToContain(script, 'packSearchBtn.addEventListener("click", searchCreatorPacks)');
    expectScriptToContain(script, '"Setting guest teacher..."');
    expectScriptToContain(script, "async function deleteLibraryPack");
    expectScriptToContain(script, "deleteDraftPack");
    expectScriptToContain(script, "deletePublishedPack");
    expectScriptToContain(script, "openPackEditor(newLocalDraftPack())");
    expectScriptToContain(script, "function ensureCurrentDraftSaved()");
    expectScriptToContain(script, "if (isLocalDraftPack(currentDraft))");
    expect(script).not.toContain("openPackEditor(await packStudioClient.loadDraftPack(draft.id))");
    expectScriptToContain(script, "createEditDraftForPublishedPack");
    expectScriptToContain(script, "async function editPublishedPack(pack)");
    expectScriptToContain(script, "teacherFormVersion += 1");
    expectScriptToContain(script, "mergeTeacherPatchIntoDraft(currentDraft, selectedPackTeacherId, selectedTeacherFormPatch())");
    expectScriptToContain(script, "formVersion !== teacherFormVersion");
    expectScriptToContain(script, "function packTeacherRowView(teacherInput, opts)");
    expectScriptToContain(script, "const view = packTeacherRowView(teacher, {");
    expectScriptToContain(script, "subtitle.textContent = view.subtitleText");
    expectScriptToContain(script, "function packTeacherDetailView(teacherInput)");
    expectScriptToContain(script, "const view = packTeacherDetailView(selected)");
    expectScriptToContain(script, "function packQuestionListView(teacherInput)");
    expectScriptToContain(script, "const view = packQuestionListView(teacher)");
    expectScriptToContain(script, "prompt.textContent = question.promptText");
    expectScriptToContain(script, "pack.canDelete");
    expectScriptToContain(script, "if (isDraft) editDraftPack(pack.id)");
    expectScriptToContain(script, "await editDraftPack(pack.draftId)");
    expect(cssRule(".pack-card-actions .pack-action.danger")).toContain("#ff8c8c");
    expect(script).not.toContain('document.createTextNode("Enabled")');
    expect(script).not.toContain("togglePackInstall");
    expect(script).not.toContain("activeBtn.textContent");
    expect(script).not.toContain('"Activating pack..."');
    expect(script).not.toContain('"Active pack switched. Reloading..."');
  });

  it("keeps new content pack setup focused on pasted course materials", () => {
    const html = renderedViewer();
    const script = inlineScript(html);

    expect(html).toContain('id="course-materials-input"');
    expect(html).toContain("Add course materials here");
    expect(html).toContain("Generate Course");
    expect(html).not.toContain('id="pack-name-input"');
    expect(html).not.toContain('id="pack-description-input"');
    expect(html).not.toContain('id="pack-add-teacher-btn"');
    expect(html).not.toContain('<span class="pack-teacher-title">New Teacher</span>');
    expect(html).not.toContain('<span class="pack-teacher-subtitle">Create manually</span>');
    expectScriptToContain(script, 'packEditTitleEl.textContent = emptyDraft ? "Create Course" : "Edit Course"');
    expectScriptToContain(script, 'packEditSubtitleEl.textContent = emptyDraft ? "Add course materials here."');
    expectScriptToContain(script, 'if (teacherSidebar) teacherSidebar.hidden = emptyDraft');
    expectScriptToContain(script, "if (Object.keys(patch).length === 0) return;");
    expect(script).not.toContain('packAddTeacherBtn.addEventListener("click", addDraftTeacher)');
  });

  it("uses BYOK course generation and paid publish slots for draft pack setup", () => {
    const html = renderedViewer();
    const script = inlineScript(html);

    expect(html).toContain('id="pack-course-generator"');
    expect(html).toContain('id="course-materials-input"');
    expect(html).toContain('id="course-generation-progress"');
    expect(html).toContain('id="course-generation-checklist"');
    expect(html).toContain("Add course materials here");
    expect(html).toContain("Generate Course");
    expect(html).toContain("Publish course (3 Hall Passes)");
    expect(html).toContain('id="course-generate-btn"');
    expect(html).not.toContain('class="pack-teacher-tab pack-new-teacher-tab"');
    expect(html).not.toContain('class="pack-teacher-avatar pack-new-teacher-avatar">+</span>');
    expectScriptToContain(script, "async generateCourse(draftId, payload, options)");
    expectScriptToContain(script, '"/course/generate"');
    expectScriptToContain(script, "function creatorPricing(t)");
    expectScriptToContain(script, "COURSE_GENERATION_STEPS");
    expectScriptToContain(script, "INITIAL_COURSE_QUESTION_COUNT = 6");
    expectScriptToContain(script, "questionCount: INITIAL_COURSE_QUESTION_COUNT");
    expectScriptToContain(script, "Generate teacher portrait");
    expectScriptToContain(script, "function startCourseGenerationProgress()");
    expectScriptToContain(script, "function finishCourseGenerationProgress()");
    expectScriptToContain(script, "function generateCourseFromMaterials()");
    expectScriptToContain(script, "function runCourseGeneration(teacher)");
    expectScriptToContain(script, 'label.textContent = packQuestionGenerationBusy');
    expectScriptToContain(script, '"Generate More Questions (" + questionCostLabel + ")" : "Generate More Questions"');
    expectScriptToContain(script, 'packPublishBtn.textContent = draftHasCourseSlot() ? "Publish Course" : "Publish Course (" + hallPassCostLabel(cost) + ")"');
    expectScriptToContain(script, "teacherGenerateQuestionsBtn.disabled = packImportBusy || packQuestionGenerationBusy || !selectedDraftTeacher() || !canGenerateQuestions");
    expectScriptToContain(script, "applyHallPassBalance(data.hallPasses, data.entitlements)");
    expectScriptToContain(script, "function deleteDraftTeacher(teacherId)");
    expectScriptToContain(script, "packStudioClient.deleteTeacher");
    expectScriptToContain(script, "function editDraftTeacher(teacherId)");
    expectScriptToContain(script, 'selectDraftTeacher(teacherId, { tab: "settings", focus: true })');
    expectScriptToContain(script, 'edit.textContent = "Edit"');
    expectScriptToContain(script, 'del.textContent = "Delete"');
    expectScriptToContain(script, "Cancel generation before closing.");
    expect(script).not.toContain("Generate Questions");
  });

  it("routes the post-class Practice button to a practice board or teacher advance", () => {
    const script = inlineScript(renderedViewer());

    expectScriptToContain(script, "async function startPostClassPractice(postClass)");
    expectScriptToContain(script, 'type: "pick"');
    expectScriptToContain(script, 'mode: "practice"');
    expectScriptToContain(script, "faculty: lastTelemetry && lastTelemetry.faculty");
    expectScriptToContain(script, 'intent: "advance"');
    expectScriptToContain(script, 'runAgentTurn("manual"');
    expectScriptToContain(script, "if (postClass.report)");
    expectScriptToContain(script, "function subjectDisplayName(fid, progress)");
    expectScriptToContain(script, "subjectDisplayName(cg.facultyId, cg.progress)");
  });

  it("shows the completed class report before post-class signup or practice", () => {
    const clientSource = readFileSync(new URL("../viewer-parts/client.ts", import.meta.url), "utf8");
    const pickNext = clientSource.slice(clientSource.indexOf("async function pickNext()"));

    expect(pickNext.indexOf("currentRevealCompletedClass(lastTelemetry)")).toBeGreaterThanOrEqual(0);
    expect(pickNext.indexOf("currentRevealCompletedClass(lastTelemetry)")).toBeLessThan(
      pickNext.indexOf("const postClass = postClassState(lastTelemetry)"),
    );
    expectScriptToContain(pickNext, 'await command({ type: "clear" })');
  });

  it("builds the class report with full-body teacher standee art and a score metric", () => {
    const script = inlineScript(renderedViewer());
    const clientSource = readFileSync(new URL("../viewer-parts/client.ts", import.meta.url), "utf8");

    expectScriptToContain(script, "function buildClassReportCard");
    expectScriptToContain(script, "function createClassReportRenderer(");
    expectScriptToContain(clientSource, "const classReportRenderer = createClassReportRenderer({");
    expectScriptToContain(clientSource, "return classReportRenderer.buildCard(faculty, currentGrade, progress);");
    expectScriptToContain(clientSource, "return classReportRenderer.buildNextStep(lastTelemetry);");
    expectScriptToContain(script, "function shouldShowClassReport");
    expectScriptToContain(script, "let dismissedClassReportKey = null");
    expectScriptToContain(script, "key !== dismissedClassReportKey");
    expectScriptToContain(clientSource, '(cp && cp.mode === "class" && cp.completed) || activeDailyClassIsComplete(t)');
    const emptyBoard = clientSource.slice(clientSource.indexOf("if (!question) {"));
    expect(emptyBoard.indexOf("shouldShowClassReport(lastTelemetry)")).toBeLessThan(
      emptyBoard.indexOf("lastTelemetry.graduation_ready"),
    );
    expectScriptToContain(script, "dismissedClassReportKey = reportKey");
    expectScriptToContain(script, "class-report-teacher-art");
    expectScriptToContain(script, 'teacherAssetUrl(artAssetId, "full-sticker")');
    expectScriptToContain(script, 'addMetric(metrics, "score"');
    expectScriptToContain(script, '"class score"');
    expect(clientSource).not.toContain('wrap.className = "class-report-card"');
    expect(clientSource).not.toContain('item.className = "class-report-metric"');
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
