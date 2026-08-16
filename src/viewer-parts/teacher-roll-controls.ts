export interface TeacherRollAsset {
  id: string;
  name: string;
}

export interface TeacherRollCandidate {
  displayName?: string;
  subject?: string;
  description?: string;
  quote?: string;
  assetTeacherId?: string;
  profileImageUrl?: string;
  imageChoice?: string;
}

export interface TeacherRollControlsInput {
  roll: TeacherRollCandidate;
  importBusy: boolean;
  imageBusy: boolean;
  imageStatus: string;
  imageInvalid: boolean;
  imageReason: string;
  imageCreditHint: string;
  statsNode: HTMLElement;
  onFieldInput: (field: string, value: string) => void;
  onReroll: (key: string) => void;
  onChooseImage: (choice: string) => void;
  onGenerateImage: () => void;
  onCancelImage: () => void;
}

export interface TeacherRollControlsRendererDeps {
  document: Pick<Document, "createElement">;
  assets: TeacherRollAsset[];
}

export interface TeacherRollControlsRenderer {
  build(input: TeacherRollControlsInput): HTMLElement;
}

export function createTeacherRollControlsRenderer(
  deps: TeacherRollControlsRendererDeps,
): TeacherRollControlsRenderer {
  function currentImageChoice(roll: TeacherRollCandidate): string {
    if (roll.imageChoice === "custom" || roll.profileImageUrl) return "custom";
    return roll.assetTeacherId || "ruby";
  }

  function appendValue(parent: HTMLElement, value: unknown): void {
    if (value && typeof value === "object" && "nodeType" in value) {
      parent.appendChild(value as Node);
    } else {
      parent.textContent = String(value || "");
    }
  }

  function makeRow(
    fields: HTMLElement,
    input: TeacherRollControlsInput,
    label: string,
    key: string,
    value: unknown,
    opts?: {
      className?: string;
      editField?: string;
      maxLength?: number;
      multiline?: boolean;
      placeholder?: string;
      reroll?: boolean;
      rows?: number;
    },
  ): void {
    const row = deps.document.createElement("div");
    row.className = "creation-row" + (opts && opts.className ? " " + opts.className : "");
    const lab = deps.document.createElement("div");
    lab.className = "creation-row-label";
    lab.textContent = label;
    const val = deps.document.createElement("div");
    val.className = "creation-row-value";
    if (opts && opts.editField) {
      const edit = deps.document.createElement(opts.multiline ? "textarea" : "input");
      edit.className = "creation-edit-input" + (opts.multiline ? " is-multiline" : "");
      if (!opts.multiline) (edit as HTMLInputElement).type = "text";
      (edit as HTMLInputElement | HTMLTextAreaElement).value = String(value || "");
      (edit as HTMLInputElement | HTMLTextAreaElement).placeholder = opts.placeholder || "";
      if (opts.maxLength) (edit as HTMLInputElement | HTMLTextAreaElement).maxLength = opts.maxLength;
      if (opts.multiline) (edit as HTMLTextAreaElement).rows = opts.rows || 2;
      (edit as HTMLInputElement | HTMLTextAreaElement).disabled = input.importBusy;
      edit.addEventListener("input", () => {
        input.onFieldInput(opts.editField || "", (edit as HTMLInputElement | HTMLTextAreaElement).value);
      });
      val.appendChild(edit);
    } else {
      appendValue(val, value);
    }
    row.appendChild(lab);
    row.appendChild(val);
    if (!opts || opts.reroll !== false) {
      const reroll = deps.document.createElement("button");
      reroll.type = "button";
      reroll.className = "creation-reroll";
      reroll.title = "Try another " + label.toLowerCase();
      reroll.setAttribute("aria-label", "Try another " + label.toLowerCase());
      reroll.textContent = "↻";
      reroll.disabled = input.importBusy;
      reroll.addEventListener("click", () => input.onReroll(key));
      row.appendChild(reroll);
    }
    fields.appendChild(row);
  }

  function appendImageRow(fields: HTMLElement, input: TeacherRollControlsInput): void {
    const row = deps.document.createElement("div");
    row.className = "creation-row teacher-image-row";
    const lab = deps.document.createElement("div");
    lab.className = "creation-row-label";
    lab.textContent = "Image";
    const val = deps.document.createElement("div");
    val.className = "creation-row-value teacher-image-control";
    const choices = deps.document.createElement("div");
    choices.className = "teacher-image-presets";
    const current = currentImageChoice(input.roll);
    deps.assets.forEach((asset) => {
      const btn = deps.document.createElement("button");
      btn.type = "button";
      btn.className = "teacher-image-preset" + (current === asset.id ? " is-selected" : "");
      btn.textContent = asset.name;
      btn.disabled = input.importBusy || input.imageBusy;
      btn.addEventListener("click", () => input.onChooseImage(asset.id));
      choices.appendChild(btn);
    });
    const customBtn = deps.document.createElement("button");
    customBtn.type = "button";
    customBtn.className = "teacher-image-preset" + (current === "custom" ? " is-selected" : "");
    customBtn.textContent = "Custom";
    customBtn.disabled = input.importBusy || input.imageBusy;
    customBtn.addEventListener("click", () => input.onChooseImage("custom"));
    choices.appendChild(customBtn);
    val.appendChild(choices);

    if (current === "custom") {
      const custom = deps.document.createElement("div");
      custom.className = "teacher-custom-image";
      const generateBtn = deps.document.createElement("button");
      generateBtn.type = "button";
      generateBtn.className = "secondary teacher-custom-generate" + (input.imageBusy ? " is-loading" : "");
      generateBtn.dataset.requiresOpenrouter = "teacher-image";
      generateBtn.setAttribute("aria-busy", input.imageBusy ? "true" : "false");
      if (input.imageBusy) {
        const spinner = deps.document.createElement("span");
        spinner.className = "teacher-button-spinner";
        spinner.setAttribute("aria-hidden", "true");
        generateBtn.appendChild(spinner);
      }
      const generateLabel = deps.document.createElement("span");
      generateLabel.textContent = input.imageBusy ? "Generating" : (input.roll.profileImageUrl ? "Generate again" : "Generate");
      generateBtn.appendChild(generateLabel);
      generateBtn.disabled = input.importBusy || input.imageBusy || !!input.imageReason;
      generateBtn.title = input.imageReason;
      generateBtn.addEventListener("click", input.onGenerateImage);
      custom.appendChild(generateBtn);
      if (input.imageBusy) {
        const cancelBtn = deps.document.createElement("button");
        cancelBtn.type = "button";
        cancelBtn.className = "secondary teacher-generation-cancel";
        cancelBtn.textContent = "Cancel generation";
        cancelBtn.disabled = input.importBusy;
        cancelBtn.addEventListener("click", input.onCancelImage);
        custom.appendChild(cancelBtn);
      }
      const credit = deps.document.createElement("div");
      credit.className = "creation-portrait-status is-credit-hint";
      credit.textContent = input.imageBusy
        ? "Keep editing while the image generates. Save and Close unlock after it finishes or you cancel."
        : input.imageCreditHint;
      custom.appendChild(credit);
      const statusText = input.imageBusy ? "" : (input.imageStatus || (input.roll.profileImageUrl ? "Custom teacher image ready." : ""));
      if (statusText) {
        const status = deps.document.createElement("div");
        status.className = "creation-portrait-status" + (input.imageInvalid ? " is-invalid" : "");
        status.textContent = statusText;
        custom.appendChild(status);
      }
      val.appendChild(custom);
    }
    row.appendChild(lab);
    row.appendChild(val);
    fields.appendChild(row);
  }

  return {
    build(input): HTMLElement {
      const controlsCard = deps.document.createElement("div");
      controlsCard.className = "ccg-card is-career-card is-creation-control-card";
      const controlsRole = deps.document.createElement("span");
      controlsRole.className = "ccg-role career";
      controlsRole.textContent = "roll";
      controlsCard.appendChild(controlsRole);
      const controlsBody = deps.document.createElement("div");
      controlsBody.className = "ccg-body";
      controlsCard.appendChild(controlsBody);
      const controlsName = deps.document.createElement("div");
      controlsName.className = "ccg-name";
      controlsName.textContent = "Teacher Roll";
      controlsBody.appendChild(controlsName);
      const controlsSub = deps.document.createElement("div");
      controlsSub.className = "ccg-subtitle";
      controlsSub.textContent = "Start with a ready-made Ruby High teacher, then try another version of any part you want to change.";
      controlsBody.appendChild(controlsSub);
      const fields = deps.document.createElement("div");
      fields.className = "creation-fields";
      controlsBody.appendChild(fields);

      makeRow(fields, input, "Name", "name", input.roll.displayName, { editField: "displayName", maxLength: 64, placeholder: "Teacher name" });
      makeRow(fields, input, "Class", "style", input.roll.subject, { editField: "subject", maxLength: 80, placeholder: "Class or subject" });
      appendImageRow(fields, input);
      makeRow(fields, input, "Stats", "stats", input.statsNode, { className: "is-compact-stats" });
      makeRow(fields, input, "Style", "style", input.roll.description, { editField: "description", multiline: true, maxLength: 220, placeholder: "Teaching style", reroll: false });
      makeRow(fields, input, "Quote", "quote", input.roll.quote, { editField: "quote", multiline: true, maxLength: 160, placeholder: "Teacher quote" });
      return controlsCard;
    },
  };
}
