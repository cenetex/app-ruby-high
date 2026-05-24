#include "ruby2_world_performance.h"

#include <string.h>

static const char* ruby2_world_talk_memory(Ruby2CharacterId character) {
  switch (character) {
    case RUBY2_CHARACTER_RUBY:
      return "the student checked in instead of treating the schedule like a menu";
    case RUBY2_CHARACTER_LYRA:
      return "the student stopped near the notes before the wording could get away";
    case RUBY2_CHARACTER_RAVI:
      return "the student asked for the fact before the room got louder";
    case RUBY2_CHARACTER_MIKA:
      return "the student asked for courage before turning it into a move";
    case RUBY2_CHARACTER_INDRA:
      return "the student let the quiet have enough room to answer";
    case RUBY2_CHARACTER_NOOR:
      return "the student noticed the social part of the evidence";
    case RUBY2_CHARACTER_SAMI:
      return "the student checked the hallway's temperature before committing";
    default:
      return "the student chose to talk instead of drift through the room";
  }
}

static const char* ruby2_world_talk_avatar(Ruby2CharacterId character) {
  switch (character) {
    case RUBY2_CHARACTER_RUBY:
      return "Ruby close enough to make the next move feel possible";
    case RUBY2_CHARACTER_LYRA:
      return "Lyra with the Notebook margin open and one worry already circled";
    case RUBY2_CHARACTER_RAVI:
      return "Ravi with one fact ready and three more trying to escape";
    case RUBY2_CHARACTER_MIKA:
      return "Mika grinning like confidence is something you can hand across the room";
    case RUBY2_CHARACTER_INDRA:
      return "Indra close to the quietest object in the room";
    case RUBY2_CHARACTER_NOOR:
      return "Noor watching the object everyone else is trying to normalize";
    case RUBY2_CHARACTER_SAMI:
      return "Sami leaning on the edge of the moment like it owes him rent";
    default:
      return "a classmate in the same room with a real line to spend";
  }
}

static const char* ruby2_world_talk_fallback(Ruby2CharacterId character, Ruby2RoomId room) {
  switch (character) {
    case RUBY2_CHARACTER_RUBY:
      return room == RUBY2_ROOM_HALLWAY
        ? "The bell is not angry. It is just done waiting."
        : "The Notebook is not a gradebook. It is a trail.";
    case RUBY2_CHARACTER_LYRA:
      return "If the wording moved, I want it in ink.";
    case RUBY2_CHARACTER_MIKA:
      return "You are not lost. You are just pre-routing.";
    case RUBY2_CHARACTER_RAVI:
      return "The stamp is doing more work than the card.";
    case RUBY2_CHARACTER_INDRA:
      return "The quiet changed first.";
    case RUBY2_CHARACTER_NOOR:
      return room == RUBY2_ROOM_CAFETERIA
        ? "The receipt is trying too hard to be normal."
        : "The hallway is pretending this is normal.";
    case RUBY2_CHARACTER_SAMI:
      return "Respectfully, everyone needs to lower their shoulders.";
    default:
      return "That answer changed the room more than the score.";
  }
}

static const char* ruby2_world_player_avatar_context(const Ruby2World* world) {
  if (!world || !world->player_profile_ready) {
    return "the player has not chosen a student identity yet";
  }
  switch (world->player_avatar) {
    case RUBY2_PLAYER_AVATAR_SOURCE:
      return "the player is a Source student: they test, cite, compare, and make objects prove claims";
    case RUBY2_PLAYER_AVATAR_SENSE:
      return "the player is a Sense student: they read wording, subtext, ambiguity, and meaning";
    case RUBY2_PLAYER_AVATAR_SYNC:
      return "the player is a Sync student: they coordinate people, witnesses, and systems";
    case RUBY2_PLAYER_AVATAR_SIGNAL:
      return "the player is a Signal student: they notice repeated patterns, anomalies, and things that answer back";
    case RUBY2_PLAYER_AVATAR_UNSET:
    default:
      return "the player is still deciding what kind of student they are";
  }
}

