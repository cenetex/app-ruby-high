#ifndef RUBY2_NATIVE_TEXT_H
#define RUBY2_NATIVE_TEXT_H

#include <SDL.h>

#include <stdbool.h>
#include <stdint.h>

bool ruby2_native_text_available(void);
int ruby2_native_text_width(const char* text, int size, bool bold);
int ruby2_native_text_line_height(int size);
SDL_Texture* ruby2_native_text_texture(
  SDL_Renderer* renderer,
  const char* text,
  int size,
  SDL_Color color,
  bool bold
);

#endif
