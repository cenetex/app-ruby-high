# Ruby High first-class activation playtest

## Goal

Find the first point where a new visitor stops between opening Ruby High,
creating a student, and starting the first daily class. This is a directional
playtest, not a statistically significant conversion study.

## Cohort

Run two waves of five first-time participants. Use people who have not seen the
current onboarding flow. Do not require an account, wallet, AI key, purchase,
or personally identifying information.

- Wave A: `https://ruby-high.fly.dev/api/apps/ruby-high/viewer?ref=activation-wave-a`
- Wave B: `https://ruby-high.fly.dev/api/apps/ruby-high/viewer?ref=activation-wave-b`

The `ref` value is stored only as aggregate referral attribution in the admin
metrics. Assign each participant an offline code such as `A1`; do not put that
code, their name, or contact details in the URL.

## Invitation

> Try the first class at Ruby High. It is free, works without an account or AI
> key, and should take only a few minutes. Please stop whenever you naturally
> would—getting stuck or losing interest is useful feedback. Afterward, tell me
> the last thing you expected to happen and the first thing that felt unclear.

## Session protocol

1. Ask the participant to open the wave link on their normal phone or computer.
2. Do not explain the interface or tell them which control to press.
3. If they stop, record the last visible screen and ask, “What did you expect
   to happen next?” Do not coach them back into the flow for the primary run.
4. If they reach the first question, let them continue until they voluntarily
   stop or view the class result.
5. Record only participant code, device class, last completed stage, elapsed
   time, and one short friction quote. Keep no recordings without explicit
   participant consent.

Stages are: app open, student creator opened, candidate ready, enrollment
clicked, character created, daily class started, first answer, and result
viewed.

## Readout

Use `ruby.events.onboardingFunnel.humanViewer` for the new first-visit stages,
`ruby.events.activationFunnel.humanViewer` for later class completion, and
`ruby.events.referral.byRef` for Wave A/B acquisition counts. Never substitute
auth identities or saved sessions for people.

Review after Wave A before inviting Wave B. Prioritize the first stage with a
repeated observed failure or a previous-step rate below 60%. A useful first
target is at least three of five participants creating a character and at least
two of five starting the class. Report the raw numerator and denominator; do
not present percentages from five-person waves as stable product rates.

## Stop conditions

Pause invitations if production health is not ready, the metrics schema is not
`ruby-high-admin-metrics.v8`, or the viewer records test/smoke sessions as
human-viewer activity. Fix the measurement boundary before continuing.
