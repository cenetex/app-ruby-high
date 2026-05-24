#include "ruby2_world.h"
#include "ruby2_world_performance.h"

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

static bool has_action(const Ruby2WorldActionList* actions, Ruby2WorldActionId action_id) {
  for (uint8_t i = 0; i < actions->count; ++i) {
    if (actions->actions[i].id == action_id) return true;
  }
  return false;
}

static bool has_candidate(const Ruby2State* state, uint16_t candidate_id) {
  if (!state) return false;
  for (uint8_t i = 0; i < state->yearbook_candidate_count; ++i) {
    if (state->yearbook_candidates[i].id == candidate_id) return true;
  }
  return false;
}

static bool pop_kind(Ruby2World* world, Ruby2WorldEventKind kind) {
  Ruby2WorldEvent event;
  while (ruby2_world_pop_event(world, &event)) {
    if (event.kind == kind) return true;
  }
  return false;
}

static bool has_agent_candidate(const Ruby2AgentCandidateList* candidates, Ruby2AgentAgendaId agenda_id) {
  if (!candidates) return false;
  for (uint8_t i = 0; i < candidates->count; ++i) {
    if (candidates->candidates[i].agenda_id == agenda_id) return true;
  }
  return false;
}

static bool perception_has_object(const Ruby2AgentPerception* perception, Ruby2WorldObjectId object_id) {
  if (!perception) return false;
  for (uint8_t i = 0; i < perception->visible_object_count; ++i) {
    if (perception->visible_objects[i] == object_id) return true;
  }
  return false;
}

static void choose_default_avatar(Ruby2World* world) {
  EXPECT_TRUE(ruby2_world_apply_action(world, RUBY2_ACTION_SELECT_AVATAR_SOURCE));
  ruby2_world_clear_events(world);
}

static void test_profile_selection_gates_first_player_actions(void) {
  Ruby2World world;
  Ruby2WorldActionList actions;
  ruby2_world_init(&world);
  ruby2_world_clear_events(&world);

  ruby2_world_query_actions(&world, &actions);
  EXPECT_EQ_INT(actions.count, 4);
  EXPECT_TRUE(has_action(&actions, RUBY2_ACTION_SELECT_AVATAR_SOURCE));
  EXPECT_TRUE(has_action(&actions, RUBY2_ACTION_SELECT_AVATAR_SENSE));
  EXPECT_TRUE(has_action(&actions, RUBY2_ACTION_SELECT_AVATAR_SIGNAL));
  EXPECT_TRUE(has_action(&actions, RUBY2_ACTION_SELECT_AVATAR_SYNC));
  EXPECT_TRUE(!ruby2_world_apply_action(&world, RUBY2_ACTION_GO_HOMEROOM));
  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_SELECT_AVATAR_SIGNAL));
  EXPECT_TRUE(world.player_profile_ready);
  EXPECT_EQ_INT(world.player_avatar, RUBY2_PLAYER_AVATAR_SIGNAL);
}

