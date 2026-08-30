import { describe, expect, it } from "vitest";
import { questionPromptView } from "../viewer-parts/client-pure.js";

describe("viewer question prompt pure helpers", () => {
  it("builds a prompt view with up to three valid image media assets", () => {
    expect(questionPromptView({
      prompt: "**Explain** the diagram.",
      media: [
        { dataUrl: "data:image/png;base64,a", name: "First source" },
        { dataUrl: "https://example.com/nope.png", name: "Remote image" },
        { dataUrl: "data:text/plain;base64,b", name: "Text asset" },
        { dataUrl: "data:image/jpeg;base64,c", name: "" },
        { dataUrl: "data:image/webp;base64,d", name: "Third source" },
        { dataUrl: "data:image/png;base64,e", name: "Fourth source" },
      ],
    })).toEqual({
      prompt: "**Explain** the diagram.",
      images: [
        { src: "data:image/png;base64,a", alt: "First source" },
        { src: "data:image/jpeg;base64,c", alt: "Source card image" },
        { src: "data:image/webp;base64,d", alt: "Third source" },
      ],
    });
  });

  it("falls back to an empty prompt and no images for malformed input", () => {
    expect(questionPromptView(null)).toEqual({ prompt: "", images: [] });
    expect(questionPromptView({ prompt: 42, media: "bad" })).toEqual({ prompt: "42", images: [] });
  });

  it("builds a safe case-study view from authored evidence", () => {
    expect(questionPromptView({
      prompt: "What changed?",
      caseStudy: {
        episodeId: "tribute",
        title: "The Missing Tribute",
        hook: "One cart vanished.",
        scene: "The dragon is waiting.",
        stage: "investigate",
        evidence: [
          { label: "Ledger", source: "Toll house", detail: "Six carts left." },
          { label: "Bad", source: "", detail: "" },
        ],
        investigation: {
          actionId: "lyra-audit",
          kind: "delegate",
          actorId: "lyra",
          actorName: "Lyra",
          actionLabel: "Audit the ledger",
          reportLabel: "Lyra's audit",
          report: "One seal was copied.",
          confidence: "high",
          revealedEvidence: { label: "Seal", source: "Lyra", detail: "The sixth seal is wax, not resin." },
          verificationPrompt: "Compare it with the clerk's seal press.",
        },
      },
    })).toEqual({
      prompt: "What changed?",
      images: [],
      caseStudy: {
        episodeId: "tribute",
        title: "The Missing Tribute",
        hook: "One cart vanished.",
        scene: "The dragon is waiting.",
        stage: "investigate",
        evidence: [{ label: "Ledger", source: "Toll house", detail: "Six carts left." }],
        investigation: {
          actionId: "lyra-audit",
          kind: "delegate",
          actorId: "lyra",
          actorName: "Lyra",
          actionLabel: "Audit the ledger",
          reportLabel: "Lyra's audit",
          report: "One seal was copied.",
          confidence: "high",
          revealedEvidence: { label: "Seal", source: "Lyra", detail: "The sixth seal is wax, not resin." },
          verificationPrompt: "Compare it with the clerk's seal press.",
        },
      },
    });
  });

  it("keeps delayed branch results and safe reading links", () => {
    const view = questionPromptView({
      prompt: "What do you do now?",
      caseStudy: {
        episodeId: "basilisk-archive",
        title: "The Basilisk in the Archive",
        hook: "A threat arrives.",
        scene: "Two days pass.",
        stage: "decide",
        evidence: [],
        priorChoices: [{
          choiceId: "restricted-review",
          stage: "investigate",
          choiceLabel: "Use a review circle",
          delayedLabel: "Forty-eight hours later",
          delayedConsequence: "A careful objection and two context-free leaks appear.",
          revealedEvidence: [{ label: "Memo", source: "Reviewers", detail: "The causal incentive is missing." }],
          reflection: "Who selected into the review?",
        }],
        sources: [
          { label: "Roko's Basilisk", url: "https://www.lesswrong.com/w/rokos-basilisk", note: "Background" },
          { label: "Unsafe", url: "javascript:alert(1)", note: "No" },
        ],
      },
    });

    expect(view.caseStudy).toMatchObject({
      priorChoices: [{
        choiceId: "restricted-review",
        delayedConsequence: expect.stringContaining("two context-free leaks"),
        revealedEvidence: [{ detail: "The causal incentive is missing." }],
      }],
      sources: [{ label: "Roko's Basilisk", url: "https://www.lesswrong.com/w/rokos-basilisk" }],
    });
  });
});
