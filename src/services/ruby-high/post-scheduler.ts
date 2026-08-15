import type { TeacherCharacter } from "../../characters/teachers.js";
import type { StoredServiceStateRecord } from "../state-store.js";
import type { XSocialService } from "../x-social-service.js";
import {
  scheduledSchoolUpdateFingerprint,
  type ScheduledSchoolUpdateContext,
} from "./post-types.js";
import {
  MAX_RECENT_PLANNED_POSTS,
  duePlannedTweetSlot,
  shouldRefreshScheduledTweetPlan,
  type PlannedTweetCallToAction,
  type PlannedTweetPillar,
  type PlannedTweetSlot,
  type RecentPlannedPost,
  type ScheduledTweetPlan,
} from "./tweet-planner.js";

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
  | "plan-failed"
  | "no-due-plan"
  | "post-failed";

export interface GeneralSchedulerState {
  lastAttemptAt: number | null;
  lastPlanAttemptAt: number | null;
  lastPlanAttemptKey: string | null;
  lastPostAt: number | null;
  lastTweetId: string | null;
  lastTeacherId: string | null;
  lastContextFingerprint: string | null;
  tweetPlan: ScheduledTweetPlan | null;
  recentPosts: RecentPlannedPost[];
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
  planId: string;
  planSlotId: string;
  pillar: PlannedTweetPillar;
}

export interface ScheduledPostTickOptions {
  /** Operator-triggered posts bypass cadence and duplicate checks, but still
   * consume an unpublished slot from the AI-authored plan. */
  force?: boolean;
}

export function scheduledPostsEnabled(): boolean {
  return process.env.RUBY_HIGH_X_SCHEDULED_POSTS_ENABLED === "1";
}

export function defaultSchedulerState(): GeneralSchedulerState {
  return {
    lastAttemptAt: null,
    lastPlanAttemptAt: null,
    lastPlanAttemptKey: null,
    lastPostAt: null,
    lastTweetId: null,
    lastTeacherId: null,
    lastContextFingerprint: null,
    tweetPlan: null,
    recentPosts: [],
    lastSkipReason: null,
  };
}

export function hydrateScheduledPostSchedulerState(
  record: StoredServiceStateRecord | null,
): GeneralSchedulerState {
  const state = defaultSchedulerState();
  const data = record?.data;
  if (!data || (data.version !== 1 && data.version !== 2)) return state;
  state.lastAttemptAt = finiteTimestamp(data.lastAttemptAt);
  state.lastPlanAttemptAt = finiteTimestamp(data.lastPlanAttemptAt);
  state.lastPlanAttemptKey = storedText(data.lastPlanAttemptKey, 256);
  state.lastPostAt = finiteTimestamp(data.lastPostAt);
  state.lastTweetId = storedText(data.lastTweetId, 128);
  state.lastTeacherId = storedText(data.lastTeacherId, 128);
  state.lastContextFingerprint = storedText(data.lastContextFingerprint, 128);
  if (data.version === 2) {
    state.tweetPlan = normalizeStoredTweetPlan(data.tweetPlan);
    state.recentPosts = normalizeStoredRecentPosts(data.recentPosts);
  }
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
      version: 2,
      lastAttemptAt: state.lastAttemptAt,
      lastPlanAttemptAt: state.lastPlanAttemptAt,
      lastPlanAttemptKey: state.lastPlanAttemptKey,
      lastPostAt: state.lastPostAt,
      lastTweetId: state.lastTweetId,
      lastTeacherId: state.lastTeacherId,
      lastContextFingerprint: state.lastContextFingerprint,
      tweetPlan: state.tweetPlan,
      recentPosts: state.recentPosts.slice(-MAX_RECENT_PLANNED_POSTS),
      lastSkipReason: state.lastSkipReason,
    },
  };
}

/** Durable scheduler for an AI-authored rolling editorial calendar. The
 * compatibility alias below keeps older imports working across deployments. */
export class TweetPlanningScheduler {
  private state: GeneralSchedulerState;
  private readonly enabled: boolean;

  constructor(options: { state?: GeneralSchedulerState; enabled?: boolean } = {}) {
    this.state = options.state ? { ...options.state } : defaultSchedulerState();
    this.enabled = options.enabled ?? scheduledPostsEnabled();
  }

