#include "ruby2_world.h"
#include "ruby2_ranker.h"

#include <string.h>

static void ruby2_world_run_director(Ruby2World* world);

static const Ruby2WorldRoom ruby2_world_rooms[] = {
  {
    RUBY2_ROOM_HALLWAY,
    {
      RUBY2_ROOM_HOMEROOM,
      RUBY2_ROOM_SCIENCE_LAB,
      RUBY2_ROOM_LIBRARY,
      RUBY2_ROOM_CAFETERIA,
      RUBY2_ROOM_GREENHOUSE,
      RUBY2_ROOM_COURTYARD,
      RUBY2_ROOM_TEACHER_OFFICE
    },
    7
  },
  { RUBY2_ROOM_HOMEROOM, { RUBY2_ROOM_HALLWAY }, 1 },
  { RUBY2_ROOM_SCIENCE_LAB, { RUBY2_ROOM_HALLWAY }, 1 },
  { RUBY2_ROOM_LIBRARY, { RUBY2_ROOM_HALLWAY }, 1 },
  { RUBY2_ROOM_CAFETERIA, { RUBY2_ROOM_HALLWAY }, 1 },
  { RUBY2_ROOM_GREENHOUSE, { RUBY2_ROOM_HALLWAY }, 1 },
  { RUBY2_ROOM_COURTYARD, { RUBY2_ROOM_HALLWAY }, 1 },
  { RUBY2_ROOM_TEACHER_OFFICE, { RUBY2_ROOM_HALLWAY }, 1 }
};

static void ruby2_world_push_event_with_visibility(
  Ruby2World* world,
  Ruby2WorldEventKind kind,
  Ruby2RoomId room,
  Ruby2CharacterId character,
  Ruby2WorldObjectId object,
  Ruby2WorldActionId action,
  Ruby2WorldEventVisibility visibility,
  const char* text
) {
  if (!world) return;
  if (world->events.count >= RUBY2_WORLD_MAX_EVENTS) {
    world->events.dropped_count++;
    return;
  }

  Ruby2WorldEvent* event = &world->events.events[world->events.count++];
  event->kind = kind;
  event->tick = world->tick;
  event->room = room;
  event->character = character;
  event->object = object;
  event->action = action;
  event->visibility = visibility;
  event->text = text;
}

static void ruby2_world_push_event(
  Ruby2World* world,
  Ruby2WorldEventKind kind,
  Ruby2RoomId room,
  Ruby2CharacterId character,
  Ruby2WorldObjectId object,
  Ruby2WorldActionId action,
  const char* text
) {
  ruby2_world_push_event_with_visibility(
    world,
    kind,
    room,
    character,
    object,
    action,
    RUBY2_EVENT_VISIBLE_TO_PLAYER,
    text
  );
}

static Ruby2AgentIntentResult ruby2_world_reject_agent_intent(
  Ruby2World* world,
  const Ruby2AgentIntent* intent,
  Ruby2AgentIntentResult result
) {
  Ruby2CharacterId character = intent ? intent->character : RUBY2_CHARACTER_NONE;
  Ruby2RoomId room = RUBY2_ROOM_COUNT;
  Ruby2WorldObjectId object = RUBY2_WORLD_OBJECT_NOTEBOOK;
  if (intent && intent->target_object < RUBY2_WORLD_OBJECT_COUNT) {
    object = intent->target_object;
  }
  if (world && character < RUBY2_CHARACTER_COUNT) {
    room = world->npc_rooms[character];
  }
  ruby2_world_push_event_with_visibility(
    world,
    RUBY2_EVENT_AGENT_INTENT_REJECTED,
    room,
    character,
    object,
    RUBY2_ACTION_NONE,
    RUBY2_EVENT_INTERNAL,
    ruby2_agent_intent_result_name(result)
  );
  return result;
}

static void ruby2_world_add_action(
  Ruby2WorldActionList* list,
  Ruby2WorldActionId id,
  Ruby2WorldActionKind kind,
  Ruby2RoomId target_room,
  Ruby2CharacterId target_character,
  Ruby2WorldObjectId target_object,
  Ruby2Discipline discipline,
  Ruby2Virtue virtue,
  const char* label
) {
  if (!list || list->count >= RUBY2_WORLD_MAX_ACTIONS) return;

  Ruby2WorldAction* action = &list->actions[list->count++];
  action->id = id;
  action->kind = kind;
  action->target_room = target_room;
  action->target_character = target_character;
  action->target_object = target_object;
  action->discipline = discipline;
  action->virtue = virtue;
  action->label = label;
}

static bool ruby2_room_has_exit(Ruby2RoomId from, Ruby2RoomId to) {
  const Ruby2WorldRoom* room = ruby2_world_room(from);
  if (!room) return false;
  for (uint8_t i = 0; i < room->exit_count; ++i) {
    if (room->exits[i] == to) return true;
  }
  return false;
}

static bool ruby2_world_object_item(Ruby2WorldObjectId object_id, Ruby2ItemId* out) {
  Ruby2ItemId item_id;
  switch (object_id) {
    case RUBY2_WORLD_OBJECT_NOTEBOOK:
      item_id = RUBY2_ITEM_NOTEBOOK;
      break;
    case RUBY2_WORLD_OBJECT_FLASHCARDS:
      item_id = RUBY2_ITEM_FLASHCARDS;
      break;
    case RUBY2_WORLD_OBJECT_LUNCH_TRAY:
      item_id = RUBY2_ITEM_LUNCH_TRAY;
      break;
    case RUBY2_WORLD_OBJECT_OFFICE_PASS:
      item_id = RUBY2_ITEM_OFFICE_PASS;
      break;
    case RUBY2_WORLD_OBJECT_LIBRARY_CARD:
      item_id = RUBY2_ITEM_LIBRARY_CARD;
      break;
    case RUBY2_WORLD_OBJECT_LAB_FLASK:
      item_id = RUBY2_ITEM_LAB_FLASK;
      break;
    default:
      return false;
  }
  if (out) *out = item_id;
  return true;
}

static bool ruby2_world_collect_action_for_object(
  Ruby2WorldObjectId object_id,
  Ruby2WorldActionId* out
) {
  Ruby2WorldActionId action_id;
  switch (object_id) {
    case RUBY2_WORLD_OBJECT_NOTEBOOK:
      action_id = RUBY2_ACTION_COLLECT_NOTEBOOK;
      break;
    case RUBY2_WORLD_OBJECT_FLASHCARDS:
      action_id = RUBY2_ACTION_COLLECT_FLASHCARDS;
      break;
    case RUBY2_WORLD_OBJECT_LUNCH_TRAY:
      action_id = RUBY2_ACTION_COLLECT_LUNCH_TRAY;
      break;
    case RUBY2_WORLD_OBJECT_OFFICE_PASS:
      action_id = RUBY2_ACTION_COLLECT_OFFICE_PASS;
      break;
    case RUBY2_WORLD_OBJECT_LIBRARY_CARD:
      action_id = RUBY2_ACTION_COLLECT_LIBRARY_CARD;
      break;
    case RUBY2_WORLD_OBJECT_LAB_FLASK:
      action_id = RUBY2_ACTION_COLLECT_LAB_FLASK;
      break;
    default:
      return false;
  }
  if (out) *out = action_id;
  return true;
}

static bool ruby2_world_action_collect_object(
  Ruby2WorldActionId action_id,
  Ruby2WorldObjectId* out
) {
  Ruby2WorldObjectId object_id;
  switch (action_id) {
    case RUBY2_ACTION_COLLECT_NOTEBOOK:
      object_id = RUBY2_WORLD_OBJECT_NOTEBOOK;
      break;
    case RUBY2_ACTION_COLLECT_FLASHCARDS:
      object_id = RUBY2_WORLD_OBJECT_FLASHCARDS;
      break;
    case RUBY2_ACTION_COLLECT_LUNCH_TRAY:
      object_id = RUBY2_WORLD_OBJECT_LUNCH_TRAY;
      break;
    case RUBY2_ACTION_COLLECT_OFFICE_PASS:
      object_id = RUBY2_WORLD_OBJECT_OFFICE_PASS;
      break;
    case RUBY2_ACTION_COLLECT_LIBRARY_CARD:
      object_id = RUBY2_WORLD_OBJECT_LIBRARY_CARD;
      break;
    case RUBY2_ACTION_COLLECT_LAB_FLASK:
      object_id = RUBY2_WORLD_OBJECT_LAB_FLASK;
      break;
    default:
      return false;
  }
  if (out) *out = object_id;
  return true;
}

static int8_t ruby2_world_item_starting_charges(Ruby2ItemId item_id) {
  switch (item_id) {
    case RUBY2_ITEM_FLASHCARDS:
      return 2;
    case RUBY2_ITEM_OFFICE_PASS:
      return 1;
    case RUBY2_ITEM_NOTEBOOK:
    case RUBY2_ITEM_LIBRARY_CARD:
    case RUBY2_ITEM_LAB_FLASK:
    case RUBY2_ITEM_LUNCH_TRAY:
      return -1;
    default:
      return 0;
  }
}

static bool ruby2_world_item_owned(const Ruby2World* world, Ruby2ItemId item_id) {
  return world && item_id < RUBY2_ITEM_COUNT && world->game.items[item_id].owned;
}

static bool ruby2_world_notebook_owned(const Ruby2World* world) {
  return ruby2_world_item_owned(world, RUBY2_ITEM_NOTEBOOK);
}

static void ruby2_world_clear_chat(Ruby2World* world) {
  if (!world) return;
  world->chat_active = false;
  world->chat_room_mode = false;
  world->chat_character = RUBY2_CHARACTER_NONE;
  world->chat_room = RUBY2_ROOM_COUNT;
  world->chat_prompt = NULL;
  world->chat_options[0] = NULL;
  world->chat_options[1] = NULL;
}

static void ruby2_world_clear_chat_cooldowns(Ruby2World* world) {
  if (!world) return;
  for (uint8_t i = 0; i < RUBY2_ROOM_COUNT; ++i) {
    world->chat_resolved_rooms[i] = false;
  }
}

static void ruby2_world_clear_recent_actions(Ruby2World* world) {
  if (!world) return;
  world->recent_action_count = 0;
  world->has_last_action = false;
  world->last_action_id = RUBY2_ACTION_NONE;
  world->last_action_room = RUBY2_ROOM_COUNT;
  for (uint8_t i = 0; i < RUBY2_WORLD_MAX_RECENT_ACTIONS; ++i) {
    world->recent_action_ids[i] = RUBY2_ACTION_NONE;
    world->recent_action_rooms[i] = RUBY2_ROOM_COUNT;
  }
}

static bool ruby2_world_recent_action_in_room(
  const Ruby2World* world,
  Ruby2WorldActionId action_id,
  Ruby2RoomId room_id
) {
  if (!world || world->recent_action_count == 0) return false;
  for (uint8_t i = 0; i < world->recent_action_count; ++i) {
    if (
      world->recent_action_rooms[i] == room_id &&
      world->recent_action_ids[i] == action_id
    ) {
      return true;
    }
  }
  return false;
}

static bool ruby2_world_recent_chat_resolved_in_room(const Ruby2World* world, Ruby2RoomId room_id) {
  return ruby2_world_recent_action_in_room(world, RUBY2_ACTION_CHAT_OPTION_A, room_id) ||
         ruby2_world_recent_action_in_room(world, RUBY2_ACTION_CHAT_OPTION_B, room_id);
}

static void ruby2_world_record_last_action(Ruby2World* world, Ruby2WorldActionId action_id, Ruby2RoomId action_room) {
  if (!world) return;
  if (world->recent_action_count >= RUBY2_WORLD_MAX_RECENT_ACTIONS) {
    for (uint8_t i = RUBY2_WORLD_MAX_RECENT_ACTIONS - 1; i > 0; --i) {
      world->recent_action_ids[i] = world->recent_action_ids[i - 1];
      world->recent_action_rooms[i] = world->recent_action_rooms[i - 1];
    }
    world->recent_action_ids[0] = action_id;
    world->recent_action_rooms[0] = action_room;
  } else {
    for (uint8_t i = world->recent_action_count; i > 0; --i) {
      world->recent_action_ids[i] = world->recent_action_ids[i - 1];
      world->recent_action_rooms[i] = world->recent_action_rooms[i - 1];
    }
    world->recent_action_ids[0] = action_id;
    world->recent_action_rooms[0] = action_room;
    ++world->recent_action_count;
  }

  world->has_last_action = true;
  world->last_action_id = action_id;
  world->last_action_room = action_room;
}

static void ruby2_world_dismiss_last_action(Ruby2WorldActionList* out, const Ruby2World* world) {
  if (!out || !world || !out->count || world->recent_action_count == 0) {
    return;
  }

  for (uint8_t slot = 0; slot < out->count && slot < 2; ++slot) {
    if (!ruby2_world_recent_action_in_room(world, out->actions[slot].id, world->game.current_room_id)) {
      continue;
    }

    for (uint8_t i = slot + 1; i < out->count; ++i) {
      if (!ruby2_world_recent_action_in_room(world, out->actions[i].id, world->game.current_room_id)) {
        Ruby2WorldAction swap = out->actions[slot];
        out->actions[slot] = out->actions[i];
        out->actions[i] = swap;
        break;
      }
    }
  }
}

