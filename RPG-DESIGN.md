# Ruby High — RPG Mechanics Layer

> A light *Powered by the Apocalypse*-derived narrative RPG layered under the daily quiz. Each teacher and student is a character. Each player has a character sheet. Players graduate.

This document is the **mechanics** doc. For the strategic thesis (The Daily, qualitative grading, the Yearbook) see [`DESIGN.md`](./DESIGN.md). For the public pitch and architecture overview see [`README.md`](./README.md).

The RPG layer's job is **to make a daily session feel like progression**. Without dice, stats, conditions, strings, and graduations, every Daily would feel like an isolated quiz. With them, Tuesday's essay raises Lyra's String count, breaks your `anxious` Condition, and pushes you closer to closing out Junior year. The mechanics are not the product — they are the connective tissue that makes the product feel like a game instead of a worksheet.

It draws on PbtA (Vincent Baker), Dungeon World (CC BY 4.0), and Monsterhearts 2 (cited as inspiration, not forked — CC BY-NC-SA). The Ruby High system itself is released **CC BY 4.0** so anyone can build on it.

## 1. The school

**Four rooms.** Fixed. Not generated per faculty.

| Room | Teacher | What happens |
|---|---|---|
| `# homeroom` | Ruby | Day starts here. General knowledge, school lore, current events. |
| `# science` | Sally Science | STEM questions. Lab tools as flavor. |
| `# literature` | Professor Edward | Postwar lit, lit theory, mid-century. Tea served. |
| `# lounge` | All 3 (no quizzes) | Eavesdrop on the faculty. Spend Strings here. |

**Four years.** Player enters as Junior by default (configurable). Years gate question difficulty and unlock playbook moves.

| Year | Grade | Default difficulty |
|---|---|---|
| Freshman | 9 | easy |
| Sophomore | 10 | medium |
| Junior | 11 | medium |
| Senior | 12 | hard |

## 2. The cast

### Faculty (3 + lounge)

Already implemented as eliza app teacher characters with sticker portraits.

### Students (6 NPCs, deterministic pair per room/grade)

| Student | Vibe | LLM Model |
|---|---|---|
| Lyra | Anxious overachiever | claude-haiku-4.5 |
| Sami | Dry sarcastic chill | claude-haiku-4.5 |
| Ravi | Loud, obscure facts | claude-haiku-4.5 |
| Indra | Quiet, drops a perfect line | claude-haiku-4.5 |
| Mika | Bright supportive jock | claude-haiku-4.5 |
| Noor | Deadpan one-liner | claude-haiku-4.5 |

Each grade × room pairs 2 students stably:

```
              homeroom    science       literature
Freshman      Lyra+Mika   Sami+Ravi     Indra+Noor
Sophomore     Sami+Noor   Ravi+Mika     Lyra+Indra
Junior        Ravi+Indra  Lyra+Noor     Sami+Mika
Senior        Mika+Indra  Noor+Lyra     Ravi+Sami
```

Pairings rotate so the player sees every student-student combo across years.

## 3. The character sheet (player)

```ts
interface CharacterSheet {
  // Identity
  name: string;
  playbook: PlaybookId;
  arcAnswer: string;          // their answer to the playbook's hook question

  // Progression
  grade: Grade;
  graduated: boolean;
  yearbook: GraduatedYear[];  // archive of completed years

  // Stats (-1 to +3)
  stats: {
    head: number;     // recall / analytical
    heart: number;    // empathy / social
    hustle: number;   // speed / improvisation
    honor: number;    // discipline / integrity
  };

  // State
  conditions: Condition[];                    // Tired/Anxious/Hurt/Lonely
  strings: Record<string, number>;            // characterId -> count
  xp: number;
  unlockedMoves: string[];

  // Per-room progress this year
  classProgress: Record<RoomId, { correct: number; needed: number }>;
}
```

## 4. Resolution mechanic — 2d6 + stat

When you tap an answer in the viewer, the server rolls **2d6 + relevant stat** before scoring:

| Total | Outcome | Effect on the question |
|---|---|---|
| **10+** | Strong hit | Answer is graded normally. If correct: +2 XP; if wrong: GM softens the consequence (no Condition taken). |
| **7-9** | Mixed | Eliminate one wrong choice before locking in your pick. Answer is graded normally. If wrong: take +1 XP anyway as a "learning experience". |
| **6-** | Miss | The teacher locks the choice as soon as you tap it. If wrong: take a Condition. If correct: +1 XP, no condition. |

