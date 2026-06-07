#include "ruby2_llama_cpp.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define RUBY2_LLAMA_PROMPT_TEXT_MAX 8192
#define RUBY2_LLAMA_OUTPUT_TEXT_MAX 2048
#define RUBY2_LLAMA_PIECE_MAX 256
#define RUBY2_LLAMA_PROMPT_TOKENS_MAX 4096
#define RUBY2_DEFAULT_LLAMA_MODEL "../models/google_gemma-4-E4B-it-Q4_K_M.gguf"

const char* ruby2_llama_cpp_model_path(void) {
  const char* value = getenv("RUBY2_LLAMA_MODEL");
  if (value && value[0] != '\0') return value;
  value = getenv("RUBY_HIGH_LLAMA_MODEL");
  if (value && value[0] != '\0') return value;
  return RUBY2_DEFAULT_LLAMA_MODEL;
}

#ifndef RUBY2_WITH_LLAMA_CPP

bool ruby2_llama_cpp_available(void) {
  return false;
}

bool ruby2_llama_cpp_perform_line(const Ruby2RenderedPrompt* prompt, char* out, size_t out_size) {
  (void)prompt;
  (void)out;
  (void)out_size;
  return false;
}

#else

#include <llama.h>

static struct llama_model* ruby2_llama_model = NULL;
static struct llama_context* ruby2_llama_ctx = NULL;
static struct llama_adapter_lora* ruby2_llama_lora = NULL;
static char ruby2_llama_loaded_model_path[1024];
static char ruby2_llama_loaded_lora_path[1024];
static bool ruby2_llama_backend_ready = false;
static int ruby2_llama_gpu_layers = 0;
static uint32_t ruby2_llama_context_tokens = 0;
static int ruby2_llama_threads = 0;
static ggml_backend_dev_t ruby2_llama_no_devices[] = { NULL };

static void ruby2_llama_log_silent(enum ggml_log_level level, const char* text, void* user_data) {
  (void)level;
  (void)text;
  (void)user_data;
}

static bool ruby2_llama_debug_enabled(void) {
  const char* value = getenv("RUBY2_LLM_DEBUG");
  return value && value[0] != '\0' && strcmp(value, "0") != 0;
}

static int ruby2_env_int(const char* primary, const char* secondary, int fallback, int min, int max) {
  const char* value = getenv(primary);
  if (!value || value[0] == '\0') value = getenv(secondary);
  if (!value || value[0] == '\0') return fallback;

  char* end = NULL;
  long parsed = strtol(value, &end, 10);
  if (end == value || parsed < min || parsed > max) return fallback;
  return (int)parsed;
}

static uint32_t ruby2_env_seed(void) {
  const char* value = getenv("RUBY2_LLAMA_SEED");
  if (!value || value[0] == '\0') value = getenv("RUBY_HIGH_LLAMA_SEED");
  if (!value || value[0] == '\0') return 0xC0DEC0DEu;

  char* end = NULL;
  unsigned long parsed = strtoul(value, &end, 10);
  if (end == value) return 0xC0DEC0DEu;
  return (uint32_t)parsed;
}

static const char* ruby2_llama_lora_path(void) {
  const char* value = getenv("RUBY2_LLAMA_LORA");
  if (value && value[0] != '\0') return value;
  value = getenv("RUBY_HIGH_LLAMA_LORA");
  return value && value[0] != '\0' ? value : NULL;
}

static void ruby2_llama_shutdown(void) {
  if (ruby2_llama_ctx) {
    llama_free(ruby2_llama_ctx);
    ruby2_llama_ctx = NULL;
  }
  if (ruby2_llama_lora) {
    llama_adapter_lora_free(ruby2_llama_lora);
    ruby2_llama_lora = NULL;
  }
  if (ruby2_llama_model) {
    llama_model_free(ruby2_llama_model);
    ruby2_llama_model = NULL;
  }
  if (ruby2_llama_backend_ready) {
    llama_backend_free();
    ruby2_llama_backend_ready = false;
  }
}

static bool ruby2_llama_ensure_backend(void) {
  if (ruby2_llama_backend_ready) return true;
  llama_log_set(ruby2_llama_log_silent, NULL);
  llama_backend_init();
  ruby2_llama_backend_ready = true;
  atexit(ruby2_llama_shutdown);
  return true;
}

