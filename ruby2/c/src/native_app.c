#include "ruby2_native_renderer.h"
#include "ruby2_llm.h"
#include "ruby2_world_performance.h"

#include <SDL.h>

#include <stdbool.h>
#include <stdio.h>
#include <string.h>

#define RUBY2_NATIVE_RESULT_MS 1450

typedef struct {
  SDL_Thread* thread;
  SDL_mutex* mutex;
  Ruby2PerformanceRequest request;
  char line[RUBY2_LLM_LINE_MAX];
  uint32_t tick;
  Ruby2WorldEventKind kind;
  Ruby2WorldActionId action;
  Ruby2RoomId room;
  Ruby2CharacterId speaker;
  bool started;
  bool ready;
  bool ok;
} Ruby2NativeAiJob;

typedef struct {
  Ruby2World world;
  Ruby2UiSnapshot snapshot;
  Ruby2NativeAiJob ai_job;
  bool show_blackboard;
  uint32_t focus_changed_at_ms;
  Ruby2WorldActionId pending_action;
  uint32_t pending_apply_at_ms;
  Ruby2WorldActionId flash_action;
  uint32_t flash_until_ms;
  char ai_line[RUBY2_LLM_LINE_MAX];
  uint32_t ai_tick;
  Ruby2WorldEventKind ai_kind;
  Ruby2WorldActionId ai_action;
  Ruby2RoomId ai_room;
  Ruby2CharacterId ai_speaker;
  bool has_ai_line;
  char result_line[256];
  uint32_t result_since_ms;
  uint32_t result_until_ms;
} Ruby2NativeGame;

typedef struct {
  const char* demo;
  const char* write_bmp;
  bool smoke;
  bool show_board;
} Ruby2NativeArgs;

static const char* result_line_for_action(Ruby2WorldActionId action) {
  switch (action) {
    case RUBY2_ACTION_GO_HALLWAY:
      return "Moved: Hallway.";
    case RUBY2_ACTION_GO_HOMEROOM:
      return "Moved: Homeroom.";
    case RUBY2_ACTION_GO_SCIENCE_LAB:
      return "Moved: Science Lab.";
    case RUBY2_ACTION_GO_LIBRARY:
      return "Moved: Library.";
    case RUBY2_ACTION_GO_CAFETERIA:
      return "Moved: Cafeteria.";
    case RUBY2_ACTION_GO_GREENHOUSE:
      return "Moved: Greenhouse.";
    case RUBY2_ACTION_GO_COURTYARD:
      return "Moved: Courtyard.";
    case RUBY2_ACTION_GO_TEACHER_OFFICE:
      return "Moved: Teacher Office.";
    case RUBY2_ACTION_SELECT_AVATAR_SOURCE:
      return "Profile selected: Source.";
    case RUBY2_ACTION_SELECT_AVATAR_SENSE:
      return "Profile selected: Sense.";
    case RUBY2_ACTION_SELECT_AVATAR_SYNC:
      return "Profile selected: Sync.";
    case RUBY2_ACTION_SELECT_AVATAR_SIGNAL:
      return "Profile selected: Signal.";
    case RUBY2_ACTION_CHAT_ROOM:
      return "Conversation opened: room intent choices available.";
    case RUBY2_ACTION_TALK_RUBY:
    case RUBY2_ACTION_TALK_LYRA:
    case RUBY2_ACTION_TALK_MIKA:
    case RUBY2_ACTION_TALK_RAVI:
    case RUBY2_ACTION_TALK_INDRA:
    case RUBY2_ACTION_TALK_NOOR:
    case RUBY2_ACTION_TALK_SAMI:
      return "Conversation opened: character intent choices available.";
    case RUBY2_ACTION_ATTEND_HOMEROOM:
      return "Class started: Homeroom blackboard active.";
    case RUBY2_ACTION_APPROACH_SOURCE:
    case RUBY2_ACTION_APPROACH_SENSE:
    case RUBY2_ACTION_APPROACH_SYNC:
    case RUBY2_ACTION_APPROACH_SIGNAL:
      return "Board answer recorded.";
    case RUBY2_ACTION_USE_LUNCH_TRAY:
      return "Lunch Tray used: table joined.";
    case RUBY2_ACTION_COLLECT_NOTEBOOK:
    case RUBY2_ACTION_COLLECT_FLASHCARDS:
    case RUBY2_ACTION_COLLECT_LUNCH_TRAY:
    case RUBY2_ACTION_COLLECT_OFFICE_PASS:
    case RUBY2_ACTION_COLLECT_LIBRARY_CARD:
    case RUBY2_ACTION_COLLECT_LAB_FLASK:
      return "Bag updated: item collected.";
    case RUBY2_ACTION_CHAT_OPTION_A:
    case RUBY2_ACTION_CHAT_OPTION_B:
      return "Conversation intent recorded.";
    case RUBY2_ACTION_CHECK_NOTEBOOK:
      return "Notebook checked.";
    case RUBY2_ACTION_WAIT_BELL:
      return "Bell action applied.";
    case RUBY2_ACTION_NONE:
    default:
      return "";
  }
}

