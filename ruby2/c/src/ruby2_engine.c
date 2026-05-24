#include "ruby2_engine.h"

#include <limits.h>
#include <string.h>

static int8_t ruby2_clamp_i8(int8_t value, int8_t min, int8_t max) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

static uint8_t ruby2_clamp_u8_i16(int16_t value, uint8_t min, uint8_t max) {
  if (value < (int16_t)min) return min;
  if (value > (int16_t)max) return max;
  return (uint8_t)value;
}

static uint16_t ruby2_clamp_u16_u32(uint32_t value) {
  return value > UINT16_MAX ? UINT16_MAX : (uint16_t)value;
}

static uint16_t ruby2_clamp_u16_i16(int16_t value) {
  if (value < 0) return 0;
  return (uint16_t)value;
}

static Ruby2StateVar ruby2_clock_var(Ruby2Clock clock) {
  return (Ruby2StateVar)(RUBY2_VAR_BELL + clock);
}

static Ruby2StateVar ruby2_discipline_var(Ruby2Discipline discipline) {
  return (Ruby2StateVar)(RUBY2_VAR_DISC_SOURCE + discipline);
}

static Ruby2StateVar ruby2_virtue_var(Ruby2Virtue virtue) {
  return (Ruby2StateVar)(RUBY2_VAR_VIRT_HEAD + virtue);
}

static Ruby2StateVar ruby2_affinity_var(Ruby2CharacterId character_id) {
  return (Ruby2StateVar)(RUBY2_VAR_AFF_RUBY + character_id);
}

static Ruby2StateVar ruby2_archetype_var(Ruby2Archetype archetype) {
  return (Ruby2StateVar)(RUBY2_VAR_ARCHETYPE_SCHOLAR + archetype);
}

static bool ruby2_candidate_is_active(const Ruby2YearbookCandidate* candidate) {
  return candidate->status == RUBY2_CANDIDATE_CANDIDATE ||
         candidate->status == RUBY2_CANDIDATE_HIGHLIGHTED ||
         candidate->status == RUBY2_CANDIDATE_PINNED;
}

static bool ruby2_candidate_can_evict(const Ruby2YearbookCandidate* candidate) {
  return candidate->status != RUBY2_CANDIDATE_SEALED &&
         candidate->status != RUBY2_CANDIDATE_PINNED;
}

void ruby2_sync_state_variables(Ruby2State* state) {
  if (!state) return;

  memset(state->variables, 0, sizeof(state->variables));
  state->variables[RUBY2_VAR_CURRENT_ROOM] = (uint16_t)state->current_room_id;
  state->variables[RUBY2_VAR_TIME_BLOCK] = (uint16_t)state->current_time_block;
  state->variables[RUBY2_VAR_ACTIVE_COMPANION] = state->active_companion_id;

  for (uint8_t i = 0; i < RUBY2_CLOCK_COUNT; ++i) {
    state->variables[ruby2_clock_var((Ruby2Clock)i)] =
      ruby2_clamp_u16_i16(state->clocks[i].value);
  }
  for (uint8_t i = 0; i < RUBY2_DISCIPLINE_COUNT; ++i) {
    state->variables[ruby2_discipline_var((Ruby2Discipline)i)] =
      ruby2_clamp_u16_u32(state->discipline_counts[i]);
  }
  for (uint8_t i = 0; i < RUBY2_VIRTUE_COUNT; ++i) {
    state->variables[ruby2_virtue_var((Ruby2Virtue)i)] =
      ruby2_clamp_u16_u32(state->virtue_counts[i]);
  }
  for (uint8_t i = 0; i < RUBY2_CHARACTER_COUNT; ++i) {
    state->variables[ruby2_affinity_var((Ruby2CharacterId)i)] = state->affinity[i];
  }
  for (uint8_t i = 0; i < RUBY2_ARCHETYPE_COUNT; ++i) {
    state->variables[ruby2_archetype_var((Ruby2Archetype)i)] = state->archetype_points[i];
  }
}

