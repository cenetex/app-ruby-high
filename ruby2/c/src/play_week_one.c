#include "ruby2_engine.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int read_choice(int min, int max) {
  char line[32];
  for (;;) {
    printf("> ");
    fflush(stdout);
    if (!fgets(line, sizeof(line), stdin)) {
      puts("");
      exit(EXIT_FAILURE);
    }
    char* end = NULL;
    long value = strtol(line, &end, 10);
    if (value >= min && value <= max) {
      return (int)value;
    }
    printf("Choose %d-%d.\n", min, max);
  }
}

typedef enum {
  RUBY2_DAY2_SIGNAL_NONE,
  RUBY2_DAY2_SIGNAL_EVIDENCE,
  RUBY2_DAY2_SIGNAL_SOCIAL,
  RUBY2_DAY2_SIGNAL_IGNORE
} Ruby2Day2SignalRead;

typedef enum {
  RUBY2_DAY3_SIGNAL_NONE,
  RUBY2_DAY3_SIGNAL_SOURCE,
  RUBY2_DAY3_SIGNAL_INDRA,
  RUBY2_DAY3_SIGNAL_COPY,
  RUBY2_DAY3_SIGNAL_JOKE
} Ruby2Day3SignalRead;

typedef struct {
  bool day1_answer_correct;
  uint8_t day1_social_choice;
  Ruby2Day2SignalRead day2_signal_read;
  Ruby2Day3SignalRead day3_signal_read;
  uint8_t day4_recovery_choice;
  uint8_t day5_null_choice;
} Ruby2WeekTrace;

static void apply_candidate(Ruby2State* state, uint16_t id, int16_t score, Ruby2Archetype tag) {
  Ruby2EffectPayload payload;
  ruby2_effect_payload_init(&payload);
  payload.create_yearbook_candidate = true;
  payload.milestone_kind = RUBY2_MILESTONE_SOCIAL_CLIMAX;
  payload.candidate_id = id;
  payload.candidate_score = score;
  payload.reputation_tag = tag;
  ruby2_apply_effect_payload(state, &payload);
}

static Ruby2Virtue strongest_virtue(const Ruby2State* state) {
  Ruby2Virtue top = RUBY2_VIRTUE_HEAD;
  for (uint8_t i = 1; i < RUBY2_VIRTUE_COUNT; ++i) {
    if (state->virtue_counts[i] > state->virtue_counts[top]) {
      top = (Ruby2Virtue)i;
    }
  }
  return top;
}

static Ruby2Discipline strongest_discipline(const Ruby2State* state) {
  Ruby2Discipline top = RUBY2_DISCIPLINE_SOURCE;
  for (uint8_t i = 1; i < RUBY2_DISCIPLINE_COUNT; ++i) {
    if (state->discipline_counts[i] > state->discipline_counts[top]) {
      top = (Ruby2Discipline)i;
    }
  }
  return top;
}

static const char* stress_word(const Ruby2State* state) {
  int8_t stress = state->clocks[RUBY2_CLOCK_STRESS].value;
  if (stress <= 0) return "steady";
  if (stress <= 2) return "busy";
  return "loud";
}

static const char* signal_word(const Ruby2State* state) {
  int8_t signal = state->clocks[RUBY2_CLOCK_NULL_SIGNAL].value;
  if (signal <= 0) return "quiet";
  if (signal <= 2) return "ticking";
  return "wrong";
}

static void notebook_update(const Ruby2State* state, const char* note) {
  printf("Notebook: %s\n", note);
  printf(
    "Margin read: strongest discipline %s, room %s, signal %s, virtue leaning %s.\n",
    ruby2_discipline_name(strongest_discipline(state)),
    stress_word(state),
    signal_word(state),
    ruby2_virtue_name(strongest_virtue(state))
  );
}

