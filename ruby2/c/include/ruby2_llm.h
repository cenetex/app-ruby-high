#ifndef RUBY2_LLM_H
#define RUBY2_LLM_H

#include "ruby2_engine.h"

#include <stdbool.h>
#include <stddef.h>

#define RUBY2_LLM_LINE_MAX 240
#define RUBY2_LLM_PROMPT_MAX 4096

typedef enum {
  RUBY2_LLM_BACKEND_LLAMA_CPP,
  RUBY2_LLM_BACKEND_HTTP,
  RUBY2_LLM_BACKEND_FALLBACK
} Ruby2LlmBackend;

typedef enum {
  RUBY2_PROMPT_SPOKEN_LINE,
  RUBY2_PROMPT_SMOOTH_MIND
} Ruby2PromptKind;

typedef struct {
  char system[RUBY2_LLM_PROMPT_MAX];
  char user[RUBY2_LLM_PROMPT_MAX];
  int max_tokens;
  float temperature;
  Ruby2PromptKind kind;
} Ruby2RenderedPrompt;

typedef struct {
  Ruby2CharacterId speaker;
  Ruby2RoomId room;
  Ruby2Discipline discipline;
  Ruby2Virtue virtue;
  Ruby2Archetype archetype;
  const char* beat_id;
  const char* memory_context;
  const char* location_context;
  const char* items_context;
  const char* avatar_context;
  const char* situation;
  const char* outcome;
  const char* fallback;
  bool smooth_wake;
} Ruby2PerformanceRequest;

bool ruby2_llm_enabled(void);
Ruby2LlmBackend ruby2_llm_backend(void);
const char* ruby2_llm_backend_name(void);
const char* ruby2_llm_model_name(void);
const char* ruby2_character_name(Ruby2CharacterId character_id);
const char* ruby2_llm_response_key(const Ruby2RenderedPrompt* prompt);
bool ruby2_llm_render_wake_prompt(const Ruby2PerformanceRequest* request, Ruby2RenderedPrompt* out);
bool ruby2_llm_render_prompt(const Ruby2PerformanceRequest* request, Ruby2RenderedPrompt* out);
bool ruby2_llm_perform_line(const Ruby2PerformanceRequest* request, char* out, size_t out_size);
bool ruby2_llm_extract_rendered_response(const Ruby2RenderedPrompt* prompt, const char* response_json, char* out, size_t out_size);
bool ruby2_llm_extract_performance_line(const char* response_json, char* out, size_t out_size);
bool ruby2_llm_json_escape(const char* input, char* out, size_t out_size);

#endif
