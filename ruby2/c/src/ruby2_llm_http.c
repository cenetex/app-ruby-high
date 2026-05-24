#define _POSIX_C_SOURCE 200809L

#include "ruby2_llm_http.h"

#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define RUBY2_LLM_RESPONSE_MAX 16384
#define RUBY2_LLM_BODY_MAX 8192

static bool ruby2_safe_url_char(char c) {
  return isalnum((unsigned char)c) ||
         c == ':' || c == '/' || c == '.' || c == '-' || c == '_' ||
         c == '?' || c == '&' || c == '=' || c == '%' || c == '#';
}

static bool ruby2_safe_header_value_char(char c) {
  return isalnum((unsigned char)c) || c == '-' || c == '_' || c == '.' || c == ':';
}

static bool ruby2_is_safe_url(const char* value) {
  if (!value || value[0] == '\0') return false;
  for (const char* p = value; *p; ++p) {
    if (!ruby2_safe_url_char(*p)) return false;
  }
  return true;
}

static bool ruby2_is_safe_header_value(const char* value) {
  if (!value || value[0] == '\0') return false;
  for (const char* p = value; *p; ++p) {
    if (!ruby2_safe_header_value_char(*p)) return false;
  }
  return true;
}

static bool ruby2_ends_with(const char* value, const char* suffix) {
  size_t value_len = strlen(value);
  size_t suffix_len = strlen(suffix);
  if (suffix_len > value_len) return false;
  return strcmp(value + value_len - suffix_len, suffix) == 0;
}

static bool ruby2_llm_endpoint(char* out, size_t out_size) {
  const char* value = getenv("RUBY2_LLM_BASE_URL");
  if (!value || value[0] == '\0') value = getenv("RUBY_HIGH_LLM_BASE_URL");
  if (!value || value[0] == '\0') value = "http://127.0.0.1:11434/v1";
  if (!ruby2_is_safe_url(value)) return false;

  if (ruby2_ends_with(value, "/chat/completions")) {
    return snprintf(out, out_size, "%s", value) > 0;
  }
  if (ruby2_ends_with(value, "/v1")) {
    return snprintf(out, out_size, "%s/chat/completions", value) > 0;
  }
  if (ruby2_ends_with(value, "/")) {
    return snprintf(out, out_size, "%sv1/chat/completions", value) > 0;
  }
  return snprintf(out, out_size, "%s/v1/chat/completions", value) > 0;
}

static int ruby2_llm_timeout_seconds(void) {
  const char* value = getenv("RUBY2_LLM_TIMEOUT_SECONDS");
  if (!value || value[0] == '\0') value = getenv("RUBY_HIGH_LLM_TIMEOUT_SECONDS");
  if (!value || value[0] == '\0') return 25;
  char* end = NULL;
  long parsed = strtol(value, &end, 10);
  if (end == value || parsed < 1 || parsed > 120) return 25;
  return (int)parsed;
}

static bool ruby2_write_all(int fd, const char* data) {
  size_t len = strlen(data);
  size_t written = 0;
  while (written < len) {
    ssize_t result = write(fd, data + written, len - written);
    if (result <= 0) return false;
    written += (size_t)result;
  }
  return true;
}

static bool ruby2_build_request_body(const Ruby2RenderedPrompt* prompt, char* out, size_t out_size) {
  char model_json[256];
  char system_json[RUBY2_LLM_PROMPT_MAX];
  char user_json[RUBY2_LLM_PROMPT_MAX];
  int written;

  if (!ruby2_llm_json_escape(ruby2_llm_model_name(), model_json, sizeof(model_json))) return false;
  if (!ruby2_llm_json_escape(prompt->system, system_json, sizeof(system_json))) return false;
  if (!ruby2_llm_json_escape(prompt->user, user_json, sizeof(user_json))) return false;

  written = snprintf(
    out,
    out_size,
    "{\"model\":\"%s\",\"messages\":[{\"role\":\"system\",\"content\":\"%s\"},{\"role\":\"user\",\"content\":\"%s\"}],\"temperature\":%.2f,\"max_tokens\":%d,\"stream\":false,\"think\":false}",
    model_json,
    system_json,
    user_json,
    prompt->temperature,
    prompt->max_tokens
  );
  return written > 0 && (size_t)written < out_size;
}

bool ruby2_llm_http_perform_line(const Ruby2RenderedPrompt* prompt, char* out, size_t out_size) {
  char endpoint[512];
  char body[RUBY2_LLM_BODY_MAX];
  char response[RUBY2_LLM_RESPONSE_MAX];
  char tmp_template[256];
  char command[1024];
  const char* api_key = getenv("RUBY2_LLM_API_KEY");
  int timeout_seconds = ruby2_llm_timeout_seconds();
  FILE* pipe = NULL;
  size_t used = 0;

  if (!prompt || !out || out_size == 0) return false;
  if (!ruby2_llm_endpoint(endpoint, sizeof(endpoint))) return false;
  if (!ruby2_build_request_body(prompt, body, sizeof(body))) return false;

  if (snprintf(tmp_template, sizeof(tmp_template), "/tmp/ruby2_llm_XXXXXX") <= 0) return false;

  int fd = mkstemp(tmp_template);
  if (fd < 0) return false;
  bool wrote = ruby2_write_all(fd, body);
  close(fd);
  if (!wrote) {
    unlink(tmp_template);
    return false;
  }

  if (!api_key || api_key[0] == '\0') api_key = getenv("RUBY_HIGH_LLM_API_KEY");

  if (api_key && api_key[0] != '\0' && strcmp(api_key, "local") != 0 && ruby2_is_safe_header_value(api_key)) {
    snprintf(
      command,
      sizeof(command),
      "curl -sS --max-time %d -H 'Content-Type: application/json' -H 'Authorization: Bearer %s' -d @%s %s",
      timeout_seconds,
      api_key,
      tmp_template,
      endpoint
    );
  } else {
    snprintf(
      command,
      sizeof(command),
      "curl -sS --max-time %d -H 'Content-Type: application/json' -d @%s %s",
      timeout_seconds,
      tmp_template,
      endpoint
    );
  }

  strncat(command, " 2>/dev/null", sizeof(command) - strlen(command) - 1);

  pipe = popen(command, "r");
  if (!pipe) {
    unlink(tmp_template);
    return false;
  }

  while (!feof(pipe) && used + 1 < sizeof(response)) {
    size_t n = fread(response + used, 1, sizeof(response) - used - 1, pipe);
    used += n;
    if (n == 0) break;
  }
  response[used] = '\0';

  int status = pclose(pipe);
  unlink(tmp_template);
  if (status != 0 || used == 0) return false;

  return ruby2_llm_extract_rendered_response(prompt, response, out, out_size);
}