static void day_one(Ruby2State* state, Ruby2WeekTrace* trace) {
  puts("DAY 1 - FIRST HOMEROOM");
  puts("Ruby: \"First bell is always the loudest. Find your seat.\"");
  puts("How do you walk in?");
  puts("1. Prepared, or pretending hard enough.");
  puts("2. Curious, looking at every poster.");
  puts("3. Scrambling, but moving.");
  puts("4. Quiet, taking the back edge of the room.");
  int vibe = read_choice(1, 4);
  if (vibe == 1) {
    puts("Ruby clocks the overprepared notebook and wisely says nothing.");
  } else if (vibe == 2) {
    puts("A hallway poster reads: IF THE ANSWER TALKS BACK, CITE IT.");
  } else if (vibe == 3) {
    puts("Sami slides a pencil over. \"You look like a browser tab with shoes.\"");
  } else {
    puts("Indra moves one chair leg so it stops wobbling before you sit.");
  }
  puts("");
  puts("Ruby writes: READ THE ROOM BEFORE YOU ANSWER.");
  puts("Ravi locks in before the question is done. Lyra changes her answer twice.");
  puts("What do you check first?");
  puts("1. Which answer looks longest");
  puts("2. What the question is actually asking");
  puts("3. Whether Lyra already panicked");
  int answer = read_choice(1, 3);
  trace->day1_answer_correct = answer == 2;

  Ruby2EffectPayload payload;
  ruby2_effect_payload_init(&payload);
  if (answer == 2) {
    puts("Ruby nods. \"Good. Orientation before speed.\"");
    puts("Mika whispers, \"you cooked. for real.\"");
    payload.virtue_deltas[RUBY2_VIRTUE_HEAD] = 1;
    payload.virtue_deltas[RUBY2_VIRTUE_HONOR] = 1;
    payload.discipline_deltas[RUBY2_DISCIPLINE_SENSE] = 1;
  } else {
    puts("Ruby does not make it a thing. That somehow makes it more a thing.");
    puts("Noor, softly: \"respectfully, ouch. couldve been you. was you, actually.\"");
    payload.clock_deltas[RUBY2_CLOCK_STRESS] = 1;
    state->failed_forward_recently = true;
    payload.reputation_tag = RUBY2_ARCHETYPE_COMEBACK_STUDENT;
  }
  ruby2_apply_effect_payload(state, &payload);

  puts("");
  puts("CAFETERIA");
  if (answer == 2) {
    puts("Lyra: \"wait what -- i KNEW it was the question wording. ok im rewriting my notes.\"");
    puts("Noor: \"The test designer is still in this room and is still laughing.\"");
  } else {
    puts("Lyra: \"You got the hard one wrong too? Okay. That makes me feel slightly less doomed.\"");
    puts("Noor: \"The test designer is in this room and is laughing.\"");
  }
  puts("1. \"That question was brutal.\"");
  puts("2. \"I'm getting it next time.\"");
  puts("3. \"Ask Indra. She knew.\"");
  int social = read_choice(1, 3);
  trace->day1_social_choice = (uint8_t)social;

  ruby2_effect_payload_init(&payload);
  if (social == 1) {
    puts("Lyra exhales like you opened a window.");
    payload.virtue_deltas[RUBY2_VIRTUE_HEART] = 1;
    payload.discipline_deltas[RUBY2_DISCIPLINE_SYNC] = 1;
    payload.affinity_deltas[RUBY2_CHARACTER_LYRA] = 1;
    payload.clock_deltas[RUBY2_CLOCK_STRESS] = -1;
    apply_candidate(state, 1001, 10, RUBY2_ARCHETYPE_CONNECTOR);
  } else if (social == 2) {
    puts("Mika, from the next table: \"That is the correct amount of delusion. Respect.\"");
    payload.virtue_deltas[RUBY2_VIRTUE_HUSTLE] = 1;
    payload.discipline_deltas[RUBY2_DISCIPLINE_SYNC] = 1;
    payload.affinity_deltas[RUBY2_CHARACTER_MIKA] = 1;
    apply_candidate(state, 1002, 9, RUBY2_ARCHETYPE_COMEBACK_STUDENT);
  } else {
    puts("Indra looks up once. \"The answer was always C.\"");
    payload.virtue_deltas[RUBY2_VIRTUE_HEAD] = 1;
    payload.discipline_deltas[RUBY2_DISCIPLINE_SENSE] = 1;
    payload.clock_deltas[RUBY2_CLOCK_RUMOR] = 1;
    apply_candidate(state, 1003, 8, RUBY2_ARCHETYPE_SCHOLAR);
  }
  ruby2_apply_effect_payload(state, &payload);
  notebook_update(state, "First Homeroom is not clean, but it is yours.");
  puts("");
}