static Ruby2PlayerAvatarId ruby2_world_avatar_for_action(Ruby2WorldActionId action_id) {
  switch (action_id) {
    case RUBY2_ACTION_SELECT_AVATAR_SOURCE:
      return RUBY2_PLAYER_AVATAR_SOURCE;
    case RUBY2_ACTION_SELECT_AVATAR_SENSE:
      return RUBY2_PLAYER_AVATAR_SENSE;
    case RUBY2_ACTION_SELECT_AVATAR_SYNC:
      return RUBY2_PLAYER_AVATAR_SYNC;
    case RUBY2_ACTION_SELECT_AVATAR_SIGNAL:
      return RUBY2_PLAYER_AVATAR_SIGNAL;
    default:
      return RUBY2_PLAYER_AVATAR_UNSET;
  }
}

static Ruby2Discipline ruby2_world_avatar_discipline(Ruby2PlayerAvatarId avatar_id) {
  switch (avatar_id) {
    case RUBY2_PLAYER_AVATAR_SOURCE:
      return RUBY2_DISCIPLINE_SOURCE;
    case RUBY2_PLAYER_AVATAR_SENSE:
      return RUBY2_DISCIPLINE_SENSE;
    case RUBY2_PLAYER_AVATAR_SIGNAL:
      return RUBY2_DISCIPLINE_SIGNAL;
    case RUBY2_PLAYER_AVATAR_SYNC:
    case RUBY2_PLAYER_AVATAR_UNSET:
    default:
      return RUBY2_DISCIPLINE_SYNC;
  }
}

static Ruby2Virtue ruby2_world_avatar_virtue(Ruby2PlayerAvatarId avatar_id) {
  switch (avatar_id) {
    case RUBY2_PLAYER_AVATAR_SOURCE:
    case RUBY2_PLAYER_AVATAR_SIGNAL:
      return RUBY2_VIRTUE_HONOR;
    case RUBY2_PLAYER_AVATAR_SENSE:
      return RUBY2_VIRTUE_HEAD;
    case RUBY2_PLAYER_AVATAR_SYNC:
      return RUBY2_VIRTUE_HEART;
    case RUBY2_PLAYER_AVATAR_UNSET:
    default:
      return RUBY2_VIRTUE_HUSTLE;
  }
}

static Ruby2WorldActionId ruby2_world_go_action_for_room(Ruby2RoomId room_id) {
  switch (room_id) {
    case RUBY2_ROOM_HALLWAY:
      return RUBY2_ACTION_GO_HALLWAY;
    case RUBY2_ROOM_HOMEROOM:
      return RUBY2_ACTION_GO_HOMEROOM;
    case RUBY2_ROOM_SCIENCE_LAB:
      return RUBY2_ACTION_GO_SCIENCE_LAB;
    case RUBY2_ROOM_LIBRARY:
      return RUBY2_ACTION_GO_LIBRARY;
    case RUBY2_ROOM_CAFETERIA:
      return RUBY2_ACTION_GO_CAFETERIA;
    case RUBY2_ROOM_GREENHOUSE:
      return RUBY2_ACTION_GO_GREENHOUSE;
    case RUBY2_ROOM_COURTYARD:
      return RUBY2_ACTION_GO_COURTYARD;
    case RUBY2_ROOM_TEACHER_OFFICE:
      return RUBY2_ACTION_GO_TEACHER_OFFICE;
    default:
      return RUBY2_ACTION_NONE;
  }
}

static Ruby2WorldObjectId ruby2_world_default_object_for_character(Ruby2CharacterId character_id) {
  switch (character_id) {
    case RUBY2_CHARACTER_RAVI:
      return RUBY2_WORLD_OBJECT_WORK_ORDER;
    case RUBY2_CHARACTER_NOOR:
      return RUBY2_WORLD_OBJECT_RECEIPT;
    case RUBY2_CHARACTER_MIKA:
      return RUBY2_WORLD_OBJECT_LAB_FLASK;
    case RUBY2_CHARACTER_INDRA:
      return RUBY2_WORLD_OBJECT_LIBRARY_CARD;
    case RUBY2_CHARACTER_SAMI:
      return RUBY2_WORLD_OBJECT_LUNCH_TRAY;
    case RUBY2_CHARACTER_RUBY:
    case RUBY2_CHARACTER_LYRA:
    default:
      return RUBY2_WORLD_OBJECT_NOTEBOOK;
  }
}

static Ruby2CharacterId ruby2_world_first_room_speaker(const Ruby2World* world, Ruby2RoomId room_id) {
  static const Ruby2CharacterId order[] = {
    RUBY2_CHARACTER_RUBY,
    RUBY2_CHARACTER_LYRA,
    RUBY2_CHARACTER_MIKA,
    RUBY2_CHARACTER_RAVI,
    RUBY2_CHARACTER_INDRA,
    RUBY2_CHARACTER_NOOR,
    RUBY2_CHARACTER_SAMI
  };
  if (!world || room_id >= RUBY2_ROOM_COUNT) return RUBY2_CHARACTER_NONE;
  for (uint8_t i = 0; i < (uint8_t)(sizeof(order) / sizeof(order[0])); ++i) {
    if (ruby2_world_character_present(world, order[i], room_id)) return order[i];
  }
  return RUBY2_CHARACTER_NONE;
}

static Ruby2Discipline ruby2_world_default_discipline_for_character(Ruby2CharacterId character_id) {
  switch (character_id) {
    case RUBY2_CHARACTER_RAVI:
    case RUBY2_CHARACTER_MIKA:
      return RUBY2_DISCIPLINE_SOURCE;
    case RUBY2_CHARACTER_INDRA:
      return RUBY2_DISCIPLINE_SENSE;
    case RUBY2_CHARACTER_NOOR:
      return RUBY2_DISCIPLINE_SIGNAL;
    case RUBY2_CHARACTER_RUBY:
    case RUBY2_CHARACTER_LYRA:
    case RUBY2_CHARACTER_SAMI:
    default:
      return RUBY2_DISCIPLINE_SYNC;
  }
}

static const char* ruby2_world_chat_option_label(Ruby2CharacterId character, uint8_t option) {
  switch (character) {
    case RUBY2_CHARACTER_RUBY:
      return option == 0
        ? "Ask Ruby what to do next."
        : "Tell Ruby you want to look around.";
    case RUBY2_CHARACTER_LYRA:
      return option == 0
        ? "Ask Lyra what she can verify."
        : "Tell Lyra the wording is weird.";
    case RUBY2_CHARACTER_MIKA:
      return option == 0
        ? "Ask Mika for a boost."
        : "Ask Mika what to practice.";
    case RUBY2_CHARACTER_RAVI:
      return option == 0
        ? "Ask Ravi for the evidence version."
        : "Ask Ravi what he is not sure about.";
    case RUBY2_CHARACTER_INDRA:
      return option == 0
        ? "Ask Indra what changed."
        : "Wait for Indra to choose the line.";
    case RUBY2_CHARACTER_NOOR:
      return option == 0
        ? "Ask Noor why the receipt feels fake."
        : "Ask Noor what everyone is ignoring.";
    case RUBY2_CHARACTER_SAMI:
      return option == 0
        ? "Ask Sami what the hallway thinks."
        : "Ask Sami to make it less awkward.";
    default:
      return option == 0 ? "Ask a grounded question." : "Ask what changed.";
  }
}

static const char* ruby2_world_chat_resolution_line(Ruby2CharacterId character, uint8_t option) {
  switch (character) {
    case RUBY2_CHARACTER_RUBY:
      return option == 0
        ? "Next move: pick a room, pick a witness, then make the Notebook prove you were there."
        : "Good. Looking around counts, as long as you come back with evidence.";
    case RUBY2_CHARACTER_LYRA:
      return option == 0
        ? "I can verify ink, wording, and panic. The panic is not admissible, apparently."
        : "It is absolutely weird. I am only calm because I scheduled the panic for later.";
    case RUBY2_CHARACTER_MIKA:
      return option == 0
        ? "You are not lost. You are just pre-routing. Huge difference."
        : "Practice the move you keep avoiding. That is usually where the level-up is hiding.";
    case RUBY2_CHARACTER_RAVI:
      return option == 0
        ? "Evidence version: if two objects disagree, trust the one with a physical trace."
        : "I am not sure the footer belongs to the paper. Which is, technically, alarming.";
    case RUBY2_CHARACTER_INDRA:
      return option == 0
        ? "The quiet changed first."
        : "Good.";
    case RUBY2_CHARACTER_NOOR:
      return option == 0
        ? "Because it wants you to stop reading before the useful part."
        : "Everyone is ignoring that the room reacted before the people did.";
    case RUBY2_CHARACTER_SAMI:
      return option == 0
        ? "The hallway thinks everyone needs to lower their shoulders."
        : "Too late, but I respect the ambition.";
    default:
      return "The conversation leaves a real mark.";
  }
}

static const char* ruby2_world_room_chat_option_label(uint8_t option) {
  return option == 0
    ? "Ask: what can everyone actually verify?"
    : "Ask: what move should we make next?";
}

static const char* ruby2_world_room_chat_resolution_line(uint8_t option) {
  return option == 0
    ? "You ask the room to separate what people know from what they feel."
    : "You ask the room to choose the next real move instead of chasing noise.";
}

static bool ruby2_world_room_quiz_available(const Ruby2World* world, Ruby2RoomId room_id) {
  if (!world || !world->lunch_started) return false;
  switch (room_id) {
    case RUBY2_ROOM_SCIENCE_LAB:
      return !world->science_lab_quiz_resolved;
    case RUBY2_ROOM_LIBRARY:
      return !world->library_quiz_resolved;
    default:
      return false;
  }
}

static Ruby2CharacterId ruby2_world_room_quiz_speaker(Ruby2RoomId room_id) {
  switch (room_id) {
    case RUBY2_ROOM_SCIENCE_LAB:
      return RUBY2_CHARACTER_MIKA;
    case RUBY2_ROOM_LIBRARY:
      return RUBY2_CHARACTER_INDRA;
    default:
      return RUBY2_CHARACTER_RUBY;
  }
}

static Ruby2WorldObjectId ruby2_world_room_quiz_object(Ruby2RoomId room_id) {
  switch (room_id) {
    case RUBY2_ROOM_SCIENCE_LAB:
      return RUBY2_WORLD_OBJECT_LAB_FLASK;
    case RUBY2_ROOM_LIBRARY:
      return RUBY2_WORLD_OBJECT_LIBRARY_CARD;
    default:
      return RUBY2_WORLD_OBJECT_NOTEBOOK;
  }
}

static const char* ruby2_world_room_quiz_action_label(
  Ruby2RoomId room_id,
  Ruby2WorldActionId action_id
) {
  if (room_id == RUBY2_ROOM_SCIENCE_LAB) {
    switch (action_id) {
      case RUBY2_ACTION_APPROACH_SOURCE:
        return "Run the control sample before touching the catalyst.";
      case RUBY2_ACTION_APPROACH_SENSE:
        return "Name the hidden variable before anyone touches glass.";
      case RUBY2_ACTION_APPROACH_SYNC:
        return "Split the room into witness, timer, and recorder.";
      case RUBY2_ACTION_APPROACH_SIGNAL:
        return "Check the timestamp mismatch in the lab log.";
      default:
        break;
    }
  }
  if (room_id == RUBY2_ROOM_LIBRARY) {
    switch (action_id) {
      case RUBY2_ACTION_APPROACH_SOURCE:
        return "Trace the citation chain back to the first printed copy.";
      case RUBY2_ACTION_APPROACH_SENSE:
        return "Find the one word that changes the claim boundary.";
      case RUBY2_ACTION_APPROACH_SYNC:
        return "Pair Lyra and Indra on opposing checks.";
      case RUBY2_ACTION_APPROACH_SIGNAL:
        return "Mark the margin symbol that repeats across rooms.";
      default:
        break;
    }
  }
  return ruby2_world_action_label(action_id);
}

static const char* ruby2_world_room_quiz_resolution_line(
  Ruby2RoomId room_id,
  Ruby2WorldActionId action_id
) {
  if (room_id == RUBY2_ROOM_SCIENCE_LAB) {
    switch (action_id) {
      case RUBY2_ACTION_APPROACH_SOURCE:
        return "You run the control first; the catalyst only matters after the baseline survives.";
      case RUBY2_ACTION_APPROACH_SENSE:
        return "You flag the hidden variable before the test can pretend certainty.";
      case RUBY2_ACTION_APPROACH_SYNC:
        return "You assign witness roles and the room stops guessing long enough to measure.";
      case RUBY2_ACTION_APPROACH_SIGNAL:
        return "You catch the copied timestamp. Someone duplicated a result that should be unique.";
      default:
        break;
    }
  }
  if (room_id == RUBY2_ROOM_LIBRARY) {
    switch (action_id) {
      case RUBY2_ACTION_APPROACH_SOURCE:
        return "You trace the claim to the first copy and keep every reprint honest.";
      case RUBY2_ACTION_APPROACH_SENSE:
        return "You isolate one scope word and the whole paragraph stops lying by omission.";
      case RUBY2_ACTION_APPROACH_SYNC:
        return "You split checks across two witnesses and the margin finally agrees with itself.";
      case RUBY2_ACTION_APPROACH_SIGNAL:
        return "You tag the repeating symbol; the same mark is now evidence across rooms.";
      default:
        break;
    }
  }
  return ruby2_world_action_label(action_id);
}

