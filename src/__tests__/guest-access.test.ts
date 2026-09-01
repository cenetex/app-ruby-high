import { afterEach, describe, expect, it } from "vitest";
import {
  getActivePack,
  registerPublicPack,
  resetActivePack,
} from "../content/registry.js";
import type { ContentPack } from "../content/types.js";
import { DEFAULT_OPENROUTER_MODEL } from "../model-defaults.js";
import type { AuthRecord } from "../services/auth-service.js";
import {
  guestAccessStateForSession,
  guestTargetFacultyForCommand,
  guestTargetFacultyForTool,
  type GuestAccessState,
  type GuestFacultyResolutionState,
} from "../services/guest-access.js";
import type { RubyHighService } from "../services/ruby-high-service.js";

const TEST_PACK_ID = "teacher:guest-access-resolution-test";
const TEST_FACULTY_ID = "algebra-mentor";
const TEST_COURSE_ID = "math-101";
const TEST_TEMPLATE_ID = "teacher:math-template";

afterEach(() => {
  resetActivePack();
});

function guestResolverPack(): ContentPack {
  return {
    id: TEST_PACK_ID,
    name: "Guest Resolver Test Pack",
    description: "Pack for testing guest faculty target resolution.",
    version: "0.0.1",
    faculty: [{
      id: TEST_FACULTY_ID,
      displayName: "Algebra Mentor",
      shortName: "Algebra",
      subjects: ["algebra"],
      bio: "Teaches algebra.",
      accent: "#0b5fff",
      systemPrompt: "Keep it concise.",
      defaultModel: DEFAULT_OPENROUTER_MODEL,
      questions: [],
      assetTeacherId: TEST_TEMPLATE_ID,
    }],
    rooms: [{
      id: "room-algebra",
      name: "Algebra Lab",
      channelName: "algebra-lab",
      teacherId: TEST_FACULTY_ID,
      description: "Practice room",
      teaches: true,
    }],
    courses: [{
      id: TEST_COURSE_ID,
      title: "Math 101",
      facultyId: TEST_FACULTY_ID,
      roomId: "room-algebra",
      teacherTemplateId: TEST_TEMPLATE_ID,
      subjects: ["algebra"],
    }],
  };
}

function stateForPack(faculty: string): GuestFacultyResolutionState {
  return {
    sessionId: "session:guest-resolution",
    activePackId: TEST_PACK_ID,
    faculty,
  };
}

describe("guest target faculty resolution", () => {
  it("requires signup after First Bell completes outside the rotating daily faculty", () => {
    const ruby = {
      dailyStatus: () => ({ available: true, facultyId: "sally-science" }),
      courseProgress: (_sessionId: string, facultyId: string) => ({
        displayName: facultyId === "sally-science" ? "Sally Science" : "Homeroom",
        today: { status: facultyId === "ruby" ? "complete" : "available" },
      }),
    } as unknown as RubyHighService;

    const access = guestAccessStateForSession({
      record: { provider: "guest" } as AuthRecord,
      ruby,
      sessionId: "session:first-bell-guest",
    });

    expect(access).toMatchObject({
      dailyFacultyId: "sally-science",
      dailyFacultyName: "Sally Science",
      requiresSignup: true,
    });
  });

  it("resolves command targets with a table-driven matrix", async () => {
    await getActivePack();
    registerPublicPack(guestResolverPack());

    const guestAccess: GuestAccessState = {
      dailyFacultyId: TEST_FACULTY_ID,
      dailyFacultyName: "Algebra Mentor",
      allowedFacultyIds: new Set(["ruby", TEST_FACULTY_ID]),
      requiresSignup: false,
    };

    const cases: Array<{
      name: string;
      stateFaculty: string;
      commandType: string;
      requestedFacultyId: string | null;
      access: GuestAccessState | null;
      expected: string | null;
    }> = [
      {
        name: "set-faculty resolves course alias",
        stateFaculty: "ruby",
        commandType: "set-faculty",
        requestedFacultyId: TEST_COURSE_ID,
        access: guestAccess,
        expected: TEST_FACULTY_ID,
      },
      {
        name: "set-faculty resolves template alias",
        stateFaculty: "ruby",
        commandType: "set-faculty",
        requestedFacultyId: TEST_TEMPLATE_ID,
        access: guestAccess,
        expected: TEST_FACULTY_ID,
      },
      {
        name: "set-faculty preserves lounge",
        stateFaculty: "ruby",
        commandType: "set-faculty",
        requestedFacultyId: "lounge",
        access: guestAccess,
        expected: "lounge",
      },
      {
        name: "pick falls back to active faculty when none requested",
        stateFaculty: TEST_COURSE_ID,
        commandType: "pick",
        requestedFacultyId: null,
        access: guestAccess,
        expected: TEST_FACULTY_ID,
      },
      {
        name: "play-bonus targets today's lesson faculty",
        stateFaculty: "ruby",
        commandType: "play-bonus",
        requestedFacultyId: null,
        access: guestAccess,
        expected: TEST_FACULTY_ID,
      },
      {
        name: "play-daily returns null outside guest mode",
        stateFaculty: "ruby",
        commandType: "play-daily",
        requestedFacultyId: null,
        access: null,
        expected: null,
      },
      {
        name: "active-board commands resolve active faculty alias",
        stateFaculty: TEST_TEMPLATE_ID,
        commandType: "answer",
        requestedFacultyId: null,
        access: guestAccess,
        expected: TEST_FACULTY_ID,
      },
      {
        name: "unknown command has no faculty target",
        stateFaculty: "ruby",
        commandType: "reset",
        requestedFacultyId: null,
        access: guestAccess,
        expected: null,
      },
    ];

    for (const testCase of cases) {
      const resolved = guestTargetFacultyForCommand({
        state: stateForPack(testCase.stateFaculty),
        commandType: testCase.commandType,
        requestedFacultyId: testCase.requestedFacultyId,
        guestAccess: testCase.access,
      });
      expect(resolved, testCase.name).toBe(testCase.expected);
    }
  });

  it("resolves tool targets with a table-driven matrix", async () => {
    await getActivePack();
    registerPublicPack(guestResolverPack());

    const cases: Array<{
      name: string;
      tool: string;
      args: Record<string, unknown>;
      expected: string | null;
    }> = [
      {
        name: "handoff_faculty resolves course alias",
        tool: "handoff_faculty",
        args: { faculty: TEST_COURSE_ID },
        expected: TEST_FACULTY_ID,
      },
      {
        name: "pick_from_bank resolves template alias",
        tool: "pick_from_bank",
        args: { faculty: TEST_TEMPLATE_ID },
        expected: TEST_FACULTY_ID,
      },
      {
        name: "pose_question preserves lounge",
        tool: "pose_question",
        args: { faculty: "lounge" },
        expected: "lounge",
      },
      {
        name: "pose_opinion with empty faculty returns null",
        tool: "pose_opinion",
        args: { faculty: "   " },
        expected: null,
      },
      {
        name: "unrelated tool has no faculty target",
        tool: "set_student_mood",
        args: { faculty: TEST_COURSE_ID },
        expected: null,
      },
    ];

    for (const testCase of cases) {
      const resolved = guestTargetFacultyForTool({
        state: stateForPack("ruby"),
        tool: testCase.tool,
        toolArgs: testCase.args,
      });
      expect(resolved, testCase.name).toBe(testCase.expected);
    }
  });
});
