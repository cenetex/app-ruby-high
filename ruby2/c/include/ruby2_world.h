#ifndef RUBY2_WORLD_H
#define RUBY2_WORLD_H

#include "ruby2_engine.h"

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define RUBY2_WORLD_MAX_EXITS 8
#define RUBY2_WORLD_MAX_ACTIONS 20
#define RUBY2_WORLD_MAX_EVENTS 24
#define RUBY2_WORLD_MAX_AGENT_AGENDAS 8
#define RUBY2_WORLD_MAX_AGENT_INTENTS 12
#define RUBY2_WORLD_MAX_RECENT_ACTIONS 4

typedef enum {
  RUBY2_WORLD_OBJECT_ANSWER_CARD,
  RUBY2_WORLD_OBJECT_WORK_ORDER,
  RUBY2_WORLD_OBJECT_RECEIPT,
  RUBY2_WORLD_OBJECT_NOTEBOOK,
  RUBY2_WORLD_OBJECT_FLASHCARDS,
  RUBY2_WORLD_OBJECT_LUNCH_TRAY,
  RUBY2_WORLD_OBJECT_OFFICE_PASS,
  RUBY2_WORLD_OBJECT_LIBRARY_CARD,
  RUBY2_WORLD_OBJECT_LAB_FLASK,
  RUBY2_WORLD_OBJECT_COUNT
} Ruby2WorldObjectId;

typedef enum {
  RUBY2_WORLD_ACTION_GO,
  RUBY2_WORLD_ACTION_TALK,
  RUBY2_WORLD_ACTION_ATTEND,
  RUBY2_WORLD_ACTION_APPROACH,
  RUBY2_WORLD_ACTION_INSPECT,
  RUBY2_WORLD_ACTION_COLLECT,
  RUBY2_WORLD_ACTION_PROFILE,
  RUBY2_WORLD_ACTION_CHAT_CHOICE,
  RUBY2_WORLD_ACTION_CHECK_NOTES,
  RUBY2_WORLD_ACTION_WAIT
} Ruby2WorldActionKind;

typedef enum {
  RUBY2_ACTION_GO_HALLWAY,
  RUBY2_ACTION_GO_HOMEROOM,
  RUBY2_ACTION_GO_SCIENCE_LAB,
  RUBY2_ACTION_GO_LIBRARY,
  RUBY2_ACTION_GO_CAFETERIA,
  RUBY2_ACTION_GO_GREENHOUSE,
  RUBY2_ACTION_GO_COURTYARD,
  RUBY2_ACTION_GO_TEACHER_OFFICE,
  RUBY2_ACTION_SELECT_AVATAR_SOURCE,
  RUBY2_ACTION_SELECT_AVATAR_SENSE,
  RUBY2_ACTION_SELECT_AVATAR_SYNC,
  RUBY2_ACTION_SELECT_AVATAR_SIGNAL,
  RUBY2_ACTION_CHAT_ROOM,
  RUBY2_ACTION_TALK_RUBY,
  RUBY2_ACTION_TALK_LYRA,
  RUBY2_ACTION_TALK_MIKA,
  RUBY2_ACTION_TALK_RAVI,
  RUBY2_ACTION_TALK_INDRA,
  RUBY2_ACTION_TALK_NOOR,
  RUBY2_ACTION_TALK_SAMI,
  RUBY2_ACTION_ATTEND_HOMEROOM,
  RUBY2_ACTION_APPROACH_SOURCE,
  RUBY2_ACTION_APPROACH_SENSE,
  RUBY2_ACTION_APPROACH_SYNC,
  RUBY2_ACTION_APPROACH_SIGNAL,
  RUBY2_ACTION_INSPECT_RECEIPT,
  RUBY2_ACTION_COLLECT_NOTEBOOK,
  RUBY2_ACTION_COLLECT_FLASHCARDS,
  RUBY2_ACTION_COLLECT_LUNCH_TRAY,
  RUBY2_ACTION_COLLECT_OFFICE_PASS,
  RUBY2_ACTION_COLLECT_LIBRARY_CARD,
  RUBY2_ACTION_COLLECT_LAB_FLASK,
  RUBY2_ACTION_CHAT_OPTION_A,
  RUBY2_ACTION_CHAT_OPTION_B,
  RUBY2_ACTION_CHECK_NOTEBOOK,
  RUBY2_ACTION_WAIT_BELL,
  RUBY2_ACTION_NONE,
  RUBY2_ACTION_COUNT
} Ruby2WorldActionId;

typedef enum {
  RUBY2_PLAYER_AVATAR_UNSET,
  RUBY2_PLAYER_AVATAR_SOURCE,
  RUBY2_PLAYER_AVATAR_SENSE,
  RUBY2_PLAYER_AVATAR_SYNC,
  RUBY2_PLAYER_AVATAR_SIGNAL,
  RUBY2_PLAYER_AVATAR_COUNT
} Ruby2PlayerAvatarId;