static uint16_t ruby2_world_room_quiz_candidate_id(
  Ruby2RoomId room_id,
  Ruby2WorldActionId action_id
) {
  uint16_t base = room_id == RUBY2_ROOM_LIBRARY ? 7200u : 7100u;
  switch (action_id) {
    case RUBY2_ACTION_APPROACH_SOURCE:
      return (uint16_t)(base + 1u);
    case RUBY2_ACTION_APPROACH_SENSE:
      return (uint16_t)(base + 2u);
    case RUBY2_ACTION_APPROACH_SYNC:
      return (uint16_t)(base + 3u);
    case RUBY2_ACTION_APPROACH_SIGNAL:
      return (uint16_t)(base + 4u);
    default:
      return base;
  }
}

static bool ruby2_world_apply_room_quiz_approach(
  Ruby2World* world,
  Ruby2WorldActionId action_id
) {
  Ruby2EffectPayload payload;
  Ruby2RoomId room_id;
  Ruby2CharacterId speaker;
  Ruby2WorldObjectId object_id;
  const char* resolution;
  if (!world) return false;

  room_id = world->game.current_room_id;
  if (!ruby2_world_room_quiz_available(world, room_id)) return false;

  world->tick++;
  ruby2_effect_payload_init(&payload);
  payload.create_yearbook_candidate = true;
  payload.milestone_kind = RUBY2_MILESTONE_CLASS_REPORT;
  payload.candidate_score = 8;
  payload.candidate_id = ruby2_world_room_quiz_candidate_id(room_id, action_id);

  switch (action_id) {
    case RUBY2_ACTION_APPROACH_SOURCE:
      payload.discipline_deltas[RUBY2_DISCIPLINE_SOURCE] = 1;
      payload.virtue_deltas[RUBY2_VIRTUE_HEAD] = 1;
      payload.reputation_tag = RUBY2_ARCHETYPE_SCHOLAR;
      break;
    case RUBY2_ACTION_APPROACH_SENSE:
      payload.discipline_deltas[RUBY2_DISCIPLINE_SENSE] = 1;
      payload.virtue_deltas[RUBY2_VIRTUE_HONOR] = 1;
      payload.reputation_tag = RUBY2_ARCHETYPE_CONSCIENCE;
      break;
    case RUBY2_ACTION_APPROACH_SYNC:
      payload.discipline_deltas[RUBY2_DISCIPLINE_SYNC] = 1;
      payload.virtue_deltas[RUBY2_VIRTUE_HEART] = 1;
      payload.reputation_tag = RUBY2_ARCHETYPE_CONNECTOR;
      break;
    case RUBY2_ACTION_APPROACH_SIGNAL:
      payload.discipline_deltas[RUBY2_DISCIPLINE_SIGNAL] = 1;
      payload.virtue_deltas[RUBY2_VIRTUE_HEAD] = 1;
      payload.clock_deltas[RUBY2_CLOCK_NULL_SIGNAL] = 1;
      payload.reputation_tag = RUBY2_ARCHETYPE_SIGNAL_READER;
      break;
    default:
      return false;
  }

  ruby2_apply_effect_payload(&world->game, &payload);
  if (room_id == RUBY2_ROOM_SCIENCE_LAB) {
    world->science_lab_quiz_resolved = true;
  } else if (room_id == RUBY2_ROOM_LIBRARY) {
    world->library_quiz_resolved = true;
  } else {
    return false;
  }

  speaker = ruby2_world_room_quiz_speaker(room_id);
  object_id = ruby2_world_room_quiz_object(room_id);
  resolution = ruby2_world_room_quiz_resolution_line(room_id, action_id);
  ruby2_world_push_event(
    world,
    RUBY2_EVENT_APPROACH_RESOLVED,
    room_id,
    speaker,
    object_id,
    action_id,
    resolution
  );
  ruby2_world_push_event(
    world,
    RUBY2_EVENT_NOTEBOOK_UPDATED,
    room_id,
    RUBY2_CHARACTER_NONE,
    RUBY2_WORLD_OBJECT_NOTEBOOK,
    action_id,
    room_id == RUBY2_ROOM_SCIENCE_LAB
      ? "Notebook margin: lab quiz sealed. The result stands because the room can replay it."
      : "Notebook margin: library quiz sealed. The citation chain now has witnesses."
  );
  ruby2_world_run_director(world);
  return true;
}

static void ruby2_world_open_chat(Ruby2World* world, Ruby2CharacterId character_id) {
  if (!world || character_id >= RUBY2_CHARACTER_COUNT) return;
  world->chat_active = true;
  world->chat_room_mode = false;
  world->chat_character = character_id;
  world->chat_room = world->game.current_room_id;
  world->chat_prompt = "Choose how to continue the conversation.";
  world->chat_options[0] = ruby2_world_chat_option_label(character_id, 0);
  world->chat_options[1] = ruby2_world_chat_option_label(character_id, 1);
}

static void ruby2_world_open_room_chat(Ruby2World* world, Ruby2CharacterId speaker_id) {
  if (!world || speaker_id >= RUBY2_CHARACTER_COUNT) return;
  world->chat_active = true;
  world->chat_room_mode = true;
  world->chat_character = speaker_id;
  world->chat_room = world->game.current_room_id;
  world->chat_prompt = "Choose what your student says to the room.";
  world->chat_options[0] = ruby2_world_room_chat_option_label(0);
  world->chat_options[1] = ruby2_world_room_chat_option_label(1);
}

static const char* ruby2_world_collect_line(Ruby2WorldObjectId object_id) {
  switch (object_id) {
    case RUBY2_WORLD_OBJECT_NOTEBOOK:
      return "The Notebook slides into the first empty slot.";
    case RUBY2_WORLD_OBJECT_FLASHCARDS:
      return "The Flashcards snap into your bag, two clean reviews left.";
    case RUBY2_WORLD_OBJECT_LUNCH_TRAY:
      return "The Lunch Tray joins your bag. Cafeteria diplomacy is now portable.";
    case RUBY2_WORLD_OBJECT_OFFICE_PASS:
      return "The Office Pass folds into your bag. Recovery is now a verb.";
    case RUBY2_WORLD_OBJECT_LIBRARY_CARD:
      return "The Library Card clicks into place. Quiet doors know your name now.";
    case RUBY2_WORLD_OBJECT_LAB_FLASK:
      return "The Lab Flask settles into your bag. Evidence can travel.";
    default:
      return "The item joins your bag.";
  }
}

static void ruby2_world_start_lunch_if_ready(Ruby2World* world) {
  if (!world || !world->homeroom_resolved || world->lunch_started) return;

  world->lunch_started = true;
  ruby2_world_clear_chat_cooldowns(world);
  world->game.current_time_block = RUBY2_TIME_LUNCH;
  world->npc_rooms[RUBY2_CHARACTER_RUBY] = RUBY2_ROOM_HOMEROOM;
  world->npc_rooms[RUBY2_CHARACTER_RAVI] = RUBY2_ROOM_HALLWAY;
  world->npc_rooms[RUBY2_CHARACTER_LYRA] = RUBY2_ROOM_CAFETERIA;
  world->npc_rooms[RUBY2_CHARACTER_NOOR] = RUBY2_ROOM_CAFETERIA;
  world->npc_rooms[RUBY2_CHARACTER_INDRA] = RUBY2_ROOM_LIBRARY;
  world->npc_rooms[RUBY2_CHARACTER_MIKA] = RUBY2_ROOM_SCIENCE_LAB;
  world->npc_rooms[RUBY2_CHARACTER_SAMI] = RUBY2_ROOM_COURTYARD;

  switch (world->homeroom_approach_action) {
    case RUBY2_ACTION_APPROACH_SOURCE:
      world->npc_rooms[RUBY2_CHARACTER_RAVI] = RUBY2_ROOM_CAFETERIA;
      break;
    case RUBY2_ACTION_APPROACH_SENSE:
      world->npc_rooms[RUBY2_CHARACTER_INDRA] = RUBY2_ROOM_CAFETERIA;
      world->npc_rooms[RUBY2_CHARACTER_NOOR] = RUBY2_ROOM_CAFETERIA;
      break;
    case RUBY2_ACTION_APPROACH_SYNC:
      world->npc_rooms[RUBY2_CHARACTER_RAVI] = RUBY2_ROOM_CAFETERIA;
      world->npc_rooms[RUBY2_CHARACTER_MIKA] = RUBY2_ROOM_CAFETERIA;
      break;
    case RUBY2_ACTION_APPROACH_SIGNAL:
      world->npc_rooms[RUBY2_CHARACTER_INDRA] = RUBY2_ROOM_HALLWAY;
      break;
    default:
      break;
  }

  world->objects[RUBY2_WORLD_OBJECT_RECEIPT].present = true;
  world->objects[RUBY2_WORLD_OBJECT_RECEIPT].room = RUBY2_ROOM_CAFETERIA;
  if (!world->game.items[RUBY2_ITEM_LUNCH_TRAY].owned) {
    world->objects[RUBY2_WORLD_OBJECT_LUNCH_TRAY].present = true;
    world->objects[RUBY2_WORLD_OBJECT_LUNCH_TRAY].room = RUBY2_ROOM_CAFETERIA;
  }

  ruby2_world_push_event(
    world,
    RUBY2_EVENT_TIME_ADVANCED,
    world->game.current_room_id,
    RUBY2_CHARACTER_NONE,
    RUBY2_WORLD_OBJECT_NOTEBOOK,
    RUBY2_ACTION_WAIT_BELL,
    "The bell moves the school into lunch."
  );
  ruby2_world_push_event(
    world,
    RUBY2_EVENT_NPC_MOVED,
    RUBY2_ROOM_CAFETERIA,
    RUBY2_CHARACTER_NOOR,
    RUBY2_WORLD_OBJECT_NOTEBOOK,
    RUBY2_ACTION_WAIT_BELL,
    "Noor drifts to the Cafeteria before the receipt does anything interesting."
  );
  if (world->homeroom_approach_action == RUBY2_ACTION_APPROACH_SOURCE) {
    ruby2_world_push_event(
      world,
      RUBY2_EVENT_NPC_MOVED,
      RUBY2_ROOM_CAFETERIA,
      RUBY2_CHARACTER_RAVI,
      RUBY2_WORLD_OBJECT_WORK_ORDER,
      RUBY2_ACTION_WAIT_BELL,
      "Ravi follows the work order to lunch because evidence should not eat alone."
    );
  } else if (world->homeroom_approach_action == RUBY2_ACTION_APPROACH_SENSE) {
    ruby2_world_push_event(
      world,
      RUBY2_EVENT_NPC_MOVED,
      RUBY2_ROOM_CAFETERIA,
      RUBY2_CHARACTER_INDRA,
      RUBY2_WORLD_OBJECT_RECEIPT,
      RUBY2_ACTION_WAIT_BELL,
      "Indra is already near the tray rail, watching the word original do too much work."
    );
  } else if (world->homeroom_approach_action == RUBY2_ACTION_APPROACH_SYNC) {
    ruby2_world_push_event(
      world,
      RUBY2_EVENT_NPC_MOVED,
      RUBY2_ROOM_CAFETERIA,
      RUBY2_CHARACTER_MIKA,
      RUBY2_WORLD_OBJECT_LUNCH_TRAY,
      RUBY2_ACTION_WAIT_BELL,
      "Mika saves two seats so the shared-stamp plan has somewhere to land."
    );
  }
  ruby2_world_push_event(
    world,
    RUBY2_EVENT_OBJECT_APPEARED,
    RUBY2_ROOM_CAFETERIA,
    RUBY2_CHARACTER_NONE,
    RUBY2_WORLD_OBJECT_RECEIPT,
    RUBY2_ACTION_WAIT_BELL,
    "A zero-dollar receipt waits on the Cafeteria tray rail."
  );
}

static void ruby2_world_trigger_room_events(Ruby2World* world) {
  if (!world) return;
  if (world->game.current_room_id == RUBY2_ROOM_CAFETERIA &&
      world->lunch_started &&
      world->objects[RUBY2_WORLD_OBJECT_RECEIPT].present &&
      !world->cafeteria_social_triggered) {
    world->cafeteria_social_triggered = true;
    ruby2_world_push_event(
      world,
      RUBY2_EVENT_SOCIAL_TRIGGERED,
      RUBY2_ROOM_CAFETERIA,
      RUBY2_CHARACTER_NOOR,
      RUBY2_WORLD_OBJECT_RECEIPT,
      RUBY2_ACTION_GO_CAFETERIA,
      "Noor notices the zero-dollar receipt before anyone can turn it into a normal lunch."
    );
  }
}