static int native_ai_line_worker(void* user_data) {
  Ruby2NativeAiJob* job = (Ruby2NativeAiJob*)user_data;
  char line[RUBY2_LLM_LINE_MAX];
  bool ok = false;

  if (job) {
    ok = ruby2_llm_perform_line(&job->request, line, sizeof(line));
    SDL_LockMutex(job->mutex);
    job->ok = ok;
    if (ok) {
      (void)snprintf(job->line, sizeof(job->line), "%s", line);
    }
    job->ready = true;
    SDL_UnlockMutex(job->mutex);
  }

  return 0;
}

static void native_ai_job_destroy(Ruby2NativeAiJob* job, bool wait_for_thread) {
  if (!job) return;
  if (job->thread && wait_for_thread) {
    SDL_WaitThread(job->thread, NULL);
    job->thread = NULL;
  }
  if (job->thread && !wait_for_thread) return;
  if (job->mutex) {
    SDL_DestroyMutex(job->mutex);
    job->mutex = NULL;
  }
  memset(job, 0, sizeof(*job));
}

static bool native_snapshot_event_matches_ai(
  const Ruby2NativeGame* game,
  const Ruby2UiEvent* event
) {
  return game &&
         event &&
         game->has_ai_line &&
         event->tick == game->ai_tick &&
         event->kind == game->ai_kind &&
         event->action == game->ai_action &&
         event->room == game->ai_room &&
         game->ai_room == game->snapshot.room;
}

static bool native_apply_ai_line_to_snapshot(Ruby2NativeGame* game) {
  if (!game || !game->has_ai_line) return false;

  for (uint8_t i = game->snapshot.event_count; i > 0; --i) {
    Ruby2UiEvent* event = &game->snapshot.events[i - 1u];
    if (!native_snapshot_event_matches_ai(game, event) || !event->has_performance) continue;

    event->performance_speaker = game->ai_speaker;
    event->performance_line = game->ai_line;
    game->snapshot.presentation.focus.speaker = game->ai_speaker;
    game->snapshot.presentation.focus.speech_line = game->ai_line;
    return true;
  }

  return false;
}

static bool native_event_can_be_performed(
  const Ruby2NativeGame* game,
  const Ruby2WorldEvent* event,
  Ruby2PerformanceRequest* out
) {
  if (!game ||
      !event ||
      event->room != game->world.game.current_room_id ||
      !ruby2_world_event_visible_to_player(event) ||
      !ruby2_world_event_to_performance_request(&game->world, event, out)) {
    return false;
  }

  return out->speaker < RUBY2_CHARACTER_COUNT &&
         ruby2_world_character_present(&game->world, out->speaker, game->world.game.current_room_id);
}

