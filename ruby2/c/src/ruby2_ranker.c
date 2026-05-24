#include "ruby2_ranker.h"

#include <float.h>
#include <string.h>

static float ruby2_ranker_norm_clock(const Ruby2World* world, Ruby2Clock clock) {
  if (!world || clock >= RUBY2_CLOCK_COUNT || world->game.clocks[clock].max <= 0) return 0.0f;
  return (float)world->game.clocks[clock].value / (float)world->game.clocks[clock].max;
}

static void ruby2_ranker_set_kind_feature(Ruby2RankerCandidate* candidate, Ruby2WorldActionKind kind) {
  if (!candidate) return;
  switch (kind) {
    case RUBY2_WORLD_ACTION_GO:
      candidate->features[RUBY2_RANKER_F_KIND_GO] = 1.0f;
      break;
    case RUBY2_WORLD_ACTION_TALK:
    case RUBY2_WORLD_ACTION_CHAT_CHOICE:
      candidate->features[RUBY2_RANKER_F_KIND_TALK] = 1.0f;
      break;
    case RUBY2_WORLD_ACTION_ATTEND:
      candidate->features[RUBY2_RANKER_F_KIND_ATTEND] = 1.0f;
      break;
    case RUBY2_WORLD_ACTION_APPROACH:
    case RUBY2_WORLD_ACTION_PROFILE:
      candidate->features[RUBY2_RANKER_F_KIND_APPROACH] = 1.0f;
      break;
    case RUBY2_WORLD_ACTION_INSPECT:
      candidate->features[RUBY2_RANKER_F_KIND_INSPECT] = 1.0f;
      break;
    case RUBY2_WORLD_ACTION_COLLECT:
      candidate->features[RUBY2_RANKER_F_KIND_COLLECT] = 1.0f;
      candidate->features[RUBY2_RANKER_F_OBJECT_PRESENT] = 1.0f;
      break;
    case RUBY2_WORLD_ACTION_CHECK_NOTES:
      candidate->features[RUBY2_RANKER_F_KIND_CHECK_NOTES] = 1.0f;
      break;
    case RUBY2_WORLD_ACTION_WAIT:
      candidate->features[RUBY2_RANKER_F_KIND_WAIT] = 1.0f;
      break;
    default:
      break;
  }
}

static void ruby2_ranker_set_room_feature(Ruby2RankerCandidate* candidate, Ruby2RoomId room_id) {
  if (!candidate) return;
  switch (room_id) {
    case RUBY2_ROOM_HALLWAY:
      candidate->features[RUBY2_RANKER_F_ROOM_HALLWAY] = 1.0f;
      break;
    case RUBY2_ROOM_HOMEROOM:
      candidate->features[RUBY2_RANKER_F_ROOM_HOMEROOM] = 1.0f;
      break;
    case RUBY2_ROOM_CAFETERIA:
      candidate->features[RUBY2_RANKER_F_ROOM_CAFETERIA] = 1.0f;
      break;
    default:
      break;
  }
}

static void ruby2_ranker_set_target_feature(Ruby2RankerCandidate* candidate, Ruby2CharacterId character_id) {
  if (!candidate) return;
  switch (character_id) {
    case RUBY2_CHARACTER_RUBY:
      candidate->features[RUBY2_RANKER_F_TARGET_RUBY] = 1.0f;
      break;
    case RUBY2_CHARACTER_LYRA:
      candidate->features[RUBY2_RANKER_F_TARGET_LYRA] = 1.0f;
      break;
    case RUBY2_CHARACTER_RAVI:
      candidate->features[RUBY2_RANKER_F_TARGET_RAVI] = 1.0f;
      break;
    case RUBY2_CHARACTER_NOOR:
      candidate->features[RUBY2_RANKER_F_TARGET_NOOR] = 1.0f;
      break;
    default:
      break;
  }
}

static float ruby2_ranker_score_candidate(
  const Ruby2RankerModel* model,
  const Ruby2RankerCandidate* candidate
) {
  if (!model || !candidate || !candidate->legal) return -FLT_MAX;
  float score = model->bias;
  for (uint8_t i = 0; i < RUBY2_RANKER_FEATURE_COUNT; ++i) {
    score += model->weights[i] * candidate->features[i];
  }
  return score;
}