static void ruby2_world_apply_bell_pressure(Ruby2World* world) {
  if (!world ||
      world->homeroom_started ||
      world->homeroom_resolved ||
      world->chat_active ||
      world->game.current_time_block != RUBY2_TIME_ARRIVAL ||
      world->game.current_room_id == RUBY2_ROOM_HOMEROOM) {
    return;
  }

  Ruby2EffectPayload payload;
  ruby2_effect_payload_init(&payload);
  payload.clock_deltas[RUBY2_CLOCK_BELL] = 1;
  if (world->game.clocks[RUBY2_CLOCK_BELL].value >= 1) {
    payload.clock_deltas[RUBY2_CLOCK_STRESS] = 1;
  }
  ruby2_apply_effect_payload(&world->game, &payload);

  if (world->game.clocks[RUBY2_CLOCK_BELL].value >= 4) {
    if (world->game.current_room_id != RUBY2_ROOM_HOMEROOM) {
      ruby2_world_clear_recent_actions(world);
    }
    world->game.current_room_id = RUBY2_ROOM_HOMEROOM;
    if (ruby2_world_notebook_owned(world)) {
      world->objects[RUBY2_WORLD_OBJECT_NOTEBOOK].room = RUBY2_ROOM_HOMEROOM;
    }
    ruby2_world_push_event(
      world,
      RUBY2_EVENT_DIRECTOR_TRIGGERED,
      RUBY2_ROOM_HOMEROOM,
      RUBY2_CHARACTER_RUBY,
      RUBY2_WORLD_OBJECT_NOTEBOOK,
      RUBY2_ACTION_WAIT_BELL,
      "The final bell catches you. Ruby redirects the day back to Homeroom."
    );
    ruby2_world_push_event(
      world,
      RUBY2_EVENT_ROOM_ENTERED,
      RUBY2_ROOM_HOMEROOM,
      RUBY2_CHARACTER_NONE,
      RUBY2_WORLD_OBJECT_NOTEBOOK,
      RUBY2_ACTION_GO_HOMEROOM,
      "You arrive in Homeroom with the bell already keeping score."
    );
  } else {
    ruby2_world_push_event(
      world,
      RUBY2_EVENT_DIRECTOR_TRIGGERED,
      world->game.current_room_id,
      RUBY2_CHARACTER_RUBY,
      RUBY2_WORLD_OBJECT_NOTEBOOK,
      RUBY2_ACTION_WAIT_BELL,
      "The first bell makes Homeroom feel less optional."
    );
  }

  ruby2_sync_state_variables(&world->game);
}

static void ruby2_world_run_director(Ruby2World* world) {
  if (!world) return;
  ruby2_world_apply_bell_pressure(world);
  ruby2_world_start_lunch_if_ready(world);
  ruby2_world_trigger_room_events(world);
  ruby2_sync_state_variables(&world->game);
}

static void ruby2_world_apply_approach(Ruby2World* world, Ruby2WorldActionId action_id) {
  Ruby2EffectPayload payload;
  ruby2_effect_payload_init(&payload);
  payload.create_yearbook_candidate = true;
  payload.milestone_kind = RUBY2_MILESTONE_CLASS_REPORT;
  payload.candidate_score = 9;

  switch (action_id) {
    case RUBY2_ACTION_APPROACH_SOURCE:
      payload.discipline_deltas[RUBY2_DISCIPLINE_SOURCE] = 1;
      payload.virtue_deltas[RUBY2_VIRTUE_HONOR] = 1;
      payload.affinity_deltas[RUBY2_CHARACTER_RAVI] = 1;
      payload.reputation_tag = RUBY2_ARCHETYPE_CONSCIENCE;
      payload.candidate_id = 6001;
      break;
    case RUBY2_ACTION_APPROACH_SENSE:
      payload.discipline_deltas[RUBY2_DISCIPLINE_SENSE] = 1;
      payload.virtue_deltas[RUBY2_VIRTUE_HEAD] = 1;
      payload.affinity_deltas[RUBY2_CHARACTER_LYRA] = 1;
      payload.reputation_tag = RUBY2_ARCHETYPE_SCHOLAR;
      payload.candidate_id = 6002;
      break;
    case RUBY2_ACTION_APPROACH_SYNC:
      payload.discipline_deltas[RUBY2_DISCIPLINE_SYNC] = 1;
      payload.virtue_deltas[RUBY2_VIRTUE_HEART] = 1;
      payload.affinity_deltas[RUBY2_CHARACTER_LYRA] = 1;
      payload.reputation_tag = RUBY2_ARCHETYPE_CONNECTOR;
      payload.candidate_id = 6004;
      break;
    case RUBY2_ACTION_APPROACH_SIGNAL:
      payload.discipline_deltas[RUBY2_DISCIPLINE_SIGNAL] = 1;
      payload.virtue_deltas[RUBY2_VIRTUE_HONOR] = 1;
      payload.affinity_deltas[RUBY2_CHARACTER_NOOR] = 1;
      payload.clock_deltas[RUBY2_CLOCK_NULL_SIGNAL] = 1;
      payload.reputation_tag = RUBY2_ARCHETYPE_SIGNAL_READER;
      payload.candidate_id = 6003;
      break;
    default:
      return;
  }

  ruby2_apply_effect_payload(&world->game, &payload);
  world->homeroom_approach_action = action_id;
  world->homeroom_resolved = true;
  (void)ruby2_resolve_archetypes(&world->game);
}

void ruby2_world_init(Ruby2World* world) {
  if (!world) return;
  memset(world, 0, sizeof(*world));
  ruby2_state_init(&world->game);

  world->game.current_room_id = RUBY2_ROOM_HALLWAY;
  world->game.current_time_block = RUBY2_TIME_ARRIVAL;
  world->has_last_action = false;
  world->last_action_id = RUBY2_ACTION_NONE;
  world->last_action_room = RUBY2_ROOM_COUNT;
  world->recent_action_count = 0;
  world->player_profile_ready = false;
  world->player_avatar = RUBY2_PLAYER_AVATAR_UNSET;
  world->chat_character = RUBY2_CHARACTER_NONE;
  world->chat_room = RUBY2_ROOM_COUNT;
  world->homeroom_approach_action = RUBY2_ACTION_NONE;

  for (uint8_t i = 0; i < RUBY2_CHARACTER_COUNT; ++i) {
    world->npc_rooms[i] = RUBY2_ROOM_COUNT;
  }
  world->npc_rooms[RUBY2_CHARACTER_RUBY] = RUBY2_ROOM_HOMEROOM;
  world->npc_rooms[RUBY2_CHARACTER_RAVI] = RUBY2_ROOM_HOMEROOM;
  world->npc_rooms[RUBY2_CHARACTER_LYRA] = RUBY2_ROOM_HOMEROOM;
  world->npc_rooms[RUBY2_CHARACTER_MIKA] = RUBY2_ROOM_SCIENCE_LAB;
  world->npc_rooms[RUBY2_CHARACTER_INDRA] = RUBY2_ROOM_LIBRARY;
  world->npc_rooms[RUBY2_CHARACTER_NOOR] = RUBY2_ROOM_CAFETERIA;
  world->npc_rooms[RUBY2_CHARACTER_SAMI] = RUBY2_ROOM_COURTYARD;

  world->objects[RUBY2_WORLD_OBJECT_ANSWER_CARD].present = true;
  world->objects[RUBY2_WORLD_OBJECT_ANSWER_CARD].room = RUBY2_ROOM_HOMEROOM;
  world->objects[RUBY2_WORLD_OBJECT_WORK_ORDER].present = true;
  world->objects[RUBY2_WORLD_OBJECT_WORK_ORDER].room = RUBY2_ROOM_HOMEROOM;
  world->objects[RUBY2_WORLD_OBJECT_RECEIPT].present = false;
  world->objects[RUBY2_WORLD_OBJECT_RECEIPT].room = RUBY2_ROOM_CAFETERIA;
  world->objects[RUBY2_WORLD_OBJECT_NOTEBOOK].present = true;
  world->objects[RUBY2_WORLD_OBJECT_NOTEBOOK].room = RUBY2_ROOM_HALLWAY;
  world->objects[RUBY2_WORLD_OBJECT_FLASHCARDS].present = true;
  world->objects[RUBY2_WORLD_OBJECT_FLASHCARDS].room = RUBY2_ROOM_HOMEROOM;
  world->objects[RUBY2_WORLD_OBJECT_LUNCH_TRAY].present = false;
  world->objects[RUBY2_WORLD_OBJECT_LUNCH_TRAY].room = RUBY2_ROOM_CAFETERIA;
  world->objects[RUBY2_WORLD_OBJECT_OFFICE_PASS].present = true;
  world->objects[RUBY2_WORLD_OBJECT_OFFICE_PASS].room = RUBY2_ROOM_TEACHER_OFFICE;
  world->objects[RUBY2_WORLD_OBJECT_LIBRARY_CARD].present = true;
  world->objects[RUBY2_WORLD_OBJECT_LIBRARY_CARD].room = RUBY2_ROOM_LIBRARY;
  world->objects[RUBY2_WORLD_OBJECT_LAB_FLASK].present = true;
  world->objects[RUBY2_WORLD_OBJECT_LAB_FLASK].room = RUBY2_ROOM_SCIENCE_LAB;

  ruby2_sync_state_variables(&world->game);
  ruby2_world_push_event(
    world,
    RUBY2_EVENT_ROOM_ENTERED,
    RUBY2_ROOM_HALLWAY,
    RUBY2_CHARACTER_NONE,
    RUBY2_WORLD_OBJECT_NOTEBOOK,
    RUBY2_ACTION_GO_HALLWAY,
    "You are in the Hallway. Homeroom is reachable before the bell makes it non-optional."
  );
}

const Ruby2WorldRoom* ruby2_world_room(Ruby2RoomId room_id) {
  if (room_id >= RUBY2_ROOM_COUNT) return NULL;
  return &ruby2_world_rooms[room_id];
}

const char* ruby2_world_character_name(Ruby2CharacterId character_id) {
  static const char* names[] = {
    "Ruby", "Lyra", "Mika", "Ravi", "Indra", "Noor", "Sami"
  };
  return character_id < RUBY2_CHARACTER_COUNT ? names[character_id] : "Unknown";
}

const char* ruby2_world_object_name(Ruby2WorldObjectId object_id) {
  static const char* names[] = {
    "answer card",
    "wet work order",
    "zero-dollar receipt",
    "Notebook",
    "Flashcards",
    "Lunch Tray",
    "Office Pass",
    "Library Card",
    "Lab Flask"
  };
  return object_id < RUBY2_WORLD_OBJECT_COUNT ? names[object_id] : "unknown object";
}

const char* ruby2_world_action_label(Ruby2WorldActionId action_id) {
  switch (action_id) {
    case RUBY2_ACTION_GO_HALLWAY: return "Go to Hallway";
    case RUBY2_ACTION_GO_HOMEROOM: return "Go to Homeroom";
    case RUBY2_ACTION_GO_SCIENCE_LAB: return "Go to Science Lab";
    case RUBY2_ACTION_GO_LIBRARY: return "Go to Library";
    case RUBY2_ACTION_GO_CAFETERIA: return "Go to Cafeteria";
    case RUBY2_ACTION_GO_GREENHOUSE: return "Go to Greenhouse";
    case RUBY2_ACTION_GO_COURTYARD: return "Go to Courtyard";
    case RUBY2_ACTION_GO_TEACHER_OFFICE: return "Go to Teacher Office";
    case RUBY2_ACTION_SELECT_AVATAR_SOURCE: return "Source: prove what changed.";
    case RUBY2_ACTION_SELECT_AVATAR_SENSE: return "Sense: read what it means.";
    case RUBY2_ACTION_SELECT_AVATAR_SYNC: return "Sync: bring people together.";
    case RUBY2_ACTION_SELECT_AVATAR_SIGNAL: return "Signal: notice what answers back.";
    case RUBY2_ACTION_CHAT_ROOM: return "Chat";
    case RUBY2_ACTION_TALK_RUBY: return "Talk to Ruby";
    case RUBY2_ACTION_TALK_LYRA: return "Talk to Lyra";
    case RUBY2_ACTION_TALK_MIKA: return "Talk to Mika";
    case RUBY2_ACTION_TALK_RAVI: return "Talk to Ravi";
    case RUBY2_ACTION_TALK_INDRA: return "Talk to Indra";
    case RUBY2_ACTION_TALK_NOOR: return "Talk to Noor";
    case RUBY2_ACTION_TALK_SAMI: return "Talk to Sami";
    case RUBY2_ACTION_ATTEND_HOMEROOM: return "Attend Homeroom";
    case RUBY2_ACTION_APPROACH_SOURCE: return "Compare the answer card with the wet work-order stamp.";
    case RUBY2_ACTION_APPROACH_SENSE: return "Ask what original is supposed to mean.";
    case RUBY2_ACTION_APPROACH_SYNC: return "Ask Ravi and Lyra what each of them can verify.";
    case RUBY2_ACTION_APPROACH_SIGNAL: return "Circle the footer Ruby says she did not print.";
    case RUBY2_ACTION_INSPECT_RECEIPT: return "Inspect the zero-dollar receipt.";
    case RUBY2_ACTION_COLLECT_NOTEBOOK: return "Pick up the Notebook.";
    case RUBY2_ACTION_COLLECT_FLASHCARDS: return "Pick up the Flashcards.";
    case RUBY2_ACTION_COLLECT_LUNCH_TRAY: return "Take the Lunch Tray.";
    case RUBY2_ACTION_COLLECT_OFFICE_PASS: return "Pick up the Office Pass.";
    case RUBY2_ACTION_COLLECT_LIBRARY_CARD: return "Pick up the Library Card.";
    case RUBY2_ACTION_COLLECT_LAB_FLASK: return "Pick up the Lab Flask.";
    case RUBY2_ACTION_CHAT_OPTION_A: return "Continue the conversation.";
    case RUBY2_ACTION_CHAT_OPTION_B: return "Take the other angle.";
    case RUBY2_ACTION_CHECK_NOTEBOOK: return "Check Notebook";
    case RUBY2_ACTION_WAIT_BELL: return "Wait for the bell";
    case RUBY2_ACTION_NONE: return "No player action";
    default: return "Unknown action";
  }
}