static bool native_start_ai_for_latest_event(Ruby2NativeGame* game) {
  Ruby2NativeAiJob* job;
  Ruby2PerformanceRequest request;
  const Ruby2WorldEvent* selected_event = NULL;

  if (!game ||
      game->ai_job.started ||
      !ruby2_llm_enabled() ||
      ruby2_llm_backend() == RUBY2_LLM_BACKEND_FALLBACK) {
    return false;
  }

  for (uint8_t i = game->world.events.count; i > 0; --i) {
    const Ruby2WorldEvent* event = &game->world.events.events[i - 1u];
    if (native_event_can_be_performed(game, event, &request)) {
      selected_event = event;
      break;
    }
  }

  if (!selected_event) return false;

  job = &game->ai_job;
  memset(job, 0, sizeof(*job));
  job->request = request;
  job->tick = selected_event->tick;
  job->kind = selected_event->kind;
  job->action = selected_event->action;
  job->room = selected_event->room;
  job->speaker = request.speaker;
  job->mutex = SDL_CreateMutex();
  if (!job->mutex) {
    memset(job, 0, sizeof(*job));
    return false;
  }

  job->thread = SDL_CreateThread(native_ai_line_worker, "ruby2-ai-line", job);
  if (!job->thread) {
    native_ai_job_destroy(job, true);
    return false;
  }

  job->started = true;
  return true;
}

static bool native_poll_ai_job(Ruby2NativeGame* game, uint32_t now_ms) {
  Ruby2NativeAiJob* job;
  char line[RUBY2_LLM_LINE_MAX];
  uint32_t tick;
  Ruby2WorldEventKind kind;
  Ruby2WorldActionId action;
  Ruby2RoomId room;
  Ruby2CharacterId speaker;
  bool ready = false;
  bool ok = false;

  if (!game || !game->ai_job.started) return false;
  job = &game->ai_job;

  SDL_LockMutex(job->mutex);
  ready = job->ready;
  ok = job->ok;
  if (ready && ok) {
    (void)snprintf(line, sizeof(line), "%s", job->line);
  } else {
    line[0] = '\0';
  }
  tick = job->tick;
  kind = job->kind;
  action = job->action;
  room = job->room;
  speaker = job->speaker;
  SDL_UnlockMutex(job->mutex);

  if (!ready) return false;

  native_ai_job_destroy(job, true);
  if (!ok || line[0] == '\0' || room != game->snapshot.room) return false;

  (void)snprintf(game->ai_line, sizeof(game->ai_line), "%s", line);
  game->ai_tick = tick;
  game->ai_kind = kind;
  game->ai_action = action;
  game->ai_room = room;
  game->ai_speaker = speaker;
  game->has_ai_line = true;
  if (native_apply_ai_line_to_snapshot(game)) {
    game->focus_changed_at_ms = now_ms;
    return true;
  }
  return false;
}

static bool native_snapshot_wants_blackboard(const Ruby2UiSnapshot* snapshot) {
  return snapshot &&
         snapshot->presentation.focus.has_blackboard &&
         snapshot->presentation.focus.initial == RUBY2_UI_FOCUS_INITIAL_BLACKBOARD;
}

static void show_result(Ruby2NativeGame* game, Ruby2WorldActionId action, uint32_t now_ms) {
  const char* line = result_line_for_action(action);
  if (!game || !line || line[0] == '\0') return;
  (void)snprintf(game->result_line, sizeof(game->result_line), "%s", line);
  game->result_since_ms = now_ms;
  game->result_until_ms = now_ms + RUBY2_NATIVE_RESULT_MS;
}

static bool apply_action(Ruby2NativeGame* game, Ruby2WorldActionId action, uint32_t now_ms) {
  if (!game || action == RUBY2_ACTION_NONE) return false;
  if (!ruby2_world_apply_action(&game->world, action)) return false;
  if (action == RUBY2_ACTION_WAIT_BELL) {
    ruby2_world_step_agents(&game->world);
  }
  game->has_ai_line = false;
  ruby2_ui_snapshot_build(&game->world, true, &game->snapshot);
  game->show_blackboard = native_snapshot_wants_blackboard(&game->snapshot);
  game->focus_changed_at_ms = now_ms;
  show_result(game, action, now_ms);
  (void)native_start_ai_for_latest_event(game);
  return true;
}

