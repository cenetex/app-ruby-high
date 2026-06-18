import type { PendingPhotoReveal } from "../../types.js";
import type { StoredServiceStateRecord } from "../state-store.js";

export const PHOTO_POST_SCHEDULER_STATE_ID = "ruby-high:photo-post-scheduler:v1";

export interface DailyPhotoPostResult {
  photoId: string;
  sessionId: string;
  kind: PendingPhotoReveal["kind"];
  teacherFacultyId: string;
  posted: boolean;
  revealed: boolean;
  tweetId?: string;
  deferredUntil?: number;
  fallback?: boolean;
}

export interface RubyHighPhotoPostSchedulerSnapshot {
  schedulerActive: boolean;
  schedulerRunning: boolean;
  schedulerIntervalMs: number | null;
  pendingPhotos: number;
  inFlightPosts: number;
  deferredPosts: number;
  nextRetryAt: number | null;
  lastAttemptAt: number | null;
  lastResult: DailyPhotoPostResult | null;
}

export interface HydratedPhotoPostSchedulerState {
  deferredPhotoPosts: Map<string, number>;
  lastAttemptAt: number | null;
  lastResult: DailyPhotoPostResult | null;
}

export function photoPostSchedulerSnapshot(input: {
  schedulerActive: boolean;
  schedulerRunning: boolean;
  schedulerIntervalMs: number | null;
  pendingPhotos: number;
  inFlightPosts: number;
  deferredPhotoPosts: ReadonlyMap<string, number>;
  lastAttemptAt: number | null;
  lastResult: DailyPhotoPostResult | null;
}): RubyHighPhotoPostSchedulerSnapshot {
  const deferredReadyAt = Array.from(input.deferredPhotoPosts.values())
    .filter((value) => Number.isFinite(value));
  const nextRetryAt = deferredReadyAt.length > 0 ? Math.min(...deferredReadyAt) : null;
  return {
    schedulerActive: input.schedulerActive,
    schedulerRunning: input.schedulerRunning,
    schedulerIntervalMs: input.schedulerIntervalMs,
    pendingPhotos: input.pendingPhotos,
    inFlightPosts: input.inFlightPosts,
    deferredPosts: input.deferredPhotoPosts.size,
    nextRetryAt,
    lastAttemptAt: input.lastAttemptAt,
    lastResult: input.lastResult,
  };
}

export function hydratePhotoPostSchedulerState(record: StoredServiceStateRecord | null): HydratedPhotoPostSchedulerState {
  const out: HydratedPhotoPostSchedulerState = {
    deferredPhotoPosts: new Map(),
    lastAttemptAt: null,
    lastResult: null,
  };
  const data = record?.data;
  if (!data || data.version !== 1) return out;
  const deferredPosts = data.deferredPosts;
  if (deferredPosts && typeof deferredPosts === "object" && !Array.isArray(deferredPosts)) {
    for (const [photoId, retryAt] of Object.entries(deferredPosts as Record<string, unknown>)) {
      if (typeof photoId !== "string" || !photoId) continue;
      if (typeof retryAt !== "number" || !Number.isFinite(retryAt)) continue;
      out.deferredPhotoPosts.set(photoId, Math.max(0, Math.floor(retryAt)));
    }
  }
  out.lastAttemptAt = typeof data.lastAttemptAt === "number" && Number.isFinite(data.lastAttemptAt)
    ? Math.max(0, Math.floor(data.lastAttemptAt))
    : null;
  out.lastResult = normalizeDailyPhotoPostResult(data.lastResult);
  return out;
}

export function photoPostSchedulerStateRecord(input: {
  deferredPhotoPosts: ReadonlyMap<string, number>;
  lastAttemptAt: number | null;
  lastResult: DailyPhotoPostResult | null;
  now?: number;
}): StoredServiceStateRecord {
  const deferredPosts: Record<string, number> = {};
  for (const [photoId, retryAt] of input.deferredPhotoPosts) {
    if (!photoId || !Number.isFinite(retryAt)) continue;
    deferredPosts[photoId] = Math.max(0, Math.floor(retryAt));
  }
  return {
    id: PHOTO_POST_SCHEDULER_STATE_ID,
    updatedAt: input.now ?? Date.now(),
    data: {
      version: 1,
      deferredPosts,
      lastAttemptAt: input.lastAttemptAt,
      lastResult: input.lastResult,
    },
  };
}

export function normalizeDailyPhotoPostResult(value: unknown): DailyPhotoPostResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.photoId !== "string" ||
    typeof record.sessionId !== "string" ||
    typeof record.kind !== "string" ||
    !isPendingPhotoRevealKind(record.kind) ||
    typeof record.teacherFacultyId !== "string" ||
    typeof record.posted !== "boolean" ||
    typeof record.revealed !== "boolean"
  ) {
    return null;
  }
  return {
    photoId: record.photoId,
    sessionId: record.sessionId,
    kind: record.kind,
    teacherFacultyId: record.teacherFacultyId,
    posted: record.posted,
    revealed: record.revealed,
    ...(typeof record.tweetId === "string" && record.tweetId ? { tweetId: record.tweetId } : {}),
    ...(typeof record.deferredUntil === "number" && Number.isFinite(record.deferredUntil)
      ? { deferredUntil: Math.max(0, Math.floor(record.deferredUntil)) }
      : {}),
    ...(typeof record.fallback === "boolean" ? { fallback: record.fallback } : {}),
  };
}

function isPendingPhotoRevealKind(value: string): value is PendingPhotoReveal["kind"] {
  return value === "portrait" || value === "diploma" || value === "graduation" || value === "class-photo";
}