static void day_two(Ruby2State* state, Ruby2WeekTrace* trace) {
  puts("DAY 2 - PASSING PERIOD");
  state->current_room_id = RUBY2_ROOM_HALLWAY;
  state->current_time_block = RUBY2_TIME_PASSING;
  if (trace->day1_answer_correct) {
    puts("The poster from yesterday is still there. IF THE ANSWER TALKS BACK, CITE IT.");
    puts("Ravi: \"Okay, but posters do not usually update their verb tense overnight.\"");
  } else {
    puts("The poster from yesterday is still there, except you are pretty sure it used to be shorter.");
    puts("Sami: \"Good news. The wall is grading us now, which feels normal and healthy.\"");
  }
  puts("Noor reads the corner where fresh ink should not be dry yet: ASK WHAT ANSWERED.");
  puts("1. Check the poster against yesterday's Notebook.");
  puts("2. Ask Noor who noticed first.");
  puts("3. Keep walking before the bell turns this into a whole thing.");
  int choice = read_choice(1, 3);

  Ruby2EffectPayload payload;
  ruby2_effect_payload_init(&payload);
  if (choice == 1) {
    puts("The Notebook has yesterday's version in the margin. The poster has today's.");
    puts("Ravi lowers his voice for once. \"That is an source problem, not a vibes problem.\"");
    payload.virtue_deltas[RUBY2_VIRTUE_HEAD] = 1;
    payload.virtue_deltas[RUBY2_VIRTUE_HONOR] = 1;
    payload.discipline_deltas[RUBY2_DISCIPLINE_SOURCE] = 1;
    payload.discipline_deltas[RUBY2_DISCIPLINE_SIGNAL] = 1;
    payload.clock_deltas[RUBY2_CLOCK_NULL_SIGNAL] = 1;
    apply_candidate(state, 2001, 8, RUBY2_ARCHETYPE_SIGNAL_READER);
    trace->day2_signal_read = RUBY2_DAY2_SIGNAL_EVIDENCE;
  } else if (choice == 2) {
    puts("Noor: \"The wall noticed first. Try to keep up.\"");
    puts("That should not be comforting. It is, slightly.");
    payload.virtue_deltas[RUBY2_VIRTUE_HEART] = 1;
    payload.discipline_deltas[RUBY2_DISCIPLINE_SYNC] = 1;
    payload.affinity_deltas[RUBY2_CHARACTER_NOOR] = 1;
    payload.clock_deltas[RUBY2_CLOCK_RUMOR] = 1;
    apply_candidate(state, 2002, 8, RUBY2_ARCHETYPE_CONNECTOR);
    trace->day2_signal_read = RUBY2_DAY2_SIGNAL_SOCIAL;
  } else {
    puts("You keep walking. The hallway lets you. That feels like a choice it made.");
    puts("Behind you, Lyra whispers, \"Nope. I am not writing that down. I am absolutely writing that down.\"");
    payload.virtue_deltas[RUBY2_VIRTUE_HUSTLE] = 1;
    payload.discipline_deltas[RUBY2_DISCIPLINE_SIGNAL] = 1;
    payload.clock_deltas[RUBY2_CLOCK_BELL] = 1;
    payload.clock_deltas[RUBY2_CLOCK_STRESS] = -1;
    trace->day2_signal_read = RUBY2_DAY2_SIGNAL_IGNORE;
  }
  ruby2_apply_effect_payload(state, &payload);
  notebook_update(state, "By Day 2, the school has started annotating itself.");
  puts("");
}