typedef enum {
  RUBY2_EVENT_ROOM_ENTERED,
  RUBY2_EVENT_NPC_MOVED,
  RUBY2_EVENT_OBJECT_APPEARED,
  RUBY2_EVENT_TIME_ADVANCED,
  RUBY2_EVENT_CLASS_STARTED,
  RUBY2_EVENT_APPROACH_RESOLVED,
  RUBY2_EVENT_SOCIAL_TRIGGERED,
  RUBY2_EVENT_OBJECT_INSPECTED,
  RUBY2_EVENT_ITEM_COLLECTED,
  RUBY2_EVENT_NOTEBOOK_UPDATED,
  RUBY2_EVENT_AGENT_SPOKE,
  RUBY2_EVENT_AGENT_REMEMBERED,
  RUBY2_EVENT_AGENT_INTENT_REJECTED,
  RUBY2_EVENT_DIRECTOR_TRIGGERED,
  RUBY2_EVENT_IDLE
} Ruby2WorldEventKind;

typedef enum {
  RUBY2_EVENT_VISIBLE_TO_PLAYER,
  RUBY2_EVENT_INTERNAL
} Ruby2WorldEventVisibility;

typedef enum {
  RUBY2_AGENT_REQUEST_MOVE,
  RUBY2_AGENT_REQUEST_SPEAK,
  RUBY2_AGENT_INSPECT_OBJECT,
  RUBY2_AGENT_REMEMBER_EVENT
} Ruby2AgentIntentKind;

typedef enum {
  RUBY2_AGENT_INTENT_ACCEPTED,
  RUBY2_AGENT_INTENT_REJECTED_INVALID_ACTOR,
  RUBY2_AGENT_INTENT_REJECTED_INVALID_TARGET,
  RUBY2_AGENT_INTENT_REJECTED_NOT_COPRESENT,
  RUBY2_AGENT_INTENT_REJECTED_BLOCKED_ROUTE,
  RUBY2_AGENT_INTENT_REJECTED_OBJECT_ABSENT,
  RUBY2_AGENT_INTENT_REJECTED_EMPTY_TEXT
} Ruby2AgentIntentResult;

typedef enum {
  RUBY2_AGENT_AGENDA_RUBY_HALLWAY_MOVE,
  RUBY2_AGENT_AGENDA_RUBY_HALLWAY_LINE,
  RUBY2_AGENT_AGENDA_RAVI_HALLWAY_FACT,
  RUBY2_AGENT_AGENDA_LYRA_RECEIPT_CHECK,
  RUBY2_AGENT_AGENDA_NOOR_RECEIPT_LINE,
  RUBY2_AGENT_AGENDA_NOOR_RECEIPT_MEMORY,
  RUBY2_AGENT_AGENDA_COUNT
} Ruby2AgentAgendaId;

typedef struct {
  Ruby2RoomId id;
  Ruby2RoomId exits[RUBY2_WORLD_MAX_EXITS];
  uint8_t exit_count;
} Ruby2WorldRoom;

typedef struct {
  Ruby2WorldActionId id;
  Ruby2WorldActionKind kind;
  Ruby2RoomId target_room;
  Ruby2CharacterId target_character;
  Ruby2WorldObjectId target_object;
  Ruby2Discipline discipline;
  Ruby2Virtue virtue;
  const char* label;
} Ruby2WorldAction;

typedef struct {
  Ruby2WorldActionId action_id;
  Ruby2WorldActionKind kind;
  Ruby2RoomId target_room;
  Ruby2CharacterId target_character;
  Ruby2WorldObjectId target_object;
  Ruby2Discipline discipline;
  Ruby2Virtue virtue;
} Ruby2WorldCommand;

typedef struct {
  Ruby2WorldAction actions[RUBY2_WORLD_MAX_ACTIONS];
  uint8_t count;
} Ruby2WorldActionList;

typedef struct {
  Ruby2WorldEventKind kind;
  uint32_t tick;
  Ruby2RoomId room;
  Ruby2CharacterId character;
  Ruby2WorldObjectId object;
  Ruby2WorldActionId action;
  Ruby2WorldEventVisibility visibility;
  const char* text;
} Ruby2WorldEvent;

typedef struct {
  Ruby2WorldEvent events[RUBY2_WORLD_MAX_EVENTS];
  uint8_t count;
  uint8_t dropped_count;
} Ruby2WorldEventQueue;

typedef struct {
  bool present;
  Ruby2RoomId room;
} Ruby2WorldObjectState;

