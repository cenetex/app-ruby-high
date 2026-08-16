import { describe, expect, it } from "vitest";
import { createRaceStripRenderer, type RaceStripPanelView } from "../viewer-parts/race-strip.js";

class FakeClassList {
  readonly values = new Set<string>();

  add(name: string): void {
    this.values.add(name);
  }

  toggle(name: string, force?: boolean): boolean {
    const next = force === undefined ? !this.values.has(name) : !!force;
    if (next) this.values.add(name);
    else this.values.delete(name);
    return next;
  }
}

class FakeElement {
  className = "";
  textContent = "";
  title = "";
  children: FakeElement[] = [];
  classList = new FakeClassList();
  style: Record<string, string> = {};

  constructor(readonly tagName: string) {}

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  replaceChildren(...children: FakeElement[]): void {
    this.children = children;
  }
}

function createDocument() {
  return {
    createElement(tagName: string) {
      return new FakeElement(tagName) as unknown as HTMLElement;
    },
  };
}

function panelView(overrides?: Partial<RaceStripPanelView>): RaceStripPanelView {
  return {
    timer: { label: "4s", warn: false, danger: true, locked: false },
    cards: [
      {
        kind: "player",
        id: "player",
        name: "You",
        avatarText: "U",
        color: "var(--accent)",
        isLocked: true,
        isTimedOut: false,
        isCorrect: true,
        isFirstCorrect: true,
        pickText: "B",
        showThinking: false,
      },
      {
        kind: "student",
        id: "noor",
        name: "Noor",
        avatarText: "N",
        color: "#d22a2a",
        isLocked: false,
        isTimedOut: false,
        isCorrect: null,
        isFirstCorrect: false,
        pickText: "",
        showThinking: true,
      },
    ],
    ...overrides,
  };
}

describe("race strip renderer", () => {
  it("renders timer state and participant cards from the typed view model", () => {
    const timerLabel = new FakeElement("span");
    const timerPill = new FakeElement("span");
    const row = new FakeElement("div");
    const calls: unknown[] = [];
    const renderer = createRaceStripRenderer({
      document: createDocument(),
      timerLabel: timerLabel as unknown as HTMLElement,
      timerPill: timerPill as unknown as HTMLElement,
      row: row as unknown as HTMLElement,
      viewFor(telemetry, students, visibleStudentIds, playerName) {
        calls.push(telemetry, students, visibleStudentIds, playerName);
        return panelView();
      },
    });

    renderer.render({ round: true }, {
      students: [{ id: "noor" }],
      visibleStudentIds: ["noor"],
      playerName: "Mina",
    });

    expect(calls).toEqual([{ round: true }, [{ id: "noor" }], ["noor"], "Mina"]);
    expect(timerLabel.textContent).toBe("4s");
    expect([...timerPill.classList.values].sort()).toEqual(["is-danger"]);
    expect(timerPill.title).toBe("");
    expect(row.children.map((child) => child.className)).toEqual([
      "race-card is-locked",
      "race-card",
    ]);
    expect([...row.children[0]!.classList.values].sort()).toEqual(["is-correct", "is-first-correct"]);
    expect(row.children[0]!.children[0]!.className).toBe("race-avatar");
    expect(row.children[0]!.children[0]!.style.background).toBe("var(--accent)");
    expect(row.children[0]!.children[0]!.style.color).toBe("#fff");
    expect(row.children[0]!.children[0]!.textContent).toBe("U");
    expect(row.children[0]!.children[1]!.textContent).toBe("You");
    expect(row.children[0]!.children[2]!.className).toBe("pick-letter");
    expect(row.children[0]!.children[2]!.textContent).toBe("B");
    expect(row.children[1]!.children[2]!.className).toBe("thinking-dots");
    expect(row.children[1]!.children[2]!.children).toHaveLength(3);
  });

  it("clears stale cards when there is no active race-strip view", () => {
    const row = new FakeElement("div");
    row.appendChild(new FakeElement("stale"));
    const renderer = createRaceStripRenderer({
      document: createDocument(),
      row: row as unknown as HTMLElement,
      viewFor: () => null,
    });

    renderer.render({}, { students: [], visibleStudentIds: [], playerName: "You" });

    expect(row.children).toEqual([]);
  });

  it("marks timed-out picks without keeping stale timer classes", () => {
    const timerLabel = new FakeElement("span");
    const timerPill = new FakeElement("span");
    timerPill.classList.add("is-warn");
    timerPill.classList.add("is-danger");
    timerPill.classList.add("is-soft");
    const row = new FakeElement("div");
    const renderer = createRaceStripRenderer({
      document: createDocument(),
      timerLabel: timerLabel as unknown as HTMLElement,
      timerPill: timerPill as unknown as HTMLElement,
      row: row as unknown as HTMLElement,
      viewFor: () => panelView({
        timer: { label: "done", warn: false, danger: false, locked: true },
        cards: [{
          kind: "player",
          id: "player",
          name: "You",
          avatarText: "U",
          color: "var(--accent)",
          isLocked: true,
          isTimedOut: true,
          isCorrect: false,
          isFirstCorrect: false,
          pickText: "⏱",
          showThinking: false,
        }],
      }),
    });

    renderer.render({}, { students: [], visibleStudentIds: [], playerName: "You" });

    expect(timerLabel.textContent).toBe("done");
    expect([...timerPill.classList.values]).toEqual(["is-locked"]);
    expect(timerPill.title).toBe("");
    expect(row.children[0]!.children[2]!.title).toBe("Timed out");
    expect([...row.children[0]!.classList.values]).toEqual(["is-wrong"]);
  });

  it("marks the timer as soft after the answer window stays open", () => {
    const timerLabel = new FakeElement("span");
    const timerPill = new FakeElement("span");
    const row = new FakeElement("div");
    const renderer = createRaceStripRenderer({
      document: createDocument(),
      timerLabel: timerLabel as unknown as HTMLElement,
      timerPill: timerPill as unknown as HTMLElement,
      row: row as unknown as HTMLElement,
      viewFor: () => panelView({
        timer: { label: "open", warn: false, danger: false, locked: false, soft: true },
      }),
    });

    renderer.render({}, { students: [], visibleStudentIds: [], playerName: "You" });

    expect(timerLabel.textContent).toBe("open");
    expect([...timerPill.classList.values]).toEqual(["is-soft"]);
    expect(timerPill.title).toBe("The timer ended, but you can still answer. Some classmates may have answered already.");
  });
});
