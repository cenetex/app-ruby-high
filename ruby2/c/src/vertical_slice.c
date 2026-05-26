#include "ruby2_engine.h"
#include "ruby2_llm.h"

#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define RUBY2_PREGEN_MAX_LINES 4

typedef struct {
  Ruby2Discipline discipline;
  Ruby2Virtue virtue;
  Ruby2CharacterId witness;
  uint16_t candidate_id;
  Ruby2Archetype tag;
  const char* label;
  const char* verb;
  const char* outcome;
  const char* homeroom_memory;
  const char* homeroom_items;
  const char* homeroom_avatars;
  const char* cafeteria_memory;
  const char* cafeteria_items;
  const char* cafeteria_avatars;
  const char* ruby_fallback;
  const char* witness_fallback;
} Ruby2ApproachOption;

typedef struct {
  Ruby2Discipline discipline;
  Ruby2Virtue virtue;
  Ruby2CharacterId speaker;
  Ruby2Archetype tag;
  const char* label;
  const char* consequence;
  const char* memory;
  const char* situation;
  const char* outcome;
  const char* fallback;
} Ruby2SocialChoice;

typedef struct {
  pthread_t thread;
  pthread_mutex_t mutex;
  pthread_cond_t cond;
  Ruby2PerformanceRequest requests[RUBY2_PREGEN_MAX_LINES];
  uint8_t order[RUBY2_PREGEN_MAX_LINES];
  char lines[RUBY2_PREGEN_MAX_LINES][RUBY2_LLM_LINE_MAX];
  bool ready[RUBY2_PREGEN_MAX_LINES];
  bool ok[RUBY2_PREGEN_MAX_LINES];
  bool started;
  bool joined;
  bool stop;
  int requested_index;
  uint8_t count;
  uint8_t speculative_limit;
  uint8_t speculative_count;
} Ruby2LinePregen;

static bool env_false(const char* value) {
  if (!value || value[0] == '\0') return false;
  return strcmp(value, "0") == 0 ||
         strcmp(value, "false") == 0 ||
         strcmp(value, "FALSE") == 0 ||
         strcmp(value, "off") == 0 ||
         strcmp(value, "OFF") == 0;
}

static bool pregen_debug_enabled(void) {
  const char* value = getenv("RUBY2_PREGEN_DEBUG");
  return value && value[0] != '\0' && strcmp(value, "0") != 0;
}

static bool pregen_enabled(void) {
  const char* value = getenv("RUBY2_LLM_PREGEN");
  if (!value || value[0] == '\0') value = getenv("RUBY_HIGH_LLM_PREGEN");
  return !env_false(value) &&
         ruby2_llm_enabled() &&
         ruby2_llm_backend() != RUBY2_LLM_BACKEND_FALLBACK;
}

static uint8_t pregen_speculative_limit(uint8_t count) {
  const char* value = getenv("RUBY2_LLM_PREGEN_SPECULATIVE");
  if (!value || value[0] == '\0') value = getenv("RUBY_HIGH_LLM_PREGEN_SPECULATIVE");
  if (!value || value[0] == '\0') return count > 0 ? 1 : 0;

  char* end = NULL;
  long parsed = strtol(value, &end, 10);
  if (end == value || parsed < 0) return count > 0 ? 1 : 0;
  if (parsed > count) return count;
  return (uint8_t)parsed;
}