static void day_three(Ruby2State* state, Ruby2WeekTrace* trace) {
  puts("DAY 3 - LIBRARY");
  state->room_unlocked[RUBY2_ROOM_LIBRARY] = true;
  state->current_room_id = RUBY2_ROOM_LIBRARY;
  puts("A paper sign on the Library door says QUIET WING.");
  puts("Someone has added, in pencil: unless the quiet starts it.");
  puts("Professor Edward: \"The Library does not make answers safer. It makes them accountable.\"");
  puts("Lyra: \"Great. Love a room where even the shelves can judge me.\"");
  puts("Indra: \"The margin changed.\"");
  puts("");
  puts("The same sentence appears on the page, the catalog card, and your Notebook.");
  puts("Only the Notebook has one extra word: DO.");
  puts("1. Check the source against the catalog card.");
  puts("2. Ask Indra what changed.");
  puts("3. Copy the sentence exactly and do nothing else.");
  puts("4. Joke with Lyra and leave it alone.");
  int choice = read_choice(1, 4);
  trace->day3_signal_read = (Ruby2Day3SignalRead)choice;

  Ruby2EffectPayload payload;
  ruby2_effect_payload_init(&payload);
  if (choice == 1) {
    puts("The catalog card is older than the ink. That should not be possible.");
    puts("Professor Edward does not smile, but one eyebrow gives you partial credit.");
    payload.virtue_deltas[RUBY2_VIRTUE_HEAD] = 1;
    payload.virtue_deltas[RUBY2_VIRTUE_HONOR] = 1;
    payload.discipline_deltas[RUBY2_DISCIPLINE_SOURCE] = 1;
    payload.discipline_deltas[RUBY2_DISCIPLINE_SENSE] = 1;
    payload.clock_deltas[RUBY2_CLOCK_NULL_SIGNAL] = 1;
    apply_candidate(state, 3001, 11, RUBY2_ARCHETYPE_SIGNAL_READER);
  } else if (choice == 2) {
    puts("Indra slides the card over without touching the word. \"It wants a verb.\"");
    puts("Lyra writes that down, then underlines wants three times.");
    payload.virtue_deltas[RUBY2_VIRTUE_HEAD] = 1;
    payload.virtue_deltas[RUBY2_VIRTUE_HEART] = 1;
    payload.discipline_deltas[RUBY2_DISCIPLINE_SENSE] = 1;
    payload.discipline_deltas[RUBY2_DISCIPLINE_SYNC] = 1;
    payload.affinity_deltas[RUBY2_CHARACTER_INDRA] = 1;
    payload.clock_deltas[RUBY2_CLOCK_NULL_SIGNAL] = 1;
    apply_candidate(state, 3002, 10, RUBY2_ARCHETYPE_SCHOLAR);
  } else if (choice == 3) {
    puts("You copy it exactly. For a second, the room stops trying to add anything.");
    puts("Indra: \"Good. It hates witnesses.\"");
    payload.virtue_deltas[RUBY2_VIRTUE_HONOR] = 2;
    payload.discipline_deltas[RUBY2_DISCIPLINE_SIGNAL] = 1;
    apply_candidate(state, 3003, 11, RUBY2_ARCHETYPE_CONSCIENCE);
  } else {
    puts("Lyra laughs too fast. The Notebook keeps the word anyway.");
    puts("No one says Captain Null. That makes it worse.");
    payload.virtue_deltas[RUBY2_VIRTUE_HEART] = 1;
    payload.discipline_deltas[RUBY2_DISCIPLINE_SYNC] = 1;
    payload.clock_deltas[RUBY2_CLOCK_STRESS] = -1;
    payload.clock_deltas[RUBY2_CLOCK_NULL_SIGNAL] = 1;
  }
  ruby2_apply_effect_payload(state, &payload);
  notebook_update(state, "The Library did not explain the word. It proved the word moved.");
  puts("");
}

