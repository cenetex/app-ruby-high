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
      <!-- Legacy footer action placeholder. Account now owns AI controls. -->
      <button class="footer-action" id="footer-action" type="button" hidden></button>
      <button class="footer-action account-action" id="privy-action" type="button" hidden>Account</button>
    </div>
    <button class="report-bug-link" id="report-bug-link" type="button" title="Something broken? Send a bug report.">Report a bug</button>
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
        <span class="arc-streak" id="arc-streak" title="Passed daily classes needed for this year">— daily classes</span>
        <span class="arc-sep">·</span>
        <span class="arc-xp" id="arc-xp" title="Subjects cleared with a C or better this year">— subjects cleared</span>
        <span class="arc-sep">·</span>
        <span class="arc-score" id="arc-score" title="Merit Stars and Hall Passes">0 Merit Stars · 0 Hall Passes</span>
      </div>
      <button class="hall-pass-btn" id="hall-pass-btn" type="button" title="Account" aria-label="Open account" hidden>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M2 9a3 3 0 0 0 0 6v3a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-3a3 3 0 0 0 0-6V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2z"/>
          <path d="M13 5v2"/><path d="M13 17v2"/><path d="M13 11v2"/>
        </svg>
      </button>
      <button class="pack-btn" id="pack-btn" type="button" title="Edit pack" aria-label="Edit pack" hidden>
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
        <button class="blackboard-empty-action" id="blackboard-empty-action" type="button" hidden>Create Character</button>
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

<div class="app-confirm-overlay" id="app-confirm-overlay" aria-hidden="true" hidden>
  <div class="app-confirm-card" role="dialog" aria-modal="true" aria-labelledby="app-confirm-title" aria-describedby="app-confirm-copy">
    <div class="app-confirm-kicker" id="app-confirm-kicker">Confirm</div>
    <h2 id="app-confirm-title">Continue?</h2>
    <p id="app-confirm-copy"></p>
    <p class="app-confirm-detail" id="app-confirm-detail" hidden></p>
    <div class="app-confirm-actions">
      <button type="button" class="secondary" id="app-confirm-cancel">Cancel</button>
      <button type="button" class="primary" id="app-confirm-ok">Continue</button>
    </div>
  </div>
</div>

<!-- Sign-in fallback. Normal boot creates a guest Ruby High session; this only
     opens if the app cannot establish even that local session. -->
<div class="sheet-overlay is-mandatory" id="signin-overlay" aria-hidden="true">
  <div class="sheet-card signin-card">
    <h2>Welcome to Ruby High</h2>
    <p class="sub">Play free, use Hall Passes for hosted AI, or bring your own AI key.</p>
    <div class="sheet-actions" style="justify-content: center;">
      <button id="signin-guest" class="primary-link" type="button">Continue without AI</button>
      <button id="signin-privy" class="secondary-link" type="button" hidden>Sign in</button>
      <a id="signin-cta" class="secondary-link" href="/api/apps/ruby-high/auth/start">Use AI key</a>
    </div>
    <div id="signin-status" class="stat-budget" aria-live="polite"></div>
  </div>
