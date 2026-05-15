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
  const logoSrc = `${escapeHtml(opts.apiBase)}/assets/logo.png?v=baby-blue-20260504`;
  return `
<div class="shell" id="shell">

  <!-- servers (grades) rail -->
  <aside class="servers-rail" id="servers-rail">
    <button class="server-btn is-home" data-grade="home" id="home-btn" title="Ruby High home">
      <img src="${logoSrc}" alt="" />
    </button>
    <div class="servers-divider"></div>
    <!-- grade buttons injected -->
  </aside>

  <!-- channels rail -->
  <aside class="channels-rail" id="channels-rail">
    <div class="channels-header">
      <img class="school-logo" src="${logoSrc}" alt="Ruby High" />
      <div class="school-context">
        <div class="grade-name" id="grade-title">Ruby High</div>
      </div>
    </div>
    <div class="channels-list" id="channels-list"></div>
    <div class="channels-footer">
      <div class="you-avatar" id="you-avatar">${escapeHtml((opts.agentName || "U").slice(0, 1).toUpperCase())}</div>
      <div class="you-meta">
        <span class="you-name" id="you-name">${safeAgent}</span>
        <span class="you-state" id="you-state">checking…</span>
      </div>
      <!-- Footer action is filled by applyAuthUI(): "Enable AI" in offline
           mode, "Sign out" when an OpenRouter key is active. Hidden when
           a configured local LLM already provides text AI. -->
      <button class="footer-action" id="footer-action" type="button" hidden></button>
    </div>
    <button class="report-bug-link" id="report-bug-link" type="button" title="Something broken? Open an issue on GitHub.">Report a bug</button>
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
        <div class="top"><span class="hash">#</span><span id="channel-title">lounge</span></div>
        <div class="sub" id="channel-sub">loading…</div>
      </div>
      <div class="arc-indicator" id="arc-indicator" hidden>
        <span class="arc-year" id="arc-year">—</span>
        <span class="arc-sep">·</span>
        <span class="arc-streak" id="arc-streak" title="Daily-class streak this year">streak —</span>
        <span class="arc-sep">·</span>
        <span class="arc-xp" id="arc-xp" title="Class standing">— classes</span>
        <span class="arc-sep">·</span>
        <span class="arc-score" id="arc-score" title="Session score">0 score</span>
      </div>
      <button class="pack-btn" id="pack-btn" type="button" title="Content packs" aria-label="Content packs" hidden>
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
        <div id="blackboard-empty-text">Starting Ruby High…</div>
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
      <div class="typed-answer-host" id="typed-answer-host" hidden>
        <form class="typed-answer-form" id="typed-answer-form">
          <input class="typed-answer-input" id="typed-answer-input" type="text" autocomplete="off" placeholder="Type the answer" />
          <button class="typed-submit-btn" id="typed-submit-btn" type="submit">Check</button>
          <button class="typed-mc-btn" id="generate-mc-btn" type="button">MC</button>
        </form>
      </div>
      <div class="race-strip" id="race-strip" hidden>
        <span class="timer-pill" id="timer-pill"><span class="ring"></span><span id="timer-label">25s</span></span>
        <span class="race-row" id="race-row"></span>
      </div>
      <div class="blackboard-foot" id="blackboard-foot" hidden>
      </div>
    </section>

    <section class="stream" id="stream"></section>

    <section class="composer-zone" id="composer-zone">
      <button class="chat-action-btn" id="next-btn" type="button" hidden>Chat</button>
      <form class="composer-form" id="chat-form" hidden aria-hidden="true">
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

<!-- Sign-in fallback. Normal boot creates a guest Ruby High session; this only
     opens if the app cannot establish even that local session. -->
<div class="sheet-overlay is-mandatory" id="signin-overlay" aria-hidden="true">
  <div class="sheet-card signin-card">
    <h2>Welcome to Ruby High</h2>
    <p class="sub">Ruby High can run offline. A local LLM or OpenRouter enables AI chat and AI-assisted imports; OpenRouter is still used for custom portraits.</p>
    <div class="sheet-actions" style="justify-content: center;">
      <a id="signin-cta" class="primary-link" href="/api/apps/ruby-high/auth/start">Enable AI with OpenRouter</a>
    </div>
  </div>
</div>

<!-- Character sheet overlay (creation + profile view). The X-button in
     the corner is the universal close affordance now — per-card "Close"
     buttons are gone. Click anywhere outside .sheet-card also closes. -->
<div class="sheet-overlay" id="sheet-overlay">
  <button class="sheet-close" id="sheet-close" type="button" aria-label="Close">×</button>
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
    <p class="sub" style="margin: 0 0 10px;">Pick a .apkg file. Cards import as typed-answer study cards; subdecks or strong tags become classes. Use the MC button on a card only when you want AI distractors generated and cached.</p>
    <label class="pack-import-field" for="pack-teacher-select">
      <span>Teacher</span>
      <select id="pack-teacher-select"></select>
    </label>
    <input type="file" id="pack-anki-file" accept=".apkg,application/octet-stream" />
    <div id="pack-import-status" class="stat-budget" style="margin-top: 8px; min-height: 16px;"></div>
    <div class="sheet-actions" style="margin-bottom: 0;">
      <button type="button" class="secondary" id="pack-close-btn">Close</button>
      <button type="button" id="pack-import-btn" disabled>Import deck</button>
    </div>
    <hr style="border: 0; border-top: 1px solid var(--line); margin: 16px 0;" />
    <h3 style="margin: 0 0 8px; font-size: 14px;">Import a PDF</h3>
    <p class="sub" style="margin: 0 0 10px;">Pick a .pdf file. The AI reads it and generates typed-answer study cards. Requires your OpenRouter key.</p>
    <label class="pack-import-field" for="pack-pdf-teacher-select">
      <span>Teacher</span>
      <select id="pack-pdf-teacher-select"></select>
    </label>
    <input type="file" id="pack-pdf-file" accept=".pdf,application/pdf" />
    <div id="pack-pdf-status" class="stat-budget" style="margin-top: 8px; min-height: 16px;"></div>
    <div class="sheet-actions">
      <span></span>
      <button type="button" id="pack-pdf-import-btn" disabled>Import PDF</button>
    </div>
  </div>
</div>
`;
}