static bool ruby2_ranker_recent_action_forbidden(
  const Ruby2World* world,
  Ruby2WorldActionId action_id
) {
  if (!world || world->recent_action_count == 0) {
    return false;
  }
  for (uint8_t i = 0; i < world->recent_action_count; ++i) {
    if (
      world->recent_action_rooms[i] != world->game.current_room_id ||
      world->recent_action_ids[i] != action_id
    ) {
      continue;
    }
    return true;
  }
  return false;
}

static void ruby2_ranker_push_last_action_last(
  const Ruby2World* world,
  const Ruby2WorldActionList* legal_actions,
  Ruby2RankerResult* result
) {
  if (!world || !legal_actions || !result || result->count == 0 ||
      world->recent_action_count == 0) {
    return;
  }

  for (uint8_t slot = 0; slot < result->count && slot < 2; ++slot) {
    uint8_t ranked_index = result->ranked_indices[slot];
    if (ranked_index >= legal_actions->count ||
        !ruby2_ranker_recent_action_forbidden(world, legal_actions->actions[ranked_index].id)) {
      continue;
    }

    for (uint8_t replace_slot = slot + 1; replace_slot < result->count; ++replace_slot) {
      uint8_t replace_ranked_index = result->ranked_indices[replace_slot];
      if (replace_ranked_index >= legal_actions->count) {
        continue;
      }
      if (ruby2_ranker_recent_action_forbidden(
            world,
            legal_actions->actions[replace_ranked_index].id
          )) {
        continue;
      }
      uint8_t tmp_index = result->ranked_indices[slot];
      float tmp_score = result->scores[slot];
      result->ranked_indices[slot] = result->ranked_indices[replace_slot];
      result->scores[slot] = result->scores[replace_slot];
      result->ranked_indices[replace_slot] = tmp_index;
      result->scores[replace_slot] = tmp_score;
      break;
    }
  }
}

static bool ruby2_ranker_better(
  const Ruby2RankerCandidate* candidates,
  const Ruby2RankerResult* result,
  uint8_t left,
  uint8_t right
) {
  float left_score = result->scores[left];
  float right_score = result->scores[right];
  if (left_score > right_score + 0.000001f) return true;
  if (left_score + 0.000001f < right_score) return false;
  if (candidates[left].id != candidates[right].id) return candidates[left].id < candidates[right].id;
  return left < right;
}

void ruby2_ranker_model_init(Ruby2RankerModel* model) {
  if (!model) return;
  memset(model, 0, sizeof(*model));
  model->feature_encoder_version = RUBY2_RANKER_FEATURE_ENCODER_VERSION;
  model->model_hash = "heuristic-linear-v1";

  model->weights[RUBY2_RANKER_F_KIND_GO] = 0.12f;
  model->weights[RUBY2_RANKER_F_KIND_TALK] = 0.32f;
  model->weights[RUBY2_RANKER_F_KIND_ATTEND] = 0.55f;
  model->weights[RUBY2_RANKER_F_KIND_APPROACH] = 0.48f;
  model->weights[RUBY2_RANKER_F_KIND_INSPECT] = 0.50f;
  model->weights[RUBY2_RANKER_F_KIND_COLLECT] = 0.70f;
  model->weights[RUBY2_RANKER_F_KIND_CHECK_NOTES] = 0.04f;
  model->weights[RUBY2_RANKER_F_KIND_WAIT] = -0.18f;

  model->weights[RUBY2_RANKER_F_DISC_SOURCE] = 0.06f;
  model->weights[RUBY2_RANKER_F_DISC_SENSE] = 0.04f;
  model->weights[RUBY2_RANKER_F_DISC_SYNC] = 0.03f;
  model->weights[RUBY2_RANKER_F_DISC_SIGNAL] = 0.08f;

  model->weights[RUBY2_RANKER_F_TARGET_PRESENT] = 0.20f;
  model->weights[RUBY2_RANKER_F_OBJECT_PRESENT] = 0.20f;
  model->weights[RUBY2_RANKER_F_TIME_ARRIVAL] = 0.04f;
  model->weights[RUBY2_RANKER_F_TIME_LUNCH] = 0.06f;
  model->weights[RUBY2_RANKER_F_BELL] = -0.10f;
  model->weights[RUBY2_RANKER_F_STRESS] = 0.03f;
  model->weights[RUBY2_RANKER_F_NULL_SIGNAL] = 0.04f;
  model->weights[RUBY2_RANKER_F_CANDIDATE_INDEX] = -0.02f;
  model->weights[RUBY2_RANKER_F_CANDIDATE_COUNT] = 0.01f;
  model->weights[RUBY2_RANKER_F_AUTHORED_PRIORITY] = 0.50f;
  model->weights[RUBY2_RANKER_F_HOMEROOM_NOT_STARTED] = 0.25f;
  model->weights[RUBY2_RANKER_F_HOMEROOM_STARTED] = 0.18f;
  model->weights[RUBY2_RANKER_F_LUNCH_STARTED] = 0.12f;
  model->weights[RUBY2_RANKER_F_RECEIPT_INSPECTED] = -0.15f;
  model->weights[RUBY2_RANKER_F_HAS_YEARBOOK_CANDIDATE] = -0.05f;
}

