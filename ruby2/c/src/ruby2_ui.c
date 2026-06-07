#include "ruby2_ui.h"
#include "ruby2_world_performance.h"

#include <string.h>

static void ruby2_ui_json_string(FILE* fp, const char* value) {
  fputc('"', fp);
  for (const char* p = value ? value : ""; *p; ++p) {
    switch (*p) {
      case '\\':
        fputs("\\\\", fp);
        break;
      case '"':
        fputs("\\\"", fp);
        break;
      case '\n':
        fputs("\\n", fp);
        break;
      case '\r':
        fputs("\\r", fp);
        break;
      case '\t':
        fputs("\\t", fp);
        break;
      default:
        if ((unsigned char)*p < 0x20) {
          fprintf(fp, "\\u%04x", (unsigned char)*p);
        } else {
          fputc(*p, fp);
        }
        break;
    }
  }
  fputc('"', fp);
}

static const char* ruby2_ui_time_name(Ruby2TimeBlock time_block) {
  switch (time_block) {
    case RUBY2_TIME_ARRIVAL:
      return "Arrival";
    case RUBY2_TIME_PERIOD_1:
      return "Period 1";
    case RUBY2_TIME_PASSING:
      return "Passing";
    case RUBY2_TIME_LUNCH:
      return "Lunch";
    case RUBY2_TIME_PERIOD_2:
      return "Period 2";
    case RUBY2_TIME_AFTER_SCHOOL:
      return "After School";
    default:
      return "Unknown";
  }
}

static const char* ruby2_ui_room_id(Ruby2RoomId room_id) {
  static const char* ids[] = {
    "hallway",
    "homeroom",
    "science_lab",
    "library",
    "cafeteria",
    "greenhouse",
    "courtyard",
    "teacher_office"
  };
  return room_id < RUBY2_ROOM_COUNT ? ids[room_id] : "unknown_room";
}

static const char* ruby2_ui_time_id(Ruby2TimeBlock time_block) {
  static const char* ids[] = {
    "arrival",
    "period_1",
    "passing",
    "lunch",
    "period_2",
    "after_school"
  };
  return time_block < RUBY2_TIME_COUNT ? ids[time_block] : "unknown_time";
}

static const char* ruby2_ui_character_id(Ruby2CharacterId character_id) {
  static const char* ids[] = {
    "ruby",
    "lyra",
    "mika",
    "ravi",
    "indra",
    "noor",
    "sami",
    "sally-science",
    "professor-edward"
  };
  return character_id < RUBY2_CHARACTER_COUNT ? ids[character_id] : "none";
}

static const char* ruby2_ui_world_item_id(Ruby2WorldItemId world_item_id) {
  static const char* ids[] = {
    "answer_card",
    "work_order",
    "notebook",
    "flashcards",
    "lunch_tray",
    "office_pass",
    "library_card",
    "lab_flask"
  };
  return world_item_id < RUBY2_WORLD_ITEM_COUNT ? ids[world_item_id] : "unknown_item";
}

static const char* ruby2_ui_item_id(Ruby2ItemId item_id) {
  static const char* ids[] = {
    "notebook",
    "flashcards",
    "office_pass",
    "library_card",
    "lab_flask",
    "lunch_tray"
  };
  return item_id < RUBY2_ITEM_COUNT ? ids[item_id] : "unknown_item";
}

static const char* ruby2_ui_action_id(Ruby2WorldActionId action_id) {
  static const char* ids[] = {
    "go_hallway",
    "go_homeroom",
    "go_science_lab",
    "go_library",
    "go_cafeteria",
    "go_greenhouse",
    "go_courtyard",
    "go_teacher_office",
    "select_avatar_source",
    "select_avatar_sense",
    "select_avatar_sync",
    "select_avatar_signal",
    "chat_room",
    "talk_ruby",
    "talk_lyra",
    "talk_mika",
    "talk_ravi",
    "talk_indra",
    "talk_noor",
    "talk_sami",
    "attend_homeroom",
    "approach_source",
    "approach_sense",
    "approach_sync",
    "approach_signal",
    "use_lunch_tray",
    "collect_notebook",
    "collect_flashcards",
    "collect_lunch_tray",
    "collect_office_pass",
    "collect_library_card",
    "collect_lab_flask",
    "chat_option_a",
    "chat_option_b",
    "check_notebook",
    "wait_bell",
    "none"
  };
  return action_id < RUBY2_ACTION_COUNT ? ids[action_id] : "unknown_action";
}

static const char* ruby2_ui_discipline_id(Ruby2Discipline discipline) {
  static const char* ids[] = {"source", "sense", "sync", "signal"};
  return discipline < RUBY2_DISCIPLINE_COUNT ? ids[discipline] : "unknown_discipline";
}

static const char* ruby2_ui_virtue_id(Ruby2Virtue virtue) {
  static const char* ids[] = {"head", "heart", "hustle", "honor"};
  return virtue < RUBY2_VIRTUE_COUNT ? ids[virtue] : "unknown_virtue";
}

static const char* ruby2_ui_player_avatar_id(Ruby2PlayerAvatarId avatar_id) {
  switch (avatar_id) {
    case RUBY2_PLAYER_AVATAR_SOURCE:
      return "source";
    case RUBY2_PLAYER_AVATAR_SENSE:
      return "sense";
    case RUBY2_PLAYER_AVATAR_SYNC:
      return "sync";
    case RUBY2_PLAYER_AVATAR_SIGNAL:
      return "signal";
    case RUBY2_PLAYER_AVATAR_UNSET:
    default:
      return "unset";
  }
}

static const char* ruby2_ui_player_avatar_name(Ruby2PlayerAvatarId avatar_id) {
  switch (avatar_id) {
    case RUBY2_PLAYER_AVATAR_SOURCE:
      return "Source";
    case RUBY2_PLAYER_AVATAR_SENSE:
      return "Sense";
    case RUBY2_PLAYER_AVATAR_SYNC:
      return "Sync";
    case RUBY2_PLAYER_AVATAR_SIGNAL:
      return "Signal";
    case RUBY2_PLAYER_AVATAR_UNSET:
    default:
      return "Unset";
  }
}

static const char* ruby2_ui_action_kind_name(Ruby2WorldActionKind action_kind) {
  switch (action_kind) {
    case RUBY2_WORLD_ACTION_GO:
      return "go";
    case RUBY2_WORLD_ACTION_TALK:
      return "talk";
    case RUBY2_WORLD_ACTION_ATTEND:
      return "attend";
    case RUBY2_WORLD_ACTION_APPROACH:
      return "approach";
    case RUBY2_WORLD_ACTION_USE_ITEM:
      return "inspect";
    case RUBY2_WORLD_ACTION_COLLECT:
      return "collect";
    case RUBY2_WORLD_ACTION_PROFILE:
      return "profile";
    case RUBY2_WORLD_ACTION_CHAT_CHOICE:
      return "chat_choice";
    case RUBY2_WORLD_ACTION_CHECK_NOTES:
      return "check_notes";
    case RUBY2_WORLD_ACTION_WAIT:
      return "wait";
    default:
      return "unknown";
  }
}

