#include "ruby2_native_text.h"

#include <stdbool.h>

bool ruby2_native_text_available(void) {
  return false;
}

int ruby2_native_text_width(const char* text, int size, bool bold) {
  int len = 0;
  (void)bold;
  if (!text) return 0;
  while (text[len]) len++;
  return len * (size > 0 ? size : 16) / 2;
}

int ruby2_native_text_line_height(int size) {
  return (size > 0 ? size : 16) + 4;
}

SDL_Texture* ruby2_native_text_texture(
  SDL_Renderer* renderer,
  const char* text,
  int size,
  SDL_Color color,
  bool bold
) {
  (void)renderer;
  (void)text;
  (void)size;
  (void)color;
  (void)bold;
  return NULL;
}
