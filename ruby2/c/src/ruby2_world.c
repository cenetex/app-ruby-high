#include "ruby2_world.h"
#include "ruby2_ranker.h"

#include <string.h>

static void ruby2_world_run_director(Ruby2World* world);
static Ruby2WorldItemId ruby2_world_default_item_for_character(Ruby2CharacterId character_id);

static const Ruby2WorldRoom ruby2_world_rooms[] = {
  {
    RUBY2_ROOM_HALLWAY,
    {
      RUBY2_ROOM_HOMEROOM,
      RUBY2_ROOM_SCIENCE_LAB,
      RUBY2_ROOM_LIBRARY,
      RUBY2_ROOM_CAFETERIA,
      RUBY2_ROOM_COURTYARD,
      RUBY2_ROOM_TEACHER_OFFICE
    },
    6
  },
  { RUBY2_ROOM_HOMEROOM, { RUBY2_ROOM_HALLWAY }, 1 },
  { RUBY2_ROOM_SCIENCE_LAB, { RUBY2_ROOM_HALLWAY }, 1 },
  { RUBY2_ROOM_LIBRARY, { RUBY2_ROOM_HALLWAY }, 1 },
  { RUBY2_ROOM_CAFETERIA, { RUBY2_ROOM_HALLWAY, RUBY2_ROOM_COURTYARD }, 2 },
  { RUBY2_ROOM_GREENHOUSE, { RUBY2_ROOM_COURTYARD }, 1 },
  { RUBY2_ROOM_COURTYARD, { RUBY2_ROOM_HALLWAY, RUBY2_ROOM_CAFETERIA, RUBY2_ROOM_GREENHOUSE }, 3 },
  { RUBY2_ROOM_TEACHER_OFFICE, { RUBY2_ROOM_HALLWAY }, 1 }
};

typedef struct {
  uint16_t id;
  Ruby2RoomId room;
  Ruby2CharacterId teacher;
  Ruby2WorldItemId item;
  uint8_t grade;
  bool prior_grade_review;
  const char* lines[RUBY2_WORLD_MAX_QUESTION_LINES];
  uint8_t line_count;
  const char* answer_labels[4];
  Ruby2WorldActionId correct_action;
  const char* correct_packet;
  const char* incorrect_packet;
  const char* notebook_packet;
} Ruby2TeacherQuestion;

static const Ruby2TeacherQuestion ruby2_teacher_questions[] = {
  {
    6000,
    RUBY2_ROOM_HOMEROOM,
    RUBY2_CHARACTER_RUBY,
    RUBY2_WORLD_ITEM_WORK_ORDER,
    9,
    false,
    {
      "GRADE 9 - RUBY",
      "Answer card: \"original\"; wet work order: \"revised\".",
      "Which item proves the answer changed?",
      "A answer card",
      "B wet work order",
      "C Notebook   D Flashcards"
    },
    6,
    {
      "A. answer card",
      "B. wet work order",
      "C. Notebook",
      "D. Flashcards"
    },
    RUBY2_ACTION_APPROACH_SENSE,
    "event=class_board_resolved; room=Homeroom; teacher=Ruby; grade=9; answer=B; result=correct; item=wet_work_order",
    "event=class_board_resolved; room=Homeroom; teacher=Ruby; grade=9; result=wrong_but_recovered; correct=B",
    "notebook=class_board_resolved; room=Homeroom; teacher=Ruby; grade=9; correct=B"
  },
  {
    6008,
    RUBY2_ROOM_HOMEROOM,
    RUBY2_CHARACTER_RUBY,
    RUBY2_WORLD_ITEM_FLASHCARDS,
    8,
    true,
    {
      "GRADE 8 REVIEW - RUBY",
      "Flashcards say evidence must be checkable.",
      "Which line is evidence, not opinion?",
      "A everyone knows it",
      "B work order was stamped revised",
      "C it feels wrong   D Ruby seems worried"
    },
    6,
    {
      "A. everyone knows it",
      "B. work order was stamped revised",
      "C. it feels wrong",
      "D. Ruby seems worried"
    },
    RUBY2_ACTION_APPROACH_SENSE,
    "event=class_board_resolved; room=Homeroom; teacher=Ruby; grade=8_review; answer=B; result=correct; item=flashcards",
    "event=class_board_resolved; room=Homeroom; teacher=Ruby; grade=8_review; result=wrong_but_recovered; correct=B",
    "notebook=class_board_resolved; room=Homeroom; teacher=Ruby; grade=8_review; correct=B"
  },
  {
    7100,
    RUBY2_ROOM_SCIENCE_LAB,
    RUBY2_CHARACTER_SALLY_SCIENCE,
    RUBY2_WORLD_ITEM_LAB_FLASK,
    9,
    false,
    {
      "GRADE 9 - SALLY SCIENCE",
      "A catalyst test is about to start.",
      "What must happen before changing the catalyst?",
      "A add a second catalyst",
      "B run a control sample",
      "C change heat and acid   D skip the log"
    },
    6,
    {
      "A. add a second catalyst",
      "B. run a control sample",
      "C. change heat and acid",
      "D. skip the log"
    },
    RUBY2_ACTION_APPROACH_SENSE,
    "event=class_board_resolved; room=Science Lab; teacher=Sally Science; grade=9; answer=B; result=correct; item=lab_flask",
    "event=class_board_resolved; room=Science Lab; teacher=Sally Science; grade=9; result=wrong_but_recovered; correct=B",
    "notebook=class_board_resolved; room=Science Lab; teacher=Sally Science; grade=9; correct=B"
  },
  {
    7108,
    RUBY2_ROOM_SCIENCE_LAB,
    RUBY2_CHARACTER_SALLY_SCIENCE,
    RUBY2_WORLD_ITEM_LAB_FLASK,
    8,
    true,
    {
      "GRADE 8 REVIEW - SALLY SCIENCE",
      "The lab needs 50 ml of water.",
      "Which tool measures volume most precisely?",
      "A beaker",
      "B graduated cylinder",
      "C stopwatch   D magnet"
    },
    6,
    {
      "A. beaker",
      "B. graduated cylinder",
      "C. stopwatch",
      "D. magnet"
    },
    RUBY2_ACTION_APPROACH_SENSE,
    "event=class_board_resolved; room=Science Lab; teacher=Sally Science; grade=8_review; answer=B; result=correct; item=lab_flask",
    "event=class_board_resolved; room=Science Lab; teacher=Sally Science; grade=8_review; result=wrong_but_recovered; correct=B",
    "notebook=class_board_resolved; room=Science Lab; teacher=Sally Science; grade=8_review; correct=B"
  },
  {
    7200,
    RUBY2_ROOM_LIBRARY,
    RUBY2_CHARACTER_PROFESSOR_EDWARD,
    RUBY2_WORLD_ITEM_LIBRARY_CARD,
    9,
    false,
    {
      "GRADE 9 - PROFESSOR EDWARD",
      "You need support for a school-history claim.",
      "Which source can be cited?",
      "A hallway rumor",
      "B first printed copy",
      "C margin doodle   D your memory"
    },
    6,
    {
      "A. hallway rumor",
      "B. first printed copy",
      "C. margin doodle",
      "D. your memory"
    },
    RUBY2_ACTION_APPROACH_SENSE,
    "event=class_board_resolved; room=Library; teacher=Professor Edward; grade=9; answer=B; result=correct; item=library_card",
    "event=class_board_resolved; room=Library; teacher=Professor Edward; grade=9; result=wrong_but_recovered; correct=B",
    "notebook=class_board_resolved; room=Library; teacher=Professor Edward; grade=9; correct=B"
  },
  {
    7208,
    RUBY2_ROOM_LIBRARY,
    RUBY2_CHARACTER_PROFESSOR_EDWARD,
    RUBY2_WORLD_ITEM_LIBRARY_CARD,
    8,
    true,
    {
      "GRADE 8 REVIEW - PROFESSOR EDWARD",
      "A citation must let someone find the source.",
      "Which detail belongs in the citation?",
      "A shelf color",
      "B author, title, and date",
      "C friend's guess   D page smell"
    },
    6,
    {
      "A. shelf color",
      "B. author, title, and date",
      "C. friend's guess",
      "D. page smell"
    },
    RUBY2_ACTION_APPROACH_SENSE,
    "event=class_board_resolved; room=Library; teacher=Professor Edward; grade=8_review; answer=B; result=correct; item=library_card",
    "event=class_board_resolved; room=Library; teacher=Professor Edward; grade=8_review; result=wrong_but_recovered; correct=B",
    "notebook=class_board_resolved; room=Library; teacher=Professor Edward; grade=8_review; correct=B"
  }
};

static void ruby2_world_push_event_with_visibility(
  Ruby2World* world,
  Ruby2WorldEventKind kind,
  Ruby2RoomId room,
  Ruby2CharacterId character,
  Ruby2WorldItemId item,
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
  event->item = item;
  event->action = action;
  event->visibility = visibility;
  event->text = text;
}

