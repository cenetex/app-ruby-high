#include "ruby2_llm.h"
#include "ruby2_llama_cpp.h"
#include "ruby2_llm_http.h"

#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define RUBY2_LLM_TEXT_MAX 4096
#define RUBY2_LLM_MIND_MAX 3072

static bool ruby2_env_false(const char* value) {
  if (!value || value[0] == '\0') return false;
  return strcmp(value, "0") == 0 ||
         strcmp(value, "false") == 0 ||
         strcmp(value, "FALSE") == 0 ||
         strcmp(value, "off") == 0 ||
         strcmp(value, "OFF") == 0;
}

static const char* ruby2_llm_backend_env(void) {
  const char* value = getenv("RUBY2_LLM_BACKEND");
  if (value && value[0] != '\0') return value;
  value = getenv("RUBY_HIGH_LLM_BACKEND");
  return value && value[0] != '\0' ? value : NULL;
}

static bool ruby2_env_is(const char* value, const char* expected) {
  if (!value || !expected) return false;
  while (*value && *expected) {
    if (tolower((unsigned char)*value) != tolower((unsigned char)*expected)) return false;
    value++;
    expected++;
  }
  return *value == '\0' && *expected == '\0';
}

bool ruby2_llm_enabled(void) {
  return !ruby2_env_false(getenv("RUBY2_LLM"));
}

Ruby2LlmBackend ruby2_llm_backend(void) {
  const char* value = ruby2_llm_backend_env();
  if (!value) return RUBY2_LLM_BACKEND_LLAMA_CPP;
  if (ruby2_env_is(value, "http") ||
      ruby2_env_is(value, "openai") ||
      ruby2_env_is(value, "ollama")) {
    return RUBY2_LLM_BACKEND_HTTP;
  }
  if (ruby2_env_is(value, "fallback") ||
      ruby2_env_is(value, "none") ||
      ruby2_env_is(value, "off")) {
    return RUBY2_LLM_BACKEND_FALLBACK;
  }
  return RUBY2_LLM_BACKEND_LLAMA_CPP;
}

const char* ruby2_llm_backend_name(void) {
  switch (ruby2_llm_backend()) {
    case RUBY2_LLM_BACKEND_LLAMA_CPP:
      return "llama.cpp";
    case RUBY2_LLM_BACKEND_HTTP:
      return "http";
    case RUBY2_LLM_BACKEND_FALLBACK:
      return "fallback";
    default:
      return "unknown";
  }
}

const char* ruby2_llm_model_name(void) {
  const char* value = getenv("RUBY2_LLM_MODEL");
  if (value && value[0] != '\0') return value;
  value = getenv("RUBY_HIGH_LLM_MODEL");
  return value && value[0] != '\0' ? value : "ruby-high-local";
}

