#ifndef RUBY2_RANKER_H
#define RUBY2_RANKER_H

#include "ruby2_world.h"

#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>

#define RUBY2_RANKER_FEATURE_COUNT 40
#define RUBY2_RANKER_MAX_CANDIDATES 32
#define RUBY2_RANKER_TRACE_SCHEMA "ruby2.ranker.trace.v1"
#define RUBY2_RANKER_FEATURE_ENCODER_VERSION 1u

typedef enum {
  RUBY2_RANKER_DOMAIN_WORLD_ACTION,
  RUBY2_RANKER_DOMAIN_AGENT_AGENDA,
  RUBY2_RANKER_DOMAIN_LLM_PREGEN,
  RUBY2_RANKER_DOMAIN_YEARBOOK
} Ruby2RankerDomain;

typedef enum {
  RUBY2_RANKER_F_KIND_GO,
  RUBY2_RANKER_F_KIND_TALK,
  RUBY2_RANKER_F_KIND_ATTEND,
  RUBY2_RANKER_F_KIND_APPROACH,
  RUBY2_RANKER_F_KIND_USE_ITEM,
  RUBY2_RANKER_F_KIND_CHECK_NOTES,
  RUBY2_RANKER_F_KIND_WAIT,
  RUBY2_RANKER_F_DISC_SOURCE,
  RUBY2_RANKER_F_DISC_SENSE,
  RUBY2_RANKER_F_DISC_SYNC,
  RUBY2_RANKER_F_DISC_SIGNAL,
  RUBY2_RANKER_F_VIRT_HEAD,
  RUBY2_RANKER_F_VIRT_HEART,
  RUBY2_RANKER_F_VIRT_HUSTLE,
  RUBY2_RANKER_F_VIRT_HONOR,
  RUBY2_RANKER_F_ROOM_HALLWAY,
  RUBY2_RANKER_F_ROOM_HOMEROOM,
  RUBY2_RANKER_F_ROOM_CAFETERIA,
  RUBY2_RANKER_F_TIME_ARRIVAL,
  RUBY2_RANKER_F_TIME_LUNCH,
  RUBY2_RANKER_F_TARGET_PRESENT,
  RUBY2_RANKER_F_ITEM_PRESENT,
  RUBY2_RANKER_F_TARGET_RUBY,
  RUBY2_RANKER_F_TARGET_LYRA,
  RUBY2_RANKER_F_TARGET_RAVI,
  RUBY2_RANKER_F_TARGET_NOOR,
  RUBY2_RANKER_F_BELL,
  RUBY2_RANKER_F_STRESS,
  RUBY2_RANKER_F_NULL_SIGNAL,
  RUBY2_RANKER_F_RUMOR,
  RUBY2_RANKER_F_CANDIDATE_INDEX,
  RUBY2_RANKER_F_CANDIDATE_COUNT,
  RUBY2_RANKER_F_AUTHORED_PRIORITY,
  RUBY2_RANKER_F_HOMEROOM_NOT_STARTED,
  RUBY2_RANKER_F_HOMEROOM_STARTED,
  RUBY2_RANKER_F_HOMEROOM_RESOLVED,
  RUBY2_RANKER_F_LUNCH_STARTED,
  RUBY2_RANKER_F_LUNCH_TRAY_USED,
  RUBY2_RANKER_F_HAS_YEARBOOK_CANDIDATE,
  RUBY2_RANKER_F_KIND_COLLECT
} Ruby2RankerFeature;

typedef struct {
  uint32_t id;
  Ruby2RankerDomain domain;
  bool legal;
  float authored_priority;
  float features[RUBY2_RANKER_FEATURE_COUNT];
} Ruby2RankerCandidate;

typedef struct {
  float bias;
  float weights[RUBY2_RANKER_FEATURE_COUNT];
  uint32_t feature_encoder_version;
  const char* model_hash;
} Ruby2RankerModel;

typedef struct {
  uint8_t count;
  uint8_t ranked_indices[RUBY2_RANKER_MAX_CANDIDATES];
  float scores[RUBY2_RANKER_MAX_CANDIDATES];
} Ruby2RankerResult;

void ruby2_ranker_model_init(Ruby2RankerModel* model);
void ruby2_ranker_candidate_init(Ruby2RankerCandidate* candidate, uint32_t id, Ruby2RankerDomain domain);
bool ruby2_ranker_rank_candidates(
  const Ruby2RankerModel* model,
  const Ruby2RankerCandidate* candidates,
  uint8_t count,
  Ruby2RankerResult* out
);
void ruby2_ranker_fill_world_action_candidate(
  const Ruby2World* world,
  const Ruby2WorldAction* action,
  uint8_t candidate_index,
  uint8_t candidate_count,
  Ruby2RankerCandidate* out
);
bool ruby2_ranker_rank_world_actions(
  const Ruby2World* world,
  const Ruby2WorldActionList* legal_actions,
  Ruby2WorldActionList* ranked_actions,
  Ruby2RankerResult* out_result
);
void ruby2_ranker_fill_agent_candidate(
  const Ruby2World* world,
  const Ruby2AgentCandidateIntent* intent,
  uint8_t candidate_index,
  uint8_t candidate_count,
  Ruby2RankerCandidate* out
);
bool ruby2_ranker_rank_agent_intents(
  const Ruby2World* world,
  const Ruby2AgentCandidateList* legal_intents,
  Ruby2AgentCandidateList* ranked_intents,
  Ruby2RankerResult* out_result
);
uint64_t ruby2_ranker_world_state_hash(const Ruby2World* world);
bool ruby2_ranker_trace_write_jsonl(
  FILE* fp,
  const char* task_name,
  uint64_t state_hash,
  const Ruby2RankerCandidate* candidates,
  const Ruby2RankerResult* result,
  int selected_index,
  int target_index
);

#endif