static const char* ruby2_ui_focus_mode_name(Ruby2UiFocusMode mode) {
  switch (mode) {
    case RUBY2_UI_FOCUS_SPEECH_ONLY:
      return "speech_only";
    case RUBY2_UI_FOCUS_SPEECH_THEN_BLACKBOARD:
      return "speech_then_blackboard";
    default:
      return "unknown";
  }
}

static const char* ruby2_ui_focus_initial_name(Ruby2UiFocusInitial initial) {
  switch (initial) {
    case RUBY2_UI_FOCUS_INITIAL_SPEECH:
      return "speech";
    case RUBY2_UI_FOCUS_INITIAL_BLACKBOARD:
      return "blackboard";
    default:
      return "unknown";
  }
}

static Ruby2UiBubbleTheme ruby2_ui_character_theme(Ruby2CharacterId character_id) {
  switch (character_id) {
    case RUBY2_CHARACTER_RUBY:
      return RUBY2_UI_BUBBLE_THEME_RUBY;
    case RUBY2_CHARACTER_LYRA:
      return RUBY2_UI_BUBBLE_THEME_LYRA;
    case RUBY2_CHARACTER_MIKA:
      return RUBY2_UI_BUBBLE_THEME_MIKA;
    case RUBY2_CHARACTER_RAVI:
      return RUBY2_UI_BUBBLE_THEME_RAVI;
    case RUBY2_CHARACTER_INDRA:
      return RUBY2_UI_BUBBLE_THEME_INDRA;
    case RUBY2_CHARACTER_NOOR:
      return RUBY2_UI_BUBBLE_THEME_NOOR;
    case RUBY2_CHARACTER_SAMI:
      return RUBY2_UI_BUBBLE_THEME_SAMI;
    default:
      return RUBY2_UI_BUBBLE_THEME_NEUTRAL;
  }
}

static const char* ruby2_ui_bubble_theme_name(Ruby2UiBubbleTheme theme) {
  static const char* names[] = {
    "ruby", "lyra", "mika", "ravi", "indra", "noor", "sami", "neutral"
  };
  return theme <= RUBY2_UI_BUBBLE_THEME_NEUTRAL ? names[theme] : "neutral";
}

static const char* ruby2_ui_bubble_anchor_name(Ruby2UiBubbleAnchor anchor) {
  static const char* names[] = {
    "speaker", "witness_1", "witness_2", "witness_3", "witness_4"
  };
  return anchor <= RUBY2_UI_BUBBLE_ANCHOR_WITNESS_4 ? names[anchor] : "speaker";
}

static const char* ruby2_ui_tail_name(Ruby2UiTailDirection tail) {
  return tail == RUBY2_UI_TAIL_RIGHT ? "right" : "left";
}

static bool ruby2_ui_snapshot_has_local_item(
  const Ruby2UiSnapshot* snapshot,
  Ruby2WorldItemId world_item_id
) {
  if (!snapshot) return false;
  for (uint8_t i = 0; i < snapshot->local_item_count; ++i) {
    if (snapshot->local_items[i] == world_item_id) return true;
  }
  return false;
}

static bool ruby2_ui_snapshot_has_item(
  const Ruby2UiSnapshot* snapshot,
  Ruby2ItemId item_id
) {
  if (!snapshot || item_id >= RUBY2_ITEM_COUNT) return false;
  for (uint8_t i = 0; i < snapshot->item_slot_count; ++i) {
    if (snapshot->item_slots[i].occupied && snapshot->item_slots[i].item == item_id) return true;
  }
  return false;
}

static bool ruby2_ui_snapshot_has_action_kind(
  const Ruby2UiSnapshot* snapshot,
  Ruby2WorldActionKind action_kind
) {
  if (!snapshot) return false;
  for (uint8_t i = 0; i < snapshot->action_count; ++i) {
    if (snapshot->actions[i].kind == action_kind) return true;
  }
  return false;
}

static uint8_t ruby2_ui_action_tray_limit(const Ruby2UiSnapshot* snapshot, bool has_approaches, bool has_profile) {
  if (!snapshot) return 0;
  if (has_approaches || has_profile) return 4;
  for (uint8_t i = 0; i < snapshot->action_count; ++i) {
    if (snapshot->actions[i].kind == RUBY2_WORLD_ACTION_CHAT_CHOICE) return 2;
  }
  return 4;
}

static const char* ruby2_ui_navigation_key_label(Ruby2RoomId from, Ruby2RoomId target) {
  if (from == RUBY2_ROOM_HALLWAY) {
    switch (target) {
      case RUBY2_ROOM_HOMEROOM:
        return "W";
      case RUBY2_ROOM_LIBRARY:
        return "A";
      case RUBY2_ROOM_SCIENCE_LAB:
        return "D";
      case RUBY2_ROOM_CAFETERIA:
        return "S";
      case RUBY2_ROOM_COURTYARD:
        return "E";
      case RUBY2_ROOM_TEACHER_OFFICE:
        return "C";
      default:
        return "?";
    }
  }

  if (from == RUBY2_ROOM_CAFETERIA) {
    switch (target) {
      case RUBY2_ROOM_HALLWAY:
        return "W";
      case RUBY2_ROOM_COURTYARD:
        return "S";
      default:
        return "?";
    }
  }

  if (from == RUBY2_ROOM_COURTYARD) {
    switch (target) {
      case RUBY2_ROOM_HALLWAY:
        return "W";
      case RUBY2_ROOM_CAFETERIA:
        return "A";
      case RUBY2_ROOM_GREENHOUSE:
        return "D";
      default:
        return "?";
    }
  }

  if (target == RUBY2_ROOM_HALLWAY || target == RUBY2_ROOM_COURTYARD) {
    return "W";
  }

  switch (target) {
    case RUBY2_ROOM_HOMEROOM:
      return "W";
    case RUBY2_ROOM_LIBRARY:
      return "A";
    case RUBY2_ROOM_SCIENCE_LAB:
      return "D";
    case RUBY2_ROOM_CAFETERIA:
      return "S";
    case RUBY2_ROOM_GREENHOUSE:
      return "Q";
    case RUBY2_ROOM_COURTYARD:
      return "E";
    case RUBY2_ROOM_TEACHER_OFFICE:
      return "C";
    case RUBY2_ROOM_HALLWAY:
    case RUBY2_ROOM_COUNT:
    default:
      return "?";
  }
}

