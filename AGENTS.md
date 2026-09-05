# Ruby High

Use simple English. Use an isolated worktree, commit and push changes, and open a PR.

## Player dialogue

Read [the player dialogue policy](docs/player-dialogue-policy.md) before changing chat, response cards, or student speech.

Guided dialogue is a child-privacy requirement. Players choose actions and card IDs. The game supplies the words. Human-written messages must stay out of classroom dialogue, chat history, and model prompts.

Keep the player-facing chat UI based on buttons and choices. Generate avatar lines on the server. Derive teacher context from saved game state. Enforce this rule at the server boundary as well as in the viewer.
