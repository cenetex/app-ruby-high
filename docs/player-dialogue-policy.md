# Player dialogue policy

**Players choose actions. The game supplies the words.**

This is a deliberate child-privacy and data-minimization rule. A child's own message can contain a real name, school, address, contact details, or a private experience. Guided dialogue keeps those disclosures out of the classroom conversation and its downstream storage and model calls.

Avatar speech is part of the game. A player chooses a hint, a room action, or response cards. Ruby High turns that bounded choice into authored or generated dialogue. A text composer would change this privacy boundary.

## Code contract

- The viewer sends action IDs, answer-choice IDs, or response-card IDs.
- The server validates those IDs against the current class.
- The server creates student speech from authored content and saved game state.
- Teacher and classmate context comes from the server's class record.
- Dialogue text fields are rejected before they reach conversation history, a model call, or a chat charge. Error messages use fixed copy.
- Extra prose in browser event context is discarded. The server supplies the lesson text.

The aim is to reduce collection of children's personal information at the source.

## Where to look

- `src/viewer-parts/html.ts`: guided chat action and response-card controls.
- `src/viewer-parts/client.ts`: room turns and response-card submissions.
- `src/chat-routes.ts`: dialogue entry points and server-owned speech.
- `src/routes/commands.ts`: bounded lesson answers and labyrinth actions.
- `src/__tests__/chat-routes-auth.test.ts`: requests containing player prose and successful guided turns.

Identity fields, credentials, course authoring, and the separately authenticated agent API are separate data flows. This policy describes human-player classroom dialogue. Their privacy rules need to be reviewed when those flows change.