static bool ruby2_ui_person_present(const Ruby2UiSnapshot* snapshot, Ruby2CharacterId character_id) {
  if (!snapshot) return false;
  for (uint8_t i = 0; i < snapshot->people_count; ++i) {
    if (snapshot->people[i] == character_id) return true;
  }
  return false;
}

static const Ruby2UiEvent* ruby2_ui_latest_display_event(const Ruby2UiSnapshot* snapshot) {
  if (!snapshot) return NULL;

  for (uint8_t i = snapshot->event_count; i > 0; --i) {
    const Ruby2UiEvent* event = &snapshot->events[i - 1u];
    if (event->room < RUBY2_ROOM_COUNT && event->room != snapshot->room) continue;
    if (event->has_performance &&
        event->performance_speaker < RUBY2_CHARACTER_COUNT &&
        ruby2_ui_person_present(snapshot, event->performance_speaker)) {
      return event;
    }
  }

  for (uint8_t i = snapshot->event_count; i > 0; --i) {
    const Ruby2UiEvent* event = &snapshot->events[i - 1u];
    if (event->room < RUBY2_ROOM_COUNT && event->room != snapshot->room) continue;
    if (event->character < RUBY2_CHARACTER_COUNT &&
        ruby2_ui_person_present(snapshot, event->character)) {
      return event;
    }
  }

  for (uint8_t i = snapshot->event_count; i > 0; --i) {
    const Ruby2UiEvent* event = &snapshot->events[i - 1u];
    if (event->room < RUBY2_ROOM_COUNT && event->room != snapshot->room) continue;
    if (event->character == RUBY2_CHARACTER_NONE && event->text) return event;
  }

  return NULL;
}

static Ruby2CharacterId ruby2_ui_select_speaker(const Ruby2UiSnapshot* snapshot) {
  const Ruby2UiEvent* event = ruby2_ui_latest_display_event(snapshot);
  if (event &&
      event->has_performance &&
      event->performance_speaker < RUBY2_CHARACTER_COUNT &&
      ruby2_ui_person_present(snapshot, event->performance_speaker)) {
    return event->performance_speaker;
  }
  if (event &&
      event->character < RUBY2_CHARACTER_COUNT &&
      ruby2_ui_person_present(snapshot, event->character)) {
    return event->character;
  }
  if (snapshot &&
      snapshot->active_question.present &&
      ruby2_ui_snapshot_has_action_kind(snapshot, RUBY2_WORLD_ACTION_APPROACH) &&
      ruby2_ui_person_present(snapshot, snapshot->active_question.teacher)) {
    return snapshot->active_question.teacher;
  }
  if (ruby2_ui_person_present(snapshot, RUBY2_CHARACTER_RUBY)) return RUBY2_CHARACTER_RUBY;
  if (snapshot && snapshot->people_count > 0) return (Ruby2CharacterId)snapshot->people[0];
  return RUBY2_CHARACTER_RUBY;
}

static const char* ruby2_ui_event_display_line(const Ruby2UiEvent* event) {
  if (!event) return NULL;
  switch (event->kind) {
    case RUBY2_EVENT_ROOM_ENTERED:
      if (event->room == RUBY2_ROOM_HALLWAY) {
        return "You are a Grade 9 Ruby High freshman in the Hallway. Pick up the Notebook, then reach Homeroom.";
      }
      if (event->room == RUBY2_ROOM_HOMEROOM) {
        return "You are in Homeroom. Ruby is the teacher; answer her blackboard quiz to protect today's grade.";
      }
      if (event->room == RUBY2_ROOM_SCIENCE_LAB) {
        return "You are in Science Lab. Sally Science is teaching; Mika is a classmate here.";
      }
      if (event->room == RUBY2_ROOM_LIBRARY) {
        return "You are in the Library. Professor Edward is teaching; Indra is a classmate here.";
      }
      if (event->room == RUBY2_ROOM_CAFETERIA) {
        return "You are in the Cafeteria. Take a Lunch Tray before joining a table.";
      }
      return "You enter the room. Check who is here, what items are here, and what moves are legal.";
    case RUBY2_EVENT_TIME_ADVANCED:
      return "The bell advances the day. Avatars move to their scheduled locations.";
    case RUBY2_EVENT_CLASS_STARTED:
      return "Class is active. Resolve the blackboard before you leave.";
    case RUBY2_EVENT_APPROACH_RESOLVED:
      return "Blackboard answer recorded. The result now affects the rest of the day.";
    case RUBY2_EVENT_SOCIAL_TRIGGERED:
      if (event->item == RUBY2_WORLD_ITEM_LUNCH_TRAY) {
        return "Noor notices you at the cafeteria line. Take the Lunch Tray if you want to join a table.";
      }
      return "A classmate reacts to the current room state.";
    case RUBY2_EVENT_ITEM_APPEARED:
      return "A usable item is now in this location.";
    case RUBY2_EVENT_ITEM_COLLECTED:
      return "Item added to your bag.";
    case RUBY2_EVENT_ITEM_USED:
      if (event->item == RUBY2_WORLD_ITEM_LUNCH_TRAY) {
        return "You sit down with the Lunch Tray. Noor has the next word.";
      }
      return "Item used.";
    case RUBY2_EVENT_NOTEBOOK_UPDATED:
      if (event->action == RUBY2_ACTION_SELECT_AVATAR_SOURCE ||
          event->action == RUBY2_ACTION_SELECT_AVATAR_SENSE ||
          event->action == RUBY2_ACTION_SELECT_AVATAR_SYNC ||
          event->action == RUBY2_ACTION_SELECT_AVATAR_SIGNAL) {
        return "Notebook updated: student style recorded.";
      }
      if (event->action == RUBY2_ACTION_USE_LUNCH_TRAY) {
        return "Notebook updated: you joined Noor's lunch table.";
      }
      if (event->action == RUBY2_ACTION_APPROACH_SOURCE ||
          event->action == RUBY2_ACTION_APPROACH_SENSE ||
          event->action == RUBY2_ACTION_APPROACH_SYNC ||
          event->action == RUBY2_ACTION_APPROACH_SIGNAL) {
        return "Notebook updated: class board result recorded.";
      }
      return "Notebook updated.";
    case RUBY2_EVENT_NPC_MOVED:
      return "A scheduled avatar move resolved.";
    case RUBY2_EVENT_AGENT_SPOKE:
      return "A classmate is ready to speak.";
    case RUBY2_EVENT_AGENT_REMEMBERED:
      return "A classmate remembered the result.";
    case RUBY2_EVENT_DIRECTOR_TRIGGERED:
      return "The schedule pushes the day forward.";
    case RUBY2_EVENT_IDLE:
      return "You wait for the next legal change.";
    case RUBY2_EVENT_AGENT_INTENT_REJECTED:
    default:
      return "Choose a legal move.";
  }
}

