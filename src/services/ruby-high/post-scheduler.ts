import type { TeacherCharacter } from "../../characters/teachers.js";
import type { StoredServiceStateRecord } from "../state-store.js";
import type { XSocialService } from "../x-social-service.js";
import {
  hasMeaningfulScheduledSchoolActivity,
  scheduledSchoolUpdateFingerprint,
  type ScheduledSchoolUpdateContext,
} from "./post-types.js";

/** The timer only checks eligibility. The durable cadence below determines
 *  whether a post is actually attempted. */
export const GENERAL_POST_SCHEDULER_INTERVAL_MS = 15 * 60 * 1000;
export const MIN_POST_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const FAILED_POST_RETRY_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const SCHEDULED_POST_SCHEDULER_STATE_ID = "ruby-high:scheduled-post-scheduler:v1";

export type ScheduledPostSkipReason =
  | "disabled"
  | "no-activity"
  | "duplicate-context"
  | "daily-cooldown"
  | "failure-cooldown"
  | "post-failed";

export interface GeneralSchedulerState {
  lastAttemptAt: number | null;
  lastPostAt: number | null;
  lastTweetId: string | null;
  lastTeacherId: string | null;
  lastContextFingerprint: string | null;
  lastWelcomedGuestKey: string | null;
  lastSkipReason: ScheduledPostSkipReason | null;
}

export interface GeneralSchedulerSnapshot extends GeneralSchedulerState {
  enabled: boolean;
  pollIntervalMs: number;
  postIntervalMs: number;
  retryIntervalMs: number;
}

export interface ScheduledPostResult {
  tweetId: string;
  teacherId: string;
  contextFingerprint: string;
}

export interface ScheduledPostTickOptions {
  /** Operator-triggered posts bypass cadence and duplicate checks, but still
   * require meaningful school activity and use the normal generation path. */
  force?: boolean;
}

export function scheduledPostsEnabled(): boolean {
  return process.env.RUBY_HIGH_X_SCHEDULED_POSTS_ENABLED === "1";
}

export function defaultSchedulerState(): GeneralSchedulerState {
  return {
    lastAttemptAt: null,
    lastPostAt: null,
    lastTweetId: null,
    lastTeacherId: null,
    lastContextFingerprint: null,
    lastWelcomedGuestKey: null,
    lastSkipReason: null,
  };
}

export function hydrateScheduledPostSchedulerState(
  record: StoredServiceStateRecord | null,
): GeneralSchedulerState {
  const state = defaultSchedulerState();
  const data = record?.data;
  if (!data || data.version !== 1) return state;
  state.lastAttemptAt = finiteTimestamp(data.lastAttemptAt);
  state.lastPostAt = finiteTimestamp(data.lastPostAt);
  state.lastTweetId = storedText(data.lastTweetId, 128);
  state.lastTeacherId = storedText(data.lastTeacherId, 128);
  state.lastContextFingerprint = storedText(data.lastContextFingerprint, 128);
  state.lastWelcomedGuestKey = storedText(data.lastWelcomedGuestKey, 256);
  state.lastSkipReason = isSkipReason(data.lastSkipReason) ? data.lastSkipReason : null;
  return state;
}

export function scheduledPostSchedulerStateRecord(
  state: GeneralSchedulerState,
  now = Date.now(),
): StoredServiceStateRecord {
  return {
    id: SCHEDULED_POST_SCHEDULER_STATE_ID,
    updatedAt: now,
    data: {
      version: 1,
      lastAttemptAt: state.lastAttemptAt,
      lastPostAt: state.lastPostAt,
      lastTweetId: state.lastTweetId,
      lastTeacherId: state.lastTeacherId,
      lastContextFingerprint: state.lastContextFingerprint,
      lastWelcomedGuestKey: state.lastWelcomedGuestKey,
      lastSkipReason: state.lastSkipReason,
    },
  };
}

export class PostRotationScheduler {
  private state: GeneralSchedulerState;
  private readonly enabled: boolean;

