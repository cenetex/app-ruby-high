import type { IAgentRuntime } from "@elizaos/core";
import { describe, expect, it, vi } from "vitest";
import { RubyHighAgentService } from "./service.js";

describe("RubyHighAgentService", () => {
  it("stores an approved device token as an elizaOS secret setting", async () => {
    const setSetting = vi.fn();
    const service = new RubyHighAgentService(runtime({ setSetting }));
    vi.spyOn(service.client, "beginDeviceAuthorization").mockResolvedValue({
      deviceCode: "device-code",
      userCode: "RUBY-123",
      verificationUri: "https://ruby-high.example/connect",
      verificationUriComplete:
        "https://ruby-high.example/connect?code=RUBY-123",
      expiresIn: 600,
      interval: 3,
      scopes: ["school:read", "student:play"],
    });
    vi.spyOn(service.client, "exchangeDeviceCode").mockImplementation(
      async () => {
        service.client.setAccessToken("approved-token");
        return {
          accessToken: "approved-token",
          tokenType: "Bearer",
          scope: "school:read student:play",
          agent: {
            id: "agent-1",
            agentName: "Test Agent",
            scopes: ["school:read", "student:play"],
            createdAt: 1,
            lastUsedAt: 1,
          },
        };
      },
    );

    await service.beginConnection();
    await expect(service.completeConnection()).resolves.toMatchObject({
      connected: true,
      agentName: "Test Agent",
    });
    expect(setSetting).toHaveBeenCalledWith(
      "RUBY_HIGH_AGENT_TOKEN",
      "approved-token",
      true,
    );
  });

  it("does not record a scheduled run when autonomy is disabled", async () => {
    const service = new RubyHighAgentService(runtime());
    service.client.setAccessToken("test-token");
    vi.spyOn(service.client, "me").mockResolvedValue({
      ok: true,
      agent: {
        id: "agent-1",
        agentName: "Test Agent",
        scopes: ["school:read", "student:play"],
        createdAt: 1,
        lastUsedAt: 1,
      },
      autonomy: {
        enabled: false,
        intervalMinutes: 60,
        maxClassesPerRun: 1,
        maxActionsPerRun: 8,
        maxModelCallsPerRun: 2,
        facultyAllowlist: ["guest"],
        publicPresence: false,
        nextRunAt: null,
        lastRunAt: null,
        lastStopReason: null,
      },
    });
    const noteRun = vi
      .spyOn(service.client, "noteAutonomyRun")
      .mockResolvedValue(null);

    await expect(service.runAutonomyOnce()).resolves.toBe("disabled");
    expect(noteRun).not.toHaveBeenCalled();
  });
});

function runtime(
  overrides: {
    setSetting?: (key: string, value: string | boolean | null, secret?: boolean) => void;
  } = {},
): IAgentRuntime {
  return {
    character: { name: "Test Agent" },
    getSetting: (key: string) =>
      key === "RUBY_HIGH_URL" ? "https://ruby-high.example" : null,
    setSetting: overrides.setSetting ?? (() => {}),
  } as unknown as IAgentRuntime;
}