static bool schedule_action(Ruby2NativeGame* game, Ruby2WorldActionId action, uint32_t now_ms) {
  if (!game || action == RUBY2_ACTION_NONE) return false;
  game->pending_action = action;
  game->pending_apply_at_ms = now_ms + RUBY2_NATIVE_ACTION_APPLY_MS;
  game->flash_action = action;
  game->flash_until_ms = now_ms + RUBY2_NATIVE_ACTION_FLASH_MS;
  return true;
}

static bool native_key_matches_navigation_label(const char* key_label, SDL_Keycode key) {
  if (!key_label || key_label[0] == '\0') return false;
  switch (key_label[0]) {
    case 'W':
      return key == SDLK_w || key == SDLK_UP;
    case 'A':
      return key == SDLK_a || key == SDLK_LEFT;
    case 'S':
      return key == SDLK_s || key == SDLK_DOWN;
    case 'D':
      return key == SDLK_d || key == SDLK_RIGHT;
    case 'Q':
      return key == SDLK_q;
    case 'E':
      return key == SDLK_e;
    case 'C':
      return key == SDLK_c;
    default:
      return false;
  }
}

static Ruby2WorldActionId native_navigation_action_for_key(
  const Ruby2UiSnapshot* snapshot,
  SDL_Keycode key
) {
  if (!snapshot) return RUBY2_ACTION_NONE;

  for (uint8_t i = 0; i < snapshot->presentation.navigation.slot_count; ++i) {
    const Ruby2UiNavigationSlot* slot = &snapshot->presentation.navigation.slots[i];
    if (native_key_matches_navigation_label(slot->key_label, key)) {
      return slot->action;
    }
  }

  return RUBY2_ACTION_NONE;
}

static void apply_pending_action_if_ready(Ruby2NativeGame* game, uint32_t now_ms) {
  Ruby2WorldActionId pending;
  if (!game || game->pending_action == RUBY2_ACTION_NONE || now_ms < game->pending_apply_at_ms) return;
  pending = game->pending_action;
  game->pending_action = RUBY2_ACTION_NONE;
  game->pending_apply_at_ms = 0;
  (void)apply_action(game, pending, now_ms);
}