  constructor(options: { state?: GeneralSchedulerState; enabled?: boolean } = {}) {
    this.state = options.state ? { ...options.state } : defaultSchedulerState();
    this.enabled = options.enabled ?? scheduledPostsEnabled();
  }

  canPostNow(context: ScheduledSchoolUpdateContext, now = Date.now()): boolean {
    if (!this.enabled) return this.skip("disabled");
    if (!this.hasPostOpportunity(context)) return this.skip("no-activity");
    const fingerprint = scheduledSchoolUpdateFingerprint(context);
    if (fingerprint === this.state.lastContextFingerprint) return this.skip("duplicate-context");
    if (this.state.lastPostAt && now - this.state.lastPostAt < MIN_POST_INTERVAL_MS) {
      return this.skip("daily-cooldown");
    }
    if (this.state.lastAttemptAt && now - this.state.lastAttemptAt < FAILED_POST_RETRY_INTERVAL_MS) {
      return this.skip("failure-cooldown");
    }
    return true;
  }

  async tick(
    xSocial: XSocialService,
    teacher: TeacherCharacter,
    context: ScheduledSchoolUpdateContext,
    now = Date.now(),
    options: ScheduledPostTickOptions = {},
  ): Promise<ScheduledPostResult | null> {
    if (options.force) {
      if (!this.hasPostOpportunity(context)) {
        this.skip("no-activity");
        return null;
      }
    } else if (!this.canPostNow(context, now)) {
      return null;
    }
    const contextFingerprint = scheduledSchoolUpdateFingerprint(context);
    this.state.lastAttemptAt = now;
    this.state.lastSkipReason = null;

    const guest = context.featuredGuest;
    const editorialMode = guest && guest.weekKey !== this.state.lastWelcomedGuestKey
      ? "guest-welcome" as const
      : guest?.xHandle
        ? "guest-insights" as const
        : "school-update" as const;
    const result = guest
      ? await xSocial.postScheduledSchoolUpdateWithFallback(
          teacher,
          context,
          { editorialMode },
        )
      : await xSocial.postScheduledSchoolUpdateWithFallback(teacher, context);
    if (!result) {
      this.state.lastSkipReason = "post-failed";
      return null;
    }

    this.state.lastPostAt = now;
    this.state.lastTweetId = result.tweetId;
    this.state.lastTeacherId = result.teacherId;
    this.state.lastContextFingerprint = contextFingerprint;
    if (editorialMode === "guest-welcome" && guest) {
      this.state.lastWelcomedGuestKey = guest.weekKey;
    }
    return { ...result, contextFingerprint };
  }

  getSnapshot(): GeneralSchedulerSnapshot {
    return {
      ...this.state,
      enabled: this.enabled,
      pollIntervalMs: GENERAL_POST_SCHEDULER_INTERVAL_MS,
      postIntervalMs: MIN_POST_INTERVAL_MS,
      retryIntervalMs: FAILED_POST_RETRY_INTERVAL_MS,
    };
  }

  getState(): GeneralSchedulerState {
    return { ...this.state };
  }

  private skip(reason: ScheduledPostSkipReason): false {
    this.state.lastSkipReason = reason;
    return false;
  }

  private hasPostOpportunity(context: ScheduledSchoolUpdateContext): boolean {
    if (hasMeaningfulScheduledSchoolActivity(context)) return true;
    const guest = context.featuredGuest;
    if (!guest) return false;
    if (guest.weekKey !== this.state.lastWelcomedGuestKey) return true;
    return Boolean(guest.xHandle);
  }
}

function finiteTimestamp(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null;
}

function storedText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text.slice(0, maxLength) : null;
}

function isSkipReason(value: unknown): value is ScheduledPostSkipReason {
  return value === "disabled" ||
    value === "no-activity" ||
    value === "duplicate-context" ||
    value === "daily-cooldown" ||
    value === "failure-cooldown" ||
    value === "post-failed";
}