static bool ruby2_eval_flag(const Ruby2State* state, const Ruby2GateOp* op) {
  switch ((Ruby2StateFlagKind)op->arg1) {
    case RUBY2_FLAG_ROOM_UNLOCKED:
      return op->arg2 < RUBY2_ROOM_COUNT && state->room_unlocked[op->arg2];
    case RUBY2_FLAG_ITEM_CARRIED:
      return op->arg2 < RUBY2_ITEM_COUNT && state->items[op->arg2].owned &&
             state->items[op->arg2].carried;
    case RUBY2_FLAG_REPUTATION:
      return op->arg2 < RUBY2_ARCHETYPE_COUNT &&
             (state->dominant_archetype == (Ruby2Archetype)op->arg2 ||
              state->secondary_archetype == (Ruby2Archetype)op->arg2);
    case RUBY2_FLAG_COMPANION_PRESENT:
      return op->arg2 < RUBY2_CHARACTER_COUNT &&
             ruby2_is_active_companion(state, (Ruby2CharacterId)op->arg2);
    default:
      return false;
  }
}

static bool ruby2_eval_atomic_gate(const Ruby2State* state, const Ruby2GateOp* op) {
  switch (op->type) {
    case RUBY2_GATE_TRUE:
      return true;
    case RUBY2_GATE_VAR_GTE:
      return op->arg1 < RUBY2_VAR_COUNT && state->variables[op->arg1] >= op->arg2;
    case RUBY2_GATE_VAR_EQ:
      return op->arg1 < RUBY2_VAR_COUNT && state->variables[op->arg1] == op->arg2;
    case RUBY2_GATE_FLAG_SET:
      return ruby2_eval_flag(state, op);
    default:
      return false;
  }
}

void ruby2_state_init(Ruby2State* state) {
  memset(state, 0, sizeof(*state));
  state->current_room_id = RUBY2_ROOM_HALLWAY;
  state->current_time_block = RUBY2_TIME_ARRIVAL;
  state->dominant_archetype = RUBY2_ARCHETYPE_WILD_CARD;
  state->secondary_archetype = RUBY2_ARCHETYPE_WILD_CARD;
  state->active_companion_id = RUBY2_CHARACTER_NONE;

  state->clocks[RUBY2_CLOCK_BELL].max = 4;
  state->clocks[RUBY2_CLOCK_STRESS].max = 4;
  state->clocks[RUBY2_CLOCK_RUMOR].max = 4;
  state->clocks[RUBY2_CLOCK_NULL_SIGNAL].max = 6;

  state->room_unlocked[RUBY2_ROOM_HALLWAY] = true;
  state->room_unlocked[RUBY2_ROOM_HOMEROOM] = true;
  state->room_unlocked[RUBY2_ROOM_SCIENCE_LAB] = true;
  state->room_unlocked[RUBY2_ROOM_LIBRARY] = true;
  state->room_unlocked[RUBY2_ROOM_CAFETERIA] = true;
  state->room_unlocked[RUBY2_ROOM_GREENHOUSE] = true;
  state->room_unlocked[RUBY2_ROOM_COURTYARD] = true;
  state->room_unlocked[RUBY2_ROOM_TEACHER_OFFICE] = true;
  ruby2_sync_state_variables(state);
}

void ruby2_effect_payload_init(Ruby2EffectPayload* payload) {
  memset(payload, 0, sizeof(*payload));
  payload->reputation_tag = RUBY2_REPUTATION_TAG_NONE;
}

void ruby2_apply_effect_payload(Ruby2State* state, const Ruby2EffectPayload* payload) {
  for (uint8_t i = 0; i < RUBY2_CLOCK_COUNT; ++i) {
    int8_t next = (int8_t)(state->clocks[i].value + payload->clock_deltas[i]);
    state->clocks[i].value = ruby2_clamp_i8(next, 0, state->clocks[i].max);
  }

  for (uint8_t i = 0; i < RUBY2_VIRTUE_COUNT; ++i) {
    if (payload->virtue_deltas[i] > 0) {
      state->virtue_counts[i] += (uint32_t)payload->virtue_deltas[i];
    }
  }

  for (uint8_t i = 0; i < RUBY2_DISCIPLINE_COUNT; ++i) {
    if (payload->discipline_deltas[i] > 0) {
      state->discipline_counts[i] += (uint32_t)payload->discipline_deltas[i];
    }
  }

  for (uint8_t i = 0; i < RUBY2_CHARACTER_COUNT; ++i) {
    int16_t next = (int16_t)state->affinity[i] + payload->affinity_deltas[i];
    state->affinity[i] = ruby2_clamp_u8_i16(next, 0, 255);
  }

  for (uint8_t i = 0; i < RUBY2_ITEM_COUNT; ++i) {
    if (!state->items[i].owned || payload->item_deltas[i] == 0) continue;
    int8_t charges = state->items[i].charges;
    if (charges >= 0) {
      state->items[i].charges = ruby2_clamp_i8((int8_t)(charges + payload->item_deltas[i]), 0, 99);
    }
  }

  if (payload->reputation_tag != RUBY2_REPUTATION_TAG_NONE &&
      payload->reputation_tag < RUBY2_ARCHETYPE_COUNT) {
    state->archetype_points[payload->reputation_tag]++;
  }

  if (payload->create_yearbook_candidate && payload->milestone_kind != RUBY2_MILESTONE_NONE) {
    Ruby2YearbookCandidate candidate;
    memset(&candidate, 0, sizeof(candidate));
    candidate.id = payload->candidate_id;
    candidate.score = payload->candidate_score;
    candidate.status = RUBY2_CANDIDATE_CANDIDATE;
    ruby2_insert_yearbook_candidate(state, candidate);
  }

  state->scene_version++;
  state->event_cursor++;
  ruby2_sync_state_variables(state);
}