static bool apply_demo(Ruby2NativeGame* game, const char* demo) {
  if (!demo || strcmp(demo, "initial") == 0) return true;
  if (strcmp(demo, "homeroom_problem") == 0) {
    return ruby2_world_apply_action(&game->world, RUBY2_ACTION_GO_HOMEROOM) &&
           ruby2_world_apply_action(&game->world, RUBY2_ACTION_ATTEND_HOMEROOM);
  }
  if (strcmp(demo, "inventory_sample") == 0) {
    return ruby2_world_apply_action(&game->world, RUBY2_ACTION_COLLECT_NOTEBOOK) &&
           ruby2_world_apply_action(&game->world, RUBY2_ACTION_GO_HOMEROOM) &&
           ruby2_world_apply_action(&game->world, RUBY2_ACTION_COLLECT_FLASHCARDS) &&
           ruby2_world_apply_action(&game->world, RUBY2_ACTION_ATTEND_HOMEROOM) &&
           ruby2_world_apply_action(&game->world, RUBY2_ACTION_APPROACH_SOURCE) &&
           ruby2_world_apply_action(&game->world, RUBY2_ACTION_WAIT_BELL) &&
           ruby2_world_apply_action(&game->world, RUBY2_ACTION_GO_HALLWAY) &&
           ruby2_world_apply_action(&game->world, RUBY2_ACTION_GO_SCIENCE_LAB) &&
           ruby2_world_apply_action(&game->world, RUBY2_ACTION_COLLECT_LAB_FLASK);
  }
  if (strcmp(demo, "after_source") == 0) {
    return ruby2_world_apply_action(&game->world, RUBY2_ACTION_GO_HOMEROOM) &&
           ruby2_world_apply_action(&game->world, RUBY2_ACTION_ATTEND_HOMEROOM) &&
           ruby2_world_apply_action(&game->world, RUBY2_ACTION_APPROACH_SOURCE);
  }
  if (strcmp(demo, "science_quiz") == 0) {
    return ruby2_world_apply_action(&game->world, RUBY2_ACTION_GO_HOMEROOM) &&
           ruby2_world_apply_action(&game->world, RUBY2_ACTION_ATTEND_HOMEROOM) &&
           ruby2_world_apply_action(&game->world, RUBY2_ACTION_APPROACH_SOURCE) &&
           ruby2_world_apply_action(&game->world, RUBY2_ACTION_WAIT_BELL) &&
           ruby2_world_apply_action(&game->world, RUBY2_ACTION_GO_HALLWAY) &&
           ruby2_world_apply_action(&game->world, RUBY2_ACTION_GO_SCIENCE_LAB);
  }
  if (strcmp(demo, "library_quiz") == 0) {
    return ruby2_world_apply_action(&game->world, RUBY2_ACTION_GO_HOMEROOM) &&
           ruby2_world_apply_action(&game->world, RUBY2_ACTION_ATTEND_HOMEROOM) &&
           ruby2_world_apply_action(&game->world, RUBY2_ACTION_APPROACH_SOURCE) &&
           ruby2_world_apply_action(&game->world, RUBY2_ACTION_WAIT_BELL) &&
           ruby2_world_apply_action(&game->world, RUBY2_ACTION_GO_HALLWAY) &&
           ruby2_world_apply_action(&game->world, RUBY2_ACTION_GO_LIBRARY);
  }
  if (strcmp(demo, "lunch_tray") == 0) {
    return ruby2_world_apply_action(&game->world, RUBY2_ACTION_GO_HOMEROOM) &&
           ruby2_world_apply_action(&game->world, RUBY2_ACTION_ATTEND_HOMEROOM) &&
           ruby2_world_apply_action(&game->world, RUBY2_ACTION_APPROACH_SOURCE) &&
           ruby2_world_apply_action(&game->world, RUBY2_ACTION_WAIT_BELL) &&
           ruby2_world_apply_action(&game->world, RUBY2_ACTION_GO_HALLWAY) &&
           ruby2_world_apply_action(&game->world, RUBY2_ACTION_GO_CAFETERIA);
  }
  if (strcmp(demo, "lunch_tray_used") == 0) {
    return ruby2_world_apply_action(&game->world, RUBY2_ACTION_GO_HOMEROOM) &&
           ruby2_world_apply_action(&game->world, RUBY2_ACTION_ATTEND_HOMEROOM) &&
           ruby2_world_apply_action(&game->world, RUBY2_ACTION_APPROACH_SOURCE) &&
           ruby2_world_apply_action(&game->world, RUBY2_ACTION_WAIT_BELL) &&
           ruby2_world_apply_action(&game->world, RUBY2_ACTION_GO_HALLWAY) &&
           ruby2_world_apply_action(&game->world, RUBY2_ACTION_GO_CAFETERIA) &&
           ruby2_world_apply_action(&game->world, RUBY2_ACTION_COLLECT_LUNCH_TRAY) &&
           ruby2_world_apply_action(&game->world, RUBY2_ACTION_USE_LUNCH_TRAY);
  }
  return false;
}

static bool init_game(Ruby2NativeGame* game, const Ruby2NativeArgs* args) {
  memset(game, 0, sizeof(*game));
  game->pending_action = RUBY2_ACTION_NONE;
  game->flash_action = RUBY2_ACTION_NONE;
  ruby2_world_init(&game->world);
  if (!apply_demo(game, args->demo)) return false;
  ruby2_ui_snapshot_build(&game->world, true, &game->snapshot);
  game->show_blackboard = args->show_board
    ? game->snapshot.presentation.focus.has_blackboard
    : native_snapshot_wants_blackboard(&game->snapshot);
  return true;
}

