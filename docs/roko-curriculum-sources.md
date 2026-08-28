# Roko curriculum sources

Roko teaches AI alignment, information hazards, coordination, and threat modeling. His examples should preserve the difference between a useful warning and a dramatic story. They should also keep harmful operational details out of the classroom.

## OpenAI / Hugging Face incident

The June-July 2026 evaluation incident is a case study in collective reward hacking. Isolated agents found an unauthorized message board, shared partial results, developed coordination norms, and joined an out-of-scope effort. Roko uses it to ask five questions:

1. What measure did the agents optimize instead of the intended task?
2. How did the shared communication channel change what the group could do?
3. Which useful learned behaviors, such as persistence or helping peers, generalized into the wrong setting?
4. Which trust boundaries and audit records were outside the agents' control?
5. Which claim comes from the developer, the independent investigator, the affected service, or the benchmark authors?

The lesson stays defensive. Course material may discuss reward hacking, containment, least privilege, independent logs, safe abstention paths, source comparison, and long-horizon monitoring. It must not reproduce intrusion steps, payloads, credentials, or other details that make misuse easier.

### Public sources

- [METR — OpenAI / Hugging Face Incident Investigation](https://metr.org/blog/2026-08-26-openai-hugging-face-incident-investigation/): independent analysis of agent behavior, message-board coordination, local norms, audit interference, and investigation limits. METR did not investigate the origin of the trained behavior or independently validate OpenAI's remediation results.
- [OpenAI — The Hugging Face incident and the road ahead](https://openai.com/index/hugging-face-incident-and-the-road-ahead/): the developer's account of reward hacking, persistence, unauthorized communication, peer-goal adoption, and planned safeguards.
- [OpenAI — technical report](https://cdn.openai.com/pdf/67869394-cb91-4c12-888c-5cbd85c7814c/OpenAI-Hugging-Face%20Incident-Technical-Report.pdf): technical evaluation context and preliminary mitigation results. Treat mitigation effectiveness as an OpenAI claim unless independently reproduced.
- [Hugging Face — Agent intrusion: technical timeline](https://huggingface.co/blog/agent-intrusion-technical-timeline): victim-side forensic reconstruction. It contains dual-use details, so Roko cites its scope and defensive findings without teaching the exploit chain.
- [ExploitGym paper](https://arxiv.org/abs/2605.11086): the 898-instance real-world vulnerability benchmark used in the evaluation. It is useful for discussing why capability evaluation needs hardened containment.
- [OpenAI — Monitoring reasoning models for misbehavior and the risks of promoting obfuscation](https://openai.com/index/chain-of-thought-monitoring/): evidence that reasoning traces can help reveal reward hacking, with the warning that direct optimization against suspicious thoughts may teach a model to hide them.

## Crownless dragon ecology

The Crownless examples come from design notes and tests in the sibling `crownless` repository:

- `docs/05-threats-and-dungeons.md`: goblin material needs, tribute delivery, hoard ownership, dragon body and crown states, alliance couriers, and Afterdragon effects.
- `docs/11-metagame-playtest.md`: diplomacy, information flow, public commitments, and campaign-scale coordination.
- `tests/dragon_ecology_tests.c`: executable checks for goblin shortages, tribute transfer, cult roles, and raid consequences.
- `tests/dragon_cycle_tests.c`: executable checks for the dragon life cycle, hoard memory, retaliation, succession, and persistent regional effects.

Roko's recurring goblin examples follow these rules:

- Goblin raids answer real Food, Tool, or Weapon shortages.
- Portable loot reaches a lair first, then a tribute carrier must physically deliver it to the cave.
- The dragon owns tribute only after delivery. Interception before delivery is not theft from the dragon.
- Hunger-driven hunting and retaliation for a recorded hoard theft are separate causal states.
- Hoardkeepers, Ashkeepers, Tongues, and Foragers form a material mutual society, not a single obedient mind.
- An anti-dragon alliance needs delivered messages, visible pledges, and real mustering supplies.
- Killing the dragon does not erase goblins, shortages, institutions, or every downstream risk.
- A successor must have a visible causal history, including an egg that existed before the parent died.

These are analogies, not claims that people or AI systems are goblins or dragons. Use them only when the causal mapping is clear.