const char* ruby2_world_event_name(Ruby2WorldEventKind event_kind) {
  static const char* names[] = {
    "room_entered",
    "npc_moved",
    "object_appeared",
    "time_advanced",
    "class_started",
    "approach_resolved",
    "social_triggered",
    "object_inspected",
    "item_collected",
    "notebook_updated",
    "agent_spoke",
    "agent_remembered",
    "agent_intent_rejected",
    "director_triggered",
    "idle"
  };
  return event_kind <= RUBY2_EVENT_IDLE ? names[event_kind] : "unknown_event";
}

const char* ruby2_agent_intent_result_name(Ruby2AgentIntentResult result) {
  static const char* names[] = {
    "accepted",
    "rejected_invalid_actor",
    "rejected_invalid_target",
    "rejected_not_copresent",
    "rejected_blocked_route",
    "rejected_object_absent",
    "rejected_empty_text"
  };
  return result <= RUBY2_AGENT_INTENT_REJECTED_EMPTY_TEXT ? names[result] : "rejected_unknown";
}

bool ruby2_world_event_visible_to_player(const Ruby2WorldEvent* event) {
  return event && event->visibility == RUBY2_EVENT_VISIBLE_TO_PLAYER;
}

bool ruby2_world_character_present(const Ruby2World* world, Ruby2CharacterId character_id, Ruby2RoomId room_id) {
  return world && character_id < RUBY2_CHARACTER_COUNT && world->npc_rooms[character_id] == room_id;
}

bool ruby2_world_object_present(const Ruby2World* world, Ruby2WorldObjectId object_id, Ruby2RoomId room_id) {
  return world && object_id < RUBY2_WORLD_OBJECT_COUNT &&
         world->objects[object_id].present &&
         world->objects[object_id].room == room_id;
}

void ruby2_world_query_actions(const Ruby2World* world, Ruby2WorldActionList* out) {
  if (!world || !out) return;
  memset(out, 0, sizeof(*out));

  Ruby2RoomId room_id = world->game.current_room_id;
  if (!world->player_profile_ready) {
    ruby2_world_add_action(out, RUBY2_ACTION_SELECT_AVATAR_SOURCE, RUBY2_WORLD_ACTION_PROFILE, room_id, RUBY2_CHARACTER_NONE, RUBY2_WORLD_OBJECT_NOTEBOOK, RUBY2_DISCIPLINE_SOURCE, RUBY2_VIRTUE_HONOR, ruby2_world_action_label(RUBY2_ACTION_SELECT_AVATAR_SOURCE));
    ruby2_world_add_action(out, RUBY2_ACTION_SELECT_AVATAR_SENSE, RUBY2_WORLD_ACTION_PROFILE, room_id, RUBY2_CHARACTER_NONE, RUBY2_WORLD_OBJECT_NOTEBOOK, RUBY2_DISCIPLINE_SENSE, RUBY2_VIRTUE_HEAD, ruby2_world_action_label(RUBY2_ACTION_SELECT_AVATAR_SENSE));
    ruby2_world_add_action(out, RUBY2_ACTION_SELECT_AVATAR_SIGNAL, RUBY2_WORLD_ACTION_PROFILE, room_id, RUBY2_CHARACTER_NONE, RUBY2_WORLD_OBJECT_NOTEBOOK, RUBY2_DISCIPLINE_SIGNAL, RUBY2_VIRTUE_HONOR, ruby2_world_action_label(RUBY2_ACTION_SELECT_AVATAR_SIGNAL));
    ruby2_world_add_action(out, RUBY2_ACTION_SELECT_AVATAR_SYNC, RUBY2_WORLD_ACTION_PROFILE, room_id, RUBY2_CHARACTER_NONE, RUBY2_WORLD_OBJECT_NOTEBOOK, RUBY2_DISCIPLINE_SYNC, RUBY2_VIRTUE_HEART, ruby2_world_action_label(RUBY2_ACTION_SELECT_AVATAR_SYNC));
    // Profile actions are only available before character selection and should not require anti-repeat handling.
    return;
  }

  if (world->chat_active &&
      world->chat_room == room_id &&
      world->chat_character < RUBY2_CHARACTER_COUNT &&
      ruby2_world_character_present(world, world->chat_character, room_id)) {
    ruby2_world_add_action(
      out,
      RUBY2_ACTION_CHAT_OPTION_A,
      RUBY2_WORLD_ACTION_CHAT_CHOICE,
      room_id,
      world->chat_character,
      ruby2_world_default_object_for_character(world->chat_character),
      RUBY2_DISCIPLINE_SOURCE,
      RUBY2_VIRTUE_HEAD,
      world->chat_options[0] ? world->chat_options[0] : ruby2_world_action_label(RUBY2_ACTION_CHAT_OPTION_A)
    );
    ruby2_world_add_action(
      out,
      RUBY2_ACTION_CHAT_OPTION_B,
      RUBY2_WORLD_ACTION_CHAT_CHOICE,
      room_id,
      world->chat_character,
      ruby2_world_default_object_for_character(world->chat_character),
      RUBY2_DISCIPLINE_SYNC,
      RUBY2_VIRTUE_HEART,
      world->chat_options[1] ? world->chat_options[1] : ruby2_world_action_label(RUBY2_ACTION_CHAT_OPTION_B)
    );
    ruby2_world_dismiss_last_action(out, world);
    return;
  }

  const Ruby2WorldRoom* room = ruby2_world_room(room_id);
  if (room) {
    for (uint8_t i = 0; i < room->exit_count; ++i) {
      Ruby2RoomId target = room->exits[i];
      if (!world->game.room_unlocked[target]) continue;
      Ruby2WorldActionId action_id = ruby2_world_go_action_for_room(target);
      if (action_id == RUBY2_ACTION_NONE) continue;
      ruby2_world_add_action(
        out,
        action_id,
        RUBY2_WORLD_ACTION_GO,
        target,
        RUBY2_CHARACTER_NONE,
        RUBY2_WORLD_OBJECT_NOTEBOOK,
        RUBY2_DISCIPLINE_SYNC,
        RUBY2_VIRTUE_HUSTLE,
        ruby2_world_action_label(action_id)
      );
    }
  }

  if (room_id == RUBY2_ROOM_HOMEROOM && !world->homeroom_started) {
    ruby2_world_add_action(
      out,
      RUBY2_ACTION_ATTEND_HOMEROOM,
      RUBY2_WORLD_ACTION_ATTEND,
      RUBY2_ROOM_HOMEROOM,
      RUBY2_CHARACTER_RUBY,
      RUBY2_WORLD_OBJECT_ANSWER_CARD,
      RUBY2_DISCIPLINE_SENSE,
      RUBY2_VIRTUE_HEAD,
      ruby2_world_action_label(RUBY2_ACTION_ATTEND_HOMEROOM)
    );
  }

  if (room_id == RUBY2_ROOM_HOMEROOM && world->homeroom_started && !world->homeroom_resolved) {
    ruby2_world_add_action(out, RUBY2_ACTION_APPROACH_SOURCE, RUBY2_WORLD_ACTION_APPROACH, room_id, RUBY2_CHARACTER_RUBY, RUBY2_WORLD_OBJECT_WORK_ORDER, RUBY2_DISCIPLINE_SOURCE, RUBY2_VIRTUE_HONOR, ruby2_world_action_label(RUBY2_ACTION_APPROACH_SOURCE));
    ruby2_world_add_action(out, RUBY2_ACTION_APPROACH_SENSE, RUBY2_WORLD_ACTION_APPROACH, room_id, RUBY2_CHARACTER_RUBY, RUBY2_WORLD_OBJECT_ANSWER_CARD, RUBY2_DISCIPLINE_SENSE, RUBY2_VIRTUE_HEAD, ruby2_world_action_label(RUBY2_ACTION_APPROACH_SENSE));
    ruby2_world_add_action(out, RUBY2_ACTION_APPROACH_SYNC, RUBY2_WORLD_ACTION_APPROACH, room_id, RUBY2_CHARACTER_LYRA, RUBY2_WORLD_OBJECT_WORK_ORDER, RUBY2_DISCIPLINE_SYNC, RUBY2_VIRTUE_HEART, ruby2_world_action_label(RUBY2_ACTION_APPROACH_SYNC));
    ruby2_world_add_action(out, RUBY2_ACTION_APPROACH_SIGNAL, RUBY2_WORLD_ACTION_APPROACH, room_id, RUBY2_CHARACTER_NOOR, RUBY2_WORLD_OBJECT_ANSWER_CARD, RUBY2_DISCIPLINE_SIGNAL, RUBY2_VIRTUE_HONOR, ruby2_world_action_label(RUBY2_ACTION_APPROACH_SIGNAL));
  }

  if (ruby2_world_room_quiz_available(world, room_id)) {
    Ruby2CharacterId speaker = ruby2_world_room_quiz_speaker(room_id);
    Ruby2WorldObjectId object_id = ruby2_world_room_quiz_object(room_id);
    ruby2_world_add_action(
      out,
      RUBY2_ACTION_APPROACH_SOURCE,
      RUBY2_WORLD_ACTION_APPROACH,
      room_id,
      speaker,
      object_id,
      RUBY2_DISCIPLINE_SOURCE,
      RUBY2_VIRTUE_HEAD,
      ruby2_world_room_quiz_action_label(room_id, RUBY2_ACTION_APPROACH_SOURCE)
    );
    ruby2_world_add_action(
      out,
      RUBY2_ACTION_APPROACH_SENSE,
      RUBY2_WORLD_ACTION_APPROACH,
      room_id,
      speaker,
      object_id,
      RUBY2_DISCIPLINE_SENSE,
      RUBY2_VIRTUE_HONOR,
      ruby2_world_room_quiz_action_label(room_id, RUBY2_ACTION_APPROACH_SENSE)
    );
    ruby2_world_add_action(
      out,
      RUBY2_ACTION_APPROACH_SYNC,
      RUBY2_WORLD_ACTION_APPROACH,
      room_id,
      speaker,
      object_id,
      RUBY2_DISCIPLINE_SYNC,
      RUBY2_VIRTUE_HEART,
      ruby2_world_room_quiz_action_label(room_id, RUBY2_ACTION_APPROACH_SYNC)
    );
    ruby2_world_add_action(
      out,
      RUBY2_ACTION_APPROACH_SIGNAL,
      RUBY2_WORLD_ACTION_APPROACH,
      room_id,
      speaker,
      object_id,
      RUBY2_DISCIPLINE_SIGNAL,
      RUBY2_VIRTUE_HEAD,
      ruby2_world_room_quiz_action_label(room_id, RUBY2_ACTION_APPROACH_SIGNAL)
    );
  }

  if (ruby2_world_object_present(world, RUBY2_WORLD_OBJECT_RECEIPT, room_id) && !world->receipt_inspected) {
    ruby2_world_add_action(out, RUBY2_ACTION_INSPECT_RECEIPT, RUBY2_WORLD_ACTION_INSPECT, room_id, RUBY2_CHARACTER_NOOR, RUBY2_WORLD_OBJECT_RECEIPT, RUBY2_DISCIPLINE_SIGNAL, RUBY2_VIRTUE_HEAD, ruby2_world_action_label(RUBY2_ACTION_INSPECT_RECEIPT));
  }

  for (uint8_t i = 0; i < RUBY2_WORLD_OBJECT_COUNT; ++i) {
    Ruby2ItemId item_id;
    Ruby2WorldActionId action_id;
    if (!ruby2_world_object_item((Ruby2WorldObjectId)i, &item_id)) continue;
    if (!ruby2_world_collect_action_for_object((Ruby2WorldObjectId)i, &action_id)) continue;
    if (ruby2_world_object_present(world, (Ruby2WorldObjectId)i, room_id) &&
        !ruby2_world_item_owned(world, item_id)) {
      ruby2_world_add_action(
        out,
        action_id,
        RUBY2_WORLD_ACTION_COLLECT,
        room_id,
        RUBY2_CHARACTER_NONE,
        (Ruby2WorldObjectId)i,
        RUBY2_DISCIPLINE_SOURCE,
        RUBY2_VIRTUE_HUSTLE,
        ruby2_world_action_label(action_id)
      );
    }
  }

  Ruby2CharacterId room_speaker = ruby2_world_first_room_speaker(world, room_id);
  if (room_speaker < RUBY2_CHARACTER_COUNT &&
      !ruby2_world_recent_chat_resolved_in_room(world, room_id) &&
      !world->chat_resolved_rooms[room_id]) {
    ruby2_world_add_action(
      out,
      RUBY2_ACTION_CHAT_ROOM,
      RUBY2_WORLD_ACTION_TALK,
      room_id,
      room_speaker,
      ruby2_world_default_object_for_character(room_speaker),
      RUBY2_DISCIPLINE_SYNC,
      RUBY2_VIRTUE_HEART,
      ruby2_world_action_label(RUBY2_ACTION_CHAT_ROOM)
    );
  }

  if (ruby2_world_notebook_owned(world)) {
    ruby2_world_add_action(out, RUBY2_ACTION_CHECK_NOTEBOOK, RUBY2_WORLD_ACTION_CHECK_NOTES, room_id, RUBY2_CHARACTER_NONE, RUBY2_WORLD_OBJECT_NOTEBOOK, RUBY2_DISCIPLINE_SENSE, RUBY2_VIRTUE_HEAD, ruby2_world_action_label(RUBY2_ACTION_CHECK_NOTEBOOK));
  }
  ruby2_world_add_action(out, RUBY2_ACTION_WAIT_BELL, RUBY2_WORLD_ACTION_WAIT, room_id, RUBY2_CHARACTER_NONE, RUBY2_WORLD_OBJECT_NOTEBOOK, RUBY2_DISCIPLINE_SYNC, RUBY2_VIRTUE_HUSTLE, ruby2_world_action_label(RUBY2_ACTION_WAIT_BELL));

  ruby2_world_dismiss_last_action(out, world);
}

