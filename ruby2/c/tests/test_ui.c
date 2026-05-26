#include "ruby2_ui.h"

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

static bool snapshot_has_action(const Ruby2UiSnapshot* snapshot, Ruby2WorldActionId action_id) {
  if (!snapshot) return false;
  for (uint8_t i = 0; i < snapshot->action_count; ++i) {
    if (snapshot->actions[i].id == action_id) return true;
  }
  return false;
}

static bool snapshot_has_person(const Ruby2UiSnapshot* snapshot, Ruby2CharacterId character_id) {
  if (!snapshot) return false;
  for (uint8_t i = 0; i < snapshot->people_count; ++i) {
    if (snapshot->people[i] == character_id) return true;
  }
  return false;
}

static bool snapshot_has_local_item(const Ruby2UiSnapshot* snapshot, Ruby2WorldItemId world_item_id) {
  if (!snapshot) return false;
  for (uint8_t i = 0; i < snapshot->local_item_count; ++i) {
    if (snapshot->local_items[i] == world_item_id) return true;
  }
  return false;
}

static bool snapshot_has_item(const Ruby2UiSnapshot* snapshot, Ruby2ItemId item_id) {
  if (!snapshot) return false;
  for (uint8_t i = 0; i < snapshot->item_slot_count; ++i) {
    if (snapshot->item_slots[i].occupied && snapshot->item_slots[i].item == item_id) return true;
  }
  return false;
}

static int action_slot_index(const Ruby2UiSnapshot* snapshot, Ruby2WorldActionId action_id) {
  if (!snapshot) return -1;
  for (uint8_t i = 0; i < snapshot->presentation.action_tray.slot_count; ++i) {
    if (snapshot->presentation.action_tray.slots[i].action == action_id) return (int)i;
  }
  return -1;
}

static int navigation_slot_index(const Ruby2UiSnapshot* snapshot, Ruby2WorldActionId action_id) {
  if (!snapshot) return -1;
  for (uint8_t i = 0; i < snapshot->presentation.navigation.slot_count; ++i) {
    if (snapshot->presentation.navigation.slots[i].action == action_id) return (int)i;
  }
  return -1;
}

static const char* navigation_key_for_action(const Ruby2UiSnapshot* snapshot, Ruby2WorldActionId action_id) {
  int index = navigation_slot_index(snapshot, action_id);
  return index >= 0 ? snapshot->presentation.navigation.slots[index].key_label : NULL;
}

static bool navigation_key_equals(
  const Ruby2UiSnapshot* snapshot,
  Ruby2WorldActionId action_id,
  const char* expected
) {
  const char* actual = navigation_key_for_action(snapshot, action_id);
  return actual && expected && strcmp(actual, expected) == 0;
}