static void test_world_flow_to_lunch(void) {
  Ruby2World world;
  Ruby2WorldActionList actions;
  ruby2_world_init(&world);
  ruby2_world_clear_events(&world);
  choose_default_avatar(&world);

  EXPECT_EQ_INT(world.game.current_room_id, RUBY2_ROOM_HALLWAY);
  ruby2_world_query_actions(&world, &actions);
  EXPECT_TRUE(has_action(&actions, RUBY2_ACTION_GO_HOMEROOM));
  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_GO_HOMEROOM));
  EXPECT_EQ_INT(world.game.current_room_id, RUBY2_ROOM_HOMEROOM);
  EXPECT_TRUE(ruby2_world_character_present(&world, RUBY2_CHARACTER_RUBY, RUBY2_ROOM_HOMEROOM));
  EXPECT_TRUE(ruby2_world_object_present(&world, RUBY2_WORLD_OBJECT_ANSWER_CARD, RUBY2_ROOM_HOMEROOM));

  ruby2_world_query_actions(&world, &actions);
  EXPECT_TRUE(has_action(&actions, RUBY2_ACTION_ATTEND_HOMEROOM));
  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_ATTEND_HOMEROOM));

  ruby2_world_query_actions(&world, &actions);
  EXPECT_TRUE(has_action(&actions, RUBY2_ACTION_APPROACH_SIGNAL));
  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_APPROACH_SIGNAL));
  EXPECT_TRUE(world.homeroom_resolved);
  EXPECT_TRUE(world.lunch_started);
  EXPECT_EQ_INT(world.game.current_time_block, RUBY2_TIME_LUNCH);
  EXPECT_TRUE(ruby2_world_character_present(&world, RUBY2_CHARACTER_NOOR, RUBY2_ROOM_CAFETERIA));
  EXPECT_TRUE(ruby2_world_object_present(&world, RUBY2_WORLD_OBJECT_RECEIPT, RUBY2_ROOM_CAFETERIA));
  EXPECT_TRUE(pop_kind(&world, RUBY2_EVENT_TIME_ADVANCED));
}

static void test_cafeteria_trigger_and_receipt(void) {
  Ruby2World world;
  Ruby2WorldActionList actions;
  ruby2_world_init(&world);
  ruby2_world_clear_events(&world);
  choose_default_avatar(&world);

  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_GO_HOMEROOM));
  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_ATTEND_HOMEROOM));
  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_APPROACH_SIGNAL));
  ruby2_world_clear_events(&world);

  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_GO_HALLWAY));
  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_GO_CAFETERIA));
  EXPECT_TRUE(world.cafeteria_social_triggered);
  EXPECT_TRUE(pop_kind(&world, RUBY2_EVENT_SOCIAL_TRIGGERED));

  ruby2_world_query_actions(&world, &actions);
  EXPECT_TRUE(has_action(&actions, RUBY2_ACTION_INSPECT_RECEIPT));
  EXPECT_TRUE(has_action(&actions, RUBY2_ACTION_CHAT_ROOM));
  EXPECT_TRUE(!has_action(&actions, RUBY2_ACTION_TALK_NOOR));
  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_INSPECT_RECEIPT));
  EXPECT_TRUE(world.receipt_inspected);
  EXPECT_TRUE(world.chat_active);
  EXPECT_EQ_INT(world.chat_character, RUBY2_CHARACTER_NOOR);
  EXPECT_EQ_INT(world.game.clocks[RUBY2_CLOCK_NULL_SIGNAL].value, 2);
  EXPECT_TRUE(world.game.discipline_counts[RUBY2_DISCIPLINE_SIGNAL] >= 2);
  EXPECT_TRUE(has_candidate(&world.game, 7001));
}

static void test_approach_changes_lunch_cast(void) {
  Ruby2World world;

  ruby2_world_init(&world);
  ruby2_world_clear_events(&world);
  choose_default_avatar(&world);
  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_GO_HOMEROOM));
  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_ATTEND_HOMEROOM));
  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_APPROACH_SOURCE));
  EXPECT_TRUE(ruby2_world_character_present(&world, RUBY2_CHARACTER_RAVI, RUBY2_ROOM_CAFETERIA));

  ruby2_world_init(&world);
  ruby2_world_clear_events(&world);
  choose_default_avatar(&world);
  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_GO_HOMEROOM));
  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_ATTEND_HOMEROOM));
  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_APPROACH_SENSE));
  EXPECT_TRUE(ruby2_world_character_present(&world, RUBY2_CHARACTER_INDRA, RUBY2_ROOM_CAFETERIA));

  ruby2_world_init(&world);
  ruby2_world_clear_events(&world);
  choose_default_avatar(&world);
  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_GO_HOMEROOM));
  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_ATTEND_HOMEROOM));
  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_APPROACH_SYNC));
  EXPECT_TRUE(ruby2_world_character_present(&world, RUBY2_CHARACTER_MIKA, RUBY2_ROOM_CAFETERIA));
}

