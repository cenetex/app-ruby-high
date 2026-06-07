#include "ruby2_engine.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int failures = 0;

#define EXPECT_TRUE(expr) \
  do { \
    if (!(expr)) { \
      fprintf(stderr, "FAIL %s:%d: expected true: %s\n", __FILE__, __LINE__, #expr); \
      failures++; \
    } \
  } while (0)

#define EXPECT_FALSE(expr) \
  do { \
    if ((expr)) { \
      fprintf(stderr, "FAIL %s:%d: expected false: %s\n", __FILE__, __LINE__, #expr); \
      failures++; \
    } \
  } while (0)

#define EXPECT_EQ_INT(actual, expected) \
  do { \
    int a_ = (int)(actual); \
    int e_ = (int)(expected); \
    if (a_ != e_) { \
      fprintf(stderr, "FAIL %s:%d: expected %s == %d, got %d\n", __FILE__, __LINE__, #actual, e_, a_); \
      failures++; \
    } \
  } while (0)

#define EXPECT_STREQ(actual, expected) \
  do { \
    const char* a_ = (actual); \
    const char* e_ = (expected); \
    if (strcmp(a_, e_) != 0) { \
      fprintf(stderr, "FAIL %s:%d: expected %s == \"%s\", got \"%s\"\n", __FILE__, __LINE__, #actual, e_, a_); \
      failures++; \
    } \
  } while (0)

static void test_empty_effect_has_no_reputation_tag(void) {
  Ruby2State state;
  ruby2_state_init(&state);

  Ruby2EffectPayload payload;
  ruby2_effect_payload_init(&payload);
  ruby2_apply_effect_payload(&state, &payload);

  EXPECT_EQ_INT(state.archetype_points[RUBY2_ARCHETYPE_SCHOLAR], 0);
  EXPECT_EQ_INT(state.archetype_points[RUBY2_ARCHETYPE_WILD_CARD], 0);
}

static void test_initial_inventory_slots_are_empty(void) {
  Ruby2State state;
  ruby2_state_init(&state);

  for (uint8_t i = 0; i < RUBY2_ITEM_COUNT; ++i) {
    EXPECT_FALSE(state.items[i].owned);
    EXPECT_FALSE(state.items[i].carried);
    EXPECT_EQ_INT(state.items[i].charges, 0);
  }
}

static void test_disciplines_are_separate_from_virtues(void) {
  Ruby2State state;
  ruby2_state_init(&state);

  Ruby2EffectPayload payload;
  ruby2_effect_payload_init(&payload);
  payload.virtue_deltas[RUBY2_VIRTUE_HONOR] = 1;
  payload.discipline_deltas[RUBY2_DISCIPLINE_SOURCE] = 1;
  ruby2_apply_effect_payload(&state, &payload);

  EXPECT_EQ_INT(state.virtue_counts[RUBY2_VIRTUE_HONOR], 1);
  EXPECT_EQ_INT(state.virtue_counts[RUBY2_VIRTUE_HEAD], 0);
  EXPECT_EQ_INT(state.discipline_counts[RUBY2_DISCIPLINE_SOURCE], 1);
  EXPECT_EQ_INT(state.discipline_counts[RUBY2_DISCIPLINE_SIGNAL], 0);
  EXPECT_STREQ(ruby2_discipline_name(RUBY2_DISCIPLINE_SYNC), "Sync");
}

static void test_candidate_copy(void) {
  EXPECT_STREQ(ruby2_candidate_title(5001), "Held");
  EXPECT_STREQ(ruby2_candidate_title(2001), "The Poster Changed");
  EXPECT_STREQ(ruby2_candidate_signer(1001), "Lyra + Mika");
}

static void test_gate_rpn(void) {
  Ruby2State state;
  ruby2_state_init(&state);
  state.virtue_counts[RUBY2_VIRTUE_HEAD] = 2;
  state.discipline_counts[RUBY2_DISCIPLINE_SOURCE] = 2;
  state.items[RUBY2_ITEM_LIBRARY_CARD].owned = true;
  state.items[RUBY2_ITEM_LIBRARY_CARD].carried = true;
  state.current_time_block = RUBY2_TIME_AFTER_SCHOOL;
  ruby2_sync_state_variables(&state);

  Ruby2CompiledGate gate = {
    .ops = {
      {RUBY2_GATE_VAR_GTE, RUBY2_VAR_VIRT_HEAD, 2},
      {RUBY2_GATE_VAR_GTE, RUBY2_VAR_DISC_SOURCE, 2},
      {RUBY2_GATE_OR, 0, 0},
      {RUBY2_GATE_VAR_EQ, RUBY2_VAR_TIME_BLOCK, RUBY2_TIME_AFTER_SCHOOL},
      {RUBY2_GATE_AND, 0, 0}
    },
    .count = 5
  };

  EXPECT_TRUE(ruby2_eval_gate(&state, &gate));
  state.current_time_block = RUBY2_TIME_LUNCH;
  ruby2_sync_state_variables(&state);
  EXPECT_FALSE(ruby2_eval_gate(&state, &gate));
}

static void test_gate_flags(void) {
  Ruby2State state;
  ruby2_state_init(&state);
  state.items[RUBY2_ITEM_LIBRARY_CARD].owned = true;
  state.items[RUBY2_ITEM_LIBRARY_CARD].carried = true;
  EXPECT_TRUE(ruby2_set_active_companion(&state, RUBY2_CHARACTER_MIKA));

  Ruby2CompiledGate gate = {
    .ops = {
      {RUBY2_GATE_FLAG_SET, RUBY2_FLAG_ITEM_CARRIED, RUBY2_ITEM_LIBRARY_CARD},
      {RUBY2_GATE_FLAG_SET, RUBY2_FLAG_COMPANION_PRESENT, RUBY2_CHARACTER_MIKA},
      {RUBY2_GATE_AND, 0, 0}
    },
    .count = 3
  };

  EXPECT_TRUE(ruby2_eval_gate(&state, &gate));
  ruby2_clear_active_companion(&state);
  EXPECT_FALSE(ruby2_eval_gate(&state, &gate));
}

static void test_candidate_effect_requires_milestone(void) {
  Ruby2State state;
  ruby2_state_init(&state);

  Ruby2EffectPayload payload;
  ruby2_effect_payload_init(&payload);
  payload.create_yearbook_candidate = true;
  payload.candidate_id = 7001;
  payload.candidate_score = 12;
  ruby2_apply_effect_payload(&state, &payload);
  EXPECT_EQ_INT(state.yearbook_candidate_count, 0);

  ruby2_effect_payload_init(&payload);
  payload.create_yearbook_candidate = true;
  payload.milestone_kind = RUBY2_MILESTONE_CLASS_REPORT;
  payload.candidate_id = 7001;
  payload.candidate_score = 12;
  ruby2_apply_effect_payload(&state, &payload);
  EXPECT_EQ_INT(state.yearbook_candidate_count, 1);
}

static void test_yearbook_candidate_eviction(void) {
  Ruby2State state;
  ruby2_state_init(&state);

  for (uint8_t i = 0; i < RUBY2_MAX_YEARBOOK_CANDIDATES; ++i) {
    Ruby2YearbookCandidate candidate;
    memset(&candidate, 0, sizeof(candidate));
    candidate.id = (uint16_t)(1000 + i);
    candidate.score = (int16_t)(RUBY2_MIN_YEARBOOK_CANDIDATE_SCORE + (i % 4));
    candidate.status = RUBY2_CANDIDATE_CANDIDATE;
    EXPECT_TRUE(ruby2_insert_yearbook_candidate(&state, candidate));
  }

  EXPECT_EQ_INT(state.yearbook_candidate_count, RUBY2_MAX_YEARBOOK_CANDIDATES);

  Ruby2YearbookCandidate weak;
  memset(&weak, 0, sizeof(weak));
  weak.id = 2000;
  weak.score = RUBY2_MIN_YEARBOOK_CANDIDATE_SCORE;
  weak.status = RUBY2_CANDIDATE_CANDIDATE;
  EXPECT_FALSE(ruby2_insert_yearbook_candidate(&state, weak));

  Ruby2YearbookCandidate strong;
  memset(&strong, 0, sizeof(strong));
  strong.id = 3000;
  strong.score = 12;
  strong.status = RUBY2_CANDIDATE_CANDIDATE;
  EXPECT_TRUE(ruby2_insert_yearbook_candidate(&state, strong));

  bool found_strong = false;
  for (uint8_t i = 0; i < state.yearbook_candidate_count; ++i) {
    if (state.yearbook_candidates[i].id == 3000) {
      found_strong = true;
      break;
    }
  }
  EXPECT_TRUE(found_strong);
}

static void test_office_pass_server_validation(void) {
  Ruby2State state;
  ruby2_state_init(&state);
  state.items[RUBY2_ITEM_OFFICE_PASS].owned = true;
  state.items[RUBY2_ITEM_OFFICE_PASS].carried = true;
  state.items[RUBY2_ITEM_OFFICE_PASS].charges = 1;
  state.clocks[RUBY2_CLOCK_STRESS].value = 3;

  EXPECT_EQ_INT(ruby2_use_item(&state, RUBY2_ITEM_OFFICE_PASS), RUBY2_ITEM_USE_REJECTED);
  EXPECT_EQ_INT(state.items[RUBY2_ITEM_OFFICE_PASS].charges, 1);

  state.office_pass_tutorial_complete = true;
  EXPECT_EQ_INT(ruby2_use_item(&state, RUBY2_ITEM_OFFICE_PASS), RUBY2_ITEM_USE_ACCEPTED);
  EXPECT_EQ_INT(state.items[RUBY2_ITEM_OFFICE_PASS].charges, 0);
  EXPECT_EQ_INT(state.current_room_id, RUBY2_ROOM_GREENHOUSE);
  EXPECT_EQ_INT(state.clocks[RUBY2_CLOCK_STRESS].value, 2);
}

static void test_archetype_resolution(void) {
  Ruby2State state;
  ruby2_state_init(&state);
  state.virtue_counts[RUBY2_VIRTUE_HEAD] = 6;
  state.virtue_counts[RUBY2_VIRTUE_HEART] = 2;

  EXPECT_EQ_INT(ruby2_resolve_archetypes(&state), RUBY2_ARCHETYPE_SCHOLAR);

  ruby2_state_init(&state);
  state.virtue_counts[RUBY2_VIRTUE_HEAD] = 4;
  state.virtue_counts[RUBY2_VIRTUE_HEART] = 4;
  state.virtue_counts[RUBY2_VIRTUE_HUSTLE] = 3;
  EXPECT_EQ_INT(ruby2_resolve_archetypes(&state), RUBY2_ARCHETYPE_WILD_CARD);

  ruby2_state_init(&state);
  state.virtue_counts[RUBY2_VIRTUE_HONOR] = 2;
  state.archetype_points[RUBY2_ARCHETYPE_CONSCIENCE] = 1;
  state.virtue_counts[RUBY2_VIRTUE_HEAD] = 2;
  EXPECT_EQ_INT(ruby2_resolve_archetypes(&state), RUBY2_ARCHETYPE_WILD_CARD);
  EXPECT_EQ_INT(state.secondary_archetype, RUBY2_ARCHETYPE_CONSCIENCE);
}

static void test_null_trace_resolution(void) {
  Ruby2State state;
  ruby2_state_init(&state);
  Ruby2NullTrace trace = {
    .signal_stability = 3,
    .null_pressure = 0,
    .invalid_action_count = 0
  };
  ruby2_null_trace_add_action(&trace, RUBY2_NULL_ACTION_SIGNAL);

  EXPECT_EQ_INT(ruby2_resolve_first_null_signal(&state, &trace), RUBY2_NULL_RESTRAINT);
  EXPECT_EQ_INT(state.clocks[RUBY2_CLOCK_NULL_SIGNAL].value, 0);
  EXPECT_EQ_INT(state.yearbook_candidate_count, 1);

  ruby2_state_init(&state);
  Ruby2NullTrace failed = {
    .signal_stability = 0,
    .null_pressure = 3,
    .invalid_action_count = 1
  };
  ruby2_null_trace_add_action(&failed, RUBY2_NULL_ACTION_SENSE);
  EXPECT_EQ_INT(ruby2_resolve_first_null_signal(&state, &failed), RUBY2_NULL_FAILED_FORWARD);
  EXPECT_EQ_INT(state.clocks[RUBY2_CLOCK_STRESS].value, 1);
  EXPECT_EQ_INT(state.clocks[RUBY2_CLOCK_NULL_SIGNAL].value, 1);
}

static void test_active_companion(void) {
  Ruby2State state;
  ruby2_state_init(&state);

  EXPECT_TRUE(ruby2_set_active_companion(&state, RUBY2_CHARACTER_MIKA));
  EXPECT_TRUE(ruby2_is_active_companion(&state, RUBY2_CHARACTER_MIKA));
  EXPECT_EQ_INT(state.variables[RUBY2_VAR_ACTIVE_COMPANION], RUBY2_CHARACTER_MIKA);
  EXPECT_FALSE(ruby2_set_active_companion(&state, RUBY2_CHARACTER_LYRA));
  ruby2_clear_active_companion(&state);
  EXPECT_FALSE(ruby2_is_active_companion(&state, RUBY2_CHARACTER_MIKA));
  EXPECT_EQ_INT(state.variables[RUBY2_VAR_ACTIVE_COMPANION], RUBY2_CHARACTER_NONE);
}

int main(void) {
  test_empty_effect_has_no_reputation_tag();
  test_initial_inventory_slots_are_empty();
  test_disciplines_are_separate_from_virtues();
  test_candidate_copy();
  test_gate_rpn();
  test_gate_flags();
  test_candidate_effect_requires_milestone();
  test_yearbook_candidate_eviction();
  test_office_pass_server_validation();
  test_archetype_resolution();
  test_null_trace_resolution();
  test_active_companion();

  if (failures != 0) {
    fprintf(stderr, "%d test failure(s)\n", failures);
    return EXIT_FAILURE;
  }

  puts("ruby2 C engine tests passed");
  return EXIT_SUCCESS;
}
