export interface MashGridStudent {
  id: string;
  name: string;
  color: string;
}

export interface MashGridCell {
  affinity?: number;
  scratched?: boolean;
  circled?: boolean;
}

export interface MashGridResolvedLine {
  studentId?: string;
  value?: string;
}

export interface MashGridCard {
  cells?: Record<string, MashGridCell | undefined>;
  resolved?: Record<string, MashGridResolvedLine | undefined>;
}

export interface MashGridCharacter {
  mashCard?: MashGridCard | null;
}

export interface MashGridRendererDeps {
  document: Pick<Document, "createElement">;
  students: MashGridStudent[];
  recentRelationshipEvents: () => unknown[];
  mashTickStory: (event: unknown) => string;
}

export interface MashGridRenderer {
  build(character: MashGridCharacter | null | undefined, graduated: boolean): HTMLElement | null;
}

export function createMashGridRenderer(deps: MashGridRendererDeps): MashGridRenderer {
  function studentName(studentId: string | undefined): string {
    if (!studentId) return "";
    const student = deps.students.find((entry) => entry.id === studentId);
    return student ? student.name : studentId;
  }

  function meterText(cell: MashGridCell | undefined, affinity: number): string {
    if (cell && cell.scratched) return "✗";
    if (cell && cell.circled) return "○";
    if (affinity > 0) return "+" + affinity;
    if (affinity < 0) return String(affinity);
    return "·";
  }

  return {
    build(character, graduated): HTMLElement | null {
      if (!character || !character.mashCard || !character.mashCard.cells) return null;
      const card = character.mashCard;
      const wrap = deps.document.createElement("div");
      wrap.className = "mash-grid-wrap";

      const heading = deps.document.createElement("div");
      heading.className = "mash-grid-heading";
      heading.textContent = graduated ? "Social Card · completed" : "Social Card";
      wrap.appendChild(heading);

      const helper = deps.document.createElement("div");
      helper.className = "mash-grid-helper";
      helper.textContent = graduated
        ? "Your final classmate connections."
        : "Relationships change after written responses.";
      wrap.appendChild(helper);

      const grid = deps.document.createElement("div");
      grid.className = "mash-grid";
      deps.students.forEach((student) => {
        const cell = card.cells ? card.cells[student.id] : undefined;
        const tile = deps.document.createElement("div");
        tile.className = "mash-tile";
        const affinity = cell && typeof cell.affinity === "number" ? cell.affinity : 0;
        if (cell && cell.scratched) tile.classList.add("is-scratched");
        else if (cell && cell.circled) tile.classList.add("is-circled");
        else if (affinity > 0) tile.classList.add("is-warm");
        else if (affinity < 0) tile.classList.add("is-cool");
        tile.style.setProperty("--mash-accent", student.color);

        const dot = deps.document.createElement("span");
        dot.className = "mash-tile-dot";
        tile.appendChild(dot);

        const name = deps.document.createElement("span");
        name.className = "mash-tile-name";
        name.textContent = student.name;
        tile.appendChild(name);

        const meter = deps.document.createElement("span");
        meter.className = "mash-tile-meter";
        meter.setAttribute("aria-label", "affinity " + affinity);
        meter.textContent = meterText(cell, affinity);
        tile.appendChild(meter);

        grid.appendChild(tile);
      });
      wrap.appendChild(grid);

      const recentTicks = deps.recentRelationshipEvents().slice(-3);
      if (recentTicks.length > 0) {
        const recent = deps.document.createElement("ul");
        recent.className = "mash-recent";
        recentTicks.forEach((event) => {
          const li = deps.document.createElement("li");
          li.textContent = deps.mashTickStory(event);
          recent.appendChild(li);
        });
        wrap.appendChild(recent);
      }

      const resolved = card.resolved || {};
      const lines: Array<{ axis: string; who: string; value: string | undefined }> = [];
      ["crush", "job", "lives", "pet", "money", "lucky"].forEach((axis) => {
        const entry = resolved[axis];
        if (!entry) return;
        lines.push({ axis, who: studentName(entry.studentId), value: entry.value });
      });
      if (lines.length > 0) {
        const list = deps.document.createElement("ul");
        list.className = "mash-resolved";
        lines.forEach((line) => {
          const li = deps.document.createElement("li");
          const tag = deps.document.createElement("span");
          tag.className = "mash-resolved-axis";
          tag.textContent = line.axis;
          const body = deps.document.createElement("span");
          body.className = "mash-resolved-body";
          body.textContent = line.who + " — " + line.value;
          li.appendChild(tag);
          li.appendChild(body);
          list.appendChild(li);
        });
        wrap.appendChild(list);
      }
      return wrap;
    },
  };
}
