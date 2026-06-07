#ifndef RUBY2_LLAMA_CPP_H
#define RUBY2_LLAMA_CPP_H

#include "ruby2_llm.h"

#include <stdbool.h>
#include <stddef.h>

bool ruby2_llama_cpp_available(void);
const char* ruby2_llama_cpp_model_path(void);
bool ruby2_llama_cpp_perform_line(const Ruby2RenderedPrompt* prompt, char* out, size_t out_size);

#endif
