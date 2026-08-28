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

## Case-class learning design

Roko's graded class is an authored three-beat case instead of three unrelated multiple-choice questions:

1. **Investigate:** read a scene and compare three evidence cards.
2. **Decide:** choose an action and see its immediate story consequence.
3. **Explain:** write a short causal explanation in the student's own words.
4. **Outcome:** receive Roko's observation, a relationship beat, one durable memory, and a pointer to later review.

The old question bank remains useful. It now acts as spaced practice after the case, where short factual retrieval is a better fit. This split follows evidence that retrieval practice with feedback can improve retention, while short-answer and multiple-choice retrieval can both work. The class itself adds self-explanation because recognition alone does not show whether the student can state the causal link.

The story is instructional, not decoration. Every scene exposes facts needed by the decision, and the final explanation points attention back to the learning goal. Research on narrative learning games warns that narrative can distract from the academic content when players are not prompted to reflect on it. Roko therefore asks for a short explanation inside the story rather than showing a cutscene after an unrelated quiz.

The relationship beat borrows the useful part of mobile otome and dating-sim structure: a character remembers a meaningful choice, and suspense carries the player into the next episode. Research on Japanese mobile otome games describes character desire and story-progress gates as linked narrative strategies. Ruby High does **not** copy paid random pulls, stamina pressure, or monetized affection. The reward is authored feedback and continuity, not a chance-based relationship item.

### Learning-design sources

- [Lipko-Speed et al. — Does testing with feedback help grade-school children learn key concepts in science?](https://doi.org/10.1016/j.jarmac.2014.04.002): supports keeping retrieval plus corrective feedback in later review.
- [Smith and Karpicke — Retrieval practice with short-answer, multiple-choice, and hybrid tests](https://doi.org/10.1080/09658211.2013.831454): found retention benefits across the tested retrieval formats; supports a mixed format instead of deleting MCQ entirely.
- [Chi et al. — Self-explanations: How students study and use examples in learning to solve problems](https://education.asu.edu/lcl/publications/chi-m-t-h-bassok-m-lewis-m-reimann-p-glaser-r-1989-self-explanations-how-students): foundational evidence for eliciting causal self-explanation from worked examples.
- [Fiorella and Mayer — Improving academic learning from computer-based narrative games](https://doi.org/10.1016/j.cedpsych.2015.12.002): found that an in-game explanation worksheet improved learning without reducing enjoyment; supports putting reflection inside the episode.
- [Ryan and Deci — Self-determination theory and the facilitation of intrinsic motivation, social development, and well-being](https://pubmed.ncbi.nlm.nih.gov/11392867/): motivates giving the student agency, clear competence feedback, and a continuing relationship with the teacher.
- [Sellier — Mobile Otome Games: Desire and Suspense as Economic Strategy](https://doi.org/10.34382/00014542): analyzes character gacha and progress gates in four games from Japanese studios. Ruby High borrows story continuity and remembered character response, while rejecting monetized random rewards.