static void expect_nonempty_player_controls(Ruby2World* world) {
  Ruby2UiSnapshot snapshot;
  ruby2_ui_snapshot_build(world, true, &snapshot);
  EXPECT_TRUE(snapshot.action_count > 0);
  EXPECT_TRUE(snapshot.presentation.action_tray.slot_count > 0 ||
              snapshot.presentation.navigation.slot_count > 0);
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

static void test_initial_snapshot_exposes_world_state(void) {
  Ruby2World world;
  Ruby2UiSnapshot snapshot;

  ruby2_world_init(&world);
  ruby2_ui_snapshot_build(&world, true, &snapshot);

  EXPECT_EQ_INT(snapshot.room, RUBY2_ROOM_HALLWAY);
  EXPECT_EQ_INT(snapshot.time_block, RUBY2_TIME_ARRIVAL);
  EXPECT_TRUE(snapshot.player_profile_ready);
  EXPECT_EQ_INT(snapshot.player_avatar, RUBY2_PLAYER_AVATAR_SOURCE);
  EXPECT_TRUE(snapshot_has_local_item(&snapshot, RUBY2_WORLD_ITEM_NOTEBOOK));
  EXPECT_EQ_INT(snapshot.item_slot_count, RUBY2_ITEM_COUNT);
  EXPECT_TRUE(!snapshot_has_item(&snapshot, RUBY2_ITEM_NOTEBOOK));
  EXPECT_TRUE(!snapshot_has_action(&snapshot, RUBY2_ACTION_SELECT_AVATAR_SOURCE));
  EXPECT_TRUE(!snapshot_has_action(&snapshot, RUBY2_ACTION_SELECT_AVATAR_SENSE));
  EXPECT_TRUE(!snapshot_has_action(&snapshot, RUBY2_ACTION_SELECT_AVATAR_SIGNAL));
  EXPECT_TRUE(!snapshot_has_action(&snapshot, RUBY2_ACTION_SELECT_AVATAR_SYNC));
  EXPECT_TRUE(snapshot_has_action(&snapshot, RUBY2_ACTION_GO_HOMEROOM));
  EXPECT_TRUE(snapshot_has_action(&snapshot, RUBY2_ACTION_COLLECT_NOTEBOOK));
  EXPECT_TRUE(!snapshot_has_action(&snapshot, RUBY2_ACTION_CHECK_NOTEBOOK));
  EXPECT_TRUE(snapshot.action_count > 0);
  EXPECT_TRUE(snapshot.event_count > 0);
  EXPECT_EQ_INT(snapshot.presentation.focus.mode, RUBY2_UI_FOCUS_SPEECH_ONLY);
  EXPECT_TRUE(snapshot.presentation.action_tray.slot_count > 0);
  EXPECT_TRUE(action_slot_index(&snapshot, RUBY2_ACTION_GO_HOMEROOM) < 0);
  EXPECT_TRUE(navigation_slot_index(&snapshot, RUBY2_ACTION_GO_HOMEROOM) >= 0);
  EXPECT_TRUE(snapshot.presentation.navigation.slot_count > 0);
  EXPECT_TRUE(snapshot.presentation.navigation.hint != NULL);
  EXPECT_TRUE(strstr(snapshot.presentation.notebook_line, "Notebook") != NULL);
}

static void test_snapshot_inventory_updates_after_collect(void) {
  Ruby2World world;
  Ruby2UiSnapshot snapshot;

  ruby2_world_init(&world);
  choose_default_avatar(&world);
  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_COLLECT_NOTEBOOK));
  ruby2_ui_snapshot_build(&world, true, &snapshot);

  EXPECT_TRUE(snapshot.player_profile_ready);
  EXPECT_EQ_INT(snapshot.player_avatar, RUBY2_PLAYER_AVATAR_SOURCE);
  EXPECT_TRUE(snapshot_has_item(&snapshot, RUBY2_ITEM_NOTEBOOK));
  EXPECT_TRUE(!snapshot_has_local_item(&snapshot, RUBY2_WORLD_ITEM_NOTEBOOK));
  EXPECT_TRUE(snapshot_has_action(&snapshot, RUBY2_ACTION_CHECK_NOTEBOOK));
  EXPECT_TRUE(snapshot.presentation.notebook_line != NULL);
  EXPECT_TRUE(strstr(snapshot.presentation.notebook_line, "empty") == NULL);
}

static void test_ranked_snapshot_preserves_legal_actions(void) {
  Ruby2World world;
  Ruby2UiSnapshot unranked;
  Ruby2UiSnapshot ranked;
  bool seen[RUBY2_ACTION_COUNT];

  ruby2_world_init(&world);
  choose_default_avatar(&world);
  ruby2_ui_snapshot_build(&world, false, &unranked);
  ruby2_ui_snapshot_build(&world, true, &ranked);

  EXPECT_EQ_INT(ranked.action_count, unranked.action_count);
  memset(seen, 0, sizeof(seen));
  for (uint8_t i = 0; i < unranked.action_count; ++i) {
    seen[unranked.actions[i].id] = true;
  }
  for (uint8_t i = 0; i < ranked.action_count; ++i) {
    EXPECT_TRUE(seen[ranked.actions[i].id]);
    seen[ranked.actions[i].id] = false;
  }
  for (uint8_t i = 0; i < RUBY2_ACTION_COUNT; ++i) {
    EXPECT_TRUE(!seen[i]);
  }
}

