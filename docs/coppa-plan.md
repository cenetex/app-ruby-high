# Ruby High child privacy plan

Updated October 7, 2026. Owner: the Ruby High operator.

Ruby High serves teens 13+ and adults. The plan keeps collection small and gives players a way to remove linked records. The entry confirmation is an audience notice. The operator needs an audience review before claiming COPPA compliance.

## Audience and entry

The hosted entry screen asks **Confirm you are 13+?** Its **Yes, continue** button creates the usual guest session. The answer is discarded after the request. Keep this choice free of birth dates, numeric ages and saved confirmation flags. A session cookie keeps the player signed in.

Use teen and adult audiences in listings, ads and invitations. The game uses high school grades and teen writing guidance. Keep a dated record of the intended audience, the art, the content, the marketing and any reliable audience evidence. Have counsel review whether the live service is general audience, child directed or mixed audience. A school theme and the operator's stated age range are parts of that review.

The FTC describes accurate age entry for a neutral age screen. This confirmation is a 13+ notice rather than that type of screen. If the audience review calls for a mixed audience or child directed design, review the access and consent plan before release.

Sources: [FTC COPPA FAQ](https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions), [current COPPA Rule](https://www.govinfo.gov/content/pkg/FR-2025-04-22/html/2025-05904.htm).

## Collection rules

1. Players choose action and card IDs. The game supplies classroom speech. Follow the [player dialogue policy](./player-dialogue-policy.md) at the viewer and server boundaries.
2. Use generated fictional names and reroll buttons. Public player screens use fixed choices for bug reports, course search and course topics. Teacher details are generated displays. Account recovery and agent connection read a copied code after an explicit button click and clipboard permission. Review private admin setup, authenticated APIs and vendor payment or wallet screens as separate data flows.
3. Use account and visitor IDs for login, saved progress, preferences, first party service measurement and security. A hash or cookie is still a persistent identifier under COPPA when the rule applies.
4. Review every new SDK, metric field, upload or model input before adding it. Record its purpose, recipients and deletion period.
5. New students start with public school activity and teacher social posts off. Each has its own Account choice. Public sharing needs a separate review if younger children become part of the audience.

The internal operations exception has conditions. It applies to limited persistent identifier collection for permitted purposes. Other personal information and extra uses need their own analysis. The public notice must explain the uses. Counsel should assess the visitor ID, gameplay records, optional features and vendor behavior together. The current design alone cannot settle that question.

## Data register

| Records | Purpose and recipients | Current storage and deletion |
| --- | --- | --- |
| Guest account ID, session token, account times | Login and saved progress; app server and Fly.io | Session expiry: 30 days. Account inactivity limit: 90 days by default. Delete Account removes linked records. |
| Browser visitor ID and its server hash | First party visit and return counts; app server | Device ID remains in browser storage until cleared. Linked server metrics use the state retention period and account deletion. |
| Fictional student profile, choices, results and game events | Game state and school features; app server | Default state limit: 90 days since the record's last save. Account deletion removes owned state and linked events. |
| Generated room messages, events and summaries | Shared room continuity; app server, OpenRouter and selected model provider | Messages and events: 90 days. Summaries expire from their oldest tracked source. Deletion removes linked messages and clears affected summaries. Other players keep their source history. |
| Teacher observations and learned cues | Teacher continuity; app server and model provider | Observations and learned cues have a 90-day limit. Linked observations and derived cues are removed during account deletion. |
| Fixed metrics and auth error codes | Service quality and security; app server | Default 90-day state period. The auth error endpoint drops message text and wallet previews. Account deletion removes linked metrics. |
| Passkey public credentials, recovery hash and auth challenges | Account security; app server | Account retention and deletion apply. Challenges have a short expiry. Account deletion removes bound challenges. |
| Optional wallet IDs, payment and purchase records | Wallet login, purchases and network transactions; Privy, Stripe and Solana services | App account records follow app retention. Vendor finance records and public chain records need a separate retention review. |
| Chosen course topics, generated lessons, teachers and artwork | Course and portrait features; app server, model providers, S3-compatible storage and sometimes Arweave | Owned app records are removed by account deletion. Uploaded objects, published copies and vendor copies need an owner process. Public chain and Arweave records can remain available. |
| Approved agent credentials, events and saved students | Optional agent play; app server | Owner deletion revokes linked credentials and removes owned agent students and linked dialogue. |
| Fixed bug categories, numeric diagnostics and community posts | Support and public community features; GitHub, Discord, X and Telegram | The default GitHub issue repository is public. Keep private requests in the privacy channel. Review public copies and vendor deletion tools when handling requests. |
| Host access logs, network information and backups | Delivery, abuse control and recovery; hosting and storage services | Owner must confirm current log and backup limits, access controls and the process for restored copies. |

This register is based on source review. The operator must verify deployed settings, vendor accounts and older stored copies.

## AI and vendor checks

Remote OpenRouter requests use `provider.data_collection=deny` and `provider.zdr=true`. Caller-supplied user IDs are removed from these request bodies. Local model routing keeps its existing local path. Check each configured model can use a suitable endpoint before release.

The operator must verify the OpenRouter account's prompt logging choice, metadata use and provider terms. Request routing controls model endpoints; OpenRouter has its own records and settings. See [OpenRouter data collection](https://openrouter.ai/docs/guides/privacy/data-collection) and [provider routing](https://openrouter.ai/docs/guides/routing/provider-selection).

For each vendor, record the data received, purpose, retention, deletion method and security terms. Where COPPA applies, obtain the required written assurances and review any disclosure or consent duties. Include Fly.io, model providers, Privy, Stripe, storage, RPC services, community integrations and optional image services.

## Retention and security

`RUBY_HIGH_STATE_TTL_SECONDS` defaults to 7,776,000 seconds (90 days). Keep the deployed period positive. The hosted JSON factory, SQLite and DynamoDB apply retention to new account records. SQLite also assigns expiry to older account and installation rows. A direct library `new StateStore(...)` uses its explicit settings; the hosted factory supplies the default.

An hourly task removes inactive in-memory accounts, their owned agents and linked room data. It also removes agents whose owner account has already expired when the server restarts. Agent access is revoked before linked cleanup. The owner link stays available until cleanup succeeds so a failed run can retry. Store expiry also applies when rows load. SQLite purges expired rows on open and every 15 minutes. DynamoDB physical deletion follows its TTL service schedule.

Before release, review legacy DynamoDB rows that lack expiry. Older room events and summaries can lack an account link. Use the recorded IDs and source evidence when handling those cases. Review migrated records and historical backups separately.

Maintain a written security program with an owner, access controls, risk assessment, vendor review, incident response and annual review. Record the purpose and retention period for each data class. Confirm host log, snapshot and artwork storage limits. If a backup is restored, apply completed deletion requests again before opening the service.

## Privacy requests and known under-13 accounts

1. Offer the public privacy email and the player's **Copy privacy request ID** button. Keep requests private. Verify account control or the parent's relationship using the minimum needed evidence. Keep recovery codes and wallet secrets private.
2. A player can use **Account → Account settings → Delete Account**. Guest accounts use the same flow. Saved passkey accounts require a fresh passkey check.
3. For a verified under-13 report, pause access and run the account deletion process promptly. The current admin endpoint deletes the linked account and its active sessions. A later visit creates a new account after the entry notice; support must review repeated reports.
4. An admin uses `POST /api/apps/ruby-high/admin/privacy/delete-account`, the private admin bearer credential and `{ "userId": "verified-account-id", "confirm": "DELETE" }`. Use the verified privacy request ID. Keep the admin credential in a secure client. Test the request on a fixture before any live operation.
5. Review generated artwork, vendor copies, public issue reports, public posts and backups. Record the request, actions, completion date and any copy that needs a separate legal retention basis. Keep the request log small and private.
6. If younger children become part of the intended audience, complete a new review of access, parental consent, notices, vendors and sharing before enabling that audience.

## Release requirements

The source changes are ready for technical review. These owner tasks still need evidence:

- Approve the audience classification and the basis for each persistent identifier use.
- Supply the legal operator name, public privacy email, business address and phone. Configure `RUBY_HIGH_PRIVACY_OPERATOR`, `RUBY_HIGH_PRIVACY_EMAIL`, `RUBY_HIGH_PRIVACY_ADDRESS` and `RUBY_HIGH_PRIVACY_PHONE`.
- Approve the public notice and the request process. The notice returns 503 while contact details are missing. Production boot checks the contact and retention settings. `npm run check:privacy` checks them after a build.
- Verify model availability, account logging settings, vendor assurances and the written security program.
- Confirm host logs, backup copies, S3 artwork and legacy data retention and deletion.
- Review optional creator tools, public yearbooks, wallet features and community posts for the teen audience.

The October 7 production dependency audit found seven high-severity entries in the Axios and Irys dependency chain. The existing production audit gate remains open. Review patched upstream releases and the affected runtime paths before release.

Keep the approval record with the release evidence. Merge and deployment are separate release steps.