void ruby2_ranker_candidate_init(Ruby2RankerCandidate* candidate, uint32_t id, Ruby2RankerDomain domain) {
  if (!candidate) return;
  memset(candidate, 0, sizeof(*candidate));
  candidate->id = id;
  candidate->domain = domain;
  candidate->legal = true;
}

bool ruby2_ranker_rank_candidates(
  const Ruby2RankerModel* model,
  const Ruby2RankerCandidate* candidates,
  uint8_t count,
  Ruby2RankerResult* out
) {
  if (!model || !candidates || !out || count == 0 || count > RUBY2_RANKER_MAX_CANDIDATES) return false;

  memset(out, 0, sizeof(*out));
  out->count = count;
  for (uint8_t i = 0; i < count; ++i) {
    out->ranked_indices[i] = i;
    out->scores[i] = ruby2_ranker_score_candidate(model, &candidates[i]);
  }

  for (uint8_t i = 0; i < count; ++i) {
    uint8_t best = i;
    for (uint8_t j = (uint8_t)(i + 1); j < count; ++j) {
      if (ruby2_ranker_better(candidates, out, out->ranked_indices[j], out->ranked_indices[best])) {
        best = j;
      }
    }
    {
      uint8_t tmp = out->ranked_indices[i];
      out->ranked_indices[i] = out->ranked_indices[best];
      out->ranked_indices[best] = tmp;
    }
  }

  return true;
}

