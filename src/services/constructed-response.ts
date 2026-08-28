export type ConstructedResponseSelection = {
  stance: "support" | "challenge" | "conditional";
  evidence: "cause" | "compare" | "source";
  impact: "people" | "systems" | "future";
};

const STANCE_COPY: Record<ConstructedResponseSelection["stance"], string> = {
  support: "The claim mostly holds up, but it still needs evidence.",
  challenge: "The claim misses something important and should be challenged.",
  conditional: "The answer depends on the context and who is affected.",
};

const EVIDENCE_COPY: Record<ConstructedResponseSelection["evidence"], string> = {
  cause: "I would test it by tracing cause and effect.",
  compare: "I would compare examples before deciding.",
  source: "I would check the source and look for missing evidence.",
};

const IMPACT_COPY: Record<ConstructedResponseSelection["impact"], string> = {
  people: "The effect on people should carry the most weight.",
  systems: "The wider system and its rules should carry the most weight.",
  future: "The long-term result should carry the most weight.",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function parseConstructedResponseSelection(value: unknown): ConstructedResponseSelection | null {
  if (!isRecord(value)) return null;
  const stance = String(value.stance ?? "");
  const evidence = String(value.evidence ?? "");
  const impact = String(value.impact ?? "");
  if (!(stance in STANCE_COPY) || !(evidence in EVIDENCE_COPY) || !(impact in IMPACT_COPY)) return null;
  return {
    stance: stance as ConstructedResponseSelection["stance"],
    evidence: evidence as ConstructedResponseSelection["evidence"],
    impact: impact as ConstructedResponseSelection["impact"],
  };
}

export function constructedResponseText(selection: ConstructedResponseSelection): string {
  return [
    STANCE_COPY[selection.stance],
    EVIDENCE_COPY[selection.evidence],
    IMPACT_COPY[selection.impact],
  ].join(" ");
}