static void test_room_quiz_sessions_present_four_approaches(void) {
  Ruby2World world;
  Ruby2WorldActionList actions;
  ruby2_world_init(&world);
  ruby2_world_clear_events(&world);
  choose_default_avatar(&world);

  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_GO_HOMEROOM));
  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_ATTEND_HOMEROOM));
  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_APPROACH_SOURCE));
  EXPECT_TRUE(world.lunch_started);

  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_GO_HALLWAY));
  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_GO_SCIENCE_LAB));
  ruby2_world_query_actions(&world, &actions);
  EXPECT_TRUE(has_action(&actions, RUBY2_ACTION_APPROACH_SOURCE));
  EXPECT_TRUE(has_action(&actions, RUBY2_ACTION_APPROACH_SENSE));
  EXPECT_TRUE(has_action(&actions, RUBY2_ACTION_APPROACH_SYNC));
  EXPECT_TRUE(has_action(&actions, RUBY2_ACTION_APPROACH_SIGNAL));

  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_APPROACH_SIGNAL));
  EXPECT_TRUE(world.science_lab_quiz_resolved);

  ruby2_world_query_actions(&world, &actions);
  EXPECT_TRUE(!has_action(&actions, RUBY2_ACTION_APPROACH_SOURCE));
  EXPECT_TRUE(!has_action(&actions, RUBY2_ACTION_APPROACH_SENSE));
  EXPECT_TRUE(!has_action(&actions, RUBY2_ACTION_APPROACH_SYNC));
  EXPECT_TRUE(!has_action(&actions, RUBY2_ACTION_APPROACH_SIGNAL));

  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_GO_HALLWAY));
  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_GO_LIBRARY));
  ruby2_world_query_actions(&world, &actions);
  EXPECT_TRUE(has_action(&actions, RUBY2_ACTION_APPROACH_SOURCE));
  EXPECT_TRUE(has_action(&actions, RUBY2_ACTION_APPROACH_SENSE));
  EXPECT_TRUE(has_action(&actions, RUBY2_ACTION_APPROACH_SYNC));
  EXPECT_TRUE(has_action(&actions, RUBY2_ACTION_APPROACH_SIGNAL));
  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_APPROACH_SENSE));
  EXPECT_TRUE(world.library_quiz_resolved);
}

static void test_rejected_player_action_does_not_advance_time(void) {
  Ruby2World world;
  ruby2_world_init(&world);
  ruby2_world_clear_events(&world);
  choose_default_avatar(&world);

  uint32_t tick_before = world.tick;
  uint32_t event_cursor_before = world.game.event_cursor;
  EXPECT_TRUE(!ruby2_world_apply_action(&world, RUBY2_ACTION_INSPECT_RECEIPT));
  EXPECT_EQ_INT(world.tick, tick_before);
  EXPECT_EQ_INT(world.game.event_cursor, event_cursor_before);
  EXPECT_EQ_INT(world.game.current_room_id, RUBY2_ROOM_HALLWAY);
}

static void test_command_path_applies_query_action(void) {
  Ruby2World world;
  Ruby2WorldActionList actions;
  Ruby2WorldCommand command;
  ruby2_world_init(&world);
  ruby2_world_clear_events(&world);
  choose_default_avatar(&world);

  ruby2_world_query_actions(&world, &actions);
  EXPECT_TRUE(has_action(&actions, RUBY2_ACTION_GO_HOMEROOM));
  EXPECT_TRUE(ruby2_world_command_from_action(RUBY2_ACTION_GO_HOMEROOM, &command));
  EXPECT_EQ_INT(command.kind, RUBY2_WORLD_ACTION_GO);
  EXPECT_EQ_INT(command.target_room, RUBY2_ROOM_HOMEROOM);
  EXPECT_TRUE(ruby2_world_apply_command(&world, &command));
  EXPECT_EQ_INT(world.game.current_room_id, RUBY2_ROOM_HOMEROOM);
}

