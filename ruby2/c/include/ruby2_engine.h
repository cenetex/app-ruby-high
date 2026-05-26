#ifndef RUBY2_ENGINE_H
#define RUBY2_ENGINE_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define RUBY2_MAX_ITEMS 12
#define RUBY2_MAX_YEARBOOK_CANDIDATES 32
#define RUBY2_MAX_YEARBOOK_ENTRIES 25
#define RUBY2_MAX_GATE_OPS 16
#define RUBY2_MAX_GATE_STACK 8
#define RUBY2_MAX_NULL_ACTIONS 4
#define RUBY2_CHARACTER_NONE 255u
#define RUBY2_MIN_YEARBOOK_CANDIDATE_SCORE 4
#define RUBY2_MIN_YEARBOOK_SEAL_SCORE 7
#define RUBY2_REPUTATION_TAG_NONE UINT16_MAX

typedef enum {
  RUBY2_VIRTUE_HEAD,
  RUBY2_VIRTUE_HEART,
  RUBY2_VIRTUE_HUSTLE,
  RUBY2_VIRTUE_HONOR,
  RUBY2_VIRTUE_COUNT
} Ruby2Virtue;

typedef enum {
  RUBY2_DISCIPLINE_SOURCE,
  RUBY2_DISCIPLINE_SENSE,
  RUBY2_DISCIPLINE_SYNC,
  RUBY2_DISCIPLINE_SIGNAL,
  RUBY2_DISCIPLINE_COUNT
} Ruby2Discipline;

typedef enum {
  RUBY2_CLOCK_BELL,
  RUBY2_CLOCK_STRESS,
  RUBY2_CLOCK_RUMOR,
  RUBY2_CLOCK_NULL_SIGNAL,
  RUBY2_CLOCK_COUNT
} Ruby2Clock;

typedef enum {
  RUBY2_ITEM_NOTEBOOK,
  RUBY2_ITEM_FLASHCARDS,
  RUBY2_ITEM_OFFICE_PASS,
  RUBY2_ITEM_LIBRARY_CARD,
  RUBY2_ITEM_LAB_FLASK,
  RUBY2_ITEM_LUNCH_TRAY,
  RUBY2_ITEM_COUNT
} Ruby2ItemId;

typedef enum {
  RUBY2_ROOM_HALLWAY,
  RUBY2_ROOM_HOMEROOM,
  RUBY2_ROOM_SCIENCE_LAB,
  RUBY2_ROOM_LIBRARY,
  RUBY2_ROOM_CAFETERIA,
  RUBY2_ROOM_GREENHOUSE,
  RUBY2_ROOM_COURTYARD,
  RUBY2_ROOM_TEACHER_OFFICE,
  RUBY2_ROOM_COUNT
} Ruby2RoomId;

typedef enum {
  RUBY2_TIME_ARRIVAL,
  RUBY2_TIME_PERIOD_1,
  RUBY2_TIME_PASSING,
  RUBY2_TIME_LUNCH,
  RUBY2_TIME_PERIOD_2,
  RUBY2_TIME_AFTER_SCHOOL,
  RUBY2_TIME_COUNT
} Ruby2TimeBlock;

typedef enum {
  RUBY2_CHARACTER_RUBY,
  RUBY2_CHARACTER_LYRA,
  RUBY2_CHARACTER_MIKA,
  RUBY2_CHARACTER_RAVI,
  RUBY2_CHARACTER_INDRA,
  RUBY2_CHARACTER_NOOR,
  RUBY2_CHARACTER_SAMI,
  RUBY2_CHARACTER_SALLY_SCIENCE,
  RUBY2_CHARACTER_PROFESSOR_EDWARD,
  RUBY2_CHARACTER_COUNT
} Ruby2CharacterId;

typedef enum {
  RUBY2_ARCHETYPE_SCHOLAR,
  RUBY2_ARCHETYPE_CONNECTOR,
  RUBY2_ARCHETYPE_OPERATOR,
  RUBY2_ARCHETYPE_CONSCIENCE,
  RUBY2_ARCHETYPE_SIGNAL_READER,
  RUBY2_ARCHETYPE_COMEBACK_STUDENT,
  RUBY2_ARCHETYPE_WILD_CARD,
  RUBY2_ARCHETYPE_COUNT
} Ruby2Archetype;

