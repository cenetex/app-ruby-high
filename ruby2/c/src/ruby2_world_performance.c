#include "ruby2_world_performance.h"

#include <string.h>

static const char* ruby2_world_talk_memory(Ruby2CharacterId character) {
  switch (character) {
    case RUBY2_CHARACTER_RUBY:
      return "state=player initiated a teacher check-in; purpose=schedule orientation";
    case RUBY2_CHARACTER_LYRA:
      return "state=player initiated a wording check; purpose=verify written item";
    case RUBY2_CHARACTER_RAVI:
      return "state=player initiated an item check; purpose=separate claim from proof";
    case RUBY2_CHARACTER_MIKA:
      return "state=player initiated a confidence check; purpose=turn uncertainty into action";
    case RUBY2_CHARACTER_INDRA:
      return "state=player initiated a quiet check; purpose=notice what changed";
    case RUBY2_CHARACTER_NOOR:
      return "state=player initiated a social-pattern check; purpose=read peer reaction";
    case RUBY2_CHARACTER_SAMI:
      return "state=player initiated a hallway-mood check; purpose=reduce awkwardness";
    case RUBY2_CHARACTER_SALLY_SCIENCE:
      return "state=player initiated a science teacher check-in; purpose=ground the experiment";
    case RUBY2_CHARACTER_PROFESSOR_EDWARD:
      return "state=player initiated a literature teacher check-in; purpose=ground the source";
    default:
      return "state=player initiated conversation; purpose=ground the current scene";
  }
}

static const char* ruby2_world_talk_avatar(Ruby2CharacterId character) {
  switch (character) {
    case RUBY2_CHARACTER_RUBY:
      return "speaker=Ruby; role=homeroom teacher; stance=orients player to the next legal move";
    case RUBY2_CHARACTER_LYRA:
      return "speaker=Lyra; role=classmate; stance=checks wording and written records";
    case RUBY2_CHARACTER_RAVI:
      return "speaker=Ravi; role=classmate; stance=asks for item before conclusion";
    case RUBY2_CHARACTER_MIKA:
      return "speaker=Mika; role=classmate; stance=encourages action and practice";
    case RUBY2_CHARACTER_INDRA:
      return "speaker=Indra; role=classmate; stance=notices small changes";
    case RUBY2_CHARACTER_NOOR:
      return "speaker=Noor; role=classmate; stance=challenges group assumptions";
    case RUBY2_CHARACTER_SAMI:
      return "speaker=Sami; role=classmate; stance=softens social pressure";
    case RUBY2_CHARACTER_SALLY_SCIENCE:
      return "speaker=Sally Science; role=science teacher; stance=tests variables before claims";
    case RUBY2_CHARACTER_PROFESSOR_EDWARD:
      return "speaker=Professor Edward; role=literature teacher; stance=keeps claims tied to sources";
    default:
      return "speaker=classmate; role=peer; stance=responds to current world state";
  }
}

static const char* ruby2_world_player_avatar_context(const Ruby2World* world) {
  if (!world || !world->player_profile_ready) {
    return "player_profile=unset";
  }
  switch (world->player_avatar) {
    case RUBY2_PLAYER_AVATAR_SOURCE:
      return "player_profile=Source; preference=test, cite, compare, make items prove claims";
    case RUBY2_PLAYER_AVATAR_SENSE:
      return "player_profile=Sense; preference=read wording, subtext, ambiguity, and meaning";
    case RUBY2_PLAYER_AVATAR_SYNC:
      return "player_profile=Sync; preference=coordinate people, witnesses, and systems";
    case RUBY2_PLAYER_AVATAR_SIGNAL:
      return "player_profile=Signal; preference=notice repeated patterns and structural mismatch";
    case RUBY2_PLAYER_AVATAR_UNSET:
    default:
      return "player_profile=unset";
  }
}