static void day_four(Ruby2State* state, Ruby2WeekTrace* trace) {
  puts("DAY 4 - CAFETERIA PRESSURE");
  state->current_room_id = RUBY2_ROOM_CAFETERIA;
  state->office_pass_tutorial_complete = true;
  state->items[RUBY2_ITEM_OFFICE_PASS].owned = true;
  state->items[RUBY2_ITEM_OFFICE_PASS].carried = true;
  state->items[RUBY2_ITEM_OFFICE_PASS].charges = 1;
  if (state->clocks[RUBY2_CLOCK_STRESS].value < 2) {
    state->clocks[RUBY2_CLOCK_STRESS].value = 2;
  }

  puts("Ruby: \"The pass is not a skip. It is a way to step out before the room decides who you are.\"");
  puts("1. Use the Office Pass and take the Greenhouse route.");
  puts("2. Stay in Cafeteria and answer the rumor directly.");
  puts("3. Ask Ruby what the fair version of recovery is.");
  int choice = read_choice(1, 3);
  trace->day4_recovery_choice = (uint8_t)choice;

  Ruby2EffectPayload payload;
  ruby2_effect_payload_init(&payload);
  if (choice == 1) {
    if (ruby2_use_item(state, RUBY2_ITEM_OFFICE_PASS) == RUBY2_ITEM_USE_ACCEPTED) {
      puts("The hallway is quiet enough to hear your own answer get less important.");
      puts("Mika catches up near the Greenhouse. \"Good call. Tactical breathing is still tactics.\"");
      puts("Behind you, the cafeteria keeps being a cafeteria without your permission.");
      payload.virtue_deltas[RUBY2_VIRTUE_HEART] = 1;
      payload.discipline_deltas[RUBY2_DISCIPLINE_SYNC] = 1;
      payload.affinity_deltas[RUBY2_CHARACTER_MIKA] = 1;
      apply_candidate(state, 4001, 9, RUBY2_ARCHETYPE_COMEBACK_STUDENT);
    }
  } else if (choice == 2) {
    puts("You stay. The table gets louder, but you keep your seat.");
    puts("Sami: \"Bold strategy. Socially expensive, but bold.\"");
    payload.virtue_deltas[RUBY2_VIRTUE_HUSTLE] = 1;
    payload.discipline_deltas[RUBY2_DISCIPLINE_SYNC] = 1;
    payload.clock_deltas[RUBY2_CLOCK_RUMOR] = -1;
    payload.clock_deltas[RUBY2_CLOCK_STRESS] = 1;
  } else {
    puts("Ruby: \"Recovery is honest when it costs time and does not erase what happened.\"");
    puts("You keep the pass. Somehow the explanation costs almost as much.");
    payload.virtue_deltas[RUBY2_VIRTUE_HONOR] = 1;
    payload.discipline_deltas[RUBY2_DISCIPLINE_SENSE] = 1;
    payload.clock_deltas[RUBY2_CLOCK_BELL] = 1;
  }
  ruby2_apply_effect_payload(state, &payload);
  notebook_update(state, "Recovery is a route, not an undo button.");
  puts("");
}

static void day_five(Ruby2State* state, Ruby2WeekTrace* week) {
  puts("DAY 5 - FIRST NULL SIGNAL");
  puts("The hallway clock has no hands. The bell rings anyway.");
  if (state->clocks[RUBY2_CLOCK_NULL_SIGNAL].value > 0) {
    puts("The word from the Library is already in your Notebook before you open it.");
  }
  if (week->day2_signal_read == RUBY2_DAY2_SIGNAL_EVIDENCE &&
      week->day3_signal_read == RUBY2_DAY3_SIGNAL_SOURCE) {
    puts("The poster, the catalog card, and the clock all disagree in the same handwriting.");
  } else if (week->day2_signal_read == RUBY2_DAY2_SIGNAL_SOCIAL &&
             week->day4_recovery_choice == 2) {
    puts("A Cafeteria whisper arrives before the people carrying it.");
  } else if (week->day2_signal_read == RUBY2_DAY2_SIGNAL_IGNORE) {
    puts("The hallway waits politely, like it remembers you tried not to look.");
  }
  puts("A word writes itself above the door: DO.");
  puts("1. Source - verify what changed before touching the word.");
  puts("2. Sense - name what the word is trying to make you do.");
  puts("3. Sync - hold the room steady while the bell rings.");
  puts("4. Signal - stay silent and let the pattern pass.");
  int choice = read_choice(1, 4);
  week->day5_null_choice = (uint8_t)choice;

  Ruby2NullTrace null_trace;
  memset(&null_trace, 0, sizeof(null_trace));
  if (choice == 1) {
    null_trace.signal_stability = 3;
    null_trace.null_pressure = 1;
    ruby2_null_trace_add_action(&null_trace, RUBY2_NULL_ACTION_SOURCE);
  } else if (choice == 2) {
    null_trace.signal_stability = 2;
    null_trace.null_pressure = 2;
    ruby2_null_trace_add_action(&null_trace, RUBY2_NULL_ACTION_SENSE);
  } else if (choice == 3) {
    null_trace.signal_stability = 2;
    null_trace.null_pressure = 1;
    ruby2_null_trace_add_action(&null_trace, RUBY2_NULL_ACTION_SYNC);
  } else {
    null_trace.signal_stability = 3;
    null_trace.null_pressure = 0;
    ruby2_null_trace_add_action(&null_trace, RUBY2_NULL_ACTION_SIGNAL);
  }

  if (week->day2_signal_read == RUBY2_DAY2_SIGNAL_EVIDENCE) {
    null_trace.signal_stability++;
  } else if (week->day2_signal_read == RUBY2_DAY2_SIGNAL_SOCIAL &&
             choice == 2) {
    null_trace.null_pressure++;
  } else if (week->day2_signal_read == RUBY2_DAY2_SIGNAL_IGNORE &&
             choice != 4) {
    null_trace.null_pressure++;
  }

  Ruby2NullOutcome outcome = ruby2_resolve_first_null_signal(state, &null_trace);
  printf("Captain Null result: %s\n", ruby2_null_outcome_name(outcome));
  if (outcome == RUBY2_NULL_RESTRAINT) {
    puts("Nothing happens loudly. That is the win. Indra writes one word in your margin: held.");
  } else if (outcome == RUBY2_NULL_CLEAR) {
    puts("The door remembers it is a door. Ruby looks like she expected you to notice.");
  } else if (outcome == RUBY2_NULL_FAILED_FORWARD) {
    puts("The clock skips. You are still here, but the hallway knows your name wrong.");
  } else {
    puts("The signal passes through the room and leaves a shadow in the Notebook.");
  }
  notebook_update(state, "The first comic page is not a reward. It is item.");
  puts("");
}