typedef enum {
  RUBY2_CANDIDATE_EMPTY,
  RUBY2_CANDIDATE_CANDIDATE,
  RUBY2_CANDIDATE_HIGHLIGHTED,
  RUBY2_CANDIDATE_PINNED,
  RUBY2_CANDIDATE_SEALED,
  RUBY2_CANDIDATE_ARCHIVED,
  RUBY2_CANDIDATE_EXPIRED
} Ruby2CandidateStatus;

typedef enum {
  RUBY2_VAR_CURRENT_ROOM,
  RUBY2_VAR_TIME_BLOCK,
  RUBY2_VAR_ACTIVE_COMPANION,
  RUBY2_VAR_BELL,
  RUBY2_VAR_STRESS,
  RUBY2_VAR_RUMOR,
  RUBY2_VAR_NULL_SIGNAL,
  RUBY2_VAR_DISC_SOURCE,
  RUBY2_VAR_DISC_SENSE,
  RUBY2_VAR_DISC_SYNC,
  RUBY2_VAR_DISC_SIGNAL,
  RUBY2_VAR_VIRT_HEAD,
  RUBY2_VAR_VIRT_HEART,
  RUBY2_VAR_VIRT_HUSTLE,
  RUBY2_VAR_VIRT_HONOR,
  RUBY2_VAR_AFF_RUBY,
  RUBY2_VAR_AFF_LYRA,
  RUBY2_VAR_AFF_MIKA,
  RUBY2_VAR_AFF_RAVI,
  RUBY2_VAR_AFF_INDRA,
  RUBY2_VAR_AFF_NOOR,
  RUBY2_VAR_AFF_SAMI,
  RUBY2_VAR_ARCHETYPE_SCHOLAR,
  RUBY2_VAR_ARCHETYPE_CONNECTOR,
  RUBY2_VAR_ARCHETYPE_OPERATOR,
  RUBY2_VAR_ARCHETYPE_CONSCIENCE,
  RUBY2_VAR_ARCHETYPE_SIGNAL_READER,
  RUBY2_VAR_ARCHETYPE_COMEBACK_STUDENT,
  RUBY2_VAR_ARCHETYPE_WILD_CARD,
  RUBY2_VAR_COUNT
} Ruby2StateVar;

typedef enum {
  RUBY2_FLAG_ROOM_UNLOCKED,
  RUBY2_FLAG_ITEM_CARRIED,
  RUBY2_FLAG_REPUTATION,
  RUBY2_FLAG_COMPANION_PRESENT
} Ruby2StateFlagKind;

typedef enum {
  RUBY2_GATE_TRUE,
  RUBY2_GATE_VAR_GTE,
  RUBY2_GATE_VAR_EQ,
  RUBY2_GATE_FLAG_SET,
  RUBY2_GATE_AND,
  RUBY2_GATE_OR,
  RUBY2_GATE_NOT
} Ruby2GateType;

typedef enum {
  RUBY2_NULL_CLEAR,
  RUBY2_NULL_MIXED,
  RUBY2_NULL_FAILED_FORWARD,
  RUBY2_NULL_RESTRAINT
} Ruby2NullOutcome;

typedef enum {
  RUBY2_ITEM_USE_REJECTED,
  RUBY2_ITEM_USE_ACCEPTED
} Ruby2ItemUseResult;

typedef enum {
  RUBY2_MILESTONE_NONE,
  RUBY2_MILESTONE_CLASS_REPORT,
  RUBY2_MILESTONE_SOCIAL_CLIMAX,
  RUBY2_MILESTONE_NULL_RESOLUTION,
  RUBY2_MILESTONE_WEEKLY_RITUAL
} Ruby2MilestoneKind;

typedef enum {
  RUBY2_NULL_ACTION_SOURCE,
  RUBY2_NULL_ACTION_SENSE,
  RUBY2_NULL_ACTION_SYNC,
  RUBY2_NULL_ACTION_SIGNAL,
  RUBY2_NULL_ACTION_COUNT
} Ruby2NullAction;

typedef struct {
  Ruby2GateType type;
  uint16_t arg1;
  uint16_t arg2;
} Ruby2GateOp;

typedef struct {
  Ruby2GateOp ops[RUBY2_MAX_GATE_OPS];
  uint8_t count;
} Ruby2CompiledGate;