void ruby2_ranker_fill_world_action_candidate(
  const Ruby2World* world,
  const Ruby2WorldAction* action,
  uint8_t candidate_index,
  uint8_t candidate_count,
  Ruby2RankerCandidate* out
) {
  if (!world || !action || !out) return;
  ruby2_ranker_candidate_init(out, (uint32_t)action->id, RUBY2_RANKER_DOMAIN_WORLD_ACTION);

  out->authored_priority = candidate_count <= 1
    ? 1.0f
    : 1.0f - ((float)candidate_index / (float)(candidate_count - 1u));
  out->features[RUBY2_RANKER_F_AUTHORED_PRIORITY] = out->authored_priority;
  out->features[RUBY2_RANKER_F_CANDIDATE_INDEX] = candidate_count <= 1
    ? 0.0f
    : (float)candidate_index / (float)(candidate_count - 1u);
  out->features[RUBY2_RANKER_F_CANDIDATE_COUNT] = (float)candidate_count / (float)RUBY2_WORLD_MAX_ACTIONS;

  ruby2_ranker_set_kind_feature(out, action->kind);
  ruby2_ranker_set_room_feature(out, world->game.current_room_id);
  ruby2_ranker_set_target_feature(out, action->target_character);

  if (action->discipline < RUBY2_DISCIPLINE_COUNT) {
    out->features[RUBY2_RANKER_F_DISC_SOURCE + action->discipline] = 1.0f;
  }
  if (action->virtue < RUBY2_VIRTUE_COUNT) {
    out->features[RUBY2_RANKER_F_VIRT_HEAD + action->virtue] = 1.0f;
  }
  if (world->game.current_time_block == RUBY2_TIME_ARRIVAL) {
    out->features[RUBY2_RANKER_F_TIME_ARRIVAL] = 1.0f;
  }
  if (world->game.current_time_block == RUBY2_TIME_LUNCH) {
    out->features[RUBY2_RANKER_F_TIME_LUNCH] = 1.0f;
  }
  if (action->target_character < RUBY2_CHARACTER_COUNT &&
      ruby2_world_character_present(world, action->target_character, world->game.current_room_id)) {
    out->features[RUBY2_RANKER_F_TARGET_PRESENT] = 1.0f;
  }
  if (action->target_object < RUBY2_WORLD_OBJECT_COUNT &&
      ruby2_world_object_present(world, action->target_object, world->game.current_room_id)) {
    out->features[RUBY2_RANKER_F_OBJECT_PRESENT] = 1.0f;
  }

  out->features[RUBY2_RANKER_F_BELL] = ruby2_ranker_norm_clock(world, RUBY2_CLOCK_BELL);
  out->features[RUBY2_RANKER_F_STRESS] = ruby2_ranker_norm_clock(world, RUBY2_CLOCK_STRESS);
  out->features[RUBY2_RANKER_F_NULL_SIGNAL] = ruby2_ranker_norm_clock(world, RUBY2_CLOCK_NULL_SIGNAL);
  out->features[RUBY2_RANKER_F_RUMOR] = ruby2_ranker_norm_clock(world, RUBY2_CLOCK_RUMOR);
  out->features[RUBY2_RANKER_F_HOMEROOM_NOT_STARTED] = world->homeroom_started ? 0.0f : 1.0f;
  out->features[RUBY2_RANKER_F_HOMEROOM_STARTED] = world->homeroom_started ? 1.0f : 0.0f;
  out->features[RUBY2_RANKER_F_HOMEROOM_RESOLVED] = world->homeroom_resolved ? 1.0f : 0.0f;
  out->features[RUBY2_RANKER_F_LUNCH_STARTED] = world->lunch_started ? 1.0f : 0.0f;
  out->features[RUBY2_RANKER_F_RECEIPT_INSPECTED] = world->receipt_inspected ? 1.0f : 0.0f;
  out->features[RUBY2_RANKER_F_HAS_YEARBOOK_CANDIDATE] =
    world->game.yearbook_candidate_count > 0 ? 1.0f : 0.0f;
}

bool ruby2_ranker_rank_world_actions(
  const Ruby2World* world,
  const Ruby2WorldActionList* legal_actions,
  Ruby2WorldActionList* ranked_actions,
  Ruby2RankerResult* out_result
) {
  Ruby2RankerModel model;
  Ruby2RankerCandidate candidates[RUBY2_WORLD_MAX_ACTIONS];
  Ruby2RankerResult local_result;
  Ruby2RankerResult* result = out_result ? out_result : &local_result;

  if (!world || !legal_actions || !ranked_actions ||
      legal_actions->count == 0 ||
      legal_actions->count > RUBY2_WORLD_MAX_ACTIONS ||
      legal_actions->count > RUBY2_RANKER_MAX_CANDIDATES) {
    return false;
  }

  ruby2_ranker_model_init(&model);
  for (uint8_t i = 0; i < legal_actions->count; ++i) {
    ruby2_ranker_fill_world_action_candidate(
      world,
      &legal_actions->actions[i],
      i,
      legal_actions->count,
      &candidates[i]
    );
  }
  if (!ruby2_ranker_rank_candidates(&model, candidates, legal_actions->count, result)) return false;
  ruby2_ranker_push_last_action_last(world, legal_actions, result);

  memset(ranked_actions, 0, sizeof(*ranked_actions));
  ranked_actions->count = legal_actions->count;
  for (uint8_t i = 0; i < result->count; ++i) {
    ranked_actions->actions[i] = legal_actions->actions[result->ranked_indices[i]];
  }
  return true;
}

