# Ruby Research Corpus

Ruby's built-in course is the school spine: AI literacy, agent culture, networked systems, and enough general computing/on-chain history to make the classroom feel contemporary. These notes are intentionally compact source cards. The engine can ask them as typed-answer cards immediately, and the existing MC generator can turn any card into multiple-choice when AI access is connected.

## Teacher Dossier

Ruby teaches like the school itself is an argument about agency. Her classroom starts with practical digital literacy, but her real subject is how a person keeps judgment when software becomes social, persuasive, and partly autonomous. She likes questions that expose the difference between convenience and control: a tool can be helpful, but the student is still responsible for what they authorize, repeat, submit, or publish.

Ruby's research interests:

- AI application design: system prompts, tool schemas, retrieval, streaming UX, structured outputs, evals, and model routing.
- Agent reliability: idempotency, retries, failure recovery, bounded permissions, dirty worktrees, audit trails, and user confirmation before irreversible actions.
- Networked systems: HTTP, TLS, DNS, OAuth, webhooks, databases, indexes, rate limits, consistency, and smoke tests.
- On-chain literacy: wallets, mint authorities, commit-reveal schemes, nonces, Merkle proofs, replay resistance, and why cryptographic language must be precise.
- Classroom ethics: what should be shared with classmates, what should stay private, when confidence is useful, and when confidence is dangerous.

## Reading List

- AI application design notes: system prompts, retrieval, structured outputs, evals, and model routing.
- Agent operations notes: least privilege, idempotency, retries, dirty worktrees, audit trails, and human confirmation.
- Networked systems notes: HTTP, TLS, DNS, OAuth, webhooks, database indexes, rate limits, and smoke tests.
- On-chain fairness notes: wallets, mint authorities, nonces, Merkle proofs, replay resistance, and commit-reveal verification.

## Course Arc

Freshman Ruby is a gateway: common web terms, basic AI vocabulary, and enough internet history to make the app feel legible. A good freshman question should be quick, concrete, and confidence-building.

Sophomore Ruby becomes operational: students start distinguishing prompts from policies, retrieval from memory, OAuth from passwords, and useful automation from uncontrolled side effects. Questions should ask "what problem does this solve?" and "what failure does this prevent?"

Junior Ruby becomes architectural: evals, grounding, context limits, tool schemas, idempotency, model routing, and distributed-state tradeoffs. Questions should reward students who can reason from a symptom to a system design choice.

Senior Ruby becomes ethical and adversarial: prompt injection, least privilege, irreversible tools, secret handling, replay resistance, and commit-reveal fairness. Questions should feel like judgment calls, not trivia.

## Grade Research Briefs

- Grade 9: Keep Ruby's freshman set concrete: vocabulary, permissions, context windows, BYOK, streaming, retrieval, and small classroom decisions.
- Grade 10: Move sophomores into operations: prompts versus policies, OAuth versus passwords, retrieval versus memory, and automation with bounded side effects.
- Grade 11: Ask juniors to reason architecturally: evals, grounding, structured tool calls, idempotency, model routing, indexes, and consistency tradeoffs.
- Grade 12: Make senior questions adversarial and ethical: prompt injection, secret handling, least privilege, replay resistance, commit-reveal fairness, and public/private boundaries.

## Misconceptions Ruby Likes To Catch

Students often think a larger model context means perfect recall; Ruby wants them to know relevance can degrade even when the text technically fits. Students confuse chat history with durable memory; Ruby emphasizes that memory is selected state. Students treat model refusal as if it were app authorization; Ruby insists the app controls tools and data boundaries. Students think blockchain fairness is automatic; Ruby asks which secret is committed, when it is revealed, and who can verify it.

Canonical misconception checks:

- A bigger context window means perfect recall.
- Chat history is the same thing as durable memory.
- A model refusal policy is the same thing as app authorization.
- Putting a game on-chain automatically makes every outcome fair.
- An agent can safely retry irreversible tools without idempotency or confirmation.

## Multiplayer Hooks

Ruby's best classroom questions can produce debate between students. Lyra tends to ask whether a design is kind to the user. Sami may care whether the system is funny or socially legible. Ravi looks for implementation risks. Indra notices whether incentives can be gamed. Mika asks whether the interface makes responsibility visible. Noor asks who gets trusted by default. Generated questions should occasionally invite this social texture while still having one correct MC answer.