</div>

  <!-- Account overlay -->
  <div class="sheet-overlay" id="privy-overlay">
    <button class="sheet-close" id="privy-close" type="button" aria-label="Close">×</button>
  <div class="sheet-card privy-card account-card">
    <div class="account-header-row">
      <h2>Account</h2>
      <div class="account-identity-inline">
        <div class="wallet-panel" id="privy-wallet">Guest session</div>
        <div class="sheet-actions">
          <button type="button" id="privy-login-widget">Sign in with Privy</button>
          <button type="button" class="secondary" id="privy-signout" hidden>Sign out</button>
        </div>
      </div>
    </div>
    <div class="account-tabs" role="tablist" aria-label="Account areas">
      <button type="button" class="account-tab is-active" id="account-tab-account" data-account-tab="account" role="tab" aria-selected="true" aria-controls="account-panel-account">Account</button>
      <button type="button" class="account-tab" id="account-tab-wallet" data-account-tab="wallet" role="tab" aria-selected="false" aria-controls="account-panel-wallet">Wallet</button>
      <button type="button" class="account-tab" id="account-tab-cards" data-account-tab="cards" role="tab" aria-selected="false" aria-controls="account-panel-cards">Cards</button>
      <button type="button" class="account-tab" id="account-tab-library" data-account-tab="library" role="tab" aria-selected="false" aria-controls="account-panel-library">Library</button>
      <button type="button" class="account-tab" id="account-tab-receipts" data-account-tab="receipts" role="tab" aria-selected="false" aria-controls="account-panel-receipts">Receipts</button>
      <button type="button" class="account-tab" id="account-tab-trust" data-account-tab="trust" role="tab" aria-selected="false" aria-controls="account-panel-trust">Trust</button>
    </div>
    <div class="account-workspace">
      <div class="account-panel is-active" id="account-panel-account" data-account-panel="account" role="tabpanel" aria-labelledby="account-tab-account">
        <section class="account-section account-character-section">
          <div class="account-section-head">
            <div>
              <div class="account-section-title">Characters</div>
              <div class="account-section-sub" id="account-character-summary"></div>
            </div>
            <div class="account-section-actions">
              <button type="button" id="account-create-character">Create Character</button>
              <button type="button" class="secondary" id="account-unlock-slot">Unlock Slot</button>
            </div>
          </div>
          <div class="account-character-grid" id="account-character-grid"></div>
        </section>
      </div>
      <div class="account-panel" id="account-panel-wallet" data-account-panel="wallet" role="tabpanel" aria-labelledby="account-tab-wallet" hidden>
        <section class="account-section account-wallet-section">
          <div class="account-section-head">
            <div>
              <div class="account-section-title">Wallet</div>
            </div>
            <div class="account-section-actions">
              <button type="button" id="account-buy-passes">Buy Hall Passes</button>
            </div>
          </div>
          <div class="account-wallet-balance" id="account-wallet-balance">0 Merit Stars · 0 Hall Passes</div>
          <div class="account-wallet-meta" id="account-wallet-meta"></div>
          <div class="account-wallet-rules">
            <div><strong>Hall Passes</strong><span>Hosted AI, images, and creator tools.</span></div>
            <div><strong>Wallet ledger</strong><span>Purchases and NFT actions settle here.</span></div>
          </div>
        </section>
        <section class="account-section account-ai-section">
          <div class="account-section-title">AI Access</div>
          <div class="account-ai-status" id="account-ai-status">Checking...</div>
          <div class="account-ai-meta" id="account-ai-meta"></div>
          <div class="sheet-actions">
            <button type="button" id="account-ai-use-pass">Use Hall Pass</button>
            <button type="button" class="secondary" id="account-ai-action">Connect AI key</button>
          </div>
        </section>
      </div>
      <div class="account-panel" id="account-panel-cards" data-account-panel="cards" role="tabpanel" aria-labelledby="account-tab-cards" hidden>
        <section class="account-section account-hall-pass-card-section">
          <div class="account-section-head">
            <div>
              <div class="account-section-title">Cards</div>
              <div class="account-section-sub" id="account-card-summary"></div>
            </div>
            <div class="account-section-actions">
              <button type="button" id="account-buy-card-packs">Buy Card Packs</button>
              <button type="button" class="secondary" id="account-mint-cards">Reveal Card</button>
            </div>
          </div>
          <div class="account-hall-pass-cards" id="account-hall-pass-cards"></div>
        </section>
      </div>
      <div class="account-panel" id="account-panel-library" data-account-panel="library" role="tabpanel" aria-labelledby="account-tab-library" hidden>
        <section class="account-section account-comics-section">
          <div class="account-section-head">
            <div>
              <div class="account-section-title">Comics</div>
              <div class="account-section-sub" id="account-comic-summary"></div>
            </div>
          </div>
          <div id="account-comics"></div>
        </section>
      </div>
      <div class="account-panel" id="account-panel-receipts" data-account-panel="receipts" role="tabpanel" aria-labelledby="account-tab-receipts" hidden>
        <section class="account-section account-receipts-section">
          <div class="account-section-title">Receipts</div>
          <div class="account-section-sub">Purchases, grants, burns, spends, mints, and refunds.</div>
          <div class="account-history-list" id="account-history-list"></div>
        </section>
      </div>
      <div class="account-panel" id="account-panel-trust" data-account-panel="trust" role="tabpanel" aria-labelledby="account-tab-trust" hidden>
        <section class="account-section account-trust-section">
          <div class="account-section-title">Trust</div>
          <div class="account-section-sub">Official links, wallet safety, and current on-chain configuration.</div>
          <div class="account-trust-list" id="account-trust-list"></div>
        </section>
      </div>
    </div>
    <div id="privy-status" class="stat-budget" aria-live="polite"></div>
    </div>
