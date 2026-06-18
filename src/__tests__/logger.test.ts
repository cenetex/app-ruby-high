import { afterEach, describe, expect, it, vi } from "vitest";
import { addLogObserver, log } from "../services/logger.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("structured logger", () => {
  it("keeps test output quiet while still notifying observers", () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const observed: string[] = [];
    const remove = addLogObserver((record) => {
      observed.push(record.name);
    });

    try {
      log.event("logger.test-event", { ok: true });
      log.error("logger.test-error", new Error("boom"));
    } finally {
      remove();
    }

    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
    expect(observed).toEqual(["logger.test-event", "logger.test-error"]);
  });

  it("reports observer failures without throwing out of the logger", () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const remove = addLogObserver(() => {
      throw new Error("observer broke");
    });

    try {
      expect(() => log.event("logger.observer-throw")).not.toThrow();
    } finally {
      remove();
    }

    expect(stderr).toHaveBeenCalledTimes(1);
    expect(String(stderr.mock.calls[0]?.[0] ?? "")).toContain("logger.sink-failed");
    expect(String(stderr.mock.calls[0]?.[0] ?? "")).toContain("observer broke");
  });
});
