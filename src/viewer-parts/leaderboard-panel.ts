import type { LeaderboardRowView } from "./client-pure.js";

export interface LeaderboardPanelView {
  empty: boolean;
  gradeLabel: string;
  count: number;
  rows: LeaderboardRowView[];
}

export interface LeaderboardPanelRendererDeps {
  document: Pick<Document, "createElement" | "createTextNode">;
  body?: HTMLElement | null;
  viewFor(data: unknown, playbooks: unknown): LeaderboardPanelView;
}

export interface LeaderboardPanelRenderer {
  render(data: unknown, playbooks: unknown): void;
}

export function createLeaderboardPanelRenderer(deps: LeaderboardPanelRendererDeps): LeaderboardPanelRenderer {
  function appendEmpty(parent: HTMLElement): void {
    const empty = deps.document.createElement("div");
    empty.className = "leaderboard-empty";
    empty.textContent = "No classmates yet. Complete daily classes with other players to see them here.";
    parent.appendChild(empty);
  }

  function appendHeader(parent: HTMLElement, view: LeaderboardPanelView): void {
    const header = deps.document.createElement("div");
    header.className = "leaderboard-year-header";
    header.appendChild(deps.document.createTextNode(view.gradeLabel + " Classroom "));
    const count = deps.document.createElement("span");
    count.className = "leaderboard-year-count";
    count.textContent = String(view.count);
    header.appendChild(count);
    parent.appendChild(header);
  }

  function appendPortrait(parent: HTMLElement, rowView: LeaderboardRowView): void {
    const thumb = deps.document.createElement("div");
    thumb.className = "leaderboard-portrait";
    if (rowView.portraitUrl) {
      const img = deps.document.createElement("img");
      img.src = rowView.portraitUrl;
      img.alt = "";
      img.onerror = () => {
        thumb.textContent = rowView.avatarText;
      };
      thumb.appendChild(img);
    } else {
      thumb.textContent = rowView.avatarText;
    }
    parent.appendChild(thumb);
  }

  function appendGradeChips(parent: HTMLElement, rowView: LeaderboardRowView): void {
    if (rowView.gradeChips.length === 0) return;
    const grades = deps.document.createElement("div");
    grades.className = "leaderboard-grades";
    rowView.gradeChips.forEach((gradeChip) => {
      const chip = deps.document.createElement("span");
      chip.className = gradeChip.className;
      chip.textContent = gradeChip.text;
      grades.appendChild(chip);
    });
    parent.appendChild(grades);
  }

  function appendRow(parent: HTMLElement, rowView: LeaderboardRowView): void {
    const row = deps.document.createElement("div");
    row.className = "leaderboard-row";
    const rank = deps.document.createElement("div");
    rank.className = rowView.rankClass;
    rank.textContent = rowView.rank;
    row.appendChild(rank);
    appendPortrait(row, rowView);
    const info = deps.document.createElement("div");
    info.className = "leaderboard-info";
    const name = deps.document.createElement("div");
    name.className = "leaderboard-name";
    name.textContent = rowView.name;
    info.appendChild(name);
    const playbook = deps.document.createElement("div");
    playbook.className = "leaderboard-playbook";
    playbook.textContent = rowView.playbookName;
    info.appendChild(playbook);
    appendGradeChips(info, rowView);
    row.appendChild(info);
    parent.appendChild(row);
  }

  return {
    render(data: unknown, playbooks: unknown): void {
      const body = deps.body;
      if (!body) return;
      const view = deps.viewFor(data, playbooks);
      body.replaceChildren();
      if (view.empty) {
        appendEmpty(body);
        return;
      }
      const group = deps.document.createElement("div");
      group.className = "leaderboard-year-group";
      appendHeader(group, view);
      view.rows.forEach((rowView) => appendRow(group, rowView));
      body.appendChild(group);
    },
  };
}