static const char* ruby2_world_approach_fallback(Ruby2RoomId room, Ruby2WorldActionId action) {
  if (room == RUBY2_ROOM_SCIENCE_LAB) {
    switch (action) {
      case RUBY2_ACTION_APPROACH_SOURCE:
        return "Good. Name the variable before you trust the result.";
      case RUBY2_ACTION_APPROACH_SENSE:
        return "Careful wording counts, but the flask still has to prove it.";
      case RUBY2_ACTION_APPROACH_SYNC:
        return "Pair the notes, then make the evidence survive both of you.";
      case RUBY2_ACTION_APPROACH_SIGNAL:
        return "A pattern is useful only after the control stops arguing.";
      default:
        return "Keep the claim small enough for the bench to test.";
    }
  }

  if (room == RUBY2_ROOM_LIBRARY) {
    switch (action) {
      case RUBY2_ACTION_APPROACH_SOURCE:
        return "Start with the source. The claim can wait its turn.";
      case RUBY2_ACTION_APPROACH_SENSE:
        return "The exact sentence is doing more work than it admits.";
      case RUBY2_ACTION_APPROACH_SYNC:
        return "Compare notes, then keep only what the text can carry.";
      case RUBY2_ACTION_APPROACH_SIGNAL:
        return "If the pattern is real, the page will survive rereading.";
      default:
        return "Tie the answer to the page, not the mood.";
    }
  }

  switch (action) {
    case RUBY2_ACTION_APPROACH_SOURCE:
      return "Good. Make the board item prove it before the room repeats it.";
    case RUBY2_ACTION_APPROACH_SENSE:
      return "Good. The word on the board is where the answer starts.";
    case RUBY2_ACTION_APPROACH_SYNC:
      return "Good. Let the room agree on the same item first.";
    case RUBY2_ACTION_APPROACH_SIGNAL:
      return "Good. Circle the mismatch before it becomes a rumor.";
    default:
      return "Good. Keep the answer tied to what is actually here.";
  }
}

static const char* ruby2_world_chat_open_fallback(Ruby2CharacterId character, bool room_mode) {
  if (room_mode) {
    return "Say what you noticed, then point to the item everyone can check.";
  }

  switch (character) {
    case RUBY2_CHARACTER_RUBY:
      return "Ask the next school question, not the biggest one.";
    case RUBY2_CHARACTER_LYRA:
      return "Show me the exact wording before we trust the feeling.";
    case RUBY2_CHARACTER_RAVI:
      return "If there is an item, I want to see it before I guess.";
    case RUBY2_CHARACTER_MIKA:
      return "Pick the move you can actually do before the bell gets loud.";
    case RUBY2_CHARACTER_INDRA:
      return "Say the small true thing first.";
    case RUBY2_CHARACTER_NOOR:
      return "If this gets weird, at least make it specific.";
    case RUBY2_CHARACTER_SAMI:
      return "Keep it casual, but do not make it vague.";
    case RUBY2_CHARACTER_SALLY_SCIENCE:
      return "Bring me the testable part.";
    case RUBY2_CHARACTER_PROFESSOR_EDWARD:
      return "Bring me the sentence doing the work.";
    default:
      return "Ask from the room, not from nowhere.";
  }
}

static const char* ruby2_world_chat_choice_fallback(Ruby2CharacterId character, Ruby2WorldActionId action) {
  bool first_option = action == RUBY2_ACTION_CHAT_OPTION_A;
  switch (character) {
    case RUBY2_CHARACTER_RUBY:
      return first_option ? "Good. That keeps the school rule visible." : "Good. That keeps the room with you.";
    case RUBY2_CHARACTER_LYRA:
      return first_option ? "Yes. Check the wording before it checks us." : "Yes. Ask together before panic edits it.";
    case RUBY2_CHARACTER_RAVI:
      return first_option ? "Thank you. Evidence first, volume second." : "Okay, group check. I can do group check.";
    case RUBY2_CHARACTER_MIKA:
      return first_option ? "That is a clean first move." : "That keeps everybody moving.";
    case RUBY2_CHARACTER_INDRA:
      return first_option ? "That is the useful edge." : "That leaves room for people.";
    case RUBY2_CHARACTER_NOOR:
      return first_option ? "Fine. Specific is less annoying." : "Fine. Socially survivable and not fake.";
    case RUBY2_CHARACTER_SAMI:
      return first_option ? "That keeps the actual item in view." : "That keeps the table from getting weird.";
    case RUBY2_CHARACTER_SALLY_SCIENCE:
      return first_option ? "Good. Measure before you decorate." : "Good. Share the method before the result.";
    case RUBY2_CHARACTER_PROFESSOR_EDWARD:
      return first_option ? "Good. Cite before you claim." : "Good. Let the room test the reading.";
    default:
      return first_option ? "That keeps it concrete." : "That keeps the room steady.";
  }
}