</div>

<!-- Character sheet overlay (creation + profile view). The X-button in
     the corner is the universal close affordance now — per-card "Close"
     buttons are gone. Click anywhere outside .sheet-card also closes. -->
<div class="sheet-overlay" id="sheet-overlay">
  <button class="sheet-close" id="sheet-close" type="button" aria-label="Close">×</button>
  <div class="sheet-card" id="sheet-card"></div>
</div>

<!-- Billing overlay -->
<div class="sheet-overlay" id="billing-overlay">
  <button class="sheet-close" id="billing-close" type="button" aria-label="Close">×</button>
  <div class="sheet-card billing-card">
    <h2 id="billing-title">Buy Hall Passes</h2>
    <p class="sub" id="billing-sub">Buy Hall Passes or burn one Card for 5.</p>
    <div class="wallet-panel" id="billing-wallet">0 Hall Passes · 0 Cards</div>
    <div class="billing-costs" id="billing-costs"></div>
    <div class="billing-products" id="billing-products"></div>
    <div id="billing-status" class="stat-budget" aria-live="polite"></div>
  </div>
</div>

<!-- Bug report overlay -->
<div class="sheet-overlay" id="bug-report-overlay">
  <button class="sheet-close" id="bug-report-close" type="button" aria-label="Close">×</button>
  <form class="sheet-card is-bug-report-sheet" id="bug-report-form">
    <h2>Report a bug</h2>
    <p class="sub">Send the current Ruby High context to the private issue tracker.</p>
    <div class="field">
      <label for="bug-report-text">What broke?</label>
      <textarea id="bug-report-text" rows="5" maxlength="4000" placeholder="What happened, and what did you expect?"></textarea>
    </div>
    <div class="bug-report-context">Recent console errors and classroom context will be included.</div>
    <div class="stat-budget" id="bug-report-status" aria-live="polite"></div>
    <div class="sheet-actions">
      <button type="button" class="secondary" id="bug-report-cancel">Cancel</button>
      <button type="submit" id="bug-report-submit">Send report</button>
    </div>
  </form>
</div>

<!-- Pack editor overlay -->
<div class="sheet-overlay" id="pack-overlay">
  <div class="sheet-card" id="pack-card">
    <h2>Guest Faculty</h2>
    <p class="sub">Ruby High is always on. Pick this week's guest teacher automatically or set your own from creator packs.</p>
    <div class="pack-library-actions">
      <button type="button" class="pack-action" id="pack-auto-btn">Auto Guest</button>
      <button type="button" class="pack-action" id="pack-create-btn">+ Create New Content Pack</button>
    </div>
    <div class="pack-section-title">Ruby High and guest</div>
    <div class="pack-grid" id="pack-list"></div>
    <div class="pack-section-title">Find creator packs</div>
    <div class="pack-search-row">
      <input type="search" id="pack-search-input" placeholder="Search any course content" autocomplete="off" />
      <button type="button" class="pack-action" id="pack-search-btn">Search</button>
    </div>
    <div class="pack-grid" id="pack-search-list"></div>
    <div class="pack-section-title">Draft packs</div>
    <div class="pack-grid" id="pack-draft-list"></div>
    <div class="pack-import-panel" id="pack-import-panel" hidden>
      <div class="pack-import-title" id="pack-import-title">Working</div>
      <div class="pack-import-detail" id="pack-import-detail">Ruby High is updating your library.</div>
      <div class="pack-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-label="Pack update progress">
        <div class="pack-progress-fill" id="pack-progress-fill"></div>
      </div>
    </div>
    <div id="pack-status" class="stat-budget" style="margin-top: 8px; min-height: 16px;"></div>
    <div class="sheet-actions">
      <button type="button" class="secondary" id="pack-close-btn">Close</button>
    </div>
  </div>
