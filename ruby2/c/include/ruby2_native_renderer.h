#ifndef RUBY2_NATIVE_RENDERER_H
#define RUBY2_NATIVE_RENDERER_H

#include "ruby2_ui.h"

#include <SDL.h>

#include <stdbool.h>
#include <stdint.h>

#define RUBY2_NATIVE_W 1600
#define RUBY2_NATIVE_H 900
#define RUBY2_NATIVE_ACTION_FLASH_MS 180
#define RUBY2_NATIVE_ACTION_APPLY_MS 150

typedef struct Ruby2NativeRenderer Ruby2NativeRenderer;

typedef enum {
  RUBY2_NATIVE_HIT_NONE,
  RUBY2_NATIVE_HIT_FOCUS_TOGGLE,
  RUBY2_NATIVE_HIT_NAVIGATION,
  RUBY2_NATIVE_HIT_ACTION
} Ruby2NativeHitKind;

typedef struct {
  Ruby2NativeHitKind kind;
  Ruby2WorldActionId action;
} Ruby2NativeHit;

typedef struct {
  bool show_blackboard;
  uint32_t focus_changed_at_ms;
  Ruby2WorldActionId flash_action;
  uint32_t flash_until_ms;
  const char* result_line;
  uint32_t result_since_ms;
  uint32_t result_until_ms;
} Ruby2NativeFrameState;

Ruby2NativeRenderer* ruby2_native_renderer_create(SDL_Renderer* renderer);
void ruby2_native_renderer_destroy(Ruby2NativeRenderer* renderer_state);
void ruby2_native_renderer_render(
  Ruby2NativeRenderer* renderer_state,
  SDL_Renderer* renderer,
  const Ruby2UiSnapshot* snapshot,
  const Ruby2NativeFrameState* frame_state,
  uint32_t now_ms
);
Ruby2NativeHit ruby2_native_renderer_hit_test(
  const Ruby2UiSnapshot* snapshot,
  bool show_blackboard,
  int x,
  int y
);

#endif