static void* line_pregen_worker(void* user_data) {
  Ruby2LinePregen* pregen = (Ruby2LinePregen*)user_data;

  for (;;) {
    uint8_t index = 0;
    char line[RUBY2_LLM_LINE_MAX];
    bool ok;

    pthread_mutex_lock(&pregen->mutex);
    while (!pregen->stop) {
      if (pregen->requested_index >= 0 &&
          pregen->requested_index < pregen->count &&
          !pregen->ready[pregen->requested_index]) {
        index = (uint8_t)pregen->requested_index;
        break;
      }
      if (pregen->speculative_count < pregen->speculative_limit) {
        index = pregen->order[pregen->speculative_count++];
        break;
      }
      pthread_cond_wait(&pregen->cond, &pregen->mutex);
    }
    bool stop = pregen->stop;
    pthread_mutex_unlock(&pregen->mutex);
    if (stop || index >= pregen->count) break;

    ok = ruby2_llm_perform_line(&pregen->requests[index], line, sizeof(line));

    pthread_mutex_lock(&pregen->mutex);
    pregen->ok[index] = ok;
    if (ok) {
      snprintf(pregen->lines[index], sizeof(pregen->lines[index]), "%s", line);
    }
    pregen->ready[index] = true;
    pthread_cond_broadcast(&pregen->cond);
    stop = pregen->stop;
    pthread_mutex_unlock(&pregen->mutex);

    if (pregen_debug_enabled()) {
      fprintf(stderr, "[ruby2 pregen] option=%u ok=%d\n", (unsigned)(index + 1), ok ? 1 : 0);
    }
    if (stop) break;
  }

  return NULL;
}

static bool line_pregen_start(
  Ruby2LinePregen* pregen,
  const Ruby2PerformanceRequest* requests,
  uint8_t count,
  const uint8_t* order
) {
  if (!pregen || !requests || count == 0 || count > RUBY2_PREGEN_MAX_LINES || !pregen_enabled()) {
    return false;
  }

  memset(pregen, 0, sizeof(*pregen));
  pregen->count = count;
  pregen->requested_index = -1;
  pregen->speculative_limit = pregen_speculative_limit(count);
  for (uint8_t i = 0; i < count; ++i) {
    pregen->requests[i] = requests[i];
    pregen->order[i] = order ? order[i] : i;
  }

  if (pthread_mutex_init(&pregen->mutex, NULL) != 0) return false;
  if (pthread_cond_init(&pregen->cond, NULL) != 0) {
    pthread_mutex_destroy(&pregen->mutex);
    return false;
  }
  if (pthread_create(&pregen->thread, NULL, line_pregen_worker, pregen) != 0) {
    pthread_cond_destroy(&pregen->cond);
    pthread_mutex_destroy(&pregen->mutex);
    return false;
  }

  pregen->started = true;
  if (pregen_debug_enabled()) {
    fprintf(stderr, "[ruby2 pregen] started count=%u speculative=%u\n", (unsigned)count, (unsigned)pregen->speculative_limit);
  }
  return true;
}

static bool line_pregen_take_ready(Ruby2LinePregen* pregen, uint8_t index, char* out, size_t out_size) {
  bool hit = false;
  if (!pregen || !pregen->started || index >= pregen->count || !out || out_size == 0) return false;

  pthread_mutex_lock(&pregen->mutex);
  pregen->requested_index = index;
  pthread_cond_broadcast(&pregen->cond);
  if (pregen->ready[index] && pregen->ok[index]) {
    snprintf(out, out_size, "%s", pregen->lines[index]);
    hit = true;
  }
  pthread_mutex_unlock(&pregen->mutex);

  if (pregen_debug_enabled()) {
    fprintf(stderr, "[ruby2 pregen] selected=%u hit=%d\n", (unsigned)(index + 1), hit ? 1 : 0);
  }
  return hit;
}

static void line_pregen_request_stop(Ruby2LinePregen* pregen) {
  if (!pregen || !pregen->started || pregen->joined) return;

  pthread_mutex_lock(&pregen->mutex);
  pregen->stop = true;
  pthread_cond_broadcast(&pregen->cond);
  pthread_mutex_unlock(&pregen->mutex);
}

static void line_pregen_stop_join(Ruby2LinePregen* pregen) {
  if (!pregen || !pregen->started || pregen->joined) return;

  line_pregen_request_stop(pregen);
  pthread_join(pregen->thread, NULL);
  pthread_cond_destroy(&pregen->cond);
  pthread_mutex_destroy(&pregen->mutex);
  pregen->joined = true;
  pregen->started = false;
}

static const char* homeroom_location(void) {
  return "Homeroom, front board. The answer card is taped beside the wet work order.";
}

static const char* cafeteria_location(void) {
  return "Cafeteria, end of the lunch table nearest the mural wall.";
}