static const char* ruby2_world_agent_spoke_fallback(Ruby2CharacterId character, Ruby2WorldItemId item) {
  if (item == RUBY2_WORLD_ITEM_LUNCH_TRAY) {
    switch (character) {
      case RUBY2_CHARACTER_NOOR:
        return "The Lunch Tray is evidence now. Somehow lunch made itself worse.";
      case RUBY2_CHARACTER_LYRA:
        return "I can compare trays, but I am not emotionally ready for matching trays.";
      case RUBY2_CHARACTER_RAVI:
        return "Wait, if the trays match, that is actually useful.";
      case RUBY2_CHARACTER_MIKA:
        return "Tray first, theory second. We can handle that.";
      default:
        return "The Lunch Tray is the item everyone can check.";
    }
  }
  return ruby2_world_chat_open_fallback(character, false);
}

static bool ruby2_world_event_is_talk_action(Ruby2WorldActionId action) {
  return action == RUBY2_ACTION_CHAT_ROOM ||
         action == RUBY2_ACTION_TALK_RUBY ||
         action == RUBY2_ACTION_TALK_LYRA ||
         action == RUBY2_ACTION_TALK_MIKA ||
         action == RUBY2_ACTION_TALK_RAVI ||
         action == RUBY2_ACTION_TALK_INDRA ||
         action == RUBY2_ACTION_TALK_NOOR ||
         action == RUBY2_ACTION_TALK_SAMI;
}

static void ruby2_world_request_defaults(
  const Ruby2World* world,
  const Ruby2WorldEvent* event,
  Ruby2PerformanceRequest* out
) {
  memset(out, 0, sizeof(*out));
  out->speaker = event->character < RUBY2_CHARACTER_COUNT ? event->character : RUBY2_CHARACTER_RUBY;
  out->room = event->room < RUBY2_ROOM_COUNT ? event->room : world->game.current_room_id;
  out->discipline = RUBY2_DISCIPLINE_SYNC;
  out->virtue = RUBY2_VIRTUE_HEART;
  out->archetype = world->game.secondary_archetype;
  out->beat_id = ruby2_world_event_name(event->kind);
  out->location_context = ruby2_room_name(out->room);
  out->items_context = ruby2_world_item_name(event->item);
  out->avatar_context = ruby2_world_character_name(out->speaker);
  out->situation = event->text;
  out->outcome = event->text;
  out->fallback = NULL;
  out->smooth_wake = false;
}

static bool ruby2_world_action_discipline(
  Ruby2WorldActionId action_id,
  Ruby2Discipline* discipline,
  Ruby2Virtue* virtue
) {
  Ruby2WorldCommand command;
  if (!ruby2_world_command_from_action(action_id, &command)) return false;
  *discipline = command.discipline;
  *virtue = command.virtue;
  return true;
}

