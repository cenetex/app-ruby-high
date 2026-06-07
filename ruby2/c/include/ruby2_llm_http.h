#ifndef RUBY2_LLM_HTTP_H
#define RUBY2_LLM_HTTP_H

#include "ruby2_llm.h"

#include <stdbool.h>
#include <stddef.h>

bool ruby2_llm_http_perform_line(const Ruby2RenderedPrompt* prompt, char* out, size_t out_size);

#endif
