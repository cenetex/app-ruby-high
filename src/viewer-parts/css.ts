// Static CSS for the Ruby High SPA viewer. Extracted from viewer.ts
// to keep the assembler small. No interpolation here — pure tokens
// + selectors + media queries.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const VIEWER_CSS = `
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
  body { touch-action: manipulation; }
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
  }

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
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: center;
  }
  aside.channels-rail {
    left: var(--rail-w);
    width: calc(min(var(--channels-w), 80vw - var(--rail-w)));
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
    padding: calc(var(--safe-top) + 14px) 16px 12px;
    border-bottom: 1px solid var(--line);
  }
  .channels-header .grade-label {
    font-size: 11px;
    color: var(--text-mute);
    letter-spacing: 0.18em;
    text-transform: uppercase;
  }
  .channels-header .grade-name {
    font-size: 18px;
    font-weight: 800;
    margin-top: 2px;
  }
  .channels-list {
    flex: 1 1 auto;
    overflow-y: auto;
    padding: 8px 8px 12px;
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
  .student-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 12px;
    color: var(--text-soft);
    font-size: 14px;
    min-height: 36px;
  }
  .student-row .dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: #4cb555;
    flex: 0 0 auto;
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
    padding: var(--safe-top) 12px 0 calc(var(--safe-left) + 8px);
    height: calc(var(--safe-top) + var(--top-h));
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
    margin-right: calc(var(--safe-right));
    background: var(--bg-elev);
    border-radius: 999px;
    font-size: 12px;
    font-weight: 700;
    color: var(--text);
    flex: 0 0 auto;
    white-space: nowrap;
  }
  .arc-indicator .arc-year { color: var(--accent); }
  .arc-indicator .arc-sep { color: var(--text-mute); font-weight: 400; }
  .arc-indicator .arc-streak.is-met { color: var(--accent); }
  .arc-indicator .arc-xp.is-met { color: var(--accent); }
  .arc-indicator.is-graduated .arc-year { color: #f0b441; }
  /* Mobile: hide the streak/XP detail, keep just the year tag. The full
   * progress is one tap away on the character sheet. */
  @media (max-width: 540px) {
    .arc-indicator .arc-sep,
    .arc-indicator .arc-streak,
    .arc-indicator .arc-xp { display: none; }
  }
  /* Pack-store button — sits next to the arc chip in the top bar. Opens
   * the pack-overlay where the user can switch curricula or import an
   * Anki deck. Always visible (no character needed) so the user can
   * preview / import packs before rolling. */
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
  .blackboard-panel[data-mode="round-revealed"] .advantage-bar,
  .blackboard-panel[data-mode="round-revealed"] .race-strip {
    display: none !important;
  }
  .blackboard-panel[data-mode="between-rounds"] .answers-host,
  .blackboard-panel[data-mode="between-rounds"] .advantage-bar,
  .blackboard-panel[data-mode="between-rounds"] .race-strip,
  .blackboard-panel[data-mode="between-rounds"] .blackboard-foot {
    display: none !important;
  }
  .blackboard-panel[data-mode="in-lounge"] .answers-host,
  .blackboard-panel[data-mode="in-lounge"] .advantage-bar,
  .blackboard-panel[data-mode="in-lounge"] .race-strip,
  .blackboard-panel[data-mode="in-lounge"] .blackboard-foot,
  .blackboard-panel[data-mode="in-lounge"] .blackboard-meta,
  .blackboard-panel[data-mode="in-lounge"] .board-frame-host {
    display: none !important;
  }
  .blackboard-panel[data-mode="needs-auth"] .answers-host,
  .blackboard-panel[data-mode="needs-auth"] .advantage-bar,
  .blackboard-panel[data-mode="needs-auth"] .race-strip,
  .blackboard-panel[data-mode="needs-auth"] .blackboard-foot,
  .blackboard-panel[data-mode="needs-character"] .answers-host,
  .blackboard-panel[data-mode="needs-character"] .advantage-bar,
  .blackboard-panel[data-mode="needs-character"] .race-strip,
  .blackboard-panel[data-mode="needs-character"] .blackboard-foot,
  .blackboard-panel[data-mode="checking-auth"] .answers-host,
  .blackboard-panel[data-mode="checking-auth"] .advantage-bar,
  .blackboard-panel[data-mode="checking-auth"] .race-strip,
  .blackboard-panel[data-mode="checking-auth"] .blackboard-foot {
    display: none !important;
  }
  /* Opinion rounds: hide the A/B/C/D grid (player + NPCs answer in chat). */
  .blackboard-panel[data-opinion="true"] .answers-host {
    display: none !important;
  }
  .blackboard-meta {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    padding: 10px calc(var(--safe-right) + 12px) 8px calc(var(--safe-left) + 12px);
  }
  .blackboard-empty {
    padding: 24px 16px;
    text-align: center;
    color: var(--text-soft);
    font-size: 14px;
  }
  .board-frame-host {
    padding: 0 calc(var(--safe-right) + 10px) 0 calc(var(--safe-left) + 10px);
    position: relative;
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
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 calc(var(--safe-right) + 12px) 10px calc(var(--safe-left) + 12px);
  }
  .blackboard-foot .next-btn {
    appearance: none;
    background: var(--accent);
    border: none;
    color: #fff;
    font-weight: 800;
    border-radius: 999px;
    padding: 11px 18px;
    font-size: 14px;
    box-shadow: var(--shadow);
    margin-left: auto;
  }
  .blackboard-foot .next-btn:disabled { opacity: 0.5; }
  /* Today's-challenge banner — sits above the chalkboard so it is not
     fighting the green texture for legibility. */
  .daily-banner {
    margin: 8px calc(var(--safe-right) + 12px) 0 calc(var(--safe-left) + 12px);
    background: linear-gradient(135deg, rgba(210, 42, 42, 0.18), rgba(210, 42, 42, 0.05));
    border: 1px solid rgba(210, 42, 42, 0.35);
    border-radius: 14px;
    padding: 10px 14px;
    box-shadow: var(--shadow);
  }
  .daily-banner-inner {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .daily-banner-text {
    flex: 1 1 auto;
    min-width: 0;
  }
  .daily-banner-title {
    font-size: 11px;
    color: var(--accent);
    letter-spacing: 0.16em;
    text-transform: uppercase;
    font-weight: 800;
  }
  .daily-banner-sub {
    font-size: 14px;
    color: var(--text);
    font-weight: 600;
    margin-top: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .daily-cta-btn {
    appearance: none;
    background: var(--accent);
    border: none;
    color: #fff;
    font-weight: 800;
    border-radius: 999px;
    padding: 10px 18px;
    font-size: 14px;
    box-shadow: var(--shadow);
    cursor: pointer;
    flex: 0 0 auto;
    transition: transform 0.08s ease, opacity 0.12s ease;
  }
  .daily-cta-btn:active { transform: scale(0.97); }
  .daily-cta-btn:disabled { opacity: 0.5; cursor: default; }

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
    overflow-wrap: anywhere;
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

  .board-frame {
    background: linear-gradient(180deg, var(--board-frame-light), var(--board-frame));
    padding: 10px;
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
    font-family: "Caveat", "Patrick Hand", "Segoe Print", cursive;
    font-size: 22px;
    line-height: 1.3;
    box-shadow: inset 0 0 60px rgba(0,0,0,0.35);
  }
  .board .prompt {
    white-space: pre-wrap;
    word-wrap: break-word;
    overflow-wrap: anywhere;
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
  /* The roll chip already has 6px left margin; inside .reveal it inherits
     the hit/mixed/miss color so the dice land beside the verdict legibly. */
  .board .reveal .roll-chip { vertical-align: middle; }
  .answers {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  /* Long-answer mode: when any choice exceeds ~50 chars, the script
     toggles .is-long on the grid. On narrow viewports we drop to a
     single column so each answer gets full width and stays readable
     instead of wrapping into a tall, half-width brick that's hard
     to scan. The scrollable answers-host keeps the whole stack
     reachable even when several answers are long. */
  @media (max-width: 600px) {
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

  /* ── XP burst toast (lands on a successful roll, animated) ────────────── */
  .xp-burst {
    position: fixed;
    left: 50%;
    top: calc(var(--safe-top) + 130px);
    transform: translate(-50%, -10px) scale(0.9);
    background: linear-gradient(180deg, #f0d24a, #c8941f);
    color: #1a1108;
    padding: 6px 14px;
    border-radius: 999px;
    font-weight: 900;
    font-size: 12px;
    box-shadow: 0 8px 22px rgba(240, 210, 74, 0.45);
    z-index: 30;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.18s ease, transform 0.32s cubic-bezier(0.34, 1.56, 0.64, 1);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    white-space: nowrap;
    border: 2px solid rgba(255,255,255,0.4);
  }
  .xp-burst.is-visible { opacity: 1; transform: translate(-50%, 0) scale(1); }

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
    letter-spacing: -0.01em;
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
    grid-template-columns: 18px 1fr auto;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    line-height: 1.3;
    padding: 4px 2px;
    border-radius: 6px;
  }
  .ccg-progression .rung.is-completed { color: var(--text-mute); }
  .ccg-progression .rung.is-current {
    color: var(--text);
    background: rgba(255,255,255,0.04);
  }
  .ccg-progression .rung.is-future { color: var(--text-mute); opacity: 0.7; }
  .ccg-progression .rung-dot {
    text-align: center;
    font-size: 12px;
    color: var(--accent);
  }
  .ccg-progression .rung.is-future .rung-dot { color: var(--text-mute); }
  .ccg-progression .rung-label { font-weight: 700; }
  .ccg-progression .rung.is-current .rung-label { color: var(--accent); }
  .ccg-progression .rung-gates {
    display: inline-flex;
    gap: 6px;
    font-size: 11px;
    color: var(--text-soft);
  }
  .ccg-progression .gate-chip {
    padding: 2px 6px;
    border-radius: 999px;
    background: rgba(255,255,255,0.06);
    border: 1px solid var(--line);
    font-variant-numeric: tabular-nums;
  }
  .ccg-progression .gate-chip.is-met {
    background: rgba(76, 181, 85, 0.18);
    border-color: rgba(76, 181, 85, 0.45);
    color: #b6f5b9;
  }
  .ccg-progression .gate-chip.class-chip {
    font-size: 10px;
    opacity: 0.92;
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
     per-card "Close" button. Hidden on the mandatory signin overlay
     (no escape from sign-in). */
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
  /* Mandatory overlay: shown unconditionally while unauthed. No close
     affordance — it covers the app and the only way past it is to sign
     in. Always rendered (display:flex) so the unauthed boot has nothing
     paint behind it; aria-hidden flips off when the user signs in. */
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

  /* ── yearbook stack ──────────────────────────────────────────────────── */
  /* Read-only character sheet renders one card per grade, current year
     on TOP. The pack grows as the player advances. Cards overlap
     slightly so the stack reads as a deck, not a list — the player
     "collects" a card when they pass each year. The top card is full
     fidelity (stats, quote, progression, hint, move); below cards
     compress to a portrait + summary line. */
  .yearbook-stack {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0;
    padding-top: 12px;
  }
  .yearbook-stack .ccg-card {
    /* Negative top-margin makes each card peek behind the one above it,
       creating the stacked-deck visual. The first card sits at 0. */
    margin-top: -28px;
    transform: rotate(0deg);
    transition: transform 0.18s ease, margin 0.18s ease;
  }
  .yearbook-stack .ccg-card:first-child {
    margin-top: 0;
  }
  /* Slight alternating tilt on completed cards so the stack feels
     hand-arranged instead of mechanically aligned. */
  .yearbook-stack .yearbook-completed:nth-child(even) { transform: rotate(-1.2deg); }
  .yearbook-stack .yearbook-completed:nth-child(odd)  { transform: rotate(1.4deg); }
  .yearbook-stack .yearbook-completed:hover,
  .yearbook-stack .yearbook-graduated:hover {
    transform: rotate(0deg) translateY(-4px);
  }
  /* Completed-year cards are dimmed + scaled down a touch — they're
     archive, not the active surface. */
  .yearbook-stack .yearbook-completed {
    opacity: 0.78;
    filter: saturate(0.9);
  }
  .yearbook-stack .yearbook-completed .ccg-art {
    aspect-ratio: 5/2; /* shorter art on completed cards */
  }
  .yearbook-stack .yearbook-graduated {
    /* Senior-graduated cap card sits on top with its diploma image. */
    border-color: gold;
  }

  /* ── rarity pill (replaces DAILY/PRACTICE) ──────────────────────────── */
  /* Every question rolls a rarity at pose time:
       Common (60%) — 0 XP, free reps
       Rare   (30%) — +1 XP, +1 toward per-class minimum
       Legendary (10%) — +2 XP, +2 toward per-class minimum, AND counts
                         toward the per-day target that ticks the streak.
     Color escalates with stakes. */
  .pill.rarity.common    { background: rgba(255,255,255,0.06); color: var(--text-mute); }
  .pill.rarity.rare      { background: #3aa3e0; color: #fff; }
  .pill.rarity.legendary {
    background: linear-gradient(135deg, #ffb05a 0%, #f0922a 60%, #d22a2a 100%);
    color: #fff;
    text-shadow: 0 1px 2px rgba(0,0,0,0.45);
  }
  /* Bonus badge — once-per-day forced-Legendary draw. */
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
  }
  .msg.result .body {
    display: inline-flex;
    align-self: flex-start;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    background: var(--bg-elev);
    border: 1px solid var(--line);
    border-radius: 999px;
    font-size: 12px;
    color: var(--text-soft);
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

  /* ── tablet ≥720 ───────────────────────────────────────────────────────── */
  @media (min-width: 720px) {
    aside.servers-rail {
      transform: translateX(0);
      position: relative;
      z-index: auto;
      visibility: visible;
      pointer-events: auto;
      transition: none;
    }
    .shell { grid-template-columns: var(--rail-w) 1fr; }
    main.workspace { grid-column: 2; }
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
    .shell { grid-template-columns: var(--rail-w) var(--channels-w) 1fr; }
    main.workspace { grid-column: 3; }
    .scrim { display: none !important; }
    .hamburger { display: none; }
    .stream { padding: 18px 24px; }
  }
`;