static void test_snapshot_tracks_room_avatars_and_items_after_progression(void) {
  Ruby2World world;
  Ruby2UiSnapshot snapshot;

  ruby2_world_init(&world);
  choose_default_avatar(&world);
  advance_to_lunch_with(&world, RUBY2_ACTION_APPROACH_SIGNAL);
  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_GO_HALLWAY));
  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_GO_CAFETERIA));
  ruby2_world_step_agents(&world);
  ruby2_ui_snapshot_build(&world, true, &snapshot);

  EXPECT_EQ_INT(snapshot.room, RUBY2_ROOM_CAFETERIA);
  EXPECT_EQ_INT(snapshot.time_block, RUBY2_TIME_LUNCH);
  EXPECT_TRUE(snapshot_has_person(&snapshot, RUBY2_CHARACTER_LYRA));
  EXPECT_TRUE(snapshot_has_person(&snapshot, RUBY2_CHARACTER_NOOR));
  EXPECT_TRUE(snapshot_has_local_item(&snapshot, RUBY2_WORLD_ITEM_LUNCH_TRAY));
  EXPECT_TRUE(snapshot_has_action(&snapshot, RUBY2_ACTION_COLLECT_LUNCH_TRAY));
  EXPECT_TRUE(navigation_slot_index(&snapshot, RUBY2_ACTION_GO_HALLWAY) >= 0);
  EXPECT_TRUE(action_slot_index(&snapshot, RUBY2_ACTION_GO_HALLWAY) < 0);
  EXPECT_TRUE(snapshot.event_count > 0);
}

static void test_navigation_labels_follow_campus_graph(void) {
  Ruby2World world;
  Ruby2UiSnapshot snapshot;

  ruby2_world_init(&world);
  choose_default_avatar(&world);
  advance_to_lunch_with(&world, RUBY2_ACTION_APPROACH_SOURCE);
  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_GO_HALLWAY));
  ruby2_ui_snapshot_build(&world, true, &snapshot);

  EXPECT_TRUE(navigation_slot_index(&snapshot, RUBY2_ACTION_GO_GREENHOUSE) < 0);
  EXPECT_TRUE(navigation_slot_index(&snapshot, RUBY2_ACTION_GO_COURTYARD) >= 0);
  EXPECT_TRUE(navigation_key_equals(&snapshot, RUBY2_ACTION_GO_COURTYARD, "E"));
  EXPECT_TRUE(navigation_key_equals(&snapshot, RUBY2_ACTION_GO_CAFETERIA, "S"));

  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_GO_COURTYARD));
  ruby2_ui_snapshot_build(&world, true, &snapshot);
  EXPECT_TRUE(navigation_key_equals(&snapshot, RUBY2_ACTION_GO_HALLWAY, "W"));
  EXPECT_TRUE(navigation_key_equals(&snapshot, RUBY2_ACTION_GO_CAFETERIA, "A"));
  EXPECT_TRUE(navigation_key_equals(&snapshot, RUBY2_ACTION_GO_GREENHOUSE, "D"));

  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_GO_GREENHOUSE));
  ruby2_ui_snapshot_build(&world, true, &snapshot);
  EXPECT_TRUE(navigation_slot_index(&snapshot, RUBY2_ACTION_GO_HALLWAY) < 0);
  EXPECT_TRUE(navigation_key_equals(&snapshot, RUBY2_ACTION_GO_COURTYARD, "W"));
}