static const char* cafeteria_visible_avatars(Ruby2CharacterId witness) {
  switch (witness) {
    case RUBY2_CHARACTER_RAVI:
      return "Ravi flattening the Lunch Tray; Ruby visible through the office window.";
    case RUBY2_CHARACTER_INDRA:
      return "Indra beside the tray without touching it; Noor across the table.";
    case RUBY2_CHARACTER_NOOR:
      return "Noor pinching the Lunch Tray corner; Lyra checking nearby trays.";
    case RUBY2_CHARACTER_LYRA:
      return "Lyra fanning three Lunch Trays; Mika standing behind her chair.";
    default:
      return "Two classmates at the table, both looking at the Lunch Tray.";
  }
}

static void print_scene_panel(const char* label, const char* location, const char* avatars, const char* items) {
  puts("");
  printf("[%s]\n", label);
  printf("Location: %s\n", location);
  printf("Avatars: %s\n", avatars);
  printf("Items: %s\n", items);
}

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
    if (value >= min && value <= max) {
      return (int)value;
    }
    printf("Choose %d-%d.\n", min, max);
  }
}

static Ruby2Virtue strongest_virtue(const Ruby2State* state) {
  Ruby2Virtue top = RUBY2_VIRTUE_HEAD;
  for (uint8_t i = 1; i < RUBY2_VIRTUE_COUNT; ++i) {
    if (state->virtue_counts[i] > state->virtue_counts[top]) top = (Ruby2Virtue)i;
  }
  return top;
}

static Ruby2Discipline strongest_discipline(const Ruby2State* state) {
  Ruby2Discipline top = RUBY2_DISCIPLINE_SOURCE;
  for (uint8_t i = 1; i < RUBY2_DISCIPLINE_COUNT; ++i) {
    if (state->discipline_counts[i] > state->discipline_counts[top]) top = (Ruby2Discipline)i;
  }
  return top;
}

static const char* margin_item(Ruby2Discipline discipline) {
  switch (discipline) {
    case RUBY2_DISCIPLINE_SOURCE:
      return "work-order stamp";
    case RUBY2_DISCIPLINE_SENSE:
      return "circled word";
    case RUBY2_DISCIPLINE_SYNC:
      return "shared table notes";
    case RUBY2_DISCIPLINE_SIGNAL:
      return "printer lunch note";
    default:
      return "Notebook mark";
  }
}

static const char* margin_tone(Ruby2Virtue virtue) {
  switch (virtue) {
    case RUBY2_VIRTUE_HEAD:
      return "careful";
    case RUBY2_VIRTUE_HEART:
      return "steady";
    case RUBY2_VIRTUE_HUSTLE:
      return "quick";
    case RUBY2_VIRTUE_HONOR:
      return "honest";
    default:
      return "unfinished";
  }
}

static void margin_read(const Ruby2State* state) {
  Ruby2Discipline discipline = strongest_discipline(state);
  Ruby2Virtue virtue = strongest_virtue(state);
  printf(
    "Notebook margin: %u dot%s by the %s. Notes look %s. Stress %d.\n",
    (unsigned)state->clocks[RUBY2_CLOCK_NULL_SIGNAL].value,
    state->clocks[RUBY2_CLOCK_NULL_SIGNAL].value == 1 ? "" : "s",
    margin_item(discipline),
    margin_tone(virtue),
    state->clocks[RUBY2_CLOCK_STRESS].value
  );
}

static void speak(
  const Ruby2State* state,
  Ruby2CharacterId speaker,
  Ruby2RoomId room,
  Ruby2Discipline discipline,
  Ruby2Virtue virtue,
  const char* beat_id,
  const char* memory_context,
  const char* location_context,
  const char* items_context,
  const char* avatar_context,
  const char* situation,
  const char* outcome,
  const char* fallback,
  bool smooth_wake
) {
  char line[RUBY2_LLM_LINE_MAX];
  Ruby2PerformanceRequest request;
  (void)fallback;
  memset(&request, 0, sizeof(request));
  request.speaker = speaker;
  request.room = room;
  request.discipline = discipline;
  request.virtue = virtue;
  request.archetype = state->secondary_archetype;
  request.beat_id = beat_id;
  request.memory_context = memory_context;
  request.location_context = location_context;
  request.items_context = items_context;
  request.avatar_context = avatar_context;
  request.situation = situation;
  request.outcome = outcome;
  request.fallback = fallback;
  request.smooth_wake = smooth_wake;

  if (ruby2_llm_perform_line(&request, line, sizeof(line))) {
    printf("%s: \"%s\"\n", ruby2_character_name(speaker), line);
  } else {
    printf("World state: %s\n", outcome ? outcome : situation);
  }
}