bool ruby2_eval_gate(const Ruby2State* state, const Ruby2CompiledGate* gate) {
  bool stack[RUBY2_MAX_GATE_STACK];
  int8_t sp = -1;

  for (uint8_t i = 0; i < gate->count; ++i) {
    const Ruby2GateOp* op = &gate->ops[i];
    switch (op->type) {
      case RUBY2_GATE_AND:
        if (sp < 1) return false;
        stack[sp - 1] = stack[sp - 1] && stack[sp];
        sp--;
        break;
      case RUBY2_GATE_OR:
        if (sp < 1) return false;
        stack[sp - 1] = stack[sp - 1] || stack[sp];
        sp--;
        break;
      case RUBY2_GATE_NOT:
        if (sp < 0) return false;
        stack[sp] = !stack[sp];
        break;
      default:
        if (sp >= RUBY2_MAX_GATE_STACK - 1) return false;
        stack[++sp] = ruby2_eval_atomic_gate(state, op);
        break;
    }
  }

  return sp == 0 ? stack[0] : false;
}

bool ruby2_insert_yearbook_candidate(Ruby2State* state, Ruby2YearbookCandidate candidate) {
  if (candidate.score < RUBY2_MIN_YEARBOOK_CANDIDATE_SCORE) {
    return false;
  }
  if (candidate.status == RUBY2_CANDIDATE_EMPTY) {
    candidate.status = RUBY2_CANDIDATE_CANDIDATE;
  }

  if (state->yearbook_candidate_count < RUBY2_MAX_YEARBOOK_CANDIDATES) {
    state->yearbook_candidates[state->yearbook_candidate_count++] = candidate;
    return true;
  }

  int16_t lowest_idx = -1;
  int16_t lowest_score = INT16_MAX;
  for (uint8_t i = 0; i < state->yearbook_candidate_count; ++i) {
    Ruby2YearbookCandidate* existing = &state->yearbook_candidates[i];
    if (!ruby2_candidate_can_evict(existing)) continue;
    if (existing->score < lowest_score) {
      lowest_score = existing->score;
      lowest_idx = (int16_t)i;
    }
  }

  if (lowest_idx >= 0 && candidate.score > lowest_score) {
    state->yearbook_candidates[lowest_idx] = candidate;
    return true;
  }
  return false;
}

void ruby2_archive_unsealed_candidates(Ruby2State* state) {
  uint8_t write_idx = 0;
  for (uint8_t read_idx = 0; read_idx < state->yearbook_candidate_count; ++read_idx) {
    Ruby2YearbookCandidate candidate = state->yearbook_candidates[read_idx];
    if (candidate.status == RUBY2_CANDIDATE_SEALED || candidate.status == RUBY2_CANDIDATE_PINNED) {
      state->yearbook_candidates[write_idx++] = candidate;
      continue;
    }
    if (ruby2_candidate_is_active(&candidate)) {
      candidate.status = RUBY2_CANDIDATE_ARCHIVED;
    }
  }
  state->yearbook_candidate_count = write_idx;
}