static void test_collecting_items_fills_empty_slots(void) {
  Ruby2World world;
  Ruby2WorldActionList actions;
  ruby2_world_init(&world);
  ruby2_world_clear_events(&world);
  choose_default_avatar(&world);

  EXPECT_TRUE(!world.game.items[RUBY2_ITEM_NOTEBOOK].owned);
  ruby2_world_query_actions(&world, &actions);
  EXPECT_TRUE(has_action(&actions, RUBY2_ACTION_COLLECT_NOTEBOOK));
  EXPECT_TRUE(!has_action(&actions, RUBY2_ACTION_CHECK_NOTEBOOK));
  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_COLLECT_NOTEBOOK));
  EXPECT_TRUE(world.game.items[RUBY2_ITEM_NOTEBOOK].owned);
  EXPECT_TRUE(world.game.items[RUBY2_ITEM_NOTEBOOK].carried);
  EXPECT_EQ_INT(world.game.items[RUBY2_ITEM_NOTEBOOK].charges, -1);
  EXPECT_TRUE(!ruby2_world_object_present(&world, RUBY2_WORLD_OBJECT_NOTEBOOK, RUBY2_ROOM_HALLWAY));
  EXPECT_TRUE(pop_kind(&world, RUBY2_EVENT_ITEM_COLLECTED));

  ruby2_world_query_actions(&world, &actions);
  EXPECT_TRUE(has_action(&actions, RUBY2_ACTION_CHECK_NOTEBOOK));
}

static void test_initial_hallway_exposes_full_campus(void) {
  Ruby2World world;
  Ruby2WorldActionList actions;
  ruby2_world_init(&world);
  ruby2_world_clear_events(&world);
  choose_default_avatar(&world);

  ruby2_world_query_actions(&world, &actions);
  EXPECT_TRUE(has_action(&actions, RUBY2_ACTION_GO_HOMEROOM));
  EXPECT_TRUE(has_action(&actions, RUBY2_ACTION_GO_SCIENCE_LAB));
  EXPECT_TRUE(has_action(&actions, RUBY2_ACTION_GO_LIBRARY));
  EXPECT_TRUE(has_action(&actions, RUBY2_ACTION_GO_CAFETERIA));
  EXPECT_TRUE(has_action(&actions, RUBY2_ACTION_GO_GREENHOUSE));
  EXPECT_TRUE(has_action(&actions, RUBY2_ACTION_GO_COURTYARD));
  EXPECT_TRUE(has_action(&actions, RUBY2_ACTION_GO_TEACHER_OFFICE));
}

static void test_homeroom_flashcards_are_collectable(void) {
  Ruby2World world;
  Ruby2WorldActionList actions;
  ruby2_world_init(&world);
  ruby2_world_clear_events(&world);
  choose_default_avatar(&world);

  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_GO_HOMEROOM));
  ruby2_world_query_actions(&world, &actions);
  EXPECT_TRUE(has_action(&actions, RUBY2_ACTION_COLLECT_FLASHCARDS));
  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_COLLECT_FLASHCARDS));
  EXPECT_TRUE(world.game.items[RUBY2_ITEM_FLASHCARDS].owned);
  EXPECT_EQ_INT(world.game.items[RUBY2_ITEM_FLASHCARDS].charges, 2);
}

