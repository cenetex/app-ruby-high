#include "ruby2_ui.h"

#include <stdbool.h>
#include <stdio.h>
#include <string.h>

static bool apply_action(Ruby2World* world, Ruby2WorldActionId action_id, bool step_agents) {
  if (!ruby2_world_apply_action(world, action_id)) return false;
  if (step_agents && action_id == RUBY2_ACTION_WAIT_BELL) ruby2_world_step_agents(world);
  return true;
}

static bool apply_demo(Ruby2World* world, const char* demo) {
  if (!demo || strcmp(demo, "initial") == 0) return true;

  if (strcmp(demo, "homeroom_problem") == 0) {
    return apply_action(world, RUBY2_ACTION_COLLECT_NOTEBOOK, false) &&
           apply_action(world, RUBY2_ACTION_GO_HOMEROOM, false) &&
           apply_action(world, RUBY2_ACTION_COLLECT_FLASHCARDS, false) &&
           apply_action(world, RUBY2_ACTION_ATTEND_HOMEROOM, false);
  }

  if (strcmp(demo, "after_source") == 0) {
    return apply_action(world, RUBY2_ACTION_COLLECT_NOTEBOOK, false) &&
           apply_action(world, RUBY2_ACTION_GO_HOMEROOM, false) &&
           apply_action(world, RUBY2_ACTION_COLLECT_FLASHCARDS, false) &&
           apply_action(world, RUBY2_ACTION_ATTEND_HOMEROOM, false) &&
           apply_action(world, RUBY2_ACTION_APPROACH_SOURCE, true);
  }

  if (strcmp(demo, "science_quiz") == 0) {
    return apply_action(world, RUBY2_ACTION_GO_HOMEROOM, false) &&
           apply_action(world, RUBY2_ACTION_ATTEND_HOMEROOM, false) &&
           apply_action(world, RUBY2_ACTION_APPROACH_SOURCE, false) &&
           apply_action(world, RUBY2_ACTION_WAIT_BELL, true) &&
           apply_action(world, RUBY2_ACTION_GO_HALLWAY, false) &&
           apply_action(world, RUBY2_ACTION_GO_SCIENCE_LAB, false);
  }

  if (strcmp(demo, "library_quiz") == 0) {
    return apply_action(world, RUBY2_ACTION_GO_HOMEROOM, false) &&
           apply_action(world, RUBY2_ACTION_ATTEND_HOMEROOM, false) &&
           apply_action(world, RUBY2_ACTION_APPROACH_SOURCE, false) &&
           apply_action(world, RUBY2_ACTION_WAIT_BELL, true) &&
           apply_action(world, RUBY2_ACTION_GO_HALLWAY, false) &&
           apply_action(world, RUBY2_ACTION_GO_LIBRARY, false);
  }

  if (strcmp(demo, "lunch_tray") == 0) {
    return apply_action(world, RUBY2_ACTION_COLLECT_NOTEBOOK, false) &&
           apply_action(world, RUBY2_ACTION_GO_HOMEROOM, false) &&
           apply_action(world, RUBY2_ACTION_COLLECT_FLASHCARDS, false) &&
           apply_action(world, RUBY2_ACTION_ATTEND_HOMEROOM, false) &&
           apply_action(world, RUBY2_ACTION_APPROACH_SOURCE, false) &&
           apply_action(world, RUBY2_ACTION_WAIT_BELL, true) &&
           apply_action(world, RUBY2_ACTION_GO_HALLWAY, false) &&
           apply_action(world, RUBY2_ACTION_GO_CAFETERIA, false);
  }

  if (strcmp(demo, "lunch_tray_used") == 0) {
    return apply_action(world, RUBY2_ACTION_COLLECT_NOTEBOOK, false) &&
           apply_action(world, RUBY2_ACTION_GO_HOMEROOM, false) &&
           apply_action(world, RUBY2_ACTION_COLLECT_FLASHCARDS, false) &&
           apply_action(world, RUBY2_ACTION_ATTEND_HOMEROOM, false) &&
           apply_action(world, RUBY2_ACTION_APPROACH_SOURCE, false) &&
           apply_action(world, RUBY2_ACTION_WAIT_BELL, true) &&
           apply_action(world, RUBY2_ACTION_GO_HALLWAY, false) &&
           apply_action(world, RUBY2_ACTION_GO_CAFETERIA, false) &&
           apply_action(world, RUBY2_ACTION_COLLECT_LUNCH_TRAY, false) &&
           apply_action(world, RUBY2_ACTION_USE_LUNCH_TRAY, false);
  }

  return false;
}

int main(int argc, char** argv) {
  bool ranked = true;
  const char* demo = "initial";
  Ruby2World world;
  Ruby2UiSnapshot snapshot;

  for (int i = 1; i < argc; ++i) {
    if (strcmp(argv[i], "--unranked") == 0) {
      ranked = false;
    } else if (strcmp(argv[i], "--demo") == 0 && i + 1 < argc) {
      demo = argv[++i];
    }
  }

  ruby2_world_init(&world);
  if (!apply_demo(&world, demo)) {
    fprintf(stderr, "unknown or invalid demo snapshot: %s\n", demo);
    return 1;
  }
  ruby2_ui_snapshot_build(&world, ranked, &snapshot);
  if (!ruby2_ui_snapshot_write_json(stdout, &snapshot)) {
    fputs("failed to write UI snapshot\n", stderr);
    return 1;
  }
  return 0;
}