Ruby2Archetype ruby2_resolve_archetypes(Ruby2State* state) {
  uint16_t score[RUBY2_ARCHETYPE_COUNT] = {0};

  score[RUBY2_ARCHETYPE_SCHOLAR] =
    (uint16_t)(state->virtue_counts[RUBY2_VIRTUE_HEAD] +
               state->discipline_counts[RUBY2_DISCIPLINE_SENSE] +
               state->archetype_points[RUBY2_ARCHETYPE_SCHOLAR]);
  score[RUBY2_ARCHETYPE_CONNECTOR] =
    (uint16_t)(state->virtue_counts[RUBY2_VIRTUE_HEART] +
               state->discipline_counts[RUBY2_DISCIPLINE_SYNC] +
               state->archetype_points[RUBY2_ARCHETYPE_CONNECTOR]);
  score[RUBY2_ARCHETYPE_OPERATOR] =
    (uint16_t)(state->virtue_counts[RUBY2_VIRTUE_HUSTLE] +
               state->discipline_counts[RUBY2_DISCIPLINE_SOURCE] +
               state->archetype_points[RUBY2_ARCHETYPE_OPERATOR]);
  score[RUBY2_ARCHETYPE_CONSCIENCE] =
    (uint16_t)(state->virtue_counts[RUBY2_VIRTUE_HONOR] +
               state->discipline_counts[RUBY2_DISCIPLINE_SOURCE] +
               state->archetype_points[RUBY2_ARCHETYPE_CONSCIENCE]);
  score[RUBY2_ARCHETYPE_SIGNAL_READER] =
    (uint16_t)(state->discipline_counts[RUBY2_DISCIPLINE_SIGNAL] +
               state->clocks[RUBY2_CLOCK_NULL_SIGNAL].value +
               state->archetype_points[RUBY2_ARCHETYPE_SIGNAL_READER]);
  score[RUBY2_ARCHETYPE_COMEBACK_STUDENT] =
    state->archetype_points[RUBY2_ARCHETYPE_COMEBACK_STUDENT];
  score[RUBY2_ARCHETYPE_WILD_CARD] = 0;

  Ruby2Archetype top = RUBY2_ARCHETYPE_WILD_CARD;
  Ruby2Archetype second = RUBY2_ARCHETYPE_WILD_CARD;
  for (uint8_t i = 0; i < RUBY2_ARCHETYPE_WILD_CARD; ++i) {
    if (score[i] > score[top] || top == RUBY2_ARCHETYPE_WILD_CARD) {
      second = top;
      top = (Ruby2Archetype)i;
    } else if (score[i] > score[second] || second == RUBY2_ARCHETYPE_WILD_CARD) {
      second = (Ruby2Archetype)i;
    }
  }

  if (score[top] >= 6 && (second == RUBY2_ARCHETYPE_WILD_CARD || score[top] >= score[second] + 2)) {
    state->dominant_archetype = top;
  } else {
    state->dominant_archetype = RUBY2_ARCHETYPE_WILD_CARD;
  }

  if (state->dominant_archetype == RUBY2_ARCHETYPE_WILD_CARD &&
      score[top] >= 3 &&
      (second == RUBY2_ARCHETYPE_WILD_CARD || score[top] >= score[second] + 1)) {
    state->secondary_archetype = top;
  } else {
    state->secondary_archetype =
      (second != RUBY2_ARCHETYPE_WILD_CARD && score[second] >= 4) ? second : RUBY2_ARCHETYPE_WILD_CARD;
  }
  ruby2_sync_state_variables(state);
  return state->dominant_archetype;
}

