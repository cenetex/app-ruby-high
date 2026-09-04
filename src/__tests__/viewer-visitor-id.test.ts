import { afterEach, describe, expect, it, vi } from "vitest";
import {
  VIEWER_CONSTANTS,
  attachVisitorHeader,
  getVisitorId,
  rotateVisitorId,
} from "../viewer-parts/client-pure.js";

function installBrowserStorage(initial: string | null = null): Map<string, string> {
  const values = new Map<string, string>();
  if (initial !== null) values.set(VIEWER_CONSTANTS.VISITOR_ID_KEY, initial);
  vi.stubGlobal("localStorage", {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  });
  vi.stubGlobal("window", {
    crypto: {
      randomUUID: () => "00000000-0000-4000-8000-000000000123",
    },
  });
  return values;
}

describe("viewer visitor id", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps valid app-prefixed visitor ids", () => {
    const values = installBrowserStorage("rhv_existing_visitor");

    expect(getVisitorId()).toBe("rhv_existing_visitor");
    expect(values.get(VIEWER_CONSTANTS.VISITOR_ID_KEY)).toBe("rhv_existing_visitor");
  });

  it("migrates legacy unprefixed visitor ids before sending public headers", () => {
    const values = installBrowserStorage("legacy_visitor_id");

    const visitorId = getVisitorId();

    expect(visitorId).toBe("rhv_00000000-0000-4000-8000-000000000123");
    expect(values.get(VIEWER_CONSTANTS.VISITOR_ID_KEY)).toBe(visitorId);

    const headers = attachVisitorHeader(new Headers());
    expect(headers.get("X-Ruby-High-Visitor")).toBe(visitorId);
  });

  it("rotates the browser identity for a clean sign-out", () => {
    const values = installBrowserStorage("rhv_existing_visitor");

    expect(rotateVisitorId()).toBe("rhv_00000000-0000-4000-8000-000000000123");
    expect(values.get(VIEWER_CONSTANTS.VISITOR_ID_KEY)).toBe("rhv_00000000-0000-4000-8000-000000000123");
  });
});