static void test_room_items_are_collectable(void) {
  Ruby2World world;
  Ruby2WorldActionList actions;

  ruby2_world_init(&world);
  ruby2_world_clear_events(&world);
  choose_default_avatar(&world);
  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_GO_LIBRARY));
  ruby2_world_query_actions(&world, &actions);
  EXPECT_TRUE(has_action(&actions, RUBY2_ACTION_COLLECT_LIBRARY_CARD));
  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_COLLECT_LIBRARY_CARD));
  EXPECT_TRUE(world.game.items[RUBY2_ITEM_LIBRARY_CARD].owned);

  ruby2_world_init(&world);
  ruby2_world_clear_events(&world);
  choose_default_avatar(&world);
  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_GO_SCIENCE_LAB));
  ruby2_world_query_actions(&world, &actions);
  EXPECT_TRUE(has_action(&actions, RUBY2_ACTION_COLLECT_LAB_FLASK));
  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_COLLECT_LAB_FLASK));
  EXPECT_TRUE(world.game.items[RUBY2_ITEM_LAB_FLASK].owned);

  ruby2_world_init(&world);
  ruby2_world_clear_events(&world);
  choose_default_avatar(&world);
  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_GO_TEACHER_OFFICE));
  ruby2_world_query_actions(&world, &actions);
  EXPECT_TRUE(has_action(&actions, RUBY2_ACTION_COLLECT_OFFICE_PASS));
  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_COLLECT_OFFICE_PASS));
  EXPECT_TRUE(world.game.items[RUBY2_ITEM_OFFICE_PASS].owned);
}

static void test_talk_opens_two_option_chat_branch(void) {
  Ruby2World world;
  Ruby2WorldActionList actions;
  ruby2_world_init(&world);
  ruby2_world_clear_events(&world);
  choose_default_avatar(&world);

  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_GO_SCIENCE_LAB));
  ruby2_world_query_actions(&world, &actions);
  EXPECT_TRUE(has_action(&actions, RUBY2_ACTION_CHAT_ROOM));
  EXPECT_TRUE(!has_action(&actions, RUBY2_ACTION_TALK_MIKA));
  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_CHAT_ROOM));
  EXPECT_TRUE(world.chat_active);
  EXPECT_TRUE(world.chat_room_mode);
  EXPECT_EQ_INT(world.chat_character, RUBY2_CHARACTER_MIKA);

  ruby2_world_query_actions(&world, &actions);
  EXPECT_EQ_INT(actions.count, 2);
  EXPECT_TRUE(has_action(&actions, RUBY2_ACTION_CHAT_OPTION_A));
  EXPECT_TRUE(has_action(&actions, RUBY2_ACTION_CHAT_OPTION_B));
  EXPECT_TRUE(actions.actions[0].label != NULL);
  EXPECT_TRUE(actions.actions[1].label != NULL);

  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_CHAT_OPTION_A));
  EXPECT_TRUE(!world.chat_active);
  EXPECT_TRUE(world.game.affinity[RUBY2_CHARACTER_MIKA] >= 1);
  EXPECT_TRUE(world.game.discipline_counts[RUBY2_DISCIPLINE_SOURCE] >= 1);

  ruby2_world_query_actions(&world, &actions);
  EXPECT_TRUE(!has_action(&actions, RUBY2_ACTION_CHAT_ROOM));

  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_GO_HALLWAY));
  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_GO_SCIENCE_LAB));
  ruby2_world_query_actions(&world, &actions);
  EXPECT_TRUE(!has_action(&actions, RUBY2_ACTION_CHAT_ROOM));
}

static void test_bell_pressure_redirects_skip_to_homeroom(void) {
  Ruby2World world;
  ruby2_world_init(&world);
  ruby2_world_clear_events(&world);
  choose_default_avatar(&world);

  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_GO_CAFETERIA));
  EXPECT_EQ_INT(world.game.current_room_id, RUBY2_ROOM_CAFETERIA);
  EXPECT_EQ_INT(world.game.clocks[RUBY2_CLOCK_BELL].value, 1);
  EXPECT_TRUE(pop_kind(&world, RUBY2_EVENT_DIRECTOR_TRIGGERED));

  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_WAIT_BELL));
  EXPECT_EQ_INT(world.game.clocks[RUBY2_CLOCK_BELL].value, 2);
  EXPECT_EQ_INT(world.game.current_room_id, RUBY2_ROOM_CAFETERIA);
  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_WAIT_BELL));
  EXPECT_EQ_INT(world.game.clocks[RUBY2_CLOCK_BELL].value, 3);
  EXPECT_EQ_INT(world.game.current_room_id, RUBY2_ROOM_CAFETERIA);
  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_WAIT_BELL));
  EXPECT_EQ_INT(world.game.current_room_id, RUBY2_ROOM_HOMEROOM);
  EXPECT_EQ_INT(world.game.clocks[RUBY2_CLOCK_BELL].value, 4);
  EXPECT_TRUE(world.game.clocks[RUBY2_CLOCK_STRESS].value >= 1);
  EXPECT_TRUE(pop_kind(&world, RUBY2_EVENT_DIRECTOR_TRIGGERED));
}

