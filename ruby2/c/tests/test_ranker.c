#include "ruby2_ranker.h"

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

static void test_ranker_orders_only_legal_candidates(void) {
  Ruby2RankerModel model;
  Ruby2RankerCandidate candidates[3];
  Ruby2RankerResult result;

  ruby2_ranker_model_init(&model);
  ruby2_ranker_candidate_init(&candidates[0], 30, RUBY2_RANKER_DOMAIN_LLM_PREGEN);
  ruby2_ranker_candidate_init(&candidates[1], 20, RUBY2_RANKER_DOMAIN_LLM_PREGEN);
  ruby2_ranker_candidate_init(&candidates[2], 10, RUBY2_RANKER_DOMAIN_LLM_PREGEN);

  candidates[0].features[RUBY2_RANKER_F_AUTHORED_PRIORITY] = 0.1f;
  candidates[1].features[RUBY2_RANKER_F_AUTHORED_PRIORITY] = 1.0f;
  candidates[2].features[RUBY2_RANKER_F_AUTHORED_PRIORITY] = 5.0f;
  candidates[2].legal = false;

  EXPECT_TRUE(ruby2_ranker_rank_candidates(&model, candidates, 3, &result));
  EXPECT_EQ_INT(result.ranked_indices[0], 1);
  EXPECT_EQ_INT(result.ranked_indices[2], 2);
}

static void test_ranker_tie_breaks_by_candidate_id(void) {
  Ruby2RankerModel model;
  Ruby2RankerCandidate candidates[2];
  Ruby2RankerResult result;

  ruby2_ranker_model_init(&model);
  memset(model.weights, 0, sizeof(model.weights));
  ruby2_ranker_candidate_init(&candidates[0], 200, RUBY2_RANKER_DOMAIN_WORLD_ACTION);
  ruby2_ranker_candidate_init(&candidates[1], 100, RUBY2_RANKER_DOMAIN_WORLD_ACTION);

  EXPECT_TRUE(ruby2_ranker_rank_candidates(&model, candidates, 2, &result));
  EXPECT_EQ_INT(result.ranked_indices[0], 1);
}

static void choose_default_avatar(Ruby2World* world) {
  EXPECT_TRUE(world != NULL);
  EXPECT_TRUE(world->player_profile_ready);
  ruby2_world_clear_events(world);
}

static void advance_to_lunch_with(Ruby2World* world, Ruby2WorldActionId approach) {
  EXPECT_TRUE(ruby2_world_apply_action(world, RUBY2_ACTION_GO_HOMEROOM));
  EXPECT_TRUE(ruby2_world_apply_action(world, RUBY2_ACTION_ATTEND_HOMEROOM));
  EXPECT_TRUE(ruby2_world_apply_action(world, approach));
  EXPECT_TRUE(ruby2_world_apply_action(world, RUBY2_ACTION_WAIT_BELL));
}

static void test_world_action_ranking_preserves_candidate_set(void) {
  Ruby2World world;
  Ruby2WorldActionList legal;
  Ruby2WorldActionList ranked;
  Ruby2RankerResult result;
  bool seen[RUBY2_ACTION_COUNT];

  ruby2_world_init(&world);
  choose_default_avatar(&world);
  ruby2_world_query_actions(&world, &legal);
  EXPECT_TRUE(ruby2_ranker_rank_world_actions(&world, &legal, &ranked, &result));
  EXPECT_EQ_INT(ranked.count, legal.count);
  EXPECT_EQ_INT(result.count, legal.count);

  memset(seen, 0, sizeof(seen));
  for (uint8_t i = 0; i < legal.count; ++i) {
    seen[legal.actions[i].id] = true;
  }
  for (uint8_t i = 0; i < ranked.count; ++i) {
    EXPECT_TRUE(seen[ranked.actions[i].id]);
    seen[ranked.actions[i].id] = false;
  }
  for (uint8_t i = 0; i < RUBY2_ACTION_COUNT; ++i) {
    EXPECT_FALSE(seen[i]);
  }
}

static void test_ranker_prefers_collecting_first_real_item(void) {
  Ruby2World world;
  Ruby2WorldActionList legal;
  Ruby2WorldActionList ranked;
  Ruby2RankerResult result;

  ruby2_world_init(&world);
  choose_default_avatar(&world);
  ruby2_world_query_actions(&world, &legal);
  EXPECT_TRUE(ruby2_ranker_rank_world_actions(&world, &legal, &ranked, &result));
  EXPECT_TRUE(ranked.count >= 2);
  EXPECT_EQ_INT(ranked.actions[0].id, RUBY2_ACTION_COLLECT_NOTEBOOK);
}