bool ruby2_world_command_from_action(Ruby2WorldActionId action_id, Ruby2WorldCommand* out) {
  if (!out || action_id >= RUBY2_ACTION_COUNT || action_id == RUBY2_ACTION_NONE) return false;
  memset(out, 0, sizeof(*out));
  out->action_id = action_id;
  out->target_room = RUBY2_ROOM_COUNT;
  out->target_character = RUBY2_CHARACTER_NONE;
  out->target_object = RUBY2_WORLD_OBJECT_NOTEBOOK;
  out->discipline = RUBY2_DISCIPLINE_SYNC;
  out->virtue = RUBY2_VIRTUE_HUSTLE;

  switch (action_id) {
    case RUBY2_ACTION_GO_HALLWAY:
      out->kind = RUBY2_WORLD_ACTION_GO;
      out->target_room = RUBY2_ROOM_HALLWAY;
      return true;
    case RUBY2_ACTION_GO_HOMEROOM:
      out->kind = RUBY2_WORLD_ACTION_GO;
      out->target_room = RUBY2_ROOM_HOMEROOM;
      return true;
    case RUBY2_ACTION_GO_SCIENCE_LAB:
      out->kind = RUBY2_WORLD_ACTION_GO;
      out->target_room = RUBY2_ROOM_SCIENCE_LAB;
      return true;
    case RUBY2_ACTION_GO_LIBRARY:
      out->kind = RUBY2_WORLD_ACTION_GO;
      out->target_room = RUBY2_ROOM_LIBRARY;
      return true;
    case RUBY2_ACTION_GO_CAFETERIA:
      out->kind = RUBY2_WORLD_ACTION_GO;
      out->target_room = RUBY2_ROOM_CAFETERIA;
      return true;
    case RUBY2_ACTION_GO_GREENHOUSE:
      out->kind = RUBY2_WORLD_ACTION_GO;
      out->target_room = RUBY2_ROOM_GREENHOUSE;
      return true;
    case RUBY2_ACTION_GO_COURTYARD:
      out->kind = RUBY2_WORLD_ACTION_GO;
      out->target_room = RUBY2_ROOM_COURTYARD;
      return true;
    case RUBY2_ACTION_GO_TEACHER_OFFICE:
      out->kind = RUBY2_WORLD_ACTION_GO;
      out->target_room = RUBY2_ROOM_TEACHER_OFFICE;
      return true;
    case RUBY2_ACTION_SELECT_AVATAR_SOURCE:
    case RUBY2_ACTION_SELECT_AVATAR_SENSE:
    case RUBY2_ACTION_SELECT_AVATAR_SYNC:
    case RUBY2_ACTION_SELECT_AVATAR_SIGNAL: {
      Ruby2PlayerAvatarId avatar_id = ruby2_world_avatar_for_action(action_id);
      out->kind = RUBY2_WORLD_ACTION_PROFILE;
      out->discipline = ruby2_world_avatar_discipline(avatar_id);
      out->virtue = ruby2_world_avatar_virtue(avatar_id);
      return true;
    }
    case RUBY2_ACTION_CHAT_ROOM:
      out->kind = RUBY2_WORLD_ACTION_TALK;
      out->target_character = RUBY2_CHARACTER_NONE;
      out->target_object = RUBY2_WORLD_OBJECT_NOTEBOOK;
      out->discipline = RUBY2_DISCIPLINE_SYNC;
      out->virtue = RUBY2_VIRTUE_HEART;
      return true;
    case RUBY2_ACTION_TALK_RUBY:
      out->kind = RUBY2_WORLD_ACTION_TALK;
      out->target_character = RUBY2_CHARACTER_RUBY;
      out->virtue = RUBY2_VIRTUE_HEART;
      return true;
    case RUBY2_ACTION_TALK_LYRA:
      out->kind = RUBY2_WORLD_ACTION_TALK;
      out->target_character = RUBY2_CHARACTER_LYRA;
      out->virtue = RUBY2_VIRTUE_HEART;
      return true;
    case RUBY2_ACTION_TALK_MIKA:
      out->kind = RUBY2_WORLD_ACTION_TALK;
      out->target_character = RUBY2_CHARACTER_MIKA;
      out->target_object = RUBY2_WORLD_OBJECT_LAB_FLASK;
      out->discipline = RUBY2_DISCIPLINE_SOURCE;
      out->virtue = RUBY2_VIRTUE_HEART;
      return true;
    case RUBY2_ACTION_TALK_RAVI:
      out->kind = RUBY2_WORLD_ACTION_TALK;
      out->target_character = RUBY2_CHARACTER_RAVI;
      out->target_object = RUBY2_WORLD_OBJECT_WORK_ORDER;
      out->discipline = RUBY2_DISCIPLINE_SOURCE;
      return true;
    case RUBY2_ACTION_TALK_INDRA:
      out->kind = RUBY2_WORLD_ACTION_TALK;
      out->target_character = RUBY2_CHARACTER_INDRA;
      out->target_object = RUBY2_WORLD_OBJECT_LIBRARY_CARD;
      out->discipline = RUBY2_DISCIPLINE_SENSE;
      out->virtue = RUBY2_VIRTUE_HONOR;
      return true;
    case RUBY2_ACTION_TALK_NOOR:
      out->kind = RUBY2_WORLD_ACTION_TALK;
      out->target_character = RUBY2_CHARACTER_NOOR;
      out->target_object = RUBY2_WORLD_OBJECT_RECEIPT;
      out->discipline = RUBY2_DISCIPLINE_SIGNAL;
      out->virtue = RUBY2_VIRTUE_HEAD;
      return true;
    case RUBY2_ACTION_TALK_SAMI:
      out->kind = RUBY2_WORLD_ACTION_TALK;
      out->target_character = RUBY2_CHARACTER_SAMI;
      out->target_object = RUBY2_WORLD_OBJECT_LUNCH_TRAY;
      out->discipline = RUBY2_DISCIPLINE_SYNC;
      out->virtue = RUBY2_VIRTUE_HEART;
      return true;
    case RUBY2_ACTION_ATTEND_HOMEROOM:
      out->kind = RUBY2_WORLD_ACTION_ATTEND;
      out->target_room = RUBY2_ROOM_HOMEROOM;
      out->target_character = RUBY2_CHARACTER_RUBY;
      out->target_object = RUBY2_WORLD_OBJECT_ANSWER_CARD;
      out->discipline = RUBY2_DISCIPLINE_SENSE;
      out->virtue = RUBY2_VIRTUE_HEAD;
      return true;
    case RUBY2_ACTION_APPROACH_SOURCE:
      out->kind = RUBY2_WORLD_ACTION_APPROACH;
      out->target_room = RUBY2_ROOM_HOMEROOM;
      out->target_character = RUBY2_CHARACTER_RUBY;
      out->target_object = RUBY2_WORLD_OBJECT_WORK_ORDER;
      out->discipline = RUBY2_DISCIPLINE_SOURCE;
      out->virtue = RUBY2_VIRTUE_HONOR;
      return true;
    case RUBY2_ACTION_APPROACH_SENSE:
      out->kind = RUBY2_WORLD_ACTION_APPROACH;
      out->target_room = RUBY2_ROOM_HOMEROOM;
      out->target_character = RUBY2_CHARACTER_RUBY;
      out->target_object = RUBY2_WORLD_OBJECT_ANSWER_CARD;
      out->discipline = RUBY2_DISCIPLINE_SENSE;
      out->virtue = RUBY2_VIRTUE_HEAD;
      return true;
    case RUBY2_ACTION_APPROACH_SYNC:
      out->kind = RUBY2_WORLD_ACTION_APPROACH;
      out->target_room = RUBY2_ROOM_HOMEROOM;
      out->target_character = RUBY2_CHARACTER_LYRA;
      out->target_object = RUBY2_WORLD_OBJECT_WORK_ORDER;
      out->discipline = RUBY2_DISCIPLINE_SYNC;
      out->virtue = RUBY2_VIRTUE_HEART;
      return true;
    case RUBY2_ACTION_APPROACH_SIGNAL:
      out->kind = RUBY2_WORLD_ACTION_APPROACH;
      out->target_room = RUBY2_ROOM_HOMEROOM;
      out->target_character = RUBY2_CHARACTER_NOOR;
      out->target_object = RUBY2_WORLD_OBJECT_ANSWER_CARD;
      out->discipline = RUBY2_DISCIPLINE_SIGNAL;
      out->virtue = RUBY2_VIRTUE_HONOR;
      return true;
    case RUBY2_ACTION_INSPECT_RECEIPT:
      out->kind = RUBY2_WORLD_ACTION_INSPECT;
      out->target_room = RUBY2_ROOM_CAFETERIA;
      out->target_character = RUBY2_CHARACTER_NOOR;
      out->target_object = RUBY2_WORLD_OBJECT_RECEIPT;
      out->discipline = RUBY2_DISCIPLINE_SIGNAL;
      out->virtue = RUBY2_VIRTUE_HEAD;
      return true;
    case RUBY2_ACTION_COLLECT_NOTEBOOK:
    case RUBY2_ACTION_COLLECT_FLASHCARDS:
    case RUBY2_ACTION_COLLECT_LUNCH_TRAY:
    case RUBY2_ACTION_COLLECT_OFFICE_PASS:
    case RUBY2_ACTION_COLLECT_LIBRARY_CARD:
    case RUBY2_ACTION_COLLECT_LAB_FLASK: {
      Ruby2WorldObjectId object_id;
      if (!ruby2_world_action_collect_object(action_id, &object_id)) return false;
      out->kind = RUBY2_WORLD_ACTION_COLLECT;
      out->target_object = object_id;
      out->target_room = RUBY2_ROOM_COUNT;
      out->discipline = RUBY2_DISCIPLINE_SOURCE;
      out->virtue = RUBY2_VIRTUE_HUSTLE;
      return true;
    }
    case RUBY2_ACTION_CHAT_OPTION_A:
      out->kind = RUBY2_WORLD_ACTION_CHAT_CHOICE;
      out->target_object = RUBY2_WORLD_OBJECT_NOTEBOOK;
      out->discipline = RUBY2_DISCIPLINE_SOURCE;
      out->virtue = RUBY2_VIRTUE_HEAD;
      return true;
    case RUBY2_ACTION_CHAT_OPTION_B:
      out->kind = RUBY2_WORLD_ACTION_CHAT_CHOICE;
      out->target_object = RUBY2_WORLD_OBJECT_NOTEBOOK;
      out->discipline = RUBY2_DISCIPLINE_SYNC;
      out->virtue = RUBY2_VIRTUE_HEART;
      return true;
    case RUBY2_ACTION_CHECK_NOTEBOOK:
      out->kind = RUBY2_WORLD_ACTION_CHECK_NOTES;
      out->discipline = RUBY2_DISCIPLINE_SENSE;
      out->virtue = RUBY2_VIRTUE_HEAD;
      return true;
    case RUBY2_ACTION_WAIT_BELL:
      out->kind = RUBY2_WORLD_ACTION_WAIT;
      return true;
    default:
      return false;
  }
}