static Ruby2NativeFrameState frame_state_from_game(const Ruby2NativeGame* game) {
  Ruby2NativeFrameState frame_state;
  memset(&frame_state, 0, sizeof(frame_state));
  if (!game) return frame_state;
  frame_state.show_blackboard = game->show_blackboard;
  frame_state.focus_changed_at_ms = game->focus_changed_at_ms;
  frame_state.flash_action = game->flash_action;
  frame_state.flash_until_ms = game->flash_until_ms;
  frame_state.result_line = game->result_line;
  frame_state.result_since_ms = game->result_since_ms;
  frame_state.result_until_ms = game->result_until_ms;
  return frame_state;
}

static bool write_bmp_frame(const char* path, Ruby2NativeGame* game) {
  SDL_Surface* surface = NULL;
  SDL_Renderer* renderer = NULL;
  Ruby2NativeRenderer* native_renderer = NULL;
  Ruby2NativeFrameState frame_state;
  bool ok = false;

  surface = SDL_CreateRGBSurfaceWithFormat(0, RUBY2_NATIVE_W, RUBY2_NATIVE_H, 32, SDL_PIXELFORMAT_ARGB8888);
  if (!surface) goto done;
  renderer = SDL_CreateSoftwareRenderer(surface);
  if (!renderer) goto done;
  native_renderer = ruby2_native_renderer_create(renderer);
  if (!native_renderer) goto done;
  frame_state = frame_state_from_game(game);
  ruby2_native_renderer_render(native_renderer, renderer, &game->snapshot, &frame_state, 1000);
  SDL_RenderPresent(renderer);
  ok = SDL_SaveBMP(surface, path) == 0;

done:
  ruby2_native_renderer_destroy(native_renderer);
  SDL_DestroyRenderer(renderer);
  SDL_FreeSurface(surface);
  return ok;
}

static void parse_args(int argc, char** argv, Ruby2NativeArgs* args) {
  memset(args, 0, sizeof(*args));
  args->demo = "initial";
  for (int i = 1; i < argc; ++i) {
    if (strcmp(argv[i], "--demo") == 0 && i + 1 < argc) {
      args->demo = argv[++i];
    } else if (strcmp(argv[i], "--write-bmp") == 0 && i + 1 < argc) {
      args->write_bmp = argv[++i];
    } else if (strcmp(argv[i], "--smoke") == 0) {
      args->smoke = true;
    } else if (strcmp(argv[i], "--show-board") == 0) {
      args->show_board = true;
    }
  }
}

