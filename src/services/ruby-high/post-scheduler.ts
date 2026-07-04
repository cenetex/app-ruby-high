import type { TeacherCharacter } from "../../characters/teachers.js";
import type { XSocialService } from "../x-social-service.js";
import { log } from "../logger.js";
import {
  weightedPickPostKind,
  generateQuestionPostText,
  generateEngagementPostText,
  DEFAULT_POST_TYPE_WEIGHTS,
  type PostKind,
  type PostTypeWeight,
} from "./post-types.js";

export const GENERAL_POST_SCHEDULER_INTERVAL_MS = 5 * 60 * 1000;
export const MIN_POST_INTERVAL_MS = 10 * 60 * 1000;

export interface GeneralSchedulerState {
  lastPostKind: PostKind | null;
  lastPostAt: number | null;
  lastReflectionAt: number | null;
  lastQuestionAt: number | null;
  lastEngagementAt: number | null;
  cooldowns: Record<PostKind, number>;
}

export function defaultSchedulerState(): GeneralSchedulerState {
  return {
    lastPostKind: null,
    lastPostAt: null,
    lastReflectionAt: null,
    lastQuestionAt: null,
    lastEngagementAt: null,
    cooldowns: {} as Record<PostKind, number>,
  };
}

export class PostRotationScheduler {
  private state: GeneralSchedulerState;
  private weights: PostTypeWeight[];

  constructor(weights?: PostTypeWeight[]) {
    this.state = defaultSchedulerState();
    this.weights = weights ?? DEFAULT_POST_TYPE_WEIGHTS;
  }

  canPostNow(kind: PostKind, now = Date.now()): boolean {
    if (this.state.lastPostAt && now - this.state.lastPostAt < MIN_POST_INTERVAL_MS) {
      return false;
    }
    const cooldownMs = this.cooldownMs(kind);
    const lastAt = this.lastKindAt(kind);
    if (lastAt && now - lastAt < cooldownMs) {
      return false;
    }
    return true;
  }

  pickNextKind(now = Date.now()): PostKind | null {
    return weightedPickPostKind(this.weights, (kind) => this.canPostNow(kind, now));
  }

  recordPost(kind: PostKind, now = Date.now()): void {
    this.state.lastPostKind = kind;
    this.state.lastPostAt = now;
    switch (kind) {
      case "reflection":
        this.state.lastReflectionAt = now;
        break;
      case "question":
        this.state.lastQuestionAt = now;
        break;
      case "engagement":
        this.state.lastEngagementAt = now;
        break;
    }
  }

  async tick(
    xSocial: XSocialService,
    getConnectedTeacher: () => TeacherCharacter | null,
    getRecentNames: () => string[],
  ): Promise<{ tweetId: string; kind: PostKind } | null> {
    const now = Date.now();
    const kind = this.pickNextKind(now);
    if (!kind) return null;

    const teacher = getConnectedTeacher();
    if (!teacher) return null;

    let text: string | null = null;
    switch (kind) {
      case "reflection":
      case "engagement":
        text = await generateEngagementPostText(teacher, getRecentNames());
        break;
      case "question":
        text = await generateQuestionPostText(teacher);
        break;
      default:
        return null;
    }

    if (!text) return null;

    // Use the teacher's default image for rotation posts.
    const imageUrl = teacherImageUrl(teacher.id) ?? undefined;
    const ctx = {
      kind: "portrait-set" as const,
      characterName: teacher.displayName,
      imageUrl,
      reserveDailyPhotoSlot: false,
    };

    const result = await xSocial.maybePostMilestoneWithFallback(teacher, ctx);
    if (result) {
      this.recordPost(kind, now);
      return { tweetId: result.tweetId, kind };
    }
    return null;
  }

  getSnapshot(): GeneralSchedulerState {
    return { ...this.state, cooldowns: { ...this.state.cooldowns } };
  }

  private cooldownMs(kind: PostKind): number {
    if (kind === "milestone") return this.state.cooldowns.milestone ?? 600_000;
    const weight = this.weights.find((w) => w.kind === kind);
    return weight?.cooldownSec ? weight.cooldownSec * 1000 : 600_000;
  }

  private lastKindAt(kind: PostKind): number | null {
    switch (kind) {
      case "reflection": return this.state.lastReflectionAt;
      case "question": return this.state.lastQuestionAt;
      case "engagement": return this.state.lastEngagementAt;
      case "milestone": return null;
      default: return null;
    }
  }
}

function teacherImageUrl(teacherId: string): string | null {
  if (teacherId === "ruby" || teacherId === "sally-science" || teacherId === "professor-edward") {
    return `/api/apps/ruby-high/assets/teachers/${teacherId}-full.png`;
  }
  return null;
}