bool ruby2_world_apply_command(Ruby2World* world, const Ruby2WorldCommand* command) {
  if (!world || !command) return false;
  if (!world->player_profile_ready && command->kind != RUBY2_WORLD_ACTION_PROFILE) return false;

  bool applied = false;
  const Ruby2RoomId action_room = world->game.current_room_id;

  switch (command->kind) {
    case RUBY2_WORLD_ACTION_PROFILE: {
      Ruby2PlayerAvatarId avatar_id = ruby2_world_avatar_for_action(command->action_id);
      if (world->player_profile_ready || avatar_id == RUBY2_PLAYER_AVATAR_UNSET) return false;
      world->tick++;
      world->player_profile_ready = true;
      world->player_avatar = avatar_id;
      ruby2_world_push_event(
        world,
        RUBY2_EVENT_NOTEBOOK_UPDATED,
        world->game.current_room_id,
        RUBY2_CHARACTER_NONE,
        RUBY2_WORLD_OBJECT_NOTEBOOK,
        command->action_id,
        ruby2_world_action_label(command->action_id)
      );
      applied = true;
      break;
    }

    case RUBY2_WORLD_ACTION_GO:
      if (command->target_room >= RUBY2_ROOM_COUNT ||
          !world->game.room_unlocked[command->target_room] ||
          !ruby2_room_has_exit(world->game.current_room_id, command->target_room)) {
        return false;
      }
      if (command->target_room != world->game.current_room_id) {
        ruby2_world_clear_recent_actions(world);
      }
      world->tick++;
      ruby2_world_clear_chat(world);
      world->game.current_room_id = command->target_room;
      if (ruby2_world_notebook_owned(world)) {
        world->objects[RUBY2_WORLD_OBJECT_NOTEBOOK].room = command->target_room;
      }
      ruby2_world_push_event(world, RUBY2_EVENT_ROOM_ENTERED, command->target_room, RUBY2_CHARACTER_NONE, RUBY2_WORLD_OBJECT_NOTEBOOK, command->action_id, ruby2_world_action_label(command->action_id));
      ruby2_world_run_director(world);
      applied = true;
      break;

    case RUBY2_WORLD_ACTION_ATTEND:
      if (world->game.current_room_id != RUBY2_ROOM_HOMEROOM || world->homeroom_started) return false;
      world->tick++;
      world->homeroom_started = true;
      ruby2_world_push_event(world, RUBY2_EVENT_CLASS_STARTED, RUBY2_ROOM_HOMEROOM, RUBY2_CHARACTER_RUBY, RUBY2_WORLD_OBJECT_ANSWER_CARD, command->action_id, "Ruby starts the work-order problem.");
      ruby2_world_run_director(world);
      applied = true;
      break;

    case RUBY2_WORLD_ACTION_APPROACH:
      if (world->game.current_room_id == RUBY2_ROOM_HOMEROOM) {
        if (!world->homeroom_started || world->homeroom_resolved) return false;
        world->tick++;
        ruby2_world_apply_approach(world, command->action_id);
        ruby2_world_push_event(world, RUBY2_EVENT_APPROACH_RESOLVED, RUBY2_ROOM_HOMEROOM, RUBY2_CHARACTER_RUBY, RUBY2_WORLD_OBJECT_WORK_ORDER, command->action_id, ruby2_world_action_label(command->action_id));
        ruby2_world_run_director(world);
        applied = true;
        break;
      }
      if (!ruby2_world_apply_room_quiz_approach(world, command->action_id)) return false;
      applied = true;
      break;

    case RUBY2_WORLD_ACTION_INSPECT: {
      if (command->target_object != RUBY2_WORLD_OBJECT_RECEIPT ||
          !ruby2_world_object_present(world, command->target_object, world->game.current_room_id) ||
          world->receipt_inspected) {
        return false;
      }
      world->tick++;
      Ruby2EffectPayload payload;
      ruby2_effect_payload_init(&payload);
      payload.discipline_deltas[RUBY2_DISCIPLINE_SIGNAL] = 1;
      payload.virtue_deltas[RUBY2_VIRTUE_HEAD] = 1;
      payload.clock_deltas[RUBY2_CLOCK_NULL_SIGNAL] = 1;
      payload.affinity_deltas[RUBY2_CHARACTER_NOOR] = 1;
      payload.create_yearbook_candidate = true;
      payload.milestone_kind = RUBY2_MILESTONE_SOCIAL_CLIMAX;
      payload.candidate_id = 7001;
      payload.candidate_score = 10;
      payload.reputation_tag = RUBY2_ARCHETYPE_SIGNAL_READER;
      ruby2_apply_effect_payload(&world->game, &payload);
      world->receipt_inspected = true;
      ruby2_world_push_event(world, RUBY2_EVENT_OBJECT_INSPECTED, RUBY2_ROOM_CAFETERIA, RUBY2_CHARACTER_NOOR, RUBY2_WORLD_OBJECT_RECEIPT, command->action_id, "The receipt repeats the footer from Homeroom.");
      ruby2_world_push_event(world, RUBY2_EVENT_NOTEBOOK_UPDATED, RUBY2_ROOM_CAFETERIA, RUBY2_CHARACTER_NONE, RUBY2_WORLD_OBJECT_NOTEBOOK, command->action_id, "Notebook margin: receipt copied exactly; signal now has a place to sit.");
      ruby2_world_open_chat(world, RUBY2_CHARACTER_NOOR);
      ruby2_world_run_director(world);
      applied = true;
      break;
    }

    case RUBY2_WORLD_ACTION_COLLECT: {
      Ruby2ItemId item_id;
      if (command->target_object >= RUBY2_WORLD_OBJECT_COUNT ||
          !ruby2_world_object_item(command->target_object, &item_id) ||
          !ruby2_world_object_present(world, command->target_object, world->game.current_room_id) ||
          world->game.items[item_id].owned) {
        return false;
      }
      world->tick++;
      world->game.items[item_id].owned = true;
      world->game.items[item_id].carried = true;
      world->game.items[item_id].charges = ruby2_world_item_starting_charges(item_id);
      world->objects[command->target_object].present = false;
      ruby2_sync_state_variables(&world->game);
      ruby2_world_push_event(
        world,
        RUBY2_EVENT_ITEM_COLLECTED,
        world->game.current_room_id,
        RUBY2_CHARACTER_NONE,
        command->target_object,
        command->action_id,
        ruby2_world_collect_line(command->target_object)
      );
      applied = true;
      break;
    }

    case RUBY2_WORLD_ACTION_TALK: {
      Ruby2CharacterId speaker = command->target_character;
      if (command->action_id == RUBY2_ACTION_CHAT_ROOM) {
        speaker = ruby2_world_first_room_speaker(world, world->game.current_room_id);
      }
      if (!ruby2_world_character_present(world, speaker, world->game.current_room_id)) return false;
      world->tick++;
      if (command->action_id == RUBY2_ACTION_CHAT_ROOM) {
        ruby2_world_open_room_chat(world, speaker);
        ruby2_world_push_event(world, RUBY2_EVENT_SOCIAL_TRIGGERED, world->game.current_room_id, speaker, ruby2_world_default_object_for_character(speaker), command->action_id, "You open the room to a real conversation.");
      } else {
        ruby2_world_open_chat(world, speaker);
        ruby2_world_push_event(world, RUBY2_EVENT_SOCIAL_TRIGGERED, world->game.current_room_id, speaker, command->target_object, command->action_id, "A classmate gives you two ways into the conversation.");
      }
      applied = true;
      break;
    }

    case RUBY2_WORLD_ACTION_CHAT_CHOICE: {
      uint8_t option_index;
      Ruby2CharacterId character;
      Ruby2EffectPayload payload;
      if (!world->chat_active ||
          world->chat_room != world->game.current_room_id ||
          world->chat_character >= RUBY2_CHARACTER_COUNT ||
          !ruby2_world_character_present(world, world->chat_character, world->game.current_room_id)) {
        return false;
      }
      if (command->action_id == RUBY2_ACTION_CHAT_OPTION_A) {
        option_index = 0;
      } else if (command->action_id == RUBY2_ACTION_CHAT_OPTION_B) {
        option_index = 1;
      } else {
        return false;
      }

      character = world->chat_character;
      world->tick++;
      ruby2_effect_payload_init(&payload);
      payload.affinity_deltas[character] = 1;
      if (option_index == 0) {
        payload.discipline_deltas[world->chat_room_mode ? RUBY2_DISCIPLINE_SOURCE : ruby2_world_default_discipline_for_character(character)] = 1;
        payload.virtue_deltas[RUBY2_VIRTUE_HEAD] = 1;
      } else {
        payload.discipline_deltas[RUBY2_DISCIPLINE_SYNC] = 1;
        payload.virtue_deltas[RUBY2_VIRTUE_HEART] = 1;
      }
      ruby2_apply_effect_payload(&world->game, &payload);
      ruby2_world_push_event(
        world,
        RUBY2_EVENT_SOCIAL_TRIGGERED,
        world->game.current_room_id,
        character,
        ruby2_world_default_object_for_character(character),
        command->action_id,
        world->chat_room_mode
          ? ruby2_world_room_chat_resolution_line(option_index)
          : ruby2_world_chat_resolution_line(character, option_index)
      );
      world->chat_resolved_rooms[world->game.current_room_id] = true;
      ruby2_world_clear_chat(world);
      applied = true;
      break;
    }

    case RUBY2_WORLD_ACTION_CHECK_NOTES:
      if (ruby2_use_item(&world->game, RUBY2_ITEM_NOTEBOOK) != RUBY2_ITEM_USE_ACCEPTED) return false;
      world->tick++;
      ruby2_world_push_event(world, RUBY2_EVENT_NOTEBOOK_UPDATED, world->game.current_room_id, RUBY2_CHARACTER_NONE, RUBY2_WORLD_OBJECT_NOTEBOOK, command->action_id, "The Notebook records where you are, who is present, and what the school is waiting on.");
      ruby2_world_run_director(world);
      applied = true;
      break;

    case RUBY2_WORLD_ACTION_WAIT:
      world->tick++;
      ruby2_world_push_event(world, RUBY2_EVENT_IDLE, world->game.current_room_id, RUBY2_CHARACTER_NONE, RUBY2_WORLD_OBJECT_NOTEBOOK, command->action_id, "You wait long enough for the school to move around you.");
      ruby2_world_run_director(world);
      applied = true;
      break;

    default:
      return false;
  }

  if (!applied) return false;
  ruby2_world_record_last_action(world, command->action_id, action_room);
  return true;
}

bool ruby2_world_apply_action(Ruby2World* world, Ruby2WorldActionId action_id) {
  Ruby2WorldCommand command;
  if (!ruby2_world_command_from_action(action_id, &command)) return false;
  return ruby2_world_apply_command(world, &command);
}

Ruby2AgentIntentResult ruby2_world_submit_agent_intent(Ruby2World* world, const Ruby2AgentIntent* intent) {
  if (!world || !intent || intent->character >= RUBY2_CHARACTER_COUNT) {
    return ruby2_world_reject_agent_intent(world, intent, RUBY2_AGENT_INTENT_REJECTED_INVALID_ACTOR);
  }

  Ruby2RoomId actor_room = world->npc_rooms[intent->character];
  if (actor_room >= RUBY2_ROOM_COUNT) {
    return ruby2_world_reject_agent_intent(world, intent, RUBY2_AGENT_INTENT_REJECTED_INVALID_ACTOR);
  }

  switch (intent->kind) {
    case RUBY2_AGENT_REQUEST_MOVE:
      if (intent->target_room >= RUBY2_ROOM_COUNT || !world->game.room_unlocked[intent->target_room]) {
        return ruby2_world_reject_agent_intent(world, intent, RUBY2_AGENT_INTENT_REJECTED_INVALID_TARGET);
      }
      if (!ruby2_room_has_exit(actor_room, intent->target_room)) {
        return ruby2_world_reject_agent_intent(world, intent, RUBY2_AGENT_INTENT_REJECTED_BLOCKED_ROUTE);
      }
      world->npc_rooms[intent->character] = intent->target_room;
      ruby2_world_push_event(
        world,
        RUBY2_EVENT_NPC_MOVED,
        intent->target_room,
        intent->character,
        RUBY2_WORLD_OBJECT_NOTEBOOK,
        RUBY2_ACTION_NONE,
        intent->text && intent->text[0] != '\0' ? intent->text : "An NPC moved through the school."
      );
      ruby2_world_trigger_room_events(world);
      return RUBY2_AGENT_INTENT_ACCEPTED;

    case RUBY2_AGENT_REQUEST_SPEAK:
      if (actor_room != world->game.current_room_id) {
        return ruby2_world_reject_agent_intent(world, intent, RUBY2_AGENT_INTENT_REJECTED_NOT_COPRESENT);
      }
      if (!intent->text || intent->text[0] == '\0') {
        return ruby2_world_reject_agent_intent(world, intent, RUBY2_AGENT_INTENT_REJECTED_EMPTY_TEXT);
      }
      ruby2_world_push_event(
        world,
        RUBY2_EVENT_AGENT_SPOKE,
        actor_room,
        intent->character,
        RUBY2_WORLD_OBJECT_NOTEBOOK,
        RUBY2_ACTION_NONE,
        intent->text
      );
      return RUBY2_AGENT_INTENT_ACCEPTED;

    case RUBY2_AGENT_INSPECT_OBJECT:
      if (intent->target_object >= RUBY2_WORLD_OBJECT_COUNT) {
        return ruby2_world_reject_agent_intent(world, intent, RUBY2_AGENT_INTENT_REJECTED_INVALID_TARGET);
      }
      if (!ruby2_world_object_present(world, intent->target_object, actor_room)) {
        return ruby2_world_reject_agent_intent(world, intent, RUBY2_AGENT_INTENT_REJECTED_OBJECT_ABSENT);
      }
      ruby2_world_push_event(
        world,
        RUBY2_EVENT_OBJECT_INSPECTED,
        actor_room,
        intent->character,
        intent->target_object,
        RUBY2_ACTION_NONE,
        intent->text && intent->text[0] != '\0' ? intent->text : "An NPC inspected an object."
      );
      return RUBY2_AGENT_INTENT_ACCEPTED;

    case RUBY2_AGENT_REMEMBER_EVENT:
      if (!intent->text || intent->text[0] == '\0') {
        return ruby2_world_reject_agent_intent(world, intent, RUBY2_AGENT_INTENT_REJECTED_EMPTY_TEXT);
      }
      ruby2_world_push_event_with_visibility(
        world,
        RUBY2_EVENT_AGENT_REMEMBERED,
        actor_room,
        intent->character,
        RUBY2_WORLD_OBJECT_NOTEBOOK,
        RUBY2_ACTION_NONE,
        RUBY2_EVENT_INTERNAL,
        intent->text
      );
      return RUBY2_AGENT_INTENT_ACCEPTED;

    default:
      return ruby2_world_reject_agent_intent(world, intent, RUBY2_AGENT_INTENT_REJECTED_INVALID_TARGET);
  }
}