Ruby2ItemUseResult ruby2_use_item(Ruby2State* state, Ruby2ItemId item_id) {
  if (item_id >= RUBY2_ITEM_COUNT) return RUBY2_ITEM_USE_REJECTED;
  Ruby2ItemState* item = &state->items[item_id];
  if (!item->owned || !item->carried) return RUBY2_ITEM_USE_REJECTED;
  if (item->charges == 0) return RUBY2_ITEM_USE_REJECTED;

  Ruby2EffectPayload payload;
  ruby2_effect_payload_init(&payload);

  switch (item_id) {
    case RUBY2_ITEM_NOTEBOOK:
      return RUBY2_ITEM_USE_ACCEPTED;
    case RUBY2_ITEM_FLASHCARDS:
      if (state->current_room_id != RUBY2_ROOM_HOMEROOM &&
          state->current_room_id != RUBY2_ROOM_SCIENCE_LAB &&
          state->current_room_id != RUBY2_ROOM_LIBRARY) {
        return RUBY2_ITEM_USE_REJECTED;
      }
      payload.item_deltas[RUBY2_ITEM_FLASHCARDS] = -1;
      payload.virtue_deltas[RUBY2_VIRTUE_HEAD] = 1;
      payload.discipline_deltas[RUBY2_DISCIPLINE_SENSE] = 1;
      payload.clock_deltas[RUBY2_CLOCK_STRESS] = -1;
      ruby2_apply_effect_payload(state, &payload);
      return RUBY2_ITEM_USE_ACCEPTED;
    case RUBY2_ITEM_OFFICE_PASS:
      if (!state->office_pass_tutorial_complete) return RUBY2_ITEM_USE_REJECTED;
      if (state->clocks[RUBY2_CLOCK_STRESS].value < 2 && !state->failed_forward_recently) {
        return RUBY2_ITEM_USE_REJECTED;
      }
      payload.item_deltas[RUBY2_ITEM_OFFICE_PASS] = -1;
      payload.clock_deltas[RUBY2_CLOCK_STRESS] = -1;
      payload.clock_deltas[RUBY2_CLOCK_BELL] = 1;
      ruby2_apply_effect_payload(state, &payload);
      state->current_room_id = RUBY2_ROOM_GREENHOUSE;
      ruby2_sync_state_variables(state);
      return RUBY2_ITEM_USE_ACCEPTED;
    case RUBY2_ITEM_LIBRARY_CARD:
      if (state->current_room_id != RUBY2_ROOM_LIBRARY) return RUBY2_ITEM_USE_REJECTED;
      payload.virtue_deltas[RUBY2_VIRTUE_HEAD] = 1;
      payload.discipline_deltas[RUBY2_DISCIPLINE_SOURCE] = 1;
      ruby2_apply_effect_payload(state, &payload);
      return RUBY2_ITEM_USE_ACCEPTED;
    case RUBY2_ITEM_LAB_FLASK:
      if (state->current_room_id != RUBY2_ROOM_SCIENCE_LAB) return RUBY2_ITEM_USE_REJECTED;
      payload.virtue_deltas[RUBY2_VIRTUE_HUSTLE] = 1;
      payload.discipline_deltas[RUBY2_DISCIPLINE_SOURCE] = 1;
      ruby2_apply_effect_payload(state, &payload);
      return RUBY2_ITEM_USE_ACCEPTED;
    case RUBY2_ITEM_LUNCH_TRAY:
      if (state->current_room_id != RUBY2_ROOM_CAFETERIA) return RUBY2_ITEM_USE_REJECTED;
      payload.virtue_deltas[RUBY2_VIRTUE_HEART] = 1;
      payload.discipline_deltas[RUBY2_DISCIPLINE_SYNC] = 1;
      ruby2_apply_effect_payload(state, &payload);
      return RUBY2_ITEM_USE_ACCEPTED;
    default:
      return RUBY2_ITEM_USE_REJECTED;
  }
}

bool ruby2_set_active_companion(Ruby2State* state, Ruby2CharacterId character_id) {
  if (!state || character_id >= RUBY2_CHARACTER_COUNT) return false;
  if (state->active_companion_id != RUBY2_CHARACTER_NONE) return false;
  state->active_companion_id = (uint8_t)character_id;
  ruby2_sync_state_variables(state);
  return true;
}

void ruby2_clear_active_companion(Ruby2State* state) {
  if (!state) return;
  state->active_companion_id = RUBY2_CHARACTER_NONE;
  ruby2_sync_state_variables(state);
}

bool ruby2_is_active_companion(const Ruby2State* state, Ruby2CharacterId character_id) {
  return state && character_id < RUBY2_CHARACTER_COUNT &&
         state->active_companion_id == (uint8_t)character_id;
}

void ruby2_null_trace_add_action(Ruby2NullTrace* trace, Ruby2NullAction action) {
  if (!trace || action >= RUBY2_NULL_ACTION_COUNT) return;
  if (trace->action_count >= RUBY2_MAX_NULL_ACTIONS) {
    trace->invalid_action_count++;
    return;
  }
  trace->actions[trace->action_count++] = action;
}

static bool ruby2_null_trace_has_action(const Ruby2NullTrace* trace, Ruby2NullAction action) {
  if (!trace) return false;
  for (uint8_t i = 0; i < trace->action_count; ++i) {
    if (trace->actions[i] == action) return true;
  }
  return false;
}