**Which stat** is rolled depends on the room + question:
- Homeroom/Lit/Sci: **HEAD** (default)
- Question tagged `social` or sourced from a Lounge encounter: **HEART**
- Time-pressured or "rapid fire" round: **HUSTLE**
- Refused-cheat questions or honor-coded prompts: **HONOR**

Players can **invoke a Condition** to swap which stat is rolled (e.g., "I'm Tired, this should be HEART not HEAD") — narrative justification, mechanical flexibility.

## 5. Playbooks (6 to choose from at character creation)

Each playbook has a stat array, a starting move, and a hook question whose answer becomes the character's `arcAnswer`. Stats sum to +2 (one +2, one +1, one 0, one -1).

### The Overachiever
- **Stats**: HEAD +2, HONOR +1, HEART 0, HUSTLE -1
- **Move — *Margins are sacred***: Once per year, retake one missed question.
- **Hook**: *Why is Cs not enough?*

### The Slacker
- **Stats**: HUSTLE +2, HEART +1, HEAD 0, HONOR -1
- **Move — *Wing it***: When you'd fail a HEAD roll, swap it for HUSTLE.
- **Hook**: *Who do you not want to disappoint?*

### The Heart
- **Stats**: HEART +2, HONOR +1, HUSTLE 0, HEAD -1
- **Move — *Pep talk***: Spend 1 String on an AI student to give them advantage on their next answer (you both gain XP if they hit).
- **Hook**: *Whose orbit are you stuck in?*

### The Outsider
- **Stats**: HONOR +2, HEAD +1, HEART 0, HUSTLE -1
- **Move — *Outside eyes***: Once per period, see the explanation for one question *before* answering, but you must write a one-line observation about the school in chat.
- **Hook**: *What did you leave behind?*

### The Class Clown
- **Stats**: HEART +2, HUSTLE +1, HONOR 0, HEAD -1
- **Move — *Crack the room***: When you'd miss a question, roll HEART instead of HEAD; on 10+ the question is voided for everyone (everyone's progress unaffected).
- **Hook**: *What can't you say without a joke?*

### The Lifer
- **Stats**: HEAD +1, HEART +1, HUSTLE +1, HONOR -1
- **Move — *Old gossip***: Start with 1 String on each faculty member.
- **Hook**: *What does this school owe you?*

## 6. Strings (relational currency)

A **String** is leverage one character holds on another. Earned through interaction, spent for narrative effect.

### Earning Strings

- Answer correctly *in front of* an NPC: 1 String on you (held by them) + 1 String on them (held by you).
- Console an NPC after they fail: 1 String on the NPC.
- Side with a teacher in a lounge debate: 1 String on the teacher.
- Refuse a hint when you needed it: 1 String on the room (a "reputation" String — usable on any NPC there).

### Spending Strings

| Spend | On | Effect |
|---|---|---|
| 1 | A teacher | Get a 50/50 hint on the current question. |
| 1 | A teacher | Skip the current question (no XP, no Condition). |
| 1 | A student | They answer the current question using *their* stat. You get the result either way. |
| 2 | A teacher | Hear a piece of gossip in chat — flavor only, no mechanical effect. |
| 3 | The lounge | Trigger a faculty debate — one new lounge thread plays out unprompted. |

NPCs can spend Strings on the player too. If a teacher holds 3+ Strings on you, they can call you up to the board (a forced HEAD roll on a question they pick).

## 7. Conditions

Stress / debuffs accumulated when you miss a roll on 6-.

| Condition | Mechanical effect | Cleared by |
|---|---|---|
| **Tired** | -1 to HUSTLE rolls | A "rest" — completing 3 questions or visiting the lounge once. |
| **Anxious** | -1 to HEAD rolls | An NPC consoles you (they spend 1 String on you). |
| **Hurt** | -1 to HONOR rolls | Beating a question on 10+ in homeroom. |
| **Lonely** | -1 to HEART rolls | Earning a String on any NPC. |

Conditions stack — multiple instances of the same stack and apply cumulatively, but max -3 to any single stat.

## 8. Progression — graduating

**Per year, each room** has a 5-correct threshold (existing mechanic). Cleared rooms get a red ✓ on the server-rail grade button.

**To advance years**, all three rooms (Homeroom + Science + Literature) must be cleared at the current grade. The lounge is optional but unlocks bonus XP.