  canPostNow(context: ScheduledSchoolUpdateContext, now = Date.now()): boolean {
    if (!this.enabled) return this.skip("disabled");
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
    if (!this.enabled) {
      this.skip("disabled");
      return null;
    }
    const planNeedsRefresh = shouldRefreshScheduledTweetPlan(this.state.tweetPlan, teacher.id, context);
    if (planNeedsRefresh) {
      const planAttemptKey = `${teacher.id}:${context.date}:${context.featuredGuest?.weekKey ?? "no-guest"}`;
      if (
        !options.force &&
        this.state.lastPlanAttemptAt &&
        this.state.lastPlanAttemptKey === planAttemptKey &&
        now - this.state.lastPlanAttemptAt < FAILED_POST_RETRY_INTERVAL_MS
      ) {
        this.state.lastSkipReason = "failure-cooldown";
        return null;
      }
      this.state.lastPlanAttemptAt = now;
      this.state.lastPlanAttemptKey = planAttemptKey;
      const plan = await xSocial.planScheduledSchoolUpdates(
        teacher,
        context,
        this.state.recentPosts.map((post) => ({ ...post })),
        now,
      );
      if (!plan) {
        this.state.lastSkipReason = "plan-failed";
        return null;
      }
      this.state.tweetPlan = plan;
    }
    if (!options.force && !this.canPostNow(context, now)) {
      return null;
    }
    const contextFingerprint = scheduledSchoolUpdateFingerprint(context);
    this.state.lastAttemptAt = now;
    this.state.lastSkipReason = null;
    const plan = this.state.tweetPlan;
    if (!plan) {
      this.state.lastSkipReason = "plan-failed";
      return null;
    }
    const slot = duePlannedTweetSlot(plan, context.date, options.force);
    if (!slot) {
      this.state.lastSkipReason = "no-due-plan";
      return null;
    }
    const editorialMode = slot.pillar === "guest-spotlight"
      ? "guest-insights" as const
      : "school-update" as const;
    const result = await xSocial.postScheduledSchoolUpdateWithFallback(
      teacher,
      context,
      {
        editorialMode,
        plannedSlot: { ...slot },
        recentPosts: this.state.recentPosts.map((post) => ({ ...post })),
      },
    );
    if (!result) {
      this.state.lastSkipReason = "post-failed";
      return null;
    }

    this.state.lastPostAt = now;
    this.state.lastTweetId = result.tweetId;
    this.state.lastTeacherId = result.teacherId;
    this.state.lastContextFingerprint = contextFingerprint;
    slot.publishedAt = now;
    slot.tweetId = result.tweetId;
    slot.publishedText = result.text;
    this.state.recentPosts.push({
      publishDate: context.date,
      pillar: slot.pillar,
      angle: slot.angle,
      text: result.text,
    });
    this.state.recentPosts = this.state.recentPosts.slice(-MAX_RECENT_PLANNED_POSTS);
    return {
      tweetId: result.tweetId,
      teacherId: result.teacherId,
      contextFingerprint,
      planId: plan.id,
      planSlotId: slot.id,
      pillar: slot.pillar,
    };
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
}

export { TweetPlanningScheduler as PostRotationScheduler };

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
    value === "plan-failed" ||
    value === "no-due-plan" ||
    value === "post-failed";
}

function normalizeStoredTweetPlan(value: unknown): ScheduledTweetPlan | null {
  if (!value || typeof value !== "object") return null;
  const plan = value as Record<string, unknown>;
  const id = storedText(plan.id, 128);
  const teacherId = storedText(plan.teacherId, 128);
  const startsOn = storedDate(plan.startsOn);
  const endsOn = storedDate(plan.endsOn);
  const createdAt = finiteTimestamp(plan.createdAt);
  if (!id || !teacherId || !startsOn || !endsOn || createdAt == null || !Array.isArray(plan.slots)) return null;
  const slots = plan.slots.flatMap(normalizeStoredTweetSlot);
  if (slots.length === 0) return null;
  return {
    id,
    teacherId,
    createdAt,
    startsOn,
    endsOn,
    guestWeekKey: storedText(plan.guestWeekKey, 256),
    slots,
  };
}

function normalizeStoredTweetSlot(value: unknown): PlannedTweetSlot[] {
  if (!value || typeof value !== "object") return [];
  const slot = value as Record<string, unknown>;
  const id = storedText(slot.id, 128);
  const publishDate = storedDate(slot.publishDate);
  const pillar = storedPillar(slot.pillar);
  const angle = storedText(slot.angle, 180);
  const brief = storedText(slot.brief, 320);
  const callToAction = storedCallToAction(slot.callToAction);
  if (!id || !publishDate || !pillar || !angle || !brief || !callToAction) return [];
  const publishedAt = finiteTimestamp(slot.publishedAt);
  const tweetId = storedText(slot.tweetId, 128);
  const publishedText = storedText(slot.publishedText, 280);
  return [{
    id,
    publishDate,
    pillar,
    angle,
    brief,
    callToAction,
    ...(storedText(slot.guestWeekKey, 256) ? { guestWeekKey: storedText(slot.guestWeekKey, 256)! } : {}),
    ...(publishedAt != null ? { publishedAt } : {}),
    ...(tweetId ? { tweetId } : {}),
    ...(publishedText ? { publishedText } : {}),
  }];
}

function normalizeStoredRecentPosts(value: unknown): RecentPlannedPost[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const post = item as Record<string, unknown>;
    const publishDate = storedDate(post.publishDate);
    const pillar = storedPillar(post.pillar);
    const angle = storedText(post.angle, 180);
    const text = storedText(post.text, 280);
    return publishDate && pillar && angle && text
      ? [{ publishDate, pillar, angle, text }]
      : [];
  }).slice(-MAX_RECENT_PLANNED_POSTS);
}

function storedDate(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function storedPillar(value: unknown): PlannedTweetPillar | null {
  return value === "school-pulse" ||
    value === "guest-spotlight" ||
    value === "teacher-take" ||
    value === "student-question" ||
    value === "progress-story"
    ? value
    : null;
}

function storedCallToAction(value: unknown): PlannedTweetCallToAction | null {
  return value === "take-class" || value === "reply" || value === "none" ? value : null;
}