typedef struct {
  int8_t clock_deltas[RUBY2_CLOCK_COUNT];
  int8_t virtue_deltas[RUBY2_VIRTUE_COUNT];
  int8_t discipline_deltas[RUBY2_DISCIPLINE_COUNT];
  int8_t affinity_deltas[RUBY2_CHARACTER_COUNT];
  int8_t item_deltas[RUBY2_ITEM_COUNT];
  bool create_yearbook_candidate;
  Ruby2MilestoneKind milestone_kind;
  uint16_t candidate_id;
  int16_t candidate_score;
  uint16_t reputation_tag;
} Ruby2EffectPayload;

typedef struct {
  uint16_t id;
  uint16_t source_beat_id;
  int16_t score;
  int8_t mechanical;
  int8_t social;
  int8_t identity;
  int8_t callback;
  int8_t rarity;
  int8_t repetition_penalty;
  Ruby2CandidateStatus status;
} Ruby2YearbookCandidate;

typedef struct {
  int8_t value;
  int8_t max;
} Ruby2ClockState;

typedef struct {
  bool owned;
  bool carried;
  int8_t charges;
} Ruby2ItemState;

typedef struct {
  uint32_t scene_version;
  uint32_t event_cursor;
  uint16_t current_beat_id;
  Ruby2RoomId current_room_id;
  Ruby2TimeBlock current_time_block;
  Ruby2ClockState clocks[RUBY2_CLOCK_COUNT];
  Ruby2ItemState items[RUBY2_ITEM_COUNT];
  uint8_t affinity[RUBY2_CHARACTER_COUNT];
  uint32_t virtue_counts[RUBY2_VIRTUE_COUNT];
  uint32_t discipline_counts[RUBY2_DISCIPLINE_COUNT];
  uint8_t archetype_points[RUBY2_ARCHETYPE_COUNT];
  uint16_t variables[RUBY2_VAR_COUNT];
  Ruby2Archetype dominant_archetype;
  Ruby2Archetype secondary_archetype;
  Ruby2YearbookCandidate yearbook_candidates[RUBY2_MAX_YEARBOOK_CANDIDATES];
  uint8_t yearbook_candidate_count;
  uint8_t active_companion_id;
  bool office_pass_tutorial_complete;
  bool failed_forward_recently;
  bool room_unlocked[RUBY2_ROOM_COUNT];
} Ruby2State;

typedef struct {
  int8_t signal_stability;
  int8_t null_pressure;
  int8_t invalid_action_count;
  Ruby2NullAction actions[RUBY2_MAX_NULL_ACTIONS];
  uint8_t action_count;
} Ruby2NullTrace;

void ruby2_state_init(Ruby2State* state);
void ruby2_sync_state_variables(Ruby2State* state);
void ruby2_effect_payload_init(Ruby2EffectPayload* payload);
void ruby2_apply_effect_payload(Ruby2State* state, const Ruby2EffectPayload* payload);
bool ruby2_eval_gate(const Ruby2State* state, const Ruby2CompiledGate* gate);
bool ruby2_insert_yearbook_candidate(Ruby2State* state, Ruby2YearbookCandidate candidate);
void ruby2_archive_unsealed_candidates(Ruby2State* state);
Ruby2Archetype ruby2_resolve_archetypes(Ruby2State* state);
Ruby2ItemUseResult ruby2_use_item(Ruby2State* state, Ruby2ItemId item_id);
bool ruby2_set_active_companion(Ruby2State* state, Ruby2CharacterId character_id);
void ruby2_clear_active_companion(Ruby2State* state);
bool ruby2_is_active_companion(const Ruby2State* state, Ruby2CharacterId character_id);
void ruby2_null_trace_add_action(Ruby2NullTrace* trace, Ruby2NullAction action);
Ruby2NullOutcome ruby2_resolve_first_null_signal(Ruby2State* state, const Ruby2NullTrace* trace);
void ruby2_run_week_one_sample(Ruby2State* state);

const char* ruby2_virtue_name(Ruby2Virtue virtue);
const char* ruby2_discipline_name(Ruby2Discipline discipline);
const char* ruby2_clock_name(Ruby2Clock clock);
const char* ruby2_item_name(Ruby2ItemId item_id);
const char* ruby2_room_name(Ruby2RoomId room_id);
const char* ruby2_archetype_name(Ruby2Archetype archetype);
const char* ruby2_null_outcome_name(Ruby2NullOutcome outcome);
const char* ruby2_candidate_title(uint16_t candidate_id);
const char* ruby2_candidate_blurb(uint16_t candidate_id);
const char* ruby2_candidate_signer(uint16_t candidate_id);
const char* ruby2_candidate_tomorrow_hook(uint16_t candidate_id);

#endif