static bool ruby2_llama_load_model(void) {
  const char* model_path = ruby2_llama_cpp_model_path();
  const char* lora_path = ruby2_llama_lora_path();

  if (!model_path || model_path[0] == '\0') return false;
  if (ruby2_llama_model && strcmp(model_path, ruby2_llama_loaded_model_path) == 0) {
    return true;
  }

  if (ruby2_llama_lora) {
    llama_adapter_lora_free(ruby2_llama_lora);
    ruby2_llama_lora = NULL;
    ruby2_llama_loaded_lora_path[0] = '\0';
  }
  if (ruby2_llama_model) {
    if (ruby2_llama_ctx) {
      llama_free(ruby2_llama_ctx);
      ruby2_llama_ctx = NULL;
    }
    llama_model_free(ruby2_llama_model);
    ruby2_llama_model = NULL;
    ruby2_llama_loaded_model_path[0] = '\0';
  }

  struct llama_model_params model_params = llama_model_default_params();
  ruby2_llama_gpu_layers = ruby2_env_int("RUBY2_LLAMA_GPU_LAYERS", "RUBY_HIGH_LLAMA_GPU_LAYERS", 0, -1, 999);
  model_params.n_gpu_layers = ruby2_llama_gpu_layers;
  if (ruby2_llama_gpu_layers == 0) {
    model_params.devices = ruby2_llama_no_devices;
  }

  ruby2_llama_model = llama_model_load_from_file(model_path, model_params);
  if (!ruby2_llama_model) return false;

  snprintf(ruby2_llama_loaded_model_path, sizeof(ruby2_llama_loaded_model_path), "%s", model_path);

  if (lora_path && lora_path[0] != '\0') {
    ruby2_llama_lora = llama_adapter_lora_init(ruby2_llama_model, lora_path);
    if (ruby2_llama_lora) {
      snprintf(ruby2_llama_loaded_lora_path, sizeof(ruby2_llama_loaded_lora_path), "%s", lora_path);
    }
  }

  return true;
}

static bool ruby2_llama_ensure_context(void) {
  uint32_t requested_context = (uint32_t)ruby2_env_int("RUBY2_LLAMA_CONTEXT", "RUBY_HIGH_LLAMA_CONTEXT", 1024, 512, 32768);
  int requested_threads = ruby2_env_int("RUBY2_LLAMA_THREADS", "RUBY_HIGH_LLAMA_THREADS", 8, 1, 128);

  if (ruby2_llama_ctx &&
      ruby2_llama_context_tokens == requested_context &&
      ruby2_llama_threads == requested_threads) {
    return true;
  }

  if (ruby2_llama_ctx) {
    llama_free(ruby2_llama_ctx);
    ruby2_llama_ctx = NULL;
  }

  struct llama_context_params ctx_params = llama_context_default_params();
  ctx_params.n_ctx = requested_context;
  ctx_params.n_batch = 512;
  ctx_params.n_threads = requested_threads;
  ctx_params.n_threads_batch = requested_threads;
  if (ruby2_llama_gpu_layers == 0) {
    ctx_params.offload_kqv = false;
    ctx_params.op_offload = false;
  }

  ruby2_llama_ctx = llama_init_from_model(ruby2_llama_model, ctx_params);
  if (!ruby2_llama_ctx) return false;

  if (ruby2_llama_lora) {
    struct llama_adapter_lora* adapters[1] = { ruby2_llama_lora };
    float scales[1] = { 1.0f };
    if (llama_set_adapters_lora(ruby2_llama_ctx, adapters, 1, scales) != 0) {
      llama_free(ruby2_llama_ctx);
      ruby2_llama_ctx = NULL;
      return false;
    }
  }

  ruby2_llama_context_tokens = requested_context;
  ruby2_llama_threads = requested_threads;
  return true;
}

static bool ruby2_llama_format_prompt(const Ruby2RenderedPrompt* prompt, char* out, size_t out_size) {
  const char* tmpl = llama_model_chat_template(ruby2_llama_model, NULL);
  llama_chat_message messages[2] = {
    { "system", prompt->system },
    { "user", prompt->user }
  };

  if (tmpl) {
    int32_t written = llama_chat_apply_template(tmpl, messages, 2, true, out, (int32_t)out_size);
    if (written > 0 && (size_t)written < out_size) return true;
  }

  int written = snprintf(
    out,
    out_size,
    "System:\n%s\n\nUser:\n%s\n\nAssistant:\n",
    prompt->system,
    prompt->user
  );
  return written > 0 && (size_t)written < out_size;
}

static bool ruby2_llama_tokenize_prompt(const struct llama_vocab* vocab, const char* text, llama_token* tokens, int32_t* token_count) {
  int32_t count = llama_tokenize(vocab, text, (int32_t)strlen(text), tokens, RUBY2_LLAMA_PROMPT_TOKENS_MAX, true, true);
  if (count < 0) {
    count = -count;
    if (count > RUBY2_LLAMA_PROMPT_TOKENS_MAX) return false;
    count = llama_tokenize(vocab, text, (int32_t)strlen(text), tokens, RUBY2_LLAMA_PROMPT_TOKENS_MAX, true, true);
  }
  if (count <= 0 || count > RUBY2_LLAMA_PROMPT_TOKENS_MAX) return false;
  *token_count = count;
  return true;
}

static bool ruby2_llama_append_piece(char* generated, size_t* used, const char* piece, int32_t piece_len) {
  if (piece_len <= 0) return true;
  if (*used + (size_t)piece_len >= RUBY2_LLAMA_OUTPUT_TEXT_MAX) return false;
  memcpy(generated + *used, piece, (size_t)piece_len);
  *used += (size_t)piece_len;
  generated[*used] = '\0';
  return true;
}