static uint16_t yearbook_ritual(Ruby2State* state) {
  puts("WEEK ONE YEARBOOK RITUAL");
  puts("Mika: \"Real question. What actually goes in the page for this week?\"");
  puts("");
  for (uint8_t i = 0; i < state->yearbook_candidate_count; ++i) {
    Ruby2YearbookCandidate* candidate = &state->yearbook_candidates[i];
    printf(
      "%u. %s\n   %s\n   Signature: %s\n",
      (unsigned)(i + 1),
      ruby2_candidate_title(candidate->id),
      ruby2_candidate_blurb(candidate->id),
      ruby2_candidate_signer(candidate->id)
    );
  }
  int choice = read_choice(1, state->yearbook_candidate_count);
  Ruby2YearbookCandidate* sealed = &state->yearbook_candidates[choice - 1];
  sealed->status = RUBY2_CANDIDATE_SEALED;
  printf("You seal: %s.\n", ruby2_candidate_title(sealed->id));
  printf("First signature: %s.\n", ruby2_candidate_signer(sealed->id));
  puts("The rest of the week does not disappear. It becomes ordinary Notebook history.");
  uint16_t sealed_id = sealed->id;
  ruby2_archive_unsealed_candidates(state);
  return sealed_id;
}

int main(void) {
  Ruby2State state;
  ruby2_state_init(&state);
  Ruby2WeekTrace trace;
  memset(&trace, 0, sizeof(trace));

  puts("Ruby High 2.0 - playable C text slice");
  puts("======================================");
  puts("");

  day_one(&state, &trace);
  day_two(&state, &trace);
  day_three(&state, &trace);
  day_four(&state, &trace);
  day_five(&state, &trace);
  uint16_t sealed_id = yearbook_ritual(&state);

  (void)ruby2_resolve_archetypes(&state);
  puts("");
  puts("FINAL");
  if (state.dominant_archetype == RUBY2_ARCHETYPE_WILD_CARD &&
      state.secondary_archetype != RUBY2_ARCHETYPE_WILD_CARD) {
    printf("Ruby's read: Wild Card, leaning %s\n", ruby2_archetype_name(state.secondary_archetype));
  } else {
    printf("Ruby's read: %s\n", ruby2_archetype_name(state.dominant_archetype));
  }
  notebook_update(&state, ruby2_candidate_tomorrow_hook(sealed_id));
  puts("Come back tomorrow.");
  return EXIT_SUCCESS;
}