static void build_performance_request(
  Ruby2PerformanceRequest* request,
  const Ruby2State* state,
  Ruby2CharacterId speaker,
  Ruby2RoomId room,
  Ruby2Discipline discipline,
  Ruby2Virtue virtue,
  const char* beat_id,
  const char* memory_context,
  const char* location_context,
  const char* items_context,
  const char* avatar_context,
  const char* situation,
  const char* outcome,
  const char* fallback,
  bool smooth_wake
) {
  memset(request, 0, sizeof(*request));
  request->speaker = speaker;
  request->room = room;
  request->discipline = discipline;
  request->virtue = virtue;
  request->archetype = state->secondary_archetype;
  request->beat_id = beat_id;
  request->memory_context = memory_context;
  request->location_context = location_context;
  request->items_context = items_context;
  request->avatar_context = avatar_context;
  request->situation = situation;
  request->outcome = outcome;
  request->fallback = fallback;
  request->smooth_wake = smooth_wake;
}

static void apply_approach(Ruby2State* state, const Ruby2ApproachOption* option) {
  Ruby2EffectPayload payload;
  ruby2_effect_payload_init(&payload);
  payload.discipline_deltas[option->discipline] = 1;
  payload.virtue_deltas[option->virtue] = 1;
  payload.affinity_deltas[option->witness] = 1;
  payload.reputation_tag = option->tag;
  payload.create_yearbook_candidate = true;
  payload.milestone_kind = RUBY2_MILESTONE_CLASS_REPORT;
  payload.candidate_id = option->candidate_id;
  payload.candidate_score = 9;

  if (option->discipline == RUBY2_DISCIPLINE_SIGNAL) {
    payload.clock_deltas[RUBY2_CLOCK_NULL_SIGNAL] = 1;
  }
  if (option->discipline == RUBY2_DISCIPLINE_SYNC) {
    payload.clock_deltas[RUBY2_CLOCK_STRESS] = -1;
  }

  ruby2_apply_effect_payload(state, &payload);
}

static void apply_social_choice(Ruby2State* state, uint8_t choice_index) {
  Ruby2EffectPayload payload;
  ruby2_effect_payload_init(&payload);

  if (choice_index == 0) {
    payload.discipline_deltas[RUBY2_DISCIPLINE_SOURCE] = 1;
    payload.virtue_deltas[RUBY2_VIRTUE_HONOR] = 1;
    payload.reputation_tag = RUBY2_ARCHETYPE_CONSCIENCE;
  } else if (choice_index == 1) {
    payload.discipline_deltas[RUBY2_DISCIPLINE_SYNC] = 1;
    payload.virtue_deltas[RUBY2_VIRTUE_HEART] = 1;
    payload.clock_deltas[RUBY2_CLOCK_STRESS] = -1;
    payload.reputation_tag = RUBY2_ARCHETYPE_CONNECTOR;
  } else {
    payload.discipline_deltas[RUBY2_DISCIPLINE_SIGNAL] = 1;
    payload.virtue_deltas[RUBY2_VIRTUE_HEAD] = 1;
    payload.clock_deltas[RUBY2_CLOCK_NULL_SIGNAL] = 1;
    payload.reputation_tag = RUBY2_ARCHETYPE_SIGNAL_READER;
  }

  ruby2_apply_effect_payload(state, &payload);
  (void)ruby2_resolve_archetypes(state);
}