bool ruby2_world_event_to_performance_request(
  const Ruby2World* world,
  const Ruby2WorldEvent* event,
  Ruby2PerformanceRequest* out
) {
  if (!world || !event || !out || !ruby2_world_event_visible_to_player(event)) return false;

  switch (event->kind) {
    case RUBY2_EVENT_APPROACH_RESOLVED:
      ruby2_world_request_defaults(world, event, out);
      out->room = event->room < RUBY2_ROOM_COUNT ? event->room : world->game.current_room_id;
      out->speaker = event->character < RUBY2_CHARACTER_COUNT
        ? event->character
        : (out->room == RUBY2_ROOM_LIBRARY ? RUBY2_CHARACTER_PROFESSOR_EDWARD
          : out->room == RUBY2_ROOM_SCIENCE_LAB ? RUBY2_CHARACTER_SALLY_SCIENCE
          : RUBY2_CHARACTER_RUBY);
      (void)ruby2_world_action_discipline(event->action, &out->discipline, &out->virtue);
      out->items_context = ruby2_world_action_label(event->action);
      if (out->room == RUBY2_ROOM_HOMEROOM) {
        out->memory_context = "state=player chose an approach before choosing an answer";
        out->location_context = "scene=Homeroom; items=answer card, wet work order, blackboard";
        out->avatar_context = "cast=Ruby,Ravi,Lyra; Ruby role=teacher; classmates share item";
        out->situation = "beat=class_approach_resolved; purpose=teacher reacts to validated player method";
      } else if (out->room == RUBY2_ROOM_SCIENCE_LAB) {
        out->memory_context = "state=player chose a lab method before claiming a result";
        out->location_context = "scene=Science Lab; items=bench, flask, logbook, blackboard";
        out->avatar_context = "cast=Sally Science,Mika; Sally role=teacher; Mika role=classmate";
        out->situation = "beat=lab_quiz_resolved; purpose=teacher reacts to validated lab answer";
      } else if (out->room == RUBY2_ROOM_LIBRARY) {
        out->memory_context = "state=player chose a citation-check method before trusting the claim";
        out->location_context = "scene=Library; items=table, catalog card, notebook margin, blackboard";
        out->avatar_context = "cast=Professor Edward,Indra; Edward role=teacher; Indra role=classmate";
        out->situation = "beat=library_quiz_resolved; purpose=teacher reacts to validated source answer";
      } else {
        out->memory_context = "state=player chose an approach before committing the next move";
        out->location_context = ruby2_room_name(out->room);
        out->avatar_context = ruby2_world_character_name(out->speaker);
        out->situation = "beat=approach_resolved; purpose=respond to validated method";
      }
      out->outcome = event->text;
      out->fallback = ruby2_world_approach_fallback(out->room, event->action);
      return true;

    case RUBY2_EVENT_SOCIAL_TRIGGERED:
      ruby2_world_request_defaults(world, event, out);
      if (event->action == RUBY2_ACTION_CHAT_OPTION_A || event->action == RUBY2_ACTION_CHAT_OPTION_B) {
        out->speaker = event->character < RUBY2_CHARACTER_COUNT ? event->character : RUBY2_CHARACTER_RUBY;
        out->room = event->room < RUBY2_ROOM_COUNT ? event->room : world->game.current_room_id;
        (void)ruby2_world_action_discipline(event->action, &out->discipline, &out->virtue);
        out->memory_context = "state=player selected one of two conversation intents";
        out->location_context = ruby2_room_name(out->room);
        out->items_context = ruby2_world_item_name(event->item);
        out->avatar_context = ruby2_world_player_avatar_context(world);
        out->situation = "beat=conversation_choice_resolved; purpose=speaker responds to player intent; line_limit=one";
        out->outcome = event->text;
        out->fallback = ruby2_world_chat_choice_fallback(out->speaker, event->action);
        out->smooth_wake = true;
        return true;
      }
      if (ruby2_world_event_is_talk_action(event->action)) {
        out->speaker = event->character < RUBY2_CHARACTER_COUNT ? event->character : RUBY2_CHARACTER_RUBY;
        out->room = event->room < RUBY2_ROOM_COUNT ? event->room : world->game.current_room_id;
        (void)ruby2_world_action_discipline(event->action, &out->discipline, &out->virtue);
        out->memory_context = event->action == RUBY2_ACTION_CHAT_ROOM
          ? "state=player opened a room-level conversation"
          : ruby2_world_talk_memory(out->speaker);
        out->location_context = ruby2_room_name(out->room);
        out->items_context = ruby2_world_item_name(event->item);
        out->avatar_context = event->action == RUBY2_ACTION_CHAT_ROOM
          ? ruby2_world_player_avatar_context(world)
          : ruby2_world_talk_avatar(out->speaker);
        out->situation = event->action == RUBY2_ACTION_CHAT_ROOM
          ? "beat=room_conversation_opened; purpose=invite group into current world state; line_limit=one"
          : "beat=character_conversation_opened; purpose=respond to player check-in; line_limit=one";
        out->outcome = event->text;
        out->fallback = ruby2_world_chat_open_fallback(out->speaker, event->action == RUBY2_ACTION_CHAT_ROOM);
        out->smooth_wake = true;
        return true;
      }
      out->speaker = event->character < RUBY2_CHARACTER_COUNT ? event->character : RUBY2_CHARACTER_NOOR;
      out->discipline = RUBY2_DISCIPLINE_SIGNAL;
      out->virtue = RUBY2_VIRTUE_HEAD;
      out->memory_context = "state=player reached lunch after first class";
      out->location_context = "location=Cafeteria; item=Lunch Tray; rule=only mention existing items";
      out->items_context = ruby2_world_item_name(event->item);
      out->avatar_context = "cast=Noor,Lyra; Noor role=skeptic; Lyra role=verifier";
      out->situation = "beat=lunch_social_triggered; purpose=peer notices local items";
      out->outcome = event->text;
      out->fallback = "The Lunch Tray is real, local, and somehow trying to become a social problem.";
      out->smooth_wake = true;
      return true;

    case RUBY2_EVENT_AGENT_SPOKE:
      ruby2_world_request_defaults(world, event, out);
      out->speaker = event->character < RUBY2_CHARACTER_COUNT ? event->character : RUBY2_CHARACTER_NOOR;
      out->room = event->room < RUBY2_ROOM_COUNT ? event->room : world->game.current_room_id;
      out->discipline = event->item == RUBY2_WORLD_ITEM_LUNCH_TRAY ? RUBY2_DISCIPLINE_SIGNAL : RUBY2_DISCIPLINE_SYNC;
      out->virtue = RUBY2_VIRTUE_HEAD;
      out->memory_context = "state=classmate requested a line about the current item";
      out->location_context = ruby2_room_name(out->room);
      out->items_context = ruby2_world_item_name(event->item);
      out->avatar_context = ruby2_world_talk_avatar(out->speaker);
      out->situation = "beat=agent_line_requested; purpose=co-present avatar reacts to validated local state; line_limit=one";
      out->outcome = event->text;
      out->fallback = ruby2_world_agent_spoke_fallback(out->speaker, event->item);
      out->smooth_wake = true;
      return true;

    case RUBY2_EVENT_ITEM_USED:
      ruby2_world_request_defaults(world, event, out);
      out->speaker = event->character < RUBY2_CHARACTER_COUNT ? event->character : RUBY2_CHARACTER_NOOR;
      out->discipline = RUBY2_DISCIPLINE_SIGNAL;
      out->virtue = RUBY2_VIRTUE_HEAD;
      out->memory_context = "state=player used the Lunch Tray to join a lunch table";
      out->location_context = "location=Cafeteria; item=Lunch Tray; notebook=open";
      out->items_context = ruby2_world_item_name(event->item);
      out->avatar_context = "cast=Noor; Noor role=skeptic; focus=lunch seating";
      out->situation = "beat=item_used; purpose=peer reacts after player uses lunch item";
      out->outcome = event->text;
      out->fallback = "Fine. The Lunch Tray gets you a seat, not a theory.";
      return true;

    case RUBY2_EVENT_DIRECTOR_TRIGGERED:
      ruby2_world_request_defaults(world, event, out);
      out->speaker = RUBY2_CHARACTER_RUBY;
      out->discipline = RUBY2_DISCIPLINE_SYNC;
      out->virtue = RUBY2_VIRTUE_HONOR;
      out->memory_context = "state=bell pressure changed legal schedule state";
      out->location_context = ruby2_room_name(event->room);
      out->items_context = "Notebook, bell clock";
      out->avatar_context = "speaker=Ruby; role=homeroom teacher; purpose=schedule guidance";
      out->situation = "beat=schedule_redirect; purpose=explain legal movement pressure without punishment";
      out->outcome = event->text;
      out->fallback = "The bell is pressure, not punishment. Homeroom is still the next clean move.";
      return true;

    default:
      return false;
  }
}
