#ifndef RUBY2_UI_H
#define RUBY2_UI_H

#include "ruby2_ranker.h"

#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>

#define RUBY2_UI_SNAPSHOT_SCHEMA "ruby2.ui.snapshot.v1"
#define RUBY2_UI_MAX_EVENTS RUBY2_WORLD_MAX_EVENTS
#define RUBY2_UI_MAX_BLACKBOARD_LINES 6
#define RUBY2_UI_MAX_REACTION_BUBBLES 4
#define RUBY2_UI_MAX_ACTION_SLOTS 4
#define RUBY2_UI_MAX_ITEM_SLOTS RUBY2_ITEM_COUNT

typedef enum {
  RUBY2_UI_FOCUS_SPEECH_ONLY,
  RUBY2_UI_FOCUS_SPEECH_THEN_BLACKBOARD
} Ruby2UiFocusMode;

typedef enum {
  RUBY2_UI_FOCUS_INITIAL_SPEECH,
  RUBY2_UI_FOCUS_INITIAL_BLACKBOARD
} Ruby2UiFocusInitial;

typedef enum {
  RUBY2_UI_BUBBLE_THEME_RUBY,
  RUBY2_UI_BUBBLE_THEME_LYRA,
  RUBY2_UI_BUBBLE_THEME_MIKA,
  RUBY2_UI_BUBBLE_THEME_RAVI,
  RUBY2_UI_BUBBLE_THEME_INDRA,
  RUBY2_UI_BUBBLE_THEME_NOOR,
  RUBY2_UI_BUBBLE_THEME_SAMI,
  RUBY2_UI_BUBBLE_THEME_NEUTRAL
} Ruby2UiBubbleTheme;

typedef enum {
  RUBY2_UI_BUBBLE_ANCHOR_SPEAKER,
  RUBY2_UI_BUBBLE_ANCHOR_WITNESS_1,
  RUBY2_UI_BUBBLE_ANCHOR_WITNESS_2,
  RUBY2_UI_BUBBLE_ANCHOR_WITNESS_3,
  RUBY2_UI_BUBBLE_ANCHOR_WITNESS_4
} Ruby2UiBubbleAnchor;

typedef enum {
  RUBY2_UI_TAIL_LEFT,
  RUBY2_UI_TAIL_RIGHT
} Ruby2UiTailDirection;

typedef struct {
  Ruby2UiFocusMode mode;
  Ruby2UiFocusInitial initial;
  Ruby2CharacterId speaker;
  const char* speech_line;
  bool has_blackboard;
  const char* blackboard_kicker;
  const char* blackboard_lines[RUBY2_UI_MAX_BLACKBOARD_LINES];
  uint8_t blackboard_line_count;
  const char* next_label;
  const char* back_label;
} Ruby2UiFocusPresentation;

typedef struct {
  Ruby2CharacterId character;
  const char* line;
  Ruby2UiBubbleTheme theme;
  Ruby2UiBubbleAnchor anchor;
  Ruby2UiTailDirection tail;
} Ruby2UiReactionBubble;

typedef struct {
  Ruby2WorldActionId action;
  uint8_t action_index;
  uint8_t button_index;
  const char* color_token;
  const char* color_hex;
} Ruby2UiActionSlot;

typedef struct {
  Ruby2UiActionSlot slots[RUBY2_UI_MAX_ACTION_SLOTS];
  uint8_t slot_count;
  const char* placement;
  const char* palette;
} Ruby2UiActionTrayPresentation;

typedef struct {
  const char* layout;
  const char* notebook_line;
  Ruby2UiFocusPresentation focus;
  Ruby2UiReactionBubble reaction_bubbles[RUBY2_UI_MAX_REACTION_BUBBLES];
  uint8_t reaction_bubble_count;
  Ruby2UiActionTrayPresentation action_tray;
} Ruby2UiPresentation;

typedef struct {
  Ruby2WorldActionId id;
  Ruby2WorldActionKind kind;
  Ruby2RoomId target_room;
  Ruby2CharacterId target_character;
  Ruby2WorldObjectId target_object;
  Ruby2Discipline discipline;
  Ruby2Virtue virtue;
  const char* label;
  float rank_score;
} Ruby2UiAction;

typedef struct {
  uint8_t slot_index;
  bool occupied;
  Ruby2ItemId item;
  const char* name;
  bool carried;
  int8_t charges;
} Ruby2UiItemSlot;

typedef struct {
  Ruby2WorldEventKind kind;
  uint32_t tick;
  Ruby2RoomId room;
  Ruby2CharacterId character;
  Ruby2WorldObjectId object;
  Ruby2WorldActionId action;
  const char* text;
  bool has_performance;
  Ruby2CharacterId performance_speaker;
  const char* performance_line;
} Ruby2UiEvent;

typedef struct {
  Ruby2RoomId room;
  Ruby2TimeBlock time_block;
  bool player_profile_ready;
  Ruby2PlayerAvatarId player_avatar;
  int8_t clocks[RUBY2_CLOCK_COUNT];
  uint32_t discipline_counts[RUBY2_DISCIPLINE_COUNT];
  uint8_t people[RUBY2_CHARACTER_COUNT];
  uint8_t people_count;
  uint8_t objects[RUBY2_WORLD_OBJECT_COUNT];
  uint8_t object_count;
  Ruby2UiAction actions[RUBY2_WORLD_MAX_ACTIONS];
  uint8_t action_count;
  Ruby2UiItemSlot item_slots[RUBY2_UI_MAX_ITEM_SLOTS];
  uint8_t item_slot_count;
  Ruby2UiEvent events[RUBY2_UI_MAX_EVENTS];
  uint8_t event_count;
  Ruby2UiPresentation presentation;
} Ruby2UiSnapshot;

void ruby2_ui_snapshot_build(const Ruby2World* world, bool ranked_actions, Ruby2UiSnapshot* out);
bool ruby2_ui_snapshot_write_json(FILE* fp, const Ruby2UiSnapshot* snapshot);

#endif