Ruby2NullOutcome ruby2_resolve_first_null_signal(Ruby2State* state, const Ruby2NullTrace* trace) {
  Ruby2EffectPayload payload;
  ruby2_effect_payload_init(&payload);

  bool used_source = ruby2_null_trace_has_action(trace, RUBY2_NULL_ACTION_SOURCE);
  bool used_sync = ruby2_null_trace_has_action(trace, RUBY2_NULL_ACTION_SYNC);
  bool used_signal = ruby2_null_trace_has_action(trace, RUBY2_NULL_ACTION_SIGNAL);

  if (used_signal && trace->signal_stability >= 3 && trace->null_pressure <= 1) {
    payload.clock_deltas[RUBY2_CLOCK_NULL_SIGNAL] = -1;
    payload.virtue_deltas[RUBY2_VIRTUE_HONOR] = 1;
    payload.discipline_deltas[RUBY2_DISCIPLINE_SIGNAL] = 1;
    payload.reputation_tag = RUBY2_ARCHETYPE_SIGNAL_READER;
    payload.create_yearbook_candidate = true;
    payload.milestone_kind = RUBY2_MILESTONE_NULL_RESOLUTION;
    payload.candidate_id = 5001;
    payload.candidate_score = 11;
    ruby2_apply_effect_payload(state, &payload);
    return RUBY2_NULL_RESTRAINT;
  }

  if ((used_source && trace->signal_stability >= 4 && trace->null_pressure <= 1) ||
      (used_source && used_sync && trace->signal_stability >= 3 && trace->null_pressure <= 1)) {
    payload.clock_deltas[RUBY2_CLOCK_NULL_SIGNAL] = -1;
    payload.virtue_deltas[RUBY2_VIRTUE_HEAD] = 1;
    payload.discipline_deltas[RUBY2_DISCIPLINE_SIGNAL] = 1;
    payload.create_yearbook_candidate = true;
    payload.milestone_kind = RUBY2_MILESTONE_NULL_RESOLUTION;
    payload.candidate_id = 5002;
    payload.candidate_score = 9;
    ruby2_apply_effect_payload(state, &payload);
    return RUBY2_NULL_CLEAR;
  }

  if (trace->invalid_action_count > 0 || trace->null_pressure >= 3 || trace->signal_stability <= 0) {
    payload.clock_deltas[RUBY2_CLOCK_STRESS] = 1;
    payload.clock_deltas[RUBY2_CLOCK_NULL_SIGNAL] = 1;
    payload.discipline_deltas[RUBY2_DISCIPLINE_SIGNAL] = 1;
    state->failed_forward_recently = true;
    ruby2_apply_effect_payload(state, &payload);
    return RUBY2_NULL_FAILED_FORWARD;
  }

  payload.clock_deltas[RUBY2_CLOCK_STRESS] = 1;
  payload.clock_deltas[RUBY2_CLOCK_NULL_SIGNAL] = 1;
  payload.discipline_deltas[RUBY2_DISCIPLINE_SIGNAL] = 1;
  payload.create_yearbook_candidate = true;
  payload.milestone_kind = RUBY2_MILESTONE_NULL_RESOLUTION;
  payload.candidate_id = 5003;
  payload.candidate_score = 7;
  ruby2_apply_effect_payload(state, &payload);
  return RUBY2_NULL_MIXED;
}