static const char* ruby2_ui_speech_line(const Ruby2UiSnapshot* snapshot, Ruby2CharacterId speaker) {
  const Ruby2UiEvent* event = ruby2_ui_latest_display_event(snapshot);
  bool has_answer_card = ruby2_ui_snapshot_has_local_item(snapshot, RUBY2_WORLD_ITEM_ANSWER_CARD);
  bool has_work_order = ruby2_ui_snapshot_has_local_item(snapshot, RUBY2_WORLD_ITEM_WORK_ORDER);
  bool has_approaches = ruby2_ui_snapshot_has_action_kind(snapshot, RUBY2_WORLD_ACTION_APPROACH);

  if (event && event->has_performance && event->performance_line) return event->performance_line;
  if (snapshot &&
      snapshot->room == RUBY2_ROOM_HOMEROOM &&
      speaker == RUBY2_CHARACTER_RUBY &&
      has_answer_card &&
      has_work_order &&
      has_approaches) {
    return "You are a new Ruby High freshman. Goal: answer Ruby's blackboard quiz, then reach lunch with a C or higher day.";
  }
  if (snapshot &&
      snapshot->room == RUBY2_ROOM_SCIENCE_LAB &&
      has_approaches) {
    return "Goal: answer Sally Science's grade-banded question. This may review prior-grade material.";
  }
  if (snapshot &&
      snapshot->room == RUBY2_ROOM_LIBRARY &&
      has_approaches) {
    return "Goal: answer Professor Edward's grade-banded question. This may review prior-grade material.";
  }
  if (event) return ruby2_ui_event_display_line(event);
  return "You are a new Ruby High freshman. Pick up useful items, reach Homeroom, and answer class boards before the bell.";
}

static const char* ruby2_ui_notebook_line(const Ruby2UiSnapshot* snapshot) {
  if (!snapshot) return "Notebook margin clear.";
  if (!ruby2_ui_snapshot_has_item(snapshot, RUBY2_ITEM_NOTEBOOK)) {
    return "Inventory slot empty. Pick up the Notebook if you want the day to remember you.";
  }
  for (uint8_t i = snapshot->event_count; i > 0; --i) {
    const Ruby2UiEvent* event = &snapshot->events[i - 1u];
    if (event->kind == RUBY2_EVENT_NOTEBOOK_UPDATED && event->room == snapshot->room) {
      return ruby2_ui_event_display_line(event);
    }
  }

  if (snapshot->room == RUBY2_ROOM_HOMEROOM &&
      ruby2_ui_snapshot_has_local_item(snapshot, RUBY2_WORLD_ITEM_ANSWER_CARD) &&
      ruby2_ui_snapshot_has_local_item(snapshot, RUBY2_WORLD_ITEM_WORK_ORDER)) {
    return "Notebook ready. Current class: Ruby, Grade 9 Homeroom; answer the blackboard to protect your day grade.";
  }
  if (snapshot->room == RUBY2_ROOM_CAFETERIA &&
      ruby2_ui_snapshot_has_local_item(snapshot, RUBY2_WORLD_ITEM_LUNCH_TRAY)) {
    return "Room steady. Current item: Lunch Tray; Notebook in your bag.";
  }
  if (snapshot->room == RUBY2_ROOM_HALLWAY) {
    return "Notebook margin clear. You are a Grade 9 Ruby High freshman; Homeroom is the first required class.";
  }
  return "Notebook margin clear.";
}

static void ruby2_ui_add_blackboard_line(Ruby2UiFocusPresentation* focus, const char* line) {
  if (!focus || focus->blackboard_line_count >= RUBY2_UI_MAX_BLACKBOARD_LINES) return;
  focus->blackboard_lines[focus->blackboard_line_count++] = line;
}

static void ruby2_ui_build_blackboard(
  const Ruby2UiSnapshot* snapshot,
  Ruby2UiFocusPresentation* focus
) {
  if (!snapshot || !focus) return;
  focus->has_blackboard = true;
  focus->blackboard_kicker = "Blackboard";

  if (snapshot->active_question.present &&
      ruby2_ui_snapshot_has_action_kind(snapshot, RUBY2_WORLD_ACTION_APPROACH)) {
    focus->blackboard_kicker = snapshot->active_question.prior_grade_review
      ? "Prior Grade Review"
      : "Class Quiz";
    for (uint8_t i = 0; i < snapshot->active_question.line_count; ++i) {
      ruby2_ui_add_blackboard_line(focus, snapshot->active_question.lines[i]);
    }
    return;
  }

  if (snapshot->room == RUBY2_ROOM_CAFETERIA &&
      ruby2_ui_snapshot_has_local_item(snapshot, RUBY2_WORLD_ITEM_LUNCH_TRAY)) {
    ruby2_ui_add_blackboard_line(focus, "CAFETERIA: lunch line");
    ruby2_ui_add_blackboard_line(focus, "ITEM: Lunch Tray");
    ruby2_ui_add_blackboard_line(focus, "SOCIAL MOVE:");
    ruby2_ui_add_blackboard_line(focus, "Choose where to sit.");
    return;
  }

  ruby2_ui_add_blackboard_line(focus, ruby2_room_name(snapshot->room));
  ruby2_ui_add_blackboard_line(focus, "BOARD QUESTION:");
  ruby2_ui_add_blackboard_line(focus, "What is the next Ruby High move?");
}

static const char* ruby2_ui_reaction_line(
  const Ruby2UiSnapshot* snapshot,
  Ruby2CharacterId character_id
) {
  bool has_work_order = ruby2_ui_snapshot_has_local_item(snapshot, RUBY2_WORLD_ITEM_WORK_ORDER);
  bool has_lunch_tray = ruby2_ui_snapshot_has_local_item(snapshot, RUBY2_WORLD_ITEM_LUNCH_TRAY);

  switch (character_id) {
    case RUBY2_CHARACTER_LYRA:
      return has_work_order || has_lunch_tray ? "verifying written item" : "checking the margin";
    case RUBY2_CHARACTER_RAVI:
      return has_work_order ? "item check" : "room check";
    case RUBY2_CHARACTER_MIKA:
      return "confidence check";
    case RUBY2_CHARACTER_INDRA:
      return "change noticed";
    case RUBY2_CHARACTER_SALLY_SCIENCE:
      return "teacher check";
    case RUBY2_CHARACTER_PROFESSOR_EDWARD:
      return "teacher check";
    case RUBY2_CHARACTER_NOOR:
      return has_lunch_tray ? "social pattern check" : "room reaction check";
    case RUBY2_CHARACTER_SAMI:
      return "mood check";
    default:
      return "present.";
  }
}

