import { describe, expect, it } from "vitest";
import { createArcIndicatorRenderer } from "../viewer-parts/arc-indicator.js";
import type { ArcIndicatorView } from "../viewer-parts/client-pure.js";

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
  hidden = false;
  textContent = "";
  classList = new FakeClassList();
}

function view(overrides?: Partial<ArcIndicatorView>): ArcIndicatorView {
  return {
    hidden: false,
    graduated: false,
    yearText: "Sophomore",
    streakText: "📚 2/2",
    streakMet: true,
    subjectText: "✅ 3/3",
    subjectMet: true,
    essayVisible: true,
    essayText: "✍️ due",
    essayMet: false,
    ...overrides,
  };
}

describe("arc indicator renderer", () => {
  it("renders the top-bar arc labels and met/graduated classes from the typed view", () => {
    const root = new FakeElement();
    const year = new FakeElement();
    const streak = new FakeElement();
    const subject = new FakeElement();
    const essaySeparator = new FakeElement();
    const essay = new FakeElement();
    const calls: unknown[] = [];
    const renderer = createArcIndicatorRenderer({
      root: root as unknown as HTMLElement,
      year: year as unknown as HTMLElement,
      streak: streak as unknown as HTMLElement,
      subject: subject as unknown as HTMLElement,
      essaySeparator: essaySeparator as unknown as HTMLElement,
      essay: essay as unknown as HTMLElement,
      viewFor(telemetry, subjects) {
        calls.push(telemetry, subjects);
        return view({ graduated: true });
      },
    });

    renderer.render({ character: true }, {
      subjects: { met: 3, total: 3 },
    });

    expect(calls).toEqual([{ character: true }, { met: 3, total: 3 }]);
    expect(root.hidden).toBe(false);
    expect([...root.classList.values]).toEqual(["is-graduated"]);
    expect(year.textContent).toBe("Sophomore");
    expect(streak.textContent).toBe("📚 2/2");
    expect([...streak.classList.values]).toEqual(["is-met"]);
    expect(subject.textContent).toBe("✅ 3/3");
    expect([...subject.classList.values]).toEqual(["is-met"]);
    expect(essaySeparator.hidden).toBe(false);
    expect(essay.hidden).toBe(false);
    expect(essay.textContent).toBe("✍️ due");
  });

  it("hides the root without mutating stale child text when the view is hidden", () => {
    const root = new FakeElement();
    const year = new FakeElement();
    year.textContent = "Junior";
    const renderer = createArcIndicatorRenderer({
      root: root as unknown as HTMLElement,
      year: year as unknown as HTMLElement,
      viewFor: () => view({ hidden: true }),
    });

    renderer.render({}, { subjects: {} });

    expect(root.hidden).toBe(true);
    expect(year.textContent).toBe("Junior");
  });

  it("removes stale met and graduated classes when the next view is below the gate", () => {
    const root = new FakeElement();
    root.classList.add("is-graduated");
    const streak = new FakeElement();
    streak.classList.add("is-met");
    const subject = new FakeElement();
    subject.classList.add("is-met");
    const essay = new FakeElement();
    essay.classList.add("is-met");
    const essaySeparator = new FakeElement();
    const renderer = createArcIndicatorRenderer({
      root: root as unknown as HTMLElement,
      streak: streak as unknown as HTMLElement,
      subject: subject as unknown as HTMLElement,
      essaySeparator: essaySeparator as unknown as HTMLElement,
      essay: essay as unknown as HTMLElement,
      viewFor: () => view({
        graduated: false,
        streakMet: false,
        subjectMet: false,
        streakText: "📚 1/3",
        subjectText: "✅ 1/3",
        essayVisible: false,
        essayText: "",
        essayMet: false,
      }),
    });

    renderer.render({}, { subjects: {} });

    expect([...root.classList.values]).toEqual([]);
    expect(streak.textContent).toBe("📚 1/3");
    expect([...streak.classList.values]).toEqual([]);
    expect(subject.textContent).toBe("✅ 1/3");
    expect([...subject.classList.values]).toEqual([]);
    expect([...essay.classList.values]).toEqual([]);
    expect(essaySeparator.hidden).toBe(true);
    expect(essay.hidden).toBe(true);
  });
});