static void test_homeroom_problem_snapshot_has_visual_presentation_contract(void) {
  Ruby2World world;
  Ruby2UiSnapshot snapshot;

  ruby2_world_init(&world);
  choose_default_avatar(&world);
  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_GO_HOMEROOM));
  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_ATTEND_HOMEROOM));
  ruby2_ui_snapshot_build(&world, true, &snapshot);

  EXPECT_EQ_INT(snapshot.room, RUBY2_ROOM_HOMEROOM);
  EXPECT_EQ_INT(snapshot.presentation.focus.mode, RUBY2_UI_FOCUS_SPEECH_THEN_BLACKBOARD);
  EXPECT_EQ_INT(snapshot.presentation.focus.initial, RUBY2_UI_FOCUS_INITIAL_BLACKBOARD);
  EXPECT_EQ_INT(snapshot.presentation.focus.speaker, RUBY2_CHARACTER_RUBY);
  EXPECT_TRUE(snapshot.presentation.focus.has_blackboard);
  EXPECT_TRUE(snapshot.presentation.focus.blackboard_line_count >= 4);
  EXPECT_TRUE(strstr(snapshot.presentation.focus.blackboard_lines[0], "GRADE 9") != NULL);
  EXPECT_TRUE(snapshot.presentation.focus.speech_line != NULL);
  EXPECT_TRUE(strstr(snapshot.presentation.focus.speech_line, "board") != NULL);
  EXPECT_EQ_INT(snapshot.presentation.reaction_bubble_count, 2);
  EXPECT_EQ_INT(snapshot.presentation.reaction_bubbles[0].character, RUBY2_CHARACTER_LYRA);
  EXPECT_EQ_INT(snapshot.presentation.reaction_bubbles[0].theme, RUBY2_UI_BUBBLE_THEME_LYRA);
  EXPECT_EQ_INT(snapshot.presentation.reaction_bubbles[0].anchor, RUBY2_UI_BUBBLE_ANCHOR_WITNESS_1);
  EXPECT_EQ_INT(snapshot.presentation.reaction_bubbles[1].character, RUBY2_CHARACTER_RAVI);
  EXPECT_EQ_INT(snapshot.presentation.reaction_bubbles[1].theme, RUBY2_UI_BUBBLE_THEME_RAVI);
  EXPECT_EQ_INT(snapshot.presentation.reaction_bubbles[1].anchor, RUBY2_UI_BUBBLE_ANCHOR_WITNESS_2);
  EXPECT_EQ_INT(snapshot.presentation.navigation.slot_count, 0);
  EXPECT_EQ_INT(snapshot.presentation.action_tray.slot_count, 4);
  EXPECT_EQ_INT(action_slot_index(&snapshot, RUBY2_ACTION_APPROACH_SOURCE), 0);
  EXPECT_EQ_INT(action_slot_index(&snapshot, RUBY2_ACTION_APPROACH_SENSE), 1);
  EXPECT_EQ_INT(action_slot_index(&snapshot, RUBY2_ACTION_APPROACH_SYNC), 2);
  EXPECT_EQ_INT(action_slot_index(&snapshot, RUBY2_ACTION_APPROACH_SIGNAL), 3);
}

static void test_science_lab_quiz_snapshot_has_blackboard_contract(void) {
  Ruby2World world;
  Ruby2UiSnapshot snapshot;

  ruby2_world_init(&world);
  choose_default_avatar(&world);
  advance_to_lunch_with(&world, RUBY2_ACTION_APPROACH_SOURCE);
  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_GO_HALLWAY));
  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_GO_SCIENCE_LAB));
  ruby2_ui_snapshot_build(&world, true, &snapshot);

  EXPECT_EQ_INT(snapshot.room, RUBY2_ROOM_SCIENCE_LAB);
  EXPECT_EQ_INT(snapshot.presentation.focus.mode, RUBY2_UI_FOCUS_SPEECH_THEN_BLACKBOARD);
  EXPECT_TRUE(snapshot.presentation.focus.has_blackboard);
  EXPECT_TRUE(snapshot.presentation.focus.blackboard_line_count >= 4);
  EXPECT_TRUE(strstr(snapshot.presentation.focus.blackboard_lines[0], "GRADE 8 REVIEW") != NULL);
  EXPECT_TRUE(snapshot.active_question.prior_grade_review);
  EXPECT_EQ_INT(snapshot.active_question.teacher, RUBY2_CHARACTER_SALLY_SCIENCE);
  EXPECT_EQ_INT(snapshot.presentation.focus.speaker, RUBY2_CHARACTER_SALLY_SCIENCE);
  EXPECT_TRUE(snapshot_has_person(&snapshot, RUBY2_CHARACTER_MIKA));
  EXPECT_EQ_INT(snapshot.presentation.navigation.slot_count, 0);
  EXPECT_EQ_INT(snapshot.presentation.action_tray.slot_count, 4);
  EXPECT_TRUE(action_slot_index(&snapshot, RUBY2_ACTION_APPROACH_SOURCE) >= 0);
  EXPECT_TRUE(action_slot_index(&snapshot, RUBY2_ACTION_APPROACH_SENSE) >= 0);
  EXPECT_TRUE(action_slot_index(&snapshot, RUBY2_ACTION_APPROACH_SIGNAL) >= 0);
  EXPECT_TRUE(action_slot_index(&snapshot, RUBY2_ACTION_APPROACH_SYNC) >= 0);
}