static void test_agent_intents_are_validated(void) {
  Ruby2World world;
  Ruby2AgentIntent intent;
  Ruby2WorldEvent event;
  ruby2_world_init(&world);
  ruby2_world_clear_events(&world);
  choose_default_avatar(&world);

  intent.kind = RUBY2_AGENT_REQUEST_SPEAK;
  intent.character = RUBY2_CHARACTER_RUBY;
  intent.target_room = RUBY2_ROOM_HALLWAY;
  intent.target_object = RUBY2_WORLD_OBJECT_NOTEBOOK;
  intent.text = "Ruby should not be audible from Homeroom.";
  EXPECT_EQ_INT(ruby2_world_submit_agent_intent(&world, &intent), RUBY2_AGENT_INTENT_REJECTED_NOT_COPRESENT);
  EXPECT_TRUE(ruby2_world_pop_event(&world, &event));
  EXPECT_EQ_INT(event.kind, RUBY2_EVENT_AGENT_INTENT_REJECTED);
  EXPECT_TRUE(!ruby2_world_event_visible_to_player(&event));

  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_GO_HOMEROOM));
  ruby2_world_clear_events(&world);
  intent.text = "First bell is always loudest up close.";
  EXPECT_EQ_INT(ruby2_world_submit_agent_intent(&world, &intent), RUBY2_AGENT_INTENT_ACCEPTED);
  EXPECT_TRUE(pop_kind(&world, RUBY2_EVENT_AGENT_SPOKE));

  intent.kind = RUBY2_AGENT_REQUEST_MOVE;
  intent.character = RUBY2_CHARACTER_RUBY;
  intent.target_room = RUBY2_ROOM_CAFETERIA;
  intent.target_object = RUBY2_WORLD_OBJECT_NOTEBOOK;
  intent.text = "Ruby tries to skip the hallway.";
  EXPECT_EQ_INT(ruby2_world_submit_agent_intent(&world, &intent), RUBY2_AGENT_INTENT_REJECTED_BLOCKED_ROUTE);
  EXPECT_TRUE(pop_kind(&world, RUBY2_EVENT_AGENT_INTENT_REJECTED));

  intent.target_room = RUBY2_ROOM_HALLWAY;
  intent.text = "Ruby steps into the Hallway.";
  EXPECT_EQ_INT(ruby2_world_submit_agent_intent(&world, &intent), RUBY2_AGENT_INTENT_ACCEPTED);
  EXPECT_TRUE(ruby2_world_character_present(&world, RUBY2_CHARACTER_RUBY, RUBY2_ROOM_HALLWAY));
  EXPECT_TRUE(pop_kind(&world, RUBY2_EVENT_NPC_MOVED));
}

