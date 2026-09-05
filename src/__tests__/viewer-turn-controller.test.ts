import { describe, expect, it } from "vitest";
import { createViewerTurnController } from "../viewer-parts/turn-controller.js";

function makeHarness() {
  let viewSeq = 1;
  let faculty: string | null = "ruby";
  const controls = {
    nextDisabled: false,
  };
  const events: Array<{ target: "next"; disabled: boolean }> = [];
  const controller = createViewerTurnController({
    setNextButtonDisabled(disabled) {
      controls.nextDisabled = disabled;
      events.push({ target: "next", disabled });
    },
    currentViewSeq() {
      return viewSeq;
    },
    currentFaculty() {
      return faculty;
    },
  });
  return {
    controller,
    controls,
    events,
    setViewSeq(value: number) {
      viewSeq = value;
    },
    setFaculty(value: string | null) {
      faculty = value;
    },
  };
}

describe("viewer turn controller", () => {
  it("locks and releases the main button for manual turns", () => {
    const h = makeHarness();

    h.controller.syncControls();
    expect(h.controls).toEqual({ nextDisabled: false });

    const turn = h.controller.beginManual();
    expect(turn).not.toBeNull();
    expect(h.controller.isBusy()).toBe(true);
    expect(h.controls).toEqual({ nextDisabled: true });
    expect(h.controller.beginManual()).toBeNull();
    expect(h.controller.beginButtonAction()).toBeNull();

    turn!.finish();
    expect(h.controller.isBusy()).toBe(false);
    expect(h.controls).toEqual({ nextDisabled: false });
  });

  it("keeps controls locked until the newest forced agent turn finishes", () => {
    const h = makeHarness();
    const first = h.controller.beginAgent(false);
    expect(first).not.toBeNull();
    expect(h.controls).toEqual({ nextDisabled: true });

    const second = h.controller.beginAgent(true);
    expect(second).not.toBeNull();

    first!.finish();
    expect(h.controller.isBusy()).toBe(true);
    expect(h.controls).toEqual({ nextDisabled: true });

    second!.finish();
    expect(h.controller.isBusy()).toBe(false);
    expect(h.controls).toEqual({ nextDisabled: false });
  });

  it("locks the main button during a button action", () => {
    const h = makeHarness();

    h.controller.syncControls();
    expect(h.controls).toEqual({ nextDisabled: false });

    const turn = h.controller.beginButtonAction();
    expect(turn).not.toBeNull();
    expect(h.controls).toEqual({ nextDisabled: true });

    turn!.finish();
    expect(h.controls).toEqual({ nextDisabled: false });
  });

  it("invalidates stale stream guards across newer streams, view changes, and faculty changes", () => {
    const h = makeHarness();
    const first = h.controller.nextStreamGuard("ruby");
    expect(h.controller.streamStillCurrent(first)).toBe(true);

    const second = h.controller.nextStreamGuard("ruby");
    expect(h.controller.streamStillCurrent(first)).toBe(false);
    expect(h.controller.streamStillCurrent(second)).toBe(true);

    h.setFaculty("sally-science");
    expect(h.controller.streamStillCurrent(second)).toBe(false);

    const third = h.controller.nextStreamGuard("sally-science");
    expect(h.controller.streamStillCurrent(third)).toBe(true);

    h.setViewSeq(2);
    expect(h.controller.streamStillCurrent(third)).toBe(false);
  });
});