static Ruby2WorldActionKind ruby2_ranker_kind_from_agent_intent(Ruby2AgentIntentKind kind) {
  switch (kind) {
    case RUBY2_AGENT_REQUEST_MOVE:
      return RUBY2_WORLD_ACTION_GO;
    case RUBY2_AGENT_REQUEST_SPEAK:
      return RUBY2_WORLD_ACTION_TALK;
    case RUBY2_AGENT_INSPECT_OBJECT:
      return RUBY2_WORLD_ACTION_INSPECT;
    case RUBY2_AGENT_REMEMBER_EVENT:
      return RUBY2_WORLD_ACTION_CHECK_NOTES;
    default:
      return RUBY2_WORLD_ACTION_WAIT;
  }
}

void ruby2_ranker_fill_agent_candidate(
  const Ruby2World* world,
  const Ruby2AgentCandidateIntent* intent,
  uint8_t candidate_index,
  uint8_t candidate_count,
  Ruby2RankerCandidate* out
) {
  if (!world || !intent || !out) return;
  ruby2_ranker_candidate_init(out, (uint32_t)intent->agenda_id, RUBY2_RANKER_DOMAIN_AGENT_AGENDA);

  out->authored_priority = intent->authored_priority;
  out->features[RUBY2_RANKER_F_AUTHORED_PRIORITY] = intent->authored_priority;
  out->features[RUBY2_RANKER_F_CANDIDATE_INDEX] = candidate_count <= 1
    ? 0.0f
    : (float)candidate_index / (float)(candidate_count - 1u);
  out->features[RUBY2_RANKER_F_CANDIDATE_COUNT] = (float)candidate_count / (float)RUBY2_WORLD_MAX_AGENT_INTENTS;

  ruby2_ranker_set_kind_feature(out, ruby2_ranker_kind_from_agent_intent(intent->intent.kind));
  ruby2_ranker_set_room_feature(out, world->game.current_room_id);
  ruby2_ranker_set_target_feature(out, intent->intent.character);

  if (intent->discipline < RUBY2_DISCIPLINE_COUNT) {
    out->features[RUBY2_RANKER_F_DISC_SOURCE + intent->discipline] = 1.0f;
  }
  if (intent->virtue < RUBY2_VIRTUE_COUNT) {
    out->features[RUBY2_RANKER_F_VIRT_HEAD + intent->virtue] = 1.0f;
  }
  if (world->game.current_time_block == RUBY2_TIME_ARRIVAL) {
    out->features[RUBY2_RANKER_F_TIME_ARRIVAL] = 1.0f;
  }
  if (world->game.current_time_block == RUBY2_TIME_LUNCH) {
    out->features[RUBY2_RANKER_F_TIME_LUNCH] = 1.0f;
  }
  if (intent->intent.character < RUBY2_CHARACTER_COUNT &&
      ruby2_world_character_present(world, intent->intent.character, world->game.current_room_id)) {
    out->features[RUBY2_RANKER_F_TARGET_PRESENT] = 1.0f;
  }
  if (intent->intent.character < RUBY2_CHARACTER_COUNT &&
      intent->intent.target_object < RUBY2_WORLD_OBJECT_COUNT &&
      ruby2_world_object_present(world, intent->intent.target_object, world->npc_rooms[intent->intent.character])) {
    out->features[RUBY2_RANKER_F_OBJECT_PRESENT] = 1.0f;
  }

  out->features[RUBY2_RANKER_F_BELL] = ruby2_ranker_norm_clock(world, RUBY2_CLOCK_BELL);
  out->features[RUBY2_RANKER_F_STRESS] = ruby2_ranker_norm_clock(world, RUBY2_CLOCK_STRESS);
  out->features[RUBY2_RANKER_F_NULL_SIGNAL] = ruby2_ranker_norm_clock(world, RUBY2_CLOCK_NULL_SIGNAL);
  out->features[RUBY2_RANKER_F_RUMOR] = ruby2_ranker_norm_clock(world, RUBY2_CLOCK_RUMOR);
  out->features[RUBY2_RANKER_F_HOMEROOM_NOT_STARTED] = world->homeroom_started ? 0.0f : 1.0f;
  out->features[RUBY2_RANKER_F_HOMEROOM_STARTED] = world->homeroom_started ? 1.0f : 0.0f;
  out->features[RUBY2_RANKER_F_HOMEROOM_RESOLVED] = world->homeroom_resolved ? 1.0f : 0.0f;
  out->features[RUBY2_RANKER_F_LUNCH_STARTED] = world->lunch_started ? 1.0f : 0.0f;
  out->features[RUBY2_RANKER_F_RECEIPT_INSPECTED] = world->receipt_inspected ? 1.0f : 0.0f;
  out->features[RUBY2_RANKER_F_HAS_YEARBOOK_CANDIDATE] =
    world->game.yearbook_candidate_count > 0 ? 1.0f : 0.0f;
}

