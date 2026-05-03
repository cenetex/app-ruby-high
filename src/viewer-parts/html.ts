import type { ViewerRenderOptions } from "../viewer.js";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// HTML body for the SPA viewer. Threads only the runtime opts that vary
// per session — apiBase (for asset URLs) and agentName (for the
// you-card). Everything else is static markup; behavior lives in the
// extracted script module.
export function viewerHtmlBody(opts: ViewerRenderOptions): string {
  const safeAgent = escapeHtml(opts.agentName);
  return `
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
        <div class="sub" id="channel-sub">loading…</div>
      </div>
      <div class="arc-indicator" id="arc-indicator" hidden>
        <span class="arc-year" id="arc-year">—</span>
        <span class="arc-sep">·</span>
        <span class="arc-streak" id="arc-streak" title="Daily streak this year">streak —</span>
        <span class="arc-sep">·</span>
        <span class="arc-xp" id="arc-xp" title="Cumulative XP">— XP</span>
      </div>
      <button class="pack-btn" id="pack-btn" type="button" title="Content packs" aria-label="Content packs">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 12l9 4 9-4"/><path d="M3 17l9 4 9-4"/>
        </svg>
      </button>
    </header>

    <section class="lounge-stage" id="lounge-stage">
      <div class="lounge-title">Teachers' Lounge — listening in</div>
      <div class="lounge-figures" id="lounge-figures">
        <!-- Populated by renderLoungeFigures() from the active pack's
             faculty roster. A pre-init dummy keeps the layout from
             collapsing before the first telemetry tick. -->
      </div>
    </section>

    <section class="blackboard-panel is-empty" id="blackboard-panel">
      <div class="blackboard-empty" id="blackboard-empty">
        <div id="blackboard-empty-text">The teacher will write a question on the board in a moment.</div>
        <button class="daily-cta-btn" id="daily-cta-btn" type="button" hidden>Take today's challenge</button>
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
        <div class="advantage-bar" id="advantage-bar" hidden>
          <button class="advantage-btn" id="advantage-btn" type="button">🎲 Roll for advantage</button>
          <span class="advantage-result" id="advantage-result" hidden></span>
        </div>
      </div>
      <div class="race-strip" id="race-strip" hidden>
        <span class="timer-pill" id="timer-pill"><span class="ring"></span><span id="timer-label">25s</span></span>
        <span class="race-row" id="race-row"></span>
      </div>
      <div class="blackboard-foot" id="blackboard-foot" hidden>
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
      <div class="checking" id="checking" hidden>checking…</div>
    </section>
  </main>

  <div class="scrim" id="scrim"></div>
</div>

<div class="congrats-toast" id="congrats-toast" aria-live="polite"></div>
<div class="xp-burst" id="xp-burst" aria-live="polite"></div>

<!-- Character sheet overlay (creation + profile view) -->
<div class="sheet-overlay" id="sheet-overlay">
  <div class="sheet-card" id="sheet-card"></div>
</div>

<!-- Content-pack store overlay -->
<div class="sheet-overlay" id="pack-overlay">
  <div class="sheet-card" id="pack-card">
    <h2>Content packs</h2>
    <p class="sub">Switch which curriculum the school is teaching. Pre-bundled packs are listed below; you can also import your own Anki deck (.apkg). Imports are private — only you see your own decks.</p>
    <div class="pack-list" id="pack-list"></div>
    <hr style="border: 0; border-top: 1px solid var(--line); margin: 16px 0;" />
    <h3 style="margin: 0 0 8px; font-size: 14px;">Import an Anki deck</h3>
    <p class="sub" style="margin: 0 0 10px;">Pick a .apkg file. The first ~50 cards become MC questions; distractors are generated by your OpenRouter key. Costs ~$0.05.</p>
    <input type="file" id="pack-anki-file" accept=".apkg,application/octet-stream" />
    <div id="pack-import-status" class="stat-budget" style="margin-top: 8px; min-height: 16px;"></div>
    <div class="sheet-actions">
      <button type="button" class="secondary" id="pack-close-btn">Close</button>
      <button type="button" id="pack-import-btn" disabled>Import deck</button>
    </div>
  </div>
</div>
`;
}