static bool ruby2_world_recent_visible_event_for_room(
  const Ruby2World* world,
  Ruby2RoomId room,
  Ruby2WorldEvent* out
) {
  if (!world || !out || room >= RUBY2_ROOM_COUNT) return false;
  for (uint8_t i = world->events.count; i > 0; --i) {
    const Ruby2WorldEvent* event = &world->events.events[i - 1u];
    if (ruby2_world_event_visible_to_player(event) && event->room == room) {
      *out = *event;
      return true;
    }
  }
  return false;
}

bool ruby2_world_build_agent_perception(
  const Ruby2World* world,
  Ruby2CharacterId character_id,
  Ruby2AgentPerception* out
) {
  if (!world || !out || character_id >= RUBY2_CHARACTER_COUNT) return false;
  memset(out, 0, sizeof(*out));

  out->character = character_id;
  out->actor_room = world->npc_rooms[character_id];
  if (out->actor_room >= RUBY2_ROOM_COUNT) return false;
  out->player_room = world->game.current_room_id;
  out->time_block = world->game.current_time_block;
  out->co_present_with_player = out->actor_room == out->player_room;
  out->homeroom_started = world->homeroom_started;
  out->homeroom_resolved = world->homeroom_resolved;
  out->lunch_started = world->lunch_started;
  out->cafeteria_social_triggered = world->cafeteria_social_triggered;
  out->receipt_inspected = world->receipt_inspected;

  for (uint8_t i = 0; i < RUBY2_CLOCK_COUNT; ++i) {
    out->clocks[i] = world->game.clocks[i].value;
  }
  for (uint8_t i = 0; i < RUBY2_CHARACTER_COUNT; ++i) {
    if (i != character_id && world->npc_rooms[i] == out->actor_room && out->visible_people_count < RUBY2_CHARACTER_COUNT) {
      out->visible_people[out->visible_people_count++] = (Ruby2CharacterId)i;
    }
  }
  for (uint8_t i = 0; i < RUBY2_WORLD_OBJECT_COUNT; ++i) {
    if (world->objects[i].present && world->objects[i].room == out->actor_room &&
        out->visible_object_count < RUBY2_WORLD_OBJECT_COUNT) {
      out->visible_objects[out->visible_object_count++] = (Ruby2WorldObjectId)i;
    }
  }
  out->has_last_visible_event = ruby2_world_recent_visible_event_for_room(world, out->actor_room, &out->last_visible_event);
  return true;
}

static bool ruby2_perception_has_object(
  const Ruby2AgentPerception* perception,
  Ruby2WorldObjectId object_id
) {
  if (!perception || object_id >= RUBY2_WORLD_OBJECT_COUNT) return false;
  for (uint8_t i = 0; i < perception->visible_object_count; ++i) {
    if (perception->visible_objects[i] == object_id) return true;
  }
  return false;
}

static bool ruby2_world_add_agent_candidate(
  Ruby2AgentCandidateList* list,
  Ruby2AgentAgendaId agenda_id,
  Ruby2AgentIntentKind kind,
  Ruby2CharacterId character,
  Ruby2RoomId target_room,
  Ruby2WorldObjectId target_object,
  Ruby2Discipline discipline,
  Ruby2Virtue virtue,
  float authored_priority,
  const char* text,
  const char* reason
) {
  if (!list || list->count >= RUBY2_WORLD_MAX_AGENT_INTENTS ||
      agenda_id >= RUBY2_AGENT_AGENDA_COUNT ||
      character >= RUBY2_CHARACTER_COUNT ||
      !text || text[0] == '\0') {
    return false;
  }

  Ruby2AgentCandidateIntent* candidate = &list->candidates[list->count++];
  memset(candidate, 0, sizeof(*candidate));
  candidate->agenda_id = agenda_id;
  candidate->discipline = discipline;
  candidate->virtue = virtue;
  candidate->authored_priority = authored_priority;
  candidate->reason = reason;
  candidate->intent.kind = kind;
  candidate->intent.character = character;
  candidate->intent.target_room = target_room;
  candidate->intent.target_object = target_object;
  candidate->intent.text = text;
  return true;
}

static void ruby2_world_query_ruby_intents(
  const Ruby2World* world,
  const Ruby2AgentPerception* perception,
  Ruby2AgentCandidateList* out
) {
  if (!world || !perception || !out || perception->character != RUBY2_CHARACTER_RUBY) return;

  if (!world->agent_agenda_done[RUBY2_AGENT_AGENDA_RUBY_HALLWAY_MOVE] &&
      !perception->homeroom_started &&
      perception->actor_room == RUBY2_ROOM_HOMEROOM &&
      perception->player_room != RUBY2_ROOM_HOMEROOM &&
      perception->clocks[RUBY2_CLOCK_BELL] >= 1 &&
      ruby2_room_has_exit(perception->actor_room, RUBY2_ROOM_HALLWAY)) {
    (void)ruby2_world_add_agent_candidate(
      out,
      RUBY2_AGENT_AGENDA_RUBY_HALLWAY_MOVE,
      RUBY2_AGENT_REQUEST_MOVE,
      RUBY2_CHARACTER_RUBY,
      RUBY2_ROOM_HALLWAY,
      RUBY2_WORLD_OBJECT_NOTEBOOK,
      RUBY2_DISCIPLINE_SYNC,
      RUBY2_VIRTUE_HUSTLE,
      0.95f,
      "Ruby steps into the Hallway before the bell has to raise its voice.",
      "Ruby guides late arrival without forbidding exploration."
    );
  }

  if (!world->agent_agenda_done[RUBY2_AGENT_AGENDA_RUBY_HALLWAY_LINE] &&
      !perception->homeroom_started &&
      perception->actor_room == RUBY2_ROOM_HALLWAY &&
      perception->co_present_with_player &&
      perception->clocks[RUBY2_CLOCK_BELL] >= 1) {
    (void)ruby2_world_add_agent_candidate(
      out,
      RUBY2_AGENT_AGENDA_RUBY_HALLWAY_LINE,
      RUBY2_AGENT_REQUEST_SPEAK,
      RUBY2_CHARACTER_RUBY,
      RUBY2_ROOM_HALLWAY,
      RUBY2_WORLD_OBJECT_NOTEBOOK,
      RUBY2_DISCIPLINE_SYNC,
      RUBY2_VIRTUE_HEART,
      0.90f,
      "Homeroom is still a choice. I am making it an easy one.",
      "Ruby turns schedule pressure into an in-world prompt."
    );
  }
}

static void ruby2_world_query_ravi_intents(
  const Ruby2World* world,
  const Ruby2AgentPerception* perception,
  Ruby2AgentCandidateList* out
) {
  if (!world || !perception || !out || perception->character != RUBY2_CHARACTER_RAVI) return;

  if (!world->agent_agenda_done[RUBY2_AGENT_AGENDA_RAVI_HALLWAY_FACT] &&
      perception->lunch_started &&
      perception->homeroom_resolved &&
      perception->actor_room == RUBY2_ROOM_HALLWAY &&
      perception->co_present_with_player) {
    (void)ruby2_world_add_agent_candidate(
      out,
      RUBY2_AGENT_AGENDA_RAVI_HALLWAY_FACT,
      RUBY2_AGENT_REQUEST_SPEAK,
      RUBY2_CHARACTER_RAVI,
      RUBY2_ROOM_HALLWAY,
      RUBY2_WORLD_OBJECT_WORK_ORDER,
      RUBY2_DISCIPLINE_SOURCE,
      RUBY2_VIRTUE_HUSTLE,
      0.70f,
      "The stamp is doing more work than the card.",
      "Ravi carries the class evidence into the hallway."
    );
  }
}

static void ruby2_world_query_lyra_intents(
  const Ruby2World* world,
  const Ruby2AgentPerception* perception,
  Ruby2AgentCandidateList* out
) {
  if (!world || !perception || !out || perception->character != RUBY2_CHARACTER_LYRA) return;

  if (!world->agent_agenda_done[RUBY2_AGENT_AGENDA_LYRA_RECEIPT_CHECK] &&
      perception->lunch_started &&
      perception->actor_room == RUBY2_ROOM_CAFETERIA &&
      perception->co_present_with_player &&
      !perception->receipt_inspected &&
      ruby2_perception_has_object(perception, RUBY2_WORLD_OBJECT_RECEIPT)) {
    (void)ruby2_world_add_agent_candidate(
      out,
      RUBY2_AGENT_AGENDA_LYRA_RECEIPT_CHECK,
      RUBY2_AGENT_REQUEST_SPEAK,
      RUBY2_CHARACTER_LYRA,
      RUBY2_ROOM_CAFETERIA,
      RUBY2_WORLD_OBJECT_RECEIPT,
      RUBY2_DISCIPLINE_SENSE,
      RUBY2_VIRTUE_HEAD,
      0.55f,
      "I checked three trays. None of them owe the school zero dollars.",
      "Lyra verifies the cafeteria anomaly from her own local evidence."
    );
  }
}

static void ruby2_world_query_noor_intents(
  const Ruby2World* world,
  const Ruby2AgentPerception* perception,
  Ruby2AgentCandidateList* out
) {
  if (!world || !perception || !out || perception->character != RUBY2_CHARACTER_NOOR) return;

  if (!world->agent_agenda_done[RUBY2_AGENT_AGENDA_NOOR_RECEIPT_LINE] &&
      perception->cafeteria_social_triggered &&
      perception->actor_room == RUBY2_ROOM_CAFETERIA &&
      perception->co_present_with_player &&
      ruby2_perception_has_object(perception, RUBY2_WORLD_OBJECT_RECEIPT)) {
    (void)ruby2_world_add_agent_candidate(
      out,
      RUBY2_AGENT_AGENDA_NOOR_RECEIPT_LINE,
      RUBY2_AGENT_REQUEST_SPEAK,
      RUBY2_CHARACTER_NOOR,
      RUBY2_ROOM_CAFETERIA,
      RUBY2_WORLD_OBJECT_RECEIPT,
      RUBY2_DISCIPLINE_SIGNAL,
      RUBY2_VIRTUE_HEAD,
      0.85f,
      "The receipt is trying too hard to be normal.",
      "Noor gets first crack at the cafeteria anomaly."
    );
  }

  if (!world->agent_agenda_done[RUBY2_AGENT_AGENDA_NOOR_RECEIPT_MEMORY] &&
      perception->receipt_inspected) {
    (void)ruby2_world_add_agent_candidate(
      out,
      RUBY2_AGENT_AGENDA_NOOR_RECEIPT_MEMORY,
      RUBY2_AGENT_REMEMBER_EVENT,
      RUBY2_CHARACTER_NOOR,
      perception->actor_room,
      RUBY2_WORLD_OBJECT_NOTEBOOK,
      RUBY2_DISCIPLINE_SIGNAL,
      RUBY2_VIRTUE_HEAD,
      0.80f,
      "Noor remembers that the receipt copied Homeroom's footer.",
      "Noor keeps durable memory after the player proves the pattern."
    );
  }
}

void ruby2_world_query_agent_intents(const Ruby2World* world, Ruby2AgentCandidateList* out) {
  if (!world || !out) return;
  memset(out, 0, sizeof(*out));

  for (uint8_t i = 0; i < RUBY2_CHARACTER_COUNT; ++i) {
    Ruby2AgentPerception perception;
    if (!ruby2_world_build_agent_perception(world, (Ruby2CharacterId)i, &perception)) continue;
    ruby2_world_query_ruby_intents(world, &perception, out);
    ruby2_world_query_ravi_intents(world, &perception, out);
    ruby2_world_query_lyra_intents(world, &perception, out);
    ruby2_world_query_noor_intents(world, &perception, out);
  }
}

void ruby2_world_step_agents(Ruby2World* world) {
  Ruby2AgentCandidateList legal;
  Ruby2AgentCandidateList ranked;
  Ruby2RankerResult result;

  if (!world) return;
  ruby2_world_query_agent_intents(world, &legal);
  if (legal.count == 0) return;

  if (!ruby2_ranker_rank_agent_intents(world, &legal, &ranked, &result)) {
    ranked = legal;
  }

  for (uint8_t i = 0; i < ranked.count; ++i) {
    Ruby2AgentCandidateIntent* candidate = &ranked.candidates[i];
    if (candidate->agenda_id >= RUBY2_AGENT_AGENDA_COUNT ||
        world->agent_agenda_done[candidate->agenda_id]) {
      continue;
    }
    if (ruby2_world_submit_agent_intent(world, &candidate->intent) == RUBY2_AGENT_INTENT_ACCEPTED) {
      world->agent_agenda_done[candidate->agenda_id] = true;
      return;
    }
  }
}

bool ruby2_world_pop_event(Ruby2World* world, Ruby2WorldEvent* out) {
  if (!world || !out || world->events.count == 0) return false;
  *out = world->events.events[0];
  if (world->events.count > 1) {
    memmove(&world->events.events[0], &world->events.events[1], (size_t)(world->events.count - 1) * sizeof(world->events.events[0]));
  }
  world->events.count--;
  return true;
}

void ruby2_world_clear_events(Ruby2World* world) {
  if (!world) return;
  world->events.count = 0;
  world->events.dropped_count = 0;
}