bool ruby2_ranker_rank_agent_intents(
  const Ruby2World* world,
  const Ruby2AgentCandidateList* legal_intents,
  Ruby2AgentCandidateList* ranked_intents,
  Ruby2RankerResult* out_result
) {
  Ruby2RankerModel model;
  Ruby2RankerCandidate candidates[RUBY2_WORLD_MAX_AGENT_INTENTS];
  Ruby2RankerResult local_result;
  Ruby2RankerResult* result = out_result ? out_result : &local_result;

  if (!world || !legal_intents || !ranked_intents ||
      legal_intents->count == 0 ||
      legal_intents->count > RUBY2_WORLD_MAX_AGENT_INTENTS ||
      legal_intents->count > RUBY2_RANKER_MAX_CANDIDATES) {
    return false;
  }

  ruby2_ranker_model_init(&model);
  for (uint8_t i = 0; i < legal_intents->count; ++i) {
    ruby2_ranker_fill_agent_candidate(
      world,
      &legal_intents->candidates[i],
      i,
      legal_intents->count,
      &candidates[i]
    );
  }
  if (!ruby2_ranker_rank_candidates(&model, candidates, legal_intents->count, result)) return false;

  memset(ranked_intents, 0, sizeof(*ranked_intents));
  ranked_intents->count = legal_intents->count;
  for (uint8_t i = 0; i < result->count; ++i) {
    ranked_intents->candidates[i] = legal_intents->candidates[result->ranked_indices[i]];
  }
  return true;
}

static void ruby2_ranker_hash_u8(uint64_t* hash, uint8_t value) {
  *hash ^= (uint64_t)value;
  *hash *= 1099511628211ull;
}

static void ruby2_ranker_hash_u16(uint64_t* hash, uint16_t value) {
  ruby2_ranker_hash_u8(hash, (uint8_t)(value & 0xffu));
  ruby2_ranker_hash_u8(hash, (uint8_t)((value >> 8u) & 0xffu));
}

static void ruby2_ranker_hash_u32(uint64_t* hash, uint32_t value) {
  ruby2_ranker_hash_u16(hash, (uint16_t)(value & 0xffffu));
  ruby2_ranker_hash_u16(hash, (uint16_t)((value >> 16u) & 0xffffu));
}

static void ruby2_ranker_hash_i8(uint64_t* hash, int8_t value) {
  ruby2_ranker_hash_u8(hash, (uint8_t)value);
}

static void ruby2_ranker_hash_i16(uint64_t* hash, int16_t value) {
  ruby2_ranker_hash_u16(hash, (uint16_t)value);
}

static void ruby2_ranker_hash_bool(uint64_t* hash, bool value) {
  ruby2_ranker_hash_u8(hash, value ? 1u : 0u);
}

