#include "ruby2_native_renderer.h"
#include "ruby2_native_text.h"

#include <SDL_test_font.h>

#include <limits.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define RUBY2_NATIVE_MAGENTA_R 255
#define RUBY2_NATIVE_MAGENTA_G 0
#define RUBY2_NATIVE_MAGENTA_B 255
#define RUBY2_NATIVE_TEXT_CACHE_CAP 256
#define RUBY2_NATIVE_FOCUS_TRANSITION_MS 160
#define RUBY2_NATIVE_RESULT_FADE_MS 220

typedef struct {
  SDL_Texture* hallway_bg;
  SDL_Texture* homeroom_bg;
  SDL_Texture* cafeteria_bg;
  SDL_Texture* science_lab_bg;
  SDL_Texture* library_bg;
  SDL_Texture* greenhouse_bg;
  SDL_Texture* courtyard_bg;
  SDL_Texture* characters[RUBY2_CHARACTER_COUNT];
  SDL_Texture* items[RUBY2_ITEM_COUNT];
} Ruby2NativeAssets;

typedef struct {
  char text[512];
  int size;
  bool bold;
  SDL_Color color;
  SDL_Texture* texture;
  int width;
  int height;
  uint32_t used_at;
} Ruby2NativeTextCacheEntry;

typedef struct {
  Ruby2NativeTextCacheEntry entries[RUBY2_NATIVE_TEXT_CACHE_CAP];
  uint32_t clock;
} Ruby2NativeTextCache;

struct Ruby2NativeRenderer {
  Ruby2NativeAssets assets;
  Ruby2NativeTextCache text_cache;
};

typedef struct {
  SDL_Rect title;
  SDL_Rect exploration_prompt;
  SDL_Rect speaker;
  SDL_Rect witnesses[2];
  SDL_Rect focus_speech;
  SDL_Rect focus_black_frame;
  SDL_Rect focus_black_surface;
  SDL_Rect focus_next_button;
  SDL_Rect focus_back_button;
  SDL_Rect inventory_slots[RUBY2_UI_MAX_ITEM_SLOTS];
  SDL_Rect reaction_bubbles[RUBY2_UI_MAX_REACTION_BUBBLES];
  SDL_Rect notebook;
  SDL_Rect navigation;
  SDL_Rect navigation_slots[RUBY2_UI_MAX_NAVIGATION_SLOTS];
  SDL_Rect action_slots[RUBY2_UI_MAX_ACTION_SLOTS];
  SDL_Rect result_toast;
} Ruby2NativeLayout;

static SDL_Rect rect_xywh(int x, int y, int w, int h) {
  SDL_Rect rect;
  rect.x = x;
  rect.y = y;
  rect.w = w;
  rect.h = h;
  return rect;
}