</div>

<div class="sheet-overlay" id="pack-edit-overlay">
  <div class="sheet-card pack-edit-card" id="pack-edit-card">
    <h2 id="pack-edit-title">Edit pack</h2>
    <p class="sub" id="pack-edit-subtitle">Draft content pack.</p>
    <div class="pack-editor">
      <section class="pack-course-generator" id="pack-course-generator" hidden>
        <textarea id="course-materials-input" rows="10" maxlength="80000" placeholder="Add course materials here"></textarea>
        <div class="pack-course-generator-actions">
          <button type="button" class="pack-action" id="course-generate-btn">Generate Course</button>
          <button type="button" class="pack-action danger" id="course-cancel-generation-btn" hidden>Cancel</button>
          <span class="pack-question-status" id="course-generation-status"></span>
        </div>
      </section>
      <div class="course-generation-progress" id="course-generation-progress" hidden>
        <div class="pack-progress" id="course-progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-label="Course generation progress">
          <div class="pack-progress-fill" id="course-progress-fill"></div>
        </div>
        <div class="course-generation-checklist" id="course-generation-checklist"></div>
      </div>
      <aside class="pack-teacher-sidebar">
        <div class="pack-section-title">Teachers</div>
        <div class="pack-list pack-teacher-list" id="pack-teacher-list"></div>
      </aside>
      <section class="pack-editor-main">
        <div class="pack-teacher-detail" id="pack-teacher-detail"></div>
        <div class="pack-editor-tabs" role="tablist">
          <button type="button" class="pack-editor-tab is-active" data-pack-tab="materials">Materials</button>
          <button type="button" class="pack-editor-tab" data-pack-tab="questions">Questions</button>
          <button type="button" class="pack-editor-tab" data-pack-tab="settings">Settings</button>
        </div>
        <div class="pack-tab-panel is-active" id="pack-tab-materials">
          <div class="teacher-creator">
            <input id="teacher-material-url-input" type="url" placeholder="GitHub markdown URL">
            <button type="button" class="secondary" id="teacher-load-url-btn">Load URL</button>
            <textarea id="teacher-materials-input" rows="8" maxlength="80000" placeholder="Paste markdown or course materials"></textarea>
          </div>
        </div>
        <div class="pack-tab-panel" id="pack-tab-questions">
          <div class="pack-question-toolbar">
            <button type="button" class="pack-action" id="teacher-generate-questions-btn">Generate More Questions</button>
            <button type="button" class="pack-action danger" id="teacher-cancel-generation-btn" hidden>Cancel</button>
            <span class="pack-question-status" id="teacher-generation-status"></span>
          </div>
          <div class="pack-question-list" id="teacher-question-list"></div>
        </div>
        <div class="pack-tab-panel" id="pack-tab-settings">
          <div class="teacher-creator">
            <div class="teacher-creator-row">
              <input id="teacher-display-name-input" type="text" placeholder="Teacher display name">
              <input id="teacher-socials-input" type="url" placeholder="Socials link">
            </div>
            <input id="teacher-profile-image-input" type="url" placeholder="Profile image URL">
            <textarea id="teacher-persona-input" rows="4" maxlength="2400" placeholder="Teaching style or persona"></textarea>
          </div>
        </div>
      </section>
    </div>
    <div id="pack-edit-status" class="stat-budget" style="margin-top: 8px; min-height: 16px;"></div>
    <div class="sheet-actions">
      <button type="button" class="secondary" id="pack-edit-close-btn">Close</button>
      <button type="button" class="secondary" id="pack-publish-btn">Publish Course (3 Hall Passes)</button>
    </div>
  </div>
</div>
`;
}
