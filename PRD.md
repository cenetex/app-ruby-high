# Ruby High PRD

## Product Shape

Ruby High is a live school, not a private tutor bot. A player enters a faculty classroom, sees the same teacher/classmate room context as everyone else on that server process, and participates as their generated student. The classroom chatroom is global to the server for that faculty room, and player-authored chat is a small earned-currency sink.

## Current Requirement: Global Classroom Chatrooms

Classroom chatrooms must be shared per server and room/faculty, not one-on-one per browser session.

Expected behavior:

- A message written in Ruby's homeroom is visible in Ruby's homeroom history for other signed-in sessions on the same server.
- Sally Science, Professor Edward, guest faculty rooms, and the teachers' lounge each have their own shared transcript bucket.
- The viewer still labels the local player's messages as `you`.
- Messages from other human players render as student/player chat with the author's student name when available.
- Teachers and NPC chimes should receive enough author attribution to address the correct speaker by name instead of treating every `user` turn as the current viewer.
- The blackboard, grades, character progression, wallet/account state, and guest access rules remain per player/session.

## Current Requirement: Chat Costs Merit Stars

Player-authored chat turns cost `1 Merit Star`.

Expected behavior:

- Typed classroom chat spends `1 Merit Star` before the teacher response streams.
- The bottom `Chat` action spends `1 Merit Star` before generating the player's avatar line and room response.
- Manual teacher-event turns that include a `playerLine` spend `1 Merit Star`.
- If the player does not have enough spendable Merit Stars, the chat request fails without calling the model or committing a player message.
- Automatic classroom flow remains free: channel enter, answer-graded reactions, room-idle turns, NPC chimes, opinion submissions, and system/tool events do not spend Merit Stars.
- Spending Merit Stars reduces the wallet's spendable balance but does not rewrite historical score points.
- Star spends appear in account history as chat debits.

## Current Requirement: Account, AI, And Solana Pack Copy

The viewer should no longer expose the legacy shared-school panel, event suppression action, old AI purchase UI, or token-acquisition link.

Expected behavior:

- The main classroom surface has no legacy shared-school panel or world-event suppression option.
- Account profile sharing is framed as School Presence with Join/Leave language.
- Server-hosted text AI is sponsored when the server OpenRouter key is configured; player-authored chat remains paid by Merit Stars.
- Hall Passes stay in the product for hosted images, creator tools, extra student slots, card burns, and related card features.
- The Account Wallet panel does not sell or activate a text-AI pass.
- Card pack checkout is described as a Solana pack payment, not a token-acquisition flow.
- Trust and checkout copy may still expose Solana addresses and payment token configuration where useful, but purchase CTAs should say Solana.

## Non-Goals

- Persisting chat transcripts durably across deploys or server restarts.
- Merging classroom game state across players.
- Publishing private account, wallet, OpenRouter key, answer history, or billing data into shared chat.
- Adding moderation, deletion, or reporting workflows in this pass.
- Charging automatic teacher/classroom orchestration turns.
- Tuning Merit Star earn rates or chat price beyond the current `1 Merit Star` cost.
- Removing the underlying public-world APIs or Solana collectible infrastructure.

## UX Notes

The chat log should feel like a room: teachers, AI classmates, the local student, and other human students appear as separate speakers. Remote student messages should not inherit the local player's portrait/name, and local messages should continue to feel immediate and self-authored.

## Acceptance Criteria

- Two different sessions reading the same classroom history see the same player/teacher/tool transcript.
- The authoring session receives `isSelf: true` for its own player messages.
- Other sessions receive the same message with `isSelf: false` and an author display name.
- Room events, such as classmate chimes and answer-resolved notes, are shared with the same room bucket.
- Player-authored chat debits exactly `1 Merit Star` per accepted turn.
- Insufficient Merit Stars reject player-authored chat before LLM work starts.
- Automatic teacher turns and opinion submissions do not spend Merit Stars.
- The viewer HTML, CSS, and inline script do not include the removed shared-school panel, text-AI pass controls, token-acquisition link, or event suppression control.
- `/billing/ai-pass` no longer spends Hall Passes and instead reports that AI is sponsored when configured.
- Full unit/integration suite passes before deploy.