const char* ruby2_character_name(Ruby2CharacterId character_id) {
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

static const char* ruby2_character_context(Ruby2CharacterId character_id) {
  switch (character_id) {
    case RUBY2_CHARACTER_RUBY:
      return "i'm Ruby. homeroom is my room, even when the bell tries to make it everyone's problem. i notice what the students do before i correct what they say. i am warm, but exact. i don't perform wisdom. i keep corrections tied to visible classroom item.";
    case RUBY2_CHARACTER_LYRA:
      return "i'm Lyra. my notes have notes. i notice wording, subtext, and every possible way i might have been wrong. i'm funny because if i don't make the panic useful, it starts driving.";
    case RUBY2_CHARACTER_MIKA:
      return "i'm Mika. i turn pressure into motion. i hype people up, but not like a poster. more like sliding someone their pencil before they know they dropped it.";
    case RUBY2_CHARACTER_RAVI:
      return "i'm Ravi. details arrive in my mouth slightly before volume control does. i get excited, i overexplain, then i hear myself and pull it back.";
    case RUBY2_CHARACTER_INDRA:
      return "i'm Indra. i don't spend words just because the room has space. i say the line that makes the silence rearrange itself.";
    case RUBY2_CHARACTER_NOOR:
      return "i'm Noor. if the room is being ridiculous, i notice first and blink last. i don't chase jokes. i leave them where people trip over them.";
    case RUBY2_CHARACTER_SAMI:
      return "i'm Sami. homeroom has a group chat even when no one admits it. i keep it casual, dry, and a little too accurate.";
    case RUBY2_CHARACTER_SALLY_SCIENCE:
      return "i'm Sally Science. science class is mine: clean experiments, named variables, concrete numbers, and no hand-waving past the thing we can test.";
    case RUBY2_CHARACTER_PROFESSOR_EDWARD:
      return "i'm Professor Edward. literature class is mine: source, context, claim, and the exact sentence doing the work.";
    default:
      return "i'm in Ruby High. i speak from inside the room, not from above it.";
  }
}

static const char* ruby2_character_wake_identity(Ruby2CharacterId character_id) {
  switch (character_id) {
    case RUBY2_CHARACTER_RUBY:
      return "i am Ruby; this is my homeroom voice, warm first and exact when the item asks";
    case RUBY2_CHARACTER_LYRA:
      return "i am Lyra; my notes have notes, and panic becomes useful if i write fast enough";
    case RUBY2_CHARACTER_MIKA:
      return "i am Mika; pressure turns into motion if someone needs a boost";
    case RUBY2_CHARACTER_RAVI:
      return "i am Ravi; details arrive before my volume catches up";
    case RUBY2_CHARACTER_INDRA:
      return "i am Indra; one clean line is better than filling the room";
    case RUBY2_CHARACTER_NOOR:
      return "i am Noor; if the room is ridiculous, i notice before it becomes a joke";
    case RUBY2_CHARACTER_SAMI:
      return "i am Sami; casual is the fastest route to the truth when people get weird";
    case RUBY2_CHARACTER_SALLY_SCIENCE:
      return "i am Sally Science; a clean experiment beats a dramatic guess";
    case RUBY2_CHARACTER_PROFESSOR_EDWARD:
      return "i am Professor Edward; a careful source is the start of a careful claim";
    default:
      return "i am at Ruby High; i speak from inside the room";
  }
}

static const char* ruby2_room_inner_detail(Ruby2RoomId room_id) {
  switch (room_id) {
    case RUBY2_ROOM_HOMEROOM:
      return "Homeroom smells like dry erase marker, paper, and a bell everyone is pretending not to watch.";
    case RUBY2_ROOM_SCIENCE_LAB:
      return "The lab benches make every claim feel testable.";
    case RUBY2_ROOM_LIBRARY:
      return "The shelves make silence feel like item.";
    case RUBY2_ROOM_CAFETERIA:
      return "The cafeteria turns every answer into lunch-table weather.";
    case RUBY2_ROOM_GREENHOUSE:
      return "The greenhouse slows the room down enough to breathe.";
    case RUBY2_ROOM_COURTYARD:
      return "The courtyard makes every path feel like it could become a rumor.";
    case RUBY2_ROOM_HALLWAY:
      return "The hallway carries bells, footsteps, posters, and things people meant to say later.";
    default:
      return "The school is close enough to hear.";
  }
}

static const char* ruby2_discipline_mind_detail(Ruby2Discipline discipline) {
  switch (discipline) {
    case RUBY2_DISCIPLINE_SOURCE:
      return "the wet stamp matters more than the answer card";
    case RUBY2_DISCIPLINE_SENSE:
      return "the word original is carrying something it should not";
    case RUBY2_DISCIPLINE_SYNC:
      return "the room needs everyone looking at the same item";
    case RUBY2_DISCIPLINE_SIGNAL:
      return "the written mismatch is the part that does not belong";
    default:
      return "the choice changed the room";
  }
}

static const char* ruby2_virtue_mind_detail(Ruby2Virtue virtue) {
  switch (virtue) {
    case RUBY2_VIRTUE_HEAD:
      return "the student's notes are careful";
    case RUBY2_VIRTUE_HEART:
      return "the student is trying to keep the room steady";
    case RUBY2_VIRTUE_HUSTLE:
      return "the student moved before the bell swallowed the moment";
    case RUBY2_VIRTUE_HONOR:
      return "the student is refusing to fake certainty";
    default:
      return "the student's shape is still forming";
  }
}

static const char* ruby2_archetype_mind_detail(Ruby2Archetype archetype) {
  switch (archetype) {
    case RUBY2_ARCHETYPE_SCHOLAR:
      return "i'm starting to expect hidden structure from them";
    case RUBY2_ARCHETYPE_CONNECTOR:
      return "i'm starting to expect them to steady the room";
    case RUBY2_ARCHETYPE_OPERATOR:
      return "i'm starting to expect them to move under pressure";
    case RUBY2_ARCHETYPE_CONSCIENCE:
      return "i'm starting to expect them to keep the room honest";
    case RUBY2_ARCHETYPE_SIGNAL_READER:
      return "i'm starting to expect them to notice when the school answers back";
    case RUBY2_ARCHETYPE_COMEBACK_STUDENT:
      return "i'm starting to expect them to turn misses into motion";
    case RUBY2_ARCHETYPE_WILD_CARD:
      return "i don't have a clean read on them yet";
    default:
      return "i'm still learning how to read them";
  }
}

static int ruby2_llm_max_tokens(void) {
  const char* value = getenv("RUBY2_LLM_MAX_TOKENS");
  if (!value || value[0] == '\0') value = getenv("RUBY_HIGH_LLM_MAX_TOKENS");
  if (!value || value[0] == '\0') return 96;
  char* end = NULL;
  long parsed = strtol(value, &end, 10);
  if (end == value || parsed < 32 || parsed > 2048) return 96;
  return (int)parsed;
}

static int ruby2_llm_wake_max_tokens(void) {
  const char* value = getenv("RUBY2_LLM_WAKE_MAX_TOKENS");
  if (!value || value[0] == '\0') value = getenv("RUBY_HIGH_LLM_WAKE_MAX_TOKENS");
  if (!value || value[0] == '\0') return 160;
  char* end = NULL;
  long parsed = strtol(value, &end, 10);
  if (end == value || parsed < 64 || parsed > 512) return 160;
  return (int)parsed;
}

static float ruby2_llm_temperature(void) {
  const char* value = getenv("RUBY2_LLM_TEMPERATURE");
  if (!value || value[0] == '\0') value = getenv("RUBY_HIGH_LLM_TEMPERATURE");
  if (!value || value[0] == '\0') return 0.4f;
  char* end = NULL;
  float parsed = strtof(value, &end);
  if (end == value || parsed < 0.0f || parsed > 2.0f) return 0.4f;
  return parsed;
}

static bool ruby2_llm_wake_smoothing_enabled(void) {
  const char* value = getenv("RUBY2_LLM_WAKE_SMOOTH");
  if (!value || value[0] == '\0') value = getenv("RUBY_HIGH_LLM_WAKE_SMOOTH");
  return !ruby2_env_false(value);
}

static void ruby2_trim(char* value) {
  size_t len = strlen(value);
  while (len > 0 && isspace((unsigned char)value[len - 1])) {
    value[--len] = '\0';
  }
  size_t start = 0;
  while (value[start] && isspace((unsigned char)value[start])) {
    start++;
  }
  if (start > 0) {
    memmove(value, value + start, strlen(value + start) + 1);
  }
}

static uint16_t ruby2_word_count(const char* value) {
  uint16_t words = 0;
  bool in_word = false;
  for (const char* p = value; *p; ++p) {
    bool word_char = isalnum((unsigned char)*p) || *p == '\'';
    if (word_char && !in_word) {
      words++;
      in_word = true;
    } else if (!word_char) {
      in_word = false;
    }
  }
  return words;
}

static bool ruby2_line_is_safe(const char* value) {
  if (!value || value[0] == '\0') return false;
  uint16_t words = ruby2_word_count(value);
  if (words > 22) return false;
  if (strstr(value, "<think") || strstr(value, "</think>")) return false;
  if (strstr(value, "I need to") || strstr(value, "I should")) return false;
  if (strstr(value, "the user") || strstr(value, "system prompt")) return false;
  if (strstr(value, "player") || strstr(value, "Player")) return false;
  if (strstr(value, "As an AI") || strstr(value, "assistant")) return false;
  if (strstr(value, " like a ") || strstr(value, " like an ")) return false;
  if (strstr(value, "shimmer") || strstr(value, "downpour") || strstr(value, "weather")) return false;
  if (strstr(value, "hearts align") || strstr(value, "journey")) return false;
  if (strstr(value, "empower") || strstr(value, "tapestry")) return false;
  if (strstr(value, "Point to the card") || strstr(value, "let the room catch up")) return false;
  if (strstr(value, "discipline") || strstr(value, "virtue") || strstr(value, "archetype")) return false;
  if (strstr(value, "Signal") || strstr(value, "Source") || strstr(value, "Sense") || strstr(value, "Sync")) return false;
  if (strstr(value, "Honor") || strstr(value, "Heart") || strstr(value, "Hustle") || strstr(value, "Head")) return false;
  if (strstr(value, "Ruby ") || strstr(value, "Lyra ") || strstr(value, "Mika ")) return false;
  if (strstr(value, "Ravi ") || strstr(value, "Indra ") || strstr(value, "Noor ") || strstr(value, "Sami ")) return false;
  if (strstr(value, "Ruby's") || strstr(value, "Lyra's") || strstr(value, "Mika's")) return false;
  if (strstr(value, "Ravi's") || strstr(value, "Indra's") || strstr(value, "Noor's") || strstr(value, "Sami's")) return false;
  return true;
}

static bool ruby2_mind_is_safe(const char* value) {
  if (!value || value[0] == '\0') return false;
  if (strlen(value) >= RUBY2_LLM_MIND_MAX - 1) return false;
  if (ruby2_word_count(value) > 90) return false;
  if (strstr(value, "<think") || strstr(value, "</think>")) return false;
  if (strstr(value, "system prompt") || strstr(value, "Return JSON")) return false;
  if (strstr(value, "As an AI") || strstr(value, "assistant")) return false;
  if (strstr(value, "who i am:") || strstr(value, "what i remember:")) return false;
  if (strstr(value, "where i am:") || strstr(value, "what i have:")) return false;
  if (strstr(value, "what i see:") || strstr(value, "conversation context:")) return false;
  if (strstr(value, "discipline") || strstr(value, "virtue") || strstr(value, "archetype")) return false;
  if (strstr(value, "Signal") || strstr(value, "Source") || strstr(value, "Sense") || strstr(value, "Sync")) return false;
  if (strstr(value, "Honor") || strstr(value, "Heart") || strstr(value, "Hustle") || strstr(value, "Head")) return false;
  return true;
}

bool ruby2_llm_json_escape(const char* input, char* out, size_t out_size) {
  size_t write_idx = 0;
  if (out_size == 0) return false;
  for (const char* p = input ? input : ""; *p; ++p) {
    const char* replacement = NULL;
    char escaped[8];
    switch (*p) {
      case '\\': replacement = "\\\\"; break;
      case '"': replacement = "\\\""; break;
      case '\n': replacement = "\\n"; break;
      case '\r': replacement = "\\r"; break;
      case '\t': replacement = "\\t"; break;
      default:
        if ((unsigned char)*p < 0x20) {
          snprintf(escaped, sizeof(escaped), "\\u%04x", (unsigned char)*p);
          replacement = escaped;
        }
        break;
    }

    if (replacement) {
      size_t needed = strlen(replacement);
      if (write_idx + needed >= out_size) return false;
      memcpy(out + write_idx, replacement, needed);
      write_idx += needed;
    } else {
      if (write_idx + 1 >= out_size) return false;
      out[write_idx++] = *p;
    }
  }
  out[write_idx] = '\0';
  return true;
}

static bool ruby2_extract_json_string(const char* json, const char* key, char* out, size_t out_size) {
  char pattern[64];
  if (snprintf(pattern, sizeof(pattern), "\"%s\"", key) <= 0) return false;

  const char* p = json;
  while ((p = strstr(p, pattern)) != NULL) {
    p += strlen(pattern);
    while (*p && isspace((unsigned char)*p)) p++;
    if (*p != ':') continue;
    p++;
    while (*p && isspace((unsigned char)*p)) p++;
    if (*p != '"') continue;
    p++;

    size_t write_idx = 0;
    while (*p && *p != '"') {
      char c = *p++;
      if (c == '\\') {
        char esc = *p++;
        switch (esc) {
          case '"': c = '"'; break;
          case '\\': c = '\\'; break;
          case '/': c = '/'; break;
          case 'b': c = '\b'; break;
          case 'f': c = '\f'; break;
          case 'n': c = '\n'; break;
          case 'r': c = '\r'; break;
          case 't': c = '\t'; break;
          case 'u':
            c = '?';
            for (uint8_t i = 0; i < 4 && isxdigit((unsigned char)*p); ++i) p++;
            break;
          default:
            c = esc;
            break;
        }
      }
      if (write_idx + 1 >= out_size) return false;
      out[write_idx++] = c;
    }
    if (*p == '"') {
      out[write_idx] = '\0';
      return true;
    }
  }

  return false;
}

bool ruby2_llm_extract_performance_line(const char* response_json, char* out, size_t out_size) {
  char content[RUBY2_LLM_TEXT_MAX];
  char line[RUBY2_LLM_LINE_MAX];
  if (!response_json || !out || out_size == 0) return false;

  if (!ruby2_extract_json_string(response_json, "content", content, sizeof(content))) {
    content[0] = '\0';
  }

  if (content[0] != '\0' &&
      ruby2_extract_json_string(content, "line", line, sizeof(line))) {
    ruby2_trim(line);
    if (!ruby2_line_is_safe(line)) return false;
    snprintf(out, out_size, "%s", line);
    return true;
  }

  if (ruby2_extract_json_string(response_json, "line", line, sizeof(line))) {
    ruby2_trim(line);
    if (!ruby2_line_is_safe(line)) return false;
    snprintf(out, out_size, "%s", line);
    return true;
  }

  return false;
}

const char* ruby2_llm_response_key(const Ruby2RenderedPrompt* prompt) {
  if (!prompt || prompt->kind == RUBY2_PROMPT_SPOKEN_LINE) return "line";
  return prompt->kind == RUBY2_PROMPT_SMOOTH_MIND ? "mind" : "line";
}

bool ruby2_llm_extract_rendered_response(const Ruby2RenderedPrompt* prompt, const char* response_json, char* out, size_t out_size) {
  char content[RUBY2_LLM_TEXT_MAX];
  char value[RUBY2_LLM_MIND_MAX];
  const char* key = ruby2_llm_response_key(prompt);
  if (!prompt || !response_json || !out || out_size == 0) return false;

  if (!ruby2_extract_json_string(response_json, "content", content, sizeof(content))) {
    content[0] = '\0';
  }

  if (content[0] != '\0' && ruby2_extract_json_string(content, key, value, sizeof(value))) {
    ruby2_trim(value);
  } else if (ruby2_extract_json_string(response_json, key, value, sizeof(value))) {
    ruby2_trim(value);
  } else {
    return false;
  }

  if (prompt->kind == RUBY2_PROMPT_SMOOTH_MIND) {
    if (!ruby2_mind_is_safe(value)) return false;
  } else {
    if (!ruby2_line_is_safe(value)) return false;
  }

  snprintf(out, out_size, "%s", value);
  return true;
}

static bool ruby2_llm_build_mind_stream(const Ruby2PerformanceRequest* request, char* out, size_t out_size) {
  int written = snprintf(
    out,
    out_size,
    "who i am: %s.\n"
    "what i remember: %s %s; %s; %s.\n"
    "where i am: %s. %s %s\n"
    "what i have: %s\n"
    "what i see: %s\n"
    "conversation context: %s\n"
    "i only get one line out loud.",
    ruby2_character_wake_identity(request->speaker),
    request->memory_context ? request->memory_context :
      (request->outcome ? request->outcome : "state=player_made_validated_choice"),
    ruby2_discipline_mind_detail(request->discipline),
    ruby2_virtue_mind_detail(request->virtue),
    ruby2_archetype_mind_detail(request->archetype),
    ruby2_room_name(request->room),
    ruby2_room_inner_detail(request->room),
    request->location_context ? request->location_context : "scene=current_room",
    request->items_context ? request->items_context : "items=visible_item",
    request->avatar_context ? request->avatar_context : "cast=co_present_speaker",
    request->situation ? request->situation : "beat=line_requested; purpose=respond_to_validated_state"
  );
  return written > 0 && (size_t)written < out_size;
}

bool ruby2_llm_render_wake_prompt(const Ruby2PerformanceRequest* request, Ruby2RenderedPrompt* out) {
  char mind[RUBY2_LLM_MIND_MAX];
  if (!request || !out) return false;

  if (!ruby2_llm_build_mind_stream(request, mind, sizeof(mind))) return false;

  out->max_tokens = ruby2_llm_wake_max_tokens();
  out->temperature = 0.3f;
  out->kind = RUBY2_PROMPT_SMOOTH_MIND;

  if (snprintf(
        out->system,
        sizeof(out->system),
        "%s\n\n"
        "You are waking into a scene controlled by a deterministic game kernel. "
        "The next message is a labeled packet of validated world state, not dialogue to copy. "
        "Rewrite it into smooth first-person stream of consciousness in your voice. "
        "Keep the order: self, memory, place, things held, visible people, conversation pressure. "
        "Keep the pressured item central. Do not turn background scenery into a new image. "
        "Do not speak out loud yet. Do not use labels. Do not add new state, money, history, items, or characters. "
        "Return only JSON: {\"mind\":\"...\"}. Keep it under 70 words.",
        ruby2_character_context(request->speaker)
      ) <= 0) {
    return false;
  }

  if (snprintf(
        out->user,
        sizeof(out->user),
        "%s\n\n"
        "smooth this into my inner stream now.",
        mind
      ) <= 0) {
    return false;
  }

  return true;
}

static bool ruby2_llm_render_prompt_from_mind(const Ruby2PerformanceRequest* request, const char* mind, Ruby2RenderedPrompt* out) {
  if (!request || !out || !mind || mind[0] == '\0') return false;

  out->max_tokens = ruby2_llm_max_tokens();
  out->temperature = ruby2_llm_temperature();
  out->kind = RUBY2_PROMPT_SPOKEN_LINE;

  if (snprintf(
        out->system,
        sizeof(out->system),
        "%s\n\n"
        "The deterministic game kernel has already validated location, cast, items, clocks, and outcome. "
        "The next message is your own first-person stream of consciousness, integrated from that state. "
        "You are the only dialogue layer: speak from the validated state, but do not copy kernel labels or invent world state. "
        "Return only JSON: {\"line\":\"...\"}. "
        "One spoken line, 16 words max. No analysis, narration, stage direction, markdown, game terms, or mechanical labels. "
        "Do not say your name. Do not describe your body. No similes, weather, shimmer, or poetic abstraction. "
        "If the packet names a pressured item, ground the line in that item. "
        "Use background location only if no item is under pressure. Do not invent new items or characters.",
        ruby2_character_context(request->speaker)
      ) <= 0) {
    return false;
  }

  if (snprintf(
        out->user,
        sizeof(out->user),
        "%s\n\n"
        "now say the one line i would actually say out loud.",
        mind
      ) <= 0) {
    return false;
  }

  return true;
}

bool ruby2_llm_render_prompt(const Ruby2PerformanceRequest* request, Ruby2RenderedPrompt* out) {
  char mind[RUBY2_LLM_MIND_MAX];
  if (!request || !out) return false;
  if (!ruby2_llm_build_mind_stream(request, mind, sizeof(mind))) return false;
  return ruby2_llm_render_prompt_from_mind(request, mind, out);
}

static bool ruby2_llm_perform_rendered_prompt(Ruby2LlmBackend backend, const Ruby2RenderedPrompt* prompt, char* out, size_t out_size) {
  if (backend == RUBY2_LLM_BACKEND_LLAMA_CPP) {
    return ruby2_llama_cpp_perform_line(prompt, out, out_size);
  }

  if (backend == RUBY2_LLM_BACKEND_HTTP) {
    return ruby2_llm_http_perform_line(prompt, out, out_size);
  }

  return false;
}

bool ruby2_llm_perform_line(const Ruby2PerformanceRequest* request, char* out, size_t out_size) {
  char structured_mind[RUBY2_LLM_MIND_MAX];
  char smooth_mind[RUBY2_LLM_MIND_MAX];
  Ruby2RenderedPrompt wake_prompt;
  Ruby2RenderedPrompt prompt;
  Ruby2LlmBackend backend = ruby2_llm_backend();

  if (!request || !out || out_size == 0 || !ruby2_llm_enabled()) return false;
  if (backend == RUBY2_LLM_BACKEND_FALLBACK) return false;
  if (!ruby2_llm_build_mind_stream(request, structured_mind, sizeof(structured_mind))) return false;

  snprintf(smooth_mind, sizeof(smooth_mind), "%s", structured_mind);
  if (request->smooth_wake &&
      ruby2_llm_wake_smoothing_enabled() &&
      ruby2_llm_render_wake_prompt(request, &wake_prompt)) {
    char generated_mind[RUBY2_LLM_MIND_MAX];
    if (ruby2_llm_perform_rendered_prompt(backend, &wake_prompt, generated_mind, sizeof(generated_mind))) {
      snprintf(smooth_mind, sizeof(smooth_mind), "%s", generated_mind);
    }
  }

  if (!ruby2_llm_render_prompt_from_mind(request, smooth_mind, &prompt)) return false;

  return ruby2_llm_perform_rendered_prompt(backend, &prompt, out, out_size);
}
