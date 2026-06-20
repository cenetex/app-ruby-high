import { describe, expect, it } from "vitest";
import { createLeaderboardPanelRenderer, type LeaderboardPanelView } from "../viewer-parts/leaderboard-panel.js";

class FakeElement {
  className = "";
  textContent = "";
  src = "";
  alt = "";
  children: FakeElement[] = [];
  onerror: (() => void) | null = null;

  constructor(readonly tagName: string) {}

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  replaceChildren(...children: FakeElement[]): void {
    this.children = children;
    this.textContent = "";
  }
}

function createDocument() {
  return {
    createElement(tagName: string) {
      return new FakeElement(tagName) as unknown as HTMLElement;
    },
    createTextNode(text: string) {
      const node = new FakeElement("#text");
      node.textContent = text;
      return node as unknown as Text;
    },
  };
}

function textTree(node: FakeElement): string[] {
  return [
    node.textContent,
    ...node.children.flatMap((child) => textTree(child)),
  ].filter(Boolean);
}

function panelView(overrides?: Partial<LeaderboardPanelView>): LeaderboardPanelView {
  return {
    empty: false,
    gradeLabel: "Grade 10",
    count: 2,
    rows: [
      {
        rank: "1",
        rankClass: "leaderboard-rank rank-1",
        name: "Noor",
        portraitUrl: "/portraits/noor.png",
        avatarText: "N",
        playbookName: "Rebel",
        gradeChips: [
          { className: "leaderboard-grade-chip is-a", text: "Ruby A" },
          { className: "leaderboard-grade-chip is-b", text: "Sally B" },
        ],
      },
      {
        rank: "2",
        rankClass: "leaderboard-rank rank-2",
        name: "Vince",
        portraitUrl: "",
        avatarText: "V",
        playbookName: "Spark",
        gradeChips: [],
      },
    ],
    ...overrides,
  };
}

describe("leaderboard panel renderer", () => {
  it("renders grouped leaderboard rows from the typed view model", () => {
    const body = new FakeElement("div");
    const calls: unknown[] = [];
    const renderer = createLeaderboardPanelRenderer({
      document: createDocument(),
      body: body as unknown as HTMLElement,
      viewFor(data, playbooks) {
        calls.push(data, playbooks);
        return panelView();
      },
    });

    renderer.render({ students: [{ name: "Noor" }] }, [{ id: "rebel" }]);

    expect(calls).toEqual([{ students: [{ name: "Noor" }] }, [{ id: "rebel" }]]);
    expect(body.children).toHaveLength(1);
    const group = body.children[0]!;
    expect(group.className).toBe("leaderboard-year-group");
    expect(group.children[0]!.className).toBe("leaderboard-year-header");
    expect(group.children[0]!.children[0]!.textContent).toBe("Grade 10 Classroom ");
    expect(group.children[0]!.children[1]!.className).toBe("leaderboard-year-count");
    expect(group.children[0]!.children[1]!.textContent).toBe("2");
    expect(group.children.slice(1).map((row) => row.className)).toEqual([
      "leaderboard-row",
      "leaderboard-row",
    ]);
    expect(textTree(group)).toEqual([
      "Grade 10 Classroom ",
      "2",
      "1",
      "Noor",
      "Rebel",
      "Ruby A",
      "Sally B",
      "2",
      "V",
      "Vince",
      "Spark",
    ]);
    const portrait = group.children[1]!.children[1]!;
    expect(portrait.className).toBe("leaderboard-portrait");
    expect(portrait.children[0]!.tagName).toBe("img");
    portrait.children[0]!.onerror?.();
    expect(portrait.textContent).toBe("N");
  });

  it("renders the empty state without stale rows", () => {
    const body = new FakeElement("div");
    body.appendChild(new FakeElement("stale"));
    const renderer = createLeaderboardPanelRenderer({
      document: createDocument(),
      body: body as unknown as HTMLElement,
      viewFor: () => panelView({ empty: true, count: 0, rows: [] }),
    });

    renderer.render({}, []);

    expect(body.children).toHaveLength(1);
    expect(body.children[0]!.className).toBe("leaderboard-empty");
    expect(body.children[0]!.textContent).toBe("No classmates yet. Complete daily classes with other players to see them here.");
  });
});
