#include "ruby2_engine.h"

#include <stdio.h>

static void print_progression(const Ruby2State* state) {
  puts("Virtues");
  for (uint8_t i = 0; i < RUBY2_VIRTUE_COUNT; ++i) {
    printf("  %-6s %u\n", ruby2_virtue_name((Ruby2Virtue)i), state->virtue_counts[i]);
  }
  puts("Disciplines");
  for (uint8_t i = 0; i < RUBY2_DISCIPLINE_COUNT; ++i) {
    printf("  %-6s %u\n", ruby2_discipline_name((Ruby2Discipline)i), state->discipline_counts[i]);
  }
}

static void print_clocks(const Ruby2State* state) {
  puts("Clocks");
  for (uint8_t i = 0; i < RUBY2_CLOCK_COUNT; ++i) {
    printf(
      "  %-12s %d/%d\n",
      ruby2_clock_name((Ruby2Clock)i),
      state->clocks[i].value,
      state->clocks[i].max
    );
  }
}

static void print_candidates(const Ruby2State* state) {
  puts("Yearbook candidates");
  for (uint8_t i = 0; i < state->yearbook_candidate_count; ++i) {
    const Ruby2YearbookCandidate* candidate = &state->yearbook_candidates[i];
    printf(
      "  %s (#%u) score=%d status=%d\n",
      ruby2_candidate_title(candidate->id),
      candidate->id,
      candidate->score,
      candidate->status
    );
  }
}

int main(void) {
  Ruby2State state;
  ruby2_run_week_one_sample(&state);

  puts("Ruby High 2.0 C Wedge: Week One deterministic text sim");
  puts("-------------------------------------------------------");
  printf("Current room: %s\n", ruby2_room_name(state.current_room_id));
  if (state.dominant_archetype == RUBY2_ARCHETYPE_WILD_CARD &&
      state.secondary_archetype != RUBY2_ARCHETYPE_WILD_CARD) {
    printf("Dominant archetype: Wild Card, leaning %s\n", ruby2_archetype_name(state.secondary_archetype));
  } else {
    printf("Dominant archetype: %s\n", ruby2_archetype_name(state.dominant_archetype));
  }
  print_progression(&state);
  print_clocks(&state);
  print_candidates(&state);

  puts("");
  puts("Loop proven by this wedge:");
  puts("  Day 1 Homeroom -> social consequence -> Yearbook candidate");
  puts("  Day 2 Passing Period -> social acknowledgement -> signal candidate");
  puts("  Day 3 Library Signal Rise -> Indra/source candidate");
  puts("  Day 4 Office Pass -> server-validated recovery route");
  puts("  Day 5 Captain Null -> trace-based restraint outcome");

  return 0;
}