static void build_social_pregen_requests(
  const Ruby2State* state,
  const Ruby2ApproachOption* option,
  const Ruby2SocialChoice* choices,
  Ruby2PerformanceRequest* requests,
  uint8_t count
) {
  for (uint8_t i = 0; i < count; ++i) {
    Ruby2State predicted = *state;
    apply_social_choice(&predicted, i);
    build_performance_request(
      &requests[i],
      &predicted,
      choices[i].speaker,
      RUBY2_ROOM_CAFETERIA,
      choices[i].discipline,
      choices[i].virtue,
      "vertical-cafeteria-choice-pregen",
      choices[i].memory,
      cafeteria_location(),
      option->cafeteria_items,
      option->cafeteria_avatars,
      choices[i].situation,
      choices[i].outcome,
      choices[i].fallback,
      false
    );
  }
}

static void social_followup(Ruby2State* state, const Ruby2ApproachOption* option, Ruby2LinePregen* pregen) {
  static const Ruby2SocialChoice choices[] = {
    {
      RUBY2_DISCIPLINE_SOURCE,
      RUBY2_VIRTUE_HONOR,
      RUBY2_CHARACTER_RUBY,
      RUBY2_ARCHETYPE_CONSCIENCE,
      "Bring the Lunch Tray to Ruby after lunch.",
      "event=social_choice; item=lunch_tray; target=Ruby",
      "memory=student_took_lunch_tray_to_teacher",
      "event=social_choice; item=lunch_tray; intent=adult_verification",
      "event=social_choice_resolved; item=lunch_tray; outcome=chain_of_custody",
      NULL
    },
    {
      RUBY2_DISCIPLINE_SYNC,
      RUBY2_VIRTUE_HEART,
      RUBY2_CHARACTER_LYRA,
      RUBY2_ARCHETYPE_CONNECTOR,
      "Ask who else got the same Lunch Tray.",
      "event=social_choice; item=lunch_tray; target=nearby_trays",
      "memory=three_lunch_trays_matched",
      "event=social_choice; item=lunch_tray; intent=shared_verification",
      "event=social_choice_resolved; item=lunch_tray; outcome=shared_check",
      NULL
    },
    {
      RUBY2_DISCIPLINE_SIGNAL,
      RUBY2_VIRTUE_HEAD,
      RUBY2_CHARACTER_NOOR,
      RUBY2_ARCHETYPE_SIGNAL_READER,
      "Copy the lunch note into the Notebook and leave the Lunch Tray on the tray.",
      "event=social_choice; item=lunch_tray; target=Notebook",
      "memory=lunch note_copied_exactly_from_lunch_tray",
      "event=social_choice; item=lunch_tray; intent=record_lunch note",
      "event=social_choice_resolved; item=lunch_tray; outcome=notebook_recorded_lunch note",
      NULL
    }
  };
  Ruby2PerformanceRequest pregen_requests[3];
  const uint8_t pregen_order[3] = {2, 0, 1};
  char pregen_line[RUBY2_LLM_LINE_MAX];

  memset(pregen, 0, sizeof(*pregen));

  puts("");
  puts("CAFETERIA FALLOUT");
  print_scene_panel(
    "CAFETERIA",
    cafeteria_location(),
    cafeteria_visible_avatars(option->witness),
    option->cafeteria_items
  );
  speak(
    state,
    option->witness,
    RUBY2_ROOM_CAFETERIA,
    option->discipline,
    option->virtue,
    "vertical-cafeteria-witness",
    option->cafeteria_memory,
    cafeteria_location(),
    option->cafeteria_items,
    option->cafeteria_avatars,
    "event=cafeteria_fallout; item=lunch_tray; source=tray",
    option->outcome,
    option->witness_fallback,
    true
  );

  puts("A Lunch Tray is on the tray.");
  puts("Under the header: PLEASE RETURN WHAT YOU BORROWED.");
  puts("How do you answer?");
  for (uint8_t i = 0; i < 3; ++i) {
    printf("%u. %s\n", (unsigned)(i + 1), choices[i].label);
  }

  build_social_pregen_requests(state, option, choices, pregen_requests, 3);
  (void)line_pregen_start(pregen, pregen_requests, 3, pregen_order);

  int choice = read_choice(1, 3);
  uint8_t choice_index = (uint8_t)(choice - 1);

  apply_social_choice(state, choice_index);
  puts(choices[choice_index].consequence);
  if (line_pregen_take_ready(pregen, choice_index, pregen_line, sizeof(pregen_line))) {
    printf("%s: \"%s\"\n", ruby2_character_name(choices[choice_index].speaker), pregen_line);
  } else {
    printf("World state: %s\n", choices[choice_index].outcome);
  }
  line_pregen_request_stop(pregen);
  margin_read(state);
}