static void ruby2_ui_add_reaction_bubble(
  Ruby2UiSnapshot* snapshot,
  Ruby2CharacterId character_id,
  uint8_t witness_index
) {
  Ruby2UiReactionBubble* bubble;
  if (!snapshot ||
      snapshot->presentation.reaction_bubble_count >= RUBY2_UI_MAX_REACTION_BUBBLES ||
      witness_index >= RUBY2_UI_MAX_REACTION_BUBBLES) {
    return;
  }
  bubble = &snapshot->presentation.reaction_bubbles[snapshot->presentation.reaction_bubble_count++];
  bubble->character = character_id;
  bubble->line = ruby2_ui_reaction_line(snapshot, character_id);
  bubble->theme = ruby2_ui_character_theme(character_id);
  bubble->anchor = (Ruby2UiBubbleAnchor)(RUBY2_UI_BUBBLE_ANCHOR_WITNESS_1 + witness_index);
  bubble->tail = (witness_index % 2u) == 0u ? RUBY2_UI_TAIL_LEFT : RUBY2_UI_TAIL_RIGHT;
}

static int ruby2_ui_action_slot_priority(const Ruby2UiAction* action) {
  if (!action ||
      (action->kind != RUBY2_WORLD_ACTION_APPROACH &&
       action->kind != RUBY2_WORLD_ACTION_PROFILE)) {
    return 99;
  }
  switch (action->discipline) {
    case RUBY2_DISCIPLINE_SOURCE:
      return 0;
    case RUBY2_DISCIPLINE_SENSE:
      return 1;
    case RUBY2_DISCIPLINE_SYNC:
      return 2;
    case RUBY2_DISCIPLINE_SIGNAL:
      return 3;
    default:
      return 99;
  }
}

static int ruby2_ui_action_slot_priority_general(const Ruby2UiAction* action) {
  if (!action) return 99;
  if (action->kind == RUBY2_WORLD_ACTION_ATTEND) {
    return 0;
  }
  if (action->id == RUBY2_ACTION_GO_SCIENCE_LAB || action->id == RUBY2_ACTION_GO_LIBRARY) {
    return 1;
  }
  if (action->kind == RUBY2_WORLD_ACTION_GO) {
    return 2;
  }
  if (action->kind == RUBY2_WORLD_ACTION_USE_ITEM) {
    return 3;
  }
  if (action->kind == RUBY2_WORLD_ACTION_TALK) {
    return 4;
  }
  if (action->kind == RUBY2_WORLD_ACTION_COLLECT) {
    return 5;
  }
  if (action->kind == RUBY2_WORLD_ACTION_WAIT) {
    return 6;
  }
  if (action->kind == RUBY2_WORLD_ACTION_CHECK_NOTES) {
    return 7;
  }
  return 8;
}

static void ruby2_ui_action_slot_color(uint8_t slot, const char** token, const char** hex) {
  static const char* tokens[] = {"orange", "yellow", "green", "blue"};
  static const char* hexes[] = {"#f0922a", "#f7d33a", "#4cb555", "#3aa3e0"};
  uint8_t index = (uint8_t)(slot % 4u);
  if (token) *token = tokens[index];
  if (hex) *hex = hexes[index];
}

static void ruby2_ui_add_action_slot(Ruby2UiSnapshot* snapshot, uint8_t action_index) {
  Ruby2UiActionSlot* slot;
  uint8_t slot_index;
  if (!snapshot ||
      action_index >= snapshot->action_count ||
      snapshot->presentation.action_tray.slot_count >= RUBY2_UI_MAX_ACTION_SLOTS) {
    return;
  }

  slot_index = snapshot->presentation.action_tray.slot_count;
  slot = &snapshot->presentation.action_tray.slots[slot_index];
  slot->action = snapshot->actions[action_index].id;
  slot->action_index = action_index;
  slot->button_index = (uint8_t)(slot_index + 1u);
  ruby2_ui_action_slot_color(slot_index, &slot->color_token, &slot->color_hex);
  snapshot->presentation.action_tray.slot_count++;
}

static void ruby2_ui_build_navigation(Ruby2UiSnapshot* snapshot) {
  if (!snapshot) return;
  snapshot->presentation.navigation.placement = "campus_map";
  snapshot->presentation.navigation.hint = "WASD/arrows move. Click a room to travel.";

  for (uint8_t i = 0; i < snapshot->action_count; ++i) {
    const Ruby2UiAction* action = &snapshot->actions[i];
    Ruby2UiNavigationSlot* slot;
    if (action->kind != RUBY2_WORLD_ACTION_GO ||
        action->target_room >= RUBY2_ROOM_COUNT ||
        snapshot->presentation.navigation.slot_count >= RUBY2_UI_MAX_NAVIGATION_SLOTS) {
      continue;
    }
    slot = &snapshot->presentation.navigation.slots[snapshot->presentation.navigation.slot_count++];
    slot->action = action->id;
    slot->action_index = i;
    slot->target_room = action->target_room;
    slot->key_label = ruby2_ui_navigation_key_label(snapshot->room, action->target_room);
    slot->label = ruby2_room_name(action->target_room);
  }
}

static void ruby2_ui_build_action_tray(Ruby2UiSnapshot* snapshot) {
  bool has_approaches = false;
  bool has_profile = false;
  bool used[RUBY2_WORLD_MAX_ACTIONS];
  uint8_t tray_limit;
  if (!snapshot) return;

  memset(used, 0, sizeof(used));
  snapshot->presentation.action_tray.placement = "bottom";
  snapshot->presentation.action_tray.palette = "ruby1_bright";

  for (uint8_t i = 0; i < snapshot->action_count; ++i) {
    if (snapshot->actions[i].kind == RUBY2_WORLD_ACTION_APPROACH) {
      has_approaches = true;
    } else if (snapshot->actions[i].kind == RUBY2_WORLD_ACTION_PROFILE) {
      has_profile = true;
    }
  }

  tray_limit = ruby2_ui_action_tray_limit(snapshot, has_approaches, has_profile);

  if (has_approaches || has_profile) {
    for (int priority = 0; priority < 4; ++priority) {
      for (uint8_t i = 0; i < snapshot->action_count; ++i) {
        if (snapshot->presentation.action_tray.slot_count >= tray_limit) goto done;
        if (!used[i] &&
            snapshot->actions[i].kind != RUBY2_WORLD_ACTION_GO &&
            ruby2_ui_action_slot_priority(&snapshot->actions[i]) == priority) {
          ruby2_ui_add_action_slot(snapshot, i);
          used[i] = true;
          break;
        }
      }
    }
    goto done;
  }

  for (int priority = 0; priority <= 7; ++priority) {
    for (uint8_t i = 0; i < snapshot->action_count; ++i) {
      if (snapshot->presentation.action_tray.slot_count >= tray_limit) goto done;
      if (!used[i] &&
          snapshot->actions[i].kind != RUBY2_WORLD_ACTION_GO &&
          ruby2_ui_action_slot_priority_general(&snapshot->actions[i]) == priority) {
        ruby2_ui_add_action_slot(snapshot, i);
        used[i] = true;
      }
    }
  }

done:
  if (snapshot->presentation.action_tray.slot_count == 0 && snapshot->action_count > 0) {
    for (uint8_t i = 0; i < snapshot->action_count; ++i) {
      if (snapshot->actions[i].kind != RUBY2_WORLD_ACTION_GO) {
        ruby2_ui_add_action_slot(snapshot, i);
        break;
      }
    }
  }
}

