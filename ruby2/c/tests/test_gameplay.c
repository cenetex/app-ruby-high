#include "ruby2_engine.h"

#include <stdio.h>
#include <string.h>

static int failures = 0;

#define EXPECT_TRUE(expr) \
  do { \
    if (!(expr)) { \
      fprintf(stderr, "FAIL %s:%d: expected true: %s\n", __FILE__, __LINE__, #expr); \
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

static void apply(Ruby2State* state, const Ruby2EffectPayload* payload) {
  ruby2_apply_effect_payload(state, payload);
}

static void add_candidate(Ruby2State* state, uint16_t id, int16_t score, Ruby2Archetype tag) {
  Ruby2EffectPayload payload;
  ruby2_effect_payload_init(&payload);
  payload.create_yearbook_candidate = true;
  payload.milestone_kind = RUBY2_MILESTONE_SOCIAL_CLIMAX;
  payload.candidate_id = id;
  payload.candidate_score = score;
  payload.reputation_tag = tag;
  apply(state, &payload);
}

static bool has_candidate(const Ruby2State* state, uint16_t id) {
  for (uint8_t i = 0; i < state->yearbook_candidate_count; ++i) {
    if (state->yearbook_candidates[i].id == id) return true;
  }
  return false;
}

static void play_item_week(Ruby2State* state) {
  ruby2_state_init(state);

  Ruby2EffectPayload payload;
  ruby2_effect_payload_init(&payload);
  payload.virtue_deltas[RUBY2_VIRTUE_HEAD] = 1;
  payload.virtue_deltas[RUBY2_VIRTUE_HONOR] = 1;
  payload.discipline_deltas[RUBY2_DISCIPLINE_SENSE] = 1;
  apply(state, &payload);

  ruby2_effect_payload_init(&payload);
  payload.virtue_deltas[RUBY2_VIRTUE_HUSTLE] = 1;
  payload.discipline_deltas[RUBY2_DISCIPLINE_SYNC] = 1;
  add_candidate(state, 1002, 9, RUBY2_ARCHETYPE_COMEBACK_STUDENT);
  apply(state, &payload);

  ruby2_effect_payload_init(&payload);
  payload.virtue_deltas[RUBY2_VIRTUE_HEAD] = 1;
  payload.virtue_deltas[RUBY2_VIRTUE_HONOR] = 1;
  payload.discipline_deltas[RUBY2_DISCIPLINE_SOURCE] = 1;
  payload.discipline_deltas[RUBY2_DISCIPLINE_SIGNAL] = 1;
  payload.clock_deltas[RUBY2_CLOCK_NULL_SIGNAL] = 1;
  add_candidate(state, 2001, 8, RUBY2_ARCHETYPE_SIGNAL_READER);
  apply(state, &payload);

  ruby2_effect_payload_init(&payload);
  payload.virtue_deltas[RUBY2_VIRTUE_HEAD] = 1;
  payload.virtue_deltas[RUBY2_VIRTUE_HONOR] = 1;
  payload.discipline_deltas[RUBY2_DISCIPLINE_SOURCE] = 1;
  payload.discipline_deltas[RUBY2_DISCIPLINE_SENSE] = 1;
  payload.clock_deltas[RUBY2_CLOCK_NULL_SIGNAL] = 1;
  add_candidate(state, 3001, 11, RUBY2_ARCHETYPE_SIGNAL_READER);
  apply(state, &payload);

  Ruby2NullTrace trace = {
    .signal_stability = 4,
    .null_pressure = 1,
    .invalid_action_count = 0
  };
  ruby2_null_trace_add_action(&trace, RUBY2_NULL_ACTION_SOURCE);
  EXPECT_EQ_INT(ruby2_resolve_first_null_signal(state, &trace), RUBY2_NULL_CLEAR);
  (void)ruby2_resolve_archetypes(state);
}

static void play_social_pressure_week(Ruby2State* state) {
  ruby2_state_init(state);

  Ruby2EffectPayload payload;
  ruby2_effect_payload_init(&payload);
  payload.clock_deltas[RUBY2_CLOCK_STRESS] = 1;
  payload.reputation_tag = RUBY2_ARCHETYPE_COMEBACK_STUDENT;
  apply(state, &payload);

  ruby2_effect_payload_init(&payload);
  payload.virtue_deltas[RUBY2_VIRTUE_HEAD] = 1;
  payload.discipline_deltas[RUBY2_DISCIPLINE_SENSE] = 1;
  payload.clock_deltas[RUBY2_CLOCK_RUMOR] = 1;
  add_candidate(state, 1003, 8, RUBY2_ARCHETYPE_SCHOLAR);
  apply(state, &payload);

  ruby2_effect_payload_init(&payload);
  payload.virtue_deltas[RUBY2_VIRTUE_HEART] = 1;
  payload.discipline_deltas[RUBY2_DISCIPLINE_SYNC] = 1;
  payload.clock_deltas[RUBY2_CLOCK_RUMOR] = 1;
  add_candidate(state, 2002, 8, RUBY2_ARCHETYPE_CONNECTOR);
  apply(state, &payload);

  ruby2_effect_payload_init(&payload);
  payload.virtue_deltas[RUBY2_VIRTUE_HONOR] = 2;
  payload.discipline_deltas[RUBY2_DISCIPLINE_SIGNAL] = 1;
  add_candidate(state, 3003, 11, RUBY2_ARCHETYPE_CONSCIENCE);
  apply(state, &payload);

  Ruby2NullTrace trace = {
    .signal_stability = 0,
    .null_pressure = 4,
    .invalid_action_count = 1
  };
  ruby2_null_trace_add_action(&trace, RUBY2_NULL_ACTION_SENSE);
  EXPECT_EQ_INT(ruby2_resolve_first_null_signal(state, &trace), RUBY2_NULL_FAILED_FORWARD);
  (void)ruby2_resolve_archetypes(state);
}

int main(void) {
  Ruby2State item;
  Ruby2State social;
  play_item_week(&item);
  play_social_pressure_week(&social);

  EXPECT_TRUE(has_candidate(&item, 2001));
  EXPECT_TRUE(has_candidate(&item, 3001));
  EXPECT_TRUE(has_candidate(&item, 5002));
  EXPECT_TRUE(!has_candidate(&item, 2002));

  EXPECT_TRUE(has_candidate(&social, 2002));
  EXPECT_TRUE(has_candidate(&social, 3003));
  EXPECT_TRUE(!has_candidate(&social, 5002));

  EXPECT_TRUE(item.discipline_counts[RUBY2_DISCIPLINE_SOURCE] >
              social.discipline_counts[RUBY2_DISCIPLINE_SOURCE]);
  EXPECT_TRUE(social.discipline_counts[RUBY2_DISCIPLINE_SYNC] >= 1);
  EXPECT_EQ_INT(item.dominant_archetype, RUBY2_ARCHETYPE_WILD_CARD);
  EXPECT_EQ_INT(social.dominant_archetype, RUBY2_ARCHETYPE_WILD_CARD);
  EXPECT_TRUE(item.secondary_archetype != social.secondary_archetype);

  if (failures != 0) {
    fprintf(stderr, "%d gameplay test failure(s)\n", failures);
    return 1;
  }

  puts("ruby2 gameplay tests passed");
  return 0;
}