static void ruby2_world_push_event(
  Ruby2World* world,
  Ruby2WorldEventKind kind,
  Ruby2RoomId room,
  Ruby2CharacterId character,
  Ruby2WorldItemId item,
  Ruby2WorldActionId action,
  const char* text
) {
  ruby2_world_push_event_with_visibility(
    world,
    kind,
    room,
    character,
    item,
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
  Ruby2WorldItemId item = RUBY2_WORLD_ITEM_NOTEBOOK;
  if (intent && intent->target_item < RUBY2_WORLD_ITEM_COUNT) {
    item = intent->target_item;
  }
  if (world && character < RUBY2_CHARACTER_COUNT) {
    room = world->npc_rooms[character];
  }
  ruby2_world_push_event_with_visibility(
    world,
    RUBY2_EVENT_AGENT_INTENT_REJECTED,
    room,
    character,
    item,
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
  Ruby2WorldItemId target_item,
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
  action->target_item = target_item;
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

static bool ruby2_world_schedule_allows_room(const Ruby2World* world, Ruby2RoomId room_id) {
  if (!world || room_id >= RUBY2_ROOM_COUNT) return false;

  if (!world->homeroom_resolved) {
    return room_id == RUBY2_ROOM_HALLWAY || room_id == RUBY2_ROOM_HOMEROOM;
  }

  if (!world->lunch_started) {
    return room_id == world->game.current_room_id;
  }

  return true;
}

static bool ruby2_world_player_movement_locked(const Ruby2World* world) {
  if (!world) return true;
  if (world->chat_active) return true;
  if (world->homeroom_started && !world->homeroom_resolved) return true;
  if (world->homeroom_resolved && !world->lunch_started) return true;
  if (world->lunch_started &&
      ((world->game.current_room_id == RUBY2_ROOM_SCIENCE_LAB && !world->science_lab_quiz_resolved) ||
       (world->game.current_room_id == RUBY2_ROOM_LIBRARY && !world->library_quiz_resolved))) {
    return true;
  }
  return false;
}

static bool ruby2_world_inventory_item_for_world_item(Ruby2WorldItemId world_item_id, Ruby2ItemId* out) {
  Ruby2ItemId item_id;
  switch (world_item_id) {
    case RUBY2_WORLD_ITEM_NOTEBOOK:
      item_id = RUBY2_ITEM_NOTEBOOK;
      break;
    case RUBY2_WORLD_ITEM_FLASHCARDS:
      item_id = RUBY2_ITEM_FLASHCARDS;
      break;
    case RUBY2_WORLD_ITEM_LUNCH_TRAY:
      item_id = RUBY2_ITEM_LUNCH_TRAY;
      break;
    case RUBY2_WORLD_ITEM_OFFICE_PASS:
      item_id = RUBY2_ITEM_OFFICE_PASS;
      break;
    case RUBY2_WORLD_ITEM_LIBRARY_CARD:
      item_id = RUBY2_ITEM_LIBRARY_CARD;
      break;
    case RUBY2_WORLD_ITEM_LAB_FLASK:
      item_id = RUBY2_ITEM_LAB_FLASK;
      break;
    default:
      return false;
  }
  if (out) *out = item_id;
  return true;
}

static bool ruby2_world_collect_action_for_item(
  Ruby2WorldItemId world_item_id,
  Ruby2WorldActionId* out
) {
  Ruby2WorldActionId action_id;
  switch (world_item_id) {
    case RUBY2_WORLD_ITEM_NOTEBOOK:
      action_id = RUBY2_ACTION_COLLECT_NOTEBOOK;
      break;
    case RUBY2_WORLD_ITEM_FLASHCARDS:
      action_id = RUBY2_ACTION_COLLECT_FLASHCARDS;
      break;
    case RUBY2_WORLD_ITEM_LUNCH_TRAY:
      action_id = RUBY2_ACTION_COLLECT_LUNCH_TRAY;
      break;
    case RUBY2_WORLD_ITEM_OFFICE_PASS:
      action_id = RUBY2_ACTION_COLLECT_OFFICE_PASS;
      break;
    case RUBY2_WORLD_ITEM_LIBRARY_CARD:
      action_id = RUBY2_ACTION_COLLECT_LIBRARY_CARD;
      break;
    case RUBY2_WORLD_ITEM_LAB_FLASK:
      action_id = RUBY2_ACTION_COLLECT_LAB_FLASK;
      break;
    default:
      return false;
  }
  if (out) *out = action_id;
  return true;
}

static bool ruby2_world_action_collect_item(
  Ruby2WorldActionId action_id,
  Ruby2WorldItemId* out
) {
  Ruby2WorldItemId world_item_id;
  switch (action_id) {
    case RUBY2_ACTION_COLLECT_NOTEBOOK:
      world_item_id = RUBY2_WORLD_ITEM_NOTEBOOK;
      break;
    case RUBY2_ACTION_COLLECT_FLASHCARDS:
      world_item_id = RUBY2_WORLD_ITEM_FLASHCARDS;
      break;
    case RUBY2_ACTION_COLLECT_LUNCH_TRAY:
      world_item_id = RUBY2_WORLD_ITEM_LUNCH_TRAY;
      break;
    case RUBY2_ACTION_COLLECT_OFFICE_PASS:
      world_item_id = RUBY2_WORLD_ITEM_OFFICE_PASS;
      break;
    case RUBY2_ACTION_COLLECT_LIBRARY_CARD:
      world_item_id = RUBY2_WORLD_ITEM_LIBRARY_CARD;
      break;
    case RUBY2_ACTION_COLLECT_LAB_FLASK:
      world_item_id = RUBY2_WORLD_ITEM_LAB_FLASK;
      break;
    default:
      return false;
  }
  if (out) *out = world_item_id;
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

static int ruby2_world_question_answer_index(Ruby2WorldActionId action_id) {
  switch (action_id) {
    case RUBY2_ACTION_APPROACH_SOURCE:
      return 0;
    case RUBY2_ACTION_APPROACH_SENSE:
      return 1;
    case RUBY2_ACTION_APPROACH_SYNC:
      return 2;
    case RUBY2_ACTION_APPROACH_SIGNAL:
      return 3;
    default:
      return -1;
  }
}

static const Ruby2TeacherQuestion* ruby2_world_find_teacher_question(
  Ruby2RoomId room_id,
  uint8_t grade,
  bool prior_grade_review
) {
  for (uint8_t i = 0; i < (uint8_t)(sizeof(ruby2_teacher_questions) / sizeof(ruby2_teacher_questions[0])); ++i) {
    const Ruby2TeacherQuestion* question = &ruby2_teacher_questions[i];
    if (question->room == room_id &&
        question->grade == grade &&
        question->prior_grade_review == prior_grade_review) {
      return question;
    }
  }
  return NULL;
}

static bool ruby2_world_should_mix_prior_grade_question(const Ruby2World* world, Ruby2RoomId room_id) {
  if (!world || world->current_grade <= 8u) return false;
  return ((uint16_t)world->current_grade + world->class_day + (uint16_t)room_id) % 3u == 0u;
}

static const Ruby2TeacherQuestion* ruby2_world_select_teacher_question(
  const Ruby2World* world,
  Ruby2RoomId room_id
) {
  uint8_t grade = world && world->current_grade ? world->current_grade : 9u;
  const Ruby2TeacherQuestion* question = NULL;

  if (ruby2_world_should_mix_prior_grade_question(world, room_id)) {
    question = ruby2_world_find_teacher_question(room_id, (uint8_t)(grade - 1u), true);
    if (question) return question;
  }

  question = ruby2_world_find_teacher_question(room_id, grade, false);
  if (question) return question;

  if (grade > 8u) {
    question = ruby2_world_find_teacher_question(room_id, (uint8_t)(grade - 1u), true);
    if (question) return question;
  }

  for (uint8_t i = 0; i < (uint8_t)(sizeof(ruby2_teacher_questions) / sizeof(ruby2_teacher_questions[0])); ++i) {
    if (ruby2_teacher_questions[i].room == room_id) return &ruby2_teacher_questions[i];
  }
  return NULL;
}

static const char* ruby2_world_teacher_question_action_label(
  const Ruby2TeacherQuestion* question,
  Ruby2WorldActionId action_id
) {
  int answer_index = ruby2_world_question_answer_index(action_id);
  if (!question || answer_index < 0) return ruby2_world_action_label(action_id);
  return question->answer_labels[answer_index]
    ? question->answer_labels[answer_index]
    : ruby2_world_action_label(action_id);
}

static bool ruby2_world_teacher_question_answer_correct(
  const Ruby2TeacherQuestion* question,
  Ruby2WorldActionId action_id
) {
  return question && question->correct_action == action_id;
}

static void ruby2_world_ensure_action_floor(
  const Ruby2World* world,
  Ruby2WorldActionList* out,
  Ruby2RoomId room_id
) {
  if (!world || !out || out->count > 0) return;

  if (world->chat_active &&
      world->chat_room == room_id &&
      world->chat_character < RUBY2_CHARACTER_COUNT) {
    ruby2_world_add_action(
      out,
      RUBY2_ACTION_CHAT_OPTION_A,
      RUBY2_WORLD_ACTION_CHAT_CHOICE,
      room_id,
      world->chat_character,
      ruby2_world_default_item_for_character(world->chat_character),
      RUBY2_DISCIPLINE_SOURCE,
      RUBY2_VIRTUE_HEAD,
      world->chat_options[0] ? world->chat_options[0] : ruby2_world_action_label(RUBY2_ACTION_CHAT_OPTION_A)
    );
    return;
  }

  if (ruby2_world_notebook_owned(world)) {
    ruby2_world_add_action(
      out,
      RUBY2_ACTION_CHECK_NOTEBOOK,
      RUBY2_WORLD_ACTION_CHECK_NOTES,
      room_id,
      RUBY2_CHARACTER_NONE,
      RUBY2_WORLD_ITEM_NOTEBOOK,
      RUBY2_DISCIPLINE_SENSE,
      RUBY2_VIRTUE_HEAD,
      ruby2_world_action_label(RUBY2_ACTION_CHECK_NOTEBOOK)
    );
    return;
  }

  ruby2_world_add_action(
    out,
    RUBY2_ACTION_WAIT_BELL,
    RUBY2_WORLD_ACTION_WAIT,
    room_id,
    RUBY2_CHARACTER_NONE,
    RUBY2_WORLD_ITEM_NOTEBOOK,
    RUBY2_DISCIPLINE_SYNC,
    RUBY2_VIRTUE_HUSTLE,
    ruby2_world_action_label(RUBY2_ACTION_WAIT_BELL)
  );
}

static void ruby2_world_finalize_actions(
  const Ruby2World* world,
  Ruby2WorldActionList* out,
  Ruby2RoomId room_id
) {
  ruby2_world_dismiss_last_action(out, world);
  ruby2_world_ensure_action_floor(world, out, room_id);
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

static const char* ruby2_world_profile_selected_packet(Ruby2PlayerAvatarId avatar_id) {
  switch (avatar_id) {
    case RUBY2_PLAYER_AVATAR_SOURCE:
      return "event=profile_selected; avatar=Source";
    case RUBY2_PLAYER_AVATAR_SENSE:
      return "event=profile_selected; avatar=Sense";
    case RUBY2_PLAYER_AVATAR_SYNC:
      return "event=profile_selected; avatar=Sync";
    case RUBY2_PLAYER_AVATAR_SIGNAL:
      return "event=profile_selected; avatar=Signal";
    case RUBY2_PLAYER_AVATAR_UNSET:
    default:
      return "event=profile_selected; avatar=Unset";
  }
}

static const char* ruby2_world_room_entered_packet(Ruby2RoomId room_id) {
  switch (room_id) {
    case RUBY2_ROOM_HALLWAY:
      return "event=room_entered; room=Hallway";
    case RUBY2_ROOM_HOMEROOM:
      return "event=room_entered; room=Homeroom";
    case RUBY2_ROOM_SCIENCE_LAB:
      return "event=room_entered; room=Science Lab";
    case RUBY2_ROOM_LIBRARY:
      return "event=room_entered; room=Library";
    case RUBY2_ROOM_CAFETERIA:
      return "event=room_entered; room=Cafeteria";
    case RUBY2_ROOM_GREENHOUSE:
      return "event=room_entered; room=Greenhouse";
    case RUBY2_ROOM_COURTYARD:
      return "event=room_entered; room=Courtyard";
    case RUBY2_ROOM_TEACHER_OFFICE:
      return "event=room_entered; room=Teacher Office";
    default:
      return "event=room_entered; room=Unknown";
  }
}

static uint16_t ruby2_world_teacher_question_candidate_id(
  const Ruby2TeacherQuestion* question,
  Ruby2WorldActionId action_id
) {
  int answer_index = ruby2_world_question_answer_index(action_id);
  if (!question) return 0u;
  return (uint16_t)(question->id + (answer_index >= 0 ? (uint16_t)(answer_index + 1) : 0u));
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

static Ruby2WorldItemId ruby2_world_default_item_for_character(Ruby2CharacterId character_id) {
  switch (character_id) {
    case RUBY2_CHARACTER_RAVI:
      return RUBY2_WORLD_ITEM_WORK_ORDER;
    case RUBY2_CHARACTER_NOOR:
      return RUBY2_WORLD_ITEM_LUNCH_TRAY;
    case RUBY2_CHARACTER_MIKA:
      return RUBY2_WORLD_ITEM_LAB_FLASK;
    case RUBY2_CHARACTER_INDRA:
      return RUBY2_WORLD_ITEM_LIBRARY_CARD;
    case RUBY2_CHARACTER_SAMI:
      return RUBY2_WORLD_ITEM_LUNCH_TRAY;
    case RUBY2_CHARACTER_SALLY_SCIENCE:
      return RUBY2_WORLD_ITEM_LAB_FLASK;
    case RUBY2_CHARACTER_PROFESSOR_EDWARD:
      return RUBY2_WORLD_ITEM_LIBRARY_CARD;
    case RUBY2_CHARACTER_RUBY:
    case RUBY2_CHARACTER_LYRA:
    default:
      return RUBY2_WORLD_ITEM_NOTEBOOK;
  }
}

static Ruby2CharacterId ruby2_world_first_room_speaker(const Ruby2World* world, Ruby2RoomId room_id) {
  static const Ruby2CharacterId order[] = {
    RUBY2_CHARACTER_RUBY,
    RUBY2_CHARACTER_SALLY_SCIENCE,
    RUBY2_CHARACTER_PROFESSOR_EDWARD,
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
    case RUBY2_CHARACTER_SALLY_SCIENCE:
      return RUBY2_DISCIPLINE_SOURCE;
    case RUBY2_CHARACTER_INDRA:
    case RUBY2_CHARACTER_PROFESSOR_EDWARD:
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
  (void)character;
  return option == 0
    ? "Ground the conversation in local items."
    : "Ask for the next concrete move.";
}

static const char* ruby2_world_room_chat_option_label(uint8_t option) {
  return option == 0
    ? "Ground the room in local items."
    : "Ask the room for the next concrete move.";
}

static const char* ruby2_world_chat_choice_packet(bool room_mode, uint8_t option) {
  if (room_mode) {
    return option == 0
      ? "event=room_conversation_choice; player_intent=ground_visible_item; scope=room"
      : "event=room_conversation_choice; player_intent=request_next_concrete_move; scope=room";
  }
  return option == 0
    ? "event=character_conversation_choice; player_intent=ground_visible_item; scope=one_character"
    : "event=character_conversation_choice; player_intent=request_next_concrete_move; scope=one_character";
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

static bool ruby2_world_apply_room_quiz_approach(
  Ruby2World* world,
  Ruby2WorldActionId action_id
) {
  Ruby2EffectPayload payload;
  Ruby2RoomId room_id;
  const Ruby2TeacherQuestion* question;
  bool correct;
  if (!world) return false;

  room_id = world->game.current_room_id;
  if (!ruby2_world_room_quiz_available(world, room_id)) return false;
  question = ruby2_world_select_teacher_question(world, room_id);
  if (!question) return false;
  correct = ruby2_world_teacher_question_answer_correct(question, action_id);

  world->tick++;
  ruby2_effect_payload_init(&payload);
  payload.create_yearbook_candidate = true;
  payload.milestone_kind = RUBY2_MILESTONE_CLASS_REPORT;
  payload.candidate_score = correct ? 9 : 5;
  payload.candidate_id = ruby2_world_teacher_question_candidate_id(question, action_id);

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
  world->game.failed_forward_recently = !correct;
  if (room_id == RUBY2_ROOM_SCIENCE_LAB) {
    world->science_lab_quiz_resolved = true;
  } else if (room_id == RUBY2_ROOM_LIBRARY) {
    world->library_quiz_resolved = true;
  } else {
    return false;
  }

  ruby2_world_push_event(
    world,
    RUBY2_EVENT_APPROACH_RESOLVED,
    room_id,
    question->teacher,
    question->item,
    action_id,
    correct ? question->correct_packet : question->incorrect_packet
  );
  ruby2_world_push_event(
    world,
    RUBY2_EVENT_NOTEBOOK_UPDATED,
    room_id,
    RUBY2_CHARACTER_NONE,
    RUBY2_WORLD_ITEM_NOTEBOOK,
    action_id,
    question->notebook_packet
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
  world->chat_prompt = "Choose the player intent for this conversation beat.";
  world->chat_options[0] = ruby2_world_chat_option_label(character_id, 0);
  world->chat_options[1] = ruby2_world_chat_option_label(character_id, 1);
}

static void ruby2_world_open_room_chat(Ruby2World* world, Ruby2CharacterId speaker_id) {
  if (!world || speaker_id >= RUBY2_CHARACTER_COUNT) return;
  world->chat_active = true;
  world->chat_room_mode = true;
  world->chat_character = speaker_id;
  world->chat_room = world->game.current_room_id;
  world->chat_prompt = "Choose the player intent for this room conversation beat.";
  world->chat_options[0] = ruby2_world_room_chat_option_label(0);
  world->chat_options[1] = ruby2_world_room_chat_option_label(1);
}

static const char* ruby2_world_collect_line(Ruby2WorldItemId world_item_id) {
  switch (world_item_id) {
    case RUBY2_WORLD_ITEM_NOTEBOOK:
      return "event=item_collected; item=Notebook; affordance=records_day_state";
    case RUBY2_WORLD_ITEM_FLASHCARDS:
      return "event=item_collected; item=Flashcards; charges=2";
    case RUBY2_WORLD_ITEM_LUNCH_TRAY:
      return "event=item_collected; item=Lunch Tray; affordance=cafeteria_social";
    case RUBY2_WORLD_ITEM_OFFICE_PASS:
      return "event=item_collected; item=Office Pass; charges=1; affordance=recovery";
    case RUBY2_WORLD_ITEM_LIBRARY_CARD:
      return "event=item_collected; item=Library Card; affordance=library_access";
    case RUBY2_WORLD_ITEM_LAB_FLASK:
      return "event=item_collected; item=Lab Flask; affordance=lab_practice";
    default:
      return "event=item_collected; item=unknown";
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
  world->npc_rooms[RUBY2_CHARACTER_SALLY_SCIENCE] = RUBY2_ROOM_SCIENCE_LAB;
  world->npc_rooms[RUBY2_CHARACTER_PROFESSOR_EDWARD] = RUBY2_ROOM_LIBRARY;

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

  if (!world->game.items[RUBY2_ITEM_LUNCH_TRAY].owned) {
    world->world_items[RUBY2_WORLD_ITEM_LUNCH_TRAY].present = true;
    world->world_items[RUBY2_WORLD_ITEM_LUNCH_TRAY].room = RUBY2_ROOM_CAFETERIA;
  } else {
    world->world_items[RUBY2_WORLD_ITEM_LUNCH_TRAY].present = false;
  }

  ruby2_world_push_event(
    world,
    RUBY2_EVENT_TIME_ADVANCED,
    world->game.current_room_id,
    RUBY2_CHARACTER_NONE,
    RUBY2_WORLD_ITEM_NOTEBOOK,
    RUBY2_ACTION_WAIT_BELL,
    "event=time_advanced; period=Lunch; reason=bell_after_homeroom"
  );
  ruby2_world_push_event(
    world,
    RUBY2_EVENT_NPC_MOVED,
    RUBY2_ROOM_CAFETERIA,
    RUBY2_CHARACTER_NOOR,
    RUBY2_WORLD_ITEM_NOTEBOOK,
    RUBY2_ACTION_WAIT_BELL,
    "event=npc_moved; character=Noor; room=Cafeteria; reason=lunch_schedule"
  );
  if (world->homeroom_approach_action == RUBY2_ACTION_APPROACH_SOURCE) {
    ruby2_world_push_event(
      world,
      RUBY2_EVENT_NPC_MOVED,
      RUBY2_ROOM_CAFETERIA,
      RUBY2_CHARACTER_RAVI,
      RUBY2_WORLD_ITEM_WORK_ORDER,
      RUBY2_ACTION_WAIT_BELL,
      "event=npc_moved; character=Ravi; room=Cafeteria; reason=source_approach_callback"
    );
  } else if (world->homeroom_approach_action == RUBY2_ACTION_APPROACH_SENSE) {
    ruby2_world_push_event(
      world,
      RUBY2_EVENT_NPC_MOVED,
      RUBY2_ROOM_CAFETERIA,
      RUBY2_CHARACTER_INDRA,
      RUBY2_WORLD_ITEM_LUNCH_TRAY,
      RUBY2_ACTION_WAIT_BELL,
      "event=npc_moved; character=Indra; room=Cafeteria; reason=sense_approach_callback"
    );
  } else if (world->homeroom_approach_action == RUBY2_ACTION_APPROACH_SYNC) {
    ruby2_world_push_event(
      world,
      RUBY2_EVENT_NPC_MOVED,
      RUBY2_ROOM_CAFETERIA,
      RUBY2_CHARACTER_MIKA,
      RUBY2_WORLD_ITEM_LUNCH_TRAY,
      RUBY2_ACTION_WAIT_BELL,
      "event=npc_moved; character=Mika; room=Cafeteria; reason=sync_approach_callback"
    );
  }
  ruby2_world_push_event(
    world,
    RUBY2_EVENT_ITEM_APPEARED,
    RUBY2_ROOM_CAFETERIA,
    RUBY2_CHARACTER_NONE,
    RUBY2_WORLD_ITEM_LUNCH_TRAY,
    RUBY2_ACTION_WAIT_BELL,
    "event=item_appeared; item=lunch_tray; room=Cafeteria; source=lunch_tray_rail"
  );
}

static void ruby2_world_trigger_room_events(Ruby2World* world) {
  if (!world) return;
  if (world->game.current_room_id == RUBY2_ROOM_CAFETERIA &&
      world->lunch_started &&
      world->world_items[RUBY2_WORLD_ITEM_LUNCH_TRAY].present &&
      !world->lunch_social_triggered) {
    world->lunch_social_triggered = true;
    ruby2_world_push_event(
      world,
      RUBY2_EVENT_SOCIAL_TRIGGERED,
      RUBY2_ROOM_CAFETERIA,
      RUBY2_CHARACTER_NOOR,
      RUBY2_WORLD_ITEM_LUNCH_TRAY,
      RUBY2_ACTION_GO_CAFETERIA,
      "event=social_triggered; speaker=Noor; item=lunch_tray; reason=player_entered_room_with_visible_item"
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
      world->world_items[RUBY2_WORLD_ITEM_NOTEBOOK].room = RUBY2_ROOM_HOMEROOM;
    }
    ruby2_world_push_event(
      world,
      RUBY2_EVENT_DIRECTOR_TRIGGERED,
      RUBY2_ROOM_HOMEROOM,
      RUBY2_CHARACTER_RUBY,
      RUBY2_WORLD_ITEM_NOTEBOOK,
      RUBY2_ACTION_WAIT_BELL,
      "event=schedule_redirect; speaker=Ruby; destination=Homeroom; reason=arrival_bell_threshold"
    );
    ruby2_world_push_event(
      world,
      RUBY2_EVENT_ROOM_ENTERED,
      RUBY2_ROOM_HOMEROOM,
      RUBY2_CHARACTER_NONE,
      RUBY2_WORLD_ITEM_NOTEBOOK,
      RUBY2_ACTION_GO_HOMEROOM,
      "event=room_entered; room=Homeroom; reason=arrival_bell_threshold"
    );
  } else {
    ruby2_world_push_event(
      world,
      RUBY2_EVENT_DIRECTOR_TRIGGERED,
      world->game.current_room_id,
      RUBY2_CHARACTER_RUBY,
      RUBY2_WORLD_ITEM_NOTEBOOK,
      RUBY2_ACTION_WAIT_BELL,
      "event=schedule_pressure; room=Hallway; destination=Homeroom; reason=arrival_bell"
    );
  }

  ruby2_sync_state_variables(&world->game);
}

static void ruby2_world_advance_bell(Ruby2World* world) {
  if (!world) return;

  world->bell_step_pending = true;

  if (world->game.current_time_block == RUBY2_TIME_ARRIVAL && !world->homeroom_started) {
    ruby2_world_apply_bell_pressure(world);
    return;
  }

  if (world->homeroom_started && !world->homeroom_resolved) {
    ruby2_world_push_event(
      world,
      RUBY2_EVENT_DIRECTOR_TRIGGERED,
      world->game.current_room_id,
      RUBY2_CHARACTER_RUBY,
      RUBY2_WORLD_ITEM_ANSWER_CARD,
      RUBY2_ACTION_WAIT_BELL,
      "event=schedule_blocked; reason=class_board_unanswered; required_action=answer_blackboard"
    );
    ruby2_sync_state_variables(&world->game);
    return;
  }

  if (world->homeroom_resolved && !world->lunch_started) {
    ruby2_world_start_lunch_if_ready(world);
    return;
  }

  if (world->lunch_started &&
      (!world->science_lab_quiz_resolved || !world->library_quiz_resolved)) {
    ruby2_world_push_event(
      world,
      RUBY2_EVENT_DIRECTOR_TRIGGERED,
      world->game.current_room_id,
      RUBY2_CHARACTER_RUBY,
      RUBY2_WORLD_ITEM_NOTEBOOK,
      RUBY2_ACTION_WAIT_BELL,
      "event=schedule_blocked; reason=required_boards_unanswered; required_rooms=Science Lab,Library"
    );
    ruby2_sync_state_variables(&world->game);
    return;
  }

  if (world->game.current_time_block != RUBY2_TIME_AFTER_SCHOOL) {
    world->game.current_time_block = RUBY2_TIME_AFTER_SCHOOL;
    ruby2_world_push_event(
      world,
      RUBY2_EVENT_TIME_ADVANCED,
      world->game.current_room_id,
      RUBY2_CHARACTER_NONE,
      RUBY2_WORLD_ITEM_NOTEBOOK,
      RUBY2_ACTION_WAIT_BELL,
      "event=time_advanced; period=After School; reason=required_boards_resolved"
    );
  } else {
    ruby2_world_push_event(
      world,
      RUBY2_EVENT_IDLE,
      world->game.current_room_id,
      RUBY2_CHARACTER_NONE,
      RUBY2_WORLD_ITEM_NOTEBOOK,
      RUBY2_ACTION_WAIT_BELL,
      "event=idle; period=After School; reason=day_already_released"
    );
  }
  ruby2_sync_state_variables(&world->game);
}

static void ruby2_world_run_director(Ruby2World* world) {
  if (!world) return;
  ruby2_world_trigger_room_events(world);
  ruby2_sync_state_variables(&world->game);
}

static void ruby2_world_apply_approach(Ruby2World* world, Ruby2WorldActionId action_id) {
  Ruby2EffectPayload payload;
  const Ruby2TeacherQuestion* question = ruby2_world_select_teacher_question(world, RUBY2_ROOM_HOMEROOM);
  bool correct = ruby2_world_teacher_question_answer_correct(question, action_id);
  ruby2_effect_payload_init(&payload);
  payload.create_yearbook_candidate = true;
  payload.milestone_kind = RUBY2_MILESTONE_CLASS_REPORT;
  payload.candidate_score = correct ? 9 : 5;

  switch (action_id) {
    case RUBY2_ACTION_APPROACH_SOURCE:
      payload.discipline_deltas[RUBY2_DISCIPLINE_SOURCE] = 1;
      payload.virtue_deltas[RUBY2_VIRTUE_HONOR] = 1;
      payload.affinity_deltas[RUBY2_CHARACTER_RAVI] = 1;
      payload.reputation_tag = RUBY2_ARCHETYPE_CONSCIENCE;
      payload.candidate_id = ruby2_world_teacher_question_candidate_id(question, action_id);
      break;
    case RUBY2_ACTION_APPROACH_SENSE:
      payload.discipline_deltas[RUBY2_DISCIPLINE_SENSE] = 1;
      payload.virtue_deltas[RUBY2_VIRTUE_HEAD] = 1;
      payload.affinity_deltas[RUBY2_CHARACTER_LYRA] = 1;
      payload.reputation_tag = RUBY2_ARCHETYPE_SCHOLAR;
      payload.candidate_id = ruby2_world_teacher_question_candidate_id(question, action_id);
      break;
    case RUBY2_ACTION_APPROACH_SYNC:
      payload.discipline_deltas[RUBY2_DISCIPLINE_SYNC] = 1;
      payload.virtue_deltas[RUBY2_VIRTUE_HEART] = 1;
      payload.affinity_deltas[RUBY2_CHARACTER_LYRA] = 1;
      payload.reputation_tag = RUBY2_ARCHETYPE_CONNECTOR;
      payload.candidate_id = ruby2_world_teacher_question_candidate_id(question, action_id);
      break;
    case RUBY2_ACTION_APPROACH_SIGNAL:
      payload.discipline_deltas[RUBY2_DISCIPLINE_SIGNAL] = 1;
      payload.virtue_deltas[RUBY2_VIRTUE_HONOR] = 1;
      payload.affinity_deltas[RUBY2_CHARACTER_NOOR] = 1;
      payload.clock_deltas[RUBY2_CLOCK_NULL_SIGNAL] = 1;
      payload.reputation_tag = RUBY2_ARCHETYPE_SIGNAL_READER;
      payload.candidate_id = ruby2_world_teacher_question_candidate_id(question, action_id);
      break;
    default:
      return;
  }

  ruby2_apply_effect_payload(&world->game, &payload);
  world->game.failed_forward_recently = !correct;
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
  world->current_grade = 9;
  world->class_day = 1;
  world->has_last_action = false;
  world->last_action_id = RUBY2_ACTION_NONE;
  world->last_action_room = RUBY2_ROOM_COUNT;
  world->recent_action_count = 0;
  world->player_profile_ready = true;
  world->player_avatar = RUBY2_PLAYER_AVATAR_SOURCE;
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
  world->npc_rooms[RUBY2_CHARACTER_SALLY_SCIENCE] = RUBY2_ROOM_SCIENCE_LAB;
  world->npc_rooms[RUBY2_CHARACTER_PROFESSOR_EDWARD] = RUBY2_ROOM_LIBRARY;

  world->world_items[RUBY2_WORLD_ITEM_ANSWER_CARD].present = true;
  world->world_items[RUBY2_WORLD_ITEM_ANSWER_CARD].room = RUBY2_ROOM_HOMEROOM;
  world->world_items[RUBY2_WORLD_ITEM_WORK_ORDER].present = true;
  world->world_items[RUBY2_WORLD_ITEM_WORK_ORDER].room = RUBY2_ROOM_HOMEROOM;
  world->world_items[RUBY2_WORLD_ITEM_LUNCH_TRAY].present = false;
  world->world_items[RUBY2_WORLD_ITEM_LUNCH_TRAY].room = RUBY2_ROOM_CAFETERIA;
  world->world_items[RUBY2_WORLD_ITEM_NOTEBOOK].present = true;
  world->world_items[RUBY2_WORLD_ITEM_NOTEBOOK].room = RUBY2_ROOM_HALLWAY;
  world->world_items[RUBY2_WORLD_ITEM_FLASHCARDS].present = true;
  world->world_items[RUBY2_WORLD_ITEM_FLASHCARDS].room = RUBY2_ROOM_HOMEROOM;
  world->world_items[RUBY2_WORLD_ITEM_LUNCH_TRAY].present = false;
  world->world_items[RUBY2_WORLD_ITEM_LUNCH_TRAY].room = RUBY2_ROOM_CAFETERIA;
  world->world_items[RUBY2_WORLD_ITEM_OFFICE_PASS].present = true;
  world->world_items[RUBY2_WORLD_ITEM_OFFICE_PASS].room = RUBY2_ROOM_TEACHER_OFFICE;
  world->world_items[RUBY2_WORLD_ITEM_LIBRARY_CARD].present = true;
  world->world_items[RUBY2_WORLD_ITEM_LIBRARY_CARD].room = RUBY2_ROOM_LIBRARY;
  world->world_items[RUBY2_WORLD_ITEM_LAB_FLASK].present = true;
  world->world_items[RUBY2_WORLD_ITEM_LAB_FLASK].room = RUBY2_ROOM_SCIENCE_LAB;

  ruby2_sync_state_variables(&world->game);
  ruby2_world_push_event(
    world,
    RUBY2_EVENT_ROOM_ENTERED,
    RUBY2_ROOM_HALLWAY,
    RUBY2_CHARACTER_NONE,
    RUBY2_WORLD_ITEM_NOTEBOOK,
    RUBY2_ACTION_GO_HALLWAY,
    "event=room_entered; room=Hallway; player_role=new freshman; goal=reach Homeroom before bell pressure"
  );
}

const Ruby2WorldRoom* ruby2_world_room(Ruby2RoomId room_id) {
  if (room_id >= RUBY2_ROOM_COUNT) return NULL;
  return &ruby2_world_rooms[room_id];
}

const char* ruby2_world_character_name(Ruby2CharacterId character_id) {
  static const char* names[] = {
    "Ruby",
    "Lyra",
    "Mika",
    "Ravi",
    "Indra",
    "Noor",
    "Sami",
    "Sally Science",
    "Professor Edward"
  };
  return character_id < RUBY2_CHARACTER_COUNT ? names[character_id] : "Unknown";
}

const char* ruby2_world_item_name(Ruby2WorldItemId world_item_id) {
  static const char* names[] = {
    "answer card",
    "wet work order",
    "Notebook",
    "Flashcards",
    "Lunch Tray",
    "Office Pass",
    "Library Card",
    "Lab Flask"
  };
  return world_item_id < RUBY2_WORLD_ITEM_COUNT ? names[world_item_id] : "unknown item";
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
    case RUBY2_ACTION_SELECT_AVATAR_SOURCE: return "Student style: Source";
    case RUBY2_ACTION_SELECT_AVATAR_SENSE: return "Student style: Sense";
    case RUBY2_ACTION_SELECT_AVATAR_SYNC: return "Student style: Sync";
    case RUBY2_ACTION_SELECT_AVATAR_SIGNAL: return "Student style: Signal";
    case RUBY2_ACTION_CHAT_ROOM: return "Chat";
    case RUBY2_ACTION_TALK_RUBY: return "Talk to Ruby";
    case RUBY2_ACTION_TALK_LYRA: return "Talk to Lyra";
    case RUBY2_ACTION_TALK_MIKA: return "Talk to Mika";
    case RUBY2_ACTION_TALK_RAVI: return "Talk to Ravi";
    case RUBY2_ACTION_TALK_INDRA: return "Talk to Indra";
    case RUBY2_ACTION_TALK_NOOR: return "Talk to Noor";
    case RUBY2_ACTION_TALK_SAMI: return "Talk to Sami";
    case RUBY2_ACTION_ATTEND_HOMEROOM: return "Attend Homeroom";
    case RUBY2_ACTION_APPROACH_SOURCE: return "A.";
    case RUBY2_ACTION_APPROACH_SENSE: return "B.";
    case RUBY2_ACTION_APPROACH_SYNC: return "C.";
    case RUBY2_ACTION_APPROACH_SIGNAL: return "D.";
    case RUBY2_ACTION_USE_LUNCH_TRAY: return "Sit down with the Lunch Tray.";
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
    "item_appeared",
    "time_advanced",
    "class_started",
    "approach_resolved",
    "social_triggered",
    "item_used",
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
    "rejected_item_absent",
    "rejected_empty_text",
    "rejected_not_bell"
  };
  return result <= RUBY2_AGENT_INTENT_REJECTED_NOT_BELL ? names[result] : "rejected_unknown";
}

bool ruby2_world_event_visible_to_player(const Ruby2WorldEvent* event) {
  return event && event->visibility == RUBY2_EVENT_VISIBLE_TO_PLAYER;
}

bool ruby2_world_character_present(const Ruby2World* world, Ruby2CharacterId character_id, Ruby2RoomId room_id) {
  return world && character_id < RUBY2_CHARACTER_COUNT && world->npc_rooms[character_id] == room_id;
}

bool ruby2_world_item_present(const Ruby2World* world, Ruby2WorldItemId world_item_id, Ruby2RoomId room_id) {
  return world && world_item_id < RUBY2_WORLD_ITEM_COUNT &&
         world->world_items[world_item_id].present &&
         world->world_items[world_item_id].room == room_id;
}

bool ruby2_world_active_teacher_question(
  const Ruby2World* world,
  Ruby2RoomId room_id,
  Ruby2TeacherQuestionView* out
) {
  const Ruby2TeacherQuestion* question;
  if (!out) return false;
  memset(out, 0, sizeof(*out));
  question = ruby2_world_select_teacher_question(world, room_id);
  if (!question) return false;

  out->present = true;
  out->id = question->id;
  out->room = question->room;
  out->teacher = question->teacher;
  out->item = question->item;
  out->grade = question->grade;
  out->prior_grade_review = question->prior_grade_review;
  out->line_count = question->line_count;
  out->correct_action = question->correct_action;
  for (uint8_t i = 0; i < question->line_count && i < RUBY2_WORLD_MAX_QUESTION_LINES; ++i) {
    out->lines[i] = question->lines[i];
  }
  return true;
}

static void ruby2_world_add_teacher_question_actions(
  Ruby2WorldActionList* out,
  Ruby2RoomId room_id,
  const Ruby2TeacherQuestion* question
) {
  static const Ruby2WorldActionId ids[] = {
    RUBY2_ACTION_APPROACH_SOURCE,
    RUBY2_ACTION_APPROACH_SENSE,
    RUBY2_ACTION_APPROACH_SYNC,
    RUBY2_ACTION_APPROACH_SIGNAL
  };
  static const Ruby2Discipline disciplines[] = {
    RUBY2_DISCIPLINE_SOURCE,
    RUBY2_DISCIPLINE_SENSE,
    RUBY2_DISCIPLINE_SYNC,
    RUBY2_DISCIPLINE_SIGNAL
  };
  static const Ruby2Virtue virtues[] = {
    RUBY2_VIRTUE_HEAD,
    RUBY2_VIRTUE_HEAD,
    RUBY2_VIRTUE_HEART,
    RUBY2_VIRTUE_HONOR
  };

  if (!out || !question) return;
  for (uint8_t i = 0; i < 4u; ++i) {
    ruby2_world_add_action(
      out,
      ids[i],
      RUBY2_WORLD_ACTION_APPROACH,
      room_id,
      question->teacher,
      question->item,
      disciplines[i],
      virtues[i],
      ruby2_world_teacher_question_action_label(question, ids[i])
    );
  }
}

void ruby2_world_query_actions(const Ruby2World* world, Ruby2WorldActionList* out) {
  if (!world || !out) return;
  memset(out, 0, sizeof(*out));

  Ruby2RoomId room_id = world->game.current_room_id;
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
      ruby2_world_default_item_for_character(world->chat_character),
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
      ruby2_world_default_item_for_character(world->chat_character),
      RUBY2_DISCIPLINE_SYNC,
      RUBY2_VIRTUE_HEART,
      world->chat_options[1] ? world->chat_options[1] : ruby2_world_action_label(RUBY2_ACTION_CHAT_OPTION_B)
    );
    ruby2_world_finalize_actions(world, out, room_id);
    return;
  }

  if (world->homeroom_resolved && !world->lunch_started) {
    ruby2_world_add_action(out, RUBY2_ACTION_WAIT_BELL, RUBY2_WORLD_ACTION_WAIT, room_id, RUBY2_CHARACTER_NONE, RUBY2_WORLD_ITEM_NOTEBOOK, RUBY2_DISCIPLINE_SYNC, RUBY2_VIRTUE_HUSTLE, ruby2_world_action_label(RUBY2_ACTION_WAIT_BELL));
    if (ruby2_world_notebook_owned(world)) {
      ruby2_world_add_action(out, RUBY2_ACTION_CHECK_NOTEBOOK, RUBY2_WORLD_ACTION_CHECK_NOTES, room_id, RUBY2_CHARACTER_NONE, RUBY2_WORLD_ITEM_NOTEBOOK, RUBY2_DISCIPLINE_SENSE, RUBY2_VIRTUE_HEAD, ruby2_world_action_label(RUBY2_ACTION_CHECK_NOTEBOOK));
    }
    ruby2_world_finalize_actions(world, out, room_id);
    return;
  }

  const Ruby2WorldRoom* room = ruby2_world_room(room_id);
  if (room && !ruby2_world_player_movement_locked(world)) {
    for (uint8_t i = 0; i < room->exit_count; ++i) {
      Ruby2RoomId target = room->exits[i];
      if (!world->game.room_unlocked[target]) continue;
      if (!ruby2_world_schedule_allows_room(world, target)) continue;
      Ruby2WorldActionId action_id = ruby2_world_go_action_for_room(target);
      if (action_id == RUBY2_ACTION_NONE) continue;
      ruby2_world_add_action(
        out,
        action_id,
        RUBY2_WORLD_ACTION_GO,
        target,
        RUBY2_CHARACTER_NONE,
        RUBY2_WORLD_ITEM_NOTEBOOK,
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
      RUBY2_WORLD_ITEM_ANSWER_CARD,
      RUBY2_DISCIPLINE_SENSE,
      RUBY2_VIRTUE_HEAD,
      ruby2_world_action_label(RUBY2_ACTION_ATTEND_HOMEROOM)
    );
  }

  if (room_id == RUBY2_ROOM_HOMEROOM && world->homeroom_started && !world->homeroom_resolved) {
    ruby2_world_add_teacher_question_actions(
      out,
      room_id,
      ruby2_world_select_teacher_question(world, room_id)
    );
    ruby2_world_finalize_actions(world, out, room_id);
    return;
  }

  if (ruby2_world_room_quiz_available(world, room_id)) {
    ruby2_world_add_teacher_question_actions(
      out,
      room_id,
      ruby2_world_select_teacher_question(world, room_id)
    );
    ruby2_world_finalize_actions(world, out, room_id);
    return;
  }

  if (room_id == RUBY2_ROOM_CAFETERIA &&
      ruby2_world_item_owned(world, RUBY2_ITEM_LUNCH_TRAY) &&
      !world->lunch_tray_used) {
    ruby2_world_add_action(out, RUBY2_ACTION_USE_LUNCH_TRAY, RUBY2_WORLD_ACTION_USE_ITEM, room_id, RUBY2_CHARACTER_NOOR, RUBY2_WORLD_ITEM_LUNCH_TRAY, RUBY2_DISCIPLINE_SYNC, RUBY2_VIRTUE_HEART, ruby2_world_action_label(RUBY2_ACTION_USE_LUNCH_TRAY));
  }

  for (uint8_t i = 0; i < RUBY2_WORLD_ITEM_COUNT; ++i) {
    Ruby2ItemId item_id;
    Ruby2WorldActionId action_id;
    if (!ruby2_world_inventory_item_for_world_item((Ruby2WorldItemId)i, &item_id)) continue;
    if (!ruby2_world_collect_action_for_item((Ruby2WorldItemId)i, &action_id)) continue;
    if (ruby2_world_item_present(world, (Ruby2WorldItemId)i, room_id) &&
        !ruby2_world_item_owned(world, item_id)) {
      ruby2_world_add_action(
        out,
        action_id,
        RUBY2_WORLD_ACTION_COLLECT,
        room_id,
        RUBY2_CHARACTER_NONE,
        (Ruby2WorldItemId)i,
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
      ruby2_world_default_item_for_character(room_speaker),
      RUBY2_DISCIPLINE_SYNC,
      RUBY2_VIRTUE_HEART,
      ruby2_world_action_label(RUBY2_ACTION_CHAT_ROOM)
    );
  }

  if (ruby2_world_notebook_owned(world)) {
    ruby2_world_add_action(out, RUBY2_ACTION_CHECK_NOTEBOOK, RUBY2_WORLD_ACTION_CHECK_NOTES, room_id, RUBY2_CHARACTER_NONE, RUBY2_WORLD_ITEM_NOTEBOOK, RUBY2_DISCIPLINE_SENSE, RUBY2_VIRTUE_HEAD, ruby2_world_action_label(RUBY2_ACTION_CHECK_NOTEBOOK));
  }
  ruby2_world_add_action(out, RUBY2_ACTION_WAIT_BELL, RUBY2_WORLD_ACTION_WAIT, room_id, RUBY2_CHARACTER_NONE, RUBY2_WORLD_ITEM_NOTEBOOK, RUBY2_DISCIPLINE_SYNC, RUBY2_VIRTUE_HUSTLE, ruby2_world_action_label(RUBY2_ACTION_WAIT_BELL));

  ruby2_world_finalize_actions(world, out, room_id);
}

bool ruby2_world_command_from_action(Ruby2WorldActionId action_id, Ruby2WorldCommand* out) {
  if (!out || action_id >= RUBY2_ACTION_COUNT || action_id == RUBY2_ACTION_NONE) return false;
  memset(out, 0, sizeof(*out));
  out->action_id = action_id;
  out->target_room = RUBY2_ROOM_COUNT;
  out->target_character = RUBY2_CHARACTER_NONE;
  out->target_item = RUBY2_WORLD_ITEM_NOTEBOOK;
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
      out->target_item = RUBY2_WORLD_ITEM_NOTEBOOK;
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
      out->target_item = RUBY2_WORLD_ITEM_LAB_FLASK;
      out->discipline = RUBY2_DISCIPLINE_SOURCE;
      out->virtue = RUBY2_VIRTUE_HEART;
      return true;
    case RUBY2_ACTION_TALK_RAVI:
      out->kind = RUBY2_WORLD_ACTION_TALK;
      out->target_character = RUBY2_CHARACTER_RAVI;
      out->target_item = RUBY2_WORLD_ITEM_WORK_ORDER;
      out->discipline = RUBY2_DISCIPLINE_SOURCE;
      return true;
    case RUBY2_ACTION_TALK_INDRA:
      out->kind = RUBY2_WORLD_ACTION_TALK;
      out->target_character = RUBY2_CHARACTER_INDRA;
      out->target_item = RUBY2_WORLD_ITEM_LIBRARY_CARD;
      out->discipline = RUBY2_DISCIPLINE_SENSE;
      out->virtue = RUBY2_VIRTUE_HONOR;
      return true;
    case RUBY2_ACTION_TALK_NOOR:
      out->kind = RUBY2_WORLD_ACTION_TALK;
      out->target_character = RUBY2_CHARACTER_NOOR;
      out->target_item = RUBY2_WORLD_ITEM_LUNCH_TRAY;
      out->discipline = RUBY2_DISCIPLINE_SIGNAL;
      out->virtue = RUBY2_VIRTUE_HEAD;
      return true;
    case RUBY2_ACTION_TALK_SAMI:
      out->kind = RUBY2_WORLD_ACTION_TALK;
      out->target_character = RUBY2_CHARACTER_SAMI;
      out->target_item = RUBY2_WORLD_ITEM_LUNCH_TRAY;
      out->discipline = RUBY2_DISCIPLINE_SYNC;
      out->virtue = RUBY2_VIRTUE_HEART;
      return true;
    case RUBY2_ACTION_ATTEND_HOMEROOM:
      out->kind = RUBY2_WORLD_ACTION_ATTEND;
      out->target_room = RUBY2_ROOM_HOMEROOM;
      out->target_character = RUBY2_CHARACTER_RUBY;
      out->target_item = RUBY2_WORLD_ITEM_ANSWER_CARD;
      out->discipline = RUBY2_DISCIPLINE_SENSE;
      out->virtue = RUBY2_VIRTUE_HEAD;
      return true;
    case RUBY2_ACTION_APPROACH_SOURCE:
      out->kind = RUBY2_WORLD_ACTION_APPROACH;
      out->target_room = RUBY2_ROOM_HOMEROOM;
      out->target_character = RUBY2_CHARACTER_RUBY;
      out->target_item = RUBY2_WORLD_ITEM_WORK_ORDER;
      out->discipline = RUBY2_DISCIPLINE_SOURCE;
      out->virtue = RUBY2_VIRTUE_HONOR;
      return true;
    case RUBY2_ACTION_APPROACH_SENSE:
      out->kind = RUBY2_WORLD_ACTION_APPROACH;
      out->target_room = RUBY2_ROOM_HOMEROOM;
      out->target_character = RUBY2_CHARACTER_RUBY;
      out->target_item = RUBY2_WORLD_ITEM_ANSWER_CARD;
      out->discipline = RUBY2_DISCIPLINE_SENSE;
      out->virtue = RUBY2_VIRTUE_HEAD;
      return true;
    case RUBY2_ACTION_APPROACH_SYNC:
      out->kind = RUBY2_WORLD_ACTION_APPROACH;
      out->target_room = RUBY2_ROOM_HOMEROOM;
      out->target_character = RUBY2_CHARACTER_LYRA;
      out->target_item = RUBY2_WORLD_ITEM_WORK_ORDER;
      out->discipline = RUBY2_DISCIPLINE_SYNC;
      out->virtue = RUBY2_VIRTUE_HEART;
      return true;
    case RUBY2_ACTION_APPROACH_SIGNAL:
      out->kind = RUBY2_WORLD_ACTION_APPROACH;
      out->target_room = RUBY2_ROOM_HOMEROOM;
      out->target_character = RUBY2_CHARACTER_NOOR;
      out->target_item = RUBY2_WORLD_ITEM_ANSWER_CARD;
      out->discipline = RUBY2_DISCIPLINE_SIGNAL;
      out->virtue = RUBY2_VIRTUE_HONOR;
      return true;
    case RUBY2_ACTION_USE_LUNCH_TRAY:
      out->kind = RUBY2_WORLD_ACTION_USE_ITEM;
      out->target_room = RUBY2_ROOM_CAFETERIA;
      out->target_character = RUBY2_CHARACTER_NOOR;
      out->target_item = RUBY2_WORLD_ITEM_LUNCH_TRAY;
      out->discipline = RUBY2_DISCIPLINE_SIGNAL;
      out->virtue = RUBY2_VIRTUE_HEAD;
      return true;
    case RUBY2_ACTION_COLLECT_NOTEBOOK:
    case RUBY2_ACTION_COLLECT_FLASHCARDS:
    case RUBY2_ACTION_COLLECT_LUNCH_TRAY:
    case RUBY2_ACTION_COLLECT_OFFICE_PASS:
    case RUBY2_ACTION_COLLECT_LIBRARY_CARD:
    case RUBY2_ACTION_COLLECT_LAB_FLASK: {
      Ruby2WorldItemId world_item_id;
      if (!ruby2_world_action_collect_item(action_id, &world_item_id)) return false;
      out->kind = RUBY2_WORLD_ACTION_COLLECT;
      out->target_item = world_item_id;
      out->target_room = RUBY2_ROOM_COUNT;
      out->discipline = RUBY2_DISCIPLINE_SOURCE;
      out->virtue = RUBY2_VIRTUE_HUSTLE;
      return true;
    }
    case RUBY2_ACTION_CHAT_OPTION_A:
      out->kind = RUBY2_WORLD_ACTION_CHAT_CHOICE;
      out->target_item = RUBY2_WORLD_ITEM_NOTEBOOK;
      out->discipline = RUBY2_DISCIPLINE_SOURCE;
      out->virtue = RUBY2_VIRTUE_HEAD;
      return true;
    case RUBY2_ACTION_CHAT_OPTION_B:
      out->kind = RUBY2_WORLD_ACTION_CHAT_CHOICE;
      out->target_item = RUBY2_WORLD_ITEM_NOTEBOOK;
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
        RUBY2_WORLD_ITEM_NOTEBOOK,
        command->action_id,
        ruby2_world_profile_selected_packet(avatar_id)
      );
      applied = true;
      break;
    }

    case RUBY2_WORLD_ACTION_GO:
      if (command->target_room >= RUBY2_ROOM_COUNT ||
          !world->game.room_unlocked[command->target_room] ||
          !ruby2_room_has_exit(world->game.current_room_id, command->target_room) ||
          ruby2_world_player_movement_locked(world) ||
          !ruby2_world_schedule_allows_room(world, command->target_room)) {
        return false;
      }
      if (command->target_room != world->game.current_room_id) {
        ruby2_world_clear_recent_actions(world);
      }
      world->tick++;
      ruby2_world_clear_chat(world);
      world->game.current_room_id = command->target_room;
      if (ruby2_world_notebook_owned(world)) {
        world->world_items[RUBY2_WORLD_ITEM_NOTEBOOK].room = command->target_room;
      }
      ruby2_world_push_event(world, RUBY2_EVENT_ROOM_ENTERED, command->target_room, RUBY2_CHARACTER_NONE, RUBY2_WORLD_ITEM_NOTEBOOK, command->action_id, ruby2_world_room_entered_packet(command->target_room));
      ruby2_world_run_director(world);
      applied = true;
      break;

    case RUBY2_WORLD_ACTION_ATTEND:
      if (world->game.current_room_id != RUBY2_ROOM_HOMEROOM || world->homeroom_started) return false;
      world->tick++;
      world->homeroom_started = true;
      world->game.current_time_block = RUBY2_TIME_PERIOD_1;
      ruby2_world_push_event(
        world,
        RUBY2_EVENT_CLASS_STARTED,
        RUBY2_ROOM_HOMEROOM,
        RUBY2_CHARACTER_RUBY,
        RUBY2_WORLD_ITEM_ANSWER_CARD,
        command->action_id,
        "event=class_started; room=Homeroom; teacher=Ruby; goal=answer_blackboard"
      );
      ruby2_world_run_director(world);
      applied = true;
      break;

    case RUBY2_WORLD_ACTION_APPROACH:
      if (world->game.current_room_id == RUBY2_ROOM_HOMEROOM) {
        const Ruby2TeacherQuestion* question;
        bool correct;
        if (!world->homeroom_started || world->homeroom_resolved) return false;
        question = ruby2_world_select_teacher_question(world, RUBY2_ROOM_HOMEROOM);
        if (!question) return false;
        correct = ruby2_world_teacher_question_answer_correct(question, command->action_id);
        world->tick++;
        ruby2_world_apply_approach(world, command->action_id);
        ruby2_world_push_event(
          world,
          RUBY2_EVENT_APPROACH_RESOLVED,
          RUBY2_ROOM_HOMEROOM,
          question->teacher,
          question->item,
          command->action_id,
          correct ? question->correct_packet : question->incorrect_packet
        );
        ruby2_world_push_event(
          world,
          RUBY2_EVENT_NOTEBOOK_UPDATED,
          RUBY2_ROOM_HOMEROOM,
          RUBY2_CHARACTER_NONE,
          RUBY2_WORLD_ITEM_NOTEBOOK,
          command->action_id,
          question->notebook_packet
        );
        ruby2_world_run_director(world);
        applied = true;
        break;
      }
      if (!ruby2_world_apply_room_quiz_approach(world, command->action_id)) return false;
      applied = true;
      break;

    case RUBY2_WORLD_ACTION_USE_ITEM: {
      if (command->target_item != RUBY2_WORLD_ITEM_LUNCH_TRAY ||
          world->game.current_room_id != RUBY2_ROOM_CAFETERIA ||
          !world->game.items[RUBY2_ITEM_LUNCH_TRAY].owned ||
          world->lunch_tray_used) {
        return false;
      }
      if (ruby2_use_item(&world->game, RUBY2_ITEM_LUNCH_TRAY) != RUBY2_ITEM_USE_ACCEPTED) return false;
      world->tick++;
      Ruby2EffectPayload payload;
      ruby2_effect_payload_init(&payload);
      payload.discipline_deltas[RUBY2_DISCIPLINE_SYNC] = 1;
      payload.virtue_deltas[RUBY2_VIRTUE_HEART] = 1;
      payload.affinity_deltas[RUBY2_CHARACTER_NOOR] = 1;
      payload.create_yearbook_candidate = true;
      payload.milestone_kind = RUBY2_MILESTONE_SOCIAL_CLIMAX;
      payload.candidate_id = 7001;
      payload.candidate_score = 10;
      payload.reputation_tag = RUBY2_ARCHETYPE_CONNECTOR;
      ruby2_apply_effect_payload(&world->game, &payload);
      world->lunch_tray_used = true;
      ruby2_world_push_event(world, RUBY2_EVENT_ITEM_USED, RUBY2_ROOM_CAFETERIA, RUBY2_CHARACTER_NOOR, RUBY2_WORLD_ITEM_LUNCH_TRAY, command->action_id, "event=item_used; item=lunch_tray; result=lunch_table_joined");
      ruby2_world_push_event(world, RUBY2_EVENT_NOTEBOOK_UPDATED, RUBY2_ROOM_CAFETERIA, RUBY2_CHARACTER_NONE, RUBY2_WORLD_ITEM_NOTEBOOK, command->action_id, "notebook=lunch_table_joined; item=lunch_tray; avatar=Noor");
      ruby2_world_open_chat(world, RUBY2_CHARACTER_NOOR);
      ruby2_world_run_director(world);
      applied = true;
      break;
    }

    case RUBY2_WORLD_ACTION_COLLECT: {
      Ruby2ItemId item_id;
      if (command->target_item >= RUBY2_WORLD_ITEM_COUNT ||
          !ruby2_world_inventory_item_for_world_item(command->target_item, &item_id) ||
          !ruby2_world_item_present(world, command->target_item, world->game.current_room_id) ||
          world->game.items[item_id].owned) {
        return false;
      }
      world->tick++;
      world->game.items[item_id].owned = true;
      world->game.items[item_id].carried = true;
      world->game.items[item_id].charges = ruby2_world_item_starting_charges(item_id);
      world->world_items[command->target_item].present = false;
      ruby2_sync_state_variables(&world->game);
      ruby2_world_push_event(
        world,
        RUBY2_EVENT_ITEM_COLLECTED,
        world->game.current_room_id,
        RUBY2_CHARACTER_NONE,
        command->target_item,
        command->action_id,
        ruby2_world_collect_line(command->target_item)
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
        ruby2_world_push_event(world, RUBY2_EVENT_SOCIAL_TRIGGERED, world->game.current_room_id, speaker, ruby2_world_default_item_for_character(speaker), command->action_id, "event=room_conversation_opened; scope=room; player_intent=invite_group_response");
      } else {
        ruby2_world_open_chat(world, speaker);
        ruby2_world_push_event(world, RUBY2_EVENT_SOCIAL_TRIGGERED, world->game.current_room_id, speaker, command->target_item, command->action_id, "event=character_conversation_opened; scope=one_character; player_intent=request_response_options");
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
        ruby2_world_default_item_for_character(character),
        command->action_id,
        ruby2_world_chat_choice_packet(world->chat_room_mode, option_index)
      );
      world->chat_resolved_rooms[world->game.current_room_id] = true;
      ruby2_world_clear_chat(world);
      applied = true;
      break;
    }

    case RUBY2_WORLD_ACTION_CHECK_NOTES:
      if (ruby2_use_item(&world->game, RUBY2_ITEM_NOTEBOOK) != RUBY2_ITEM_USE_ACCEPTED) return false;
      world->tick++;
      ruby2_world_push_event(world, RUBY2_EVENT_NOTEBOOK_UPDATED, world->game.current_room_id, RUBY2_CHARACTER_NONE, RUBY2_WORLD_ITEM_NOTEBOOK, command->action_id, "notebook=current_room_state; fields=room,avatars,items,schedule_pressure");
      ruby2_world_run_director(world);
      applied = true;
      break;

    case RUBY2_WORLD_ACTION_WAIT:
      world->tick++;
      ruby2_world_push_event(world, RUBY2_EVENT_IDLE, world->game.current_room_id, RUBY2_CHARACTER_NONE, RUBY2_WORLD_ITEM_NOTEBOOK, command->action_id, "event=wait; reason=player_requested_bell_or_idle");
      ruby2_world_advance_bell(world);
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
      if (!world->bell_step_pending) {
        return ruby2_world_reject_agent_intent(world, intent, RUBY2_AGENT_INTENT_REJECTED_NOT_BELL);
      }
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
        RUBY2_WORLD_ITEM_NOTEBOOK,
        RUBY2_ACTION_NONE,
        intent->text && intent->text[0] != '\0' ? intent->text : "event=npc_moved; source=agent_intent"
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
        intent->target_item < RUBY2_WORLD_ITEM_COUNT ? intent->target_item : RUBY2_WORLD_ITEM_NOTEBOOK,
        RUBY2_ACTION_NONE,
        intent->text
      );
      return RUBY2_AGENT_INTENT_ACCEPTED;

    case RUBY2_AGENT_USE_ITEM:
      if (intent->target_item >= RUBY2_WORLD_ITEM_COUNT) {
        return ruby2_world_reject_agent_intent(world, intent, RUBY2_AGENT_INTENT_REJECTED_INVALID_TARGET);
      }
      if (!ruby2_world_item_present(world, intent->target_item, actor_room)) {
        return ruby2_world_reject_agent_intent(world, intent, RUBY2_AGENT_INTENT_REJECTED_ITEM_ABSENT);
      }
      ruby2_world_push_event(
        world,
        RUBY2_EVENT_ITEM_USED,
        actor_room,
        intent->character,
        intent->target_item,
        RUBY2_ACTION_NONE,
        intent->text && intent->text[0] != '\0' ? intent->text : "event=item_used; source=agent_intent"
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
        RUBY2_WORLD_ITEM_NOTEBOOK,
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
  out->lunch_social_triggered = world->lunch_social_triggered;
  out->lunch_tray_used = world->lunch_tray_used;

  for (uint8_t i = 0; i < RUBY2_CLOCK_COUNT; ++i) {
    out->clocks[i] = world->game.clocks[i].value;
  }
  for (uint8_t i = 0; i < RUBY2_CHARACTER_COUNT; ++i) {
    if (i != character_id && world->npc_rooms[i] == out->actor_room && out->visible_avatar_count < RUBY2_CHARACTER_COUNT) {
      out->visible_avatars[out->visible_avatar_count++] = (Ruby2CharacterId)i;
    }
  }
  for (uint8_t i = 0; i < RUBY2_WORLD_ITEM_COUNT; ++i) {
    if (world->world_items[i].present && world->world_items[i].room == out->actor_room &&
        out->visible_item_count < RUBY2_WORLD_ITEM_COUNT) {
      out->visible_items[out->visible_item_count++] = (Ruby2WorldItemId)i;
    }
  }
  out->has_last_visible_event = ruby2_world_recent_visible_event_for_room(world, out->actor_room, &out->last_visible_event);
  return true;
}

static bool ruby2_perception_has_item(
  const Ruby2AgentPerception* perception,
  Ruby2WorldItemId world_item_id
) {
  if (!perception || world_item_id >= RUBY2_WORLD_ITEM_COUNT) return false;
  for (uint8_t i = 0; i < perception->visible_item_count; ++i) {
    if (perception->visible_items[i] == world_item_id) return true;
  }
  return false;
}

static bool ruby2_world_add_agent_candidate(
  Ruby2AgentCandidateList* list,
  Ruby2AgentAgendaId agenda_id,
  Ruby2AgentIntentKind kind,
  Ruby2CharacterId character,
  Ruby2RoomId target_room,
  Ruby2WorldItemId target_item,
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
  candidate->intent.target_item = target_item;
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
      RUBY2_WORLD_ITEM_NOTEBOOK,
      RUBY2_DISCIPLINE_SYNC,
      RUBY2_VIRTUE_HUSTLE,
      0.95f,
      "event=npc_moved; character=Ruby; from=Homeroom; to=Hallway; reason=bell_pressure",
      "agent_reason=schedule_guidance; avoids_forbidding_exploration"
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
      RUBY2_WORLD_ITEM_NOTEBOOK,
      RUBY2_DISCIPLINE_SYNC,
      RUBY2_VIRTUE_HEART,
      0.90f,
      "agent_line_request; speaker=Ruby; beat=late_arrival_prompt; goal=guide_player_to_homeroom; constraint=no_new_items",
      "agent_reason=schedule_pressure_prompt"
    );
  }
}

static void ruby2_world_query_ravi_intents(
  const Ruby2World* world,
  const Ruby2AgentPerception* perception,
  Ruby2AgentCandidateList* out
) {
  if (!world || !perception || !out || perception->character != RUBY2_CHARACTER_RAVI) return;

  if (!world->agent_agenda_done[RUBY2_AGENT_AGENDA_RAVI_HALLWAY_ITEM] &&
      perception->lunch_started &&
      perception->homeroom_resolved &&
      perception->actor_room == RUBY2_ROOM_HALLWAY &&
      perception->co_present_with_player) {
    (void)ruby2_world_add_agent_candidate(
      out,
      RUBY2_AGENT_AGENDA_RAVI_HALLWAY_ITEM,
      RUBY2_AGENT_REQUEST_SPEAK,
      RUBY2_CHARACTER_RAVI,
      RUBY2_ROOM_HALLWAY,
      RUBY2_WORLD_ITEM_WORK_ORDER,
      RUBY2_DISCIPLINE_SOURCE,
      RUBY2_VIRTUE_HUSTLE,
      0.70f,
      "agent_line_request; speaker=Ravi; beat=hallway_item_callback; item=wet_work_order; goal=point_to_item; constraint=no_new_items",
      "agent_reason=class_item_callback"
    );
  }
}

static void ruby2_world_query_lyra_intents(
  const Ruby2World* world,
  const Ruby2AgentPerception* perception,
  Ruby2AgentCandidateList* out
) {
  if (!world || !perception || !out || perception->character != RUBY2_CHARACTER_LYRA) return;

  if (!world->agent_agenda_done[RUBY2_AGENT_AGENDA_LYRA_LUNCH_TRAY_CHECK] &&
      perception->lunch_started &&
      perception->actor_room == RUBY2_ROOM_CAFETERIA &&
      perception->co_present_with_player &&
      !perception->lunch_tray_used &&
      ruby2_perception_has_item(perception, RUBY2_WORLD_ITEM_LUNCH_TRAY)) {
    (void)ruby2_world_add_agent_candidate(
      out,
      RUBY2_AGENT_AGENDA_LYRA_LUNCH_TRAY_CHECK,
      RUBY2_AGENT_REQUEST_SPEAK,
      RUBY2_CHARACTER_LYRA,
      RUBY2_ROOM_CAFETERIA,
      RUBY2_WORLD_ITEM_LUNCH_TRAY,
      RUBY2_DISCIPLINE_SENSE,
      RUBY2_VIRTUE_HEAD,
      0.55f,
      "agent_line_request; speaker=Lyra; beat=lunch_tray_check; item=lunch_tray; goal=use_local_item; constraint=no_money_joke",
      "agent_reason=lunch_tray_verification"
    );
  }
}

static void ruby2_world_query_noor_intents(
  const Ruby2World* world,
  const Ruby2AgentPerception* perception,
  Ruby2AgentCandidateList* out
) {
  if (!world || !perception || !out || perception->character != RUBY2_CHARACTER_NOOR) return;

  if (!world->agent_agenda_done[RUBY2_AGENT_AGENDA_NOOR_LUNCH_LINE] &&
      perception->lunch_social_triggered &&
      perception->actor_room == RUBY2_ROOM_CAFETERIA &&
      perception->co_present_with_player &&
      ruby2_perception_has_item(perception, RUBY2_WORLD_ITEM_LUNCH_TRAY)) {
    (void)ruby2_world_add_agent_candidate(
      out,
      RUBY2_AGENT_AGENDA_NOOR_LUNCH_LINE,
      RUBY2_AGENT_REQUEST_SPEAK,
      RUBY2_CHARACTER_NOOR,
      RUBY2_ROOM_CAFETERIA,
      RUBY2_WORLD_ITEM_LUNCH_TRAY,
      RUBY2_DISCIPLINE_SIGNAL,
      RUBY2_VIRTUE_HEAD,
      0.85f,
      "agent_line_request; speaker=Noor; beat=lunch_tray_social_trigger; item=lunch_tray; goal=challenge_group_assumption; constraint=no_new_items",
      "agent_reason=cafeteria_social_trigger"
    );
  }

  if (!world->agent_agenda_done[RUBY2_AGENT_AGENDA_NOOR_LUNCH_MEMORY] &&
      perception->lunch_tray_used) {
    (void)ruby2_world_add_agent_candidate(
      out,
      RUBY2_AGENT_AGENDA_NOOR_LUNCH_MEMORY,
      RUBY2_AGENT_REMEMBER_EVENT,
      RUBY2_CHARACTER_NOOR,
      perception->actor_room,
      RUBY2_WORLD_ITEM_NOTEBOOK,
      RUBY2_DISCIPLINE_SYNC,
      RUBY2_VIRTUE_HEART,
      0.80f,
      "memory; character=Noor; item=lunch_tray; state=lunch_table_joined",
      "agent_reason=durable_memory_after_item_use"
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
  if (!world->bell_step_pending) return;
  ruby2_world_query_agent_intents(world, &legal);
  if (legal.count == 0) {
    world->bell_step_pending = false;
    return;
  }

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
      world->bell_step_pending = false;
      return;
    }
  }
  world->bell_step_pending = false;
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