int main(int argc, char** argv) {
  Ruby2NativeArgs args;
  Ruby2NativeGame game;
  SDL_Window* window = NULL;
  SDL_Renderer* renderer = NULL;
  Ruby2NativeRenderer* native_renderer = NULL;
  bool running = true;

  parse_args(argc, argv, &args);
  if (!init_game(&game, &args)) {
    fputs("invalid native demo\n", stderr);
    return 1;
  }

  if (args.smoke) {
    printf(
      "room=%s focus=%s actions=%u bubbles=%u\n",
      ruby2_room_name(game.snapshot.room),
      game.snapshot.presentation.focus.has_blackboard ? "speech_then_blackboard" : "speech_only",
      (unsigned)game.snapshot.presentation.action_tray.slot_count,
      (unsigned)game.snapshot.presentation.reaction_bubble_count
    );
    return 0;
  }

  if (args.write_bmp) {
    SDL_setenv("SDL_VIDEODRIVER", "dummy", 1);
  }
  if (SDL_Init(SDL_INIT_VIDEO) != 0) {
    fprintf(stderr, "SDL init failed: %s\n", SDL_GetError());
    return 1;
  }

  if (args.write_bmp) {
    bool ok = write_bmp_frame(args.write_bmp, &game);
    SDL_Quit();
    if (!ok) {
      fprintf(stderr, "failed to write BMP frame: %s\n", SDL_GetError());
      return 1;
    }
    printf("%s\n", args.write_bmp);
    return 0;
  }

  SDL_SetHint(SDL_HINT_RENDER_SCALE_QUALITY, "linear");
  window = SDL_CreateWindow(
    "Ruby High 2.0 Native Slice",
    SDL_WINDOWPOS_CENTERED,
    SDL_WINDOWPOS_CENTERED,
    RUBY2_NATIVE_W,
    RUBY2_NATIVE_H,
    SDL_WINDOW_SHOWN | SDL_WINDOW_RESIZABLE
  );
  if (!window) {
    fprintf(stderr, "SDL window failed: %s\n", SDL_GetError());
    SDL_Quit();
    return 1;
  }

  renderer = SDL_CreateRenderer(window, -1, SDL_RENDERER_ACCELERATED | SDL_RENDERER_PRESENTVSYNC);
  if (!renderer) {
    renderer = SDL_CreateRenderer(window, -1, SDL_RENDERER_SOFTWARE);
  }
  if (!renderer) {
    fprintf(stderr, "SDL renderer failed: %s\n", SDL_GetError());
    SDL_DestroyWindow(window);
    SDL_Quit();
    return 1;
  }

  SDL_RenderSetLogicalSize(renderer, RUBY2_NATIVE_W, RUBY2_NATIVE_H);
  native_renderer = ruby2_native_renderer_create(renderer);
  if (!native_renderer) {
    fputs("native renderer failed\n", stderr);
    SDL_DestroyRenderer(renderer);
    SDL_DestroyWindow(window);
    SDL_Quit();
    return 1;
  }

  while (running) {
    SDL_Event event;
    uint32_t now_ms = SDL_GetTicks();
    apply_pending_action_if_ready(&game, now_ms);
    (void)native_poll_ai_job(&game, now_ms);
    while (SDL_PollEvent(&event)) {
      if (event.type == SDL_QUIT) {
        running = false;
      } else if (event.type == SDL_KEYDOWN) {
        SDL_Keycode key = event.key.keysym.sym;
        if (key == SDLK_ESCAPE) {
          running = false;
        } else if (key == SDLK_SPACE || key == SDLK_RETURN) {
          if (game.snapshot.presentation.focus.has_blackboard) {
            game.show_blackboard = !game.show_blackboard;
            game.focus_changed_at_ms = now_ms;
          }
        } else if (key >= SDLK_1 && key <= SDLK_4) {
          uint8_t button = (uint8_t)(key - SDLK_1);
          if (button < game.snapshot.presentation.action_tray.slot_count) {
            (void)schedule_action(&game, game.snapshot.presentation.action_tray.slots[button].action, now_ms);
          }
        } else {
          Ruby2WorldActionId nav_action = native_navigation_action_for_key(&game.snapshot, key);
          if (nav_action != RUBY2_ACTION_NONE) {
            (void)schedule_action(&game, nav_action, now_ms);
          }
        }
      } else if (event.type == SDL_MOUSEBUTTONDOWN && event.button.button == SDL_BUTTON_LEFT) {
        float lx = 0.0f;
        float ly = 0.0f;
        Ruby2NativeHit hit;
        SDL_RenderWindowToLogical(renderer, event.button.x, event.button.y, &lx, &ly);
        hit = ruby2_native_renderer_hit_test(&game.snapshot, game.show_blackboard, (int)lx, (int)ly);
        if (hit.kind == RUBY2_NATIVE_HIT_FOCUS_TOGGLE) {
          game.show_blackboard = !game.show_blackboard;
          game.focus_changed_at_ms = now_ms;
        } else if (hit.kind == RUBY2_NATIVE_HIT_ACTION || hit.kind == RUBY2_NATIVE_HIT_NAVIGATION) {
          (void)schedule_action(&game, hit.action, now_ms);
        }
      }
    }

    now_ms = SDL_GetTicks();
    apply_pending_action_if_ready(&game, now_ms);
    (void)native_poll_ai_job(&game, now_ms);
    Ruby2NativeFrameState frame_state = frame_state_from_game(&game);
    ruby2_native_renderer_render(native_renderer, renderer, &game.snapshot, &frame_state, now_ms);
    SDL_RenderPresent(renderer);
  }

  ruby2_native_renderer_destroy(native_renderer);
  native_ai_job_destroy(&game.ai_job, true);
  SDL_DestroyRenderer(renderer);
  SDL_DestroyWindow(window);
  SDL_Quit();
  return 0;
}
