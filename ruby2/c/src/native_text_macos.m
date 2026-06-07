#include "ruby2_native_text.h"

#import <AppKit/AppKit.h>

#include <math.h>
#include <string.h>

static NSString* ns_string_from_utf8(const char* text) {
  if (!text) return @"";
  NSString* string = [NSString stringWithUTF8String:text];
  return string ? string : @"";
}

static NSFont* ruby2_font(int size, bool bold) {
  CGFloat font_size = size > 0 ? (CGFloat)size : 16.0;
  if (bold) {
    return [NSFont systemFontOfSize:font_size weight:NSFontWeightSemibold];
  }
  return [NSFont systemFontOfSize:font_size weight:NSFontWeightRegular];
}

static NSDictionary<NSAttributedStringKey, id>* ruby2_attrs(int size, SDL_Color color, bool bold) {
  NSColor* ns_color = [NSColor colorWithCalibratedRed:(CGFloat)color.r / 255.0
                                               green:(CGFloat)color.g / 255.0
                                                blue:(CGFloat)color.b / 255.0
                                               alpha:(CGFloat)color.a / 255.0];
  return @{
    NSFontAttributeName: ruby2_font(size, bold),
    NSForegroundColorAttributeName: ns_color
  };
}

bool ruby2_native_text_available(void) {
  return true;
}

int ruby2_native_text_width(const char* text, int size, bool bold) {
  NSString* string = ns_string_from_utf8(text);
  NSSize text_size = [string sizeWithAttributes:ruby2_attrs(size, (SDL_Color){255, 255, 255, 255}, bold)];
  return (int)ceil(text_size.width);
}

int ruby2_native_text_line_height(int size) {
  NSFont* font = ruby2_font(size, false);
  CGFloat height = font.ascender - font.descender + font.leading;
  if (height < (CGFloat)size + 4.0) height = (CGFloat)size + 4.0;
  return (int)ceil(height);
}

SDL_Texture* ruby2_native_text_texture(
  SDL_Renderer* renderer,
  const char* text,
  int size,
  SDL_Color color,
  bool bold
) {
  NSString* string;
  NSDictionary<NSAttributedStringKey, id>* attrs;
  NSSize measured;
  int width;
  int height;
  NSBitmapImageRep* rep;
  NSGraphicsContext* context;
  SDL_Surface* surface;
  SDL_Texture* texture;

  if (!renderer || !text || text[0] == '\0') return NULL;

  string = ns_string_from_utf8(text);
  attrs = ruby2_attrs(size, color, bold);
  measured = [string sizeWithAttributes:attrs];
  width = (int)ceil(measured.width) + 2;
  height = ruby2_native_text_line_height(size) + 2;
  if (width <= 0 || height <= 0) return NULL;

  rep = [[NSBitmapImageRep alloc]
    initWithBitmapDataPlanes:NULL
                  pixelsWide:width
                  pixelsHigh:height
               bitsPerSample:8
             samplesPerPixel:4
                    hasAlpha:YES
                    isPlanar:NO
              colorSpaceName:NSCalibratedRGBColorSpace
                 bytesPerRow:width * 4
                bitsPerPixel:32];
  if (!rep) return NULL;

  context = [NSGraphicsContext graphicsContextWithBitmapImageRep:rep];
  if (!context) return NULL;

  [NSGraphicsContext saveGraphicsState];
  [NSGraphicsContext setCurrentContext:context];
  [context setShouldAntialias:YES];
  [[NSColor clearColor] setFill];
  NSRectFill(NSMakeRect(0.0, 0.0, (CGFloat)width, (CGFloat)height));
  [string drawAtPoint:NSMakePoint(1.0, 1.0) withAttributes:attrs];
  [NSGraphicsContext restoreGraphicsState];

  surface = SDL_CreateRGBSurfaceWithFormatFrom(
    [rep bitmapData],
    width,
    height,
    32,
    (int)[rep bytesPerRow],
    SDL_PIXELFORMAT_RGBA32
  );
  if (!surface) return NULL;

  texture = SDL_CreateTextureFromSurface(renderer, surface);
  SDL_FreeSurface(surface);
  if (texture) {
    SDL_SetTextureBlendMode(texture, SDL_BLENDMODE_BLEND);
  }
  return texture;
}
