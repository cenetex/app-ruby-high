const VIEWER_FRAME_ANCESTORS_DIRECTIVE =
  "frame-ancestors 'self' http://localhost:* http://127.0.0.1:* " +
  "http://[::1]:* http://[0:0:0:0:0:0:0:1]:* https://localhost:* " +
  "https://127.0.0.1:* https://[::1]:* https://[0:0:0:0:0:0:0:1]:* " +
  "electrobun: capacitor: capacitor-electron: app: tauri: file:";

export { VIEWER_FRAME_ANCESTORS_DIRECTIVE };

export interface ViewerRenderOptions {
  agentName: string;
  sessionId: string;
  apiBase: string;
  role: "agent" | "human";
}

export function renderViewerHtml(opts: ViewerRenderOptions): string {
  const safeAgent = escapeHtml(opts.agentName);
  const safeSession = encodeURIComponent(opts.sessionId);
  const safeApiBase = encodeURIComponent(opts.apiBase);
  const role = opts.role === "agent" ? "agent" : "human";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no" />
<meta name="theme-color" content="#1a1c25" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<title>Ruby High — ${safeAgent}</title>
<style>
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
  .channels-header .progress-bar {
    height: 5px;
    background: var(--line);
    border-radius: 999px;
    margin-top: 10px;
    overflow: hidden;
  }
  .channels-header .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--accent), #f0922a);
    width: 0%;
    transition: width 0.3s ease;
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
  .top-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    padding-right: calc(var(--safe-right));
  }
  .grade-pill-btn {
    appearance: none;
    background: var(--bg-elev);
    border: none;
    color: var(--text-soft);
    border-radius: 999px;
    padding: 7px 12px;
    font-size: 12px;
    font-weight: 700;
    height: 36px;
  }
  .grade-pill-btn .gpb-grade { color: var(--accent); margin-left: 4px; }
  .score-chip {
    background: var(--bg-elev);
    color: var(--text);
    border-radius: 999px;
    padding: 7px 12px;
    font-size: 12px;
    font-weight: 700;
    height: 36px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .score-chip .v { color: var(--accent); }

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
  .blackboard-empty .cta {
    appearance: none;
    border: none;
    background: var(--accent);
    color: #fff;
    border-radius: 999px;
    padding: 11px 22px;
    font-weight: 800;
    font-size: 14px;
    margin-top: 12px;
    box-shadow: var(--shadow);
  }
  .blackboard-empty .open-rails {
    appearance: none;
    border: 1px solid var(--line);
    background: transparent;
    color: var(--text);
    border-radius: 999px;
    padding: 11px 18px;
    font-weight: 700;
    font-size: 13px;
    margin-top: 12px;
  }
  .board-frame-host {
    padding: 0 calc(var(--safe-right) + 10px) 0 calc(var(--safe-left) + 10px);
    position: relative;
  }
  .teacher-figure {
    position: absolute;
    right: calc(var(--safe-right) + 4px);
    bottom: -10px;
    width: 88px;
    height: auto;
    pointer-events: none;
    z-index: 2;
    filter: drop-shadow(0 6px 10px rgba(0,0,0,0.35));
    animation: figure-in 0.32s ease-out;
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
  .blackboard-foot .filter-mini {
    appearance: none;
    background: var(--bg-elev);
    border: 1px solid var(--line);
    color: var(--text-soft);
    font-size: 12px;
    border-radius: 999px;
    padding: 6px 10px;
  }
  .blackboard-foot .qnum {
    font-size: 11px;
    color: var(--text-mute);
    letter-spacing: 0.12em;
    text-transform: uppercase;
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
  .answers {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
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
  .signin-cta {
    text-align: center;
  }
  .signin-cta .help {
    color: var(--text-soft);
    font-size: 13px;
    margin: 4px 0 10px;
    line-height: 1.4;
  }
  .signin-cta a {
    display: inline-block;
    background: var(--accent);
    color: #fff;
    text-decoration: none;
    padding: 11px 20px;
    border-radius: 999px;
    font-weight: 800;
    font-size: 15px;
    box-shadow: var(--shadow);
  }
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
</style>
</head>
<body>
<div class="shell" id="shell">

  <!-- servers (grades) rail -->
  <aside class="servers-rail" id="servers-rail">
    <button class="server-btn is-home" data-grade="home" id="home-btn" title="Ruby High home">
      <img src="${escapeHtml(opts.apiBase)}/assets/logo.png" alt="" />
    </button>
    <div class="servers-divider"></div>
    <!-- grade buttons injected -->
  </aside>

  <!-- channels rail -->
  <aside class="channels-rail" id="channels-rail">
    <div class="channels-header">
      <div class="grade-label">School</div>
      <div class="grade-name" id="grade-title">Ruby High</div>
      <div class="progress-bar"><div class="progress-fill" id="grade-progress-fill"></div></div>
    </div>
    <div class="channels-list" id="channels-list"></div>
    <div class="channels-footer">
      <div class="you-avatar" id="you-avatar">${escapeHtml((opts.agentName || "U").slice(0, 1).toUpperCase())}</div>
      <div class="you-meta">
        <span class="you-name" id="you-name">${safeAgent}</span>
        <span class="you-state" id="you-state">checking…</span>
      </div>
      <button class="footer-action" id="footer-action" type="button">Sign in</button>
    </div>
  </aside>

  <!-- workspace -->
  <main class="workspace" id="workspace">
    <header class="top-bar">
      <button class="hamburger" id="hamburger" type="button" aria-label="Toggle channels">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
          <path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/>
        </svg>
      </button>
      <div class="channel-name">
        <div class="top"><span class="hash">#</span><span id="channel-title">general</span></div>
        <div class="sub" id="channel-sub">pick a grade to begin</div>
      </div>
      <div class="top-actions">
        <button class="grade-pill-btn" id="grade-pill-btn" type="button">Grade<span class="gpb-grade" id="gpb-grade">—</span></button>
        <span class="score-chip" id="score-chip"><span class="v" id="score-value">0</span>/<span id="score-total">0</span></span>
      </div>
    </header>

    <section class="lounge-stage" id="lounge-stage">
      <div class="lounge-title">Teachers' Lounge — listening in</div>
      <div class="lounge-figures">
        <img src="${escapeHtml(opts.apiBase)}/assets/teachers/ruby-full.png" alt="Ruby"/>
        <img src="${escapeHtml(opts.apiBase)}/assets/teachers/sally-science-full.png" alt="Sally Science"/>
        <img src="${escapeHtml(opts.apiBase)}/assets/teachers/professor-edward-full.png" alt="Professor Edward"/>
      </div>
    </section>

    <section class="blackboard-panel is-empty" id="blackboard-panel">
      <div class="blackboard-empty" id="blackboard-empty">
        <div id="blackboard-empty-text">Pick a year and a question will appear on the board.</div>
        <button class="open-rails" id="blackboard-open-rails" type="button">Open menu</button>
        <button class="cta" id="blackboard-pick-now" type="button" hidden>Pick first question</button>
      </div>

      <div class="blackboard-meta" id="blackboard-meta" hidden></div>
      <div class="board-frame-host" id="board-frame-host" hidden>
        <div class="board-frame">
          <div class="board" id="board">
            <div class="prompt" id="board-prompt"></div>
            <div class="reveal" id="board-reveal" hidden></div>
          </div>
        </div>
        <img class="teacher-figure" id="teacher-figure" alt="" hidden />
      </div>
      <div class="answers-host" id="answers-host" hidden>
        <div class="answers" id="answers">
          <button class="answer A" data-pick="A" disabled><span class="badge">A</span><span class="label">—</span></button>
          <button class="answer B" data-pick="B" disabled><span class="badge">B</span><span class="label">—</span></button>
          <button class="answer C" data-pick="C" disabled><span class="badge">C</span><span class="label">—</span></button>
          <button class="answer D" data-pick="D" disabled><span class="badge">D</span><span class="label">—</span></button>
        </div>
      </div>
      <div class="race-strip" id="race-strip" hidden>
        <span class="timer-pill" id="timer-pill"><span class="ring"></span><span id="timer-label">25s</span></span>
        <span class="race-row" id="race-row"></span>
      </div>
      <div class="blackboard-foot" id="blackboard-foot" hidden>
        <span class="qnum" id="qnum">Question 1</span>
        <select class="filter-mini" id="difficulty-filter" aria-label="Difficulty">
          <option value="">any difficulty</option>
          <option value="easy">easy</option>
          <option value="medium">medium</option>
          <option value="hard">hard</option>
        </select>
        <button class="next-btn" id="next-btn" type="button">Next question →</button>
      </div>
    </section>

    <section class="stream" id="stream"></section>

    <section class="composer-zone" id="composer-zone">
      <form class="composer-form" id="chat-form" hidden>
        <textarea id="chat-input" rows="1" placeholder="Message — the teacher and class can hear you" disabled></textarea>
        <button type="submit" class="send-btn" id="chat-send" disabled aria-label="Send">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 12l14-7-7 14-2-5-5-2z"/>
          </svg>
        </button>
      </form>
      <div class="signin-cta" id="signin-cta">
        <div class="help">Sign in with OpenRouter to chat with the teachers and the class.</div>
        <a id="login-btn" href="/api/apps/ruby-high/auth/start" target="_blank" rel="noopener">Sign in with OpenRouter</a>
      </div>
      <div class="checking" id="checking" hidden>checking…</div>
    </section>
  </main>

  <div class="scrim" id="scrim"></div>
</div>

<div class="congrats-toast" id="congrats-toast" aria-live="polite"></div>

<script>
(() => {
  const apiBase = decodeURIComponent("${safeApiBase}");
  const sessionId = decodeURIComponent("${safeSession}");
  const role = "${role}";
  const sessionUrl = apiBase + "/session/" + encodeURIComponent(sessionId);
  const commandUrl = sessionUrl + "/command";
  const GRADES = ["9","10","11","12"];
  const GRADE_SHORT = { "9": "FR", "10": "SO", "11": "JR", "12": "SR" };
  const GRADE_LABELS = { "9": "Freshman", "10": "Sophomore", "11": "Junior", "12": "Senior" };
  const LOUNGE_ID = "lounge";
  const COMPLETION_THRESHOLD = 5;

  // ── AI students ──────────────────────────────────────────────────────────
  const STUDENTS = [
    { id: "lyra",  name: "Lyra",   color: "#ff6f91" },
    { id: "sami",  name: "Sami",   color: "#36c2cc" },
    { id: "ravi",  name: "Ravi",   color: "#ffb05a" },
    { id: "indra", name: "Indra",  color: "#a06bff" },
    { id: "mika",  name: "Mika",   color: "#52c673" },
    { id: "noor",  name: "Noor",   color: "#ec4f9e" },
  ];
  const STUDENT_LINES_RIGHT = ["nice","yo same","easy","ok smart kid","first try??","atta way","lock in","bro really did that","fr"];
  const STUDENT_LINES_WRONG = ["ouch","i picked the same","tricky","happens","hated that one","next time fr","ngl me too"];
  const STUDENT_LINES_GREET = ["yo","hey","what's up","let's go","first one easy plz","ready"];
  const pickRandom = (a) => a[Math.floor(Math.random() * a.length)];
  // Pick the 2 students currently in the active room (driven by the server's
  // (grade, room) cohort pairing). Falls back to a deterministic subset when
  // we don't yet have telemetry.
  function studentsInRoom() {
    if (lastTelemetry && lastTelemetry.room_cohort && lastTelemetry.faculty) {
      const room = (lastTelemetry.rooms || []).find((r) => r.teacherId === lastTelemetry.faculty);
      const ids = (room && lastTelemetry.room_cohort[room.id]) || [];
      const found = ids.map((sid) => STUDENTS.find((s) => s.id === sid)).filter(Boolean);
      if (found.length > 0) return found;
    }
    return STUDENTS.slice(0, 2);
  }
  function studentsForGrade(_grade) { return studentsInRoom(); }

  // ── DOM refs ──────────────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const els = {
    shell: $("shell"),
    serversRail: $("servers-rail"),
    channelsRail: $("channels-rail"),
    homeBtn: $("home-btn"),
    gradeTitle: $("grade-title"),
    gradeProgressFill: $("grade-progress-fill"),
    channelsList: $("channels-list"),
    youAvatar: $("you-avatar"),
    youName: $("you-name"),
    youState: $("you-state"),
    footerAction: $("footer-action"),
    hamburger: $("hamburger"),
    channelTitle: $("channel-title"),
    channelSub: $("channel-sub"),
    gradePillBtn: $("grade-pill-btn"),
    gpbGrade: $("gpb-grade"),
    scoreChip: $("score-chip"),
    score: $("score-value"),
    scoreTotal: $("score-total"),
    stream: $("stream"),
    blackboardPanel: $("blackboard-panel"),
    loungeStage: $("lounge-stage"),
    teacherFigure: $("teacher-figure"),
    blackboardEmpty: $("blackboard-empty"),
    blackboardEmptyText: $("blackboard-empty-text"),
    blackboardOpenRails: $("blackboard-open-rails"),
    blackboardPickNow: $("blackboard-pick-now"),
    blackboardMeta: $("blackboard-meta"),
    boardFrameHost: $("board-frame-host"),
    boardPrompt: $("board-prompt"),
    boardReveal: $("board-reveal"),
    answersHost: $("answers-host"),
    answers: Array.from(document.querySelectorAll(".answer")),
    blackboardFoot: $("blackboard-foot"),
    qnum: $("qnum"),
    nextBtn: $("next-btn"),
    raceStrip: $("race-strip"),
    raceRow: $("race-row"),
    timerPill: $("timer-pill"),
    timerLabel: $("timer-label"),
    difficultyFilter: $("difficulty-filter"),
    composerZone: $("composer-zone"),
    chatForm: $("chat-form"),
    chatInput: $("chat-input"),
    chatSend: $("chat-send"),
    signinCta: $("signin-cta"),
    checking: $("checking"),
    scrim: $("scrim"),
    congrats: $("congrats-toast"),
  };

  // ── view state ────────────────────────────────────────────────────────────
  let lastTelemetry = null;
  let lastRosterSig = "";
  let lastRevealId = null;
  let authed = null; // null = unknown, true/false set after first poll
  let lockedFor = null;
  let streamingMsgEl = null;
  let renderedHistorySig = null;
  let activeQuestionId = null; // currently displayed question id on the blackboard
  let questionCounter = 0;     // session-local question count for "Question N" label
  let lastShownGrade = null;
  let lastShownFaculty = null;
  let agentBusy = false;       // true while a teacher-driven SSE turn is running
  let lastAgentTrigger = null; // dedupe key so we don't re-fire on poll
  let opinionSubmitted = false; // player's text has been recorded for current round
  let opinionGradeFired = false; // grading has been triggered for current round
  const renderedOpinionIds = new Set(); // responder ids whose text we've appended to chat
  const gradedResponderIds = new Set(); // responders whose grade-tag we've stamped on

  // Track scroll-to-bottom intent: only auto-scroll if user is near bottom.
  function isNearBottom() {
    const { scrollTop, scrollHeight, clientHeight } = els.stream;
    return scrollHeight - (scrollTop + clientHeight) < 80;
  }
  function scrollIfPinned(force) {
    if (force || isNearBottom()) {
      requestAnimationFrame(() => {
        els.stream.scrollTop = els.stream.scrollHeight;
      });
    }
  }

  function clearStream() {
    els.stream.innerHTML = "";
    streamingMsgEl = null;
    renderedHistorySig = null;
  }
  function resetBlackboard() {
    activeQuestionId = null;
    questionCounter = 0;
    showBlackboardEmpty(true);
  }

  // ── command helper ────────────────────────────────────────────────────────
  async function command(payload) {
    try {
      const r = await fetch(commandUrl, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: "request " + r.status }));
        appendSystem("error · " + (err.error || r.status));
        return null;
      }
      const data = await r.json();
      if (data && data.session) render(data.session);
      return data;
    } catch (err) {
      appendSystem("submit failed · " + (err && err.message ? err.message : "error"));
      return null;
    }
  }

  // ── message factories ────────────────────────────────────────────────────
  function teacherStickerUrl(facultyId) {
    if (!facultyId) return null;
    return apiBase + "/assets/teachers/" + encodeURIComponent(facultyId) + ".png";
  }
  function appendMsg({ kind, name, body, color, facultyId }) {
    const wrap = document.createElement("div");
    wrap.className = "msg " + (kind || "bot");
    const avatar = document.createElement("div");
    avatar.className = "avatar" + (kind === "teacher" ? " is-teacher" : "");
    if (kind === "teacher" && facultyId) {
      avatar.style.background = "#fff";
      const img = document.createElement("img");
      img.src = teacherStickerUrl(facultyId);
      img.alt = name || "";
      img.onerror = () => {
        // Fall back to letter if the sticker is missing.
        avatar.removeChild(img);
        avatar.style.background = color || "var(--bg-elev)";
        avatar.textContent = name ? name.slice(0, 1).toUpperCase() : "?";
      };
      avatar.appendChild(img);
    } else {
      avatar.style.background = color || "var(--bg-elev)";
      avatar.textContent = name ? name.slice(0, 1).toUpperCase() : "?";
    }
    const head = document.createElement("div");
    head.className = "head";
    const nameEl = document.createElement("span");
    nameEl.className = "name";
    nameEl.textContent = name || "—";
    head.appendChild(nameEl);
    if (kind === "teacher") {
      const tag = document.createElement("span"); tag.className = "role-tag bot"; tag.textContent = "Teacher"; head.appendChild(tag);
    } else if (kind === "you") {
      const tag = document.createElement("span"); tag.className = "role-tag you"; tag.textContent = "You"; head.appendChild(tag);
    } else if (kind === "student") {
      const tag = document.createElement("span"); tag.className = "role-tag student"; tag.textContent = "Student"; head.appendChild(tag);
    }
    const stamp = document.createElement("span");
    stamp.className = "stamp";
    stamp.textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    head.appendChild(stamp);
    const bodyEl = document.createElement("div");
    bodyEl.className = "body";
    bodyEl.textContent = body || "";
    wrap.appendChild(avatar);
    wrap.appendChild(head);
    wrap.appendChild(bodyEl);
    els.stream.appendChild(wrap);
    scrollIfPinned();
    return bodyEl;
  }
  function appendSystem(text) {
    const wrap = document.createElement("div");
    wrap.className = "msg system";
    const body = document.createElement("div");
    body.className = "body";
    body.textContent = text;
    wrap.appendChild(body);
    els.stream.appendChild(wrap);
    scrollIfPinned();
  }
  function appendTool(text) {
    const wrap = document.createElement("div");
    wrap.className = "msg tool";
    const body = document.createElement("div");
    body.className = "body";
    body.textContent = text;
    wrap.appendChild(body);
    els.stream.appendChild(wrap);
    scrollIfPinned();
  }
  function appendEmptyState({ title, body, ctaLabel, ctaAction, facultyId }) {
    const wrap = document.createElement("div");
    wrap.className = "empty-state";
    const heroSrc = facultyId
      ? apiBase + "/assets/teachers/" + encodeURIComponent(facultyId) + ".png"
      : apiBase + "/assets/teachers/ruby.png";
    wrap.innerHTML =
      '<img class="logo" src="' + heroSrc + '" alt=""/>' +
      '<h2>' + escape(title) + '</h2>' +
      '<p>' + escape(body) + '</p>';
    if (ctaLabel) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cta";
      btn.textContent = ctaLabel;
      btn.addEventListener("click", ctaAction);
      wrap.appendChild(btn);
    }
    els.stream.appendChild(wrap);
  }
  function escape(s) { return String(s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","'":"&#39;"}[c])); }

  // ── blackboard panel (single, persistent, updates in place) ─────────────
  function showBlackboardEmpty(reset) {
    els.blackboardPanel.classList.add("is-empty");
    els.blackboardEmpty.hidden = false;
    els.blackboardMeta.hidden = true;
    els.boardFrameHost.hidden = true;
    els.answersHost.hidden = true;
    els.blackboardFoot.hidden = true;
    if (reset) {
      els.boardPrompt.textContent = "";
      els.boardReveal.hidden = true;
      els.boardReveal.textContent = "";
    }
  }
  function showBlackboardLoaded(isOpinion) {
    // Opinion mode: keep the chalkboard prompt visible but hide the A/B/C/D
    // grid. Player and AI students all answer in chat — the teacher reads
    // them and grades from there.
    els.blackboardPanel.classList.remove("is-empty");
    els.blackboardEmpty.hidden = true;
    els.blackboardMeta.hidden = false;
    els.boardFrameHost.hidden = false;
    els.answersHost.hidden = !!isOpinion;
    els.blackboardFoot.hidden = false;
  }

  // ── race strip (timer + per-NPC thinking/locked indicators) ─────────────
  function renderRaceStrip(t) {
    const round = t.active_round;
    if (!round || !t.current) {
      els.raceStrip.hidden = true;
      els.raceRow.innerHTML = "";
      return;
    }
    els.raceStrip.hidden = false;
    // Timer label (uses server-derived remainingMs as the source of truth).
    const remainingS = Math.max(0, Math.ceil(round.remainingMs / 1000));
    els.timerLabel.textContent = round.resolved
      ? "done"
      : remainingS + "s";
    els.timerPill.classList.toggle("is-warn", !round.resolved && remainingS <= 10 && remainingS > 5);
    els.timerPill.classList.toggle("is-danger", !round.resolved && remainingS <= 5);
    els.timerPill.classList.toggle("is-locked", !!round.resolved);

    // Per-participant cards (player + NPCs).
    const cards = [];
    cards.push({
      kind: "player",
      id: "player",
      name: "You",
      faceUrl: null,
      isLocked: round.player.isLocked,
      pick: round.player.picked, // null until reveal
      isCorrect: round.resolved && round.player.picked && t.current ? round.player.picked === t.lastReveal?.correct : null,
      isFirstCorrect: round.firstCorrect === "player",
      color: "var(--accent)",
    });
    (round.npcs || []).forEach((n) => {
      const s = STUDENTS.find((x) => x.id === n.studentId);
      cards.push({
        kind: "student",
        id: n.studentId,
        name: s ? s.shortName || s.name : n.studentId,
        faceUrl: null,
        isLocked: n.isLocked,
        pick: n.pick,
        isCorrect: n.isCorrect,
        isFirstCorrect: round.firstCorrect === n.studentId,
        color: s ? s.color : "#888",
      });
    });
    els.raceRow.innerHTML = "";
    for (const c of cards) {
      const card = document.createElement("span");
      card.className = "race-card" + (c.isLocked ? " is-locked" : "");
      if (round.resolved) {
        if (c.isCorrect === true) card.classList.add("is-correct");
        else if (c.isCorrect === false) card.classList.add("is-wrong");
        if (c.isFirstCorrect) card.classList.add("is-first-correct");
      }
      const av = document.createElement("span");
      av.className = "race-avatar";
      if (c.kind === "student") {
        const img = document.createElement("img");
        img.src = apiBase + "/assets/teachers/" + ""; // placeholder, will use student face below
        // Students don't have face stickers yet — fall back to colored circle with initial.
        av.style.background = c.color;
        av.style.color = "#fff";
        av.textContent = (c.name || "?").charAt(0).toUpperCase();
      } else {
        av.style.background = c.color;
        av.style.color = "#fff";
        av.textContent = "U";
      }
      card.appendChild(av);
      const nameEl = document.createElement("span");
      nameEl.textContent = c.name;
      card.appendChild(nameEl);
      if (c.isLocked) {
        if (round.resolved && c.pick) {
          const lt = document.createElement("span");
          lt.className = "pick-letter";
          lt.textContent = c.pick;
          card.appendChild(lt);
        } else if (!round.resolved) {
          const lock = document.createElement("span");
          lock.className = "pick-letter";
          lock.textContent = "✓";
          card.appendChild(lock);
        }
      } else {
        const dots = document.createElement("span");
        dots.className = "thinking-dots";
        dots.appendChild(document.createElement("span"));
        dots.appendChild(document.createElement("span"));
        dots.appendChild(document.createElement("span"));
        card.appendChild(dots);
      }
      els.raceRow.appendChild(card);
    }
  }
  function renderTeacherFigure(faculty) {
    if (!faculty || faculty.id === LOUNGE_ID) {
      els.teacherFigure.hidden = true;
      els.teacherFigure.removeAttribute("src");
      return;
    }
    const url = apiBase + "/assets/teachers/" + encodeURIComponent(faculty.id) + "-full.png";
    if (els.teacherFigure.getAttribute("src") !== url) els.teacherFigure.setAttribute("src", url);
    els.teacherFigure.hidden = false;
  }
  function setLoungeMode(on) {
    els.loungeStage.classList.toggle("is-open", !!on);
    els.blackboardPanel.style.display = on ? "none" : "";
  }
  function renderBlackboard(question, faculty, currentGrade) {
    if (faculty && faculty.id === LOUNGE_ID) {
      // Lounge mode: hide blackboard, show lounge stage with all three figures.
      setLoungeMode(true);
      renderTeacherFigure(null);
      activeQuestionId = null;
      return;
    }
    setLoungeMode(false);
    renderTeacherFigure(faculty);
    if (!question) {
      showBlackboardEmpty(true);
      activeQuestionId = null;
      // Show "Pick first question" CTA only when grade is selected.
      if (currentGrade) {
        els.blackboardEmptyText.textContent = "Ready when you are. Tap below to draw the first question for grade " + currentGrade + ".";
        els.blackboardOpenRails.hidden = true;
        els.blackboardPickNow.hidden = false;
      } else {
        els.blackboardEmptyText.textContent = "Pick a grade and a question will appear on the board.";
        els.blackboardOpenRails.hidden = false;
        els.blackboardPickNow.hidden = true;
      }
      return;
    }

    const isNewQuestion = question.id !== activeQuestionId;
    if (isNewQuestion) {
      activeQuestionId = question.id;
      questionCounter += 1;
    }

    const isOpinion = (lastTelemetry && lastTelemetry.is_opinion) || question.type === "opinion";
    showBlackboardLoaded(isOpinion);

    // Meta pills
    els.blackboardMeta.innerHTML = "";
    if (faculty) {
      const f = document.createElement("span"); f.className = "pill faculty"; f.textContent = faculty.displayName || "Teacher"; els.blackboardMeta.appendChild(f);
    }
    if (question.subject) { const s = document.createElement("span"); s.className = "pill subject"; s.textContent = question.subject; els.blackboardMeta.appendChild(s); }
    if (question.difficulty) { const d = document.createElement("span"); d.className = "pill difficulty " + question.difficulty; d.textContent = question.difficulty; els.blackboardMeta.appendChild(d); }
    if (currentGrade) { const g = document.createElement("span"); g.className = "pill"; g.textContent = "Grade " + currentGrade; els.blackboardMeta.appendChild(g); }

    // Prompt — always wipe + rewrite on new question (chalkboard re-erasing).
    if (isNewQuestion) {
      els.boardPrompt.textContent = question.prompt;
      els.boardReveal.hidden = true;
      els.boardReveal.textContent = "";
      els.boardReveal.classList.remove("correct", "wrong");
    }

    // Answer buttons
    els.answers.forEach((btn) => {
      const pick = btn.dataset.pick;
      const label = btn.querySelector(".label");
      const text = (question.options && question.options[pick]) || "—";
      label.textContent = text;
      if (isNewQuestion) {
        btn.classList.remove("is-correct", "is-wrong");
      }
      btn.disabled = role === "agent";
    });

    // Footer
    els.qnum.textContent = "Question " + questionCounter;
    els.nextBtn.disabled = false;
    els.nextBtn.style.display = "none"; // hidden until reveal

    // Opinion-mode bookkeeping resets on new question.
    if (isNewQuestion && isOpinion) {
      opinionSubmitted = false;
      opinionGradeFired = false;
      renderedOpinionIds.clear();
      gradedResponderIds.clear();
    }
  }

  function applyRevealToBlackboard(reveal) {
    if (!reveal) return;
    els.answers.forEach((btn) => {
      btn.disabled = true;
      if (btn.dataset.pick === reveal.correct) btn.classList.add("is-correct");
      if (btn.dataset.pick === reveal.picked && !reveal.wasCorrect) btn.classList.add("is-wrong");
    });
    els.boardReveal.hidden = false;
    els.boardReveal.classList.toggle("correct", !!reveal.wasCorrect);
    els.boardReveal.classList.toggle("wrong", !reveal.wasCorrect);
    const verdict = reveal.wasCorrect ? "✓ Correct (" + reveal.picked + ")"
      : "✗ You picked " + reveal.picked + " — answer was " + reveal.correct;
    els.boardReveal.textContent = verdict + (reveal.explanation ? " — " + reveal.explanation : "");
    els.nextBtn.style.display = "";
    els.nextBtn.focus();
  }

  function appendResultChip(reveal) {
    const wrap = document.createElement("div");
    wrap.className = "msg result";
    const body = document.createElement("div");
    body.className = "body";
    const badge = document.createElement("span");
    badge.className = "badge-mini " + (reveal.wasCorrect ? "ok" : "bad");
    badge.textContent = reveal.wasCorrect ? "✓ " + reveal.picked : "✗ " + reveal.picked + " · " + reveal.correct;
    body.appendChild(badge);
    body.appendChild(document.createTextNode("Q" + questionCounter + " — " + (reveal.wasCorrect ? "correct" : "missed")));
    wrap.appendChild(body);
    els.stream.appendChild(wrap);
    scrollIfPinned();
  }

  // ── server rail (just the brand button now — no grade picker) ───────────
  function rebuildServersRail() {
    // Strip stale year/lounge buttons and dividers from earlier versions.
    els.serversRail.querySelectorAll(".server-btn[data-grade]:not(.is-home)").forEach((n) => n.remove());
    els.serversRail.querySelectorAll(".server-btn[data-lounge]").forEach((n) => n.remove());
    els.serversRail.querySelectorAll(".servers-divider").forEach((n) => n.remove());
  }

  // ── channels rail ─────────────────────────────────────────────────────────
  function rebuildChannelsRail() {
    const t = lastTelemetry || {};
    const grade = t.current_grade;
    const roster = t.faculty_roster || [];
    const sig = (grade ?? "?") + "::" + roster.map((f) => f.id + ":" + f.available + ":" + f.questionCount).join("|") + "::" + t.faculty;
    if (sig === lastRosterSig) return;
    lastRosterSig = sig;

    if (t.faculty === LOUNGE_ID) {
      els.gradeTitle.textContent = (grade ? (GRADE_LABELS[grade] || grade) + " · " : "") + "Lounge";
      els.gradeProgressFill.style.width = "0%";
    } else if (grade) {
      els.gradeTitle.textContent = (GRADE_LABELS[grade] || grade) + " year";
      const progress = (t.grade_progress && t.grade_progress[grade]) || 0;
      const pct = Math.min(100, (progress / COMPLETION_THRESHOLD) * 100);
      els.gradeProgressFill.style.width = pct + "%";
    } else {
      els.gradeTitle.textContent = "Ruby High";
      els.gradeProgressFill.style.width = "0%";
    }

    els.channelsList.innerHTML = "";
    // Note: in earlier versions the lounge mode would replace the entire
    // channel list with a "in the lounge" panel, which trapped the user.
    // The list is now uniform — the lounge is just one of 4 rows below,
    // highlighted when active. The lounge stage above the chat shows the
    // teacher figures.
    if (!grade) {
      const empty = document.createElement("div");
      empty.className = "channel-section-title";
      empty.textContent = "Loading…";
      els.channelsList.appendChild(empty);
      return;
    }
    const title = document.createElement("div");
    title.className = "channel-section-title";
    title.textContent = (GRADE_LABELS[grade] || grade) + " year — class periods";
    els.channelsList.appendChild(title);

    // Fixed rooms — homeroom / science / literature — driven by t.rooms.
    const rooms = (t.rooms || []).filter((r) => r.teaches);
    const cohort = t.room_cohort || {};
    rooms.forEach((room) => {
      const fac = roster.find((f) => f.id === room.teacherId);
      const row = document.createElement("button");
      const isActive = !!(fac && t.faculty === fac.id);
      row.className = "channel-row" + (isActive ? " is-active" : "");
      row.dataset.faculty = fac ? fac.id : "";
      if (fac) {
        const thumb = document.createElement("span");
        thumb.className = "teacher-thumb";
        const img = document.createElement("img");
        img.src = apiBase + "/assets/teachers/" + encodeURIComponent(fac.id) + "-face.png";
        img.alt = "";
        img.onerror = () => { thumb.style.background = fac.accent || "#444"; thumb.removeChild(img); };
        thumb.appendChild(img);
        row.appendChild(thumb);
      }
      const hash = document.createElement("span");
      hash.className = "hash";
      hash.textContent = "#";
      row.appendChild(hash);
      const name = document.createElement("span");
      name.style.flex = "1 1 auto";
      name.textContent = room.channelName;
      row.appendChild(name);
      const cohortIds = cohort[room.id] || [];
      if (cohortIds.length > 0) {
        const dots = document.createElement("span");
        dots.style.display = "inline-flex";
        dots.style.gap = "3px";
        cohortIds.forEach((sid) => {
          const s = STUDENTS.find((x) => x.id === sid);
          const d = document.createElement("span");
          d.style.cssText = "width:8px;height:8px;border-radius:999px;background:" + (s ? s.color : "#888");
          d.title = s ? s.name : sid;
          dots.appendChild(d);
        });
        row.appendChild(dots);
      }
      row.addEventListener("click", () => fac && setFaculty(fac.id));
      els.channelsList.appendChild(row);
    });

    // The Teachers' Lounge — same channel UX as a classroom but no teacher
    // thumbnail (it's the all-three-teachers room).
    {
      const row = document.createElement("button");
      const isActive = t.faculty === LOUNGE_ID;
      row.className = "channel-row" + (isActive ? " is-active" : "");
      const thumb = document.createElement("span");
      thumb.className = "teacher-thumb";
      thumb.style.background = "#9b6dff";
      thumb.style.display = "grid";
      thumb.style.placeItems = "center";
      thumb.style.color = "#fff";
      thumb.style.fontSize = "13px";
      thumb.textContent = "🛋";
      row.appendChild(thumb);
      const hash = document.createElement("span");
      hash.className = "hash";
      hash.textContent = "#";
      row.appendChild(hash);
      const name = document.createElement("span");
      name.style.flex = "1 1 auto";
      name.textContent = "lounge";
      row.appendChild(name);
      row.addEventListener("click", () => enterLounge());
      els.channelsList.appendChild(row);
    }

    // Year-wide leaderboard: every student's subject progress.
    const studentsTitle = document.createElement("div");
    studentsTitle.className = "channel-section-title";
    studentsTitle.textContent = "Your year — leaderboard";
    els.channelsList.appendChild(studentsTitle);
    const npcRoster = t.npc_roster || [];
    npcRoster.forEach((npc) => {
      const s = STUDENTS.find((x) => x.id === npc.id);
      if (!s) return;
      const row = document.createElement("div");
      row.className = "student-row";
      row.style.flexWrap = "wrap";
      const dot = document.createElement("span"); dot.className = "dot"; dot.style.background = s.color; row.appendChild(dot);
      const span = document.createElement("span"); span.style.flex = "1 1 auto"; span.textContent = s.name; row.appendChild(span);
      const status = document.createElement("span");
      status.style.cssText = "font-size:11px;color:var(--text-mute);";
      status.textContent = npc.currentRoom ? "#" + npc.currentRoom : "graduated";
      row.appendChild(status);
      // Subject progress chips — three small dots filled by completion.
      const chips = document.createElement("span");
      chips.style.cssText = "display:inline-flex;gap:3px;width:100%;font-size:10px;color:var(--text-mute);margin-top:3px;letter-spacing:0.04em;";
      ["homeroom", "science", "literature"].forEach((roomId) => {
        const subj = npc.subjects[roomId];
        const chip = document.createElement("span");
        const done = subj.completed;
        const correct = subj.correct;
        chip.textContent = roomId.charAt(0).toUpperCase() + ":" + correct + (done ? "✓" : "/" + COMPLETION_THRESHOLD);
        chip.style.cssText = "padding:1px 6px;border-radius:999px;background:" + (done ? "rgba(255,77,77,0.18)" : "var(--bg-elev)") + ";color:" + (done ? "#ff8c8c" : "var(--text-mute)") + ";";
        chips.appendChild(chip);
      });
      row.appendChild(chips);
      els.channelsList.appendChild(row);
    });
  }
  function channelNameFor(f) {
    if (!f) return "channel";
    if (f.id === "ruby") return "homeroom";
    if (f.id === "sally-science") return "science";
    if (f.id === "professor-edward") return "literature";
    if (f.id === LOUNGE_ID) return "lounge";
    return f.id;
  }
  function roomForTeacher(facultyId, rooms) {
    return (rooms || []).find((r) => r.teacherId === facultyId) || null;
  }

  // ── primary actions ──────────────────────────────────────────────────────
  async function selectGrade(g) {
    const prevGrade = lastTelemetry && lastTelemetry.current_grade;
    const data = await command({ type: "select-grade", grade: g });
    if (data && data.session) {
      if (prevGrade !== g) {
        clearStream();
        resetBlackboard();
        appendSystem("— Welcome to Grade " + g + " —");
        const grade = data.session.telemetry.current_grade;
        const fac = (data.session.telemetry.faculty_roster || []).find((f) => f.id === data.session.telemetry.faculty);
        if (Math.random() < 0.55) {
          setTimeout(() => {
            const who = pickRandom(studentsForGrade(grade));
            appendMsg({ kind: "student", name: who.name, body: pickRandom(STUDENT_LINES_GREET), color: who.color });
          }, 800);
        }
        if (authed) {
          loadHistory(data.session.telemetry.faculty);
          // Hand the floor to the teacher — they greet AND queue the question.
          runAgentTurn("channel-enter", { grade });
        } else {
          // Fallback: scripted greeting + manual Pick first question.
          if (fac) appendMsg({ kind: "teacher", name: fac.displayName, body: greetingFor(fac, grade), color: fac.accent, facultyId: fac.id });
          setTimeout(pickNext, 400);
        }
      }
    }
    closeRails();
  }
  function greetingFor(fac, grade) {
    const g = grade ? "Grade " + grade : "class";
    if (fac.id === "ruby") return "Welcome to " + g + ". Pick \\"Next question\\" whenever you're ready.";
    if (fac.id === "sally-science") return "Sally here. " + g + " STEM — let's see what you've got.";
    if (fac.id === "professor-edward") return "You've found my " + g + " literature room. Take a seat.";
    return "Class is in session. Hit \\"Next question\\" to start.";
  }
  async function setFaculty(facultyId) {
    const prev = lastTelemetry && lastTelemetry.faculty;
    if (facultyId === prev) { closeRails(); return; }
    const data = await command({ type: "set-faculty", faculty: facultyId });
    if (data && data.session) {
      clearStream();
      resetBlackboard();
      const fac = (data.session.telemetry.faculty_roster || []).find((f) => f.id === facultyId);
      const grade = data.session.telemetry.current_grade;
      if (authed) {
        loadHistory(facultyId);
        runAgentTurn("channel-enter", { grade });
      } else if (fac) {
        appendMsg({ kind: "teacher", name: fac.displayName, body: greetingFor(fac, grade), color: fac.accent, facultyId: fac.id });
      }
    }
    closeRails();
  }
  async function enterLounge() {
    const prev = lastTelemetry && lastTelemetry.faculty;
    if (prev === LOUNGE_ID) { closeRails(); return; }
    const data = await command({ type: "set-faculty", faculty: LOUNGE_ID });
    if (data && data.session) {
      clearStream();
      resetBlackboard();
      appendSystem("— You walk into the teachers' lounge —");
      if (authed) {
        runAgentTurn("lounge-enter", { });
      } else {
        appendSystem("Sign in to eavesdrop on the faculty.");
      }
    }
    closeRails();
  }
  async function pickNext() {
    els.nextBtn.disabled = true;
    try {
      await command({
        type: "pick",
        difficulty: els.difficultyFilter.value || undefined,
      });
      lockedFor = null;
    } finally {
      els.nextBtn.disabled = false;
    }
  }
  async function pickAnswer(choice, btn) {
    if (!btn || btn.disabled) return;
    els.answers.forEach((b) => (b.disabled = true));
    const data = await command({ type: "answer", picked: choice, role });
    lockedFor = data && data.session && data.session.telemetry && data.session.telemetry.current
      ? data.session.telemetry.current.id : null;
    // Note: the teacher's reaction fires when the ROUND RESOLVES, not when
    // the player clicks — see render() / new-reveal detection below. The
    // round may stay open for a few seconds while NPCs commit their picks.
  }

  // ── render (the master apply-telemetry-to-DOM function) ──────────────────
  function setAccent(color) {
    document.documentElement.style.setProperty("--accent", color || "#d22a2a");
  }
  function render(s) {
    if (!s || !s.telemetry) return;
    const t = s.telemetry;
    lastTelemetry = t;

    setAccent(t.facultyAccent);
    rebuildServersRail();
    rebuildChannelsRail();

    // Header
    const fac = (t.faculty_roster || []).find((f) => f.id === t.faculty);
    els.channelTitle.textContent = fac ? channelNameFor(fac) : "general";
    els.channelSub.textContent = fac
      ? fac.displayName + " · " + (t.current_grade ? "Grade " + t.current_grade : "no grade")
      : "pick a grade";
    els.gpbGrade.textContent = t.current_grade ? t.current_grade : "—";
    els.score.textContent = t.scoreCorrect ?? 0;
    els.scoreTotal.textContent = t.scoreTotal ?? 0;

    // Render blackboard panel (single, in-place updates).
    renderBlackboard(t.current || null, fac || null, t.current_grade);
    renderRaceStrip(t);
    if (t.is_opinion && t.active_round) {
      renderOpinionsIntoChat(t.active_round);
      maybeAutoTriggerGrading(t);
    }

    // Reveal — apply to blackboard + log a result chip in the chat once.
    // ALSO fire the teacher's reaction here (not in pickAnswer) so they
    // react to the full round outcome, not the bare click.
    if (t.lastReveal) {
      const revealId = t.lastReveal.questionId + ":" + t.lastReveal.picked;
      if (revealId !== lastRevealId) {
        lastRevealId = revealId;
        if (activeQuestionId === t.lastReveal.questionId) {
          applyRevealToBlackboard(t.lastReveal);
          appendResultChip(t.lastReveal);
        }
        showCongrats(t.lastReveal.encouragement, t.lastReveal.wasCorrect);
        scheduleStudentChime(t.lastReveal.wasCorrect, t.current_grade);
        // Teacher reacts + queues next question. Small delay so the
        // congrats toast lands first and the chat doesn't feel stacked.
        if (authed && t.faculty !== LOUNGE_ID) {
          setTimeout(() => {
            runAgentTurn("answer-graded", {
              grade: t.current_grade,
              picked: t.lastReveal.picked,
              correct: t.lastReveal.correct,
              wasCorrect: t.lastReveal.wasCorrect,
            });
          }, 600);
        }
      }
    } else if (!t.current && lastRevealId) {
      lastRevealId = null;
    }

    // Empty-stream welcome (only if no chat yet).
    if (els.stream.children.length === 0) {
      if (!t.current_grade) {
        appendEmptyState({
          title: "Welcome to Ruby High",
          body: "Pick a grade from the menu to start class. Five correct answers earns a red ✓.",
          ctaLabel: "Pick a grade",
          ctaAction: openRails,
          facultyId: "ruby",
        });
      } else {
        const f = (t.faculty_roster || []).find((x) => x.id === t.faculty);
        if (f) appendMsg({ kind: "teacher", name: f.displayName, body: greetingFor(f, t.current_grade), color: f.accent, facultyId: f.id });
      }
    }

    lastShownGrade = t.current_grade;
    lastShownFaculty = t.faculty;
  }

  // ── student chime ─────────────────────────────────────────────────────────
  // When authed, fire the LLM-backed /chat/student-chime endpoint so the AI
  // students respond in their own voice. Falls back to canned lines when the
  // user isn't signed in.
  let lastChimeAt = 0;
  function studentChimeAllowed() {
    const now = Date.now();
    if (now - lastChimeAt < 5000) return false;
    lastChimeAt = now;
    return true;
  }
  async function fireStudentChime({ situation, note, grade, faculty, delayMs }) {
    if (!studentChimeAllowed()) return;
    const who = pickRandom(studentsForGrade(grade));
    if (!authed) {
      const fallback = situation === "answer-correct"
        ? pickRandom(STUDENT_LINES_RIGHT)
        : situation === "answer-wrong"
          ? pickRandom(STUDENT_LINES_WRONG)
          : pickRandom(STUDENT_LINES_GREET);
      setTimeout(() => appendMsg({ kind: "student", name: who.name, body: fallback, color: who.color }), delayMs ?? 700);
      return;
    }
    const wait = delayMs ?? (700 + Math.random() * 800);
    setTimeout(async () => {
      try {
        const r = await fetch("/api/apps/ruby-high/chat/student-chime", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ studentId: who.id, situation, note, faculty }),
        });
        if (!r.ok) throw new Error("student " + r.status);
        const data = await r.json();
        const line = (data && data.line) || pickRandom(STUDENT_LINES_GREET);
        appendMsg({ kind: "student", name: who.name, body: line, color: who.color });
      } catch (err) {
        // Fallback to canned line if the API call fails.
        const fallback = situation === "answer-correct" ? pickRandom(STUDENT_LINES_RIGHT) : pickRandom(STUDENT_LINES_WRONG);
        appendMsg({ kind: "student", name: who.name, body: fallback, color: who.color });
      }
    }, wait);
  }
  function scheduleStudentChime(wasCorrect, grade) {
    fireStudentChime({
      situation: wasCorrect ? "answer-correct" : "answer-wrong",
      note: wasCorrect
        ? "Player just got the question right."
        : "Player just got the question wrong.",
      grade,
      faculty: lastTelemetry && lastTelemetry.faculty,
    });
  }

  // ── congrats toast ───────────────────────────────────────────────────────
  let toastHideTimer = null;
  function showCongrats(text, wasCorrect) {
    if (!text) return;
    els.congrats.textContent = text;
    els.congrats.classList.remove("is-correct", "is-wrong", "is-visible");
    void els.congrats.offsetWidth;
    els.congrats.classList.add(wasCorrect ? "is-correct" : "is-wrong", "is-visible");
    clearTimeout(toastHideTimer);
    toastHideTimer = setTimeout(() => els.congrats.classList.remove("is-visible"), 2400);
  }

  // ── auth ─────────────────────────────────────────────────────────────────
  let lastAuthState = null;
  async function pollAuth() {
    try {
      const r = await fetch("/api/apps/ruby-high/auth/me", { credentials: "same-origin" });
      const data = await r.json();
      const next = !!data.authed;
      if (next !== lastAuthState) {
        lastAuthState = next;
        authed = next;
        applyAuthUI();
        if (authed && lastTelemetry) loadHistory(lastTelemetry.faculty);
      }
    } catch {
      if (authed === true) { authed = false; lastAuthState = false; applyAuthUI(); }
    }
  }
  function applyAuthUI() {
    els.checking.hidden = authed !== null;
    if (authed === null) {
      els.signinCta.hidden = true;
      els.chatForm.hidden = true;
      els.checking.hidden = false;
      els.youState.textContent = "checking…";
      els.footerAction.hidden = true;
      return;
    }
    els.footerAction.hidden = false;
    if (authed) {
      els.youState.textContent = "signed in";
      els.footerAction.textContent = "Sign out";
      els.signinCta.hidden = true;
      els.chatForm.hidden = false;
      els.chatInput.disabled = false;
      els.chatSend.disabled = false;
    } else {
      els.youState.textContent = "signed out";
      els.footerAction.textContent = "Sign in";
      els.signinCta.hidden = false;
      els.chatForm.hidden = true;
      els.chatInput.disabled = true;
      els.chatSend.disabled = true;
    }
  }
  async function logout() {
    await fetch("/api/apps/ruby-high/auth/logout", { method: "POST", credentials: "same-origin" });
    authed = false;
    lastAuthState = false;
    applyAuthUI();
    if (lastTelemetry) loadHistory(lastTelemetry.faculty);
  }
  async function loadHistory(facultyId) {
    if (!authed || !facultyId) return;
    try {
      const r = await fetch("/api/apps/ruby-high/chat/history?faculty=" + encodeURIComponent(facultyId), { credentials: "same-origin" });
      const data = await r.json();
      authed = !!data.authed;
      const msgs = data.history || [];
      const sig = facultyId + ":" + msgs.length;
      if (sig === renderedHistorySig) return;
      renderedHistorySig = sig;
      els.stream.innerHTML = "";
      streamingMsgEl = null;
      const fac = (lastTelemetry && lastTelemetry.faculty_roster || []).find((f) => f.id === facultyId);
      const teacherName = fac ? fac.displayName : facultyId;
      const teacherAccent = fac ? fac.accent : "#d22a2a";
      msgs.forEach((m) => {
        if (m.role === "user") appendMsg({ kind: "you", name: "You", body: m.content, color: "var(--accent)" });
        else if (m.role === "assistant" && m.content) appendMsg({ kind: "teacher", name: teacherName, body: m.content, color: teacherAccent, facultyId });
      });
      scrollIfPinned(true);
      applyAuthUI();
    } catch (err) { /* ignore */ }
  }
  // Shared SSE consumer — used for /chat (user-initiated) and /chat/event
  // (teacher-driven turns AND lounge multi-teacher turns). Tracks the current
  // "speaker" via the speaker event so each new bubble is attributed correctly.
  function teacherInfo(facultyId) {
    const fac = (lastTelemetry && lastTelemetry.faculty_roster || []).find((f) => f.id === facultyId);
    return {
      name: fac ? fac.displayName : "Teacher",
      accent: fac ? fac.accent : "#d22a2a",
      facultyId: fac ? fac.id : facultyId,
    };
  }
  async function consumeSseStream(response) {
    if (!response.ok || !response.body) {
      const err = await response.json().catch(() => ({ error: response.status }));
      appendSystem("chat error · " + (err.error || response.status));
      return;
    }
    streamingMsgEl = null;
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    // Default speaker = current channel's teacher; overridden by speaker events.
    let speaker = teacherInfo(lastTelemetry && lastTelemetry.faculty);
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let frameEnd;
      while ((frameEnd = buf.indexOf("\\n\\n")) !== -1) {
        const frame = buf.slice(0, frameEnd);
        buf = buf.slice(frameEnd + 2);
        const lines = frame.split(/\\r?\\n/);
        let event = "message";
        let data = "";
        for (const line of lines) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) data += line.slice(5).trim();
        }
        if (!data) continue;
        let parsed;
        try { parsed = JSON.parse(data); } catch { continue; }
        if (event === "speaker") {
          speaker = teacherInfo(parsed.facultyId);
          streamingMsgEl = null; // force a new bubble for the new speaker
        } else if (event === "delta") {
          if (!streamingMsgEl) {
            streamingMsgEl = appendMsg({ kind: "teacher", name: speaker.name, body: "", color: speaker.accent, facultyId: speaker.facultyId });
          }
          streamingMsgEl.textContent += parsed.text || "";
          scrollIfPinned();
        } else if (event === "tool") {
          const args = parsed.args || {};
          const summary = parsed.tool + "(" + Object.keys(args).slice(0, 3).map((k) => k + "=" + JSON.stringify(args[k])).join(", ") + ") → " + (parsed.result && parsed.result.ok ? "ok" : "fail");
          appendTool(summary);
          fetchSession();
          streamingMsgEl = null;
        } else if (event === "error") {
          appendSystem("error · " + (parsed.message || "unknown"));
          streamingMsgEl = null;
        }
      }
    }
  }

  async function sendChatMessage(text) {
    if (!authed || !text.trim()) return;
    if (agentBusy) return;
    agentBusy = true;
    const targetFaculty = (lastTelemetry && lastTelemetry.faculty) || "ruby";

    // If an opinion question is active and the player hasn't submitted their
    // response yet, route this chat message to /chat/opinion-submit instead
    // of the regular agent loop.
    const inOpinion = !!(lastTelemetry && lastTelemetry.is_opinion && lastTelemetry.active_round && !lastTelemetry.active_round.resolved && !opinionSubmitted);

    appendMsg({ kind: "you", name: "You", body: text, color: "var(--accent)" });
    els.chatInput.value = "";
    els.chatInput.style.height = "40px";
    els.chatInput.disabled = true;
    els.chatSend.disabled = true;
    try {
      let r;
      if (inOpinion) {
        opinionSubmitted = true;
        r = await fetch("/api/apps/ruby-high/chat/opinion-submit", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
      } else {
        r = await fetch("/api/apps/ruby-high/chat", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ faculty: targetFaculty, message: text }),
        });
      }
      await consumeSseStream(r);
    } catch (err) {
      appendSystem("chat failed · " + (err && err.message ? err.message : "error"));
    } finally {
      agentBusy = false;
      els.chatInput.disabled = !authed;
      els.chatSend.disabled = !authed;
      els.chatInput.focus();
      if (Math.random() < 0.4) {
        fireStudentChime({
          situation: "teacher-replied-to-player",
          note: "Teacher just replied to the player. Riff briefly.",
          grade: lastTelemetry && lastTelemetry.current_grade,
          faculty: lastTelemetry && lastTelemetry.faculty,
          delayMs: 1200 + Math.random() * 1500,
        });
      }
    }
  }

  // Teacher-driven turn — fires when a state event happens (channel enter,
  // answer graded). The teacher decides what to say and whether to put a new
  // question on the board via tool calls.
  async function runAgentTurn(trigger, context) {
    if (!authed) return;
    if (agentBusy) return;
    const targetFaculty = (lastTelemetry && lastTelemetry.faculty) || "ruby";
    const triggerKey = trigger + "::" + targetFaculty + "::" + ((context && context.grade) || "?");
    // Channel-enter dedupes per (grade, faculty); answer-graded fires every time.
    if (trigger === "channel-enter" && triggerKey === lastAgentTrigger) return;
    lastAgentTrigger = triggerKey;
    agentBusy = true;
    try {
      const r = await fetch("/api/apps/ruby-high/chat/event", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ faculty: targetFaculty, trigger, context: context || {} }),
      });
      await consumeSseStream(r);
    } catch (err) {
      appendSystem("teacher offline · " + (err && err.message ? err.message : "error"));
    } finally {
      agentBusy = false;
    }
  }

  async function fetchSession() {
    try {
      const r = await fetch(sessionUrl, { credentials: "same-origin" });
      if (!r.ok) throw new Error("session " + r.status);
      const s = await r.json();
      render(s);
    } catch { /* ignore */ }
  }

  // ── rails toggling ────────────────────────────────────────────────────────
  function openRails() { els.shell.classList.add("is-rails-open"); }
  function closeRails() { els.shell.classList.remove("is-rails-open"); }
  function toggleRails() { els.shell.classList.toggle("is-rails-open"); }

  // ── opinion-mode helpers ────────────────────────────────────────────────
  // The player's opinion submission is just a regular chat message routed to
  // the opinion endpoint. NPC responses appear as chat messages too. The
  // teacher's verdict streams as a normal chat reply when grading fires.
  function renderOpinionsIntoChat(round) {
    if (!round || round.type !== "opinion") return;
    // Render any new NPC responses (deduped by responder id) as student
    // chat messages.
    for (const r of (round.opinionResponses || [])) {
      if (r.responder === "player") continue;
      if (renderedOpinionIds.has(r.responder)) continue;
      renderedOpinionIds.add(r.responder);
      const s = STUDENTS.find((x) => x.id === r.responder);
      if (!s) continue;
      appendMsg({ kind: "student", name: s.name, body: r.text, color: s.color });
    }
    // Stamp grade tags onto the matching past chat messages once grades land.
    for (const g of (round.opinionGrades || [])) {
      if (gradedResponderIds.has(g.responder)) continue;
      gradedResponderIds.add(g.responder);
      stampGradeOnLatestMessage(g, round.bestResponder === g.responder);
    }
  }

  function stampGradeOnLatestMessage(grade, isBest) {
    // Walk the chat log backwards and stamp the most recent body that came
    // from this responder. Cheap heuristic — acceptable for v1.
    const nodes = Array.from(els.stream.querySelectorAll(".msg"));
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i];
      const nameEl = node.querySelector(".head .name");
      if (!nameEl) continue;
      const name = (nameEl.textContent || "").trim();
      const target = grade.responder === "player" ? "You" :
        (STUDENTS.find((s) => s.id === grade.responder)?.name || grade.responder);
      if (name !== target) continue;
      // Avoid double-stamping.
      if (node.querySelector(".grade-tag")) continue;
      const tag = document.createElement("span");
      tag.className = "grade-tag" + (grade.score < 7 ? " bad" : "") + (isBest ? " best" : "");
      tag.title = grade.comment || "";
      tag.textContent = (isBest ? "★ " : "") + grade.score.toFixed(1) + "/10";
      const head = node.querySelector(".head");
      if (head) head.appendChild(tag);
      break;
    }
  }

  async function maybeAutoTriggerGrading(t) {
    if (!t.active_round || t.active_round.type !== "opinion") return;
    if (opinionGradeFired || t.active_round.resolved) return;
    const responseCount = (t.active_round.opinionResponses || []).length;
    const expected = 1 + (t.active_round.npcs || []).length;
    const allIn = responseCount >= expected;
    const expired = (t.active_round.remainingMs ?? 1) <= 0;
    if (!allIn && !expired) return;
    opinionGradeFired = true;
    try {
      const r = await fetch("/api/apps/ruby-high/chat/opinion-submit", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
      await consumeSseStream(r);
    } catch (err) {
      appendSystem("grading failed · " + (err && err.message ? err.message : "error"));
    }
  }

  // ── wire ─────────────────────────────────────────────────────────────────
  els.answers.forEach((btn) => {
    btn.addEventListener("click", () => pickAnswer(btn.dataset.pick, btn));
  });
  els.nextBtn.addEventListener("click", pickNext);
  els.blackboardOpenRails.addEventListener("click", openRails);
  els.blackboardPickNow.addEventListener("click", pickNext);
  els.difficultyFilter.addEventListener("click", (e) => e.stopPropagation());
  els.hamburger.addEventListener("click", toggleRails);
  els.scrim.addEventListener("click", closeRails);
  els.gradePillBtn.addEventListener("click", openRails);
  els.homeBtn.addEventListener("click", openRails);
  els.footerAction.addEventListener("click", () => {
    if (authed) logout();
    else window.open("/api/apps/ruby-high/auth/start", "_blank", "noopener");
  });
  els.chatForm.addEventListener("submit", (e) => { e.preventDefault(); sendChatMessage(els.chatInput.value); });
  els.chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChatMessage(els.chatInput.value); }
  });
  els.chatInput.addEventListener("input", () => {
    els.chatInput.style.height = "40px";
    els.chatInput.style.height = Math.min(140, els.chatInput.scrollHeight) + "px";
  });

  // First boot: open rails on desktop only.
  if (window.matchMedia("(min-width: 1100px)").matches) {
    els.shell.classList.add("is-rails-open");
  } else if (window.matchMedia("(min-width: 720px)").matches) {
    // Tablet: servers rail visible, channels closed.
  }

  applyAuthUI();
  // First-load: if no grade is set, auto-enroll the player as a Junior.
  // (We dropped the year picker UI per the simplified Discord-shape.)
  async function autoEnrollJunior() {
    await fetchSession();
    if (lastTelemetry && !lastTelemetry.current_grade) {
      await command({ type: "select-grade", grade: "11" });
    }
  }

  autoEnrollJunior();
  pollAuth();
  // Adaptive poll: tick every second during an active race so NPC picks
  // land in real time; back off to 4s when idle to save bandwidth.
  let sessionPollHandle = null;
  function adaptiveSchedule() {
    clearTimeout(sessionPollHandle);
    const round = lastTelemetry && lastTelemetry.active_round;
    const fast = round && !round.resolved;
    sessionPollHandle = setTimeout(async () => {
      await fetchSession();
      adaptiveSchedule();
    }, fast ? 750 : 4000);
  }
  adaptiveSchedule();
  setInterval(pollAuth, 3000);
})();
</script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