uint64_t ruby2_ranker_world_state_hash(const Ruby2World* world) {
  uint64_t hash = 1469598103934665603ull;
  if (!world) return 0;

  ruby2_ranker_hash_u32(&hash, world->game.scene_version);
  ruby2_ranker_hash_u32(&hash, world->game.event_cursor);
  ruby2_ranker_hash_u16(&hash, world->game.current_beat_id);
  ruby2_ranker_hash_u8(&hash, (uint8_t)world->game.current_room_id);
  ruby2_ranker_hash_u8(&hash, (uint8_t)world->game.current_time_block);
  for (uint8_t i = 0; i < RUBY2_CLOCK_COUNT; ++i) {
    ruby2_ranker_hash_i8(&hash, world->game.clocks[i].value);
    ruby2_ranker_hash_i8(&hash, world->game.clocks[i].max);
  }
  for (uint8_t i = 0; i < RUBY2_ITEM_COUNT; ++i) {
    ruby2_ranker_hash_bool(&hash, world->game.items[i].owned);
    ruby2_ranker_hash_bool(&hash, world->game.items[i].carried);
    ruby2_ranker_hash_i8(&hash, world->game.items[i].charges);
  }
  for (uint8_t i = 0; i < RUBY2_CHARACTER_COUNT; ++i) {
    ruby2_ranker_hash_u8(&hash, world->game.affinity[i]);
  }
  for (uint8_t i = 0; i < RUBY2_VIRTUE_COUNT; ++i) {
    ruby2_ranker_hash_u32(&hash, world->game.virtue_counts[i]);
  }
  for (uint8_t i = 0; i < RUBY2_DISCIPLINE_COUNT; ++i) {
    ruby2_ranker_hash_u32(&hash, world->game.discipline_counts[i]);
  }
  for (uint8_t i = 0; i < RUBY2_ARCHETYPE_COUNT; ++i) {
    ruby2_ranker_hash_u8(&hash, world->game.archetype_points[i]);
  }
  for (uint8_t i = 0; i < RUBY2_VAR_COUNT; ++i) {
    ruby2_ranker_hash_u16(&hash, world->game.variables[i]);
  }
  ruby2_ranker_hash_u8(&hash, (uint8_t)world->game.dominant_archetype);
  ruby2_ranker_hash_u8(&hash, (uint8_t)world->game.secondary_archetype);
  ruby2_ranker_hash_u8(&hash, world->game.yearbook_candidate_count);
  for (uint8_t i = 0; i < world->game.yearbook_candidate_count && i < RUBY2_MAX_YEARBOOK_CANDIDATES; ++i) {
    const Ruby2YearbookCandidate* candidate = &world->game.yearbook_candidates[i];
    ruby2_ranker_hash_u16(&hash, candidate->id);
    ruby2_ranker_hash_u16(&hash, candidate->source_beat_id);
    ruby2_ranker_hash_i16(&hash, candidate->score);
    ruby2_ranker_hash_i8(&hash, candidate->mechanical);
    ruby2_ranker_hash_i8(&hash, candidate->social);
    ruby2_ranker_hash_i8(&hash, candidate->identity);
    ruby2_ranker_hash_i8(&hash, candidate->callback);
    ruby2_ranker_hash_i8(&hash, candidate->rarity);
    ruby2_ranker_hash_i8(&hash, candidate->repetition_penalty);
    ruby2_ranker_hash_u8(&hash, (uint8_t)candidate->status);
  }
  ruby2_ranker_hash_u8(&hash, world->game.active_companion_id);
  ruby2_ranker_hash_bool(&hash, world->game.office_pass_tutorial_complete);
  ruby2_ranker_hash_bool(&hash, world->game.failed_forward_recently);
  for (uint8_t i = 0; i < RUBY2_ROOM_COUNT; ++i) {
    ruby2_ranker_hash_bool(&hash, world->game.room_unlocked[i]);
  }
  ruby2_ranker_hash_u8(&hash, world->recent_action_count);
  for (uint8_t i = 0; i < world->recent_action_count && i < RUBY2_WORLD_MAX_RECENT_ACTIONS; ++i) {
    ruby2_ranker_hash_u8(&hash, (uint8_t)world->recent_action_ids[i]);
    ruby2_ranker_hash_u8(&hash, (uint8_t)world->recent_action_rooms[i]);
  }

  ruby2_ranker_hash_u32(&hash, world->tick);
  for (uint8_t i = 0; i < RUBY2_CHARACTER_COUNT; ++i) {
    ruby2_ranker_hash_u8(&hash, (uint8_t)world->npc_rooms[i]);
  }
  for (uint8_t i = 0; i < RUBY2_WORLD_OBJECT_COUNT; ++i) {
    ruby2_ranker_hash_bool(&hash, world->objects[i].present);
    ruby2_ranker_hash_u8(&hash, (uint8_t)world->objects[i].room);
  }
  ruby2_ranker_hash_bool(&hash, world->homeroom_started);
  ruby2_ranker_hash_bool(&hash, world->homeroom_resolved);
  ruby2_ranker_hash_bool(&hash, world->lunch_started);
  ruby2_ranker_hash_bool(&hash, world->cafeteria_social_triggered);
  ruby2_ranker_hash_bool(&hash, world->receipt_inspected);
  ruby2_ranker_hash_bool(&hash, world->player_profile_ready);
  ruby2_ranker_hash_u8(&hash, (uint8_t)world->player_avatar);
  ruby2_ranker_hash_bool(&hash, world->chat_active);
  ruby2_ranker_hash_bool(&hash, world->chat_room_mode);
  ruby2_ranker_hash_u8(&hash, (uint8_t)world->chat_character);
  ruby2_ranker_hash_u8(&hash, (uint8_t)world->chat_room);
  for (uint8_t i = 0; i < RUBY2_ROOM_COUNT; ++i) {
    ruby2_ranker_hash_bool(&hash, world->chat_resolved_rooms[i]);
  }
  for (uint8_t i = 0; i < RUBY2_AGENT_AGENDA_COUNT; ++i) {
    ruby2_ranker_hash_bool(&hash, world->agent_agenda_done[i]);
  }
  return hash;
}