static void record_recent_action(Ruby2World* world, uint8_t slot, Ruby2WorldActionId action_id, Ruby2RoomId room_id) {
  world->recent_action_ids[slot] = action_id;
  world->recent_action_rooms[slot] = room_id;
}

static void test_ranker_avoids_repeating_last_action_as_top_choice(void) {
  Ruby2World world;
  Ruby2WorldActionList legal;
  Ruby2WorldActionList ranked;
  Ruby2RankerResult result;

  ruby2_world_init(&world);
  memset(&legal, 0, sizeof(legal));
  legal.count = 3;

  legal.actions[0].id = RUBY2_ACTION_CHAT_ROOM;
  legal.actions[0].kind = RUBY2_WORLD_ACTION_TALK;
  legal.actions[0].target_room = RUBY2_ROOM_HALLWAY;
  legal.actions[0].target_character = RUBY2_CHARACTER_RUBY;
  legal.actions[0].target_item = RUBY2_WORLD_ITEM_NOTEBOOK;
  legal.actions[0].discipline = RUBY2_DISCIPLINE_SOURCE;
  legal.actions[0].virtue = RUBY2_VIRTUE_HEAD;
  legal.actions[0].label = "speak to ruby";

  legal.actions[1].id = RUBY2_ACTION_GO_HOMEROOM;
  legal.actions[1].kind = RUBY2_WORLD_ACTION_GO;
  legal.actions[1].target_room = RUBY2_ROOM_HOMEROOM;
  legal.actions[1].target_character = RUBY2_CHARACTER_NONE;
  legal.actions[1].target_item = RUBY2_WORLD_ITEM_NOTEBOOK;
  legal.actions[1].discipline = RUBY2_DISCIPLINE_SIGNAL;
  legal.actions[1].virtue = RUBY2_VIRTUE_HONOR;
  legal.actions[1].label = "go home";

  legal.actions[2].id = RUBY2_ACTION_WAIT_BELL;
  legal.actions[2].kind = RUBY2_WORLD_ACTION_WAIT;
  legal.actions[2].target_room = RUBY2_ROOM_HALLWAY;
  legal.actions[2].target_character = RUBY2_CHARACTER_NONE;
  legal.actions[2].target_item = RUBY2_WORLD_ITEM_NOTEBOOK;
  legal.actions[2].discipline = RUBY2_DISCIPLINE_SYNC;
  legal.actions[2].virtue = RUBY2_VIRTUE_HUSTLE;
  legal.actions[2].label = "wait";

  world.has_last_action = true;
  world.last_action_room = RUBY2_ROOM_HALLWAY;
  world.last_action_id = RUBY2_ACTION_CHAT_ROOM;
  world.recent_action_count = 1;
  record_recent_action(&world, 0, RUBY2_ACTION_CHAT_ROOM, RUBY2_ROOM_HALLWAY);

  EXPECT_TRUE(ruby2_ranker_rank_world_actions(&world, &legal, &ranked, &result));
  EXPECT_TRUE(ranked.count == legal.count);
  EXPECT_TRUE(ranked.actions[0].id != RUBY2_ACTION_CHAT_ROOM);
}

