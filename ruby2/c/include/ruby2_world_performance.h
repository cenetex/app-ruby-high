#ifndef RUBY2_WORLD_PERFORMANCE_H
#define RUBY2_WORLD_PERFORMANCE_H

#include "ruby2_llm.h"
#include "ruby2_world.h"

#include <stdbool.h>

bool ruby2_world_event_to_performance_request(
  const Ruby2World* world,
  const Ruby2WorldEvent* event,
  Ruby2PerformanceRequest* out
);

#endif
