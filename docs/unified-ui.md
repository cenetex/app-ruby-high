# Ruby High UI

The viewer has three main destinations:

- **Class** holds the active lesson, answer choices, teacher feedback, and class chat.
- **Campus** holds classrooms, teacher cards, the student roster, and Honor Roll.
- **Yearbook** holds saved class results, course progress, completed years, and comics.

The student portrait opens **Account**, which holds student slots, passkeys, Hall Passes, wallet actions, and device settings.

## Shared layout

Desktop uses a side navigation bar. Phones use the same destinations in a bottom bar. Each page has one scroll area. Browser Back and Forward follow page changes, and refreshing a destination keeps that page open. An active answer or response draft stays in the class while the player visits another page.

The shared presentation lives in `src/viewer-parts/unified-css.ts`. It defines the page spacing, type sizes, buttons, portrait sizes, and surfaces. Ruby red marks primary actions, green marks the lesson board, and paper holds class records. Teacher identity stays in portraits and names.

Class results lead with the grade, teacher feedback, and consequence. Extra prompt and progress details sit under **Class details**. **Open yearbook** is the main action. Saving progress, reflection, and practice remain available beside the report.

## Review

Run `npm run test:browser` for the full school journey, passkeys, and navigation at 320, 390, 768, and 1280 pixels. The checks include preserved response choices, browser history, readable answer spacing, and stable comic focus during session polling.

Run `npm run screens:sheet` for the full phone screen sheet. The script labels previews that use external-service fixtures. Captures are written to `test-outputs/ruby-high-screen-sheet/`.