static void ruby2_ui_build_presentation(Ruby2UiSnapshot* snapshot) {
  Ruby2CharacterId speaker;
  bool has_blackboard;
  if (!snapshot) return;

  snapshot->presentation.layout = "dialogue_closeup";
  snapshot->presentation.notebook_line = ruby2_ui_notebook_line(snapshot);

  speaker = ruby2_ui_select_speaker(snapshot);
  snapshot->presentation.focus.speaker = speaker;
  snapshot->presentation.focus.speech_line = ruby2_ui_speech_line(snapshot, speaker);
  snapshot->presentation.focus.next_label = "Next";
  snapshot->presentation.focus.back_label = "Speech";

  has_blackboard = ruby2_ui_snapshot_has_action_kind(snapshot, RUBY2_WORLD_ACTION_APPROACH);
  snapshot->presentation.focus.mode = has_blackboard
    ? RUBY2_UI_FOCUS_SPEECH_THEN_BLACKBOARD
    : RUBY2_UI_FOCUS_SPEECH_ONLY;
  snapshot->presentation.focus.initial = has_blackboard
    ? RUBY2_UI_FOCUS_INITIAL_BLACKBOARD
    : RUBY2_UI_FOCUS_INITIAL_SPEECH;
  if (has_blackboard) ruby2_ui_build_blackboard(snapshot, &snapshot->presentation.focus);

  for (uint8_t i = 0; i < snapshot->people_count; ++i) {
    Ruby2CharacterId character_id = (Ruby2CharacterId)snapshot->people[i];
    if (character_id == speaker) continue;
    ruby2_ui_add_reaction_bubble(
      snapshot,
      character_id,
      snapshot->presentation.reaction_bubble_count
    );
  }

  ruby2_ui_build_navigation(snapshot);
  ruby2_ui_build_action_tray(snapshot);
}

static const Ruby2UiAction* ruby2_ui_slot_action(
  const Ruby2UiSnapshot* snapshot,
  const Ruby2UiActionSlot* slot
) {
  if (!snapshot || !slot || slot->action_index >= snapshot->action_count) return NULL;
  return &snapshot->actions[slot->action_index];
}

static void ruby2_ui_write_presentation_json(FILE* fp, const Ruby2UiSnapshot* snapshot) {
  const Ruby2UiPresentation* presentation = &snapshot->presentation;
  const Ruby2UiFocusPresentation* focus = &presentation->focus;

  fputs(",\"presentation\":{", fp);
  fputs("\"layout\":", fp);
  ruby2_ui_json_string(fp, presentation->layout);

  fputs(",\"notebook\":{\"placement\":\"above_action_tray\",\"line\":", fp);
  ruby2_ui_json_string(fp, presentation->notebook_line);
  fputc('}', fp);

  fputs(",\"focus\":{", fp);
  fputs("\"mode\":", fp);
  ruby2_ui_json_string(fp, ruby2_ui_focus_mode_name(focus->mode));
  fputs(",\"initial\":", fp);
  ruby2_ui_json_string(fp, ruby2_ui_focus_initial_name(focus->initial));
  fputs(",\"speakerId\":", fp);
  ruby2_ui_json_string(fp, ruby2_ui_character_id(focus->speaker));
  fputs(",\"speaker\":", fp);
  ruby2_ui_json_string(fp, ruby2_world_character_name(focus->speaker));
  fputs(",\"speechLine\":", fp);
  ruby2_ui_json_string(fp, focus->speech_line);
  fputs(",\"nextLabel\":", fp);
  ruby2_ui_json_string(fp, focus->next_label);
  fputs(",\"backLabel\":", fp);
  ruby2_ui_json_string(fp, focus->back_label);
  fputs(",\"blackboard\":", fp);
  if (focus->has_blackboard) {
    fputs("{\"kicker\":", fp);
    ruby2_ui_json_string(fp, focus->blackboard_kicker);
    fputs(",\"lines\":[", fp);
    for (uint8_t i = 0; i < focus->blackboard_line_count; ++i) {
      if (i != 0) fputc(',', fp);
      ruby2_ui_json_string(fp, focus->blackboard_lines[i]);
    }
    fputs("]}", fp);
  } else {
    fputs("null", fp);
  }
  fputc('}', fp);

  fputs(",\"reactionBubbles\":[", fp);
  for (uint8_t i = 0; i < presentation->reaction_bubble_count; ++i) {
    const Ruby2UiReactionBubble* bubble = &presentation->reaction_bubbles[i];
    if (i != 0) fputc(',', fp);
    fputs("{\"characterId\":", fp);
    ruby2_ui_json_string(fp, ruby2_ui_character_id(bubble->character));
    fputs(",\"character\":", fp);
    ruby2_ui_json_string(fp, ruby2_world_character_name(bubble->character));
    fputs(",\"line\":", fp);
    ruby2_ui_json_string(fp, bubble->line);
    fputs(",\"theme\":", fp);
    ruby2_ui_json_string(fp, ruby2_ui_bubble_theme_name(bubble->theme));
    fputs(",\"anchor\":", fp);
    ruby2_ui_json_string(fp, ruby2_ui_bubble_anchor_name(bubble->anchor));
    fputs(",\"tail\":", fp);
    ruby2_ui_json_string(fp, ruby2_ui_tail_name(bubble->tail));
    fputc('}', fp);
  }
  fputc(']', fp);

  fputs(",\"navigation\":{\"placement\":", fp);
  ruby2_ui_json_string(fp, presentation->navigation.placement);
  fputs(",\"hint\":", fp);
  ruby2_ui_json_string(fp, presentation->navigation.hint);
  fputs(",\"slots\":[", fp);
  for (uint8_t i = 0; i < presentation->navigation.slot_count; ++i) {
    const Ruby2UiNavigationSlot* slot = &presentation->navigation.slots[i];
    if (i != 0) fputc(',', fp);
    fprintf(fp, "{\"actionIndex\":%u,\"actionId\":", (unsigned)slot->action_index);
    ruby2_ui_json_string(fp, ruby2_ui_action_id(slot->action));
    fputs(",\"targetRoomId\":", fp);
    ruby2_ui_json_string(fp, ruby2_ui_room_id(slot->target_room));
    fputs(",\"targetRoom\":", fp);
    ruby2_ui_json_string(fp, ruby2_room_name(slot->target_room));
    fputs(",\"keyLabel\":", fp);
    ruby2_ui_json_string(fp, slot->key_label);
    fputs(",\"label\":", fp);
    ruby2_ui_json_string(fp, slot->label);
    fputc('}', fp);
  }
  fputc(']', fp);
  fputc('}', fp);

  fputs(",\"actionTray\":{\"placement\":", fp);
  ruby2_ui_json_string(fp, presentation->action_tray.placement);
  fputs(",\"palette\":", fp);
  ruby2_ui_json_string(fp, presentation->action_tray.palette);
  fputs(",\"slots\":[", fp);
  for (uint8_t i = 0; i < presentation->action_tray.slot_count; ++i) {
    const Ruby2UiActionSlot* slot = &presentation->action_tray.slots[i];
    const Ruby2UiAction* action = ruby2_ui_slot_action(snapshot, slot);
    if (i != 0) fputc(',', fp);
    fprintf(fp, "{\"buttonIndex\":%u,\"actionIndex\":%u,\"actionId\":", (unsigned)slot->button_index, (unsigned)slot->action_index);
    ruby2_ui_json_string(fp, ruby2_ui_action_id(slot->action));
    fputs(",\"label\":", fp);
    ruby2_ui_json_string(fp, action ? action->label : "");
    fputs(",\"colorToken\":", fp);
    ruby2_ui_json_string(fp, slot->color_token);
    fputs(",\"colorHex\":", fp);
    ruby2_ui_json_string(fp, slot->color_hex);
    fputc('}', fp);
  }
  fputs("]}}", fp);
}

