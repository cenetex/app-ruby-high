// Static CSS for the Ruby High SPA viewer. Extracted from viewer.ts
// to keep the assembler small. No interpolation here — pure tokens
// + selectors + media queries.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const VIEWER_CSS = `
  @font-face {
    font-family: "RubyHighCaveat";
    src: url("/api/apps/ruby-high/assets/fonts/caveat-regular.ttf") format("truetype");
    font-display: swap;
  }
  @font-face {
    font-family: "RubyHighCraftyGirls";
    src: url("/api/apps/ruby-high/assets/fonts/crafty-girls-regular.ttf") format("truetype");
    font-display: swap;
  }
  @font-face {
    font-family: "RubyHighGiveYouGlory";
    src: url("/api/apps/ruby-high/assets/fonts/give-you-glory-regular.ttf") format("truetype");
    font-display: swap;
  }
  @font-face {
    font-family: "RubyHighSchoolbell";
    src: url("/api/apps/ruby-high/assets/fonts/schoolbell-regular.ttf") format("truetype");
    font-display: swap;
  }

  /* ── tokens ────────────────────────────────────────────────────────────── */
  :root {
    color-scheme: dark;
    --bg-deep: #15171f;
    --bg: #1d2030;
    --bg-elev: #262a3d;
    --bg-elev-2: #313650;
    --bg-active: #3d4360;
    --line: rgba(255,255,255,0.07);
    --text: #ecf0fb;
    --text-soft: #aab1c8;
    --text-mute: #7c8499;
    --accent: #d22a2a;
    --accent-soft: rgba(210, 42, 42, 0.16);
    --green: #4cb555;
    --diff-easy: #4cb555;
    --diff-medium: #f0922a;
    --diff-hard: #d22a2a;
    --check: #ff4d4d;
    --board: #2f5a3f;
    --board-frame: #6b3f1d;
    --board-frame-light: #8a5a30;
    --ink: #f4f4f0;
    --ink-soft: rgba(244, 244, 240, 0.72);
    --shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
    --rail-w: 60px;
    --channels-w: 280px;
    --top-h: 52px;
    --composer-min: 60px;
    --safe-top: env(safe-area-inset-top, 0px);
    --safe-bot: env(safe-area-inset-bottom, 0px);
    --safe-left: env(safe-area-inset-left, 0px);
    --safe-right: env(safe-area-inset-right, 0px);
  }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  [hidden] { display: none !important; }
  html, body {
    margin: 0;
    padding: 0;
    height: 100%;
    width: 100%;
    overflow: hidden;
    font: 15px/1.45 -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", system-ui, sans-serif;
    color: var(--text);
    background: var(--bg-deep);
    overscroll-behavior: contain;
    -webkit-font-smoothing: antialiased;
    text-size-adjust: 100%;
  }
  /* touch-action 'manipulation' allows pinch-zoom on iOS Safari;
     'pan-x pan-y' keeps scroll/swipe but explicitly blocks pinch-zoom
     and double-tap zoom on Android Chrome / Samsung Internet.
     Belt-and-suspenders with the JS gesture preventers in viewer script. */
  body { touch-action: pan-x pan-y; }
  button, textarea, select, input { font: inherit; color: inherit; }
  button { cursor: pointer; touch-action: manipulation; }
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 999px; }
  ::-webkit-scrollbar-track { background: transparent; }

  /* ── shell ─────────────────────────────────────────────────────────────── */
  .shell {
    position: fixed;
    inset: 0;
    display: grid;
    grid-template-columns: 1fr;
    background: var(--bg-deep);
    /* Defensive clip: even with workspace's overflow:hidden, a child grid
       cell that has min-content wider than the viewport will widen the
       cell — and on Samsung Internet (and some iOS Safari versions) that
       widening is visible past the screen edge. Clipping at the shell
       guarantees nothing draws past the viewport on any browser. */
    overflow: hidden;
  }
  /* Grid cells default to min-width:auto, which uses min-content. Force
     every direct child of the workspace grid to be allowed to shrink. */
  main.workspace > * { min-width: 0; }

  .scrim {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.55);
    z-index: 40;
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transition: opacity 0.18s ease, visibility 0s linear 0.18s;
  }
  .shell.is-rails-open .scrim {
    opacity: 1;
    visibility: visible;
    pointer-events: auto;
    backdrop-filter: blur(2px);
    -webkit-backdrop-filter: blur(2px);
    transition: opacity 0.18s ease;
  }

  /* ── rails (mobile-first: drawer overlay, fully hidden when closed) ───── */
  aside.servers-rail,
  aside.channels-rail {
    position: fixed;
    top: 0;
    bottom: 0;
    z-index: 4;                       /* below top-bar (10) when closed */
    transform: translateX(-110%);     /* extra 10% so subpixel rounding can't leak */
    visibility: hidden;
    pointer-events: none;
    transition: transform 0.24s cubic-bezier(0.32, 0.72, 0.18, 0.99),
                visibility 0s linear 0.24s;
    will-change: transform;
  }
  aside.servers-rail {
    left: 0;
    width: var(--rail-w);
    background: var(--bg-deep);
    border-right: 1px solid var(--line);
    overflow-y: auto;
    overflow-x: hidden;
    padding: calc(var(--safe-top) + 10px) 6px calc(var(--safe-bot) + 10px);
    display: none;
    flex-direction: column;
    gap: 8px;
    align-items: center;
  }
  aside.channels-rail {
    left: 0;
    width: min(var(--channels-w), 86vw);
    background: var(--bg);
    border-right: 1px solid var(--line);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .shell.is-rails-open aside.servers-rail,
  .shell.is-rails-open aside.channels-rail {
    z-index: 50;
    transform: translateX(0);
    visibility: visible;
    pointer-events: auto;
    transition: transform 0.24s cubic-bezier(0.32, 0.72, 0.18, 0.99),
                visibility 0s;
  }

  /* ── server (grade) buttons ───────────────────────────────────────────── */
  .server-btn {
    appearance: none;
    border: none;
    background: var(--bg-elev);
    color: var(--text);
    width: 48px;
    height: 48px;
    border-radius: 16px;
    font-weight: 800;
    font-size: 16px;
    display: grid;
    place-items: center;
    position: relative;
    transition: background 0.15s ease, border-radius 0.18s ease, transform 0.08s ease;
    flex: 0 0 auto;
  }
  .server-btn:active { transform: scale(0.95); }
  .server-btn.is-active {
    background: var(--accent);
    border-radius: 14px;
  }
  .server-btn.is-active::before {
    content: "";
    position: absolute;
    left: -10px;
    top: 50%;
    width: 4px;
    height: 36px;
    background: #fff;
    border-radius: 0 4px 4px 0;
    transform: translateY(-50%);
  }
  .server-btn.is-home {
    background: var(--bg-elev-2);
    border-radius: 14px;
    overflow: hidden;
  }
  .server-btn.is-home img {
    width: 32px;
    height: 32px;
    object-fit: contain;
  }
  .server-btn .check {
    position: absolute;
    bottom: -3px;
    right: -3px;
    color: #fff;
    background: var(--check);
    font-size: 10px;
    font-weight: 900;
    width: 18px;
    height: 18px;
    border-radius: 999px;
    display: grid;
    place-items: center;
    border: 2px solid var(--bg-deep);
  }
  .servers-divider {
    width: 30px;
    height: 1px;
    background: var(--line);
    margin: 4px 0;
    flex: 0 0 auto;
  }

  /* ── channels rail ─────────────────────────────────────────────────────── */
  .channels-header {
    padding: calc(var(--safe-top) + 16px) 18px 14px;
    border-bottom: 1px solid var(--line);
  }
  .channels-header .school-logo {
    display: block;
    width: min(174px, 82%);
    height: auto;
    margin: 0 auto 12px;
    object-fit: contain;
    filter: drop-shadow(0 10px 18px rgba(0,0,0,0.24));
  }
  .channels-header .school-context {
    border-top: 1px solid rgba(255,255,255,0.07);
    padding-top: 10px;
  }
  .channels-header .grade-name {
    font-size: 18px;
    font-weight: 800;
  }
  .channels-list {
    flex: 1 1 auto;
    overflow-y: auto;
    padding: 10px 8px 12px;
  }
  .channel-section-title {
    color: var(--text-mute);
    font-size: 11px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    padding: 14px 10px 6px;
  }
  .channel-row {
    appearance: none;
    border: none;
    background: transparent;
    color: var(--text-soft);
    width: 100%;
    text-align: left;
    padding: 8px 12px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    gap: 10px;
    font-weight: 600;
    font-size: 15px;
    min-height: 44px;
    transition: background 0.12s ease, color 0.12s ease;
  }
  .channel-row .teacher-thumb {
    width: 28px;
    height: 28px;
    border-radius: 999px;
    background: #fff;
    overflow: hidden;
    flex: 0 0 auto;
    border: 1.5px solid rgba(255,255,255,0.12);
  }
  .channel-row .teacher-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center top;
    display: block;
  }
  .channel-row:active { background: var(--bg-elev); }
  .channel-row.is-active {
    background: var(--bg-active);
    color: var(--text);
  }
  .channel-row.is-active .hash { color: var(--accent); }
  .channel-row .hash {
    color: var(--text-mute);
    font-weight: 400;
    margin-right: 2px;
  }
  .channel-row .badge {
    margin-left: auto;
    background: var(--bg-elev-2);
    color: var(--text-mute);
    font-size: 10px;
    font-weight: 800;
    padding: 2px 7px;
    border-radius: 999px;
  }
  .channel-row .course-status-pill {
    margin-left: auto;
    flex: 0 0 auto;
    color: #f0b441;
    font-size: 10px;
    font-weight: 900;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    background: rgba(240,180,65,0.12);
    border: 1px solid rgba(240,180,65,0.22);
    border-radius: 7px;
    padding: 3px 6px;
    line-height: 1;
  }
  .room-student-stack {
    margin-left: 8px;
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    min-width: 20px;
  }
  .room-student-chip {
    width: 22px;
    height: 22px;
    border-radius: 999px;
    display: inline-grid;
    place-items: center;
    overflow: hidden;
    background: color-mix(in oklab, var(--student-accent, #888) 22%, #202331);
    border: 2px solid var(--student-accent, #888);
    color: #fff;
    font-size: 10px;
    font-weight: 900;
    line-height: 1;
    box-shadow: 0 0 0 2px rgba(0,0,0,0.16);
  }
  .room-student-chip + .room-student-chip {
    margin-left: -7px;
  }
  .room-student-chip img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center top;
    display: block;
  }
  .room-student-chip.is-fallback img {
    display: none;
  }
  .channel-row .roster-grade {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
    min-width: 54px;
    color: var(--text-mute);
    line-height: 1;
    opacity: 0.9;
  }
  .channel-row .roster-grade-dot {
    width: 9px;
    height: 9px;
    border-radius: 999px;
    flex: 0 0 auto;
    box-shadow:
      0 0 0 2px rgba(255,255,255,0.08),
      0 0 10px rgba(255,255,255,0.10);
  }
  .channel-row .roster-grade-label {
    color: inherit;
    font-size: 9px;
    font-weight: 900;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .channel-row .roster-grade.is-graduated {
    color: rgba(240,180,65,0.76);
  }
  .student-cohort-group {
    padding: 2px 0 6px;
  }
  .student-cohort-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 7px 10px 4px;
    color: var(--text-mute);
    font-size: 10px;
    font-weight: 900;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  .student-cohort-count {
    min-width: 18px;
    height: 18px;
    padding: 0 6px;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: rgba(255,255,255,0.06);
    color: var(--text-soft);
    letter-spacing: 0;
    font-size: 10px;
  }
  .channel-row.student-row {
    min-height: 52px;
    padding: 7px 10px 7px 12px;
    border-radius: 8px;
    font-size: 14px;
  }
  .channel-row.student-row .student-thumb {
    width: 32px;
    height: 32px;
    border-color: var(--student-accent, rgba(255,255,255,0.12));
    box-shadow: 0 0 0 2px color-mix(in oklab, var(--student-accent, #888) 20%, transparent);
  }
  .student-row-meta {
    min-width: 0;
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .student-row-name {
    color: var(--text-soft);
    font-size: 14px;
    font-weight: 800;
    line-height: 1.12;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .student-row-detail {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 7px;
  }
  .student-row-subtitle {
    color: var(--text-mute);
    font-size: 11px;
    font-weight: 650;
    line-height: 1.15;
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .student-year-meter {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }
  .student-year-segment {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: transparent;
    border: 1px solid rgba(255,255,255,0.16);
  }
  .student-year-segment.is-filled {
    background: rgba(240,180,65,0.88);
    border-color: rgba(240,180,65,0.92);
    box-shadow: 0 0 8px rgba(240,180,65,0.22);
  }
  .student-social-mark {
    margin-left: auto;
    flex: 0 0 auto;
    min-width: 31px;
    height: 23px;
    padding: 0 7px;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid rgba(255,255,255,0.09);
    font-size: 11px;
    font-weight: 900;
    line-height: 1;
    letter-spacing: 0;
  }
  .student-social-mark.is-neutral {
    background: rgba(255,255,255,0.04);
    color: var(--text-mute);
  }
  .student-social-mark.is-warm,
  .student-social-mark.is-circled {
    background: rgba(82,198,115,0.14);
    border-color: rgba(82,198,115,0.26);
    color: #b6f5b9;
  }
  .student-social-mark.is-cool,
  .student-social-mark.is-scratched {
    background: rgba(210,42,42,0.15);
    border-color: rgba(210,42,42,0.28);
    color: #ffb1b1;
  }
  .student-social-mark.is-circled {
    box-shadow: inset 0 0 0 1px rgba(182,245,185,0.28);
  }
  .student-social-mark.is-scratched {
    text-decoration: line-through;
  }
  .channels-footer {
    padding: 12px 14px calc(var(--safe-bot) + 12px);
    border-top: 1px solid var(--line);
    background: var(--bg-elev);
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .channels-footer .you-avatar {
    width: 36px;
    height: 36px;
    border-radius: 999px;
    background: var(--accent);
    color: #fff;
    display: grid;
    place-items: center;
    font-weight: 800;
    flex: 0 0 auto;
  }
  .channels-footer .you-meta { display: flex; flex-direction: column; min-width: 0; flex: 1 1 auto; }
  .channels-footer .you-name {
    font-size: 14px;
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .channels-footer .you-state {
    font-size: 11px;
    color: var(--text-mute);
  }
  .channels-footer .footer-action {
    background: transparent;
    border: 1px solid var(--line);
    color: var(--text-soft);
    font-size: 12px;
    padding: 7px 12px;
    border-radius: 999px;
    flex: 0 0 auto;
  }
  .channels-rail .report-bug-link {
    appearance: none;
    background: transparent;
    border: none;
    color: var(--text-mute);
    font-size: 11px;
    text-decoration: underline;
    text-decoration-style: dotted;
    text-underline-offset: 2px;
    padding: 6px 14px calc(var(--safe-bot) + 10px);
    cursor: pointer;
    text-align: left;
  }
  .channels-rail .report-bug-link:hover { color: var(--text-soft); }

  /* ── workspace (the main scroll container) ─────────────────────────────── */
  main.workspace {
    grid-row: 1;
    grid-column: 1;
    display: grid;
    grid-template-rows: auto auto 1fr auto;
    height: 100dvh;
    overflow: hidden;
    background: var(--bg-deep);
  }

  /* ── sticky top bar ────────────────────────────────────────────────────── */
  .top-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: var(--safe-top) calc(var(--safe-right) + 12px) 0 calc(var(--safe-left) + 8px);
    height: calc(var(--safe-top) + var(--top-h));
    min-width: 0;
    border-bottom: 1px solid var(--line);
    background: rgba(21, 23, 31, 0.92);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    z-index: 10;
  }
  .hamburger {
    appearance: none;
    background: transparent;
    border: none;
    color: var(--text);
    padding: 8px;
    border-radius: 10px;
    width: 40px;
    height: 40px;
    display: grid;
    place-items: center;
  }
  .hamburger:active { background: var(--bg-elev); }
  .hamburger svg { width: 22px; height: 22px; }
  .channel-name { display: flex; flex-direction: column; min-width: 0; flex: 1 1 auto; }
  .channel-name .top {
    font-size: 16px;
    font-weight: 800;
    color: var(--text);
    display: flex;
    align-items: center;
    gap: 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .channel-name .top .hash { color: var(--text-mute); font-weight: 400; flex: 0 0 auto; }
  .channel-name .sub {
    font-size: 11px;
    color: var(--text-mute);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* Arc indicator — the player's live progress through the 4-year arc.
   * Replaces the old session-score chip; this is the only thing that should
   * be in the top-right. Hidden until a character exists. */
  .arc-indicator {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    background: var(--bg-elev);
    border-radius: 999px;
    font-size: 12px;
    font-weight: 700;
    color: var(--text);
    /* Shrink-fit so a long "Sophomore 3800 score" never pushes the
       hamburger or chalkboard labels off-screen. Truncate with ellipsis
       rather than clip when the available room runs out. */
    flex: 0 1 auto;
    min-width: 0;
    max-width: 50%;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .arc-indicator .arc-year { color: var(--accent); }
  .arc-indicator .arc-sep { color: var(--text-mute); font-weight: 400; }
  .arc-indicator .arc-streak.is-met { color: var(--accent); }
  .arc-indicator .arc-xp.is-met { color: var(--accent); }
  .arc-indicator .arc-score { color: #ffe08a; font-variant-numeric: tabular-nums; }
  .arc-indicator.is-graduated .arc-year { color: #f0b441; }
  /* Mobile: hide the school-day/course detail, keep just the year tag. The full
   * progress is one tap away on the character sheet. */
  @media (max-width: 540px) {
    .arc-indicator .arc-sep,
    .arc-indicator .arc-streak,
    .arc-indicator .arc-xp { display: none; }
  }
  /* Pack-store button — sits next to the arc chip in the top bar. Opens
   * the pack-overlay where the user can switch curricula or import an
   * Anki deck. It stays hidden during first-run setup so today's class
   * remains the only obvious path. */
  .pack-btn {
    appearance: none;
    background: var(--bg-elev);
    color: var(--text-soft);
    border: none;
    border-radius: 999px;
    width: 32px;
    height: 32px;
    margin-right: calc(var(--safe-right));
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
  }
  .pack-btn:hover { color: var(--text); background: var(--bg-elev-2); }
  .pack-btn[hidden] { display: none; }
  .pack-btn svg { width: 18px; height: 18px; }
  /* Pack list inside the pack-store overlay. Each row is a pack the
   * user can switch to; the active one is highlighted. */
  .pack-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 8px 0;
  }
  .pack-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    background: var(--bg-elev);
    border-radius: 12px;
    cursor: pointer;
    border: 2px solid transparent;
    transition: border-color 0.15s ease;
  }
  .pack-row:hover { background: var(--bg-elev-2); }
  .pack-row.is-active { border-color: var(--accent); cursor: default; }
  .pack-row .pack-name {
    font-weight: 700;
    color: var(--text);
    font-size: 14px;
  }
  .pack-row .pack-meta {
    font-size: 11px;
    color: var(--text-mute);
    margin-top: 2px;
  }
  .pack-row .pack-body { flex: 1 1 auto; min-width: 0; }
  .pack-row .pack-active-tag {
    font-size: 10px;
    color: var(--accent);
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    flex: 0 0 auto;
  }
  .pack-import-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0 0 10px;
  }
  .pack-import-field span {
    color: var(--text-mute);
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }
  .pack-import-field select {
    width: 100%;
    background: var(--bg-elev);
    border: 1px solid var(--line);
    border-radius: 10px;
    color: var(--text);
    padding: 8px 10px;
    outline: none;
  }
  .pack-import-field select:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-soft);
  }
  /* Lounge placeholder — shown when an Anki-imported faculty has no
   * portrait asset on disk. Single colored circle with the teacher's
   * initial; matches the size of the real portrait images. */
  .lounge-placeholder {
    width: 90px;
    height: 90px;
    border-radius: 12px;
    display: grid;
    place-items: center;
    font-weight: 800;
    font-size: 28px;
    color: #fff;
  }
  /* ── blackboard panel (single, persistent, updates in place) ───────────── */
  .blackboard-panel {
    grid-row: 2;
    background: var(--bg);
    border-bottom: 1px solid var(--line);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    position: relative;
    min-height: 0;
  }
  .blackboard-panel.is-empty {
    background: var(--bg-deep);
    border-bottom-color: transparent;
  }
  /* ── mode-driven visibility (single source of truth) ────────────────────
   * applyViewMode() in script.ts sets data-mode on the panel; the rules
   * below decide which sub-elements are visible per mode. Sub-renderers
   * (renderRaceStrip, renderAdvantageBar, etc.) only paint contents —
   * they never compete with these rules over visibility.
   *
   *   round-live      — question on the board, timer counting, A/B/C/D + advantage live
   *   round-revealed  — answer revealed, the round is over: hide answers / advantage / timer
   *                     so the explanation + teacher reaction get the screen
   *   between-rounds  — no question on the board: hide everything except the empty placeholder
   *   in-lounge       — lounge mode swaps in the lounge stage; hide quiz chrome
   *   needs-auth / needs-character / checking-auth — pre-game; hide quiz chrome
   */
  .blackboard-panel[data-mode="round-revealed"] .answers-host,
  .blackboard-panel[data-mode="round-revealed"] .typed-answer-host,
  .blackboard-panel[data-mode="round-revealed"] .advantage-bar,
  .blackboard-panel[data-mode="round-revealed"] .race-strip {
    display: none !important;
  }
  .blackboard-panel[data-mode="between-rounds"] .answers-host,
  .blackboard-panel[data-mode="between-rounds"] .typed-answer-host,
  .blackboard-panel[data-mode="between-rounds"] .advantage-bar,
  .blackboard-panel[data-mode="between-rounds"] .race-strip,
  .blackboard-panel[data-mode="between-rounds"] .blackboard-foot {
    display: none !important;
  }
  .blackboard-panel[data-mode="in-lounge"] .answers-host,
  .blackboard-panel[data-mode="in-lounge"] .typed-answer-host,
  .blackboard-panel[data-mode="in-lounge"] .advantage-bar,
  .blackboard-panel[data-mode="in-lounge"] .race-strip,
  .blackboard-panel[data-mode="in-lounge"] .blackboard-foot,
  .blackboard-panel[data-mode="in-lounge"] .blackboard-meta,
  .blackboard-panel[data-mode="in-lounge"] .board-frame-host {
    display: none !important;
  }
  .blackboard-panel[data-mode="needs-auth"] .answers-host,
  .blackboard-panel[data-mode="needs-auth"] .typed-answer-host,
  .blackboard-panel[data-mode="needs-auth"] .advantage-bar,
  .blackboard-panel[data-mode="needs-auth"] .race-strip,
  .blackboard-panel[data-mode="needs-auth"] .blackboard-foot,
  .blackboard-panel[data-mode="needs-character"] .answers-host,
  .blackboard-panel[data-mode="needs-character"] .typed-answer-host,
  .blackboard-panel[data-mode="needs-character"] .advantage-bar,
  .blackboard-panel[data-mode="needs-character"] .race-strip,
  .blackboard-panel[data-mode="needs-character"] .blackboard-foot,
  .blackboard-panel[data-mode="checking-auth"] .answers-host,
  .blackboard-panel[data-mode="checking-auth"] .typed-answer-host,
  .blackboard-panel[data-mode="checking-auth"] .advantage-bar,
  .blackboard-panel[data-mode="checking-auth"] .race-strip,
  .blackboard-panel[data-mode="checking-auth"] .blackboard-foot {
    display: none !important;
  }
  /* Freeform rounds use the board-owned typed-answer form, not global chat. */
  .blackboard-panel[data-opinion="true"] .answers-host,
  .blackboard-panel[data-typed-answer="true"] .answers-host,
  .blackboard-panel[data-typed-answer="false"] .typed-answer-host {
    display: none !important;
  }
  .blackboard-meta {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    padding: 10px calc(var(--safe-right) + 12px) 8px calc(var(--safe-left) + 12px);
    min-width: 0;
  }
  .blackboard-empty {
    padding: 24px 16px;
    text-align: center;
    color: var(--text-soft);
    font-size: 14px;
  }
  /* Block under the empty-board lead text. Hosts the class-grade chip row;
   * graduation now renders inside the chalkboard frame itself. */
  .blackboard-empty-extras {
    margin: 14px auto 0;
    max-width: 540px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }
  .blackboard-empty-extras:empty { display: none; }
  .board-class-grades {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
  }
  .board-class-grades-title {
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-mute);
  }
  .board-class-grades-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: center;
  }
  .board-class-grades .class-grade-chip {
    min-width: 48px;
    height: 30px;
    padding: 0 9px;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    background: rgba(255,255,255,0.08);
    border: 1px solid rgba(255,255,255,0.16);
    color: var(--text-soft);
    font: 900 12px/1 -apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif;
  }
  .board-class-grades .class-grade-chip.is-met {
    background: rgba(76,181,85,0.20);
    border-color: rgba(76,181,85,0.45);
    color: #b9f2bd;
  }
  .board-class-grades .class-grade-icon {
    font-size: 13px;
    line-height: 1;
  }
  .board-class-grades .class-grade-letter {
    font-size: 12px;
    letter-spacing: 0;
  }
  .board-frame-host {
    padding: 0 calc(var(--safe-right) + 10px) 0 calc(var(--safe-left) + 10px);
    position: relative;
    flex: 0 1 auto;
    min-height: 0;
    min-width: 0;
  }
  .teacher-figure {
    /* Round head-shoulders portrait pinned to the top-right corner of the
     * chalkboard, like a JRPG "currently speaking" badge. Uses the -face
     * crop so it fits cleanly without overflowing the panel. */
    position: absolute;
    right: 8px;
    top: 8px;
    width: 64px;
    height: 64px;
    object-fit: cover;
    object-position: center top;
    border-radius: 999px;
    border: 3px solid var(--accent);
    background: var(--bg-elev);
    box-shadow: 0 6px 14px rgba(0,0,0,0.4);
    pointer-events: none;
    z-index: 3;
    animation: figure-in 0.32s ease-out;
    transition: border-color 0.2s ease;
  }
  @media (min-width: 720px) {
    .teacher-figure { width: 92px; height: 92px; right: 12px; top: 12px; }
  }
  @media (min-width: 1100px) {
    .teacher-figure { width: 110px; height: 110px; right: 16px; top: 16px; }
  }
  @keyframes figure-in {
    from { opacity: 0; transform: translateY(8px) scale(0.95); }
    to { opacity: 1; transform: none; }
  }
  .lounge-stage {
    grid-row: 2;
    background: linear-gradient(180deg, var(--bg) 0%, var(--bg-elev) 100%);
    border-bottom: 1px solid var(--line);
    padding: 14px calc(var(--safe-right) + 12px) 12px calc(var(--safe-left) + 12px);
    display: none;
    flex-direction: column;
    gap: 10px;
  }
  .lounge-stage.is-open { display: flex; }
  .lounge-stage .lounge-title {
    font-size: 12px;
    color: var(--text-mute);
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }
  .lounge-figures {
    display: flex;
    align-items: flex-end;
    justify-content: space-around;
    gap: 6px;
    min-height: 130px;
  }
  .lounge-figures img {
    height: 130px;
    width: auto;
    filter: drop-shadow(0 6px 10px rgba(0,0,0,0.35));
  }
  .answers-host {
    padding: 10px calc(var(--safe-right) + 10px) 10px calc(var(--safe-left) + 10px);
    /* The blackboard-panel clips overflow, so very long answers used to
       extend off-screen with no way to scroll to them. Make the host
       itself the scroll surface and cap its height so the prompt stays
       above the fold. */
    overflow-y: auto;
    max-height: 55vh;
    scrollbar-gutter: stable;
    -webkit-overflow-scrolling: touch;
    flex: 0 1 auto;
    min-height: 0;
    min-width: 0;
  }
  .typed-answer-host {
    padding: 10px calc(var(--safe-right) + 10px) 10px calc(var(--safe-left) + 10px);
    flex: 0 0 auto;
    min-width: 0;
  }
  .typed-answer-form {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: 8px;
    align-items: center;
  }
  .typed-answer-input {
    min-width: 0;
    height: 44px;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: var(--bg-elev);
    color: var(--text);
    padding: 0 12px;
    font: 600 14px/1 -apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif;
    outline: none;
  }
  .typed-answer-input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-soft);
  }
  .typed-submit-btn,
  .typed-mc-btn {
    appearance: none;
    height: 44px;
    border: none;
    border-radius: 10px;
    padding: 0 14px;
    font: 800 12px/1 -apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    cursor: pointer;
  }
  .typed-submit-btn {
    background: var(--accent);
    color: #fff;
  }
  .typed-mc-btn {
    background: var(--bg-elev-2);
    color: var(--text);
    border: 1px solid var(--line);
  }
  .typed-submit-btn:disabled,
  .typed-mc-btn:disabled,
  .typed-answer-input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  @media (max-width: 520px) {
    .typed-answer-form {
      grid-template-columns: 1fr auto;
    }
    .typed-answer-input {
      grid-column: 1 / -1;
    }
  }
  .race-strip {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px calc(var(--safe-right) + 12px) 8px calc(var(--safe-left) + 12px);
    flex-wrap: wrap;
  }
  .timer-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 800;
    color: #fff;
    background: var(--accent);
    box-shadow: 0 2px 0 rgba(0,0,0,0.18);
    transition: background 0.18s ease;
  }
  .timer-pill.is-warn { background: #f0922a; }
  .timer-pill.is-danger { background: #d22a2a; animation: timer-pulse 0.7s ease-in-out infinite; }
  @keyframes timer-pulse {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.05); }
  }
  .timer-pill .ring {
    width: 12px;
    height: 12px;
    border-radius: 999px;
    border: 2px solid rgba(255,255,255,0.45);
    border-top-color: #fff;
    animation: spin 1.2s linear infinite;
  }
  .timer-pill.is-locked .ring { animation: none; border-color: rgba(255,255,255,0.6); border-top-color: rgba(255,255,255,0.6); }
  @keyframes spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }
  .race-row {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .race-card {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 8px 3px 4px;
    border-radius: 999px;
    background: var(--bg-elev);
    border: 1px solid var(--line);
    font-size: 11px;
    font-weight: 700;
    color: var(--text-soft);
    transition: background 0.2s ease, color 0.2s ease;
  }
  .race-card.is-locked { background: var(--bg-elev-2); color: var(--text); }
  .race-card.is-correct { background: rgba(76,181,85,0.22); color: #b6f5b9; border-color: rgba(76,181,85,0.45); }
  .race-card.is-wrong { background: rgba(210,42,42,0.22); color: #ffb1b1; border-color: rgba(210,42,42,0.45); }
  .race-card.is-first-correct { box-shadow: 0 0 0 2px var(--accent); }
  .race-card .race-avatar {
    width: 18px;
    height: 18px;
    border-radius: 999px;
    background: #fff;
    overflow: hidden;
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    font-size: 10px;
    color: #1a2238;
    font-weight: 800;
  }
  .race-card .race-avatar img { width: 100%; height: 100%; object-fit: cover; object-position: center top; }
  .race-card .pick-letter {
    background: rgba(255,255,255,0.16);
    color: inherit;
    border-radius: 999px;
    padding: 1px 6px;
    font-weight: 800;
    font-size: 10px;
  }
  .race-card .thinking-dots {
    display: inline-flex;
    gap: 2px;
  }
  .race-card .thinking-dots span {
    width: 4px;
    height: 4px;
    border-radius: 999px;
    background: currentColor;
    opacity: 0.4;
    animation: thinking-bob 0.9s ease-in-out infinite;
  }
  .race-card .thinking-dots span:nth-child(2) { animation-delay: 0.15s; }
  .race-card .thinking-dots span:nth-child(3) { animation-delay: 0.3s; }
  @keyframes thinking-bob {
    0%, 100% { opacity: 0.3; transform: translateY(0); }
    50% { opacity: 1; transform: translateY(-2px); }
  }

  .blackboard-foot {
    display: none;
    align-items: center;
    gap: 8px;
    padding: 0 calc(var(--safe-right) + 12px) 10px calc(var(--safe-left) + 12px);
  }
  .blackboard-panel[data-question-type="class-report"] .blackboard-foot:not([hidden]) {
    display: flex !important;
  }
  .class-report-next {
    width: min(100%, 640px);
    margin: 0 auto;
    display: grid;
    grid-template-columns: 12px minmax(0, 1fr);
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border: 1px solid rgba(255,255,255,0.18);
    border-radius: 8px;
    background: rgba(5, 31, 20, 0.26);
    color: var(--ink);
    font-family: "RubyHighCraftyGirls", "Patrick Hand", "Segoe Print", cursive;
    box-shadow: inset 0 0 12px rgba(0,0,0,0.10);
    min-width: 0;
  }
  .class-report-next-mark {
    width: 10px;
    height: 10px;
    border-radius: 999px;
    background: rgba(255,255,255,0.58);
    box-shadow: 0 0 0 2px rgba(255,255,255,0.12);
  }
  .class-report-next.is-social .class-report-next-mark { background: #b8e4ff; }
  .class-report-next.is-practice .class-report-next-mark { background: #fff0a6; }
  .class-report-next-copy {
    min-width: 0;
    display: grid;
    gap: 1px;
  }
  .class-report-next-title {
    font-size: clamp(14px, 2vw, 18px);
    line-height: 1;
    color: #fff;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .class-report-next-body {
    font-size: clamp(11px, 1.5vw, 13px);
    line-height: 1.12;
    color: var(--ink-soft);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* ── chat stream ───────────────────────────────────────────────────────── */
  .stream {
    grid-row: 3;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 12px calc(var(--safe-right) + 12px) 14px calc(var(--safe-left) + 12px);
    display: flex;
    flex-direction: column;
    gap: 12px;
    -webkit-overflow-scrolling: touch;
    scroll-padding-bottom: 100px;
  }

  /* ── chat messages ─────────────────────────────────────────────────────── */
  .msg {
    display: grid;
    grid-template-columns: 36px 1fr;
    column-gap: 10px;
    row-gap: 2px;
    /* Without min-width:0 the .msg's intrinsic min-content (driven by the
       longest unbreakable token in .body — em-dashes, role tags, italics
       runs) propagates up through .stream and clips chat at the right
       viewport edge on narrow phones. */
    min-width: 0;
    max-width: 100%;
    animation: msg-in 0.18s ease-out;
  }
  @keyframes msg-in {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .msg .avatar {
    grid-row: 1 / 3;
    grid-column: 1;
    width: 36px;
    height: 36px;
    border-radius: 999px;
    background: var(--bg-elev);
    display: grid;
    place-items: center;
    font-weight: 800;
    font-size: 14px;
    color: #fff;
    align-self: start;
    overflow: hidden;
  }
  .msg .avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center top;
    display: block;
  }
  .msg .avatar.is-teacher {
    background: #fff;
    border: 2px solid var(--accent);
  }
  .msg .head {
    grid-column: 2;
    display: flex;
    align-items: baseline;
    gap: 6px;
    flex-wrap: wrap;
    min-width: 0;
  }
  .msg .head .name {
    font-weight: 700;
    font-size: 14px;
    color: var(--text);
  }
  .msg .head .role-tag {
    font-size: 9px;
    background: var(--bg-elev-2);
    color: var(--text-soft);
    padding: 1px 6px;
    border-radius: 999px;
    font-weight: 800;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .msg .head .role-tag.bot { background: #5865f2; color: #fff; }
  .msg .head .role-tag.student { background: #3aa3e0; color: #fff; }
  .msg .head .role-tag.you { background: var(--accent); color: #fff; }
  .msg .head .role-tag.social { background: rgba(184,228,255,0.18); color: #b8e4ff; }
  .msg .head .stamp {
    font-size: 10px;
    color: var(--text-mute);
  }
  .msg .body {
    grid-column: 2;
    color: var(--text);
    line-height: 1.5;
    font-size: 15px;
    white-space: pre-wrap;
    word-wrap: break-word;
    /* overflow-wrap 'anywhere' is the standard but is unsupported on
       older WebKit; 'break-word' ships everywhere. Keep both. */
    overflow-wrap: anywhere;
    overflow-wrap: break-word;
    word-break: break-word;
    min-width: 0;
    max-width: 100%;
  }
  .markdown {
    white-space: normal;
    word-wrap: break-word;
    overflow-wrap: anywhere;
  }
  .markdown p {
    margin: 0 0 0.45em;
    white-space: normal;
  }
  .markdown p:last-child { margin-bottom: 0; }
  .markdown h1,
  .markdown h2,
  .markdown h3,
  .markdown h4 {
    margin: 0 0 0.4em;
    color: inherit;
    line-height: 1.25;
    letter-spacing: 0;
  }
  .markdown h1 { font-size: 1.3em; }
  .markdown h2 { font-size: 1.18em; }
  .markdown h3 { font-size: 1.08em; }
  .markdown h4 { font-size: 1em; }
  .markdown ul,
  .markdown ol {
    margin: 0.35em 0 0.45em 1.25em;
    padding: 0;
    white-space: normal;
  }
  .markdown li { margin: 0.16em 0; }
  .markdown blockquote {
    margin: 0.45em 0;
    padding-left: 0.8em;
    border-left: 2px solid currentColor;
    opacity: 0.92;
    white-space: normal;
  }
  .markdown pre {
    margin: 0.45em 0;
    padding: 8px 10px;
    border-radius: 6px;
    background: rgba(0,0,0,0.28);
    color: var(--text);
    white-space: pre-wrap;
    overflow-x: auto;
  }
  .markdown code {
    font-family: "SF Mono", "Menlo", "Consolas", monospace;
    font-size: 0.92em;
    background: rgba(255,255,255,0.1);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 4px;
    padding: 0.08em 0.28em;
  }
  .markdown pre code {
    background: transparent;
    border: 0;
    padding: 0;
  }
  .markdown a {
    color: #8bd4ff;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .markdown strong { font-weight: 800; }
  .markdown-inline {
    white-space: inherit;
  }
  .msg.system { grid-template-columns: 1fr; }
  .msg.system .body {
    color: var(--text-mute);
    font-size: 12px;
    font-style: italic;
    text-align: center;
    padding: 4px 12px;
  }
  .msg.tool {
    grid-template-columns: 1fr;
  }
  .msg.tool .body {
    color: #b9f5c0;
    font-size: 12px;
    font-family: "SF Mono", "Menlo", monospace;
    background: rgba(76,181,85,0.1);
    border-left: 2px solid #4cb555;
    padding: 6px 10px;
    border-radius: 0 6px 6px 0;
    margin-left: 12px;
  }

  /* ── pills (used in blackboard meta) ──────────────────────────────────── */
  .pill {
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: 3px 8px;
    border-radius: 999px;
    background: rgba(255,255,255,0.08);
    color: var(--text);
    font-weight: 700;
  }
  .pill.faculty { background: var(--accent); color: #fff; }
  .pill.difficulty.easy { background: var(--diff-easy); color: #fff; }
  .pill.difficulty.medium { background: var(--diff-medium); color: #fff; }
  .pill.difficulty.hard { background: var(--diff-hard); color: #fff; }
  .pill.subject { background: var(--bg-elev-2); color: var(--text-soft); }
  .pill.stat {
    background: rgba(255,255,255,0.12);
    color: #fff;
    text-transform: none;
    letter-spacing: 0.02em;
  }
  .pill.stat.head { background: rgba(58,163,224,0.28); }
  .pill.stat.heart { background: rgba(224,88,150,0.28); }
  .pill.stat.hustle { background: rgba(240,180,65,0.30); }
  .pill.stat.honor { background: rgba(116,210,136,0.26); }

  .board-frame {
    background: linear-gradient(180deg, var(--board-frame-light), var(--board-frame));
    padding: 10px;
    min-width: 0;
  }
  .blackboard-panel[data-faculty="ruby"] .board-frame {
    background: linear-gradient(180deg, color-mix(in oklab, #d22a2a 82%, #fff), #941b1b);
  }
  .blackboard-panel[data-faculty="sally-science"] .board-frame {
    background: linear-gradient(180deg, color-mix(in oklab, #3aa3e0 78%, #fff), #1e5f86);
  }
  .blackboard-panel[data-faculty="professor-edward"] .board-frame {
    background: linear-gradient(180deg, color-mix(in oklab, #8a63d2 78%, #fff), #4e357e);
  }
  .blackboard-panel[data-card-role="practice"] .board-frame {
    background: linear-gradient(180deg, #7a6250, #4b3b31);
    box-shadow: 0 0 0 2px rgba(255,240,166,0.20) inset, 0 10px 26px rgba(0,0,0,0.24);
  }
  .blackboard-panel[data-card-role="class"] .board-frame {
    background: linear-gradient(180deg, color-mix(in oklab, #d22a2a 82%, #fff), #941b1b);
    box-shadow: 0 0 0 2px rgba(255,255,255,0.18) inset, 0 10px 26px rgba(0,0,0,0.24);
  }
  .blackboard-panel[data-card-role="social"] .board-frame {
    box-shadow: 0 0 0 2px rgba(240,180,65,0.42) inset, 0 10px 26px rgba(0,0,0,0.24);
  }
  .board {
    background:
      radial-gradient(circle at 18% 22%, rgba(255,255,255,0.04), transparent 40%),
      radial-gradient(circle at 75% 70%, rgba(255,255,255,0.03), transparent 40%),
      var(--board);
    color: var(--ink);
    border-radius: 6px;
    min-height: 100px;
    padding: 16px 18px;
    font-family: "RubyHighCraftyGirls", "Caveat", "Patrick Hand", "Segoe Print", cursive;
    font-size: 22px;
    line-height: 1.3;
    box-shadow: inset 0 0 60px rgba(0,0,0,0.35);
    min-width: 0;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }
  /* When the teacher portrait is visible, push board text away from the figure.
   * Figure is position:absolute inside .board-frame-host; board is inside .board-frame.
   * Default: 64px wide + 8px right offset + 10px gap = 82px right padding.
   * @720px: 92px + 12px + 10px = 114px. @1100px: 110px + 16px + 10px = 136px. */
  .board-frame-host:has(.teacher-figure:not([hidden])) .board { padding-right: 82px; }
  @media (min-width: 720px) {
    .board-frame-host:has(.teacher-figure:not([hidden])) .board { padding-right: 114px; }
  }
  @media (min-width: 1100px) {
    .board-frame-host:has(.teacher-figure:not([hidden])) .board { padding-right: 136px; }
  }
  .blackboard-panel[data-faculty="ruby"] .board {
    font-family: "RubyHighCaveat", "Caveat", "Patrick Hand", "Segoe Print", cursive;
    font-size: 26px;
    line-height: 1.22;
  }
  .blackboard-panel[data-faculty="sally-science"] .board {
    font-family: "RubyHighSchoolbell", "Patrick Hand", "Segoe Print", cursive;
    font-size: 21px;
    line-height: 1.42;
  }
  .blackboard-panel[data-faculty="professor-edward"] .board {
    font-family: "RubyHighGiveYouGlory", "Segoe Print", cursive;
    font-size: 24px;
    line-height: 1.38;
  }
  .board .prompt {
    white-space: pre-wrap;
    word-wrap: break-word;
    overflow-wrap: anywhere;
    hyphens: auto;
  }
  .board .prompt-text {
    min-width: 0;
  }
  .anki-media-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin: 0 0 10px;
  }
  .anki-media-grid img {
    max-width: min(100%, 360px);
    max-height: 220px;
    object-fit: contain;
    background: rgba(255,255,255,0.92);
    border: 2px solid rgba(255,255,255,0.55);
    border-radius: 6px;
    padding: 4px;
  }
  .blackboard-panel[data-question-type="image-occlusion"] .anki-media-grid img {
    filter: grayscale(1) contrast(1.18);
  }
  .board .prompt.markdown,
  .board .reveal .reveal-explanation.markdown {
    white-space: normal;
  }
  .board .prompt.markdown p {
    margin-bottom: 0.25em;
  }
  .board .reveal {
    margin-top: 12px;
    font-size: 15px;
    color: var(--ink-soft);
    border-left: 3px solid rgba(255,255,255,0.18);
    padding-left: 10px;
    font-family: -apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif;
    line-height: 1.5;
  }
  .board .reveal.correct { color: #b6f5b9; border-left-color: #4cb555; }
  .board .reveal.wrong { color: #ffb1b1; border-left-color: #d22a2a; }
  .board .reveal .reveal-verdict { font-weight: 700; }
  .board .reveal .reveal-explanation {
    margin-top: 6px;
    font-size: 14px;
    color: var(--ink-soft);
    opacity: 0.85;
  }
  .board .reveal .typed-reveal {
    margin-top: 6px;
    display: grid;
    gap: 2px;
    color: var(--ink-soft);
    font-size: 14px;
  }
  .board .reveal .typed-judge {
    opacity: 0.8;
  }
  /* The roll chip already has 6px left margin; inside .reveal it inherits
     the hit/mixed/miss color so the dice land beside the verdict legibly. */
  .board .reveal .roll-chip { vertical-align: middle; }
  .answers {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    min-width: 0;
  }
  /* Long-answer mode: when any choice exceeds the compact mobile threshold,
     the script toggles .is-long on the grid. On narrow viewports we drop
     to a single column so each answer gets full width and stays readable
     instead of wrapping into a tall, half-width brick that's hard
     to scan. The scrollable answers-host keeps the whole stack
     reachable even when several answers are long. */
  .answers.is-very-long { grid-template-columns: 1fr; }
  @media (max-width: 720px) {
    .answers.is-long { grid-template-columns: 1fr; }
  }
  .answer {
    --bg: #f0922a;
    appearance: none;
    border: none;
    background: var(--bg);
    color: #1a2238;
    border-radius: 12px;
    padding: 14px 14px 14px 56px;
    font-weight: 700;
    text-align: left;
    box-shadow: 0 2px 0 rgba(0,0,0,0.15), 0 4px 10px rgba(0,0,0,0.18);
    position: relative;
    min-height: 56px;
    min-width: 0;
    width: 100%;
    transition: transform 0.06s ease, opacity 0.12s ease;
    font-size: 15px;
  }
  .answer:active { transform: translateY(1px); }
  .answer:disabled { opacity: 0.5; cursor: default; box-shadow: none; }
  .answer .badge {
    position: absolute;
    left: 10px;
    top: 50%;
    transform: translateY(-50%);
    width: 36px;
    height: 36px;
    border-radius: 999px;
    background: rgba(255,255,255,0.92);
    color: #1a2238;
    display: grid;
    place-items: center;
    font-weight: 800;
    font-size: 16px;
  }
  .answer .label {
    display: block;
    min-width: 0;
    overflow-wrap: anywhere;
    word-break: break-word;
    hyphens: auto;
  }
  .answer.A { --bg: #f0922a; }
  .answer.B { --bg: #f7d33a; }
  .answer.C { --bg: #4cb555; color: #fff; }
  .answer.C .badge { color: #1a2238; }
  .answer.D { --bg: #3aa3e0; color: #fff; }
  .answer.D .badge { color: #1a2238; }
  .answer.is-correct { outline: 3px solid #1f7c2a; outline-offset: -1px; }
  .answer.is-wrong { outline: 3px solid #a01818; outline-offset: -1px; opacity: 0.85; }
  /* Advantage roll crossed this choice off the board. */
  .answer.is-eliminated {
    opacity: 0.35;
    cursor: not-allowed;
    text-decoration: line-through;
    text-decoration-thickness: 3px;
    text-decoration-color: rgba(0,0,0,0.55);
    filter: grayscale(0.7);
  }
  .advantage-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 10px;
    padding: 8px 10px;
    background: rgba(255,255,255,0.04);
    border: 1px dashed rgba(255,255,255,0.15);
    border-radius: 10px;
  }
  .advantage-btn {
    appearance: none;
    border: none;
    background: var(--accent);
    color: #fff;
    font: 700 12px/1 -apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    padding: 8px 12px;
    border-radius: 999px;
    cursor: pointer;
    box-shadow: 0 2px 0 rgba(0,0,0,0.25);
  }
  .advantage-btn:hover { filter: brightness(1.1); }
  .advantage-btn:disabled { opacity: 0.5; cursor: not-allowed; box-shadow: none; }
  .advantage-result {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-family: "SF Mono", "Menlo", monospace;
    color: var(--text-soft);
  }
  .advantage-result.hit   { color: #b6f5b9; }
  .advantage-result.mixed { color: #f5c98a; }
  .advantage-result.miss  { color: #ffb1b1; }

  /* Roll badge in the chat result chip */
  .roll-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-left: 6px;
    padding: 1px 7px;
    border-radius: 999px;
    font-size: 10px;
    font-weight: 800;
    background: var(--bg-elev-2);
    color: var(--text-soft);
    font-family: "SF Mono", "Menlo", monospace;
  }
  .roll-chip.hit   { background: rgba(76,181,85,0.22);  color: #b6f5b9; }
  .roll-chip.mixed { background: rgba(240,146,42,0.22); color: #f5c98a; }
  .roll-chip.miss  { background: rgba(210,42,42,0.22);  color: #ffb1b1; }
  .score-multiplier-chip {
    display: inline-flex;
    align-items: center;
    margin-left: 6px;
    padding: 1px 7px;
    border-radius: 999px;
    font-size: 10px;
    font-weight: 900;
    background: rgba(240,180,65,0.22);
    color: #ffe08a;
    font-family: "SF Mono", "Menlo", monospace;
  }
  .mash-tick-chip {
    display: inline-flex;
    align-items: center;
    margin-left: 6px;
    padding: 1px 7px;
    border-radius: 999px;
    font-size: 10px;
    font-weight: 900;
    font-family: "SF Mono", "Menlo", monospace;
    background: rgba(255, 255, 255, 0.08);
    color: var(--text-soft);
  }
  .mash-tick-chip.up { background: rgba(82,198,115,0.2); color: #b6f5b9; }
  .mash-tick-chip.down { background: rgba(210,42,42,0.2); color: #ffb1b1; }
  .mash-tick-chip.steady { background: rgba(58,163,224,0.18); color: #b8e4ff; }
  .msg.social-summary .social-summary-avatar {
    background: rgba(184,228,255,0.18);
    border: 1px solid rgba(184,228,255,0.42);
    color: #b8e4ff;
    font-weight: 900;
    font-family: "SF Mono", "Menlo", monospace;
  }
  .social-summary-list {
    display: grid;
    gap: 5px;
    min-width: 0;
  }
  .social-summary-row {
    display: grid;
    grid-template-columns: 10px minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    padding: 5px 7px;
    border-radius: 8px;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.07);
    min-width: 0;
  }
  .social-summary-row.is-up { border-color: rgba(82,198,115,0.22); }
  .social-summary-row.is-down { border-color: rgba(210,42,42,0.24); }
  .social-summary-dot {
    width: 9px;
    height: 9px;
    border-radius: 999px;
    box-shadow: 0 0 0 2px rgba(255,255,255,0.08);
  }
  .social-summary-story {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .social-summary-delta {
    font-size: 11px;
    font-weight: 900;
    font-family: "SF Mono", "Menlo", monospace;
    color: var(--text-soft);
  }
  .social-summary-row.is-up .social-summary-delta { color: #b6f5b9; }
  .social-summary-row.is-down .social-summary-delta { color: #ffb1b1; }

  /* ── unified CCG-style character card ─────────────────────────────────── */
  .ccg-card {
    width: 100%;
    max-width: 300px;
    background: linear-gradient(180deg, var(--bg-elev) 0%, var(--bg) 100%);
    border: 3px solid var(--accent);
    border-radius: 18px;
    box-shadow:
      0 0 0 1px rgba(255,255,255,0.08) inset,
      0 18px 40px rgba(0,0,0,0.55),
      0 0 24px rgba(210,42,42,0.15);
    overflow: hidden;
    color: var(--text);
    display: flex;
    flex-direction: column;
    position: relative;
  }
  .ccg-role {
    position: absolute;
    top: 10px;
    left: 12px;
    z-index: 2;
    padding: 4px 10px;
    border-radius: 999px;
    font-size: 9px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    font-weight: 800;
    color: #fff;
    background: var(--accent);
    box-shadow: 0 4px 10px rgba(0,0,0,0.4);
  }
  .ccg-role.student { background: #3aa3e0; }
  .ccg-role.teacher { background: #5865f2; }
  .ccg-role.player  { background: var(--accent); }
  .ccg-role.career  { background: #f0b441; color: #1a1520; }
  .ccg-art {
    aspect-ratio: 5 / 4;
    width: 100%;
    background: var(--bg-elev-2);
    overflow: hidden;
    position: relative;
  }
  .ccg-art img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center top;
    display: block;
  }
  .ccg-art::after {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 50px;
    background: linear-gradient(180deg, transparent, var(--bg-elev) 90%);
    pointer-events: none;
  }
  .ccg-body {
    padding: 10px 12px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .ccg-name {
    font-size: 18px;
    font-weight: 900;
    color: var(--text);
    letter-spacing: 0;
    line-height: 1.1;
  }
  .ccg-subtitle {
    font-size: 11px;
    color: var(--text-mute);
    letter-spacing: 0.04em;
    margin-top: -2px;
  }
  .ccg-stats {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    padding: 8px 10px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: rgba(0,0,0,0.18);
    font-family: "SF Mono", "Menlo", monospace;
    font-size: 12px;
    color: var(--text-soft);
  }
  .ccg-stats .stat {
    display: inline-flex;
    align-items: baseline;
    gap: 4px;
  }
  .ccg-stats .stat .k {
    color: var(--text-mute);
    letter-spacing: 0.1em;
    font-size: 10px;
    text-transform: uppercase;
  }
  .ccg-stats .stat .v {
    color: var(--text);
    font-weight: 800;
    font-size: 13px;
  }
  .ccg-stats .stat .v.pos { color: #b6f5b9; }
  .ccg-stats .stat .v.neg { color: #ffb1b1; }
  .ccg-rule {
    height: 1px;
    background: linear-gradient(90deg, transparent, var(--line), transparent);
    margin: 2px 0;
  }
  .ccg-body-text {
    font-size: 14px;
    line-height: 1.55;
    color: var(--text);
  }
  .ccg-quote {
    border-left: 3px solid var(--accent);
    padding: 6px 12px;
    margin: 0;
    color: var(--text-soft);
    font-style: italic;
    font-size: 13px;
    line-height: 1.5;
    background: rgba(0,0,0,0.18);
    border-radius: 0 8px 8px 0;
  }
  .ccg-progression {
    padding: 8px 10px;
    background: rgba(0,0,0,0.18);
    border: 1px solid var(--line);
    border-radius: 8px;
    margin-top: 4px;
  }
  .ccg-progression-title {
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-mute);
    margin-bottom: 6px;
  }
  .ccg-progression .rungs {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .ccg-progression .rung {
    display: grid;
    grid-template-columns: minmax(34px, 44px) minmax(48px, 1fr) repeat(3, minmax(28px, 34px));
    align-items: center;
    gap: 4px;
    font-size: 12px;
    line-height: 1.3;
    min-height: 36px;
    padding: 3px 2px;
    border-radius: 6px;
  }
  .ccg-progression .rung.is-completed { color: var(--text-mute); }
  .ccg-progression .rung.is-current {
    color: var(--text);
    background: rgba(255,255,255,0.04);
  }
  .ccg-progression .rung.is-future { color: var(--text-mute); opacity: 0.7; }
  .ccg-progression .rung-streak {
    display: inline-flex;
    align-items: center;
    justify-content: flex-start;
    gap: 1px;
    min-width: 0;
    color: #f0b441;
    line-height: 1;
  }
  .ccg-progression .rung-streak-diamond {
    width: 9px;
    text-align: center;
    font-size: 11px;
    font-weight: 900;
  }
  .ccg-progression .rung.is-future .rung-streak { color: var(--text-mute); }
  .ccg-progression .rung.is-completed .rung-streak { color: rgba(240,180,65,0.58); }
  .ccg-progression .rung-label { font-weight: 700; }
  .ccg-progression .rung.is-current .rung-label { color: var(--accent); }
  .ccg-progression .rung-gates {
    display: contents;
    font-size: 11px;
    color: var(--text-soft);
    min-width: 0;
  }
  .ccg-progression .gate-ring {
    --pct: 0%;
    width: 28px;
    height: 28px;
    border-radius: 999px;
    padding: 1px;
    background:
      conic-gradient(var(--gate-color, #3aa3e0) var(--pct), rgba(255,255,255,0.10) 0),
      rgba(255,255,255,0.04);
    box-shadow: inset 0 0 0 1px rgba(255,255,255,0.08);
    display: inline-grid;
    place-items: center;
    flex: 0 0 auto;
    font-variant-numeric: tabular-nums;
  }
  .ccg-progression .gate-ring.streak-ring { --gate-color: #f0b441; }
  .ccg-progression .gate-ring.class-ring { --gate-color: #4cb555; }
  .ccg-progression .gate-ring.is-met {
    background:
      rgba(255,255,255,0.075);
    box-shadow:
      inset 0 0 0 1px rgba(255,255,255,0.12);
  }
  .ccg-progression .gate-core {
    width: 100%;
    height: 100%;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 1px;
    background: rgba(25,27,40,0.94);
    color: var(--text-soft);
    line-height: 1;
    font-size: 10px;
    font-weight: 900;
  }
  .ccg-progression .gate-ring.is-met .gate-core {
    color: var(--gate-color);
    background: rgba(25,27,40,0.94);
  }
  .ccg-progression .gate-ring.streak-ring.is-met .gate-core { color: #f0b441; }
  .ccg-progression .gate-ring.class-ring.is-met {
    background: #4cb555;
    box-shadow:
      inset 0 0 0 1px rgba(228,255,230,0.18);
  }
  .ccg-progression .gate-ring.class-ring.is-met .gate-core {
    color: #f4fff4;
    background: #4cb555;
    text-shadow: none;
  }
  .ccg-progression .gate-icon {
    font-size: 12px;
    font-weight: 900;
    line-height: 1;
  }
  .ccg-progression .gate-ring.class-ring .gate-icon {
    font-size: 16px;
    transform: translateY(-0.5px);
  }
  .ccg-progression .gate-ring.class-ring.is-met .gate-icon { font-size: 17px; }
  .ccg-progression .gate-count {
    color: var(--text);
    font-size: 10px;
    font-weight: 900;
  }
  .ccg-progression .future-req {
    width: 30px;
    min-width: 0;
    height: 26px;
    padding: 0;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 3px;
    background: rgba(255,255,255,0.028);
    border: 1px solid rgba(255,255,255,0.08);
    color: var(--text-mute);
    opacity: 0.58;
    font-variant-numeric: tabular-nums;
    line-height: 1;
    justify-self: center;
  }
  .ccg-progression .future-req-icon {
    font-size: 14px;
    font-weight: 900;
  }
  .ccg-progression .future-req-count {
    font-size: 11px;
    font-weight: 900;
  }
  .ccg-progression .class-grade-chip {
    width: 34px;
    min-width: 0;
    height: 26px;
    padding: 0 2px;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 2px;
    background: rgba(255,255,255,0.035);
    border: 1px solid rgba(255,255,255,0.09);
    color: var(--text-mute);
    font-weight: 900;
    line-height: 1;
    justify-self: center;
  }
  .ccg-progression .class-grade-chip.is-met {
    background: rgba(76,181,85,0.18);
    border-color: rgba(76,181,85,0.42);
    color: #b9f2bd;
  }
  .ccg-progression .class-grade-icon {
    font-size: 15px;
    line-height: 1;
  }
  .ccg-progression .class-grade-letter {
    font-size: 11px;
    letter-spacing: 0;
  }
  .ccg-footer {
    padding: 8px 10px;
    background: rgba(0,0,0,0.22);
    border-top: 1px solid var(--line);
    border-radius: 0 0 14px 14px;
    margin: 8px -12px -12px;
    font-size: 11px;
    color: var(--text-soft);
    line-height: 1.4;
  }
  .ccg-footer strong {
    color: var(--text);
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 11px;
    display: block;
    margin-bottom: 2px;
  }
  .ccg-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 12px;
  }
  .ccg-actions button {
    appearance: none;
    border: none;
    background: var(--accent);
    color: #fff;
    font-weight: 800;
    border-radius: 999px;
    padding: 9px 16px;
    font-size: 13px;
    cursor: pointer;
  }
  .ccg-actions button.secondary {
    background: var(--bg-elev);
    color: var(--text-soft);
  }
  .ccg-actions button:disabled { opacity: 0.5; }

  /* ── character sheet overlay ──────────────────────────────────────────── */
  .sheet-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.65);
    backdrop-filter: blur(8px);
    z-index: 60;
    display: none;
    align-items: center;
    justify-content: center;
    padding: 20px;
    overflow-y: auto;
  }
  .sheet-overlay.is-open { display: flex; }
  /* Universal close affordance for the sheet overlay. The X tracks the
     overlay rather than any individual card variant — replaces every
     per-card "Close" button. Hidden on the fallback signin overlay. */
  .sheet-close {
    position: absolute;
    top: max(env(safe-area-inset-top, 0), 12px);
    right: max(env(safe-area-inset-right, 0), 12px);
    width: 40px;
    height: 40px;
    border-radius: 999px;
    background: rgba(0,0,0,0.55);
    color: #fff;
    border: 1px solid var(--line);
    font-size: 22px;
    line-height: 1;
    cursor: pointer;
    z-index: 1;
  }
  .sheet-close:hover { background: rgba(0,0,0,0.75); }
  .sheet-overlay.is-mandatory .sheet-close { display: none; }
  /* Fallback overlay: shown only when a guest Ruby High session cannot be
     established. Always rendered (display:flex) so the fallback boot has
     nothing stale painted behind it; aria-hidden flips off when usable. */
  .sheet-overlay.is-mandatory { display: flex; }
  .sheet-overlay.is-mandatory[aria-hidden="true"] { display: none; }
  .signin-card { text-align: center; max-width: 440px; }
  .signin-card .primary-link {
    display: inline-block;
    background: var(--accent);
    color: #fff;
    text-decoration: none;
    padding: 12px 22px;
    border-radius: 999px;
    font-weight: 800;
    font-size: 15px;
  }
  .sheet-card {
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: 18px;
    padding: 20px;
    max-width: 560px;
    width: 100%;
    max-height: calc(100dvh - 40px);
    overflow-y: auto;
    box-shadow: 0 20px 60px rgba(0,0,0,0.5);
  }
  .sheet-card.is-card-deck-sheet {
    max-width: min(840px, calc(100vw - 40px));
    padding: 16px;
  }
  .sheet-card h2 {
    margin: 0 0 4px;
    font-size: 22px;
    color: var(--accent);
  }
  .sheet-card .sub {
    margin: 0 0 14px;
    color: var(--text-mute);
    font-size: 13px;
  }
  .sheet-card .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 12px;
  }
  .sheet-card .field label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.16em;
    color: var(--text-mute);
  }
  .sheet-card input[type="text"],
  .sheet-card textarea {
    background: var(--bg-elev);
    border: 1px solid var(--line);
    color: var(--text);
    border-radius: 10px;
    padding: 8px 10px;
    font: inherit;
    font-size: 16px;
  }
  .sheet-card textarea {
    resize: vertical;
    min-height: 56px;
  }
  .playbook-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  @media (min-width: 640px) {
    .playbook-grid { grid-template-columns: repeat(3, 1fr); }
  }
  .playbook-card {
    appearance: none;
    background: var(--bg-elev);
    border: 1.5px solid var(--line);
    color: var(--text);
    border-radius: 12px;
    padding: 10px;
    text-align: left;
    cursor: pointer;
    transition: border-color 0.12s ease, transform 0.06s ease;
  }
  .playbook-card:hover { border-color: var(--text-mute); }
  .playbook-card.is-selected {
    border-color: var(--accent);
    background: rgba(210, 42, 42, 0.06);
  }
  .playbook-card .name {
    font-weight: 800;
    font-size: 13px;
    margin-bottom: 2px;
  }
  .playbook-card .blurb {
    color: var(--text-mute);
    font-size: 11px;
    line-height: 1.35;
  }
  .stat-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
  }
  .stat-cell {
    background: var(--bg-elev);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 8px;
    text-align: center;
  }
  .stat-cell .stat-label {
    font-size: 10px;
    color: var(--text-mute);
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }
  .stat-cell .stat-value {
    font-weight: 800;
    font-size: 18px;
    color: var(--text);
    margin: 4px 0;
  }
  .stat-cell .stat-controls {
    display: flex;
    justify-content: center;
    gap: 4px;
  }
  .stat-cell button {
    appearance: none;
    background: var(--bg);
    border: 1px solid var(--line);
    color: var(--text);
    width: 24px;
    height: 24px;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 800;
  }
  .stat-cell button:disabled { opacity: 0.4; cursor: not-allowed; }
  .stat-budget {
    text-align: center;
    font-size: 11px;
    color: var(--text-mute);
    margin-top: 6px;
  }
  .stat-budget.is-invalid { color: #ff8c8c; }
  .sheet-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 14px;
  }
  .sheet-actions button {
    appearance: none;
    border: none;
    background: var(--accent);
    color: #fff;
    font-weight: 800;
    border-radius: 999px;
    padding: 10px 18px;
    font-size: 14px;
    cursor: pointer;
  }
  .sheet-actions button:disabled { opacity: 0.4; cursor: not-allowed; }
  .sheet-actions button.secondary {
    background: var(--bg-elev);
    color: var(--text-soft);
  }

  /* ── creation: full-pane loading state ──────────────────────────────── */
  /* Replaces the half-rendered empty form during the first roll. The
     player sees only this until rolled lands; then revealForm() flips
     it. Centered + tall enough that the modal doesn't visibly resize
     between loading and loaded. */
  .creation-loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    min-height: 320px;
    padding: 40px 20px;
  }
  .creation-loading-spinner {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    border: 4px solid rgba(255,255,255,0.12);
    border-top-color: var(--accent);
    animation: creation-spin 0.9s linear infinite;
  }
  @keyframes creation-spin {
    to { transform: rotate(360deg); }
  }
  .creation-loading-title {
    font-size: 18px;
    font-weight: 800;
    color: var(--text);
    letter-spacing: 0.04em;
  }
  .creation-loading-sub {
    font-size: 13px;
    color: var(--text-mute);
  }

  /* ── creation card surfaces ──────────────────────────────────────────── */
  /* The creation card is a two-column layout on wide viewports — portrait
     on the left, fields on the right — so the portrait can be tall
     without the form stretching. On mobile (<= 600px) it stacks; the
     portrait goes full-width and noticeably bigger since the user is
     scrolling anyway. */
  .creation-card {
    display: grid;
    grid-template-columns: 200px 1fr;
    gap: 16px;
    align-items: start;
    margin: 8px 0 12px;
  }
  @media (max-width: 600px) {
    .creation-card { grid-template-columns: 1fr; }
  }
  .creation-portrait {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }
  .creation-portrait img {
    width: 200px;
    height: 260px;
    object-fit: cover;
    object-position: center top;
    border-radius: 12px;
    border: 2px solid var(--accent);
    background: var(--bg-elev-2);
  }
  @media (max-width: 600px) {
    /* Mobile gets a generously larger portrait — the user is scrolling
       to see the rerolls below it anyway, so we may as well let the
       art breathe. */
    .creation-portrait img {
      width: min(280px, 80vw);
      height: min(360px, 105vw);
    }
  }
  @media (max-width: 430px) {
    .sheet-overlay {
      align-items: flex-start;
      padding: calc(var(--safe-top) + 10px) 8px calc(var(--safe-bot) + 10px);
    }
    .sheet-card {
      max-height: calc(100dvh - var(--safe-top) - var(--safe-bot) - 20px);
      padding: 14px;
      border-radius: 14px;
    }
    .sheet-card.is-card-deck-sheet {
      max-width: calc(100vw - 16px);
      padding: 8px;
    }
    .ccg-card {
      border-radius: 14px;
    }
  }
  .creation-ai-portrait {
    appearance: none;
    border: 1px solid var(--line);
    background: var(--bg-elev);
    color: var(--text);
    border-radius: 999px;
    padding: 6px 14px;
    font-weight: 700;
    font-size: 12px;
    cursor: pointer;
  }
  .creation-ai-portrait:hover { background: var(--bg-elev-2); }
  .creation-ai-portrait:disabled { opacity: 0.5; cursor: not-allowed; }
  .creation-portrait-status {
    font-size: 11px;
    color: var(--text-mute);
    min-height: 14px;
  }
  .creation-portrait-status.is-invalid { color: #ff8c8c; }
  .creation-fields {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 4px 0 8px;
  }
  .creation-row {
    display: grid;
    grid-template-columns: 80px 1fr auto;
    align-items: start;
    gap: 8px;
    padding: 8px 10px;
    background: var(--bg-elev);
    border: 1px solid var(--line);
    border-radius: 10px;
  }
  .creation-row-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-mute);
    font-weight: 800;
    padding-top: 2px;
  }
  .creation-row-value {
    font-size: 13px;
    line-height: 1.45;
    color: var(--text);
    word-break: break-word;
  }
  .creation-reroll {
    appearance: none;
    border: 1px solid var(--line);
    background: var(--bg);
    color: var(--text);
    border-radius: 999px;
    width: 28px;
    height: 28px;
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
  }
  .creation-reroll:hover { background: var(--bg-elev-2); }
  .creation-reroll:disabled { opacity: 0.4; cursor: not-allowed; }

  /* ── in-card actions strip ───────────────────────────────────────────── */
  /* Replaces the legacy .sheet-actions row that used to render OUTSIDE
     the card. Lives inside .ccg-body so the card stays a single
     rectangle. Kept thin and right-aligned so it doesn't compete with
     the body content for visual weight. */
  .ccg-card-actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
    margin-top: 6px;
  }
  .ccg-card-actions button {
    appearance: none;
    border: 1px solid var(--line);
    background: var(--bg);
    color: var(--text);
    border-radius: 999px;
    padding: 6px 12px;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
  }
  .ccg-card-actions button.secondary {
    background: var(--bg-elev);
    color: var(--text-soft);
  }

  /* ── progression "what you need" hint ────────────────────────────────── */
  .ccg-next-step {
    padding: 8px 10px;
    background: rgba(210, 42, 42, 0.10);
    border: 1px solid rgba(210, 42, 42, 0.32);
    border-radius: 8px;
    color: var(--text);
    font-size: 12px;
    line-height: 1.45;
    margin-top: 4px;
  }
  .graduation-ceremony {
    margin-top: 6px;
    padding: 10px;
    border: 1px solid rgba(250, 186, 55, 0.45);
    background: linear-gradient(180deg, rgba(250, 186, 55, 0.16), rgba(250, 186, 55, 0.06));
    border-radius: 8px;
    box-shadow: 0 0 18px rgba(250, 186, 55, 0.10);
  }
  .graduation-title {
    color: #ffd46a;
    font-weight: 900;
    font-size: 16px;
    line-height: 1.1;
  }
  .graduation-note {
    color: var(--text-soft);
    font-size: 11px;
    line-height: 1.35;
    margin-top: 4px;
  }
  .graduation-status {
    min-height: 15px;
    margin-top: 5px;
    color: #ffd46a;
    font-size: 10px;
    font-weight: 700;
  }
  .graduation-status.is-invalid { color: #ff9b9b; }
  .graduation-groups {
    display: grid;
    gap: 8px;
    margin-top: 4px;
  }
  .graduation-group-label {
    color: var(--text-mute);
    text-transform: uppercase;
    letter-spacing: 0.14em;
    font-size: 9px;
    font-weight: 900;
    margin-bottom: 4px;
  }
  .graduation-choice-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .graduation-choice {
    appearance: none;
    border: 1px solid rgba(255,255,255,0.12);
    background: rgba(255,255,255,0.07);
    color: var(--text);
    border-radius: 999px;
    min-height: 34px;
    padding: 5px 9px;
    display: inline-flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: center;
    line-height: 1.05;
    cursor: pointer;
  }
  .graduation-choice .main {
    font-size: 11px;
    font-weight: 900;
  }
  .graduation-choice .sub {
    color: var(--text-soft);
    font-size: 9px;
    margin-top: 2px;
  }
  .graduation-choice:hover {
    border-color: rgba(250, 186, 55, 0.55);
    background: rgba(250, 186, 55, 0.14);
  }
  .graduation-choice:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .blackboard-panel[data-question-type="graduation"] .board {
    min-height: 220px;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  .blackboard-panel[data-question-type="graduation"] .board .prompt {
    width: 100%;
  }
  .board .graduation-report-card {
    grid-template-columns: minmax(104px, 0.72fr) minmax(0, 1.28fr);
    gap: 10px 14px;
    max-height: none;
    overflow: visible;
  }
  .board .graduation-report-card .graduation-choice-row,
  .board .graduation-report-card .graduation-status {
    grid-column: 1 / -1;
  }
  .board .graduation-report-card .graduation-choice-row {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 6px;
    margin-top: 0;
  }
  .board .graduation-report-card .graduation-choice {
    border-radius: 8px;
    min-height: 42px;
    padding: 7px 8px;
    border-color: rgba(255,255,255,0.24);
    background: rgba(255,255,255,0.10);
    color: var(--ink);
    font-family: -apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif;
    align-items: center;
    text-align: center;
    width: 100%;
    min-width: 0;
  }
  .board .graduation-report-card .graduation-choice .main {
    font-size: clamp(10px, 1.6vw, 12px);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }
  .board .graduation-report-card .graduation-choice .sub {
    color: var(--ink-soft);
    font-size: clamp(8px, 1.3vw, 10px);
  }
  .board .graduation-report-card .graduation-status {
    color: #ffe08c;
    font-family: -apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif;
    font-size: 10px;
    min-height: 12px;
    margin-top: -3px;
    text-align: center;
  }
  .board .graduation-report-card .class-report-metric .v {
    font-size: clamp(13px, 1.8vw, 18px);
  }
  .board .graduation-ceremony.is-on-board {
    margin: 0 auto;
    max-width: 680px;
    padding: 18px;
    text-align: center;
    border-color: rgba(255,255,255,0.24);
    background: rgba(9, 38, 23, 0.28);
    color: var(--ink);
    box-shadow: inset 0 0 24px rgba(0,0,0,0.12);
  }
  .board .graduation-ceremony.is-on-board .graduation-title {
    color: var(--ink);
    font-family: "RubyHighSchoolbell", "Patrick Hand", "Segoe Print", cursive;
    font-size: 30px;
    line-height: 1.08;
  }
  .board .graduation-ceremony.is-on-board .graduation-note {
    color: var(--ink-soft);
    font-family: "RubyHighCraftyGirls", "Patrick Hand", "Segoe Print", cursive;
    font-size: 18px;
    line-height: 1.25;
    margin: 8px auto 0;
    max-width: 560px;
  }
  .board .graduation-ceremony.is-on-board .graduation-status {
    color: #ffe08c;
    font-family: -apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif;
    font-size: 11px;
    margin-top: 8px;
  }
  .board .graduation-ceremony.is-on-board .graduation-choice-row {
    justify-content: center;
    gap: 8px;
    margin-top: 4px;
  }
  .board .graduation-ceremony.is-on-board .graduation-choice {
    border-radius: 8px;
    min-height: 46px;
    padding: 8px 11px;
    border-color: rgba(255,255,255,0.24);
    background: rgba(255,255,255,0.10);
    color: var(--ink);
    font-family: -apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif;
    align-items: center;
    text-align: center;
  }
  .board .graduation-ceremony.is-on-board .graduation-choice .main {
    font-size: 12px;
  }
  .board .graduation-ceremony.is-on-board .graduation-choice .sub {
    color: var(--ink-soft);
    font-size: 10px;
  }
  .blackboard-panel[data-question-type="class-report"] .board {
    min-height: 210px;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  .blackboard-panel[data-question-type="class-report"] .board .prompt {
    width: 100%;
    white-space: normal;
  }
  .board .class-report-card {
    margin: 0 auto;
    width: min(100%, 640px);
    display: grid;
    grid-template-rows: minmax(0, 1fr) auto;
    gap: clamp(8px, 1.8vw, 12px);
    padding: clamp(10px, 2.2vw, 16px);
    border: 2px solid rgba(255,255,255,0.24);
    border-radius: 8px;
    background: rgba(5, 31, 20, 0.30);
    color: var(--ink);
    box-shadow: inset 0 0 22px rgba(0,0,0,0.12);
    max-height: 100%;
    overflow: visible;
  }
  .board .class-report-main {
    min-width: 0;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) minmax(78px, 0.42fr);
    align-items: center;
    gap: clamp(10px, 2.4vw, 18px);
  }
  .board .class-report-heading {
    min-width: 0;
    text-align: left;
    align-self: center;
  }
  .board .class-report-title {
    font-family: "RubyHighSchoolbell", "Patrick Hand", "Segoe Print", cursive;
    font-size: clamp(18px, 3vw, 27px);
    line-height: 1.05;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }
  .board .class-report-subtitle {
    color: var(--ink-soft);
    font-family: "RubyHighCraftyGirls", "Patrick Hand", "Segoe Print", cursive;
    font-size: clamp(12px, 1.9vw, 16px);
    line-height: 1.14;
    margin-top: 4px;
    text-transform: lowercase;
  }
  .board .class-report-teacher-art {
    position: relative;
    justify-self: end;
    align-self: end;
    width: clamp(76px, 15vw, 118px);
    height: clamp(76px, 16vw, 122px);
    overflow: hidden;
    pointer-events: none;
    opacity: 0.95;
  }
  .board .class-report-teacher-art::after {
    content: "";
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, rgba(26,77,45,0.55), rgba(26,77,45,0) 42%),
      linear-gradient(0deg, rgba(26,77,45,0.72), rgba(26,77,45,0) 34%);
    pointer-events: none;
  }
  .board .class-report-teacher-art img {
    width: 100%;
    height: 114%;
    object-fit: contain;
    object-position: center bottom;
    mix-blend-mode: multiply;
    filter: saturate(1.05) contrast(1.06);
  }
  .board .class-report-letter {
    width: clamp(72px, 13vw, 108px);
    height: clamp(72px, 13vw, 108px);
    border-radius: 999px;
    display: grid;
    place-items: center;
    border: clamp(2px, 0.55vw, 4px) solid rgba(255,255,255,0.34);
    background: rgba(255,255,255,0.12);
    color: #fff0a6;
    font: 900 clamp(38px, 7.4vw, 64px)/1 -apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif;
    box-shadow: 0 8px 18px rgba(0,0,0,0.22);
  }
  .board .class-report-card.needs-work .class-report-letter {
    color: #ffd2d2;
    border-color: rgba(255,177,177,0.40);
  }
  .board .class-report-metrics {
    display: grid;
    grid-template-columns: minmax(0, 1.06fr) minmax(0, 0.9fr) minmax(0, 1.14fr);
    gap: 8px;
    min-width: 0;
  }
  .board .class-report-metric {
    min-width: 0;
    overflow: visible;
    border-radius: 8px;
    border: 1px solid rgba(255,255,255,0.18);
    background: rgba(255,255,255,0.08);
    padding: 6px 8px;
    display: grid;
    grid-template-columns: minmax(54px, 0.38fr) minmax(0, 0.62fr);
    column-gap: 9px;
    align-items: baseline;
    font-family: -apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif;
  }
  .board .class-report-metric .k,
  .board .class-report-metric .d {
    color: var(--ink-soft);
    font-size: clamp(9px, 1.35vw, 10px);
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .board .class-report-metric .k {
    grid-column: 1;
  }
  .board .class-report-metric .d {
    grid-column: 1 / -1;
    margin-top: 1px;
  }
  .board .class-report-metric .v {
    color: var(--ink);
    font-size: clamp(14px, 2vw, 18px);
    font-weight: 900;
    line-height: 1.05;
    white-space: nowrap;
    overflow: visible;
    text-align: right;
  }
  .board .class-report-star-meter {
    display: inline-flex;
    justify-content: flex-end;
    align-items: center;
    gap: clamp(2px, 0.65vw, 5px);
    width: max-content;
    min-width: max-content;
    max-width: none;
    white-space: nowrap;
  }
  .board .class-report-star-meter.is-count {
    display: inline-block;
    font-variant-numeric: tabular-nums;
  }
  .board .class-report-star {
    flex: 0 0 auto;
    color: rgba(255,255,255,0.42);
    font-size: clamp(13px, 2vw, 20px);
    line-height: 1;
    text-shadow: 0 1px 0 rgba(0,0,0,0.16);
  }
  .board .class-report-star.is-filled {
    color: #fff6d1;
  }
  @media (max-width: 620px) {
    .blackboard-panel[data-question-type="class-report"] .board {
      min-height: 170px;
      padding: 10px;
    }
    .board .class-report-card {
      gap: 8px;
      padding: 9px;
    }
    .board .class-report-main {
      grid-template-columns: auto minmax(0, 1fr) minmax(58px, 0.32fr);
      gap: 8px;
    }
    .board .class-report-letter {
      width: clamp(64px, 19vw, 82px);
      height: clamp(64px, 19vw, 82px);
      font-size: clamp(34px, 10vw, 46px);
    }
    .board .class-report-teacher-art {
      width: clamp(58px, 15vw, 76px);
      height: clamp(62px, 17vw, 82px);
    }
    .board .class-report-metric {
      padding: 5px 7px;
      column-gap: 7px;
      grid-template-columns: minmax(44px, 0.36fr) minmax(0, 0.64fr);
    }
    .board .class-report-metric .d {
      display: none;
    }
    .board .graduation-report-card .class-report-metric {
      grid-template-columns: minmax(42px, 0.30fr) minmax(0, 0.70fr);
    }
    .board .graduation-report-card .graduation-choice-row {
      grid-template-columns: 1fr;
      gap: 5px;
    }
    .board .graduation-report-card .graduation-choice {
      min-height: 34px;
      flex-direction: row;
      justify-content: space-between;
      gap: 8px;
    }
    .board .graduation-report-card .graduation-choice .sub {
      margin-top: 0;
      text-align: right;
    }
  }
  @media (max-width: 440px) {
    .board .class-report-card {
      gap: 6px;
    }
    .board .class-report-main {
      grid-template-columns: auto minmax(0, 1fr);
      gap: 10px;
    }
    .board .class-report-teacher-art {
      display: none;
    }
    .board .class-report-heading {
      text-align: left;
    }
    .board .class-report-metrics {
      grid-template-columns: 1fr;
      gap: 5px;
    }
  }

    /* ── card deck (Character + School Career + Paper Cards) ────────────── */
  /* Three card types live in the read-only sheet:
       Character Card     — stable identity. Upgrades to the diploma card
                            at graduation.
       School Career Card — live dashboard. Counters tick here, separate
                            from identity.
       Paper Card         — frozen snapshot of a closed year. Sealed
                            paper-stock look, slight desaturation,
                            "✓ sealed Mon YYYY" subtitle. One per grade
                            earned (excluding the year represented by the
                            graduated Character Card).
     The deck is a horizontal scroll-snap carousel — Character Card at the
     front, School Career Card second, Paper Cards trailing in chronological order.
     Mobile-first; swipe to flip, dot-row + chevrons for desktop. */
  .card-deck {
    position: relative;
    width: 100%;
    padding: 8px 0 4px;
    --deck-card-w: min(292px, 100%);
    --deck-gap: 18px;
    --deck-edge-pad: max(0px, calc((100% - var(--deck-card-w)) / 2));
  }
  .card-deck-track {
    display: flex;
    gap: var(--deck-gap);
    overflow-x: auto;
    overflow-y: visible;
    scroll-snap-type: x mandatory;
    scroll-behavior: smooth;
    padding: 24px var(--deck-edge-pad) 28px;
    margin: 0;
    scroll-padding-inline: var(--deck-edge-pad);
    scrollbar-width: none;
  }
  .card-deck-track::-webkit-scrollbar { display: none; }
  .card-deck-track > .ccg-card {
    flex: 0 0 var(--deck-card-w);
    width: var(--deck-card-w);
    max-width: var(--deck-card-w);
    scroll-snap-align: center;
    scroll-snap-stop: always;
  }
  @media (min-width: 780px) {
    .sheet-card.is-card-deck-sheet {
      --deck-card-w: 328px;
      --deck-gap: 22px;
      padding-inline: 18px;
    }
    .sheet-card.is-card-deck-sheet.is-two-card-deck {
      width: auto;
      max-width: min(calc(100vw - 40px), calc(var(--deck-card-w) + var(--deck-card-w) + var(--deck-gap) + 36px));
    }
    .sheet-card.is-card-deck-sheet .card-deck-track {
      padding: 22px var(--deck-edge-pad) 26px;
      scroll-padding-inline: var(--deck-edge-pad);
    }
    .sheet-card.is-card-deck-sheet.is-two-card-deck .card-deck {
      width: auto;
      padding-bottom: 0;
      --deck-edge-pad: 0px;
    }
    .sheet-card.is-card-deck-sheet.is-two-card-deck .card-deck-track {
      overflow: visible;
      scroll-snap-type: none;
      scroll-behavior: auto;
      justify-content: center;
      padding: 18px 0 14px;
    }
    .sheet-card.is-card-deck-sheet.is-two-card-deck .card-deck-track > .ccg-card {
      scroll-snap-align: none;
    }
    .sheet-card.is-card-deck-sheet.is-two-card-deck .card-deck-dots,
    .sheet-card.is-card-deck-sheet.is-two-card-deck .card-deck-nav {
      display: none;
    }
    .sheet-card.is-card-deck-sheet .card-deck-nav.prev { left: 10px; }
    .sheet-card.is-card-deck-sheet .card-deck-nav.next { right: 10px; }
  }
  .card-deck-dots {
    display: flex;
    justify-content: center;
    gap: 8px;
    padding-top: 8px;
  }
  .card-deck-dot {
    width: 8px;
    height: 8px;
    padding: 0;
    border: 0;
    border-radius: 999px;
    background: rgba(255,255,255,0.18);
    cursor: pointer;
    transition: background 0.16s ease, transform 0.16s ease;
  }
  .card-deck-dot:hover { background: rgba(255,255,255,0.32); }
  .card-deck-dot.is-active {
    background: var(--accent);
    transform: scale(1.25);
  }
  .card-deck-nav {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    width: 32px;
    height: 32px;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: rgba(0,0,0,0.55);
    color: var(--text);
    font-size: 22px;
    line-height: 1;
    cursor: pointer;
    display: grid;
    place-items: center;
    backdrop-filter: blur(6px);
    transition: background 0.16s ease, border-color 0.16s ease;
    z-index: 3;
  }
  .card-deck-nav:hover { border-color: var(--accent); background: rgba(0,0,0,0.75); }
  .card-deck-nav[hidden] { display: none; }
  .card-deck-nav.prev { left: 4px; }
  .card-deck-nav.next { right: 4px; }
  @media (max-width: 430px) {
    .card-deck {
      --deck-card-w: min(292px, calc(100vw - 46px));
      --deck-gap: 12px;
    }
    .card-deck-track {
      padding: 18px var(--deck-edge-pad) 22px;
    }
    .card-deck-nav {
      width: 30px;
      height: 30px;
      font-size: 20px;
    }
  }
  /* Hide nav buttons when there's only one card in the deck.
     buildCharacterCard owns the single-card case — controls
     are added only when deck.length > 1, so no rule needed. */

  /* Character Card — stable identity for the current school career. */
  .card-deck-track > .ccg-card.is-character-card {
    box-shadow:
      0 0 0 1px rgba(255,255,255,0.08) inset,
      0 18px 40px rgba(0,0,0,0.55),
      0 0 28px rgba(210,42,42,0.32);
  }
  .card-deck-track > .ccg-card.is-character-card.is-graduated {
    border-color: gold;
    box-shadow:
      0 0 0 1px rgba(255,255,255,0.10) inset,
      0 18px 40px rgba(0,0,0,0.55),
      0 0 32px rgba(255,215,0,0.28);
  }

  /* School Career Card — dynamic state. No portrait/art block; just the
     moving counters and progression gates. */
  .card-deck-track > .ccg-card.is-career-card {
    border-color: #f0b441;
    background:
      linear-gradient(180deg, rgba(240,180,65,0.10) 0%, rgba(240,180,65,0.02) 42%),
      linear-gradient(180deg, var(--bg-elev) 0%, var(--bg) 100%);
    box-shadow:
      0 0 0 1px rgba(255,255,255,0.08) inset,
      0 18px 40px rgba(0,0,0,0.50),
      0 0 24px rgba(240,180,65,0.20);
  }
  .card-deck-track > .ccg-card.is-career-card .ccg-body {
    padding-top: 34px;
  }
  .career-metrics {
    display: flex;
    flex-direction: column;
    gap: 0;
    border-top: 1px solid var(--line);
    border-bottom: 1px solid var(--line);
  }
  .career-metric {
    display: grid;
    grid-template-columns: 78px minmax(0, 1fr);
    column-gap: 10px;
    row-gap: 2px;
    padding: 7px 0;
    border-bottom: 1px solid rgba(255,255,255,0.08);
    font-size: 12px;
  }
  .career-metric:last-child { border-bottom: 0; }
  .career-metric .k {
    grid-row: span 2;
    color: var(--text-mute);
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    align-self: center;
  }
  .career-metric .v {
    color: var(--text);
    font-size: 15px;
    font-weight: 900;
    line-height: 1.1;
    font-variant-numeric: tabular-nums;
    min-width: 0;
  }
  .career-metric .detail {
    color: var(--text-mute);
    font-size: 11px;
    line-height: 1.25;
    min-width: 0;
  }
  .career-metric.is-met .v { color: #b6f5b9; }

  .career-token-strip {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 9px 10px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: rgba(0,0,0,0.18);
  }
  .career-token-lane {
    display: grid;
    grid-template-columns: 74px minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .career-token-label {
    color: var(--text-mute);
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  .career-token-count {
    color: var(--text-soft);
    font-size: 11px;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .career-streak-track {
    display: inline-flex;
    align-items: center;
    gap: 9px;
    min-width: 0;
  }
  .career-sockets,
  .career-diamonds,
  .career-dice,
  .career-multipliers {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
  }
  .career-multipliers {
    gap: 5px;
  }
  .career-multiplier {
    min-width: 30px;
    height: 20px;
    padding: 0 6px;
    border-radius: 999px;
    border: 1px solid rgba(255,255,255,0.14);
    background: rgba(255,255,255,0.055);
    color: rgba(190,198,222,0.54);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 900;
    letter-spacing: 0.02em;
    opacity: 0.56;
  }
  .career-multiplier.is-live {
    border-color: rgba(255,230,138,0.78);
    background: linear-gradient(180deg, rgba(255,230,138,0.20), rgba(240,180,65,0.10));
    color: #ffe68a;
    box-shadow: 0 0 10px rgba(240,180,65,0.26);
    opacity: 1;
  }
  /* Bonus-only streak lane: the bonus pill replaces the diamonds AND the
   * count, so size it up to carry the lane on its own. */
  .career-streak-track.is-bonus-only {
    flex: 1;
    justify-content: flex-start;
  }
  .career-streak-track.is-bonus-only .career-multiplier.is-live {
    height: 26px;
    padding: 0 12px;
    font-size: 12px;
    letter-spacing: 0.04em;
    box-shadow: 0 0 14px rgba(240,180,65,0.42);
  }
  .career-diamond {
    width: 18px;
    height: 18px;
    transform: rotate(45deg);
    border-radius: 4px;
    border: 2px solid rgba(240,180,65,0.42);
    background: rgba(255,255,255,0.045);
    box-shadow: inset 0 2px 5px rgba(0,0,0,0.45);
    opacity: 0.64;
  }
  .career-diamond.is-filled {
    border-color: rgba(255,230,138,0.92);
    background: linear-gradient(135deg, #ffe68a 0%, #f0b441 56%, #9b5715 100%);
    box-shadow:
      0 0 12px rgba(240,180,65,0.45),
      inset 0 -2px 4px rgba(78,38,0,0.38);
    opacity: 1;
  }
  .career-socket {
    width: 20px;
    height: 20px;
    border-radius: 999px;
    border: 2px solid rgba(255,255,255,0.14);
    background:
      radial-gradient(circle at 50% 52%, rgba(0,0,0,0.42) 0 42%, transparent 44%),
      rgba(255,255,255,0.045);
    box-shadow: inset 0 2px 5px rgba(0,0,0,0.55);
    opacity: 0.42;
  }
  .career-socket.is-required {
    border-color: rgba(240,180,65,0.55);
    opacity: 1;
  }
  .career-socket.is-filled {
    border-color: rgba(255,230,138,0.92);
    background:
      radial-gradient(circle at 34% 28%, rgba(255,255,255,0.90) 0 8%, transparent 9%),
      radial-gradient(circle at 50% 48%, #ffe68a 0 24%, #f0b441 25% 49%, #9b5715 50% 70%, transparent 72%),
      rgba(255,213,96,0.18);
    box-shadow:
      0 0 12px rgba(240,180,65,0.55),
      inset 0 -2px 4px rgba(78,38,0,0.45);
  }
  .career-die {
    width: 22px;
    height: 22px;
    border-radius: 6px;
    border: 1px solid rgba(255,255,255,0.14);
    background: rgba(255,255,255,0.055);
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    grid-template-rows: repeat(3, 1fr);
    padding: 4px;
    opacity: 0.42;
  }
  .career-die.is-live {
    border-color: rgba(182,245,185,0.55);
    background: linear-gradient(180deg, rgba(182,245,185,0.18), rgba(76,181,85,0.10));
    box-shadow: 0 0 10px rgba(76,181,85,0.22);
    opacity: 1;
  }
  .career-die span {
    width: 4px;
    height: 4px;
    border-radius: 999px;
    background: rgba(255,255,255,0.42);
    align-self: center;
    justify-self: center;
  }
  .career-die.is-live span { background: #d8ffda; }
  .career-die span:nth-child(1) { grid-column: 1; grid-row: 1; }
  .career-die span:nth-child(2) { grid-column: 3; grid-row: 1; }
  .career-die span:nth-child(3) { grid-column: 2; grid-row: 2; }
  .career-die span:nth-child(4) { grid-column: 1; grid-row: 3; }
  .career-die span:nth-child(5) { grid-column: 3; grid-row: 3; }

  /* Sealed years live behind the current character card as a compact
     accordion. They replace the old third/fourth carousel cards. */
  .paper-archive {
    margin-top: 9px;
    border-top: 1px solid rgba(255,255,255,0.08);
    padding-top: 8px;
  }
  .paper-archive-summary {
    list-style: none;
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 30px;
    cursor: pointer;
    color: var(--text-soft);
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.02em;
  }
  .paper-archive-summary::-webkit-details-marker { display: none; }
  .paper-archive-stack {
    position: relative;
    width: 30px;
    height: 19px;
    flex: 0 0 auto;
  }
  .paper-archive-sheet {
    position: absolute;
    width: 22px;
    height: 15px;
    border-radius: 3px;
    border: 1px solid rgba(255,235,200,0.35);
    background: linear-gradient(180deg, rgba(255,235,200,0.16), rgba(255,235,200,0.04));
    box-shadow: 0 4px 8px rgba(0,0,0,0.25);
  }
  .paper-archive-sheet:nth-child(1) { left: 0; top: 4px; opacity: 0.55; }
  .paper-archive-sheet:nth-child(2) { left: 4px; top: 2px; opacity: 0.72; }
  .paper-archive-sheet:nth-child(3) { left: 8px; top: 0; opacity: 0.9; }
  .paper-archive-label { color: var(--text); }
  .paper-archive-hint {
    margin-left: auto;
    color: var(--text-mute);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
  }
  .paper-archive[open] .paper-archive-hint { color: #f0b441; }
  .paper-archive-list {
    display: grid;
    gap: 6px;
    padding-top: 6px;
  }
  .paper-archive-entry {
    --paper-accent: #a56bff;
    border-left: 3px solid var(--paper-accent);
    border-radius: 6px;
    background:
      linear-gradient(135deg, rgba(255,255,255,0.035), rgba(0,0,0,0) 42%),
      rgba(255,255,255,0.045);
    padding: 7px 8px;
  }
  .paper-archive-entry-top {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .paper-archive-grade {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: #f0b441;
    font-size: 11px;
    font-weight: 900;
    min-width: 68px;
  }
  .paper-archive-diamonds {
    display: inline-flex;
    gap: 1px;
    font-size: 10px;
  }
  .paper-archive-meta {
    color: var(--text-mute);
    font-size: 10px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .paper-archive-stats {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    margin-top: 5px;
    color: var(--text-soft);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .paper-archive-stats b {
    color: var(--text-mute);
    font-weight: 700;
  }
  .paper-archive-quote {
    margin-top: 6px;
    color: var(--text-soft);
    font-size: 11px;
    line-height: 1.35;
    font-style: italic;
  }

  /* Paper Card — frozen, sealed. Paper-stock cream tint, faint grid
     overlay, slight desaturation. The subtitle ("✓ sealed Mon YYYY")
     does the heavy lifting; CSS just signals "this is archive, not
     dashboard." */
  .card-deck-track > .ccg-card.is-paper-card {
    border-color: rgba(255,255,255,0.22);
    background:
      linear-gradient(180deg, rgba(245,235,210,0.04) 0%, rgba(245,235,210,0.02) 100%),
      linear-gradient(180deg, var(--bg-elev) 0%, var(--bg) 100%);
    box-shadow:
      0 0 0 1px rgba(255,255,255,0.05) inset,
      0 12px 24px rgba(0,0,0,0.45);
    filter: saturate(0.88);
  }
  .card-deck-track > .ccg-card.is-paper-card .ccg-art {
    /* Subtle paper-grain overlay on the portrait so the card reads as
       printed-and-stored rather than freshly rendered. Pseudo-element
       on .ccg-art already has a bottom fade — stack over it. */
    position: relative;
  }
  .card-deck-track > .ccg-card.is-paper-card .ccg-art::before {
    content: "";
    position: absolute;
    inset: 0;
    background:
      repeating-linear-gradient(
        45deg,
        rgba(255,255,255,0.015) 0 2px,
        rgba(0,0,0,0.02) 2px 4px
      );
    pointer-events: none;
    z-index: 1;
  }
  .card-deck-track > .ccg-card.is-paper-card .ccg-role {
    /* Replace the role badge with a "SEALED" wax-stamp feel. */
    background: rgba(40,30,20,0.65);
    color: rgba(255,235,200,0.92);
    letter-spacing: 0.22em;
  }
  .card-deck-track > .ccg-card.is-paper-card .ccg-role::after {
    content: " · sealed";
    opacity: 0.7;
  }
  .card-deck-track > .ccg-card.is-paper-card .ccg-name {
    /* Slight serif feel via letter-spacing — yearbook page typography. */
    letter-spacing: 0.005em;
  }
  .card-deck-track > .ccg-card.is-paper-card .ccg-subtitle {
    color: rgba(255,235,200,0.62);
  }

  /* Bonus badge — once-per-day fresh question. */
  .pill.bonus {
    background: gold;
    color: #1a2238;
    font-weight: 900;
  }
  .sheet-readonly { display: flex; flex-direction: column; gap: 12px; }
  .sheet-readonly .row {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    border-bottom: 1px solid var(--line);
    padding: 6px 0;
    align-items: baseline;
  }
  .sheet-readonly .row .k {
    color: var(--text-mute);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
  }
  .sheet-readonly .row .v {
    color: var(--text);
    font-weight: 700;
    text-align: right;
    flex: 1 1 auto;
  }
  .sheet-readonly .arc {
    background: var(--bg-elev);
    border-left: 3px solid var(--accent);
    padding: 8px 10px;
    color: var(--text-soft);
    font-style: italic;
    font-size: 13px;
    line-height: 1.5;
    border-radius: 0 8px 8px 0;
  }

  /* tiny "open profile" button living in the channels footer */
  .you-meta { cursor: pointer; }

  /* ── opinion mode: a small grade-pill that lands on the student's
   *  earlier chat message after the teacher grades. */
  .grade-tag {
    display: inline-block;
    margin-left: 6px;
    padding: 1px 8px;
    border-radius: 999px;
    font-size: 10px;
    font-weight: 800;
    background: rgba(76,181,85,0.22);
    color: #b6f5b9;
    vertical-align: 1px;
  }
  .grade-tag.bad { background: rgba(210,42,42,0.22); color: #ffb1b1; }
  .grade-tag.best { background: var(--accent); color: #fff; }

  /* ── result chips in the chat (running session record) ────────────────── */
  .msg.result {
    grid-template-columns: 1fr;
    min-width: 0;
  }
  .msg.result .body {
    /* Right-aligned compact chip showing badge + Q# + roll + score. With
       enough modifiers (e.g. ✗ A·B  Q12 — missed  🎲 6+5−1 HONOR=10  +55
       score) the row can grow past the viewport on narrow phones. Allow
       wrap to a second row, cap max-width, and right-align via the grid. */
    display: inline-flex;
    flex-wrap: wrap;
    justify-self: end;
    align-self: flex-start;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    background: var(--bg-elev);
    border: 1px solid var(--line);
    border-radius: 999px;
    font-size: 12px;
    color: var(--text-soft);
    max-width: 100%;
    min-width: 0;
  }
  .msg.result .body .badge-mini {
    font-weight: 800;
    padding: 1px 7px;
    border-radius: 999px;
    font-size: 10px;
  }
  .msg.result .body .badge-mini.ok { background: rgba(76,181,85,0.22); color: #b6f5b9; }
  .msg.result .body .badge-mini.bad { background: rgba(210,42,42,0.22); color: #ffb1b1; }

  /* ── empty / welcome state ─────────────────────────────────────────────── */
  .empty-state {
    margin: auto;
    text-align: center;
    padding: 36px 22px;
    max-width: 420px;
    color: var(--text-soft);
    align-self: center;
  }
  .empty-state .logo {
    width: 96px;
    margin-bottom: 16px;
    animation: float 2.6s ease-in-out infinite;
  }
  @keyframes float {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-6px); }
  }
  .empty-state h2 {
    margin: 0 0 6px;
    color: var(--text);
    font-size: 22px;
  }
  .empty-state p { margin: 0 0 18px; line-height: 1.5; }
  .empty-state .cta {
    appearance: none;
    border: none;
    background: var(--accent);
    color: #fff;
    border-radius: 999px;
    padding: 12px 22px;
    font-weight: 800;
    font-size: 15px;
    box-shadow: var(--shadow);
  }

  /* ── composer ──────────────────────────────────────────────────────────── */
  .composer-zone {
    grid-row: 4;
    border-top: 1px solid var(--line);
    background: rgba(21, 23, 31, 0.96);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    padding: 10px calc(var(--safe-right) + 12px) calc(var(--safe-bot) + 10px) calc(var(--safe-left) + 12px);
    z-index: 9;
  }
  .chat-action-btn {
    appearance: none;
    width: 100%;
    min-height: 48px;
    border: 1px solid color-mix(in srgb, var(--accent) 54%, rgba(255,255,255,0.18));
    border-radius: 16px;
    background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 88%, #ffffff 8%), var(--accent));
    color: #fff;
    font-weight: 900;
    font-size: 16px;
    letter-spacing: 0;
    box-shadow: var(--shadow);
  }
  .chat-action-btn:disabled {
    opacity: 0.55;
    cursor: wait;
  }
  .composer-form {
    display: flex;
    gap: 8px;
    background: var(--bg-elev);
    border-radius: 18px;
    padding: 4px 6px 4px 14px;
    align-items: flex-end;
  }
  .composer-form textarea {
    flex: 1 1 auto;
    background: transparent;
    border: none;
    outline: none;
    resize: none;
    color: var(--text);
    font: inherit;
    padding: 10px 0;
    max-height: 140px;
    height: 40px;
    line-height: 1.4;
    font-size: 16px; /* iOS won't zoom focus on >=16 */
  }
  .composer-form textarea::placeholder { color: var(--text-mute); }
  .composer-form textarea:disabled { color: var(--text-mute); }
  .composer-form .send-btn {
    appearance: none;
    border: none;
    background: var(--accent);
    color: #fff;
    font-weight: 800;
    border-radius: 14px;
    padding: 0;
    width: 40px;
    height: 40px;
    align-self: center;
    display: grid;
    place-items: center;
  }
  .composer-form .send-btn:disabled { opacity: 0.4; }
  .composer-form .send-btn svg { width: 18px; height: 18px; }
  .checking {
    text-align: center;
    color: var(--text-mute);
    font-size: 12px;
    padding: 8px 0;
  }

  /* ── congrats toast ────────────────────────────────────────────────────── */
  .congrats-toast {
    position: fixed;
    left: 50%;
    top: calc(var(--safe-top) + var(--top-h) + 10px);
    transform: translate(-50%, -10px);
    background: rgba(20, 28, 50, 0.94);
    color: #fff;
    padding: 10px 18px;
    border-radius: 999px;
    font-weight: 800;
    font-size: 14px;
    box-shadow: 0 12px 28px rgba(0,0,0,0.45);
    z-index: 60;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.18s ease, transform 0.22s ease;
    max-width: calc(100% - 24px);
    text-align: center;
    border: 1px solid rgba(255,255,255,0.08);
    white-space: nowrap;
  }
  .congrats-toast.is-correct { background: rgba(31, 124, 42, 0.95); }
  .congrats-toast.is-wrong { background: rgba(160, 24, 24, 0.95); }
  .congrats-toast.is-visible { opacity: 1; transform: translate(-50%, 0); }

  /* ── phone fit pass ─────────────────────────────────────────────────────
     Keep the active question playable on narrow screens: the board and
     answers each get their own scroll area, metadata/race chrome scrolls
     sideways instead of stacking, and long prompts opt into smaller chalk
     type via script-set classes. */
  @media (max-width: 600px) {
    main.workspace {
      grid-template-rows: auto minmax(0, auto) minmax(92px, 1fr) auto;
    }
    .blackboard-panel {
      max-height: calc(100dvh - var(--safe-top) - var(--safe-bot) - var(--top-h) - 174px);
    }
    .blackboard-panel[data-mode="round-revealed"] {
      max-height: calc(100dvh - var(--safe-top) - var(--safe-bot) - var(--top-h) - 118px);
    }
    .blackboard-meta {
      flex-wrap: nowrap;
      overflow-x: auto;
      padding: 6px calc(var(--safe-right) + 8px) 6px calc(var(--safe-left) + 8px);
      scrollbar-width: none;
    }
    .blackboard-meta::-webkit-scrollbar { display: none; }
    .pill {
      flex: 0 0 auto;
      font-size: 9px;
      padding: 3px 7px;
    }
    .board-frame-host {
      padding-inline: calc(var(--safe-left) + 8px) calc(var(--safe-right) + 8px);
    }
    .board-frame { padding: 6px; }
    .board {
      min-height: 86px;
      max-height: 30dvh;
      padding: 12px 62px 12px 12px;
      font-size: 20px;
      line-height: 1.32;
    }
    .blackboard-panel[data-faculty="ruby"] .board,
    .blackboard-panel[data-faculty="professor-edward"] .board {
      font-size: 21px;
      line-height: 1.28;
    }
    .blackboard-panel[data-faculty="sally-science"] .board {
      font-size: 19px;
      line-height: 1.35;
    }
    .blackboard-panel.is-long-prompt .board {
      max-height: 34dvh;
      font-size: 18px;
      line-height: 1.32;
    }
    .blackboard-panel.is-essay-prompt .board {
      max-height: 38dvh;
      font-size: 17px;
      line-height: 1.32;
    }
    .blackboard-panel.is-long-prompt[data-faculty="ruby"] .board,
    .blackboard-panel.is-long-prompt[data-faculty="professor-edward"] .board,
    .blackboard-panel.is-essay-prompt[data-faculty="ruby"] .board,
    .blackboard-panel.is-essay-prompt[data-faculty="professor-edward"] .board {
      font-size: 18px;
    }
    .teacher-figure {
      width: 48px;
      height: 48px;
      right: calc(var(--safe-right) + 10px);
      top: 8px;
      border-width: 2px;
    }
    .blackboard-panel.is-essay-prompt .teacher-figure {
      width: 40px;
      height: 40px;
    }
    .answers-host {
      padding: 8px calc(var(--safe-right) + 8px) 8px calc(var(--safe-left) + 8px);
      max-height: 34dvh;
    }
    .answers { gap: 7px; }
    .answer {
      min-height: 46px;
      padding: 10px 10px 10px 44px;
      border-radius: 10px;
      font-size: 14px;
      line-height: 1.25;
    }
    .answer .badge {
      left: 9px;
      width: 28px;
      height: 28px;
      font-size: 14px;
    }
    .advantage-bar {
      align-items: flex-start;
      flex-wrap: wrap;
      gap: 7px;
      margin-top: 8px;
      padding: 7px 8px;
    }
    .advantage-btn {
      min-height: 34px;
      padding: 8px 10px;
      font-size: 11px;
    }
    .race-strip {
      flex-wrap: nowrap;
      overflow-x: auto;
      padding: 3px calc(var(--safe-right) + 8px) 7px calc(var(--safe-left) + 8px);
      scrollbar-width: none;
    }
    .race-strip::-webkit-scrollbar { display: none; }
    .race-row { flex-wrap: nowrap; }
    .race-card { flex: 0 0 auto; }
    .stream {
      padding: 10px calc(var(--safe-right) + 10px) 12px calc(var(--safe-left) + 10px);
      scroll-padding-bottom: calc(var(--composer-min) + var(--safe-bot) + 18px);
    }
    .msg {
      grid-template-columns: 32px minmax(0, 1fr);
      column-gap: 9px;
    }
    .msg .avatar {
      width: 32px;
      height: 32px;
    }
    .msg .body {
      font-size: 14px;
      line-height: 1.45;
    }
    .composer-zone {
      padding: 8px calc(var(--safe-right) + 8px) calc(var(--safe-bot) + 8px) calc(var(--safe-left) + 8px);
    }
    .chat-action-btn {
      min-height: 46px;
      border-radius: 14px;
    }
    .composer-form {
      border-radius: 16px;
      padding: 4px 5px 4px 12px;
    }
  }

  @media (max-width: 380px) {
    .answers { grid-template-columns: 1fr; }
    .blackboard-panel {
      max-height: calc(100dvh - var(--safe-top) - var(--safe-bot) - var(--top-h) - 150px);
    }
    .board {
      max-height: 28dvh;
      padding-right: 54px;
    }
    .teacher-figure {
      width: 42px;
      height: 42px;
    }
    .answer {
      min-height: 44px;
      padding-left: 42px;
      font-size: 13px;
    }
  }

  /* ── tablet ≥720 ───────────────────────────────────────────────────────── */
  @media (min-width: 720px) {
    aside.channels-rail { width: var(--channels-w); }
    .answers { grid-template-columns: 1fr 1fr; gap: 10px; }
    .stream { padding: 14px 18px; }
  }

  /* ── desktop ≥1100 ─────────────────────────────────────────────────────── */
  @media (min-width: 1100px) {
    aside.channels-rail {
      transform: translateX(0);
      position: relative;
      z-index: auto;
      visibility: visible;
      pointer-events: auto;
      left: auto;
      transition: none;
    }
    .shell { grid-template-columns: var(--channels-w) 1fr; }
    main.workspace { grid-column: 2; }
    .scrim { display: none !important; }
    .hamburger { display: none; }
    .stream { padding: 18px 24px; }
  }

  /* ── Social card (relationship layer) ────────────────────────────────── */
  .mash-grid-wrap {
    margin-top: 14px;
    padding: 10px 12px;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.08);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .mash-grid-heading {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    opacity: 0.7;
  }
  .mash-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
  }
  .mash-tile {
    --mash-accent: #999;
    display: grid;
    grid-template-columns: 8px 1fr auto;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    font-size: 12px;
    line-height: 1.1;
  }
  .mash-tile-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--mash-accent);
    opacity: 0.55;
  }
  .mash-tile-name { font-weight: 500; }
  .mash-tile-meter {
    font-variant-numeric: tabular-nums;
    font-size: 11px;
    opacity: 0.7;
  }
  .mash-tile.is-warm { background: color-mix(in oklab, var(--mash-accent) 14%, rgba(255,255,255,0.04)); }
  .mash-tile.is-cool { opacity: 0.7; }
  .mash-tile.is-circled {
    background: color-mix(in oklab, var(--mash-accent) 28%, rgba(255,255,255,0.04));
    border-color: var(--mash-accent);
  }
  .mash-tile.is-circled .mash-tile-dot { opacity: 1; }
  .mash-tile.is-circled .mash-tile-meter { opacity: 1; font-weight: 600; }
  .mash-tile.is-scratched {
    text-decoration: line-through;
    opacity: 0.35;
  }
  .mash-recent {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-size: 11px;
    color: var(--text-soft);
  }
  .mash-resolved {
    list-style: none;
    margin: 4px 0 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-size: 12px;
  }
  .mash-resolved li {
    display: flex;
    gap: 8px;
    align-items: baseline;
  }
  .mash-resolved-axis {
    text-transform: uppercase;
    font-size: 10px;
    letter-spacing: 0.08em;
    opacity: 0.55;
    min-width: 44px;
  }
  .mash-resolved-body { opacity: 0.92; }
`;
