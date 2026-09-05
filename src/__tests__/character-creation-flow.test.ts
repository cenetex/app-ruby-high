import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderViewerClientScript } from "../viewer.js";

const CLIENT_SOURCE = readFileSync(
  new URL("../viewer-parts/client.ts", import.meta.url),
  "utf8",
);

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

function expectScriptNotToContain(script: string, snippet: string): void {
  const compact = compactScript(snippet);
  expect(
    compactScript(script).includes(compact),
    `unexpected script snippet: ${snippet}`,
  ).toBe(false);
}

function renderedViewerScript(): string {
  return renderViewerClientScript();
}

describe("character creation flow", () => {
  describe("Lock it in button removal", () => {
    it("no longer references acceptBtn in client source", () => {
      expect(CLIENT_SOURCE).not.toContain("acceptBtn");
    });

    it("client source no longer contains Lock it in creation copy", () => {
      expect(CLIENT_SOURCE).not.toContain("Lock it in");
      expect(CLIENT_SOURCE).not.toContain("Lock this student in to start today");
    });

    it("renderSheetCreation persists only from the explicit start action", () => {
      const creationFn = CLIENT_SOURCE.slice(
        CLIENT_SOURCE.indexOf("function renderSheetCreation"),
      );
      expect(creationFn).toContain('"create-character"');
      // No separate acceptBtn event listener in this scope.
      expect(creationFn).not.toContain("acceptBtn");
      expect(creationFn).toContain("saveBtn");
      expect(creationFn).not.toContain("scheduleCharacterAutosave");
      expect(creationFn).not.toContain("autosaveQueue");
    });
  });

  describe("explicit enrollment after preview", () => {
    it("keeps the first-run CTA inside the customizable creation sheet", () => {
      const handlerStart = CLIENT_SOURCE.indexOf('const onboardingCreateBtn = document.getElementById("onboarding-create-btn")');
      const quickRollHandler = CLIENT_SOURCE.slice(
        handlerStart,
        CLIENT_SOURCE.indexOf("if (els.youProfile)", handlerStart),
      );

      expect(quickRollHandler).toContain('addEventListener("click", openCharacterCreation)');
      expect(quickRollHandler).not.toContain('type: "quick-roll-student"');
      expect(quickRollHandler).not.toContain("onboardingBooksBtn");
    });

    it("keeps rollComponents local until the player takes their seat", () => {
      const rollFn = CLIENT_SOURCE.slice(
        CLIENT_SOURCE.indexOf("async function rollComponents"),
        CLIENT_SOURCE.indexOf("// Wire per-row reroll buttons."),
      );
      expect(rollFn).toContain("renderRolled(rolled)");
      expect(rollFn).toContain("revealForm()");
      expect(rollFn).not.toContain("scheduleCharacterAutosave()");
      expect(rollFn).not.toContain('type: "create-character"');
      expect(rollFn).not.toContain('type: "update-character"');
    });

    it("initial roll and explicit enrollment are present in the rendered viewer script", () => {
      const script = renderedViewerScript();
      expectScriptToContain(script, '"create-character"');
      // The initial rollComponents() call should still exist.
      expectScriptToContain(script, "rollComponents()");
      expectScriptToContain(script, "Start first class");
      expectScriptToContain(script, 'setStatus("Saving your student...")');
      expectScriptNotToContain(script, "scheduleCharacterAutosave");
      expectScriptNotToContain(script, "Save Character");
    });

    it("does not auto-start class while the creation sheet is still open", () => {
      const autoStartFn = CLIENT_SOURCE.slice(
        CLIENT_SOURCE.indexOf("function shouldAutoStartClass"),
        CLIENT_SOURCE.indexOf("function hasCompletedAnyClass"),
      );
      const beginFn = CLIENT_SOURCE.slice(
        CLIENT_SOURCE.indexOf("async function beginClassFromCharacter"),
        CLIENT_SOURCE.indexOf("saveBtn.addEventListener"),
      );
      const finishFn = CLIENT_SOURCE.slice(
        CLIENT_SOURCE.indexOf("function finishCharacterEnrollment"),
        CLIENT_SOURCE.indexOf("function reportCharacterEnrollmentFailure"),
      );

      expect(autoStartFn).toContain("creationSheetOpen()");
      expect(beginFn).toContain('type: "create-character"');
      expect(beginFn).toContain("startFirstBell: true");
      expect(finishFn).toContain("void pickNext()");
      expect(beginFn).toContain("apiClient.lastCommandError()");
      expect(beginFn).toContain("await fetchSession");
      expect(beginFn).toContain("lastTelemetry.character");
      expect(beginFn).toContain("finishCharacterEnrollment()");
    });

    it("keeps the candidate retryable and records bounded enrollment failures", () => {
      const script = renderedViewerScript();
      expectScriptToContain(script, '"onboarding_enrollment_failed"');
      expectScriptToContain(script, "failureKind");
      expectScriptToContain(script, "Your student is still here");
      expectScriptToContain(script, 'setStatus("Checking your student...")');
    });

    it("does not leave a stale acceptBtn handler in the rendered viewer", () => {
      const script = renderedViewerScript();
      // The old saving-character status text should be gone from accept handler.
      expectScriptNotToContain(script, '"Saving character"');
    });
  });

  describe("stuck spinner fix", () => {
    it("calls revealForm after error handling in rollComponents", () => {
      // Find the rollComponents function scope, then its catch block.
      const rollFn = CLIENT_SOURCE.slice(
        CLIENT_SOURCE.indexOf("async function rollComponents"),
      );
      const catchBlock = rollFn.slice(rollFn.indexOf("} catch (err) {"));
      // revealForm must be called so the loading spinner does not stick.
      expect(catchBlock).toContain("revealForm()");
      expect(catchBlock).not.toContain("status.isConnected");
      expect(catchBlock).toMatch(/revealForm\(\);\s*setStatus\(/);
    });

    it("uses an immediate local first roll and falls back locally if optional AI fails", () => {
      const rollFn = CLIENT_SOURCE.slice(
        CLIENT_SOURCE.indexOf("async function rollComponents"),
        CLIENT_SOURCE.indexOf("// Wire per-row reroll buttons."),
      );

      expect(rollFn).toContain("(isFullRoll && !rolled) || !aiEnabled");
      expect(rollFn).toContain("rolled = offlineCharacterRoll(components)");
      expect(rollFn).toContain("Your student is ready.");
      expect(CLIENT_SOURCE).toContain("timeoutMs: 6000");
    });
  });

  describe("sign-up page structure", () => {
    it("renders the creation sheet with explanation and loading state", () => {
      const script = renderedViewerScript();

      // The explanation text for new students.
      expectScriptToContain(
        script,
        "Create your student",
      );
      expectScriptToContain(script, "Pick a name and style");

      // The loading spinner text for initial roll.
      expectScriptToContain(script, "Getting your student ready");
      expectScriptToContain(script, "This should only take a moment");

      // The character card with playbook stats.
      expectScriptToContain(script, "Advanced");
    });

    it("renders one post-roll start action without the old confirmation copy", () => {
      const script = renderedViewerScript();

      expectScriptToContain(script, '"create-character"');
      expectScriptToContain(script, "Start first class");
      expectScriptNotToContain(script, "Save Character");
      // The old saving-character status text from the accept handler is gone.
      expectScriptNotToContain(script, '"Saving character"');
    });

    it("renders a low-commitment start-class button for the final student choice", () => {
      const script = renderedViewerScript();
      expectScriptToContain(script, "Start first class");
      expectScriptToContain(script, "Free · no sign-up needed · your first class starts now.");
    });

    it("routes unaffordable AI portrait requests to the Hall Pass flow", () => {
      const script = renderedViewerScript();
      expectScriptToContain(script, "function hostedPortraitHallPassNeeded()");
      expectScriptNotToContain(script, "Hall Pass needed.");
      expectScriptToContain(script, 'title: "Hall Pass needed"');
      expectScriptToContain(script, "A custom student portrait needs");
      expectScriptToContain(script, "Claim your free starter Hall Passes or add more.");
      expectScriptToContain(script, "openBilling({ mode: \"hall-passes\" })");
    });

    it("character roll sheet contains reroll controls per field", () => {
      const script = renderedViewerScript();

      // Each field has a reroll button.
      expectScriptToContain(script, '"↻"');
      // Name, playbook, stats, personality, quote should all have reroll buttons.
      expectScriptToContain(script, '"Try another "');
    });

    it("offers direct name and student-style editing while preserving the explanation", () => {
      const script = renderedViewerScript();

      expectScriptToContain(script, 'nameInput.setAttribute("aria-label", "Student name")');
      expectScriptToContain(script, 'playbookSelect.setAttribute("aria-label", "Student style")');
      expectScriptToContain(script, 'customizeBtn.addEventListener("click"');
      expectScriptToContain(script, 'doneBtn.addEventListener("click"');
      expectScriptToContain(script, "sheetCard.appendChild(explanation)");
      expectScriptToContain(script, 'creator.className = "creation-single"');
    });
  });
});
