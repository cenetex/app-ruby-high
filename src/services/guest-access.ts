import type { AuthRecord } from "./auth-service.js";
import type { RubyHighService } from "./ruby-high-service.js";
import { resolveFacultyIdForSession } from "../content/registry.js";

const HOMEROOM_FACULTY_ID = "ruby";

export const GUEST_SIGNUP_REQUIRED_MESSAGE =
  "Guest lesson complete. Sign up to continue past today's class.";

export interface GuestAccessState {
  dailyFacultyId: string;
  dailyFacultyName: string;
  allowedFacultyIds: Set<string>;
  requiresSignup: boolean;
}

export interface GuestAccessViolation {
  status: 403;
  reason: "signup-required" | "faculty-blocked";
  message: string;
}

export interface GuestFacultyResolutionState {
  faculty: string;
  sessionId?: string | null;
  activePackId?: string | null;
  guestPackMode?: "auto" | "override" | null;
  guestPackOverrideId?: string | null;
}

const COMMANDS_USING_ACTIVE_FACULTY = new Set([
  "answer",
  "answer-text",
  "generate-mc",
  "clear",
  "force-resolve",
  "roll-advantage",
]);

const TOOLS_WITH_FACULTY_ARG = new Set([
  "handoff_faculty",
  "pick_from_bank",
  "pose_question",
  "pose_opinion",
]);

export function guestAccessStateForSession(args: {
  record: AuthRecord | null | undefined;
  ruby: RubyHighService;
  sessionId: string;
}): GuestAccessState | null {
  if (args.record?.provider !== "guest") return null;

  const dailyStatus = args.ruby.dailyStatus(args.sessionId);
  const dailyFacultyId = dailyStatus.facultyId || HOMEROOM_FACULTY_ID;

  let dailyFacultyName = dailyFacultyId;
  let requiresSignup = false;
  try {
    const progress = args.ruby.courseProgress(args.sessionId, dailyFacultyId);
    dailyFacultyName = progress.displayName || dailyFacultyId;
    requiresSignup = progress.today?.status === "complete";
  } catch {
    // Keep a safe default if pack/session state is mid-migration.
  }

  const allowedFacultyIds = new Set<string>([HOMEROOM_FACULTY_ID, dailyFacultyId]);
  return {
    dailyFacultyId,
    dailyFacultyName,
    allowedFacultyIds,
    requiresSignup,
  };
}

export function guestFacultyDeniedMessage(guest: GuestAccessState): string {
  return `Guest mode is limited to Homeroom and today's lesson (${guest.dailyFacultyName}). Sign up to unlock all classrooms.`;
}

export function guestCanAccessFaculty(guest: GuestAccessState, facultyId: string): boolean {
  return guest.allowedFacultyIds.has(facultyId);
}

export function resolveGuestRequestedFaculty(args: {
  state: GuestFacultyResolutionState;
  requestedFacultyId: string | null | undefined;
}): string | null {
  const requested = args.requestedFacultyId?.trim();
  if (!requested) return null;
  if (requested === "lounge") return requested;
  return resolveFacultyIdForSession(args.state, requested) ?? requested;
}

export function guestTargetFacultyForCommand(args: {
  state: GuestFacultyResolutionState;
  commandType: string | null | undefined;
  requestedFacultyId: string | null | undefined;
  guestAccess: GuestAccessState | null;
}): string | null {
  const commandType = args.commandType?.trim();
  if (!commandType) return null;
  if (commandType === "set-faculty") {
    return resolveGuestRequestedFaculty({
      state: args.state,
      requestedFacultyId: args.requestedFacultyId,
    });
  }
  if (commandType === "pick") {
    return resolveGuestRequestedFaculty({
      state: args.state,
      requestedFacultyId: args.requestedFacultyId?.trim() ? args.requestedFacultyId : args.state.faculty,
    });
  }
  if (commandType === "play-bonus" || commandType === "play-daily") {
    return args.guestAccess?.dailyFacultyId ?? null;
  }
  if (COMMANDS_USING_ACTIVE_FACULTY.has(commandType)) {
    return resolveGuestRequestedFaculty({
      state: args.state,
      requestedFacultyId: args.state.faculty,
    });
  }
  return null;
}

export function guestTargetFacultyForTool(args: {
  state: GuestFacultyResolutionState;
  tool: string | null | undefined;
  toolArgs: Record<string, unknown> | null | undefined;
}): string | null {
  const tool = args.tool?.trim();
  if (!tool || !TOOLS_WITH_FACULTY_ARG.has(tool)) return null;
  return resolveGuestRequestedFaculty({
    state: args.state,
    requestedFacultyId: String(args.toolArgs?.faculty ?? ""),
  });
}

export function guestAccessViolation(args: {
  guestAccess: GuestAccessState | null;
  facultyId?: string | null;
}): GuestAccessViolation | null {
  const guest = args.guestAccess;
  if (!guest) return null;
  if (guest.requiresSignup) {
    return {
      status: 403,
      reason: "signup-required",
      message: GUEST_SIGNUP_REQUIRED_MESSAGE,
    };
  }
  const facultyId = args.facultyId?.trim();
  if (!facultyId) return null;
  if (!guestCanAccessFaculty(guest, facultyId)) {
    return {
      status: 403,
      reason: "faculty-blocked",
      message: guestFacultyDeniedMessage(guest),
    };
  }
  return null;
}