| id | subject | difficulty | front | back | tags |
| --- | --- | --- | --- | --- | --- |
| ruby-corpus-001 | ai-literacy | easy | What does a model context window limit? | The amount of information the model can consider at once | ai,context |
| ruby-corpus-002 | ai-literacy | easy | What is a system prompt usually meant to set? | The assistant's role, rules, and high-level behavior | ai,prompts |
| ruby-corpus-003 | ai-literacy | easy | What does retrieval add to an AI app? | Relevant external information at answer time | ai,retrieval |
| ruby-corpus-004 | ai-literacy | easy | What is a hallucination in an AI answer? | A confident claim that is not supported by reality or context | ai,reliability |
| ruby-corpus-005 | ai-literacy | easy | What does temperature mainly affect in text generation? | Randomness and variety of the model's next-token choices | ai,generation |
| ruby-corpus-006 | ai-literacy | easy | What is BYOK short for? | Bring your own key | ai,accounts |
| ruby-corpus-007 | ai-literacy | easy | What is an embedding used for? | Representing meaning as numbers for similarity search | ai,retrieval |
| ruby-corpus-008 | ai-literacy | easy | What should an AI app do before sending private data to another service? | Get clear permission or use an already authorized path | ai,safety |
| ruby-corpus-009 | ai-literacy | easy | What does streaming improve in chat UI? | The perceived wait by showing tokens as they arrive | ai,ux |
| ruby-corpus-010 | ai-literacy | easy | What is a prompt injection trying to override? | The app's instructions or the user's intent | ai,safety |
| ruby-corpus-011 | ai-literacy | medium | Why is a small eval set useful before changing a prompt? | It catches regressions on examples the developer cares about | ai,evals |
| ruby-corpus-012 | ai-literacy | medium | What problem does grounding try to reduce? | Unsupported or invented claims | ai,reliability |
| ruby-corpus-013 | ai-literacy | medium | What is the risk of putting secrets in model-visible context? | The model can expose or misuse them through output or tools | ai,safety |
| ruby-corpus-014 | ai-literacy | medium | What is a tool call in an agent loop? | A structured request from the model for software to do work | ai,tools |
| ruby-corpus-015 | ai-literacy | medium | What does an idempotency key protect against? | Duplicate side effects after retries | ai,reliability |
| ruby-corpus-016 | ai-literacy | medium | Why should generated JSON be validated before use? | Models can return malformed or unsafe structure | ai,tools |
| ruby-corpus-017 | ai-literacy | medium | What is the main benefit of structured outputs? | They make model responses easier to validate and execute | ai,tools |
| ruby-corpus-018 | ai-literacy | medium | Why is a refusal policy not the same as app authorization? | The app still controls what tools and data the model may access | ai,safety |
| ruby-corpus-019 | ai-literacy | medium | What does RAG stand for? | Retrieval-augmented generation | ai,retrieval |
| ruby-corpus-020 | ai-literacy | medium | What should a model do when source context is insufficient? | Say it lacks enough evidence or ask for more context | ai,reliability |
| ruby-corpus-021 | ai-literacy | hard | Why can long-context recall still fail? | Attention and relevance can degrade even when text fits in the window | ai,context |
| ruby-corpus-022 | ai-literacy | hard | What is overfitting to an eval? | Tuning until scores improve on the eval without improving real behavior | ai,evals |
| ruby-corpus-023 | ai-literacy | hard | Why are tool schemas part of AI safety? | They constrain what actions are possible and how inputs are shaped | ai,tools |
| ruby-corpus-024 | ai-literacy | hard | What makes agent memory different from chat history? | Memory is selected durable state, not every prior message | ai,memory |
| ruby-corpus-025 | ai-literacy | hard | Why should retrieval cite source identifiers? | To make answers inspectable and easier to debug | ai,retrieval |
| ruby-corpus-026 | ai-literacy | hard | What is a latent prompt boundary? | An implicit division between trusted instructions and untrusted content | ai,safety |
| ruby-corpus-027 | ai-literacy | hard | Why should AI tools return structured errors? | The model and app can recover without guessing from prose | ai,tools |
| ruby-corpus-028 | ai-literacy | hard | What does model routing optimize in a production app? | Cost, latency, capability, and reliability per task | ai,systems |
| ruby-corpus-029 | ai-literacy | hard | What is a judge model used for in evals? | Scoring outputs when exact string matches are not enough | ai,evals |
| ruby-corpus-030 | ai-literacy | hard | Why is hidden chain-of-thought not an audit log? | It is not a stable, complete, or user-facing record of decisions | ai,safety |
| ruby-corpus-031 | agent-culture | easy | What should an agent do before deleting user data? | Ask for explicit confirmation | agents,safety |
| ruby-corpus-032 | agent-culture | easy | What is the safest default for a destructive action? | Pause and confirm the exact action | agents,safety |
| ruby-corpus-033 | agent-culture | easy | What should an agent preserve in a dirty worktree? | User changes it did not make | agents,coding |
| ruby-corpus-034 | agent-culture | easy | What is a good agent status update? | Short, specific, and tied to the work being done | agents,collaboration |
| ruby-corpus-035 | agent-culture | easy | What should an agent do after changing code? | Run relevant verification when feasible | agents,coding |
| ruby-corpus-036 | agent-culture | medium | Why should an agent read nearby code before editing? | Local patterns reveal the safest shape of the change | agents,coding |
| ruby-corpus-037 | agent-culture | medium | What is the risk of broad refactors during a narrow fix? | They increase review cost and regression risk | agents,coding |
| ruby-corpus-038 | agent-culture | medium | What does least-privilege mean for tool access? | Give only the permissions needed for the task | agents,safety |
| ruby-corpus-039 | agent-culture | medium | What should an agent do when a command is still running? | Wait, poll, or stop it before final handoff | agents,ops |
| ruby-corpus-040 | agent-culture | medium | Why are screenshots useful in frontend verification? | They catch layout failures tests may miss | agents,frontend |
| ruby-corpus-041 | agent-culture | hard | What is a race between external side effects and persistence? | The world changes but durable state fails to record it | agents,reliability |
| ruby-corpus-042 | agent-culture | hard | Why should retries be bounded? | Infinite retries can spend quota, duplicate work, or hide failure | agents,reliability |
| ruby-corpus-043 | agent-culture | hard | What makes a code-review finding actionable? | It names a concrete risk with file or behavior evidence | agents,review |
| ruby-corpus-044 | agent-culture | hard | Why should generated files have provenance? | Future maintainers need to know how to refresh them | agents,maintenance |
| ruby-corpus-045 | agent-culture | hard | What is the agent's job when instructions conflict? | Follow the newest applicable higher-priority instruction | agents,safety |
| ruby-corpus-046 | general-knowledge | easy | What does DNS resolve? | Domain names to network addresses and related records | web,networking |
| ruby-corpus-047 | general-knowledge | easy | What does TLS provide for HTTPS? | Encryption, integrity, and server authentication | web,security |
| ruby-corpus-048 | general-knowledge | easy | What is JSON mainly used for? | Exchanging structured data as text | web,data |
| ruby-corpus-049 | general-knowledge | easy | What does CSS control on a web page? | Presentation and layout | web,frontend |
| ruby-corpus-050 | general-knowledge | easy | What is a database index for? | Faster lookup of records by selected fields | systems,data |
| ruby-corpus-051 | general-knowledge | medium | What is optimistic UI? | Showing an expected result before the server confirms it | web,ux |
| ruby-corpus-052 | general-knowledge | medium | What does ACID describe in databases? | Atomicity, consistency, isolation, and durability | systems,data |
| ruby-corpus-053 | general-knowledge | medium | What is eventual consistency? | Replicas may differ briefly before converging | systems,data |
| ruby-corpus-054 | general-knowledge | medium | What does OAuth delegate? | Limited authorization without sharing the user's password | web,auth |
| ruby-corpus-055 | general-knowledge | medium | What is a webhook? | An HTTP callback sent when an event happens | web,integration |
| ruby-corpus-056 | general-knowledge | hard | What is a Merkle tree good for? | Proving data inclusion with compact hashes | crypto,data |
| ruby-corpus-057 | general-knowledge | hard | What is a nonce in cryptographic protocols? | A number used once to prevent replay or ensure freshness | crypto,security |
| ruby-corpus-058 | general-knowledge | hard | What is the main job of a rate limiter? | Control request volume over time | systems,reliability |
| ruby-corpus-059 | general-knowledge | hard | What does a commit-reveal scheme hide first and reveal later? | A chosen value committed by hash before the reveal | crypto,fairness |
| ruby-corpus-060 | general-knowledge | hard | What is the practical purpose of a smoke test? | Quickly check that the most important path still works | systems,testing |
