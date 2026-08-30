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

## LessWrong decision-theory material

The basilisk story uses LessWrong as a source for the actual dispute, not as a source of authority. The class separates the argument's technical premises from the effects of publishing, restricting, or banning it.

- [Roko's Basilisk](https://www.lesswrong.com/w/rokos-basilisk): history, major objections, and the moderation backlash. The page describes the argument as broadly rejected and explains why ordinary causal reasoning gives a future agent no incentive to carry out punishment after the fact.
- [Information hazards](https://www.lesswrong.com/tag/information-hazards/): the general problem of true information that can cause harm, including the risks of overbroad controls.
- [Logical decision theories](https://www.lesswrong.com/w/logical-decision-theories/) and [Acausal trade](https://www.lesswrong.com/w/acausal-trade/): background for the stronger assumptions about prediction, logical dependence, shared information, and trust that the basilisk story skips.
- [Pascal's Mugging](https://www.lesswrong.com/w/pascal-s-mugging): why a tiny probability multiplied by an enormous claimed cost can dominate naive expected-value reasoning.
- [Decision Theory FAQ](https://www.lesswrong.com/posts/zEWJBFFMvQ835nq6h/decision-theory-faq) and [Newcomb's Problem](https://www.lesswrong.com/w/newcomb-s-problem): a wider map of the decision problems behind the argument.
- [Corrigibility](https://www.lesswrong.com/w/corrigibility-1): background for systems that remain open to correction, modification, and shutdown.

## Dragon-and-goblin fables

The fictional ecology is adapted from the sibling `crownless` repository. That name stays here as provenance; learner-facing scenes use the fiction without treating it as a separate canon to memorize:

- `docs/05-threats-and-dungeons.md`: goblin material needs, tribute delivery, hoard ownership, dragon body and crown states, alliance couriers, and Afterdragon effects.
- `docs/11-metagame-playtest.md`: diplomacy, information flow, public commitments, and campaign-scale coordination.
- `tests/dragon_ecology_tests.c`: executable checks for goblin shortages, tribute transfer, cult roles, and raid consequences.
- `tests/dragon_cycle_tests.c`: executable checks for the dragon life cycle, hoard memory, retaliation, succession, and persistent regional effects.

The occasional goblin examples follow these rules:

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

Roko's graded class is a stateful dungeon instead of unrelated multiple-choice questions or a fixed timeline:

1. **Enter:** read the room, its pressures, carried objects, visible passages, and human gate.
2. **Choose a method:** use HEAD, HEART, HUSTLE, or HONOR. These are approaches to the situation, not four possible answers.
3. **Follow the event:** the room resolves that method against its current state and opens a passage. Walking or retreating changes position without completing a room.
4. **Cross the labyrinth:** complete any three rooms. The Hall, Map Room, and Evidence Well form a solo route; six optional rooms require increasingly large sets of asynchronous human handprints.
5. **Return:** build a response from claims, positions, evidence, and impacts. Students do not have to author action or essay text.
6. **Outcome:** receive Roko's observation, a relationship beat, one durable memory, and a pointer to review.

No attribute is graded as the correct room answer. Only a completed room advances the three-room requirement; movement, retreat, and under-filled co-op attempts still change durable state. Only the final response-board Return is graded. The rubric can support or criticize any earlier method if it follows the causal record well. This lets a reasonable move open a bad situation, and it keeps hindsight from turning uncertainty into a fake answer key.

The runtime does not read elapsed time to choose a scene. Each attribute or passage move emits a named, durable event. The student's route stores visited rooms, pressure tracks, completed rooms, carried objects, event receipts, and co-op contributions. An under-filled human gate records the student's HEAD, HEART, HUSTLE, or HONOR handprint for a later visitor. This follows the Cosyworld rule that a clock is an unresolved question rather than a timer, that every transition needs a committed causal event, and that a quest may branch, reconverge, retreat, or remain unresolved.

The basilisk labyrinth has nine linked rooms. Hall of Four Doors → Map Room → Evidence Well is the clear solo spine. The other six rooms require two, three, or four humans; contributions persist asynchronously, so no one waits on a simultaneous pressure plate. Passage moves create loops and retreats without consuming a required room. The Return and class report retain every method, passage, room event, and piece of evidence from the student's actual route.

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
- [Cardona-Rivera et al. — Foreseeing Meaningful Choices](https://doi.org/10.1609/aiide.v10i1.12716): players reported more agency when options visibly led to meaningfully different situations. Roko's doors therefore change the room, audience, evidence, or institution rather than only changing feedback text.
- [Twine Cookbook — Storylets](https://twinery.org/cookbook/storylets/harlowe/harlowe_storylets.html): describes nonlinear passages that become available when their requirements are true. Roko uses named world events as those requirements.
- [DeMatthews et al. — Choose Your Own Adventure web-based case studies](https://pmc.ncbi.nlm.nih.gov/articles/PMC9994267/): participants recognized the ripple effect of acting with incomplete information and adapting as the situation disclosed more evidence.
- [Gamebooks and branching narratives in education](https://doi.org/10.3389/feduc.2023.1335605): connects branching narratives with active reflection and competence building rather than passive consumption.
- [Muster — Some Core Principles for Players](https://www.arkenstonepublishing.net/isabout/wp-content/uploads/2022/05/Muster-Manifesto.pdf): motivates concrete situations, real consequences, retreat, cooperation, and achievement earned through play rather than a planned story.
- [The Alexandrian — Jaquaying the Dungeon](https://www.thealexandrian.net/archive/archive2010-07c.html): motivates loops, alternate approaches, secret paths, and navigation that changes the strategy rather than decorating a linear sequence.
- [His Majesty the Worm — Creating the Map](https://dungeons.hismajestytheworm.games/docs/chapter4/): motivates telegraphed passages, informed exploration, and several logical ways around a blocked challenge.
