#define _POSIX_C_SOURCE 200809L

#include "ruby2_llm.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int failures = 0;

#define EXPECT_TRUE(expr) \
  do { \
    if (!(expr)) { \
      fprintf(stderr, "FAIL %s:%d: expected true: %s\n", __FILE__, __LINE__, #expr); \
      failures++; \
    } \
  } while (0)

#define EXPECT_FALSE(expr) \
  do { \
    if ((expr)) { \
      fprintf(stderr, "FAIL %s:%d: expected false: %s\n", __FILE__, __LINE__, #expr); \
      failures++; \
    } \
  } while (0)

#define EXPECT_STREQ(actual, expected) \
  do { \
    if (strcmp((actual), (expected)) != 0) { \
      fprintf(stderr, "FAIL %s:%d: expected \"%s\", got \"%s\"\n", __FILE__, __LINE__, (expected), (actual)); \
      failures++; \
    } \
  } while (0)

static void test_extracts_line_from_content_json(void) {
  char line[RUBY2_LLM_LINE_MAX];
  const char* response =
    "{\"choices\":[{\"message\":{\"content\":\"{\\\"line\\\":\\\"Confidence is not a citation.\\\"}\"}}]}";
  EXPECT_TRUE(ruby2_llm_extract_performance_line(response, line, sizeof(line)));
  EXPECT_STREQ(line, "Confidence is not a citation.");
}

static void test_extracts_line_after_hidden_reasoning(void) {
  char line[RUBY2_LLM_LINE_MAX];
  const char* response =
    "{\"choices\":[{\"message\":{\"content\":\"Okay, I should think this through.\\n{\\\"line\\\":\\\"Check the source before the room gets loud.\\\"}\"}}]}";
  EXPECT_TRUE(ruby2_llm_extract_performance_line(response, line, sizeof(line)));
  EXPECT_STREQ(line, "Check the source before the room gets loud.");
}

static void test_rejects_reasoning_without_line(void) {
  char line[RUBY2_LLM_LINE_MAX];
  const char* response =
    "{\"choices\":[{\"message\":{\"content\":\"Okay, the user picked Source. I need to respond warmly.\"}}]}";
  EXPECT_FALSE(ruby2_llm_extract_performance_line(response, line, sizeof(line)));
}

static void test_rejects_generic_inspirational_line(void) {
  char line[RUBY2_LLM_LINE_MAX];
  const char* response =
    "{\"choices\":[{\"message\":{\"content\":\"{\\\"line\\\":\\\"The room syncs and hearts align on the learning journey.\\\"}\"}}]}";
  EXPECT_FALSE(ruby2_llm_extract_performance_line(response, line, sizeof(line)));
}

static void test_rejects_stage_direction_line(void) {
  char line[RUBY2_LLM_LINE_MAX];
  const char* response =
    "{\"choices\":[{\"message\":{\"content\":\"{\\\"line\\\":\\\"Lyra's cards scream Sync as she points at the bell and explains the source.\\\"}\"}}]}";
  EXPECT_FALSE(ruby2_llm_extract_performance_line(response, line, sizeof(line)));
}

static void test_rejects_copied_prompt_phrase(void) {
  char line[RUBY2_LLM_LINE_MAX];
  const char* response =
    "{\"choices\":[{\"message\":{\"content\":\"{\\\"line\\\":\\\"Point to the card, the margin, the desk, and let the room catch up.\\\"}\"}}]}";
  EXPECT_FALSE(ruby2_llm_extract_performance_line(response, line, sizeof(line)));
}

static void test_backend_defaults_to_llama_cpp(void) {
  unsetenv("RUBY2_LLM_BACKEND");
  unsetenv("RUBY_HIGH_LLM_BACKEND");
  EXPECT_TRUE(ruby2_llm_backend() == RUBY2_LLM_BACKEND_LLAMA_CPP);
  EXPECT_STREQ(ruby2_llm_backend_name(), "llama.cpp");
}

static void test_backend_can_select_http(void) {
  setenv("RUBY2_LLM_BACKEND", "http", 1);
  EXPECT_TRUE(ruby2_llm_backend() == RUBY2_LLM_BACKEND_HTTP);
  EXPECT_STREQ(ruby2_llm_backend_name(), "http");
  unsetenv("RUBY2_LLM_BACKEND");
}

static void test_backend_can_select_fallback(void) {
  setenv("RUBY2_LLM_BACKEND", "fallback", 1);
  EXPECT_TRUE(ruby2_llm_backend() == RUBY2_LLM_BACKEND_FALLBACK);
  EXPECT_STREQ(ruby2_llm_backend_name(), "fallback");
  unsetenv("RUBY2_LLM_BACKEND");
}

static void test_render_prompt_hides_mechanical_labels(void) {
  Ruby2PerformanceRequest request = {
    .speaker = RUBY2_CHARACTER_RUBY,
    .room = RUBY2_ROOM_HOMEROOM,
    .discipline = RUBY2_DISCIPLINE_SIGNAL,
    .virtue = RUBY2_VIRTUE_HONOR,
    .archetype = RUBY2_ARCHETYPE_SIGNAL_READER,
    .beat_id = "vertical-approach-resolve",
    .memory_context = "i remember the pencil circle around the lunch note i did not print.",
    .location_context = "Homeroom, front board.",
    .items_context = "Answer card, wet work order, your Notebook.",
    .avatar_context = "Ruby stands at the board.",
    .situation = "A repeated phrase on the poster moved after the class answered.",
    .outcome = "The student noticed the impossible repetition and held it as item.",
    .fallback = NULL
  };
  Ruby2RenderedPrompt prompt;
  EXPECT_TRUE(ruby2_llm_render_prompt(&request, &prompt));
  EXPECT_TRUE(strstr(prompt.user, "Signal") == NULL);
  EXPECT_TRUE(strstr(prompt.user, "Honor") == NULL);
  EXPECT_TRUE(strstr(prompt.user, "Signal-Reader") == NULL);
  EXPECT_TRUE(strstr(prompt.user, "discipline") == NULL);
}

static void test_render_prompt_wakes_in_order(void) {
  Ruby2PerformanceRequest request = {
    .speaker = RUBY2_CHARACTER_NOOR,
    .room = RUBY2_ROOM_CAFETERIA,
    .discipline = RUBY2_DISCIPLINE_SIGNAL,
    .virtue = RUBY2_VIRTUE_HEAD,
    .archetype = RUBY2_ARCHETYPE_SIGNAL_READER,
    .beat_id = "vertical-cafeteria-witness",
    .memory_context = "i remember the new kid circling the lunch note before lunch.",
    .location_context = "Cafeteria, mural table.",
    .items_context = "items=lunch_tray,lunch_tray,Notebook",
    .avatar_context = "cast=Noor,Lyra; Noor focus=lunch_tray; Lyra focus=nearby trays",
    .situation = "event=item_used; item=lunch_tray; state=lunch_table_joined",
    .outcome = "event=social_triggered; item=lunch_tray",
    .fallback = NULL
  };
  Ruby2RenderedPrompt prompt;
  EXPECT_TRUE(ruby2_llm_render_wake_prompt(&request, &prompt));
  EXPECT_TRUE(prompt.kind == RUBY2_PROMPT_SMOOTH_MIND);
  EXPECT_STREQ(ruby2_llm_response_key(&prompt), "mind");

  const char* who = strstr(prompt.user, "who i am:");
  const char* memory = strstr(prompt.user, "what i remember:");
  const char* where = strstr(prompt.user, "where i am:");
  const char* have = strstr(prompt.user, "what i have:");
  const char* see = strstr(prompt.user, "what i see:");
  const char* conversation = strstr(prompt.user, "conversation context:");
  EXPECT_TRUE(who != NULL);
  EXPECT_TRUE(memory != NULL && memory > who);
  EXPECT_TRUE(where != NULL && where > memory);
  EXPECT_TRUE(have != NULL && have > where);
  EXPECT_TRUE(see != NULL && see > have);
  EXPECT_TRUE(conversation != NULL && conversation > see);
}

static void test_render_prompt_uses_line_contract(void) {
  Ruby2PerformanceRequest request = {
    .speaker = RUBY2_CHARACTER_RUBY,
    .room = RUBY2_ROOM_HOMEROOM,
    .discipline = RUBY2_DISCIPLINE_SOURCE,
    .virtue = RUBY2_VIRTUE_HONOR,
    .archetype = RUBY2_ARCHETYPE_CONSCIENCE,
    .beat_id = "vertical-approach-resolve",
    .memory_context = "i remember the student choosing the wet stamp over the answer card.",
    .location_context = "Homeroom, front board.",
    .items_context = "Answer card, wet work order, your Notebook.",
    .avatar_context = "Ravi is front row with one hand up.",
    .situation = "Ruby is looking at the lunch note, stamp, and pencil mark.",
    .outcome = "The student checked the stamped work order before trusting the card.",
    .fallback = NULL
  };
  Ruby2RenderedPrompt prompt;
  EXPECT_TRUE(ruby2_llm_render_prompt(&request, &prompt));
  EXPECT_TRUE(prompt.kind == RUBY2_PROMPT_SPOKEN_LINE);
  EXPECT_STREQ(ruby2_llm_response_key(&prompt), "line");
  EXPECT_TRUE(strstr(prompt.system, "deterministic game kernel") != NULL);
  EXPECT_TRUE(strstr(prompt.system, "only dialogue layer") != NULL);
}

static void test_extracts_smooth_mind(void) {
  Ruby2RenderedPrompt prompt;
  char mind[RUBY2_LLM_LINE_MAX];
  memset(&prompt, 0, sizeof(prompt));
  prompt.kind = RUBY2_PROMPT_SMOOTH_MIND;

  EXPECT_TRUE(ruby2_llm_extract_rendered_response(
    &prompt,
    "{\"mind\":\"I am Noor, Lunch Tray in view, watching the lunch table open.\"}",
    mind,
    sizeof(mind)
  ));
  EXPECT_STREQ(mind, "I am Noor, Lunch Tray in view, watching the lunch table open.");
}

static void test_rejects_labeled_smooth_mind(void) {
  Ruby2RenderedPrompt prompt;
  char mind[RUBY2_LLM_LINE_MAX];
  memset(&prompt, 0, sizeof(prompt));
  prompt.kind = RUBY2_PROMPT_SMOOTH_MIND;

  EXPECT_FALSE(ruby2_llm_extract_rendered_response(
    &prompt,
    "{\"mind\":\"who i am: i am Noor. what i remember: the Lunch Tray joined.\"}",
    mind,
    sizeof(mind)
  ));
}

int main(void) {
  test_extracts_line_from_content_json();
  test_extracts_line_after_hidden_reasoning();
  test_rejects_reasoning_without_line();
  test_rejects_generic_inspirational_line();
  test_rejects_stage_direction_line();
  test_rejects_copied_prompt_phrase();
  test_backend_defaults_to_llama_cpp();
  test_backend_can_select_http();
  test_backend_can_select_fallback();
  test_render_prompt_hides_mechanical_labels();
  test_render_prompt_wakes_in_order();
  test_render_prompt_uses_line_contract();
  test_extracts_smooth_mind();
  test_rejects_labeled_smooth_mind();

  if (failures != 0) {
    fprintf(stderr, "%d llm test failure(s)\n", failures);
    return 1;
  }

  puts("ruby2 llm tests passed");
  return 0;
}