static void test_agent_inspect_and_remember(void) {
  Ruby2World world;
  Ruby2AgentIntent intent;
  ruby2_world_init(&world);
  ruby2_world_clear_events(&world);
  choose_default_avatar(&world);

  intent.kind = RUBY2_AGENT_INSPECT_OBJECT;
  intent.character = RUBY2_CHARACTER_NOOR;
  intent.target_room = RUBY2_ROOM_CAFETERIA;
  intent.target_object = RUBY2_WORLD_OBJECT_RECEIPT;
  intent.text = "Noor checks for the receipt too early.";
  EXPECT_EQ_INT(ruby2_world_submit_agent_intent(&world, &intent), RUBY2_AGENT_INTENT_REJECTED_OBJECT_ABSENT);
  EXPECT_TRUE(pop_kind(&world, RUBY2_EVENT_AGENT_INTENT_REJECTED));

  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_GO_HOMEROOM));
  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_ATTEND_HOMEROOM));
  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_APPROACH_SIGNAL));
  ruby2_world_clear_events(&world);

  intent.text = "Noor checks the zero-dollar receipt before anyone calls it normal.";
  EXPECT_EQ_INT(ruby2_world_submit_agent_intent(&world, &intent), RUBY2_AGENT_INTENT_ACCEPTED);
  EXPECT_TRUE(pop_kind(&world, RUBY2_EVENT_OBJECT_INSPECTED));

  intent.kind = RUBY2_AGENT_REMEMBER_EVENT;
  intent.character = RUBY2_CHARACTER_NOOR;
  intent.target_object = RUBY2_WORLD_OBJECT_NOTEBOOK;
  intent.text = "Noor remembers that the receipt repeated Homeroom's footer.";
  EXPECT_EQ_INT(ruby2_world_submit_agent_intent(&world, &intent), RUBY2_AGENT_INTENT_ACCEPTED);
  EXPECT_TRUE(pop_kind(&world, RUBY2_EVENT_AGENT_REMEMBERED));
}

static void test_world_agent_step_uses_valid_intents(void) {
  Ruby2World world;
  ruby2_world_init(&world);
  ruby2_world_clear_events(&world);
  choose_default_avatar(&world);

  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_GO_HOMEROOM));
  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_ATTEND_HOMEROOM));
  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_APPROACH_SIGNAL));
  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_GO_HALLWAY));
  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_GO_CAFETERIA));
  ruby2_world_clear_events(&world);

  ruby2_world_step_agents(&world);
  EXPECT_TRUE(world.agent_agenda_done[RUBY2_AGENT_AGENDA_NOOR_RECEIPT_LINE]);
  EXPECT_TRUE(pop_kind(&world, RUBY2_EVENT_AGENT_SPOKE));

  ruby2_world_step_agents(&world);
  EXPECT_TRUE(world.agent_agenda_done[RUBY2_AGENT_AGENDA_LYRA_RECEIPT_CHECK]);
  EXPECT_TRUE(pop_kind(&world, RUBY2_EVENT_AGENT_SPOKE));

  ruby2_world_step_agents(&world);
  EXPECT_TRUE(!pop_kind(&world, RUBY2_EVENT_AGENT_SPOKE));

  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_INSPECT_RECEIPT));
  ruby2_world_clear_events(&world);
  ruby2_world_step_agents(&world);
  EXPECT_TRUE(world.agent_agenda_done[RUBY2_AGENT_AGENDA_NOOR_RECEIPT_MEMORY]);
  EXPECT_TRUE(pop_kind(&world, RUBY2_EVENT_AGENT_REMEMBERED));
}

static void test_agent_perception_is_local_to_actor_room(void) {
  Ruby2World world;
  Ruby2AgentPerception perception;
  ruby2_world_init(&world);
  ruby2_world_clear_events(&world);

  EXPECT_TRUE(ruby2_world_build_agent_perception(&world, RUBY2_CHARACTER_RUBY, &perception));
  EXPECT_EQ_INT(perception.character, RUBY2_CHARACTER_RUBY);
  EXPECT_EQ_INT(perception.actor_room, RUBY2_ROOM_HOMEROOM);
  EXPECT_EQ_INT(perception.player_room, RUBY2_ROOM_HALLWAY);
  EXPECT_TRUE(!perception.co_present_with_player);
  EXPECT_TRUE(perception_has_object(&perception, RUBY2_WORLD_OBJECT_ANSWER_CARD));
  EXPECT_TRUE(perception_has_object(&perception, RUBY2_WORLD_OBJECT_WORK_ORDER));
  EXPECT_TRUE(!perception_has_object(&perception, RUBY2_WORLD_OBJECT_NOTEBOOK));
}