void ruby2_run_week_one_sample(Ruby2State* state) {
  ruby2_state_init(state);

  Ruby2EffectPayload payload;
  ruby2_effect_payload_init(&payload);

  payload.virtue_deltas[RUBY2_VIRTUE_HEAD] = 1;
  payload.virtue_deltas[RUBY2_VIRTUE_HEART] = 1;
  payload.virtue_deltas[RUBY2_VIRTUE_HONOR] = 1;
  payload.discipline_deltas[RUBY2_DISCIPLINE_SENSE] = 1;
  payload.discipline_deltas[RUBY2_DISCIPLINE_SYNC] = 1;
  payload.affinity_deltas[RUBY2_CHARACTER_LYRA] = 1;
  payload.reputation_tag = RUBY2_ARCHETYPE_COMEBACK_STUDENT;
  payload.create_yearbook_candidate = true;
  payload.milestone_kind = RUBY2_MILESTONE_SOCIAL_CLIMAX;
  payload.candidate_id = 1001;
  payload.candidate_score = 10;
  ruby2_apply_effect_payload(state, &payload);

  ruby2_effect_payload_init(&payload);
  payload.virtue_deltas[RUBY2_VIRTUE_HEAD] = 1;
  payload.virtue_deltas[RUBY2_VIRTUE_HONOR] = 1;
  payload.discipline_deltas[RUBY2_DISCIPLINE_SOURCE] = 1;
  payload.discipline_deltas[RUBY2_DISCIPLINE_SIGNAL] = 1;
  payload.clock_deltas[RUBY2_CLOCK_NULL_SIGNAL] = 1;
  payload.reputation_tag = RUBY2_ARCHETYPE_SIGNAL_READER;
  payload.create_yearbook_candidate = true;
  payload.milestone_kind = RUBY2_MILESTONE_SOCIAL_CLIMAX;
  payload.candidate_id = 2001;
  payload.candidate_score = 8;
  ruby2_apply_effect_payload(state, &payload);

  state->room_unlocked[RUBY2_ROOM_LIBRARY] = true;
  state->current_room_id = RUBY2_ROOM_LIBRARY;
  ruby2_effect_payload_init(&payload);
  payload.virtue_deltas[RUBY2_VIRTUE_HEAD] = 1;
  payload.virtue_deltas[RUBY2_VIRTUE_HONOR] = 1;
  payload.discipline_deltas[RUBY2_DISCIPLINE_SOURCE] = 1;
  payload.discipline_deltas[RUBY2_DISCIPLINE_SENSE] = 1;
  payload.affinity_deltas[RUBY2_CHARACTER_INDRA] = 1;
  payload.clock_deltas[RUBY2_CLOCK_NULL_SIGNAL] = 1;
  payload.create_yearbook_candidate = true;
  payload.milestone_kind = RUBY2_MILESTONE_CLASS_REPORT;
  payload.candidate_id = 3001;
  payload.candidate_score = 11;
  ruby2_apply_effect_payload(state, &payload);

  state->office_pass_tutorial_complete = true;
  state->items[RUBY2_ITEM_OFFICE_PASS].owned = true;
  state->items[RUBY2_ITEM_OFFICE_PASS].carried = true;
  state->items[RUBY2_ITEM_OFFICE_PASS].charges = 1;
  state->clocks[RUBY2_CLOCK_STRESS].value = 2;
  ruby2_sync_state_variables(state);
  (void)ruby2_use_item(state, RUBY2_ITEM_OFFICE_PASS);

  Ruby2NullTrace trace = {
    .signal_stability = 3,
    .null_pressure = 0,
    .invalid_action_count = 0
  };
  ruby2_null_trace_add_action(&trace, RUBY2_NULL_ACTION_SIGNAL);
  (void)ruby2_resolve_first_null_signal(state, &trace);
  (void)ruby2_resolve_archetypes(state);
}

const char* ruby2_virtue_name(Ruby2Virtue virtue) {
  static const char* names[] = {"Head", "Heart", "Hustle", "Honor"};
  return virtue < RUBY2_VIRTUE_COUNT ? names[virtue] : "Unknown";
}

const char* ruby2_discipline_name(Ruby2Discipline discipline) {
  static const char* names[] = {"Source", "Sense", "Sync", "Signal"};
  return discipline < RUBY2_DISCIPLINE_COUNT ? names[discipline] : "Unknown";
}

const char* ruby2_clock_name(Ruby2Clock clock) {
  static const char* names[] = {"Bell", "Stress", "Rumor", "Null Signal"};
  return clock < RUBY2_CLOCK_COUNT ? names[clock] : "Unknown";
}

const char* ruby2_item_name(Ruby2ItemId item_id) {
  static const char* names[] = {"Notebook", "Flashcards", "Office Pass", "Library Card", "Lab Flask", "Lunch Tray"};
  return item_id < RUBY2_ITEM_COUNT ? names[item_id] : "Unknown";
}

const char* ruby2_room_name(Ruby2RoomId room_id) {
  static const char* names[] = {
    "Hallway", "Homeroom", "Science Lab", "Library", "Cafeteria", "Greenhouse", "Courtyard", "Teacher Office"
  };
  return room_id < RUBY2_ROOM_COUNT ? names[room_id] : "Unknown";
}

const char* ruby2_archetype_name(Ruby2Archetype archetype) {
  static const char* names[] = {
    "Scholar", "Connector", "Operator", "Conscience", "Signal-Reader", "Comeback Student", "Wild Card"
  };
  return archetype < RUBY2_ARCHETYPE_COUNT ? names[archetype] : "Unknown";
}

const char* ruby2_null_outcome_name(Ruby2NullOutcome outcome) {
  static const char* names[] = {"Clear", "Mixed", "Failed-Forward", "Restraint"};
  return outcome <= RUBY2_NULL_RESTRAINT ? names[outcome] : "Unknown";
}

