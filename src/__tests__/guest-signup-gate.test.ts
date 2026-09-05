import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FacultyService } from "../services/faculty-service.js";
import { RubyHighService } from "../services/ruby-high-service.js";
import { StateStore } from "../services/state-store.js";
import { resetActivePack } from "../content/registry.js";
import {
  GUEST_SIGNUP_REQUIRED_MESSAGE,
  guestAccessStateForSession,
  guestAccessViolation,
} from "../services/guest-access.js";
import { facultyForDay, dailyKey } from "../types.js";

// The guest signup gate is the whole conversion funnel: a guest who finishes
// the daily class must be asked to sign up. Production smoke caught this
// silently regressing with no unit coverage behind it, so these lock the
// invariant at the service boundary.

let tmpDir: string;
let storePath: string;
let activeRuby: RubyHighService | null = null;

beforeEach(async () => {
  resetActivePack();
  tmpDir = await mkdtemp(join(tmpdir(), "ruby-high-guest-gate-"));
  storePath = join(tmpDir, "state.json");
  activeRuby = null;
});

afterEach(async () => {
  if (activeRuby) await activeRuby.flush();
  resetActivePack();
  await rm(tmpDir, { recursive: true, force: true });
});

async function makeServices() {
  const faculty = await FacultyService.start({} as never);
  const ruby = new RubyHighService({} as never, new StateStore(storePath));
  await ruby["hydrate"]();
  ruby.setFacultyService(faculty);
  activeRuby = ruby;
  return { ruby };
}

/** A fresh grade-9 guest: no pre-filled daily classes, no prior bonus. */
function freshGuest(ruby: RubyHighService, sid: string) {
  ruby.selectGrade(sid, "9");
  const state = ruby.getOrCreate(sid);
  state.character = {
    name: "Pip",
    playbookId: "overachiever",
    stats: { head: 1, heart: 0, hustle: 0, honor: 1 },
    arcAnswer: "—",
    personality: "—",
    yearbook: [],
    createdAt: Date.now(),
  } as never;
  return state;
}

/** Play today's class to exhaustion, the way the browser does. */
function playDailyClass(ruby: RubyHighService, sid: string, maxCards = 12): string[] {
  const roles: string[] = [];
  for (let i = 0; i < maxCards; i++) {
    if (!ruby.dailyStatus(sid).available) break;
    const next = ruby.playBonus(sid);
    roles.push(next.activeRound?.cardRole ?? "unknown");
    if (!next.current?.id) break;
    ruby.submitAnswer(sid, "A");
  }
  return roles;
}

function gateFor(ruby: RubyHighService, sid: string) {
  return guestAccessStateForSession({
    record: { provider: "guest" } as never,
    ruby,
    sessionId: sid,
  });
}

describe("guest signup gate", () => {
  it("does not gate a guest who has not finished the daily class", async () => {
    const { ruby } = await makeServices();
    const sid = "guest-gate:untouched";
    freshGuest(ruby, sid);

    expect(gateFor(ruby, sid)?.requiresSignup).toBe(false);
  });

  it("gates a guest once the daily class is finished", async () => {
    const { ruby } = await makeServices();
    const sid = "guest-gate:finished";
    freshGuest(ruby, sid);
    const facultyId = ruby.dailyStatus(sid).facultyId;

    const roles = playDailyClass(ruby, sid);

    expect(roles.length).toBeGreaterThan(0);
    expect({ facultyId, requiresSignup: gateFor(ruby, sid)?.requiresSignup })
      .toMatchObject({ requiresSignup: true });
  });

  it("serves the signup copy as a 403 once the gate is up", async () => {
    const { ruby } = await makeServices();
    const sid = "guest-gate:violation";
    freshGuest(ruby, sid);
    const facultyId = ruby.dailyStatus(sid).facultyId;
    playDailyClass(ruby, sid);

    const violation = guestAccessViolation({
      guestAccess: gateFor(ruby, sid),
      facultyId,
    });

    expect(violation).toMatchObject({
      status: 403,
      reason: "signup-required",
      message: GUEST_SIGNUP_REQUIRED_MESSAGE,
    });
  });

  it("keeps a signed-in player ungated", async () => {
    const { ruby } = await makeServices();
    const sid = "guest-gate:member";
    freshGuest(ruby, sid);
    playDailyClass(ruby, sid);

    // Only guest sessions carry the gate at all.
    expect(gateFor(ruby, sid)?.requiresSignup).toBe(true);
    expect(guestAccessStateForSession({
      record: { provider: "passkey" } as never,
      ruby,
      sessionId: sid,
    })).toBeNull();
  });

  it("gates on whichever faculty today's rotation selected", async () => {
    const { ruby } = await makeServices();
    const sid = "guest-gate:rotation";
    freshGuest(ruby, sid);

    const scheduled = facultyForDay(dailyKey());
    const resolved = ruby.dailyStatus(sid).facultyId;
    playDailyClass(ruby, sid);
    const gate = gateFor(ruby, sid);

    // The gate must not depend on the rotation landing on homeroom: a guest
    // whose daily class is an elective still has to sign up afterwards.
    expect({ scheduled, resolved, requiresSignup: gate?.requiresSignup })
      .toMatchObject({ requiresSignup: true });
    expect(gate?.allowedFacultyIds.has(resolved)).toBe(true);
  });
});