**Graduation**: clear all 4 years. The player gets:
- A diploma screen (the `🎓` server-rail button replaces all grade buttons).
- Their character is archived to the **yearbook** (a persistent JSON of past CharacterSheets).
- They can start a new playthrough with a **mentor bonus**: pick any past graduate of the same playbook and inherit their `arcAnswer` as a quote on the new character's sheet, plus +1 String on every NPC you interact with this run.

## 9. How the mechanics serve The Daily

The mechanics in this doc exist to give The Daily (see `DESIGN.md`) **stakes, memory, and continuity** between sessions. Without them, every Daily is a one-shot quiz. With them:

- **Stakes**: a missed roll on Tuesday gives you `anxious`, which costs you on Wednesday's HEAD roll, which you'll want to clear before Friday's essay. Each session is haunted by the last.
- **Memory**: Strings track who you've talked to, who you've consoled, who's consoled you. The lounge becomes a place where conversations from earlier this week pay off.
- **Continuity**: grade progress accumulates across days. Five correct in Sally's room over a month closes Sophomore science. Closing all three rooms graduates the year. The yearbook page is the artifact.

A purely mechanical Daily (just MC + score) would have a flat retention curve: novelty for two weeks, then attrition. Mechanics with carry-over (Strings, Conditions, grade progress, the yearbook) compound — the longer you play, the more your character is *yours*.

## 10. Phasing

| Phase | Scope | Lift | Status |
|---|---|---|---|
| **0** | Stickers, lounge multi-teacher, LLM students, in-place blackboard. | Done. | ✅ |
| **1** | Restructure to fixed 4 rooms, deterministic 2 students per (grade, room). | Done. | ✅ |
| **2** | CharacterSheet schema + creation flow. Player picks playbook + stat distribution + arcAnswer on first launch. | Done. | ✅ |
| **3** | 2d6+stat rolling on every answer. Outcomes (10+/7-9/6-) modify scoring. Conditions on 6−. | Done (v0.5). | ✅ |
| **4** | Yearbook persistence on grade completion. Diploma screen on graduation. Mentor bonus on new playthroughs. | Small. Highest priority — gates the share artifact. | ⏭ next |
| **5** | Per-essay grade history persisted as a "Report Card" tab. Filter by teacher, see your average. | Medium. | |
| **6** | Strings ledger. Earning + spending UI (chip on each NPC's avatar). | Medium. Real-time relational currency. | |
| **7** | Move unlocks (each playbook gets 1 new move per year cleared). | Small. | |
| **8** | Question authoring upgrades — tag questions with `category: head \| heart \| hustle \| honor` so rolls feel meaningful. | Medium. | |
| **9** | Conditions clearable through specific Daily acts (the `anxious` clear flow from §7 wired into actual NPC chat triggers). | Small. | |

## 11. Open questions to settle

1. **Stat invocation by Conditions** — does the player choose to invoke, or is it auto-applied? (Lean: player chooses, narrative justification required in chat.)
2. **Multiplayer** — is each session a single-player run or do multiple students share a "class period"? (Lean: solo for now. Co-op is `DESIGN.md` Appendix B.)
3. **Save format** — keep CharacterSheet in `~/.ruby-high/state.json` or split into a separate `character.json`? (Lean: same file, new top-level key. Yearbook entries live on the character.)
4. **GM logic** — is the LLM the GM, or is the server the GM and the LLM just narrates? (Settled: server is GM (deterministic rules); LLM narrates outcomes. This is what makes scores cheat-proof.)
5. **String inflation** — at what point do players have too many Strings? (Cap at 3 per NPC.)
6. **Conditions in Opinion mode** — does a 6− on an essay's HEAD roll give `anxious`, or are essays graded differently? (Lean: essay scores feed XP only, no Conditions; the qualitative grade is the consequence.)
7. **Mentor mode at graduation** — is the mentor bonus narrative-only (a quote on the new sheet) or mechanical (+1 String per NPC)? (Lean: both, exactly as specified in §8.)

## 12. License

This design and the resulting code are released **CC BY 4.0**.

> Ruby High is inspired by *Apocalypse World* by D. Vincent Baker, *Dungeon World* by Sage LaTorra & Adam Koebel (CC BY 4.0), and *Monsterhearts 2* by Avery Alder (cited as inspiration, not derived).