const char* ruby2_candidate_title(uint16_t candidate_id) {
  switch (candidate_id) {
    case 1001: return "The First Comeback";
    case 1002: return "Next Time Energy";
    case 1003: return "The Answer Was Always C";
    case 2001: return "The Poster Changed";
    case 2002: return "The Wall Noticed First";
    case 3001: return "The Catalog Card";
    case 3002: return "It Wants A Verb";
    case 3003: return "Exact Copy";
    case 4001: return "Greenhouse Breathing";
    case 5001: return "Held";
    case 5002: return "The Door Remembered";
    case 5003: return "Shadow In The Notebook";
    case 6001: return "The Wet Stamp";
    case 6002: return "The Word Original";
    case 6003: return "The Borrowed Line";
    case 6004: return "The Shared Stamp";
    case 7001: return "The Receipt Answered";
    default: return "Untitled Page Draft";
  }
}

const char* ruby2_candidate_blurb(uint16_t candidate_id) {
  switch (candidate_id) {
    case 1001: return "Lyra remembers that the hard question got survivable.";
    case 1002: return "Mika turns a miss into a promise you have to live up to.";
    case 1003: return "Indra's first line becomes the kind of rumor that follows you.";
    case 2001: return "The hallway poster changed, and you checked the receipt.";
    case 2002: return "Noor made the impossible social before anyone made it official.";
    case 3001: return "The source was older than the ink, and you checked anyway.";
    case 3002: return "Indra handed you the impossible clue without touching it.";
    case 3003: return "You copied only what was there and refused the extra word.";
    case 4001: return "The Greenhouse route turns recovery into a choice, not a retreat.";
    case 5001: return "Nothing happened loudly. That was the point.";
    case 5002: return "The door remembered it was a door because you held the pattern.";
    case 5003: return "The hallway got your name wrong, and the Notebook kept proof.";
    case 6001: return "You held the wet work-order stamp up before the answer card could own the room.";
    case 6002: return "You caught the word original hiding a second question.";
    case 6003: return "You circled the footer Ruby did not print, then found it again at lunch.";
    case 6004: return "You got Ravi and Lyra checking the same stamp before choosing a side.";
    case 7001: return "The lunch receipt repeated Homeroom's footer, and you made it evidence.";
    default: return "A page draft waits for the right memory.";
  }
}

const char* ruby2_candidate_signer(uint16_t candidate_id) {
  switch (candidate_id) {
    case 1001: return "Lyra + Mika";
    case 1002: return "Mika";
    case 1003: return "Indra";
    case 2001: return "Ravi";
    case 2002: return "Noor";
    case 3001: return "Professor Edward + Indra";
    case 3002: return "Indra";
    case 3003: return "Ruby + Indra";
    case 4001: return "Mika";
    case 5001: return "Indra";
    case 5002: return "Ruby";
    case 5003: return "Noor";
    case 6001: return "Ruby + Ravi";
    case 6002: return "Ruby + Indra";
    case 6003: return "Noor";
    case 6004: return "Lyra + Mika";
    case 7001: return "Noor";
    default: return "Ruby";
  }
}

const char* ruby2_candidate_tomorrow_hook(uint16_t candidate_id) {
  switch (candidate_id) {
    case 1001: return "Tomorrow, Lyra wants to compare notes before the bell.";
    case 1002: return "Tomorrow, Mika is saving you a seat like she expects a comeback.";
    case 1003: return "Tomorrow, Indra leaves one letter circled on the Library board.";
    case 2001: return "Tomorrow, Ravi brings two copies of the same poster and neither agrees.";
    case 2002: return "Tomorrow, Noor asks if you are ready to be noticed by architecture again.";
    case 3001: return "Tomorrow, Edward has a second catalog card waiting.";
    case 3002: return "Tomorrow, Indra asks what kind of verb refuses a command.";
    case 3003: return "Tomorrow, Ruby checks whether the Notebook added anything while you slept.";
    case 4001: return "Tomorrow, the Greenhouse door is already cracked open.";
    case 5001: return "Tomorrow, the hallway clock has hands again. One points at you.";
    case 5002: return "Tomorrow, Ruby asks why the door listened.";
    case 5003: return "Tomorrow, Noor says your name correctly before anyone else does.";
    case 6001: return "Tomorrow, Sally brings two sources and asks which one deserves the room.";
    case 6002: return "Tomorrow, Edward circles the word obvious and waits.";
    case 6003: return "Tomorrow, your locker checkout slip has the same footer.";
    case 6004: return "Tomorrow, Eliza asks what a room knows when everyone checks the same stamp.";
    case 7001: return "Tomorrow, Noor saves the tray receipt without explaining why.";
    default: return "Tomorrow, Ruby has another question.";
  }
}