static void test_ranker_avoids_recent_repeats_over_top_slots(void) {
  Ruby2World world;
  Ruby2WorldActionList legal;
  Ruby2WorldActionList ranked;
  Ruby2RankerResult result;

  ruby2_world_init(&world);
  memset(&legal, 0, sizeof(legal));
  legal.count = 4;

  legal.actions[0].id = RUBY2_ACTION_CHAT_ROOM;
  legal.actions[0].kind = RUBY2_WORLD_ACTION_TALK;
  legal.actions[0].target_room = RUBY2_ROOM_HALLWAY;
  legal.actions[0].target_character = RUBY2_CHARACTER_RUBY;
  legal.actions[0].target_item = RUBY2_WORLD_ITEM_NOTEBOOK;
  legal.actions[0].discipline = RUBY2_DISCIPLINE_SOURCE;
  legal.actions[0].virtue = RUBY2_VIRTUE_HEAD;
  legal.actions[0].label = "talk ruby again";

  legal.actions[1].id = RUBY2_ACTION_GO_HOMEROOM;
  legal.actions[1].kind = RUBY2_WORLD_ACTION_GO;
  legal.actions[1].target_room = RUBY2_ROOM_HOMEROOM;
  legal.actions[1].target_character = RUBY2_CHARACTER_NONE;
  legal.actions[1].target_item = RUBY2_WORLD_ITEM_NOTEBOOK;
  legal.actions[1].discipline = RUBY2_DISCIPLINE_SIGNAL;
  legal.actions[1].virtue = RUBY2_VIRTUE_HONOR;
  legal.actions[1].label = "go home";

  legal.actions[2].id = RUBY2_ACTION_WAIT_BELL;
  legal.actions[2].kind = RUBY2_WORLD_ACTION_WAIT;
  legal.actions[2].target_room = RUBY2_ROOM_HALLWAY;
  legal.actions[2].target_character = RUBY2_CHARACTER_NONE;
  legal.actions[2].target_item = RUBY2_WORLD_ITEM_NOTEBOOK;
  legal.actions[2].discipline = RUBY2_DISCIPLINE_SYNC;
  legal.actions[2].virtue = RUBY2_VIRTUE_HUSTLE;
  legal.actions[2].label = "wait a little";

  legal.actions[3].id = RUBY2_ACTION_APPROACH_SIGNAL;
  legal.actions[3].kind = RUBY2_WORLD_ACTION_APPROACH;
  legal.actions[3].target_room = RUBY2_ROOM_HALLWAY;
  legal.actions[3].target_character = RUBY2_CHARACTER_NOOR;
  legal.actions[3].target_item = RUBY2_WORLD_ITEM_NOTEBOOK;
  legal.actions[3].discipline = RUBY2_DISCIPLINE_SIGNAL;
  legal.actions[3].virtue = RUBY2_VIRTUE_HONOR;
  legal.actions[3].label = "approach signal";

  world.recent_action_count = 2;
  record_recent_action(&world, 0, RUBY2_ACTION_CHAT_ROOM, RUBY2_ROOM_HALLWAY);
  record_recent_action(&world, 1, RUBY2_ACTION_APPROACH_SIGNAL, RUBY2_ROOM_HALLWAY);

  EXPECT_TRUE(ruby2_ranker_rank_world_actions(&world, &legal, &ranked, &result));
  EXPECT_TRUE(ranked.count == legal.count);
  EXPECT_TRUE(ranked.actions[0].id != RUBY2_ACTION_CHAT_ROOM);
  EXPECT_TRUE(ranked.actions[0].id != RUBY2_ACTION_APPROACH_SIGNAL);
}

static void test_ranker_recent_history_resets_on_room_transition(void) {
  Ruby2World world;
  Ruby2WorldActionList legal;
  Ruby2WorldActionList ranked;
  Ruby2RankerResult result;

  ruby2_world_init(&world);
  choose_default_avatar(&world);

  world.recent_action_count = 1;
  record_recent_action(&world, 0, RUBY2_ACTION_APPROACH_SIGNAL, RUBY2_ROOM_HOMEROOM);

  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_GO_HOMEROOM));
  EXPECT_TRUE(world.game.current_room_id == RUBY2_ROOM_HOMEROOM);

  memset(&legal, 0, sizeof(legal));
  legal.count = 2;

  legal.actions[0].id = RUBY2_ACTION_APPROACH_SIGNAL;
  legal.actions[0].kind = RUBY2_WORLD_ACTION_APPROACH;
  legal.actions[0].target_room = RUBY2_ROOM_HOMEROOM;
  legal.actions[0].target_character = RUBY2_CHARACTER_NOOR;
  legal.actions[0].target_item = RUBY2_WORLD_ITEM_NOTEBOOK;
  legal.actions[0].discipline = RUBY2_DISCIPLINE_SIGNAL;
  legal.actions[0].virtue = RUBY2_VIRTUE_HONOR;
  legal.actions[0].label = "revisit approach";

  legal.actions[1].id = RUBY2_ACTION_GO_CAFETERIA;
  legal.actions[1].kind = RUBY2_WORLD_ACTION_GO;
  legal.actions[1].target_room = RUBY2_ROOM_CAFETERIA;
  legal.actions[1].target_character = RUBY2_CHARACTER_NONE;
  legal.actions[1].target_item = RUBY2_WORLD_ITEM_NOTEBOOK;
  legal.actions[1].discipline = RUBY2_DISCIPLINE_SOURCE;
  legal.actions[1].virtue = RUBY2_VIRTUE_HEAD;
  legal.actions[1].label = "go cafeteria";

  EXPECT_TRUE(ruby2_ranker_rank_world_actions(&world, &legal, &ranked, &result));
  EXPECT_TRUE(ranked.count == legal.count);
  EXPECT_TRUE(ranked.actions[0].id == RUBY2_ACTION_APPROACH_SIGNAL);
}