static uint16_t yearbook_ritual(Ruby2State* state) {
  puts("");
  puts("YEARBOOK DRAFT");
  for (uint8_t i = 0; i < state->yearbook_candidate_count; ++i) {
    const Ruby2YearbookCandidate* candidate = &state->yearbook_candidates[i];
    printf(
      "%u. %s\n   %s\n   Signature: %s\n",
      (unsigned)(i + 1),
      ruby2_candidate_title(candidate->id),
      ruby2_candidate_blurb(candidate->id),
      ruby2_candidate_signer(candidate->id)
    );
  }
  int choice = read_choice(1, state->yearbook_candidate_count);
  Ruby2YearbookCandidate* sealed = &state->yearbook_candidates[choice - 1];
  sealed->status = RUBY2_CANDIDATE_SEALED;
  printf("You seal: %s.\n", ruby2_candidate_title(sealed->id));
  ruby2_archive_unsealed_candidates(state);
  return sealed->id;
}

int main(void) {
  static const Ruby2ApproachOption options[] = {
    {
      RUBY2_DISCIPLINE_SOURCE,
      RUBY2_VIRTUE_HONOR,
      RUBY2_CHARACTER_RAVI,
      6001,
      RUBY2_ARCHETYPE_CONSCIENCE,
      "Compare the answer card with the wet work-order stamp.",
      "compare the answer card with the wet work-order stamp",
      "The student checks the stamped work order before trusting the answer card.",
      "i remember the student choosing the wet stamp over the confident answer card.",
      "Answer card, wet work order, blue office stamp, your Notebook.",
      "Ravi is front row with one hand already up; i am keeping the work order visible.",
      "memory=stamped_work_order_callback_at_lunch",
      "Lunch tray, Lunch Tray, mural wall, your Notebook.",
      "cast=Ravi; item=lunch_tray; Ruby visible through office window.",
      NULL,
      NULL
    },
    {
      RUBY2_DISCIPLINE_SENSE,
      RUBY2_VIRTUE_HEAD,
      RUBY2_CHARACTER_INDRA,
      6002,
      RUBY2_ARCHETYPE_SCHOLAR,
      "Ask what original is supposed to mean.",
      "ask what the answer means by original",
      "The student catches the word original doing too much work.",
      "i remember the student stopping on original instead of chasing the whole answer.",
      "Answer card with original underlined, wet work order, your pencil, your Notebook.",
      "Indra watches the underlined word from the second row; i wait by the board.",
      "memory=word_original_callback_at_lunch",
      "Lunch tray, Lunch Tray, napkin with original copied once, your Notebook.",
      "cast=Indra,Noor; item=lunch_tray.",
      NULL,
      NULL
    },
    {
      RUBY2_DISCIPLINE_SIGNAL,
      RUBY2_VIRTUE_HONOR,
      RUBY2_CHARACTER_NOOR,
      6003,
      RUBY2_ARCHETYPE_SIGNAL_READER,
      "Circle the lunch note Ruby says she did not print.",
      "circle the lunch note Ruby says she did not print",
      "The student circles PLEASE RETURN WHAT YOU BORROWED on both cards.",
      "i remember the pencil circle around the lunch note i did not print.",
      "Answer card, wet work order, repeated lunch note, your pencil, your Notebook.",
      "Noor sits sideways at a desk; i hold the work order by one dry corner.",
      "memory=lunch note_callback_at_lunch",
      "Lunch tray, Lunch Tray, curled lunch note, your Notebook.",
      "cast=Noor,Lyra; item=lunch_tray.",
      NULL,
      NULL
    },
    {
      RUBY2_DISCIPLINE_SYNC,
      RUBY2_VIRTUE_HEART,
      RUBY2_CHARACTER_LYRA,
      6004,
      RUBY2_ARCHETYPE_CONNECTOR,
      "Ask Ravi and Lyra what each of them can verify.",
      "ask Ravi and Lyra what each of them can actually verify",
      "The student gets Ravi and Lyra looking at the same stamp before choosing.",
      "i remember the student pulling Ravi and Lyra back to the same stamp.",
      "Answer card, wet work order, shared desk, your Notebook.",
      "Ravi and Lyra are half-standing over the same desk; i point back to the board.",
      "memory=shared_stamp_check_callback_at_lunch",
      "Lunch tray, three matching Lunch Trays, Lyra's flashcards, your Notebook.",
      "cast=Lyra,Mika; items=three_lunch_trays.",
      NULL,
      NULL
    }
  };

  Ruby2State state;
  Ruby2LinePregen social_pregen;
  ruby2_state_init(&state);
  memset(&social_pregen, 0, sizeof(social_pregen));
  state.current_room_id = RUBY2_ROOM_HOMEROOM;
  state.current_time_block = RUBY2_TIME_PERIOD_1;

  puts("Ruby High 2.1 - local-model vertical slice");
  puts("===========================================");
  printf("Performance backend: %s (%s)\n", ruby2_llm_backend_name(), ruby2_llm_enabled() ? "enabled" : "disabled");
  printf("Performance model: %s\n", ruby2_llm_model_name());
  puts("AI can write speech-bubble lines. It cannot change state.");
  puts("");

  puts("Ruby: \"Today is not answer first. It is approach first.\"");
  print_scene_panel(
    "HOMEROOM",
    homeroom_location(),
    "Ruby at the board; Ravi front row; Lyra by the window; Noor turned sideways at her desk.",
    "Answer card, wet work order, repeated lunch note, your Notebook."
  );

  puts("Ruby tapes an answer card to the board:");
  puts("  The cafeteria mural is original to Ruby High, class of 1998.");
  puts("Then she holds up a wet work order:");
  puts("  Cafeteria mural repainted yesterday, 4:12 p.m.");
  puts("Both papers have the same lunch note:");
  puts("  PLEASE RETURN WHAT YOU BORROWED.");
  puts("Ruby says she did not print that line.");
  puts("What is the Ruby High move?");
  for (uint8_t i = 0; i < 4; ++i) {
    printf("%u. %s\n", (unsigned)(i + 1), options[i].label);
  }

  int choice = read_choice(1, 4);
  const Ruby2ApproachOption* picked = &options[choice - 1];
  apply_approach(&state, picked);
  (void)ruby2_resolve_archetypes(&state);

  puts("");
  printf("You %s.\n", picked->verb);
  speak(
    &state,
    RUBY2_CHARACTER_RUBY,
    RUBY2_ROOM_HOMEROOM,
    picked->discipline,
    picked->virtue,
    "vertical-approach-resolve",
    picked->homeroom_memory,
    homeroom_location(),
    picked->homeroom_items,
    picked->homeroom_avatars,
    "Ruby is looking at the lunch note, the wet stamp, and the student's pencil mark.",
    picked->outcome,
    picked->ruby_fallback,
    false
  );
  margin_read(&state);

  social_followup(&state, picked, &social_pregen);
  uint16_t sealed_id = yearbook_ritual(&state);
  line_pregen_stop_join(&social_pregen);

  puts("");
  puts("FINAL");
  if (state.dominant_archetype == RUBY2_ARCHETYPE_WILD_CARD &&
      state.secondary_archetype != RUBY2_ARCHETYPE_WILD_CARD) {
    printf("Ruby's read: Wild Card, leaning %s\n", ruby2_archetype_name(state.secondary_archetype));
  } else {
    printf("Ruby's read: %s\n", ruby2_archetype_name(state.dominant_archetype));
  }
  margin_read(&state);
  printf("Tomorrow hook: %s\n", ruby2_candidate_tomorrow_hook(sealed_id));
  return EXIT_SUCCESS;
}