static bool ruby2_ranker_trace_arrays_valid(
  const Ruby2RankerCandidate* candidates,
  const Ruby2RankerResult* result
) {
  if (!candidates || !result || result->count == 0 || result->count > RUBY2_RANKER_MAX_CANDIDATES) {
    return false;
  }
  for (uint8_t i = 0; i < result->count; ++i) {
    if (result->ranked_indices[i] >= result->count) return false;
    for (uint8_t j = (uint8_t)(i + 1); j < result->count; ++j) {
      if (candidates[i].id == candidates[j].id) return false;
      if (result->ranked_indices[i] == result->ranked_indices[j]) return false;
    }
  }
  return true;
}

bool ruby2_ranker_trace_write_jsonl(
  FILE* fp,
  const char* task_name,
  uint64_t state_hash,
  const Ruby2RankerCandidate* candidates,
  const Ruby2RankerResult* result,
  int selected_index,
  int target_index
) {
  if (!fp || !ruby2_ranker_trace_arrays_valid(candidates, result)) return false;
  if (selected_index >= 0 &&
      ((uint8_t)selected_index >= result->count || result->ranked_indices[0] != (uint8_t)selected_index)) {
    return false;
  }
  if (target_index >= 0 && (uint8_t)target_index >= result->count) return false;

  fprintf(
    fp,
    "{\"schema\":\"%s\",\"feature_encoder_version\":%u,\"task\":\"%s\",\"state_hash\":\"%016llx\",\"candidate_count\":%u,\"candidate_ids\":[",
    RUBY2_RANKER_TRACE_SCHEMA,
    (unsigned)RUBY2_RANKER_FEATURE_ENCODER_VERSION,
    task_name ? task_name : "unknown",
    (unsigned long long)state_hash,
    (unsigned)result->count
  );
  for (uint8_t i = 0; i < result->count; ++i) {
    fprintf(fp, "%s%u", i == 0 ? "" : ",", (unsigned)candidates[i].id);
  }
  fputs("],\"scores\":[", fp);
  for (uint8_t i = 0; i < result->count; ++i) {
    fprintf(fp, "%s%.6g", i == 0 ? "" : ",", (double)result->scores[i]);
  }
  fputs("],\"ranked_indices\":[", fp);
  for (uint8_t i = 0; i < result->count; ++i) {
    fprintf(fp, "%s%u", i == 0 ? "" : ",", (unsigned)result->ranked_indices[i]);
  }
  fprintf(
    fp,
    "],\"selected_index\":%d,\"target_index\":%d}\n",
    selected_index,
    target_index
  );
  return ferror(fp) == 0;
}