typedef struct {
  Ruby2AgentIntentKind kind;
  Ruby2CharacterId character;
  Ruby2RoomId target_room;
  Ruby2WorldObjectId target_object;
  const char* text;
} Ruby2AgentIntent;

typedef struct {
  Ruby2CharacterId character;
  Ruby2RoomId actor_room;
  Ruby2RoomId player_room;
  Ruby2TimeBlock time_block;
  bool co_present_with_player;
  Ruby2CharacterId visible_people[RUBY2_CHARACTER_COUNT];
  uint8_t visible_people_count;
  Ruby2WorldObjectId visible_objects[RUBY2_WORLD_OBJECT_COUNT];
  uint8_t visible_object_count;
  int8_t clocks[RUBY2_CLOCK_COUNT];
  bool homeroom_started;
  bool homeroom_resolved;
  bool lunch_started;
  bool cafeteria_social_triggered;
  bool receipt_inspected;
  bool has_last_visible_event;
  Ruby2WorldEvent last_visible_event;
} Ruby2AgentPerception;

typedef struct {
  Ruby2AgentIntent intent;
  Ruby2AgentAgendaId agenda_id;
  Ruby2Discipline discipline;
  Ruby2Virtue virtue;
  float authored_priority;
  const char* reason;
} Ruby2AgentCandidateIntent;

typedef struct {
  Ruby2AgentCandidateIntent candidates[RUBY2_WORLD_MAX_AGENT_INTENTS];
  uint8_t count;
} Ruby2AgentCandidateList;

typedef struct {
  Ruby2State game;
  uint32_t tick;
  bool has_last_action;
  Ruby2WorldActionId last_action_id;
  Ruby2RoomId last_action_room;
  uint8_t recent_action_count;
  Ruby2WorldActionId recent_action_ids[RUBY2_WORLD_MAX_RECENT_ACTIONS];
  Ruby2RoomId recent_action_rooms[RUBY2_WORLD_MAX_RECENT_ACTIONS];
  Ruby2RoomId npc_rooms[RUBY2_CHARACTER_COUNT];
  Ruby2WorldObjectState objects[RUBY2_WORLD_OBJECT_COUNT];
  Ruby2WorldEventQueue events;
  bool player_profile_ready;
  Ruby2PlayerAvatarId player_avatar;
  bool chat_active;
  bool chat_room_mode;
  Ruby2CharacterId chat_character;
  Ruby2RoomId chat_room;
  const char* chat_prompt;
  const char* chat_options[2];
  bool chat_resolved_rooms[RUBY2_ROOM_COUNT];
  bool homeroom_started;
  bool homeroom_resolved;
  Ruby2WorldActionId homeroom_approach_action;
  bool lunch_started;
  bool science_lab_quiz_resolved;
  bool library_quiz_resolved;
  bool cafeteria_social_triggered;
  bool receipt_inspected;
  bool agent_agenda_done[RUBY2_AGENT_AGENDA_COUNT];
} Ruby2World;

void ruby2_world_init(Ruby2World* world);
const Ruby2WorldRoom* ruby2_world_room(Ruby2RoomId room_id);
const char* ruby2_world_character_name(Ruby2CharacterId character_id);
const char* ruby2_world_object_name(Ruby2WorldObjectId object_id);
const char* ruby2_world_action_label(Ruby2WorldActionId action_id);
const char* ruby2_world_event_name(Ruby2WorldEventKind event_kind);
const char* ruby2_agent_intent_result_name(Ruby2AgentIntentResult result);
bool ruby2_world_event_visible_to_player(const Ruby2WorldEvent* event);
bool ruby2_world_character_present(const Ruby2World* world, Ruby2CharacterId character_id, Ruby2RoomId room_id);
bool ruby2_world_object_present(const Ruby2World* world, Ruby2WorldObjectId object_id, Ruby2RoomId room_id);
void ruby2_world_query_actions(const Ruby2World* world, Ruby2WorldActionList* out);
bool ruby2_world_command_from_action(Ruby2WorldActionId action_id, Ruby2WorldCommand* out);
bool ruby2_world_apply_command(Ruby2World* world, const Ruby2WorldCommand* command);
bool ruby2_world_apply_action(Ruby2World* world, Ruby2WorldActionId action_id);
Ruby2AgentIntentResult ruby2_world_submit_agent_intent(Ruby2World* world, const Ruby2AgentIntent* intent);
bool ruby2_world_build_agent_perception(const Ruby2World* world, Ruby2CharacterId character_id, Ruby2AgentPerception* out);
void ruby2_world_query_agent_intents(const Ruby2World* world, Ruby2AgentCandidateList* out);
void ruby2_world_step_agents(Ruby2World* world);
bool ruby2_world_pop_event(Ruby2World* world, Ruby2WorldEvent* out);
void ruby2_world_clear_events(Ruby2World* world);

#endif
