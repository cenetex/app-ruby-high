# Ruby High Engineering Notes

## Global Classroom Chatrooms

The chat service now treats the room as the chat boundary. `ChatService` stores in-process dialogue and room events under `room::<faculty>` rather than `<sessionToken>::<faculty>`, so every session on the same server process reads and writes the same classroom bucket for a faculty room.

## Implementation

- `ChatHistoryKey.sessionToken` is now actor metadata, not storage isolation.
- `ChatMessage` carries `authorSessionToken` and `authorName` on player-authored messages.
- `ChatService.keyOf()` returns `room::<faculty>`.
- `appendPlayerMessage()` and `send({ userMessage })` stamp author metadata before appending to the shared history.
- `toOpenRouterMessage()` prefixes attributed player turns as `Name: message` so the model can distinguish speakers in a shared transcript.
- `formatDialogueLineForAvatar()` uses the message's author name before falling back to the current session character.
- `publicChatHistory(messages, viewerSessionToken)` emits `authorName` and `isSelf` for viewer replay.
- The viewer renders remote human users as `kind: "player"` with a `Student` role tag; local messages still render as `kind: "you"`.
- The history render signature includes message content and author metadata, so clients update when another student speaks even if the row count is unchanged.

## Boundaries

Player state remains private and durable through `AuthService` and `RubyHighService` state keys. Chat history remains process-local and resets on restart/deploy, matching the pre-existing chat transcript durability model. No SQLite/Dynamo migration is required.

## Merit Star Chat Cost

Player-authored chat turns spend `CHAT_MERIT_STAR_COST` (`1`) Merit Star through `RubyHighService.spendMeritStars()`.

Charged paths:

- `POST /api/apps/ruby-high/chat` for typed classroom chat.
- `POST /api/apps/ruby-high/chat/room-turn` for the bottom Chat action.
- `POST /api/apps/ruby-high/chat/event` only when `trigger === "manual"` and the request carries a non-empty `context.playerLine`.

Free paths:

- Channel-enter, answer-graded, and room-idle teacher orchestration.
- Student chimes.
- Opinion submissions.
- Tool/system events.

Implementation notes:

- `RubyHighWalletTransactionKind` includes `merit-star-grant` and `merit-star-spend`.
- `RubyHighWalletTransaction.source` includes `chat`.
- Chat route charges happen after auth/rate-limit/guest validation and stale-turn checks, before LLM work starts.
- Client turn sequence IDs are included in typed chat requests and used as wallet idempotency keys when present.
- Spendable Merit Stars live in `wallet.meritStars`; historical `score.points` are not decremented by chat spends.
- Account history renders `merit-star-spend` as a chat debit.

## Account, Sponsored AI, And Solana Pack Copy

The viewer no longer mounts the legacy shared-school panel. `html.ts` omits the panel markup, `client.ts` no longer serializes or attaches the world panel controller, and `css.ts` removes the panel rules and collapses the workspace grid so the stream fills the space.

Account presence still uses the existing `set-public-presence` command and shared-school projection fields, but the user-facing account copy is School Presence with Join/Leave labels. The old per-event visibility button was removed from the legacy renderer even though the backend safety action remains available for legacy/API callers.

Server-hosted text AI is now sponsored when `RUBY_HIGH_OPENROUTER_API_KEY` is configured:

- `resolveOpenRouterGenerationCredential()` returns the hosted key without requiring a timed activation window.
- `hostedAiEntitlementStatus()` reports configured hosted text AI as active with `cost: 0` and `canActivate: false`.
- `/billing/ai-pass` returns `410` with sponsored-AI copy instead of spending Hall Passes.
- Text chat remains gated by Merit Stars for player-authored turns.

Hall Passes remain active for hosted images, creator slots, extra student slots, card burns, and card-related features. The account wallet copy and billing cost chips now describe those uses only.

Solana pack checkout no longer exposes the Get `$RUBY` link or NFT-payment language in the viewer. Checkout labels use Solana payment/pack copy, while the underlying Metaplex Core pack/card services and on-chain proof links remain intact.

## Verification

Run before deploying:

```sh
npm run typecheck
npm run test:ci
```

Focused coverage added/updated:

- `src/__tests__/chat-service.test.ts` verifies cross-session room history/event visibility and `isSelf` public history attribution.
- `src/__tests__/chat-routes-auth.test.ts` verifies attributed player lines still reach teacher prompts and typed chat spends/rejects on Merit Star balance.
- `src/__tests__/ruby-high-service.test.ts` verifies idempotent Merit Star grants/spends.
- `src/__tests__/viewer-account-history.test.ts` verifies chat Star spends render as account-history debits.
- `src/__tests__/viewer-chat-messages-renderer.test.ts` verifies remote human players render with the student role tag.
- `src/__tests__/viewer-regression.test.ts` verifies the shared-school panel, text-AI pass controls, and token-acquisition link stay removed from the viewer.
- `src/__tests__/billing-routes.test.ts` verifies the retired AI pass endpoint and sponsored hosted-AI entitlement shape.
- `src/__tests__/viewer-billing-*.test.ts` and account-panel tests verify Solana pack wording and Hall Pass wallet copy.

## Deploy

Production deploy runs through:

```sh
npm run deploy
```

That script builds a dirty-aware Fly build id, deploys `ruby-high` with `flyctl deploy --remote-only`, then runs `npm run smoke:prod`.
