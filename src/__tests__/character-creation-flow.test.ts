import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderViewerHtml } from "../viewer.js";

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
  const html = renderViewerHtml({
    agentName: "Ruby",
    sessionId: "rh:test-creation",
    apiBase: "/api/apps/ruby-high",
    role: "human",
  });
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!match) throw new Error("viewer HTML has no inline script");
  return match[1]!;
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
    it("keeps Quick Roll inside the customizable creation sheet", () => {
      const quickRollHandler = CLIENT_SOURCE.slice(
        CLIENT_SOURCE.indexOf('const onboardingCreateBtn = document.getElementById("onboarding-create-btn")'),
        CLIENT_SOURCE.indexOf("if (onboardingCustomizeBtn)", CLIENT_SOURCE.indexOf('const onboardingCreateBtn = document.getElementById("onboarding-create-btn")')),
      );

      expect(quickRollHandler).toContain('addEventListener("click", openCharacterCreation)');
      expect(quickRollHandler).not.toContain('type: "quick-roll-student"');
    });

    it("keeps rollComponents local until the player starts Freshman year", () => {
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
      expectScriptToContain(script, "Start Freshman Year");
      expectScriptToContain(script, 'setStatus("Enrolling...")');
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

      expect(autoStartFn).toContain("creationSheetOpen()");
      expect(beginFn).toContain('type: "create-character"');
      expect(beginFn).toContain("void pickNext()");
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
  });

  describe("sign-up page structure", () => {
    it("renders the creation sheet with explanation and loading state", () => {
      const script = renderedViewerScript();

      // The explanation text for new students.
      expectScriptToContain(
        script,
        "You are about to enroll at Ruby High as a student",
      );
      expectScriptToContain(script, "Think of it as your role in the school story");

      // The loading spinner text for initial roll.
      expectScriptToContain(script, "Rolling your student");
      expectScriptToContain(script, "Ruby is looking up your file");

      // The character card with playbook stats.
      expectScriptToContain(script, "Character Roll");
    });

    it("renders one post-roll start action without the old confirmation copy", () => {
      const script = renderedViewerScript();

      expectScriptToContain(script, '"create-character"');
      expectScriptToContain(script, "Start Freshman Year");
      expectScriptNotToContain(script, "Save Character");
      // The old saving-character status text from the accept handler is gone.
      expectScriptNotToContain(script, '"Saving character"');
    });

    it("renders a Start Freshman Year button for the final student choice", () => {
      const script = renderedViewerScript();
      expectScriptToContain(script, "Start Freshman Year");
    });

    it("routes unaffordable AI portrait requests to the Hall Pass flow", () => {
      const script = renderedViewerScript();
      expectScriptToContain(script, "function hostedPortraitHallPassNeeded()");
      expectScriptNotToContain(script, "Hall Pass needed.");
      expectScriptToContain(script, 'title: "Hall Pass needed"');
      expectScriptToContain(script, "Custom character portrait needs");
      expectScriptToContain(script, "Rolling your student stays free.");
      expectScriptToContain(script, "openBilling({ mode: \"hall-passes\" })");
    });

    it("character roll sheet contains reroll controls per field", () => {
      const script = renderedViewerScript();

      // Each field has a reroll button.
      expectScriptToContain(script, '"↻"');
      // Name, playbook, stats, personality, quote should all have reroll buttons.
      expectScriptToContain(script, '"Reroll"');
    });
  });
});