bool ruby2_llama_cpp_available(void) {
  const char* model_path = ruby2_llama_cpp_model_path();
  if (!model_path || model_path[0] == '\0') return false;
  FILE* file = fopen(model_path, "rb");
  if (!file) return false;
  fclose(file);
  return true;
}

bool ruby2_llama_cpp_perform_line(const Ruby2RenderedPrompt* prompt, char* out, size_t out_size) {
  char prompt_text[RUBY2_LLAMA_PROMPT_TEXT_MAX];
  char generated[RUBY2_LLAMA_OUTPUT_TEXT_MAX];
  char piece[RUBY2_LLAMA_PIECE_MAX];
  char response_pattern[32];
  llama_token prompt_tokens[RUBY2_LLAMA_PROMPT_TOKENS_MAX];
  int32_t prompt_token_count = 0;
  size_t generated_used = 0;
  bool ok = false;
  bool debug = ruby2_llama_debug_enabled();
  int64_t started_us = debug ? llama_time_us() : 0;
  const char* response_key = ruby2_llm_response_key(prompt);

  if (!prompt || !out || out_size == 0) return false;
  if (snprintf(response_pattern, sizeof(response_pattern), "\"%s\"", response_key) <= 0) return false;
  if (!ruby2_llama_ensure_backend()) return false;
  if (!ruby2_llama_load_model()) return false;
  if (!ruby2_llama_ensure_context()) return false;
  if (!ruby2_llama_format_prompt(prompt, prompt_text, sizeof(prompt_text))) return false;

  const struct llama_vocab* vocab = llama_model_get_vocab(ruby2_llama_model);
  if (!vocab) return false;
  if (!ruby2_llama_tokenize_prompt(vocab, prompt_text, prompt_tokens, &prompt_token_count)) return false;

  llama_memory_clear(llama_get_memory(ruby2_llama_ctx), true);

  struct llama_sampler_chain_params sampler_params = llama_sampler_chain_default_params();
  struct llama_sampler* sampler = llama_sampler_chain_init(sampler_params);
  if (!sampler) {
    return false;
  }

  if (prompt->temperature <= 0.0f) {
    llama_sampler_chain_add(sampler, llama_sampler_init_greedy());
  } else {
    llama_sampler_chain_add(sampler, llama_sampler_init_top_k(40));
    llama_sampler_chain_add(sampler, llama_sampler_init_top_p(0.90f, 1));
    llama_sampler_chain_add(sampler, llama_sampler_init_temp(prompt->temperature));
    llama_sampler_chain_add(sampler, llama_sampler_init_dist(ruby2_env_seed()));
  }

  struct llama_batch prompt_batch = llama_batch_get_one(prompt_tokens, prompt_token_count);
  if (llama_decode(ruby2_llama_ctx, prompt_batch) != 0) goto done;

  generated[0] = '\0';

  for (int i = 0; i < prompt->max_tokens && generated_used + 1 < sizeof(generated); ++i) {
    llama_token token = llama_sampler_sample(sampler, ruby2_llama_ctx, -1);
    if (llama_vocab_is_eog(vocab, token)) break;

    llama_sampler_accept(sampler, token);

    int32_t piece_len = llama_token_to_piece(vocab, token, piece, sizeof(piece), 0, false);
    if (piece_len < 0) {
      piece_len = -piece_len;
      if (piece_len >= (int32_t)sizeof(piece)) goto done;
      piece_len = llama_token_to_piece(vocab, token, piece, sizeof(piece), 0, false);
    }
    if (!ruby2_llama_append_piece(generated, &generated_used, piece, piece_len)) goto done;

    struct llama_batch next_batch = llama_batch_get_one(&token, 1);
    if (llama_decode(ruby2_llama_ctx, next_batch) != 0) goto done;

    if (strchr(generated, '}') != NULL && strstr(generated, response_pattern) != NULL) break;
  }

  ok = ruby2_llm_extract_rendered_response(prompt, generated, out, out_size);
  if (!ok && ruby2_llama_debug_enabled()) {
    fprintf(stderr, "\n[ruby2 llama.cpp raw]\n%s\n[/ruby2 llama.cpp raw]\n", generated);
  }

done:
  if (debug) {
    int64_t elapsed_us = llama_time_us() - started_us;
    fprintf(
      stderr,
      "[ruby2 llama.cpp] ok=%d prompt_tokens=%d generated_bytes=%zu elapsed_ms=%.1f threads=%d ctx=%u gpu_layers=%d\n",
      ok ? 1 : 0,
      prompt_token_count,
      generated_used,
      (double)elapsed_us / 1000.0,
      ruby2_llama_threads,
      ruby2_llama_context_tokens,
      ruby2_llama_gpu_layers
    );
  }
  llama_sampler_free(sampler);
  return ok;
}

#endif