static void ruby2_ui_copy_action(
  const Ruby2WorldAction* action,
  float score,
  Ruby2UiAction* out
) {
  out->id = action->id;
  out->kind = action->kind;
  out->target_room = action->target_room;
  out->target_character = action->target_character;
  out->target_item = action->target_item;
  out->discipline = action->discipline;
  out->virtue = action->virtue;
  out->label = action->label;
  out->rank_score = score;
}

void ruby2_ui_snapshot_build(const Ruby2World* world, bool ranked_actions, Ruby2UiSnapshot* out) {
  Ruby2WorldActionList legal_actions;
  Ruby2WorldActionList ordered_actions;
  Ruby2RankerResult ranker_result;
  const Ruby2WorldActionList* source_actions = &legal_actions;

  if (!world || !out) return;
  memset(out, 0, sizeof(*out));
  out->room = world->game.current_room_id;
  out->time_block = world->game.current_time_block;
  out->player_profile_ready = world->player_profile_ready;
  out->player_avatar = world->player_avatar;

  for (uint8_t i = 0; i < RUBY2_CLOCK_COUNT; ++i) {
    out->clocks[i] = world->game.clocks[i].value;
  }
  for (uint8_t i = 0; i < RUBY2_DISCIPLINE_COUNT; ++i) {
    out->discipline_counts[i] = world->game.discipline_counts[i];
  }
  for (uint8_t i = 0; i < RUBY2_CHARACTER_COUNT; ++i) {
    if (ruby2_world_character_present(world, (Ruby2CharacterId)i, out->room)) {
      out->people[out->people_count++] = i;
    }
  }
  for (uint8_t i = 0; i < RUBY2_WORLD_ITEM_COUNT; ++i) {
    if (ruby2_world_item_present(world, (Ruby2WorldItemId)i, out->room)) {
      out->local_items[out->local_item_count++] = i;
    }
  }
  (void)ruby2_world_active_teacher_question(world, out->room, &out->active_question);
  out->item_slot_count = RUBY2_UI_MAX_ITEM_SLOTS;
  for (uint8_t i = 0; i < out->item_slot_count; ++i) {
    Ruby2UiItemSlot* slot = &out->item_slots[i];
    slot->slot_index = i;
    slot->occupied = world->game.items[i].owned;
    slot->item = (Ruby2ItemId)i;
    slot->name = slot->occupied ? ruby2_item_name((Ruby2ItemId)i) : "Empty";
    slot->carried = world->game.items[i].carried;
    slot->charges = world->game.items[i].charges;
  }

  ruby2_world_query_actions(world, &legal_actions);
  memset(&ranker_result, 0, sizeof(ranker_result));
  if (ranked_actions &&
      ruby2_ranker_rank_world_actions(world, &legal_actions, &ordered_actions, &ranker_result)) {
    source_actions = &ordered_actions;
  }

  out->action_count = source_actions->count;
  for (uint8_t i = 0; i < source_actions->count; ++i) {
    float score = 0.0f;
    if (ranked_actions && ranker_result.count == source_actions->count) {
      uint8_t original_index = ranker_result.ranked_indices[i];
      score = ranker_result.scores[original_index];
    }
    ruby2_ui_copy_action(&source_actions->actions[i], score, &out->actions[i]);
  }

  for (uint8_t i = 0; i < world->events.count && out->event_count < RUBY2_UI_MAX_EVENTS; ++i) {
    const Ruby2WorldEvent* event = &world->events.events[i];
    Ruby2UiEvent* ui_event;
    Ruby2PerformanceRequest performance;
    if (!ruby2_world_event_visible_to_player(event)) continue;
    ui_event = &out->events[out->event_count++];
    ui_event->kind = event->kind;
    ui_event->tick = event->tick;
    ui_event->room = event->room;
    ui_event->character = event->character;
    ui_event->item = event->item;
    ui_event->action = event->action;
    ui_event->text = event->text;
    if (ruby2_world_event_to_performance_request(world, event, &performance)) {
      ui_event->has_performance = true;
      ui_event->performance_speaker = performance.speaker;
      ui_event->performance_line = performance.fallback;
    }
  }

  ruby2_ui_build_presentation(out);
}