static void test_snapshot_does_not_focus_remote_npc_after_action_resolution(void) {
  Ruby2World world;
  Ruby2UiSnapshot snapshot;

  ruby2_world_init(&world);
  choose_default_avatar(&world);
  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_GO_HOMEROOM));
  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_ATTEND_HOMEROOM));
  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_APPROACH_SOURCE));
  ruby2_world_step_agents(&world);
  ruby2_ui_snapshot_build(&world, true, &snapshot);

  EXPECT_EQ_INT(snapshot.room, RUBY2_ROOM_HOMEROOM);
  EXPECT_TRUE(!snapshot_has_person(&snapshot, RUBY2_CHARACTER_NOOR));
  EXPECT_TRUE(snapshot.presentation.focus.speaker != RUBY2_CHARACTER_NOOR);
  EXPECT_TRUE(snapshot.presentation.focus.speech_line != NULL);
  EXPECT_TRUE(strstr(snapshot.presentation.focus.speech_line, "event=npc_moved") == NULL);
  EXPECT_TRUE(strstr(snapshot.presentation.focus.speech_line, "board") != NULL);
  EXPECT_TRUE(strstr(snapshot.presentation.focus.speech_line, "time_advanced") == NULL);
}

static void test_snapshot_json_writer(void) {
  Ruby2World world;
  Ruby2UiSnapshot snapshot;
  FILE* fp;

  ruby2_world_init(&world);
  choose_default_avatar(&world);
  ruby2_ui_snapshot_build(&world, true, &snapshot);
  fp = tmpfile();
  EXPECT_TRUE(fp != NULL);
  if (fp) {
    EXPECT_TRUE(ruby2_ui_snapshot_write_json(fp, &snapshot));
    fclose(fp);
  }
}

static void test_reachable_snapshots_never_have_empty_player_controls(void) {
  Ruby2World world;

  ruby2_world_init(&world);
  expect_nonempty_player_controls(&world);

  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_GO_HOMEROOM));
  expect_nonempty_player_controls(&world);

  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_ATTEND_HOMEROOM));
  expect_nonempty_player_controls(&world);

  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_APPROACH_SOURCE));
  expect_nonempty_player_controls(&world);

  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_WAIT_BELL));
  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_GO_HALLWAY));
  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_GO_CAFETERIA));
  expect_nonempty_player_controls(&world);

  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_COLLECT_LUNCH_TRAY));
  EXPECT_TRUE(ruby2_world_apply_action(&world, RUBY2_ACTION_USE_LUNCH_TRAY));
  expect_nonempty_player_controls(&world);
}

int main(void) {
  test_initial_snapshot_exposes_world_state();
  test_snapshot_inventory_updates_after_collect();
  test_ranked_snapshot_preserves_legal_actions();
  test_snapshot_tracks_room_avatars_and_items_after_progression();
  test_navigation_labels_follow_campus_graph();
  test_homeroom_problem_snapshot_has_visual_presentation_contract();
  test_science_lab_quiz_snapshot_has_blackboard_contract();
  test_snapshot_does_not_focus_remote_npc_after_action_resolution();
  test_snapshot_json_writer();
  test_reachable_snapshots_never_have_empty_player_controls();

  if (failures != 0) {
    fprintf(stderr, "%d ui test failure(s)\n", failures);
    return 1;
  }

  puts("ruby2 UI tests passed");
  return 0;
}
