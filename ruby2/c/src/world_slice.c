#include "ruby2_world.h"
#include "ruby2_ranker.h"

#include <stdio.h>
#include <stdlib.h>

static int read_choice(int min, int max) {
  char line[32];
  for (;;) {
    printf("> ");
    fflush(stdout);
    if (!fgets(line, sizeof(line), stdin)) {
      puts("");
      exit(EXIT_FAILURE);
    }
    char* end = NULL;
    long value = strtol(line, &end, 10);
    if (value >= min && value <= max) return (int)value;
    printf("Choose %d-%d.\n", min, max);
  }
}

static void print_events(Ruby2World* world) {
  Ruby2WorldEvent event;
  bool debug_internal = getenv("RUBY2_WORLD_DEBUG_EVENTS") != NULL;
  while (ruby2_world_pop_event(world, &event)) {
    if (!ruby2_world_event_visible_to_player(&event) && !debug_internal) continue;
    printf("[%s t=%u] %s\n", ruby2_world_event_name(event.kind), (unsigned)event.tick, event.text);
  }
}

static void print_presence(const Ruby2World* world) {
  Ruby2RoomId room_id = world->game.current_room_id;
  bool any = false;
  printf("People: ");
  for (uint8_t i = 0; i < RUBY2_CHARACTER_COUNT; ++i) {
    if (ruby2_world_character_present(world, (Ruby2CharacterId)i, room_id)) {
      printf("%s%s", any ? ", " : "", ruby2_world_character_name((Ruby2CharacterId)i));
      any = true;
    }
  }
  puts(any ? "" : "none");

  any = false;
  printf("Objects: ");
  for (uint8_t i = 0; i < RUBY2_WORLD_OBJECT_COUNT; ++i) {
    if (ruby2_world_object_present(world, (Ruby2WorldObjectId)i, room_id)) {
      printf("%s%s", any ? ", " : "", ruby2_world_object_name((Ruby2WorldObjectId)i));
      any = true;
    }
  }
  puts(any ? "" : "none");
}

static void print_inventory(const Ruby2World* world) {
  bool any = false;
  printf("Bag: ");
  for (uint8_t i = 0; i < RUBY2_ITEM_COUNT; ++i) {
    const Ruby2ItemState* item = &world->game.items[i];
    if (!item->owned) continue;
    printf("%s%s", any ? ", " : "", ruby2_item_name((Ruby2ItemId)i));
    if (item->charges > 0) printf(" x%d", (int)item->charges);
    any = true;
  }
  puts(any ? "" : "empty slots");
}

static void print_room(const Ruby2World* world) {
  printf("\n== %s ==\n", ruby2_room_name(world->game.current_room_id));
  printf("Time: %s | Signal: %d | Stress: %d\n",
         world->game.current_time_block == RUBY2_TIME_LUNCH ? "Lunch" :
         world->game.current_time_block == RUBY2_TIME_PERIOD_1 ? "Period 1" :
         world->game.current_time_block == RUBY2_TIME_ARRIVAL ? "Arrival" : "School day",
         world->game.clocks[RUBY2_CLOCK_NULL_SIGNAL].value,
         world->game.clocks[RUBY2_CLOCK_STRESS].value);
  print_presence(world);
  print_inventory(world);
}

static void print_actions(const Ruby2WorldActionList* actions) {
  puts("Actions:");
  for (uint8_t i = 0; i < actions->count; ++i) {
    printf("%u. %s\n", (unsigned)(i + 1), actions->actions[i].label);
  }
}

int main(void) {
  Ruby2World world;
  bool printed_receipt_note = false;
  ruby2_world_init(&world);

  puts("Ruby High 2.1 - MUD kernel slice");
  puts("=================================");
  puts("Rooms, people, objects, actions, and events are resolved by the world kernel.");
  puts("Player choices and micro-agent intents both pass through the same state authority.");
  print_events(&world);

  for (uint8_t turn = 0; turn < 12; ++turn) {
    Ruby2WorldActionList legal_actions;
    Ruby2WorldActionList actions;
    Ruby2RankerResult result;
    print_room(&world);
    ruby2_world_query_actions(&world, &legal_actions);
    if (!ruby2_ranker_rank_world_actions(&world, &legal_actions, &actions, &result)) {
      actions = legal_actions;
    }
    if (actions.count > 4) {
      actions.count = 4;
    }
    if (actions.count == 0) {
      puts("No actions available.");
      break;
    }
    print_actions(&actions);

    int choice = read_choice(1, actions.count);
    Ruby2WorldActionId action_id = actions.actions[choice - 1].id;
    if (!ruby2_world_apply_action(&world, action_id)) {
      puts("The school does not allow that move from here.");
    }
    print_events(&world);
    ruby2_world_step_agents(&world);
    print_events(&world);

    if (world.receipt_inspected && !printed_receipt_note) {
      puts("\nNotebook: the receipt is now real evidence, not just lunch weirdness.");
      printed_receipt_note = true;
    }
  }

  puts("\nFinal read:");
  printf("Room: %s\n", ruby2_room_name(world.game.current_room_id));
  printf("Source %u | Sense %u | Sync %u | Signal %u\n",
         (unsigned)world.game.discipline_counts[RUBY2_DISCIPLINE_SOURCE],
         (unsigned)world.game.discipline_counts[RUBY2_DISCIPLINE_SENSE],
         (unsigned)world.game.discipline_counts[RUBY2_DISCIPLINE_SYNC],
         (unsigned)world.game.discipline_counts[RUBY2_DISCIPLINE_SIGNAL]);
  printf("Yearbook candidates: %u\n", (unsigned)world.game.yearbook_candidate_count);
  return EXIT_SUCCESS;
}