static bool rect_contains(SDL_Rect rect, int x, int y) {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

static SDL_Color rgb(uint8_t r, uint8_t g, uint8_t b) {
  SDL_Color color;
  color.r = r;
  color.g = g;
  color.b = b;
  color.a = 255;
  return color;
}

static SDL_Color rgba(uint8_t r, uint8_t g, uint8_t b, uint8_t a) {
  SDL_Color color;
  color.r = r;
  color.g = g;
  color.b = b;
  color.a = a;
  return color;
}

static bool color_eq(SDL_Color a, SDL_Color b) {
  return a.r == b.r && a.g == b.g && a.b == b.b && a.a == b.a;
}

static SDL_Color color_scale(SDL_Color color, float factor) {
  int r = (int)((float)color.r * factor);
  int g = (int)((float)color.g * factor);
  int b = (int)((float)color.b * factor);
  if (r > 255) r = 255;
  if (g > 255) g = 255;
  if (b > 255) b = 255;
  color.r = (uint8_t)r;
  color.g = (uint8_t)g;
  color.b = (uint8_t)b;
  return color;
}

static void text_cache_init(Ruby2NativeTextCache* cache) {
  if (!cache) return;
  memset(cache, 0, sizeof(*cache));
}

static void text_cache_destroy(Ruby2NativeTextCache* cache) {
  if (!cache) return;
  for (uint16_t i = 0; i < RUBY2_NATIVE_TEXT_CACHE_CAP; ++i) {
    SDL_DestroyTexture(cache->entries[i].texture);
  }
  memset(cache, 0, sizeof(*cache));
}

static SDL_Texture* text_cache_get(
  Ruby2NativeTextCache* cache,
  SDL_Renderer* renderer,
  const char* text,
  int size,
  SDL_Color color,
  bool bold,
  int* out_w,
  int* out_h
) {
  Ruby2NativeTextCacheEntry* slot = NULL;
  uint32_t oldest = UINT_MAX;
  const char* key = text ? text : "";

  if (!cache || !renderer || key[0] == '\0') return NULL;
  cache->clock++;

  for (uint16_t i = 0; i < RUBY2_NATIVE_TEXT_CACHE_CAP; ++i) {
    Ruby2NativeTextCacheEntry* entry = &cache->entries[i];
    if (entry->texture &&
        entry->size == size &&
        entry->bold == bold &&
        color_eq(entry->color, color) &&
        strcmp(entry->text, key) == 0) {
      entry->used_at = cache->clock;
      if (out_w) *out_w = entry->width;
      if (out_h) *out_h = entry->height;
      return entry->texture;
    }
    if (!entry->texture) {
      slot = entry;
      break;
    }
    if (entry->used_at < oldest) {
      oldest = entry->used_at;
      slot = entry;
    }
  }

  if (!slot) return NULL;
  SDL_DestroyTexture(slot->texture);
  memset(slot, 0, sizeof(*slot));
  slot->texture = ruby2_native_text_texture(renderer, key, size, color, bold);
  if (!slot->texture) return NULL;
  (void)snprintf(slot->text, sizeof(slot->text), "%s", key);
  slot->size = size;
  slot->bold = bold;
  slot->color = color;
  slot->used_at = cache->clock;
  if (SDL_QueryTexture(slot->texture, NULL, NULL, &slot->width, &slot->height) != 0) {
    slot->width = 0;
    slot->height = 0;
  }
  if (out_w) *out_w = slot->width;
  if (out_h) *out_h = slot->height;
  return slot->texture;
}

static void set_color(SDL_Renderer* renderer, SDL_Color color) {
  SDL_SetRenderDrawColor(renderer, color.r, color.g, color.b, color.a);
}

static void fill_rect(SDL_Renderer* renderer, int x, int y, int w, int h, SDL_Color color) {
  SDL_Rect rect = rect_xywh(x, y, w, h);
  set_color(renderer, color);
  SDL_RenderFillRect(renderer, &rect);
}

static void stroke_rect(SDL_Renderer* renderer, int x, int y, int w, int h, SDL_Color color) {
  SDL_Rect rect = rect_xywh(x, y, w, h);
  set_color(renderer, color);
  SDL_RenderDrawRect(renderer, &rect);
}

static void fill_circle(SDL_Renderer* renderer, int cx, int cy, int radius, SDL_Color color) {
  if (radius <= 0) return;
  set_color(renderer, color);
  for (int y = -radius; y <= radius; ++y) {
    for (int x = -radius; x <= radius; ++x) {
      if (x * x + y * y <= radius * radius) {
        SDL_RenderDrawPoint(renderer, cx + x, cy + y);
      }
    }
  }
}

static void stroke_circle(SDL_Renderer* renderer, int cx, int cy, int radius, SDL_Color color) {
  if (radius <= 0) return;
  set_color(renderer, color);
  for (int y = -radius; y <= radius; ++y) {
    for (int x = -radius; x <= radius; ++x) {
      int d = x * x + y * y;
      if (d <= radius * radius && d >= (radius - 1) * (radius - 1)) {
        SDL_RenderDrawPoint(renderer, cx + x, cy + y);
      }
    }
  }
}

static void stroke_circle_thick(SDL_Renderer* renderer, int cx, int cy, int radius, int thickness, SDL_Color color) {
  for (int i = 0; i < thickness; ++i) {
    stroke_circle(renderer, cx, cy, radius + i, color);
  }
}

static void stroke_round_rect(SDL_Renderer* renderer, int x, int y, int w, int h, int radius, SDL_Color color) {
  if (radius <= 0 || radius * 2 > w || radius * 2 > h) {
    stroke_rect(renderer, x, y, w, h, color);
    return;
  }

  set_color(renderer, color);
  SDL_RenderDrawLine(renderer, x + radius, y, x + w - radius - 1, y);
  SDL_RenderDrawLine(renderer, x + radius, y + h - 1, x + w - radius - 1, y + h - 1);
  SDL_RenderDrawLine(renderer, x, y + radius, x, y + h - radius - 1);
  SDL_RenderDrawLine(renderer, x + w - 1, y + radius, x + w - 1, y + h - radius - 1);
  for (int yy = 0; yy <= radius; ++yy) {
    int dx = (int)sqrt((double)(radius * radius - yy * yy));
    SDL_RenderDrawPoint(renderer, x + radius - dx, y + radius - yy);
    SDL_RenderDrawPoint(renderer, x + w - radius + dx - 1, y + radius - yy);
    SDL_RenderDrawPoint(renderer, x + radius - dx, y + h - radius + yy - 1);
    SDL_RenderDrawPoint(renderer, x + w - radius + dx - 1, y + h - radius + yy - 1);
  }
}

static void stroke_round_rect_thick(
  SDL_Renderer* renderer,
  SDL_Rect rect,
  int radius,
  int thickness,
  SDL_Color color
) {
  for (int i = 0; i < thickness; ++i) {
    stroke_round_rect(
      renderer,
      rect.x + i,
      rect.y + i,
      rect.w - i * 2,
      rect.h - i * 2,
      radius > i ? radius - i : 1,
      color
    );
  }
}

static void fill_round_rect(SDL_Renderer* renderer, int x, int y, int w, int h, int radius, SDL_Color color) {
  if (radius <= 0 || radius * 2 > w || radius * 2 > h) {
    fill_rect(renderer, x, y, w, h, color);
    return;
  }

  set_color(renderer, color);
  for (int yy = 0; yy < h; ++yy) {
    int inset = 0;
    if (yy < radius) {
      double dy = (double)(radius - yy - 1);
      inset = radius - (int)sqrt((double)(radius * radius) - dy * dy);
    } else if (yy >= h - radius) {
      double dy = (double)(yy - (h - radius));
      inset = radius - (int)sqrt((double)(radius * radius) - dy * dy);
    }
    SDL_RenderDrawLine(renderer, x + inset, y + yy, x + w - inset - 1, y + yy);
  }
}

static void panel(SDL_Renderer* renderer, SDL_Rect rect, int radius, SDL_Color fill, SDL_Color outline) {
  fill_round_rect(renderer, rect.x, rect.y, rect.w, rect.h, radius, fill);
  stroke_rect(renderer, rect.x, rect.y, rect.w, rect.h, outline);
}

static int font_size_for_scale(int scale) {
  switch (scale) {
    case 1:
      return 14;
    case 2:
      return 18;
    case 3:
      return 28;
    case 4:
      return 38;
    default:
      return scale > 4 ? 38 + (scale - 4) * 4 : 14;
  }
}

static void draw_text(
  Ruby2NativeRenderer* renderer_state,
  SDL_Renderer* renderer,
  int x,
  int y,
  const char* text,
  SDL_Color color,
  int scale
) {
  float old_x = 1.0f;
  float old_y = 1.0f;
  SDL_Texture* texture;
  SDL_Rect dest = rect_xywh(x, y, 0, 0);
  int font_size = font_size_for_scale(scale);
  bool bold = scale >= 3;
  if (!text) return;

  texture = text_cache_get(&renderer_state->text_cache, renderer, text, font_size, color, bold, &dest.w, &dest.h);
  if (texture) {
    SDL_RenderCopy(renderer, texture, NULL, &dest);
    return;
  }

  SDL_RenderGetScale(renderer, &old_x, &old_y);
  set_color(renderer, color);
  SDL_RenderSetScale(renderer, (float)scale, (float)scale);
  (void)SDLTest_DrawString(renderer, x / scale, y / scale, text);
  SDL_RenderSetScale(renderer, old_x, old_y);
}

static void draw_wrapped(
  Ruby2NativeRenderer* renderer_state,
  SDL_Renderer* renderer,
  int x,
  int y,
  int max_w,
  const char* text,
  SDL_Color color,
  int scale,
  int max_lines
) {
  const char* cursor = text ? text : "";
  char line[512];
  int line_count = 0;
  int font_size = font_size_for_scale(scale);
  int line_height = ruby2_native_text_line_height(font_size) + 2;

  while (*cursor && line_count < max_lines) {
    int line_len = 0;
    line[0] = '\0';

    while (*cursor == ' ') cursor++;
    while (*cursor && line_len < (int)sizeof(line) - 1) {
      const char* word = cursor;
      int word_len = 0;
      int candidate_len;
      char candidate[512];
      while (word[word_len] && word[word_len] != ' ') word_len++;

      if (word_len == 0) break;
      candidate_len = line_len + (line_len > 0 ? 1 : 0) + word_len;
      if (candidate_len >= (int)sizeof(candidate)) break;
      candidate[0] = '\0';
      if (line_len > 0) {
        memcpy(candidate, line, (size_t)line_len);
        candidate[line_len] = ' ';
        memcpy(candidate + line_len + 1, word, (size_t)word_len);
      } else {
        memcpy(candidate, word, (size_t)word_len);
      }
      candidate[candidate_len] = '\0';

      if (line_len > 0 && ruby2_native_text_width(candidate, font_size, scale >= 3) > max_w) break;
      if (line_len == 0 && ruby2_native_text_width(candidate, font_size, scale >= 3) > max_w) {
        while (word_len > 1) {
          word_len--;
          memcpy(candidate, word, (size_t)word_len);
          candidate[word_len] = '\0';
          if (ruby2_native_text_width(candidate, font_size, scale >= 3) <= max_w) break;
        }
      }

      if (line_len > 0) line[line_len++] = ' ';
      memcpy(line + line_len, word, (size_t)word_len);
      line_len += word_len;
      line[line_len] = '\0';
      cursor = word + word_len;
      while (*cursor == ' ') cursor++;
    }

    if (line_len == 0) break;
    draw_text(renderer_state, renderer, x, y + line_count * line_height, line, color, scale);
    line_count++;
  }
}

static SDL_Texture* load_bmp_texture(SDL_Renderer* renderer, const char* name, bool keyed) {
  const char* prefixes[] = {
    "native-assets/",
    "ruby2/c/native-assets/",
    NULL
  };

  {
    char* base_path = SDL_GetBasePath();
    if (base_path) {
      char path[1024];
      SDL_Surface* surface;
      SDL_Texture* texture;
      (void)snprintf(path, sizeof(path), "%s../Resources/native-assets/%s", base_path, name);
      surface = SDL_LoadBMP(path);
      SDL_free(base_path);
      if (surface) {
        if (keyed) {
          Uint32 key = SDL_MapRGB(surface->format, RUBY2_NATIVE_MAGENTA_R, RUBY2_NATIVE_MAGENTA_G, RUBY2_NATIVE_MAGENTA_B);
          SDL_SetColorKey(surface, SDL_TRUE, key);
        }
        texture = SDL_CreateTextureFromSurface(renderer, surface);
        SDL_FreeSurface(surface);
        if (texture) {
          SDL_SetTextureBlendMode(texture, SDL_BLENDMODE_BLEND);
          return texture;
        }
      }
    }
  }

  for (uint8_t i = 0; prefixes[i]; ++i) {
    char path[512];
    SDL_Surface* surface;
    SDL_Texture* texture;
    (void)snprintf(path, sizeof(path), "%s%s", prefixes[i], name);
    surface = SDL_LoadBMP(path);
    if (!surface) continue;
    if (keyed) {
      Uint32 key = SDL_MapRGB(surface->format, RUBY2_NATIVE_MAGENTA_R, RUBY2_NATIVE_MAGENTA_G, RUBY2_NATIVE_MAGENTA_B);
      SDL_SetColorKey(surface, SDL_TRUE, key);
    }
    texture = SDL_CreateTextureFromSurface(renderer, surface);
    SDL_FreeSurface(surface);
    if (texture) {
      SDL_SetTextureBlendMode(texture, SDL_BLENDMODE_BLEND);
      return texture;
    }
  }

  return NULL;
}

static void load_assets(SDL_Renderer* renderer, Ruby2NativeAssets* assets) {
  memset(assets, 0, sizeof(*assets));
  assets->hallway_bg = load_bmp_texture(renderer, "location-hallway.bmp", false);
  assets->homeroom_bg = load_bmp_texture(renderer, "location-homeroom.bmp", false);
  assets->cafeteria_bg = load_bmp_texture(renderer, "location-cafeteria.bmp", false);
  assets->science_lab_bg = load_bmp_texture(renderer, "location-science-lab.bmp", false);
  assets->library_bg = load_bmp_texture(renderer, "location-library.bmp", false);
  assets->greenhouse_bg = load_bmp_texture(renderer, "location-greenhouse.bmp", false);
  assets->courtyard_bg = load_bmp_texture(renderer, "location-courtyard.bmp", false);
  assets->characters[RUBY2_CHARACTER_RUBY] = load_bmp_texture(renderer, "ruby.bmp", true);
  assets->characters[RUBY2_CHARACTER_LYRA] = load_bmp_texture(renderer, "lyra.bmp", true);
  assets->characters[RUBY2_CHARACTER_MIKA] = load_bmp_texture(renderer, "mika.bmp", true);
  assets->characters[RUBY2_CHARACTER_RAVI] = load_bmp_texture(renderer, "ravi.bmp", true);
  assets->characters[RUBY2_CHARACTER_INDRA] = load_bmp_texture(renderer, "indra.bmp", true);
  assets->characters[RUBY2_CHARACTER_NOOR] = load_bmp_texture(renderer, "noor.bmp", true);
  assets->characters[RUBY2_CHARACTER_SAMI] = load_bmp_texture(renderer, "sami.bmp", true);
  assets->characters[RUBY2_CHARACTER_SALLY_SCIENCE] = load_bmp_texture(renderer, "sally-science.bmp", true);
  assets->characters[RUBY2_CHARACTER_PROFESSOR_EDWARD] = load_bmp_texture(renderer, "professor-edward.bmp", true);
  assets->items[RUBY2_ITEM_NOTEBOOK] = load_bmp_texture(renderer, "item-notebook.bmp", false);
  assets->items[RUBY2_ITEM_FLASHCARDS] = load_bmp_texture(renderer, "item-flashcards.bmp", false);
  assets->items[RUBY2_ITEM_OFFICE_PASS] = load_bmp_texture(renderer, "item-office-pass.bmp", false);
  assets->items[RUBY2_ITEM_LIBRARY_CARD] = load_bmp_texture(renderer, "item-library-card.bmp", false);
  assets->items[RUBY2_ITEM_LAB_FLASK] = load_bmp_texture(renderer, "item-lab-flask.bmp", false);
  assets->items[RUBY2_ITEM_LUNCH_TRAY] = load_bmp_texture(renderer, "item-lunch-tray.bmp", false);
}

static void destroy_assets(Ruby2NativeAssets* assets) {
  if (!assets) return;
  SDL_DestroyTexture(assets->hallway_bg);
  SDL_DestroyTexture(assets->homeroom_bg);
  SDL_DestroyTexture(assets->cafeteria_bg);
  SDL_DestroyTexture(assets->science_lab_bg);
  SDL_DestroyTexture(assets->library_bg);
  SDL_DestroyTexture(assets->greenhouse_bg);
  SDL_DestroyTexture(assets->courtyard_bg);
  for (uint8_t i = 0; i < RUBY2_CHARACTER_COUNT; ++i) {
    SDL_DestroyTexture(assets->characters[i]);
  }
  for (uint8_t i = 0; i < RUBY2_ITEM_COUNT; ++i) {
    SDL_DestroyTexture(assets->items[i]);
  }
  memset(assets, 0, sizeof(*assets));
}

static void draw_texture_fit(
  SDL_Renderer* renderer,
  SDL_Texture* texture,
  SDL_Rect box,
  SDL_Color fallback
) {
  int tex_w = 0;
  int tex_h = 0;
  SDL_Rect dest = box;
  if (!texture || SDL_QueryTexture(texture, NULL, NULL, &tex_w, &tex_h) != 0 || tex_w <= 0 || tex_h <= 0) {
    fill_rect(renderer, box.x, box.y, box.w, box.h, fallback);
    stroke_rect(renderer, box.x, box.y, box.w, box.h, rgb(35, 31, 32));
    return;
  }

  if (tex_w * box.h > tex_h * box.w) {
    dest.w = box.w;
    dest.h = (tex_h * box.w) / tex_w;
  } else {
    dest.h = box.h;
    dest.w = (tex_w * box.h) / tex_h;
  }
  dest.x = box.x + (box.w - dest.w) / 2;
  dest.y = box.y + box.h - dest.h;
  SDL_RenderCopy(renderer, texture, NULL, &dest);
}

static SDL_Rect texture_fit_rect(SDL_Texture* texture, SDL_Rect box) {
  int tex_w = 0;
  int tex_h = 0;
  SDL_Rect dest = box;

  if (!texture || SDL_QueryTexture(texture, NULL, NULL, &tex_w, &tex_h) != 0 || tex_w <= 0 || tex_h <= 0) {
    return dest;
  }

  if (tex_w * box.h > tex_h * box.w) {
    dest.w = box.w;
    dest.h = (tex_h * box.w) / tex_w;
  } else {
    dest.h = box.h;
    dest.w = (tex_w * box.h) / tex_h;
  }
  dest.x = box.x + (box.w - dest.w) / 2;
  dest.y = box.y + (box.h - dest.h) / 2;
  return dest;
}

static void draw_character(
  SDL_Renderer* renderer,
  const Ruby2NativeAssets* assets,
  Ruby2CharacterId character,
  SDL_Rect box
) {
  static const SDL_Color fallback_colors[] = {
    {210, 42, 42, 255},
    {209, 86, 133, 255},
    {69, 174, 96, 255},
    {214, 126, 37, 255},
    {81, 101, 176, 255},
    {118, 91, 175, 255},
    {224, 117, 75, 255},
    {65, 145, 104, 255},
    {73, 106, 162, 255}
  };
  SDL_Texture* texture = character < RUBY2_CHARACTER_COUNT ? assets->characters[character] : NULL;
  SDL_Color fallback = character < RUBY2_CHARACTER_COUNT ? fallback_colors[character] : rgb(120, 120, 120);
  draw_texture_fit(renderer, texture, box, fallback);
}

static const Ruby2UiAction* action_for_slot(const Ruby2UiSnapshot* snapshot, const Ruby2UiActionSlot* slot) {
  if (!snapshot || !slot || slot->action_index >= snapshot->action_count) return NULL;
  return &snapshot->actions[slot->action_index];
}

static SDL_Color action_color(uint8_t slot) {
  static const SDL_Color colors[] = {
    {240, 146, 42, 255},
    {247, 211, 58, 255},
    {76, 181, 85, 255},
    {58, 163, 224, 255}
  };
  return colors[slot % 4u];
}

static Ruby2NativeLayout layout_for_snapshot(const Ruby2UiSnapshot* snapshot) {
  Ruby2NativeLayout layout;
  int gap = 18;
  uint8_t action_count = snapshot ? snapshot->presentation.action_tray.slot_count : 2;
  uint8_t nav_count = snapshot ? snapshot->presentation.navigation.slot_count : 0;
  int action_x = nav_count > 0 ? 540 : 34;
  int action_w = (RUBY2_NATIVE_W - action_x - 34 - gap) / 2;
  memset(&layout, 0, sizeof(layout));

  layout.title = rect_xywh(34, 30, 386, 92);
  layout.exploration_prompt = rect_xywh(430, 54, 865, 74);
  layout.speaker = rect_xywh(58, 148, 340, 650);
  layout.focus_speech = rect_xywh(430, 132, 865, 198);
  layout.focus_black_frame = rect_xywh(430, 132, 865, 248);
  layout.focus_black_surface = rect_xywh(450, 152, 825, 208);
  layout.focus_next_button = rect_xywh(1160, 282, 104, 36);
  layout.focus_back_button = rect_xywh(1148, 314, 100, 30);
  layout.witnesses[0] = rect_xywh(650, 372, 244, 388);
  layout.witnesses[1] = rect_xywh(1260, 334, 286, 430);
  layout.reaction_bubbles[0] = rect_xywh(910, 408, 360, 74);
  layout.reaction_bubbles[1] = rect_xywh(930, 498, 360, 74);
  layout.reaction_bubbles[2] = rect_xywh(930, 588, 360, 74);
  layout.reaction_bubbles[3] = rect_xywh(930, 318, 360, 74);
  layout.notebook = rect_xywh(34, 650, 1532, 58);
  layout.result_toast = rect_xywh(520, 598, 560, 38);
  layout.navigation = rect_xywh(34, 724, 486, 132);

  for (uint8_t i = 0; i < RUBY2_UI_MAX_ACTION_SLOTS; ++i) {
    uint8_t row = (uint8_t)(i / 2u);
    uint8_t col = (uint8_t)(i % 2u);
    if (action_count <= 2 && nav_count == 0) {
      layout.action_slots[i] = rect_xywh(action_x + (int)col * (action_w + gap), 724, action_w, 132);
    } else {
      layout.action_slots[i] = rect_xywh(action_x + (int)col * (action_w + gap), 724 + (int)row * 70, action_w, 62);
    }
  }
  for (uint8_t i = 0; i < RUBY2_UI_MAX_NAVIGATION_SLOTS; ++i) {
    if (nav_count <= 3) {
      layout.navigation_slots[i] = rect_xywh(226, 758 + (int)i * 32, 276, 28);
    } else {
      uint8_t row = (uint8_t)(i / 2u);
      uint8_t col = (uint8_t)(i % 2u);
      layout.navigation_slots[i] = rect_xywh(226 + (int)col * 140, 758 + (int)row * 26, 136, 23);
    }
  }
  for (uint8_t i = 0; i < RUBY2_UI_MAX_ITEM_SLOTS; ++i) {
    layout.inventory_slots[i] = rect_xywh(1460, 150 + (int)i * 78, 72, 72);
  }

  if (snapshot && snapshot->room == RUBY2_ROOM_CAFETERIA) {
    layout.speaker = rect_xywh(62, 164, 320, 610);
    layout.exploration_prompt = rect_xywh(402, 54, 840, 74);
    layout.focus_speech = rect_xywh(402, 118, 840, 188);
    layout.focus_black_frame = rect_xywh(402, 118, 840, 242);
    layout.focus_black_surface = rect_xywh(422, 138, 800, 202);
    layout.focus_next_button = rect_xywh(1112, 260, 104, 36);
    layout.focus_back_button = rect_xywh(1098, 294, 100, 30);
    layout.witnesses[0] = rect_xywh(620, 354, 260, 402);
    layout.witnesses[1] = rect_xywh(1180, 350, 286, 420);
    layout.reaction_bubbles[0] = rect_xywh(882, 404, 360, 74);
    layout.reaction_bubbles[1] = rect_xywh(902, 494, 360, 74);
  }

  return layout;
}

static SDL_Color bubble_fill(Ruby2UiBubbleTheme theme) {
  switch (theme) {
    case RUBY2_UI_BUBBLE_THEME_LYRA:
      return rgba(255, 241, 247, 244);
    case RUBY2_UI_BUBBLE_THEME_RAVI:
      return rgba(255, 247, 222, 244);
    case RUBY2_UI_BUBBLE_THEME_MIKA:
      return rgba(235, 253, 239, 244);
    case RUBY2_UI_BUBBLE_THEME_NOOR:
      return rgba(245, 240, 255, 244);
    case RUBY2_UI_BUBBLE_THEME_SAMI:
      return rgba(255, 241, 226, 244);
    case RUBY2_UI_BUBBLE_THEME_INDRA:
      return rgba(242, 244, 255, 244);
    case RUBY2_UI_BUBBLE_THEME_RUBY:
      return rgba(255, 245, 245, 244);
    default:
      return rgba(255, 250, 240, 244);
  }
}

static SDL_Color bubble_outline(Ruby2UiBubbleTheme theme) {
  switch (theme) {
    case RUBY2_UI_BUBBLE_THEME_LYRA:
      return rgb(209, 86, 133);
    case RUBY2_UI_BUBBLE_THEME_RAVI:
      return rgb(214, 126, 37);
    case RUBY2_UI_BUBBLE_THEME_MIKA:
      return rgb(69, 174, 96);
    case RUBY2_UI_BUBBLE_THEME_NOOR:
      return rgb(118, 91, 175);
    case RUBY2_UI_BUBBLE_THEME_SAMI:
      return rgb(224, 117, 75);
    case RUBY2_UI_BUBBLE_THEME_INDRA:
      return rgb(81, 101, 176);
    case RUBY2_UI_BUBBLE_THEME_RUBY:
      return rgb(210, 42, 42);
    default:
      return rgb(35, 31, 32);
  }
}

static void draw_background(SDL_Renderer* renderer, const Ruby2NativeAssets* assets, const Ruby2UiSnapshot* snapshot) {
  SDL_Texture* texture = NULL;
  SDL_Rect full = rect_xywh(0, 0, RUBY2_NATIVE_W, RUBY2_NATIVE_H);
  if (snapshot->room == RUBY2_ROOM_CAFETERIA) {
    texture = assets->cafeteria_bg;
  } else if (snapshot->room == RUBY2_ROOM_HOMEROOM) {
    texture = assets->homeroom_bg;
  } else if (snapshot->room == RUBY2_ROOM_HALLWAY) {
    texture = assets->hallway_bg;
  } else if (snapshot->room == RUBY2_ROOM_SCIENCE_LAB) {
    texture = assets->science_lab_bg;
  } else if (snapshot->room == RUBY2_ROOM_LIBRARY) {
    texture = assets->library_bg;
  } else if (snapshot->room == RUBY2_ROOM_GREENHOUSE) {
    texture = assets->greenhouse_bg;
  } else if (snapshot->room == RUBY2_ROOM_COURTYARD) {
    texture = assets->courtyard_bg;
  } else if (snapshot->room == RUBY2_ROOM_TEACHER_OFFICE) {
    texture = assets->hallway_bg;
  }
  draw_texture_fit(renderer, texture, full, rgb(76, 83, 72));
  fill_rect(renderer, 0, 0, RUBY2_NATIVE_W, RUBY2_NATIVE_H, rgba(20, 15, 12, 82));
  fill_rect(renderer, 0, 642, RUBY2_NATIVE_W, 258, rgba(10, 8, 7, 132));
}

static void draw_topbar(
  Ruby2NativeRenderer* renderer_state,
  SDL_Renderer* renderer,
  const Ruby2UiSnapshot* snapshot,
  const Ruby2NativeLayout* layout
) {
  SDL_Rect title = layout->title;
  panel(renderer, title, 10, rgba(255, 250, 240, 224), rgba(35, 31, 32, 90));
  draw_text(renderer_state, renderer, title.x + 24, title.y + 28, ruby2_room_name(snapshot->room), rgb(35, 31, 32), 4);
  draw_text(renderer_state, renderer, title.x + 24, title.y + 10, "RUBY HIGH", rgb(210, 42, 42), 1);
}

static void draw_speech_focus(
  Ruby2NativeRenderer* renderer_state,
  SDL_Renderer* renderer,
  const Ruby2UiSnapshot* snapshot,
  const Ruby2NativeLayout* layout
) {
  const Ruby2UiFocusPresentation* focus = &snapshot->presentation.focus;
  SDL_Rect focus_rect = layout->focus_speech;
  panel(renderer, focus_rect, 12, rgba(255, 250, 240, 246), rgb(35, 31, 32));
  draw_text(renderer_state, renderer, focus_rect.x + 38, focus_rect.y + 32, ruby2_world_character_name(focus->speaker), rgb(210, 42, 42), 2);
  draw_wrapped(renderer_state, renderer, focus_rect.x + 38, focus_rect.y + 74, focus_rect.w - 105, focus->speech_line, rgb(35, 31, 32), 3, 3);
  if (focus->has_blackboard) {
    SDL_Rect button = layout->focus_next_button;
    panel(renderer, button, 8, rgba(35, 31, 32, 220), rgba(255, 250, 240, 120));
    draw_text(renderer_state, renderer, button.x + 22, button.y + 10, focus->next_label, rgb(255, 250, 240), 1);
  }
}

static bool snapshot_has_chat_choices(const Ruby2UiSnapshot* snapshot) {
  if (!snapshot) return false;
  for (uint8_t i = 0; i < snapshot->presentation.action_tray.slot_count; ++i) {
    const Ruby2UiActionSlot* slot = &snapshot->presentation.action_tray.slots[i];
    const Ruby2UiAction* action = action_for_slot(snapshot, slot);
    if (action && action->kind == RUBY2_WORLD_ACTION_CHAT_CHOICE) return true;
  }
  return false;
}

static bool snapshot_has_performance_line(const Ruby2UiSnapshot* snapshot) {
  if (!snapshot) return false;
  for (uint8_t i = snapshot->event_count; i > 0; --i) {
    const Ruby2UiEvent* event = &snapshot->events[i - 1u];
    if (event->room < RUBY2_ROOM_COUNT && event->room != snapshot->room) continue;
    return event->has_performance && event->performance_line && event->performance_line[0] != '\0';
  }
  return false;
}

static bool snapshot_is_scene_focused(const Ruby2UiSnapshot* snapshot) {
  if (!snapshot) return false;
  return snapshot->presentation.focus.has_blackboard ||
         snapshot_has_performance_line(snapshot) ||
         snapshot->presentation.reaction_bubble_count > 0 ||
         snapshot_has_chat_choices(snapshot);
}

static void draw_exploration_prompt(
  Ruby2NativeRenderer* renderer_state,
  SDL_Renderer* renderer,
  const Ruby2UiSnapshot* snapshot,
  const Ruby2NativeLayout* layout
) {
  SDL_Rect rect = layout->exploration_prompt;
  const char* line = snapshot->presentation.focus.speech_line;
  if (!line || line[0] == '\0') return;
  panel(renderer, rect, 10, rgba(255, 250, 240, 212), rgba(35, 31, 32, 72));
  draw_text(renderer_state, renderer, rect.x + 22, rect.y + 12, "Current goal", rgb(210, 42, 42), 1);
  draw_wrapped(renderer_state, renderer, rect.x + 22, rect.y + 34, rect.w - 44, line, rgb(35, 31, 32), 2, 1);
}

static void draw_blackboard_focus(
  Ruby2NativeRenderer* renderer_state,
  SDL_Renderer* renderer,
  const Ruby2UiSnapshot* snapshot,
  const Ruby2NativeLayout* layout
) {
  const Ruby2UiFocusPresentation* focus = &snapshot->presentation.focus;
  SDL_Rect frame = layout->focus_black_frame;
  SDL_Rect board = layout->focus_black_surface;
  fill_rect(renderer, frame.x, frame.y, frame.w, frame.h, rgb(107, 63, 29));
  stroke_rect(renderer, frame.x, frame.y, frame.w, frame.h, rgb(70, 35, 15));
  fill_rect(renderer, board.x, board.y, board.w, board.h, rgb(47, 90, 63));
  stroke_rect(renderer, board.x, board.y, board.w, board.h, rgb(24, 58, 39));
  draw_text(renderer_state, renderer, board.x + 28, board.y + 18, focus->blackboard_kicker ? focus->blackboard_kicker : "Blackboard", rgba(216, 229, 214, 230), 2);
  for (uint8_t i = 0; i < focus->blackboard_line_count; ++i) {
    int scale = (focus->blackboard_lines[i] && strstr(focus->blackboard_lines[i], ":")) ? 3 : 2;
    draw_text(renderer_state, renderer, board.x + 28, board.y + 58 + (int)i * 36, focus->blackboard_lines[i], rgb(244, 244, 240), scale);
  }
}

static void draw_focus(
  Ruby2NativeRenderer* renderer_state,
  SDL_Renderer* renderer,
  const Ruby2UiSnapshot* snapshot,
  const Ruby2NativeLayout* layout,
  bool show_blackboard
) {
  if (!snapshot_is_scene_focused(snapshot)) {
    draw_exploration_prompt(renderer_state, renderer, snapshot, layout);
  } else if (show_blackboard && snapshot->presentation.focus.has_blackboard) {
    draw_blackboard_focus(renderer_state, renderer, snapshot, layout);
  } else {
    draw_speech_focus(renderer_state, renderer, snapshot, layout);
  }
}

static void draw_inventory_slots(
  Ruby2NativeRenderer* renderer_state,
  SDL_Renderer* renderer,
  const Ruby2NativeAssets* assets,
  const Ruby2UiSnapshot* snapshot,
  const Ruby2NativeLayout* layout
) {
  (void)renderer_state;
  for (uint8_t i = 0; i < snapshot->item_slot_count && i < RUBY2_UI_MAX_ITEM_SLOTS; ++i) {
    const Ruby2UiItemSlot* slot = &snapshot->item_slots[i];
    SDL_Texture* item_texture = NULL;
    SDL_Rect image_box = layout->inventory_slots[i];
    SDL_Rect image_rect;
    if (!slot->occupied || slot->item >= RUBY2_ITEM_COUNT) continue;

    item_texture = assets ? assets->items[slot->item] : NULL;
    image_rect = texture_fit_rect(item_texture, image_box);
    draw_texture_fit(renderer, item_texture, image_box, rgba(255, 250, 240, 255));
    stroke_round_rect_thick(renderer, image_rect, 9, 5, rgba(255, 250, 240, 252));
  }
}

static void draw_people(
  SDL_Renderer* renderer,
  const Ruby2NativeAssets* assets,
  const Ruby2UiSnapshot* snapshot,
  const Ruby2NativeLayout* layout
) {
  Ruby2CharacterId speaker = snapshot->presentation.focus.speaker;
  uint8_t witness_count = 0;

  if (!snapshot_is_scene_focused(snapshot)) {
    for (uint8_t i = 0; i < snapshot->people_count; ++i) {
      Ruby2CharacterId character = (Ruby2CharacterId)snapshot->people[i];
      SDL_Rect box = witness_count == 0 ? layout->speaker : layout->witnesses[witness_count - 1u];
      draw_character(renderer, assets, character, box);
      witness_count++;
      if (witness_count >= 3) break;
    }
    return;
  }

  draw_character(renderer, assets, speaker, layout->speaker);

  for (uint8_t i = 0; i < snapshot->people_count; ++i) {
    Ruby2CharacterId character = (Ruby2CharacterId)snapshot->people[i];
    if (character == speaker) continue;
    draw_character(renderer, assets, character, layout->witnesses[witness_count]);
    witness_count++;
    if (witness_count >= 2) break;
  }
}

static SDL_Rect reaction_rect(const Ruby2NativeLayout* layout, Ruby2UiBubbleAnchor anchor) {
  switch (anchor) {
    case RUBY2_UI_BUBBLE_ANCHOR_WITNESS_1:
      return layout->reaction_bubbles[0];
    case RUBY2_UI_BUBBLE_ANCHOR_WITNESS_2:
      return layout->reaction_bubbles[1];
    case RUBY2_UI_BUBBLE_ANCHOR_WITNESS_3:
      return layout->reaction_bubbles[2];
    case RUBY2_UI_BUBBLE_ANCHOR_WITNESS_4:
      return layout->reaction_bubbles[3];
    case RUBY2_UI_BUBBLE_ANCHOR_SPEAKER:
    default:
      return layout->reaction_bubbles[0];
  }
}

static void draw_reactions(
  Ruby2NativeRenderer* renderer_state,
  SDL_Renderer* renderer,
  const Ruby2UiSnapshot* snapshot,
  const Ruby2NativeLayout* layout
) {
  for (uint8_t i = 0; i < snapshot->presentation.reaction_bubble_count; ++i) {
    const Ruby2UiReactionBubble* bubble = &snapshot->presentation.reaction_bubbles[i];
    SDL_Rect rect = reaction_rect(layout, bubble->anchor);
    SDL_Color fill = bubble_fill(bubble->theme);
    SDL_Color outline = bubble_outline(bubble->theme);
    panel(renderer, rect, 12, fill, outline);
    if (bubble->tail == RUBY2_UI_TAIL_LEFT) {
      fill_rect(renderer, rect.x - 18, rect.y + rect.h - 20, 20, 14, fill);
      stroke_rect(renderer, rect.x - 18, rect.y + rect.h - 16, 20, 14, outline);
    } else {
      fill_rect(renderer, rect.x + rect.w - 2, rect.y + rect.h - 20, 20, 14, fill);
      stroke_rect(renderer, rect.x + rect.w - 2, rect.y + rect.h - 16, 20, 14, outline);
    }
    draw_wrapped(renderer_state, renderer, rect.x + 18, rect.y + 14, rect.w - 36, bubble->line, rgb(75, 65, 60), 2, 2);
  }
}

static void draw_notebook(
  Ruby2NativeRenderer* renderer_state,
  SDL_Renderer* renderer,
  const Ruby2UiSnapshot* snapshot,
  const Ruby2NativeLayout* layout
) {
  SDL_Rect notebook = layout->notebook;
  panel(renderer, notebook, 10, rgba(255, 250, 240, 238), rgba(35, 31, 32, 75));
  draw_text(renderer_state, renderer, notebook.x + 26, notebook.y + 20, "Notebook", rgb(62, 109, 168), 2);
  draw_wrapped(renderer_state, renderer, notebook.x + 184, notebook.y + 20, notebook.w - 240, snapshot->presentation.notebook_line, rgb(35, 31, 32), 2, 1);
}

static SDL_Rect navigation_slot_rect(const Ruby2NativeLayout* layout, uint8_t slot_index) {
  return slot_index < RUBY2_UI_MAX_NAVIGATION_SLOTS ? layout->navigation_slots[slot_index] : rect_xywh(0, 0, 0, 0);
}

typedef struct {
  Ruby2RoomId room;
  int x_pct;
  int y_pct;
} Ruby2NativeMapRoom;

typedef struct {
  Ruby2RoomId a;
  Ruby2RoomId b;
} Ruby2NativeMapEdge;

static const Ruby2NativeMapRoom ruby2_native_map_rooms[] = {
  { RUBY2_ROOM_HOMEROOM, 50, 14 },
  { RUBY2_ROOM_LIBRARY, 20, 34 },
  { RUBY2_ROOM_SCIENCE_LAB, 80, 34 },
  { RUBY2_ROOM_HALLWAY, 50, 46 },
  { RUBY2_ROOM_TEACHER_OFFICE, 19, 70 },
  { RUBY2_ROOM_CAFETERIA, 50, 74 },
  { RUBY2_ROOM_COURTYARD, 76, 72 },
  { RUBY2_ROOM_GREENHOUSE, 88, 92 }
};

static const Ruby2NativeMapEdge ruby2_native_map_edges[] = {
  { RUBY2_ROOM_HALLWAY, RUBY2_ROOM_HOMEROOM },
  { RUBY2_ROOM_HALLWAY, RUBY2_ROOM_LIBRARY },
  { RUBY2_ROOM_HALLWAY, RUBY2_ROOM_SCIENCE_LAB },
  { RUBY2_ROOM_HALLWAY, RUBY2_ROOM_TEACHER_OFFICE },
  { RUBY2_ROOM_HALLWAY, RUBY2_ROOM_CAFETERIA },
  { RUBY2_ROOM_HALLWAY, RUBY2_ROOM_COURTYARD },
  { RUBY2_ROOM_CAFETERIA, RUBY2_ROOM_COURTYARD },
  { RUBY2_ROOM_COURTYARD, RUBY2_ROOM_GREENHOUSE }
};

static SDL_Rect navigation_map_rect(const Ruby2NativeLayout* layout) {
  return layout ? rect_xywh(layout->navigation.x + 18, layout->navigation.y + 42, 154, 72) : rect_xywh(0, 0, 0, 0);
}

static const Ruby2NativeMapRoom* navigation_map_room(Ruby2RoomId room) {
  for (uint8_t i = 0; i < (uint8_t)(sizeof(ruby2_native_map_rooms) / sizeof(ruby2_native_map_rooms[0])); ++i) {
    if (ruby2_native_map_rooms[i].room == room) return &ruby2_native_map_rooms[i];
  }
  return NULL;
}

static SDL_Point navigation_map_point(SDL_Rect map, Ruby2RoomId room) {
  SDL_Point point;
  const Ruby2NativeMapRoom* map_room = navigation_map_room(room);
  point.x = map.x + map.w / 2;
  point.y = map.y + map.h / 2;
  if (map_room) {
    point.x = map.x + (map.w * map_room->x_pct) / 100;
    point.y = map.y + (map.h * map_room->y_pct) / 100;
  }
  return point;
}

static SDL_Rect navigation_map_node_rect(SDL_Rect map, Ruby2RoomId room) {
  SDL_Point point = navigation_map_point(map, room);
  return rect_xywh(point.x - 13, point.y - 13, 26, 26);
}

static const Ruby2UiNavigationSlot* navigation_slot_for_room(
  const Ruby2UiSnapshot* snapshot,
  Ruby2RoomId room
) {
  if (!snapshot || room >= RUBY2_ROOM_COUNT) return NULL;
  for (uint8_t i = 0; i < snapshot->presentation.navigation.slot_count; ++i) {
    const Ruby2UiNavigationSlot* slot = &snapshot->presentation.navigation.slots[i];
    if (slot->target_room == room) return slot;
  }
  return NULL;
}

static void draw_navigation_map(
  Ruby2NativeRenderer* renderer_state,
  SDL_Renderer* renderer,
  const Ruby2UiSnapshot* snapshot,
  const Ruby2NativeLayout* layout,
  const Ruby2NativeFrameState* frame_state,
  uint32_t now_ms
) {
  SDL_Rect map = navigation_map_rect(layout);
  if (!snapshot || !layout) return;

  panel(renderer, map, 8, rgba(68, 57, 42, 218), rgba(255, 250, 240, 150));

  for (uint8_t i = 0; i < (uint8_t)(sizeof(ruby2_native_map_edges) / sizeof(ruby2_native_map_edges[0])); ++i) {
    SDL_Point a = navigation_map_point(map, ruby2_native_map_edges[i].a);
    SDL_Point b = navigation_map_point(map, ruby2_native_map_edges[i].b);
    const Ruby2UiNavigationSlot* exit_a = navigation_slot_for_room(snapshot, ruby2_native_map_edges[i].a);
    const Ruby2UiNavigationSlot* exit_b = navigation_slot_for_room(snapshot, ruby2_native_map_edges[i].b);
    bool active = (snapshot->room == ruby2_native_map_edges[i].a && exit_b) ||
                  (snapshot->room == ruby2_native_map_edges[i].b && exit_a);
    set_color(renderer, active ? rgba(247, 211, 58, 230) : rgba(255, 250, 240, 82));
    SDL_RenderDrawLine(renderer, a.x, a.y, b.x, b.y);
  }

  for (uint8_t i = 0; i < (uint8_t)(sizeof(ruby2_native_map_rooms) / sizeof(ruby2_native_map_rooms[0])); ++i) {
    const Ruby2NativeMapRoom* room = &ruby2_native_map_rooms[i];
    const Ruby2UiNavigationSlot* exit_slot = navigation_slot_for_room(snapshot, room->room);
    SDL_Point point = navigation_map_point(map, room->room);
    SDL_Color fill = rgba(255, 250, 240, 202);
    SDL_Color outline = rgba(35, 31, 32, 168);
    int radius = 4;

    if (room->room == snapshot->room) {
      fill = rgb(210, 42, 42);
      outline = rgb(255, 250, 240);
      radius = 7;
    } else if (exit_slot) {
      fill = rgba(255, 250, 240, 245);
      outline = rgb(247, 211, 58);
      radius = 6;
      if (frame_state && exit_slot->action == frame_state->flash_action && now_ms < frame_state->flash_until_ms) {
        fill = rgb(210, 42, 42);
        outline = rgb(255, 250, 240);
      }
    } else {
      fill = rgba(255, 250, 240, 92);
      outline = rgba(255, 250, 240, 58);
      radius = 3;
    }

    fill_circle(renderer, point.x, point.y, radius, fill);
    stroke_circle_thick(renderer, point.x, point.y, radius + 1, room->room == snapshot->room ? 2 : 1, outline);
    if (exit_slot && exit_slot->key_label) {
      draw_text(renderer_state, renderer, point.x + 8, point.y - 7, exit_slot->key_label, rgb(247, 211, 58), 1);
    }
  }
}

static Ruby2WorldActionId navigation_map_hit_action(
  const Ruby2UiSnapshot* snapshot,
  const Ruby2NativeLayout* layout,
  int x,
  int y
) {
  SDL_Rect map = navigation_map_rect(layout);
  if (!snapshot || !layout || !rect_contains(map, x, y)) return RUBY2_ACTION_NONE;

  for (uint8_t i = 0; i < (uint8_t)(sizeof(ruby2_native_map_rooms) / sizeof(ruby2_native_map_rooms[0])); ++i) {
    const Ruby2NativeMapRoom* room = &ruby2_native_map_rooms[i];
    SDL_Rect node = navigation_map_node_rect(map, room->room);
    const Ruby2UiNavigationSlot* slot;
    if (!rect_contains(node, x, y)) continue;
    slot = navigation_slot_for_room(snapshot, room->room);
    return slot ? slot->action : RUBY2_ACTION_NONE;
  }

  return RUBY2_ACTION_NONE;
}

static void draw_navigation(
  Ruby2NativeRenderer* renderer_state,
  SDL_Renderer* renderer,
  const Ruby2UiSnapshot* snapshot,
  const Ruby2NativeLayout* layout,
  const Ruby2NativeFrameState* frame_state,
  uint32_t now_ms
) {
  const Ruby2UiNavigationPresentation* navigation;
  SDL_Rect panel_rect;
  if (!snapshot || !layout || snapshot->presentation.navigation.slot_count == 0) return;

  navigation = &snapshot->presentation.navigation;
  panel_rect = layout->navigation;
  panel(renderer, panel_rect, 10, rgba(255, 250, 240, 232), rgba(35, 31, 32, 130));
  draw_text(renderer_state, renderer, panel_rect.x + 18, panel_rect.y + 14, "Campus", rgb(35, 31, 32), 2);
  draw_wrapped(renderer_state, renderer, panel_rect.x + 112, panel_rect.y + 17, panel_rect.w - 130, navigation->hint, rgb(82, 72, 66), 1, 1);
  draw_navigation_map(renderer_state, renderer, snapshot, layout, frame_state, now_ms);

  for (uint8_t i = 0; i < navigation->slot_count; ++i) {
    const Ruby2UiNavigationSlot* slot = &navigation->slots[i];
    SDL_Rect rect = navigation_slot_rect(layout, i);
    SDL_Color bg = rgba(35, 31, 32, 220);
    SDL_Color outline = rgba(255, 250, 240, 160);
    char label[96];
    if (frame_state && slot->action == frame_state->flash_action && now_ms < frame_state->flash_until_ms) {
      bg = rgb(210, 42, 42);
      outline = rgb(255, 250, 240);
    }
    panel(renderer, rect, 5, bg, outline);
    (void)snprintf(label, sizeof(label), "%s  %s", slot->key_label ? slot->key_label : "?", slot->label ? slot->label : "Exit");
    if (rect.h > 28) {
      draw_text(renderer_state, renderer, rect.x + 16, rect.y + 9, label, rgb(255, 250, 240), 2);
    } else {
      draw_text(renderer_state, renderer, rect.x + 8, rect.y + 6, label, rgb(255, 250, 240), 1);
    }
  }
}

static SDL_Rect action_slot_rect(const Ruby2NativeLayout* layout, uint8_t slot_index) {
  return slot_index < RUBY2_UI_MAX_ACTION_SLOTS ? layout->action_slots[slot_index] : rect_xywh(0, 0, 0, 0);
}

static void draw_actions(
  Ruby2NativeRenderer* renderer_state,
  SDL_Renderer* renderer,
  const Ruby2UiSnapshot* snapshot,
  const Ruby2NativeLayout* layout,
  const Ruby2NativeFrameState* frame_state,
  uint32_t now_ms
) {
  const Ruby2UiActionTrayPresentation* tray = &snapshot->presentation.action_tray;
  for (uint8_t i = 0; i < tray->slot_count; ++i) {
    const Ruby2UiActionSlot* slot = &tray->slots[i];
    const Ruby2UiAction* action = action_for_slot(snapshot, slot);
    SDL_Rect rect = action_slot_rect(layout, i);
    SDL_Color bg = action_color(i);
    SDL_Color outline = rgba(20, 18, 18, 220);
    SDL_Color text = i >= 2 ? rgb(255, 250, 240) : rgb(26, 34, 56);
    bool compact = rect.h < 90;
    char index[8];
    if (action && frame_state && action->id == frame_state->flash_action && now_ms < frame_state->flash_until_ms) {
      bg = color_scale(bg, 1.16f);
      outline = rgb(255, 250, 240);
    }
    panel(renderer, rect, 10, bg, outline);
    (void)snprintf(index, sizeof(index), "%u", (unsigned)slot->button_index);
    if (compact) {
      panel(renderer, rect_xywh(rect.x + 12, rect.y + 13, 30, 30), 6, rgba(255, 250, 240, 236), rgba(20, 18, 18, 120));
      draw_text(renderer_state, renderer, rect.x + 24, rect.y + 22, index, rgb(26, 34, 56), 1);
      draw_wrapped(renderer_state, renderer, rect.x + 54, rect.y + 11, rect.w - 66, action ? action->label : "", text, 1, 2);
    } else {
      panel(renderer, rect_xywh(rect.x + 18, rect.y + 24, 50, 50), 8, rgba(255, 250, 240, 236), rgba(20, 18, 18, 120));
      draw_text(renderer_state, renderer, rect.x + 39, rect.y + 42, index, rgb(26, 34, 56), 2);
      draw_wrapped(renderer_state, renderer, rect.x + 84, rect.y + 22, rect.w - 104, action ? action->label : "", text, 2, 4);
    }
  }
}

static void draw_result_toast(
  Ruby2NativeRenderer* renderer_state,
  SDL_Renderer* renderer,
  const Ruby2NativeLayout* layout,
  const Ruby2NativeFrameState* frame_state,
  uint32_t now_ms
) {
  uint8_t alpha = 232;
  SDL_Rect rect;
  if (!frame_state || !frame_state->result_line || frame_state->result_line[0] == '\0') return;
  if (now_ms >= frame_state->result_until_ms) return;
  if (frame_state->result_until_ms - now_ms < RUBY2_NATIVE_RESULT_FADE_MS) {
    alpha = (uint8_t)(232u * (frame_state->result_until_ms - now_ms) / RUBY2_NATIVE_RESULT_FADE_MS);
  }
  rect = layout->result_toast;
  panel(renderer, rect, 10, rgba(35, 31, 32, alpha), rgba(255, 250, 240, alpha));
  draw_wrapped(renderer_state, renderer, rect.x + 24, rect.y + 9, rect.w - 48, frame_state->result_line, rgba(255, 250, 240, alpha), 2, 1);
}

Ruby2NativeRenderer* ruby2_native_renderer_create(SDL_Renderer* renderer) {
  Ruby2NativeRenderer* renderer_state = (Ruby2NativeRenderer*)calloc(1, sizeof(*renderer_state));
  if (!renderer_state) return NULL;
  text_cache_init(&renderer_state->text_cache);
  load_assets(renderer, &renderer_state->assets);
  return renderer_state;
}

void ruby2_native_renderer_destroy(Ruby2NativeRenderer* renderer_state) {
  if (!renderer_state) return;
  text_cache_destroy(&renderer_state->text_cache);
  destroy_assets(&renderer_state->assets);
  free(renderer_state);
}

void ruby2_native_renderer_render(
  Ruby2NativeRenderer* renderer_state,
  SDL_Renderer* renderer,
  const Ruby2UiSnapshot* snapshot,
  const Ruby2NativeFrameState* frame_state,
  uint32_t now_ms
) {
  Ruby2NativeLayout layout;
  bool show_blackboard = frame_state && frame_state->show_blackboard;
  bool scene_focused;
  if (!renderer_state || !renderer || !snapshot) return;

  layout = layout_for_snapshot(snapshot);
  scene_focused = snapshot_is_scene_focused(snapshot);
  SDL_SetRenderDrawBlendMode(renderer, SDL_BLENDMODE_BLEND);
  draw_background(renderer, &renderer_state->assets, snapshot);
  draw_topbar(renderer_state, renderer, snapshot, &layout);
  draw_people(renderer, &renderer_state->assets, snapshot, &layout);
  draw_focus(renderer_state, renderer, snapshot, &layout, show_blackboard);
  if (scene_focused && frame_state && now_ms - frame_state->focus_changed_at_ms < RUBY2_NATIVE_FOCUS_TRANSITION_MS) {
    uint32_t age = now_ms - frame_state->focus_changed_at_ms;
    uint8_t alpha = (uint8_t)(58u - (58u * age / RUBY2_NATIVE_FOCUS_TRANSITION_MS));
    SDL_Rect focus = show_blackboard ? layout.focus_black_frame : layout.focus_speech;
    fill_round_rect(renderer, focus.x, focus.y, focus.w, focus.h, 12, rgba(255, 255, 255, alpha));
  }
  draw_reactions(renderer_state, renderer, snapshot, &layout);
  draw_inventory_slots(renderer_state, renderer, &renderer_state->assets, snapshot, &layout);
  draw_result_toast(renderer_state, renderer, &layout, frame_state, now_ms);
  draw_notebook(renderer_state, renderer, snapshot, &layout);
  draw_navigation(renderer_state, renderer, snapshot, &layout, frame_state, now_ms);
  draw_actions(renderer_state, renderer, snapshot, &layout, frame_state, now_ms);
}

Ruby2NativeHit ruby2_native_renderer_hit_test(
  const Ruby2UiSnapshot* snapshot,
  bool show_blackboard,
  int x,
  int y
) {
  Ruby2NativeHit hit;
  Ruby2NativeLayout layout = layout_for_snapshot(snapshot);
  hit.kind = RUBY2_NATIVE_HIT_NONE;
  hit.action = RUBY2_ACTION_NONE;

  if (!snapshot) return hit;
  if (snapshot->presentation.focus.has_blackboard &&
      (rect_contains(layout.focus_next_button, x, y) ||
       (show_blackboard && rect_contains(layout.focus_black_frame, x, y)))) {
    hit.kind = RUBY2_NATIVE_HIT_FOCUS_TOGGLE;
    return hit;
  }

  hit.action = navigation_map_hit_action(snapshot, &layout, x, y);
  if (hit.action != RUBY2_ACTION_NONE) {
    hit.kind = RUBY2_NATIVE_HIT_NAVIGATION;
    return hit;
  }

  for (uint8_t i = 0; i < snapshot->presentation.navigation.slot_count; ++i) {
    SDL_Rect rect = navigation_slot_rect(&layout, i);
    if (rect_contains(rect, x, y)) {
      hit.kind = RUBY2_NATIVE_HIT_NAVIGATION;
      hit.action = snapshot->presentation.navigation.slots[i].action;
      return hit;
    }
  }

  for (uint8_t i = 0; i < snapshot->presentation.action_tray.slot_count; ++i) {
    SDL_Rect rect = action_slot_rect(&layout, i);
    if (rect_contains(rect, x, y)) {
      hit.kind = RUBY2_NATIVE_HIT_ACTION;
      hit.action = snapshot->presentation.action_tray.slots[i].action;
      return hit;
    }
  }

  return hit;
}
