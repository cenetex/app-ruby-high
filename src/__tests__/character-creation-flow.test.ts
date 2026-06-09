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

    it("renderSheetCreation scope no longer contains Lock it in confirmation button", () => {
      // Scope to the renderSheetCreation function — "Lock it in" may still
      // appear elsewhere (e.g. on the blackboard empty-action button).
      const creationFn = CLIENT_SOURCE.slice(
        CLIENT_SOURCE.indexOf("function renderSheetCreation"),
      );
      expect(creationFn).not.toContain('"Lock it in"');
      expect(creationFn).not.toContain("Lock this student in to start today");
    });

    it("renderSheetCreation scope auto-commits instead of showing accept button", () => {
      const creationFn = CLIENT_SOURCE.slice(
        CLIENT_SOURCE.indexOf("function renderSheetCreation"),
      );
      // Auto-commit: the create-character command fires inside rollComponents.
      expect(creationFn).toContain('type: "create-character"');
      // No separate acceptBtn event listener in this scope.
      expect(creationFn).not.toContain("acceptBtn");
      expect(creationFn).toContain("saveBtn");
    });
  });

  describe("auto-commit on initial roll", () => {
    it("calls create-character command after the initial full roll in client source", () => {
      // The auto-commit block fires command({ type: "create-character" ... })
      // after the initial rollComponents() full roll succeeds.
      expect(CLIENT_SOURCE).toContain('type: "create-character"');
      // Must be inside an if (isFullRoll) block — that's the auto-commit guard.
      const afterRoll = CLIENT_SOURCE.slice(
        CLIENT_SOURCE.indexOf("First roll lands"),
      );
      expect(afterRoll).toContain("if (isFullRoll)");
      expect(afterRoll).toContain('type: "create-character"');
    });

    it("auto-commit logic is present in the rendered viewer script", () => {
      const script = renderedViewerScript();
      expectScriptToContain(script, '"create-character"');
      // The initial rollComponents() call should still exist.
      expectScriptToContain(script, "rollComponents()");
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
      // revealForm must appear AFTER the isConnected guard closes, not inside it.
      const afterGuard = catchBlock.slice(
        catchBlock.indexOf("if (status.isConnected)"),
      );
      const guardClose = afterGuard.indexOf("}\n") + 2;
      const afterGuardClose = afterGuard.slice(guardClose);
      expect(afterGuardClose.trimStart()).toMatch(/^revealForm\(\)/);
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

    it("does not render a separate confirmation step after roll", () => {
      const script = renderedViewerScript();

      // The auto-commit path means no separate accept step.
      expectScriptToContain(script, '"create-character"');
      // The old saving-character status text from the accept handler is gone.
      expectScriptNotToContain(script, '"Saving character"');
    });

    it("renders a Save Character fallback button for retry after failed auto-commit", () => {
      const script = renderedViewerScript();
      expectScriptToContain(script, "Save Character");
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

