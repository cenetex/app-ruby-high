# Ruby High Durable World State Runbook

Ruby High's MMO/public-world layer stores process-independent state through `StateStoreLike.saveServiceState`.
These records are intentionally separate from private `QuizState` sessions so public rooms, replayable events,
moderation, and world summaries can survive deploys without exposing student-private fields.

## Records

| Service state id | Version | Purpose | Rollback posture |
| --- | ---: | --- | --- |
| `ruby-high:live-room-goals:v1` | 1 | Current daily live-class goal contributors by grade/faculty/day. | Unknown versions or malformed goals hydrate as empty; current student sessions can recreate goals as answers land. |
| `ruby-high:public-world-rooms:v1` | 1 | Sanitized durable room/term snapshots: grade, faculty, active count, school year/term, and aggregate goal status. | Unknown versions or malformed rooms hydrate as empty; active public-world reads recreate records from current sessions. |
| `ruby-high:public-world-room-outcomes:v1` | 1 | Sanitized completed live-class room outcomes: grade, faculty, day, school year/term, progress, target, contributor count, room title, aggregate summary label, and Study Spark reward label. | Unknown versions or malformed outcomes hydrate as empty; legacy rows without labels hydrate with derived aggregate labels; future completions recreate outcome history. |
| `ruby-high:public-world-teacher-agendas:v1` | 1 | Sanitized teacher agenda records derived from low/exhausted curriculum coverage: grade, faculty, mode, execution status/reason/next action, priority score, target difficulty/count, subject pressure, source packet ids, and corpus id. | Unknown versions or malformed agendas hydrate as empty; legacy rows without execution metadata hydrate with derived aggregate execution rules; curriculum coverage snapshots recreate current agendas. |
| `ruby-high:public-world-events:v1` | 1 | Sanitized public replay log, independent of private session hydration. | Unknown versions hydrate as empty; new public events repopulate the log. |
| `ruby-high:public-world-moderation:v1` | 1 | Globally suppressed public event ids. | Unknown versions hydrate as empty. Before rollback, export this row if moderation actions must be preserved. |
| `ruby-high:public-world-summary:v1` | 1 | Persisted school-year public-world summary snapshot. | Derived from the replay log and refreshed by normal world writes; safe to drop during rollback. |

All public event ids must match `world:event:<16 hex chars>`. Live-room contributors store public session ids only.
Durable room records, room outcomes, and teacher agendas store aggregate state only. Outcome and agenda rows must not
store contributor names, answers, raw session ids, OpenRouter keys, prompt text, or private event ids.

## Migration Checklist

1. Add new world-state fields behind a new `data.version` or with backward-compatible optional fields.
2. Keep hydration tolerant: unknown versions and malformed entries must be ignored, not thrown.
3. Keep write records sanitized and bounded before calling `saveServiceState`.
4. Add or update tests that hydrate from mixed malformed/future records and verify public APIs remain empty or sanitized.
5. Add or update restart/replay coverage for both JSON/dev `StateStore` and SQLite-backed service state when durable world rows change.
6. Run `npm test -- ruby-high-service admin-yearbook-routes` and `npm run check:full`.
7. Watch admin world health after deploy: durable room records, durable room outcomes, teacher agenda ready/queued/watching counts, live-room goals, public replay size, suppressed events, and summary counts.

## Rollback

Rollback is safe because older code ignores unknown service-state ids and the current hydrators ignore unknown versions.
If a deploy writes a bad world-state version:

1. Roll back the Fly image.
2. In admin world health, confirm public replay and live-room goal counts are sane after traffic resumes.
3. If moderation state was affected, export the `ruby-high:public-world-moderation:v1` row before deleting or rewriting it.
4. Delete only the bad service-state row if needed; never bulk-delete private session state to fix public world projection.

The public-world layer should degrade to a quiet world feed, not a failed app boot.