static const char* ruby2_world_room_chat_fallback(Ruby2CharacterId speaker) {
  switch (speaker) {
    case RUBY2_CHARACTER_RUBY:
      return "Good. Make the room answer together, then let the Notebook decide what held.";
    case RUBY2_CHARACTER_LYRA:
      return "I can verify what is written down. I cannot verify my pulse, unfortunately.";
    case RUBY2_CHARACTER_MIKA:
      return "Next move is small and real. We pick one thing and make it less scary.";
    case RUBY2_CHARACTER_RAVI:
      return "OK. Everyone says what they personally checked. No vibes disguised as data.";
    case RUBY2_CHARACTER_INDRA:
      return "Start with the thing that changed.";
    case RUBY2_CHARACTER_NOOR:
      return "I vote we stop letting the weird paper set the agenda.";
    case RUBY2_CHARACTER_SAMI:
      return "Room consensus: the vibes are guilty, but we still need evidence.";
    default:
      return "The room answers because you made the question specific.";
  }
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

static const char* ruby2_world_approach_fallback(
  Ruby2WorldActionId action,
  Ruby2RoomId room
) {
  if (room == RUBY2_ROOM_SCIENCE_LAB) {
    switch (action) {
      case RUBY2_ACTION_APPROACH_SOURCE:
        return "Control first. Reaction second.";
      case RUBY2_ACTION_APPROACH_SENSE:
        return "Name the hidden variable before the flask lies for it.";
      case RUBY2_ACTION_APPROACH_SYNC:
        return "Good. Give each witness one job and keep the clock honest.";
      case RUBY2_ACTION_APPROACH_SIGNAL:
        return "That timestamp should not repeat. Keep that.";
      default:
        return "The lab only trusts what can be replayed.";
    }
  }
  if (room == RUBY2_ROOM_LIBRARY) {
    switch (action) {
      case RUBY2_ACTION_APPROACH_SOURCE:
        return "First copy beats loudest copy.";
      case RUBY2_ACTION_APPROACH_SENSE:
        return "One scope word can rewrite a room.";
      case RUBY2_ACTION_APPROACH_SYNC:
        return "Split the checks and make the margin earn consensus.";
      case RUBY2_ACTION_APPROACH_SIGNAL:
        return "Track the repeating mark before it learns a new mask.";
      default:
        return "Library truth starts where versions disagree.";
    }
  }

  switch (action) {
    case RUBY2_ACTION_APPROACH_SOURCE:
      return "Wet ink beats confident ink.";
    case RUBY2_ACTION_APPROACH_SENSE:
      return "Original is a claim, not a hall pass.";
    case RUBY2_ACTION_APPROACH_SYNC:
      return "Good. Make the witnesses carry the proof.";
    case RUBY2_ACTION_APPROACH_SIGNAL:
      return "Circle the impossible part before it learns confidence.";
    default:
      return "Good. Now the answer has to survive the room.";
  }
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
  out->items_context = ruby2_world_object_name(event->object);
  out->avatar_context = ruby2_world_character_name(out->speaker);
  out->situation = event->text;
  out->outcome = event->text;
  out->fallback = event->text;
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
        : (out->room == RUBY2_ROOM_LIBRARY ? RUBY2_CHARACTER_INDRA
          : out->room == RUBY2_ROOM_SCIENCE_LAB ? RUBY2_CHARACTER_MIKA
          : RUBY2_CHARACTER_RUBY);
      (void)ruby2_world_action_discipline(event->action, &out->discipline, &out->virtue);
      out->items_context = ruby2_world_action_label(event->action);
      if (out->room == RUBY2_ROOM_HOMEROOM) {
        out->memory_context = "the student chose an approach before choosing an answer";
        out->location_context = "Homeroom board, answer card, wet work order";
        out->avatar_context = "Ruby at the board; classmates watching the same evidence";
        out->situation = "Ruby is responding after the player's approach changes the room.";
      } else if (out->room == RUBY2_ROOM_SCIENCE_LAB) {
        out->memory_context = "the student chose a lab method before claiming a result";
        out->location_context = "Science Lab bench, flask, logbook";
        out->avatar_context = "Mika at the bench, room waiting for a replayable method";
        out->situation = "Mika is responding to the selected lab quiz approach.";
      } else if (out->room == RUBY2_ROOM_LIBRARY) {
        out->memory_context = "the student chose a citation-check method before trusting the claim";
        out->location_context = "Library table, catalog card, notebook margin";
        out->avatar_context = "Indra by the stack, room waiting for a verifiable source chain";
        out->situation = "Indra is responding to the selected library quiz approach.";
      } else {
        out->memory_context = "the student chose an approach before committing the next move";
        out->location_context = ruby2_room_name(out->room);
        out->avatar_context = ruby2_world_character_name(out->speaker);
        out->situation = "A room-specific approach beat has just resolved.";
      }
      out->outcome = event->text;
      out->fallback = ruby2_world_approach_fallback(event->action, out->room);
      return true;

    case RUBY2_EVENT_SOCIAL_TRIGGERED:
      ruby2_world_request_defaults(world, event, out);
      if (event->action == RUBY2_ACTION_CHAT_OPTION_A || event->action == RUBY2_ACTION_CHAT_OPTION_B) {
        out->speaker = event->character < RUBY2_CHARACTER_COUNT ? event->character : RUBY2_CHARACTER_RUBY;
        out->room = event->room < RUBY2_ROOM_COUNT ? event->room : world->game.current_room_id;
        (void)ruby2_world_action_discipline(event->action, &out->discipline, &out->virtue);
        out->memory_context = "the player spoke one of two selected room-chat lines";
        out->location_context = ruby2_room_name(out->room);
        out->items_context = ruby2_world_object_name(event->object);
        out->avatar_context = ruby2_world_player_avatar_context(world);
        out->situation = "The selected player line asks the room to answer naturally; the speaker only gets one line out loud.";
        out->outcome = event->text;
        out->fallback = ruby2_world_room_chat_fallback(out->speaker);
        out->smooth_wake = true;
        return true;
      }
      if (ruby2_world_event_is_talk_action(event->action)) {
        out->speaker = event->character < RUBY2_CHARACTER_COUNT ? event->character : RUBY2_CHARACTER_RUBY;
        out->room = event->room < RUBY2_ROOM_COUNT ? event->room : world->game.current_room_id;
        (void)ruby2_world_action_discipline(event->action, &out->discipline, &out->virtue);
        out->memory_context = event->action == RUBY2_ACTION_CHAT_ROOM
          ? "the player opened the room chat instead of talking to only one person"
          : ruby2_world_talk_memory(out->speaker);
        out->location_context = ruby2_room_name(out->room);
        out->items_context = ruby2_world_object_name(event->object);
        out->avatar_context = event->action == RUBY2_ACTION_CHAT_ROOM
          ? ruby2_world_player_avatar_context(world)
          : ruby2_world_talk_avatar(out->speaker);
        out->situation = event->action == RUBY2_ACTION_CHAT_ROOM
          ? "The player has just opened a room-level conversation; the speaker should invite the group into the beat."
          : "The player chose a small conversation beat instead of only chasing the next objective.";
        out->outcome = event->text;
        out->fallback = event->action == RUBY2_ACTION_CHAT_ROOM
          ? ruby2_world_room_chat_fallback(out->speaker)
          : ruby2_world_talk_fallback(out->speaker, out->room);
        out->smooth_wake = true;
        return true;
      }
      out->speaker = event->character < RUBY2_CHARACTER_COUNT ? event->character : RUBY2_CHARACTER_NOOR;
      out->discipline = RUBY2_DISCIPLINE_SIGNAL;
      out->virtue = RUBY2_VIRTUE_HEAD;
      out->memory_context = "the strange classroom footer followed the day into lunch";
      out->location_context = "Cafeteria tray rail, zero-dollar receipt, lunch noise";
      out->items_context = ruby2_world_object_name(event->object);
      out->avatar_context = "Noor near the receipt; Lyra close enough to check trays";
      out->situation = "The social beat starts because the player and the receipt are in the same room.";
      out->outcome = event->text;
      out->fallback = "The receipt is trying too hard to be normal.";
      out->smooth_wake = true;
      return true;

    case RUBY2_EVENT_AGENT_SPOKE:
      ruby2_world_request_defaults(world, event, out);
      out->speaker = event->character < RUBY2_CHARACTER_COUNT ? event->character : RUBY2_CHARACTER_NOOR;
      out->room = event->room < RUBY2_ROOM_COUNT ? event->room : world->game.current_room_id;
      out->discipline = event->object == RUBY2_WORLD_OBJECT_RECEIPT ? RUBY2_DISCIPLINE_SIGNAL : RUBY2_DISCIPLINE_SYNC;
      out->virtue = RUBY2_VIRTUE_HEAD;
      out->memory_context = "the classmate chose the object over the room noise";
      out->location_context = ruby2_room_name(out->room);
      out->items_context = ruby2_world_object_name(event->object);
      out->avatar_context = ruby2_world_talk_avatar(out->speaker);
      out->situation = "A micro-agent is allowed one grounded line because they are co-present.";
      out->outcome = event->text;
      out->fallback = event->text;
      out->smooth_wake = true;
      return true;

    case RUBY2_EVENT_OBJECT_INSPECTED:
      ruby2_world_request_defaults(world, event, out);
      out->speaker = event->character < RUBY2_CHARACTER_COUNT ? event->character : RUBY2_CHARACTER_NOOR;
      out->discipline = RUBY2_DISCIPLINE_SIGNAL;
      out->virtue = RUBY2_VIRTUE_HEAD;
      out->memory_context = "the player inspected an object that repeated Homeroom";
      out->location_context = "Cafeteria table, zero-dollar receipt, Notebook open";
      out->items_context = ruby2_world_object_name(event->object);
      out->avatar_context = "Noor watching the receipt instead of the room";
      out->situation = "The inspected object became evidence instead of ambient weirdness.";
      out->outcome = event->text;
      out->fallback = "That footer has follow-through. Horrible quality in paper.";
      return true;

    case RUBY2_EVENT_DIRECTOR_TRIGGERED:
      ruby2_world_request_defaults(world, event, out);
      out->speaker = RUBY2_CHARACTER_RUBY;
      out->discipline = RUBY2_DISCIPLINE_SYNC;
      out->virtue = RUBY2_VIRTUE_HONOR;
      out->memory_context = "the bell pulled the player back toward class";
      out->location_context = ruby2_room_name(event->room);
      out->items_context = "Notebook margin, bell clock";
      out->avatar_context = "Ruby close enough to make the schedule real";
      out->situation = "Ruby is redirecting the player without treating exploration as failure.";
      out->outcome = event->text;
      out->fallback = "The bell is not angry. It is just done waiting.";
      return true;

    default:
      return false;
  }
}