static void test_agent_intent_ranking_uses_only_legal_candidates(void) {
  Ruby2World world;
  Ruby2AgentCandidateList legal;
  Ruby2AgentCandidateList ranked;
  Ruby2RankerResult result;

  ruby2_world_init(&world);
  choose_default_avatar(&world);
  advance_to_lunch_with(&world, RUBY2_ACTION_APPROACH_SIGNAL);
  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_GO_HALLWAY));
  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_GO_CAFETERIA));

  ruby2_world_query_agent_intents(&world, &legal);
  EXPECT_TRUE(legal.count >= 2);
  EXPECT_TRUE(ruby2_ranker_rank_agent_intents(&world, &legal, &ranked, &result));
  EXPECT_EQ_INT(ranked.count, legal.count);
  EXPECT_EQ_INT(result.count, legal.count);
  EXPECT_EQ_INT(ranked.candidates[0].agenda_id, RUBY2_AGENT_AGENDA_NOOR_LUNCH_LINE);
}

static void test_world_state_hash_is_stable_and_state_sensitive(void) {
  Ruby2World left;
  Ruby2World right;
  uint64_t initial_hash;

  ruby2_world_init(&left);
  ruby2_world_init(&right);
  initial_hash = ruby2_ranker_world_state_hash(&left);

  EXPECT_TRUE(initial_hash != 0u);
  EXPECT_TRUE(initial_hash == ruby2_ranker_world_state_hash(&right));
  EXPECT_TRUE(ruby2_world_apply_action(&right, RUBY2_ACTION_COLLECT_NOTEBOOK));
  EXPECT_TRUE(initial_hash != ruby2_ranker_world_state_hash(&right));
}

static void test_trace_rejects_inconsistent_selection(void) {
  Ruby2RankerModel model;
  Ruby2RankerCandidate candidates[2];
  Ruby2RankerResult result;
  FILE* fp;

  ruby2_ranker_model_init(&model);
  ruby2_ranker_candidate_init(&candidates[0], 10, RUBY2_RANKER_DOMAIN_LLM_PREGEN);
  ruby2_ranker_candidate_init(&candidates[1], 20, RUBY2_RANKER_DOMAIN_LLM_PREGEN);
  candidates[1].features[RUBY2_RANKER_F_AUTHORED_PRIORITY] = 1.0f;

  EXPECT_TRUE(ruby2_ranker_rank_candidates(&model, candidates, 2, &result));
  fp = tmpfile();
  EXPECT_TRUE(fp != NULL);
  if (fp) {
    EXPECT_FALSE(ruby2_ranker_trace_write_jsonl(fp, "ranker-test", 1, candidates, &result, 0, -1));
    EXPECT_TRUE(ruby2_ranker_trace_write_jsonl(fp, "ranker-test", 1, candidates, &result, result.ranked_indices[0], -1));
    fclose(fp);
  }
}

int main(void) {
  test_ranker_orders_only_legal_candidates();
  test_ranker_tie_breaks_by_candidate_id();
  test_world_action_ranking_preserves_candidate_set();
  test_ranker_prefers_collecting_first_real_item();
  test_ranker_avoids_repeating_last_action_as_top_choice();
  test_ranker_avoids_recent_repeats_over_top_slots();
  test_ranker_recent_history_resets_on_room_transition();
  test_agent_intent_ranking_uses_only_legal_candidates();
  test_world_state_hash_is_stable_and_state_sensitive();
  test_trace_rejects_inconsistent_selection();

  if (failures != 0) {
    fprintf(stderr, "%d ranker test failure(s)\n", failures);
    return 1;
  }

  puts("ruby2 ranker tests passed");
  return 0;
}
