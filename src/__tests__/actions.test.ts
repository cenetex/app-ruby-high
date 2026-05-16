import type { Action, ActionResult, IAgentRuntime } from "@elizaos/core";
import { describe, expect, it, vi } from "vitest";
import { clearBoardAction } from "../actions/clear-board.js";
import { gradeAnswerAction } from "../actions/grade-answer.js";
import { handoffFacultyAction } from "../actions/handoff-faculty.js";
import { pickQuestionAction } from "../actions/pick-question.js";
import { poseQuestionAction } from "../actions/pose-question.js";
import { getSessionId as getActionSessionId } from "../actions/_helpers.js";
import { AuthService } from "../services/auth-service.js";
import { RubyHighService } from "../services/ruby-high-service.js";

function runtimeFor(service: unknown, agentId = "agent-1"): IAgentRuntime {
  return {
    agentId,
    getService(type: string) {
      return type === RubyHighService.serviceType ? service : null;
    },
  } as never;
}

async function runAction(action: Action, service: unknown, parameters?: Record<string, unknown>): Promise<ActionResult> {
  if (!action.handler) throw new Error(`${action.name} has no handler`);
  const result = await action.handler(
    runtimeFor(service),
    {} as never,
    {} as never,
    parameters ? { parameters } as never : undefined,
  );
  if (!result) throw new Error(`${action.name} returned no result`);
  return result;
}

describe("Eliza runtime actions", () => {
  it("uses an agent-scoped key for runtime actions even when AuthService is registered without a cookie", () => {
    const auth = { stateKeyForCookie: vi.fn(() => "rh:anonymous") };
    const runtime = {
      agentId: "agent-1",
      getService(type: string) {
        if (type === AuthService.serviceType) return auth;
        return null;
      },
    } as never as IAgentRuntime;

    expect(getActionSessionId(runtime)).toBe("rh:agent:agent-1");
    expect(auth.stateKeyForCookie).not.toHaveBeenCalled();
  });

  it("POSE_QUESTION validates required input before mutating the service", async () => {
    const service = { pose: vi.fn() };

    const result = await runAction(poseQuestionAction, service, {
      options: { A: "a", B: "b", C: "c", D: "d" },
      correct: "A",
    });

    expect(result).toMatchObject({ success: false, error: "POSE_QUESTION requires a 'prompt'" });
    expect(service.pose).not.toHaveBeenCalled();
  });

  it("POSE_QUESTION forwards a bank-persisted multiple-choice board payload", async () => {
    const service = {
      pose: vi.fn(() => ({
        faculty: "ruby",
        subject: "ai-literacy",
        current: { prompt: "What is a tool call?" },
      })),
    };

    const result = await runAction(poseQuestionAction, service, {
      prompt: "What is a tool call?",
      options: { A: "A request", B: "A snack", C: "A room", D: "A badge" },
      correct: "a",
      explanation: "It asks a tool to do work.",
      subject: "ai-literacy",
      stat: "head",
      faculty: "ruby",
    });

    expect(result.success).toBe(true);
    expect(service.pose).toHaveBeenCalledWith("rh:agent:agent-1", {
      prompt: "What is a tool call?",
      options: { A: "A request", B: "A snack", C: "A room", D: "A badge" },
      correct: "A",
      explanation: "It asks a tool to do work.",
      subject: "ai-literacy",
      stat: "head",
      faculty: "ruby",
      persistToBank: true,
    });
  });

  it("PICK_QUESTION normalizes optional filters and uses the runtime session id", async () => {
    const service = {
      pickAndPose: vi.fn(() => ({
        faculty: "sally-science",
        current: {
          difficulty: "medium",
          subject: "biology",
          prompt: "Which organelle makes ATP?",
        },
      })),
    };

    const result = await runAction(pickQuestionAction, service, {
      faculty: "sally-science",
      subject: "biology",
      difficulty: "MEDIUM",
    });

    expect(result.success).toBe(true);
    expect(service.pickAndPose).toHaveBeenCalledWith("rh:agent:agent-1", {
      faculty: "sally-science",
      subject: "biology",
      difficulty: "medium",
    });
  });

  it("GRADE_ANSWER uppercases the pick and returns the reveal summary", async () => {
    const service = {
      submitAnswer: vi.fn(() => ({
        score: { correct: 2, total: 3 },
        lastReveal: { picked: "B", correct: "A", wasCorrect: false },
      })),
    };

    const result = await runAction(gradeAnswerAction, service, { picked: "b" });

    expect(result).toMatchObject({
      success: true,
      text: "That was B. The answer was A. Record 2/3.",
    });
    expect(service.submitAnswer).toHaveBeenCalledWith("rh:agent:agent-1", "B");
  });

  it("CLEAR_BOARD and HANDOFF_FACULTY call the expected service methods", async () => {
    const service = {
      clearBoard: vi.fn(),
      setFaculty: vi.fn(() => ({ faculty: "professor-edward" })),
    };

    const cleared = await runAction(clearBoardAction, service);
    const handedOff = await runAction(handoffFacultyAction, service, { faculty: " professor-edward " });

    expect(cleared).toMatchObject({ success: true, text: "Board cleared." });
    expect(handedOff).toMatchObject({ success: true, text: "Now teaching: professor-edward." });
    expect(service.clearBoard).toHaveBeenCalledWith("rh:agent:agent-1");
    expect(service.setFaculty).toHaveBeenCalledWith("rh:agent:agent-1", "professor-edward");
  });

  it("wraps missing RubyHighService errors as action failures", async () => {
    const result = await runAction(clearBoardAction, null);

    expect(result.success).toBe(false);
    expect(result.error).toContain("RubyHighService is not registered");
  });
});
