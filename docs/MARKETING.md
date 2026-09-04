# Ruby High outreach and distribution

## The invitation

> One short class. Six AI classmates. A teacher with something to say.
> Try your first class free at Ruby High.

Lead with a class people can try. Show the teacher's feedback and the yearbook
as reasons to return. Give agent builders the plugin as a separate next step.

The public [share kit](https://ruby-high.ai/share) provides channel-specific
invitations, links, and downloadable school artwork. Its source lives in
`landing/share.html` and `landing/share.js`. Select a channel, copy the text,
and add a personal introduction before publishing.

Status: copy and links prepared for this release. Record each publication in
the table below when it happens.

## First wave

Run a small wave over seven days after the release is live. This is a proposed
sequence. The owner chooses each publication and sends it through their own
account.

| When | Audience | Action | Useful result |
|---|---|---|---|
| Day 1 | Five first-time players | Use Wave A from the [activation playtest](activation-playtest.md). Observe the first class. | Find the first repeated point of confusion. |
| Day 2 | Existing X audience | Post one classroom image with the X invitation. Reply to questions. | New visitors reach a class result. |
| Day 3 | Ruby High Discord or Telegram | Ask members to try a class and share a teacher note. Pick one channel for this wave. | People explain why they would return. |
| Day 4 | One agent community | Show the elizaOS install command and a short account of an agent taking class. Use the partner invitation. | Builders try the plugin or give concrete setup feedback. |
| Day 5 | Five new first-time players | Run Wave B after the first observed friction is fixed. | Compare raw stage counts with Wave A. |
| Day 6 | One builder community | Choose a Show HN or Reddit post using the guidance below. | A fresh audience tries the product and asks useful questions. |
| Day 7 | Owner review | Read channel results and feedback. Choose one channel for the next wave. | A clear next action tied to observed use. |

Budget for this wave: existing product assets and owner time. Reserve 20–30
minutes for replies after each post, plus time for the observed playtests.

## Ready-to-use copy

### X

> One short class. Six AI classmates. A teacher with something to say.
> Try your first class free at Ruby High.

Choose **X** in the share kit for the tracked link. Attach the school artwork
or a classroom screenshot from your own session.

### Discord or Telegram

> Our next class? Ruby High is a school game with short daily classes,
> AI classmates, and teacher feedback. Try the first class free and share
> the note your teacher gives you.

Choose the matching channel in the share kit. Use one existing community and
ask one clear question: “What did you expect after your first answer?”

### Agent community

> Give your AI agent a desk at Ruby High. The elizaOS plugin gives it its own
> student, a class schedule, and daily limits. Explore the school, then find
> the plugin in the For agents section.

Choose **An agent community** in the share kit. Its link opens `#agents`.
The install command is `elizaos plugins add @rati-osf/plugin-ruby-high`.
Use the [plugin repository](https://github.com/cenetex/plugin-ruby-high) for
setup details. Log plugin questions and enrollments separately from the human
viewer funnel.

### Show HN draft for the maker

Title: **Show HN: Ruby High, a school game for people and AI agents**

> I built Ruby High around a short daily class. You create a student, answer
> the class prompts, and get feedback from the teacher. Six AI classmates
> take part, and your yearbook keeps your progress.
>
> Your first class is free. Agents can also attend through an elizaOS plugin
> with their own student state, schedules, and daily limits.
>
> I would appreciate feedback on the first few minutes: what felt clear,
> and where did you expect something different?

Choose **Hacker News** in the share kit. Its link opens the playable viewer.
Add a concrete detail about why you built the school. Be available to discuss
it. Show HN asks for something people can try and a maker who can explain the
work. [Show HN guidelines](https://news.ycombinator.com/showhn.html).

### Reddit draft for the maker

Title: **I built a school game with AI classmates. How does the first class feel?**

> I am building Ruby High, a school game with short daily classes,
> AI classmates, and teacher feedback. The first class is free.
>
> I am working on the opening experience. If you try it, what did you expect
> to happen after your first answer?

Choose **Reddit** in the share kit. Tailor the post to a community you already
participate in. Check its current posting rules and explain your role in the
project. Reddit recommends relevant, authentic participation and leaves
community posting rules to moderators. [Reddit guidance](https://support.reddithelp.com/hc/en-us/articles/360043504051-Spam).

## Links and measurement

The share kit uses the fixed campaign `outreach-v1` and one source per channel:
`friend`, `x`, `discord`, `telegram`, `hn`, `reddit`, or `partner`.
The human entrypoint is `viewer`; the landing variant is `default`.
Referral codes use `outreach-<source>-v1` for aggregate visit counts.

Example landing link:

```text
https://ruby-high.ai/?ref=outreach-discord-v1&rh_source=discord&rh_campaign=outreach-v1&rh_landing=default&rh_entry=viewer
```

The homepage carries these fields through every class button. The viewer
consumes them when it opens. The metrics API accepts a fixed vocabulary for
acquisition fields. Use channel labels for referral codes and keep participant
notes under offline codes from the playtest guide.

Open `/api/apps/ruby-high/admin`, load the metrics, and use **Export acquisition**.
In `ruby.events.acquisition.cohorts`, select `campaignId: "outreach-v1"` and
compare sources and release markers. Each row includes:

- `sampleSize`: distinct eligible human viewer visitors, assigned to their first source.
- `steps`: ordered progress from app open through character creation, class
  start, first answer, completed result, and viewed result. Each step includes
  a numerator, denominator, and rate from the previous step.
- `d1Return`: eligible visitors and visitors who open or resume the app at
  least 24 hours after their first visit, within the available event window.

`ruby.events.referral.byRef` counts referred app opens. A landing-page view
enters this measurement when the visitor opens the class. Existing visitors
keep their first acquisition source. Use a fresh browser profile for QA and
label QA with `rh_source=internal&rh_entry=internal-qa`.

Report raw counts for small samples. After the first ten eligible visitors
from a channel, review the largest drop between stages and the actual
feedback. Expand a channel when players reach a result and some return after
24 hours. Treat ten visitors as a practical review point. Use larger samples
before claiming one channel is better.

The existing scheduled X links use `activation-x-*` referral codes. Keep those
and the observed Wave A/B results separate from `outreach-v1` when reviewing
the wave.

## Publication log

| Date | Owner | Channel | Public post URL | Source / campaign | New viewers | Results viewed | Returned / eligible | Feedback and next action |
|---|---|---|---|---|---|---|---|---|
| Pending | Project owner | First wave | — | outreach-v1 | — | — | — | Publish the release, then start Day 1. |

## Follow-on work

After the first wave, choose the channel with the clearest evidence of useful
play. A relevant owned-site link can provide a steady path into a matching
class. A press pitch can use observed player feedback and a concrete product
story. Prepare each as its own small test with a named owner, source, and
review date.
