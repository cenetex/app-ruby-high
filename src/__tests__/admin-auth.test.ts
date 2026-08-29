import { afterEach, describe, expect, it, vi } from "vitest";
import { requireAdminAuth, requireSchedulerAuth } from "../routes/admin-auth.js";
import type { RouteContext } from "../routes/context.js";

function authContext(authorizationHeader?: string | string[]): {
  ctx: RouteContext;
  response: () => { status: number; error: string } | null;
} {
  let captured: { status: number; error: string } | null = null;
  const ctx = {
    authorizationHeader,
    res: {},
    error: (_res: unknown, error: string, status = 400) => {
      captured = { status, error };
    },
  } as RouteContext;
  return { ctx, response: () => captured };
}

describe("requireAdminAuth", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reports an unavailable admin configuration", () => {
    vi.stubEnv("RUBY_HIGH_ADMIN_TOKEN", "   ");
    const harness = authContext("Bearer any-token");

    expect(requireAdminAuth(harness.ctx)).toBeNull();
    expect(harness.response()).toEqual({
      status: 503,
      error: "Admin authentication is not configured.",
    });
  });

  it("normalizes array bearer headers and compares the token safely", () => {
    vi.stubEnv("RUBY_HIGH_ADMIN_TOKEN", " admin-route-test ");
    const harness = authContext(["Bearer admin-route-test", "Bearer ignored"]);

    expect(requireAdminAuth(harness.ctx)).toBe("admin-route-test");
    expect(harness.response()).toBeNull();
  });

  it("keeps raw-token compatibility and rejects invalid credentials", () => {
    vi.stubEnv("RUBY_HIGH_ADMIN_TOKEN", "admin-route-test");
    const raw = authContext("admin-route-test");
    const invalid = authContext("Bearer admin-route-tes");

    expect(requireAdminAuth(raw.ctx)).toBe("admin-route-test");
    expect(raw.response()).toBeNull();
    expect(requireAdminAuth(invalid.ctx)).toBeNull();
    expect(invalid.response()).toEqual({
      status: 401,
      error: "Admin authentication required.",
    });
  });
});

describe("requireSchedulerAuth", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses a separate least-privilege scheduler token", () => {
    vi.stubEnv("RUBY_HIGH_ADMIN_TOKEN", "admin-route-test");
    vi.stubEnv("RUBY_HIGH_SCHEDULER_TOKEN", "scheduler-route-test");
    const scheduler = authContext("Bearer scheduler-route-test");
    const admin = authContext("Bearer admin-route-test");

    expect(requireSchedulerAuth(scheduler.ctx)).toBe("scheduler-route-test");
    expect(scheduler.response()).toBeNull();
    expect(requireSchedulerAuth(admin.ctx)).toBeNull();
    expect(admin.response()).toEqual({
      status: 401,
      error: "Scheduler authentication required.",
    });
  });
});