static void test_agent_intent_query_exposes_local_hallway_beat(void) {
  Ruby2World world;
  Ruby2AgentCandidateList candidates;
  ruby2_world_init(&world);
  ruby2_world_clear_events(&world);
  choose_default_avatar(&world);

  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_GO_HOMEROOM));
  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_ATTEND_HOMEROOM));
  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_APPROACH_SENSE));
  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_GO_HALLWAY));
  ruby2_world_clear_events(&world);

  ruby2_world_query_agent_intents(&world, &candidates);
  EXPECT_TRUE(has_agent_candidate(&candidates, RUBY2_AGENT_AGENDA_RAVI_HALLWAY_FACT));
  EXPECT_TRUE(!has_agent_candidate(&candidates, RUBY2_AGENT_AGENDA_NOOR_RECEIPT_LINE));
}

static void test_world_event_performance_bridge(void) {
  Ruby2World world;
  Ruby2WorldEvent event;
  Ruby2PerformanceRequest request;
  ruby2_world_init(&world);
  ruby2_world_clear_events(&world);
  choose_default_avatar(&world);

  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_GO_HOMEROOM));
  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_ATTEND_HOMEROOM));
  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_APPROACH_SIGNAL));
  EXPECT_TRUE(pop_kind(&world, RUBY2_EVENT_ROOM_ENTERED));
  EXPECT_TRUE(pop_kind(&world, RUBY2_EVENT_CLASS_STARTED));
  EXPECT_TRUE(ruby2_world_pop_event(&world, &event));
  EXPECT_EQ_INT(event.kind, RUBY2_EVENT_APPROACH_RESOLVED);
  EXPECT_TRUE(ruby2_world_event_to_performance_request(&world, &event, &request));
  EXPECT_EQ_INT(request.speaker, RUBY2_CHARACTER_RUBY);
  EXPECT_EQ_INT(request.discipline, RUBY2_DISCIPLINE_SIGNAL);
  EXPECT_EQ_INT(request.virtue, RUBY2_VIRTUE_HONOR);
}

static void test_talk_event_performance_uses_speaker_context(void) {
  Ruby2World world;
  Ruby2WorldEvent event;
  Ruby2PerformanceRequest request;
  ruby2_world_init(&world);
  ruby2_world_clear_events(&world);
  choose_default_avatar(&world);

  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_GO_HOMEROOM));
  ruby2_world_clear_events(&world);
  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_TALK_RAVI));

  EXPECT_TRUE(ruby2_world_pop_event(&world, &event));
  EXPECT_EQ_INT(event.kind, RUBY2_EVENT_SOCIAL_TRIGGERED);
  EXPECT_TRUE(ruby2_world_event_to_performance_request(&world, &event, &request));
  EXPECT_EQ_INT(request.speaker, RUBY2_CHARACTER_RAVI);
  EXPECT_TRUE(request.fallback != NULL);
  EXPECT_TRUE(strstr(request.fallback, "stamp") != NULL);
}

int main(void) {
  test_profile_selection_gates_first_player_actions();
  test_world_flow_to_lunch();
  test_cafeteria_trigger_and_receipt();
  test_approach_changes_lunch_cast();
  test_room_quiz_sessions_present_four_approaches();
  test_rejected_player_action_does_not_advance_time();
  test_command_path_applies_query_action();
  test_collecting_items_fills_empty_slots();
  test_initial_hallway_exposes_full_campus();
  test_homeroom_flashcards_are_collectable();
  test_room_items_are_collectable();
  test_talk_opens_two_option_chat_branch();
  test_bell_pressure_redirects_skip_to_homeroom();
  test_agent_intents_are_validated();
  test_agent_inspect_and_remember();
  test_world_agent_step_uses_valid_intents();
  test_agent_perception_is_local_to_actor_room();
  test_agent_intent_query_exposes_local_hallway_beat();
  test_world_event_performance_bridge();
  test_talk_event_performance_uses_speaker_context();

  if (failures != 0) {
    fprintf(stderr, "%d world test failure(s)\n", failures);
    return 1;
  }

  puts("ruby2 world tests passed");
  return 0;
}
