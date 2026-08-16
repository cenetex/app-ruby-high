export interface TeacherImageEntitlement {
  configured?: boolean;
  cost?: number;
}

export interface TeacherImageStatusInput {
  authed: boolean;
  hasApiKey: boolean;
  entitlement?: TeacherImageEntitlement | null;
  canSpendHallPasses: boolean;
}

export interface TeacherImageStatusViewDeps {
  openRouterGenerationMessage: (action: string) => string;
}

export interface TeacherImageStatusView {
  reason(input: TeacherImageStatusInput): string;
  creditHint(input: TeacherImageStatusInput): string;
}

export function createTeacherImageStatusView(
  deps: TeacherImageStatusViewDeps,
): TeacherImageStatusView {
  function generationReason(input: TeacherImageStatusInput): string {
    if (!input.authed) return "Sign in before generating teacher images.";
    if (input.hasApiKey) return "";
    if (input.entitlement && input.entitlement.configured) return "";
    return deps.openRouterGenerationMessage("generating teacher images");
  }

  return {
    reason(input): string {
      return generationReason(input);
    },
    creditHint(input): string {
      const reason = generationReason(input);
      if (reason) return reason;
      if (!input.hasApiKey) return input.canSpendHallPasses
        ? "Ruby High image creation uses a Hall Pass when the image is ready."
        : "No Hall Passes yet. Buy Hall Passes or permanently destroy a collectible card first.";
      return "Uses your AI key. It does not use Hall Passes.";
    },
  };
}
