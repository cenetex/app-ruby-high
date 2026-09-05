// Shared page layout and presentation rules for the Ruby High viewer.
export const UNIFIED_VIEWER_CSS = `
  :root {
    --bg-deep: #191c25;
    --bg: #222631;
    --bg-elev: #2a2f3b;
    --bg-elev-2: #333946;
    --bg-active: #3e4553;
    --text: #f4f1e9;
    --text-soft: #c5c7cf;
    --text-mute: #b2b7c2;
    --text-dim: #a8afbc;
    --text-fade: #a8afbc;
    --line: #393e49;
    --ruby: #c73543;
    --ruby-soft: #42272d;
    --ruby-text: #ffc3c8;
    --paper: #f4eedf;
    --paper-ink: #30332e;
    --paper-muted: #606258;
    --board: #254d3a;
    --radius-panel: 12px;
    --radius-control: 8px;
    --space-page: 28px;
    --type-title: 28px;
    --type-heading: 20px;
    --type-body: 15px;
    --type-small: 13px;
  }
  #shell {
    grid-template-columns: 176px minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
    grid-template-areas: "header header" "nav workspace";
  }
  .app-header {
    grid-area: header;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    min-width: 0;
    padding: calc(10px + var(--safe-top)) calc(24px + var(--safe-right)) 10px calc(24px + var(--safe-left));
    border-bottom: 1px solid var(--line);
    background: var(--bg);
  }
  .app-brand {
    display: flex; align-items: center; gap: 10px;
    padding: 0; border: 0; background: transparent; color: var(--text);
    font-size: 21px; font-weight: 700; letter-spacing: -.6px; min-height: 44px;
  }
  .app-brand img { width: 36px; height: 36px; object-fit: cover; border-radius: 9px; }
  .app-header .you-profile { display: flex; align-items: center; gap: 10px; text-align: left; border: 0; border-radius: 8px; color: var(--text); background: transparent; flex: 0 1 auto; width: auto; max-width: 220px; min-height: 44px; padding: 0; }
  .app-header .you-avatar { display: grid; place-items: center; flex-shrink: 0; overflow: hidden; border-radius: 50%; background: var(--bg-elev); width: 40px; height: 40px; flex-basis: 40px; border: 1px solid var(--line); }
  .app-header .you-meta { display: flex; flex-direction: column; min-width: 0; }
  .app-header .you-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }
  .app-header .you-state { font-size: 12px; }
  .app-nav { grid-area: nav; display: flex; flex-direction: column; gap: 8px; padding: 24px 14px; border-right: 1px solid var(--line); }
  .app-nav button {
    display: flex; align-items: center; gap: 12px; min-height: 48px; padding: 12px;
    background: transparent; border: 1px solid transparent; border-radius: var(--radius-control);
    color: var(--text-mute); font-size: var(--type-body); font-weight: 600; text-align: left;
  }
  .app-nav button > span { font-size: 22px; line-height: 1; width: 24px; text-align: center; }
  .app-nav button:hover { background: var(--bg); color: var(--text); }
  .app-nav button[aria-current="page"], #shell[data-app-page="account"] .app-nav .account-action {
    background: var(--ruby-soft); color: var(--ruby-text);
  }
  .app-nav .account-action { margin-top: auto; }
  #shell #workspace { grid-area: workspace; display: block; height: auto; min-height: 0; overflow: auto; overscroll-behavior: contain; scroll-padding: 24px; }
  #workspace .app-page, #workspace .class-page { width: 100%; max-width: 960px; margin: 0 auto; padding: var(--space-page); }
  #workspace .class-page { min-height: 100%; }
  .app-page h1 { margin: 0; font-size: var(--type-title); line-height: 1.2; font-weight: 650; letter-spacing: -.6px; }
  .page-heading { margin-bottom: 24px; }
  .page-heading p { color: var(--text-mute); margin: 8px 0 0; font-size: var(--type-body); }
  .page-heading .page-kicker { margin: 0 0 8px; text-transform: uppercase; font-size: 12px; letter-spacing: 1.2px; }
  .page-section-title { margin: 28px 0 14px; font-size: var(--type-heading); line-height: 1.3; font-weight: 600; }
  .page-note { color: var(--text-mute); margin: 24px 0; font-size: var(--type-body); }
  .page-empty { padding: 24px; border-radius: var(--radius-panel); background: var(--bg); }
  .page-empty h2 { font-size: var(--type-heading); margin: 0; }
  .page-empty p { color: var(--text-mute); margin: 12px 0 20px; }
  .page-tabs, #privy-overlay .account-tabs { display: flex; gap: 8px; border-bottom: 1px solid var(--line); margin-bottom: 24px; padding: 0 0 12px; }
  .page-tabs button, #privy-overlay .account-tab { min-height: 44px; padding: 10px 16px; border: 1px solid transparent; border-radius: var(--radius-control); background: transparent; color: var(--text-mute); font-size: 14px; font-weight: 600; }
  .page-tabs button[aria-pressed="true"], #privy-overlay .account-tab.is-active { background: var(--bg-elev); border-color: var(--line); color: var(--text); box-shadow: none; }
  .page-back, .page-link { border: 0; border-radius: var(--radius-control); color: var(--ruby-text); background: transparent; padding: 10px 0; min-height: 44px; font-size: 14px; font-weight: 600; text-align: left; }
  .page-back { margin: 0 0 16px; }
  .page-link:hover, .page-back:hover { text-decoration: underline; }
  .page-empty .primary, #shell .chat-action-btn, #shell .typed-submit-btn, .sheet-card .primary,
  .sheet-card .primary-link, .sheet-card .sheet-actions > button:not(.secondary),
  #privy-overlay .account-section-actions > button:not(.secondary), #account-buy-passes,
  #account-buy-card-packs, #account-create-character {
    background: var(--ruby); color: #fff; border: 1px solid var(--ruby); box-shadow: none;
    border-radius: var(--radius-control); min-height: 44px; padding: 11px 18px; font-size: var(--type-body); font-weight: 600; letter-spacing: 0; text-transform: none;
  }
  button:disabled { cursor: default; }

  /* Campus keeps room selection, teacher cards, and the student roster together. */
  #campus-page #channels-rail {
    position: static; display: block; width: 100%; height: auto; padding: 0; overflow: visible;
    transform: none; visibility: visible; pointer-events: auto; transition: none;
    background: transparent; border: 0; z-index: auto; will-change: auto;
  }
  #campus-page .channels-header { display: block; height: auto; min-height: 0; padding: 0 0 24px; border: 0; background: transparent; }
  #campus-page .grade-name { margin-top: 8px; font-size: 15px; color: var(--text-mute); }
  #campus-page .channels-list { padding: 0; overflow: visible; flex: none; }
  #campus-page .channel-row { min-height: 70px; margin: 0 0 10px; padding: 12px; background: var(--bg); border: 1px solid var(--line); border-radius: var(--radius-panel); }
  #campus-page .channel-row.is-active { background: var(--bg-elev); border-color: var(--text-fade); }
  #campus-page .channel-row .hash { display: none; }
  #campus-page .teacher-thumb, #campus-page .teacher-card-trigger { width: 44px; height: 44px; min-width: 44px; border-radius: 50%; }
  #campus-page .room-row-name { font-size: 16px; text-transform: capitalize; }
  #campus-page .room-row-button { min-height: 44px; }
  #campus-page .channel-section-title { margin: 24px 0 12px; padding: 0; font-size: 13px; color: var(--text-mute); }
  #campus-page .channels-links { padding: 24px 0 0; margin-top: 24px; border-top: 1px solid var(--line); gap: 18px; }
  #campus-page .channels-links a { font-size: 13px; padding: 10px 0; }
  #campus-page .leaderboard-panel { padding: 0; height: auto; overflow: visible; background: transparent; }
  #campus-page .leaderboard-header { padding: 0 0 24px; flex-wrap: wrap; }
  #campus-page .leaderboard-body { overflow: visible; padding: 0; }

  /* A lesson has one vertical reading order and one scroll area. */
  #class-page .top-bar { position: static; height: auto; min-height: 0; padding: 0 0 20px; background: transparent; border: 0; backdrop-filter: none; }
  #class-page .channel-name .top { font-size: var(--type-title); line-height: 1.2; font-weight: 650; letter-spacing: -.6px; text-transform: capitalize; }
  #class-page .channel-name .sub { font-size: var(--type-small); margin-top: 8px; line-height: 1.45; }
  #class-page .arc-indicator { display: none; }
  #class-page .mobile-view-toggle:not([hidden]) { display: flex; gap: 8px; padding: 0 0 16px; margin: 0; background: transparent; border: 0; }
  #class-page .mobile-view-toggle button { min-height: 44px; padding: 10px 16px; border: 1px solid transparent; border-radius: var(--radius-control); font-size: 14px; font-weight: 600; background: transparent; color: var(--text-mute); }
  #class-page .mobile-view-toggle button[aria-selected="true"] { background: var(--bg-elev); color: var(--text); border-color: var(--line); }
  #class-page .blackboard-panel { overflow: visible; max-height: none; padding: 0; border: 0; background: transparent; }
  #class-page .daily-class-progress { margin: 0 0 18px; padding: 0; overflow: visible; }
  #class-page .daily-class-progress li { font-size: 12px; }
  #class-page .blackboard-meta { display: none; }
  #class-page .board-frame-host { padding: 0; flex: none; }
  #class-page .board-frame { padding: 0; border: 0; border-radius: var(--radius-panel); background: var(--board); box-shadow: none; }
  #class-page .board { padding: 24px; padding-right: 24px; min-height: 0; max-height: none; overflow: visible; border-radius: var(--radius-panel); background: var(--board); box-shadow: none; font: var(--type-body)/1.55 var(--board-font); }
  #class-page .board-frame-host:has(.teacher-figure:not([hidden])) .board { padding: 92px 24px 24px; }
  #class-page .teacher-figure { width: 48px; height: 48px; top: 24px; left: 24px; right: auto; border: 1px solid rgba(255,255,255,.3); box-shadow: none; animation: none; }
  #class-page .lesson-teacher-name { position: absolute; left: 86px; top: 36px; color: var(--ink); font-size: 15px; font-weight: 600; }
  #class-page .teacher-figure[hidden] + .lesson-teacher-name { display: none; }
  #class-page .board .prompt { font: 500 25px/1.4 var(--board-font); white-space: normal; overflow: visible; text-shadow: none; }
  #class-page .board .prompt p { margin: 0 0 14px; }
  #class-page .board .prompt p:last-child { margin-bottom: 0; }
  #class-page .board .reveal { font: var(--type-body)/1.55 var(--board-font); margin: 20px 0 0; }
  #class-page .answers-host { flex: none; padding: 0; margin: 20px 0 0; max-height: none; overflow: visible; }
  #class-page .answers { gap: 12px; padding: 0; grid-template-columns: repeat(2, minmax(0,1fr)); }
  #class-page .answer { min-height: 62px; padding: 14px 16px; border: 1px solid var(--line); border-radius: var(--radius-panel); background: var(--bg); box-shadow: none; color: var(--text); }
  #class-page .answer .label { font: 500 var(--type-body)/1.45 var(--board-font); }
  #class-page .answer .badge { background: transparent; color: var(--text-mute); font-size: 13px; border: 0; width: 22px; min-width: 22px; }
  #class-page .answer:hover:not(:disabled) { background: var(--bg-elev); border-color: var(--text-fade); transform: none; }
  #class-page .answer.is-selected { border-color: var(--ruby); background: var(--ruby-soft); }
  #class-page .answer.is-correct { border-color: #70c18d; background: #254335; }
  #class-page .answer.is-wrong { border-color: #f4828c; background: #482c32; }
  #class-page .advantage-bar { justify-content: flex-start; padding: 12px 0 0; }
  #class-page .advantage-btn { min-height: 44px; font-size: 13px; border-radius: var(--radius-control); }
  #class-page .typed-answer-host { margin: 20px 0 0; padding: 0; overflow: visible; max-height: none; flex: none; }
  #class-page .response-builder { border: 1px solid var(--line); border-radius: var(--radius-panel); background: var(--bg); padding: 16px; }
  #class-page .response-stepper { gap: 8px; }
  #class-page .response-stepper button { min-height: 44px; color: var(--text-mute); font-size: 13px; }
  #class-page .response-stepper button.is-active { color: var(--text); border-color: var(--ruby); background: var(--ruby-soft); }
  #class-page .response-card-grid button { border-radius: var(--radius-control); font-size: 14px; min-height: 96px; }
  #class-page .response-card-grid button.is-selected { border-color: var(--ruby); background: var(--ruby-soft); }
  #class-page .response-card-grid button strong { font-size: 15px; }
  #class-page .response-card-grid button small { font-size: 13px; }
  #class-page .race-strip { margin: 16px 0 0; padding: 0; border: 0; background: transparent; }
  #class-page .blackboard-foot { margin: 18px 0 0; padding: 0; border: 0; }
  #class-page .composer-zone { position: sticky; bottom: 0; padding: 18px 0; margin-top: 18px; border-top: 1px solid var(--line); background: var(--bg-deep); min-height: 0; z-index: 5; }
  #class-page .composer-zone:has(#next-btn[hidden]):has(#chat-form[hidden]):has(#checking[hidden]) { display: none; }
  #class-page .chat-action-btn { width: auto; min-width: 160px; margin-left: auto; }
  #class-page .stream { padding: 0; min-height: 0; max-height: none; overflow: visible; display: none; }
  #shell[data-mobile-pane="chat"] #class-page .stream, #shell[data-mode="in-lounge"] #class-page .stream { display: flex; }
  #shell[data-mobile-pane="chat"] #class-page .blackboard-panel { display: none; }
  #class-page .message { padding: 16px 0; }
  #class-page .blackboard-empty { max-height: none; overflow: visible; }

  /* Results and collections use paper, with a shared reading scale. */
  #class-page .blackboard-panel[data-question-type="class-report"] .board { display: block; min-height: 0; padding: 0; background: transparent; }
  #class-page .blackboard-panel[data-question-type="class-report"] .board-frame { background: transparent; }
  #class-page .blackboard-panel[data-question-type="class-report"] .teacher-figure { display: none; }
  #class-page .class-report-card, #yearbook-page .class-report-card {
    width: 100%; border: 0; border-radius: var(--radius-panel); background: var(--paper); color: var(--paper-ink); padding: 24px; box-shadow: none;
    font: var(--type-body)/1.5 var(--board-font);
  }
  #workspace .class-report-main { display: grid; grid-template-columns: 54px minmax(0,1fr); gap: 16px; min-height: 0; padding: 0; align-items: start; }
  #workspace .class-report-letter { position: static; width: 54px; height: 60px; font: 600 34px/1 Georgia,serif; display: grid; place-items: center; border: 1px solid #cbc7bc; border-radius: 8px; color: var(--paper-ink); background: transparent; box-shadow: none; transform: none; }
  #workspace .class-report-title { font-size: 22px; line-height: 1.3; color: var(--paper-ink); margin: 0; }
  #workspace .class-report-subtitle, #workspace .class-result-prompt { font-size: 13px; line-height: 1.5; color: var(--paper-muted); margin: 8px 0 0; }
  #workspace .class-report-teacher-art { display: none; }
  #workspace .class-result-sections { display: grid; grid-template-columns: 1fr; gap: 16px; margin-top: 24px; }
  #workspace .class-result-section { background: transparent; padding: 0; border: 0; border-radius: 0; }
  #workspace .class-result-label { color: var(--paper-ink); font-size: 14px; line-height: 1.4; font-weight: 650; letter-spacing: 0; text-transform: none; margin: 0 0 5px; }
  #workspace .class-result-body { color: var(--paper-ink); font-size: 15px; line-height: 1.55; margin: 0; }
  #workspace .class-report-metrics { display: flex; gap: 28px; border-top: 1px solid #cbc7bc; padding-top: 18px; margin-top: 24px; }
  #workspace .class-report-metric { border: 0; padding: 0; background: transparent; }
  #workspace .class-report-metric .k, #workspace .class-report-metric .d { color: var(--paper-muted); font-size: 12px; }
  #workspace .class-report-metric .v { color: var(--paper-ink); font-size: 20px; }
  #workspace .class-report-next { background: transparent; border: 0; border-radius: 0; padding: 0; }
  #workspace .class-report-next-title { font-size: 15px; }
  #workspace .class-report-next-body { font-size: 13px; line-height: 1.5; color: var(--text-mute); }
  .school-record-row { display: grid; grid-template-columns: minmax(0,1fr) 150px 100px; gap: 16px; align-items: center; padding: 16px 0; border-bottom: 1px solid var(--line); }
  .school-record-row > span { font-size: 13px; color: var(--text-mute); }
  .school-record-row .school-record-grade { text-align: right; color: var(--text); }
  #yearbook-page .paper-archive-entry { margin-bottom: 16px; padding: 22px; border-radius: var(--radius-panel); background: var(--paper); color: var(--paper-ink); border: 0; box-shadow: none; }
  #yearbook-page .paper-archive-meta, #yearbook-page .paper-archive-quote, #yearbook-page .paper-archive-stats { color: var(--paper-muted); font-size: 14px; }
  #yearbook-page .account-section { border: 0; padding: 0; background: transparent; }

  /* Account is part of the same page layout. Detail sheets keep one close rule. */
  #privy-overlay .privy-card.account-card { width: 100%; max-width: none; height: auto; min-height: 0; max-height: none; padding: 0; margin: 0; display: block; background: transparent; border: 0; box-shadow: none; overflow: visible; }
  #privy-overlay .account-header-row { display: block; margin: 0 0 24px; padding: 0; }
  #privy-overlay .account-workspace { overflow: visible; max-height: none; padding: 0; }
  #privy-overlay .account-panel { padding: 0; }
  #privy-overlay .account-section { border: 0; border-bottom: 1px solid var(--line); border-radius: 0; padding: 0 0 24px; margin: 0 0 24px; background: transparent; box-shadow: none; }
  #privy-overlay .account-section-title { font-size: 18px; }
  #privy-overlay .account-section-sub, #privy-overlay .sub { font-size: 14px; line-height: 1.5; }
  #privy-overlay .account-identity-inline { display: block; margin: 0 0 12px; }
  #privy-overlay .account-passkey-copy { margin: 12px 0 20px; }
  #privy-overlay .wallet-panel { font-size: 14px; color: var(--text-mute); margin: 0 0 12px; }
  #privy-overlay .account-character-card { border-radius: var(--radius-panel); background: var(--bg); padding: 16px; }
  #privy-overlay .account-character-portrait { width: 64px; height: 64px; border-radius: 50%; }
  #privy-overlay .account-section-actions > button, #privy-overlay .sheet-actions > button { min-height: 44px; border-radius: var(--radius-control); }
  #privy-overlay .account-details > summary { font-size: 15px; min-height: 44px; padding: 12px 0; }
  .sheet-overlay .sheet-close { width: 44px; height: 44px; border: 1px solid var(--line); border-radius: 50%; background: var(--bg-elev); color: var(--text); }
  .sheet-overlay .sheet-card { border-radius: var(--radius-panel); }
  .profile-page .ccg-art { max-height: 220px; aspect-ratio: 3 / 1; }
  .profile-page .ccg-art img { object-position: center 25%; }
  .profile-page .ccg-name { font-size: 26px; }
  .profile-page .ccg-subtitle { font-size: 14px; }
  .profile-page .ccg-body { padding: 24px; font-size: 15px; }

  @media (max-width: 700px) {
    :root { --space-page: 20px; --type-title: 25px; }
    #shell { grid-template-columns: minmax(0,1fr); grid-template-rows: auto minmax(0,1fr) auto; grid-template-areas: "header" "workspace" "nav"; }
    .app-header { padding: calc(8px + var(--safe-top)) calc(16px + var(--safe-right)) 8px calc(16px + var(--safe-left)); }
    .app-brand { font-size: 19px; }
    .app-header .you-meta { display: none; }
    .app-nav { flex-direction: row; padding: 6px calc(8px + var(--safe-right)) calc(6px + var(--safe-bot)) calc(8px + var(--safe-left)); gap: 4px; border-right: 0; border-top: 1px solid var(--line); background: var(--bg); }
    .app-nav button { flex: 1; flex-direction: column; justify-content: center; gap: 5px; padding: 7px 4px; min-height: 56px; font-size: 12px; }
    .app-nav button > span { font-size: 21px; }
    .app-nav .account-action { display: none; }
    #workspace .app-page, #workspace .class-page { padding: 20px 16px; }
    #class-page .top-bar { padding-bottom: 16px; }
    #class-page .board { padding: 20px; }
    #class-page .board-frame-host:has(.teacher-figure:not([hidden])) .board { padding: 80px 20px 20px; }
    #class-page .lesson-teacher-name { left: 78px; top: 30px; font-size: 14px; }
    #class-page .teacher-figure { left: 20px; top: 20px; width: 44px; height: 44px; }
    #class-page .board .prompt { font-size: 21px; line-height: 1.45; }
    #class-page .answers { grid-template-columns: 1fr; gap: 8px; }
    #class-page .answer { min-height: 52px; padding: 12px 14px; }
    #class-page .chat-action-btn { width: 100%; }
    #class-page .composer-zone { padding: 12px 0; }
    #class-page .response-builder { padding: 12px; }
    #class-page .response-card-grid { grid-template-columns: 1fr; }
    #class-page .response-card-grid button { min-height: 68px; }
    #class-page .response-stepper { gap: 4px; }
    #class-page .response-stepper button { padding: 8px 4px; font-size: 12px; }
    #class-page .class-report-card, #yearbook-page .class-report-card { padding: 20px; }
    #workspace .class-report-main { grid-template-columns: 44px minmax(0,1fr); gap: 12px; }
    #workspace .class-report-letter { width: 44px; height: 52px; font-size: 28px; }
    #workspace .class-report-title { font-size: 20px; }
    .school-record-row { grid-template-columns: minmax(0,1fr) auto; gap: 4px 12px; }
    .school-record-row > strong { grid-column: 1; }
    .school-record-row > span { grid-column: 1; }
    .school-record-row .school-record-grade { grid-column: 2; grid-row: 1 / 3; }
    #privy-overlay .account-section-head { flex-direction: column; gap: 12px; }
    #privy-overlay .account-section-actions { justify-content: flex-start; }
    #privy-overlay .account-character-grid { grid-template-columns: 1fr; }
    #privy-overlay .account-wallet-rules { grid-template-columns: 1fr; }
    #privy-overlay .passkey-recovery-actions { grid-template-columns: 1fr; }
    .profile-page .ccg-art { max-height: 180px; aspect-ratio: 3 / 2; }
    .profile-page .ccg-body { padding: 20px; }
  }
`;
