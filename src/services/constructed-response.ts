import type { QuizState } from "../types.js";

export type ConstructedResponseClaim = {
  id: string;
  prompt: string;
  answer: string;
};

export type ConstructedResponseSelection = {
  claimId: string;
  stance: "support" | "challenge" | "conditional";
  evidence: "cause" | "compare" | "source";
  impact: "people" | "systems" | "future";
};

const STANCE_COPY: Record<ConstructedResponseSelection["stance"], (claim: string) => string> = {
  support: (claim) => `I think “${claim}” mostly holds up`,
  challenge: (claim) => `I would challenge “${claim}” because it may miss important context`,
  conditional: (claim) => `Whether “${claim}” holds depends on the context and who is affected`,
};

const EVIDENCE_COPY: Record<ConstructedResponseSelection["evidence"], string> = {
  cause: "I would test that by tracing cause and effect",
  compare: "I would compare examples before deciding",
  source: "I would check the source and look for missing evidence",
};

const IMPACT_COPY: Record<ConstructedResponseSelection["impact"], string> = {
  people: "judge it by the effect on people",
  systems: "judge it by the wider system and its rules",
  future: "judge it by the long-term result",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function parseConstructedResponseSelection(value: unknown): ConstructedResponseSelection | null {
  if (!isRecord(value)) return null;
  const claimId = typeof value.claimId === "string" ? value.claimId.trim() : "";
  const stance = String(value.stance ?? "");
  const evidence = String(value.evidence ?? "");
  const impact = String(value.impact ?? "");
  if (!claimId || claimId.length > 240) return null;
  if (!(stance in STANCE_COPY) || !(evidence in EVIDENCE_COPY) || !(impact in IMPACT_COPY)) return null;
  return {
    claimId,
    stance: stance as ConstructedResponseSelection["stance"],
    evidence: evidence as ConstructedResponseSelection["evidence"],
    impact: impact as ConstructedResponseSelection["impact"],
  };
}

export function constructedResponseClaimsForState(state: QuizState): ConstructedResponseClaim[] {
  const session = state.activeRound?.classSession;
  const facultyId = session?.facultyId ?? state.faculty;
  const classDate = session?.date;
  const eligible = state.history.filter((record) =>
    record.answerKind === "choice"
    && !!record.answerText?.trim()
    && !!record.questionPrompt?.trim()
    && (!record.faculty || record.faculty === facultyId),
  );
  const today = classDate
    ? eligible.filter((record) => record.classMode === "class" && record.classDate === classDate)
    : [];
  const records = today.length >= 2 ? today : eligible;
  const seen = new Set<string>();
  const claims: ConstructedResponseClaim[] = [];
  for (let index = records.length - 1; index >= 0 && claims.length < 2; index -= 1) {
    const record = records[index]!;
    const id = `${record.questionId}:${record.at}`;
    if (seen.has(id)) continue;
    seen.add(id);
    claims.push({
      id,
      prompt: record.questionPrompt!.trim().slice(0, 360),
      answer: record.answerText!.trim().slice(0, 220),
    });
  }
  return claims.reverse();
}

export function constructedResponseText(
  selection: ConstructedResponseSelection,
  claim: ConstructedResponseClaim,
): string {
  return `${STANCE_COPY[selection.stance](claim.answer)}. ${EVIDENCE_COPY[selection.evidence]}, then ${IMPACT_COPY[selection.impact]}.`;
}