bool ruby2_ui_snapshot_write_json(FILE* fp, const Ruby2UiSnapshot* snapshot) {
  if (!fp || !snapshot) return false;

  fputs("{\"schema\":\"" RUBY2_UI_SNAPSHOT_SCHEMA "\"", fp);
  fputs(",\"roomId\":", fp);
  ruby2_ui_json_string(fp, ruby2_ui_room_id(snapshot->room));
  fputs(",\"room\":", fp);
  ruby2_ui_json_string(fp, ruby2_room_name(snapshot->room));
  fputs(",\"timeBlockId\":", fp);
  ruby2_ui_json_string(fp, ruby2_ui_time_id(snapshot->time_block));
  fputs(",\"timeBlock\":", fp);
  ruby2_ui_json_string(fp, ruby2_ui_time_name(snapshot->time_block));
  fputs(",\"playerProfile\":{\"ready\":", fp);
  fputs(snapshot->player_profile_ready ? "true" : "false", fp);
  fputs(",\"avatarId\":", fp);
  ruby2_ui_json_string(fp, ruby2_ui_player_avatar_id(snapshot->player_avatar));
  fputs(",\"avatar\":", fp);
  ruby2_ui_json_string(fp, ruby2_ui_player_avatar_name(snapshot->player_avatar));
  fputc('}', fp);

  fputs(",\"clocks\":{", fp);
  for (uint8_t i = 0; i < RUBY2_CLOCK_COUNT; ++i) {
    if (i != 0) fputc(',', fp);
    ruby2_ui_json_string(fp, ruby2_clock_name((Ruby2Clock)i));
    fprintf(fp, ":%d", (int)snapshot->clocks[i]);
  }
  fputc('}', fp);

  fputs(",\"disciplines\":{", fp);
  for (uint8_t i = 0; i < RUBY2_DISCIPLINE_COUNT; ++i) {
    if (i != 0) fputc(',', fp);
    ruby2_ui_json_string(fp, ruby2_discipline_name((Ruby2Discipline)i));
    fprintf(fp, ":%u", (unsigned)snapshot->discipline_counts[i]);
  }
  fputc('}', fp);

  fputs(",\"people\":[", fp);
  for (uint8_t i = 0; i < snapshot->people_count; ++i) {
    Ruby2CharacterId character_id = (Ruby2CharacterId)snapshot->people[i];
    if (i != 0) fputc(',', fp);
    fputs("{\"id\":", fp);
    ruby2_ui_json_string(fp, ruby2_ui_character_id(character_id));
    fputs(",\"name\":", fp);
    ruby2_ui_json_string(fp, ruby2_world_character_name(character_id));
    fputc('}', fp);
  }
  fputc(']', fp);

  fputs(",\"items\":[", fp);
  for (uint8_t i = 0; i < snapshot->local_item_count; ++i) {
    Ruby2WorldItemId world_item_id = (Ruby2WorldItemId)snapshot->local_items[i];
    if (i != 0) fputc(',', fp);
    fputs("{\"id\":", fp);
    ruby2_ui_json_string(fp, ruby2_ui_world_item_id(world_item_id));
    fputs(",\"name\":", fp);
    ruby2_ui_json_string(fp, ruby2_world_item_name(world_item_id));
    fputc('}', fp);
  }
  fputc(']', fp);

  fputs(",\"inventory\":{\"slots\":[", fp);
  for (uint8_t i = 0; i < snapshot->item_slot_count; ++i) {
    const Ruby2UiItemSlot* slot = &snapshot->item_slots[i];
    if (i != 0) fputc(',', fp);
    fprintf(fp, "{\"slot\":%u,\"occupied\":%s", (unsigned)slot->slot_index, slot->occupied ? "true" : "false");
    if (slot->occupied) {
      fputs(",\"itemId\":", fp);
      ruby2_ui_json_string(fp, ruby2_ui_item_id(slot->item));
      fputs(",\"name\":", fp);
      ruby2_ui_json_string(fp, slot->name);
      fprintf(fp, ",\"carried\":%s,\"charges\":%d", slot->carried ? "true" : "false", (int)slot->charges);
    } else {
      fputs(",\"itemId\":null,\"name\":\"Empty\",\"carried\":false,\"charges\":0", fp);
    }
    fputc('}', fp);
  }
  fputs("]}", fp);

  fputs(",\"actions\":[", fp);
  for (uint8_t i = 0; i < snapshot->action_count; ++i) {
    const Ruby2UiAction* action = &snapshot->actions[i];
    if (i != 0) fputc(',', fp);
    fprintf(fp, "{\"id\":%u,\"actionId\":", (unsigned)action->id);
    ruby2_ui_json_string(fp, ruby2_ui_action_id(action->id));
    fputs(",\"kind\":", fp);
    ruby2_ui_json_string(fp, ruby2_ui_action_kind_name(action->kind));
    fputs(",\"label\":", fp);
    ruby2_ui_json_string(fp, action->label);
    fputs(",\"disciplineId\":", fp);
    ruby2_ui_json_string(fp, ruby2_ui_discipline_id(action->discipline));
    fputs(",\"discipline\":", fp);
    ruby2_ui_json_string(fp, ruby2_discipline_name(action->discipline));
    fputs(",\"virtueId\":", fp);
    ruby2_ui_json_string(fp, ruby2_ui_virtue_id(action->virtue));
    fputs(",\"virtue\":", fp);
    ruby2_ui_json_string(fp, ruby2_virtue_name(action->virtue));
    fprintf(fp, ",\"rankScore\":%.6g}", (double)action->rank_score);
  }
  fputc(']', fp);

  fputs(",\"events\":[", fp);
  for (uint8_t i = 0; i < snapshot->event_count; ++i) {
    const Ruby2UiEvent* event = &snapshot->events[i];
    if (i != 0) fputc(',', fp);
    fprintf(fp, "{\"kind\":");
    ruby2_ui_json_string(fp, ruby2_world_event_name(event->kind));
    fprintf(fp, ",\"tick\":%u,\"roomId\":", (unsigned)event->tick);
    ruby2_ui_json_string(fp, ruby2_ui_room_id(event->room));
    fputs(",\"characterId\":", fp);
    if (event->character < RUBY2_CHARACTER_COUNT) {
      ruby2_ui_json_string(fp, ruby2_ui_character_id(event->character));
    } else {
      fputs("null", fp);
    }
    fputs(",\"character\":", fp);
    if (event->character < RUBY2_CHARACTER_COUNT) {
      ruby2_ui_json_string(fp, ruby2_world_character_name(event->character));
    } else {
      fputs("null", fp);
    }
    fputs(",\"itemId\":", fp);
    if (event->item < RUBY2_WORLD_ITEM_COUNT) {
      ruby2_ui_json_string(fp, ruby2_ui_world_item_id(event->item));
    } else {
      fputs("null", fp);
    }
    fputs(",\"item\":", fp);
    if (event->item < RUBY2_WORLD_ITEM_COUNT) {
      ruby2_ui_json_string(fp, ruby2_world_item_name(event->item));
    } else {
      fputs("null", fp);
    }
    fputs(",\"actionId\":", fp);
    ruby2_ui_json_string(fp, ruby2_ui_action_id(event->action));
    fputs(",\"text\":", fp);
    ruby2_ui_json_string(fp, event->text);
    if (event->has_performance) {
      fputs(",\"performance\":{\"speakerId\":", fp);
      ruby2_ui_json_string(fp, ruby2_ui_character_id(event->performance_speaker));
      fputs(",\"speaker\":", fp);
      ruby2_ui_json_string(fp, ruby2_world_character_name(event->performance_speaker));
      fputs(",\"line\":", fp);
      ruby2_ui_json_string(fp, event->performance_line);
      fputc('}', fp);
    }
    fputc('}', fp);
  }
  fputc(']', fp);

  ruby2_ui_write_presentation_json(fp, snapshot);

  fputs("}\n", fp);
  return ferror(fp) == 0;
}
