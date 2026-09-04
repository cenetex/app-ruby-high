import type { ViewerRenderOptions } from "../viewer-shell.js";

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
  const safeApiBase = escapeHtml(opts.apiBase);
  const build = (opts.build ?? "dev").trim();
  const assetVersion = build && build !== "dev" ? `?v=${encodeURIComponent(build)}` : "";
  const crestLogoSrc = `${safeApiBase}/assets/optimized/ruby-high-app-icon.webp${assetVersion}`;
  const wordmarkLogoSrc = `${safeApiBase}/assets/optimized/ruby-high-logo.webp${assetVersion}`;
  return `
<div class="shell" id="shell">

  <!-- servers (grades) rail -->
  <aside class="servers-rail" id="servers-rail">
    <button class="server-btn is-home" data-grade="home" id="home-btn" title="Ruby High home">
      <img src="${crestLogoSrc}" alt="" width="128" height="128" />
    </button>
    <div class="servers-divider"></div>
    <!-- grade buttons injected -->
  </aside>

  <!-- channels rail -->
  <aside class="channels-rail" id="channels-rail" aria-label="School navigation">
    <div class="channels-header">
      <button class="channels-close" id="channels-close" type="button" aria-label="Close navigation">
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
          <path d="M6 6l12 12"/><path d="M18 6L6 18"/>
        </svg>
      </button>
      <img class="school-logo" src="${wordmarkLogoSrc}" alt="Ruby High" width="970" height="815" />
      <div class="school-context">
        <div class="grade-name" id="grade-title">Ruby High</div>
      </div>
    </div>
    <div class="channels-list" id="channels-list"></div>
    <div class="channels-footer">
      <button class="you-profile" id="you-profile" type="button" aria-label="Open student card">
        <span class="you-avatar" id="you-avatar">${escapeHtml((opts.agentName || "U").slice(0, 1).toUpperCase())}</span>
        <span class="you-meta">
          <span class="you-name" id="you-name">${safeAgent}</span>
          <span class="you-state" id="you-state">checking…</span>
        </span>
      </button>
      <!-- Legacy footer action placeholder. Account now owns AI controls. -->
      <button class="footer-action" id="footer-action" type="button" hidden></button>
      <button class="footer-action account-action" id="privy-action" type="button" hidden>Account</button>
    </div>
    <div class="channels-links">
      <a class="report-bug-link" id="report-bug-link" href="https://discord.gg/uTXaBVfY" target="_blank" rel="noopener noreferrer" data-discord-link="true" title="Bugs or questions? Join the Ruby High Discord.">Bugs / questions</a>
      <a class="report-bug-link" id="about-link" href="https://annihilism.org" target="_blank" rel="noopener noreferrer" title="The philosophy behind Ruby High.">About</a>
      <a class="report-bug-link" id="books-link" href="https://ratimics.gumroad.com" target="_blank" rel="noopener noreferrer" title="Books by the Ruby High author.">Books</a>
    </div>
  </aside>

  <!-- workspace -->
  <main class="workspace" id="workspace">
    <header class="top-bar">
      <button class="hamburger" id="hamburger" type="button" aria-label="Open navigation" aria-controls="channels-rail" aria-expanded="false">
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
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
        <span class="arc-streak" id="arc-streak" title="Passed daily classes needed for this year">📚 —</span>
        <span class="arc-sep">·</span>
        <span class="arc-xp" id="arc-xp" title="Subjects cleared with a C or better this year">✅ —</span>
        <span class="arc-sep" id="arc-essay-sep" hidden>·</span>
        <span class="arc-essay" id="arc-essay" title="Final response board required before graduation" hidden>🧩 due</span>
      </div>
    </header>

    <nav class="mobile-view-toggle" id="mobile-view-toggle" aria-label="Classroom view" role="tablist" hidden>
      <button type="button" role="tab" data-mobile-view="challenge" aria-selected="true" aria-controls="blackboard-panel">Challenge</button>
      <button type="button" role="tab" data-mobile-view="chat" aria-selected="false" aria-controls="stream" tabindex="-1">Chat</button>
    </nav>

    <section class="lounge-stage" id="lounge-stage">
      <div class="lounge-title">Teachers' Lounge — listen in</div>
      <div class="lounge-figures" id="lounge-figures">
        <!-- Populated by renderLoungeFigures() from the active pack's
             faculty roster. A pre-init dummy keeps the layout from
             collapsing before the first telemetry tick. -->
      </div>
    </section>

    <section class="blackboard-panel is-empty" id="blackboard-panel">
      <div class="blackboard-empty" id="blackboard-empty">
        <div class="onboarding-hero" aria-hidden="true">
          <div class="onboarding-hero-copy">
            <span class="onboarding-kicker">First bell</span>
            <img class="onboarding-wordmark" src="${wordmarkLogoSrc}" alt="" width="970" height="815" fetchpriority="high" />
            <span class="onboarding-hero-line">Your story starts in homeroom.</span>
          </div>
          <img class="onboarding-ruby" src="${safeApiBase}/assets/teachers/ruby-full-sticker.png?v=first-bell-20260823" alt="" width="150" height="512" fetchpriority="high" />
        </div>
        <div id="blackboard-empty-text">
          <div class="onboarding-title">Ruby High</div>
          <div class="onboarding-sub">Create a student and answer your first question.</div>
          <div class="onboarding-detail">Ruby and your classmates are ready. Your choices become part of your yearbook.</div>
        </div>
        <button class="blackboard-empty-action" id="blackboard-empty-action" type="button" hidden>Create Student</button>
        <div class="onboarding-actions" id="onboarding-actions" hidden>
          <button class="blackboard-empty-action" id="onboarding-create-btn" type="button">Create my student</button>
          <div class="onboarding-reassurance">Free · no sign-up needed · starts now</div>
        </div>
      </div>

      <ol class="daily-class-progress" id="daily-class-progress" aria-label="Today's class progress" hidden></ol>
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
          <button class="advantage-btn" id="advantage-btn" type="button" title="Use one roll for help with this question">🎲 Roll for help</button>
          <span class="advantage-result" id="advantage-result" hidden></span>
        </div>
      </div>
      <div class="typed-answer-host" id="typed-answer-host" hidden>
        <div class="labyrinth-action-form" id="labyrinth-action-form" hidden>
          <strong>What would you do?</strong>
          <div class="labyrinth-attribute-grid" id="labyrinth-attribute-grid" aria-label="Choose an approach"></div>
          <div class="labyrinth-exit-grid" id="labyrinth-exit-grid" aria-label="Visible passages"></div>
          <p>Attributes are approaches, not answers. Passages change your position without completing a room.</p>
        </div>
        <form class="typed-answer-form" id="typed-answer-form">
          <div class="response-builder" id="response-builder" data-active-group="claim">
            <nav class="response-stepper" aria-label="Response steps">
              <button type="button" data-response-step="claim" aria-current="step"><span>1</span><strong>Claim</strong></button>
              <button type="button" data-response-step="stance" disabled><span>2</span><strong>Position</strong></button>
              <button type="button" data-response-step="evidence" disabled><span>3</span><strong>Evidence</strong></button>
              <button type="button" data-response-step="impact" disabled><span>4</span><strong>Impact</strong></button>
            </nav>
            <div class="response-stage">
            <fieldset class="response-card-group" data-response-group="claim">
              <legend class="visually-hidden">Claim</legend>
              <div class="response-card-grid response-claim-grid">
                <button type="button" data-response-card data-group="claim" data-value="" hidden><span aria-hidden="true">1</span><strong>—</strong><small>—</small><i class="response-option-check" aria-hidden="true">✓</i></button>
                <button type="button" data-response-card data-group="claim" data-value="" hidden><span aria-hidden="true">2</span><strong>—</strong><small>—</small><i class="response-option-check" aria-hidden="true">✓</i></button>
              </div>
            </fieldset>
            <fieldset class="response-card-group" data-response-group="stance" hidden>
              <legend class="visually-hidden">Position</legend>
              <div class="response-card-grid">
                <button type="button" data-response-card data-group="stance" data-value="support" data-short="Mostly yes"><span aria-hidden="true">✓</span><strong>Mostly yes</strong><small>Supports claim</small><i class="response-option-check" aria-hidden="true">✓</i></button>
                <button type="button" data-response-card data-group="stance" data-value="challenge" data-short="Challenge it"><span aria-hidden="true">×</span><strong>Challenge it</strong><small>Missing context</small><i class="response-option-check" aria-hidden="true">✓</i></button>
                <button type="button" data-response-card data-group="stance" data-value="conditional" data-short="It depends"><span aria-hidden="true">◇</span><strong>It depends</strong><small>Context matters</small><i class="response-option-check" aria-hidden="true">✓</i></button>
              </div>
            </fieldset>
            <fieldset class="response-card-group" data-response-group="evidence" hidden>
              <legend class="visually-hidden">Evidence</legend>
              <div class="response-card-grid">
                <button type="button" data-response-card data-group="evidence" data-value="cause" data-short="Cause & effect"><span aria-hidden="true">↗</span><strong>Cause &amp; effect</strong><small>What changed</small><i class="response-option-check" aria-hidden="true">✓</i></button>
                <button type="button" data-response-card data-group="evidence" data-value="compare" data-short="Compare"><span aria-hidden="true">⇄</span><strong>Compare</strong><small>Two examples</small><i class="response-option-check" aria-hidden="true">✓</i></button>
                <button type="button" data-response-card data-group="evidence" data-value="source" data-short="Source check"><span aria-hidden="true">⌕</span><strong>Source check</strong><small>Missing proof</small><i class="response-option-check" aria-hidden="true">✓</i></button>
              </div>
            </fieldset>
            <fieldset class="response-card-group" data-response-group="impact" hidden>
              <legend class="visually-hidden">Impact</legend>
              <div class="response-card-grid">
                <button type="button" data-response-card data-group="impact" data-value="people" data-short="People"><span aria-hidden="true">♥</span><strong>People</strong><small>Human effect</small><i class="response-option-check" aria-hidden="true">✓</i></button>
                <button type="button" data-response-card data-group="impact" data-value="systems" data-short="Systems"><span aria-hidden="true">▦</span><strong>Systems</strong><small>Rules &amp; structures</small><i class="response-option-check" aria-hidden="true">✓</i></button>
                <button type="button" data-response-card data-group="impact" data-value="future" data-short="Future"><span aria-hidden="true">◷</span><strong>Future</strong><small>Long-term effect</small><i class="response-option-check" aria-hidden="true">✓</i></button>
              </div>
            </fieldset>
            </div>
            <div class="response-builder-actions">
              <div class="visually-hidden" id="response-build-status" aria-live="polite">Claim</div>
              <button class="typed-submit-btn" id="typed-submit-btn" type="submit" disabled>Submit</button>
            </div>
          </div>
          <button class="typed-mc-btn" id="generate-mc-btn" type="button">Choices</button>
        </form>
      </div>
      <div class="race-strip" id="race-strip" hidden>
        <span class="timer-pill" id="timer-pill"><span class="ring"></span><span id="timer-label">25s</span></span>
        <span class="race-row" id="race-row"></span>
      </div>
      <div class="blackboard-foot" id="blackboard-foot" hidden>
      </div>
    </section>

    <section class="leaderboard-panel" id="leaderboard-panel" aria-labelledby="leaderboard-title" hidden>
      <div class="leaderboard-header">
        <div class="leaderboard-header-icon">🏆</div>
        <div class="leaderboard-header-text">
          <h2 class="leaderboard-title" id="leaderboard-title">Honor Roll</h2>
          <p class="leaderboard-sub">Top students by year — updated live.</p>
        </div>
        <button class="leaderboard-back" id="leaderboard-back" type="button">Back to class</button>
      </div>
      <div class="leaderboard-body" id="leaderboard-body" aria-live="polite">
        <div class="leaderboard-loading">Loading…</div>
      </div>
    </section>

    <section class="stream" id="stream" aria-live="polite" aria-atomic="false"></section>

    <section class="composer-zone" id="composer-zone">
      <button class="chat-action-btn" id="next-btn" type="button" hidden>Chat</button>
      <form class="composer-form" id="chat-form" hidden aria-hidden="true">
        <textarea id="chat-input" rows="1" placeholder="Message — the teacher and class can hear you" disabled></textarea>
        <button type="submit" class="send-btn" id="chat-send" disabled aria-label="Send">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
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
<!-- Morning Announcements — PA-system intro shown once per visit -->
<div class="announcements-overlay" id="announcements-overlay" role="dialog" aria-modal="true" aria-label="Morning Announcements" hidden>
  <div class="announcements-panel">
    <div class="announcements-header">
      <img class="announcements-logo" id="announcements-logo" src="${crestLogoSrc}" alt="Ruby High" />
      <div class="announcements-date" id="announcements-date"></div>
    </div>
    <h2 class="announcements-title" id="announcements-title">Morning Announcements</h2>
    <div class="announcements-body" id="announcements-body"></div>
    <div class="announcements-notes" id="announcements-notes"></div>
    <div class="announcements-actions">
      <a class="announcements-link" id="announcements-about" href="https://annihilism.org" target="_blank" rel="noopener noreferrer">About</a>
      <a class="announcements-link" id="announcements-books" href="https://ratimics.gumroad.com" target="_blank" rel="noopener noreferrer">Books</a>
      <button class="announcements-dismiss" id="announcements-dismiss" type="button">Take your seat</button>
    </div>
  </div>
</div>

<div class="sheet-overlay is-mandatory" id="signin-overlay" role="dialog" aria-modal="true" aria-labelledby="signin-title" aria-hidden="true">
  <div class="sheet-card signin-card">
    <h2 id="signin-title">Welcome to Ruby High</h2>
    <p class="sub">Play classes for free. Merit Stars pay for teacher chat. Hall Passes pay for images, extra students, and collectible cards.</p>
    <div class="sheet-actions" style="justify-content: center;">
      <button id="signin-guest" class="primary-link" type="button">Continue free</button>
      <button id="signin-privy" class="secondary-link" type="button">Sign in with a passkey</button>
      <a id="signin-cta" class="secondary-link" href="/api/apps/ruby-high/auth/start">Use my AI key</a>
    </div>
    <div id="signin-status" class="stat-budget" aria-live="polite"></div>
  </div>
</div>

  <!-- Account overlay -->
  <div class="sheet-overlay" id="privy-overlay" role="dialog" aria-modal="true" aria-labelledby="account-title" aria-hidden="true">
    <button class="sheet-close" id="privy-close" type="button" aria-label="Close">×</button>
  <div class="sheet-card privy-card account-card">
    <div class="account-header-row">
      <h2 id="account-title">Account</h2>
      <div class="account-identity-inline">
        <div class="wallet-panel" id="privy-wallet">Guest session</div>
        <div class="sheet-actions">
          <button type="button" id="passkey-action">Sign in with a passkey</button>
          <button type="button" class="secondary" id="passkey-create">Save progress with a passkey</button>
          <button type="button" class="secondary" id="privy-login-widget" hidden>Connect wallet</button>
          <button type="button" class="secondary" id="privy-signout" hidden>Sign out</button>
        </div>
      </div>
    </div>
    <p class="sub account-passkey-copy">Use Touch ID, Face ID, Windows Hello, your phone, or a security key. Ruby High stores your public key. Your passkey manager protects the private key.</p>
    <div class="account-tabs" role="tablist" aria-label="Account areas">
      <button type="button" class="account-tab is-active" id="account-tab-account" data-account-tab="account" role="tab" aria-selected="true" aria-controls="account-panel-account">Profile</button>
      <button type="button" class="account-tab" id="account-tab-wallet" data-account-tab="wallet" role="tab" aria-selected="false" aria-controls="account-panel-wallet">Passes</button>
      <button type="button" class="account-tab" id="account-tab-library" data-account-tab="library" role="tab" aria-selected="false" aria-controls="account-panel-library">Library</button>
    </div>
    <div class="account-workspace">
      <div class="account-panel is-active" id="account-panel-account" data-account-panel="account" role="tabpanel" aria-labelledby="account-tab-account">
        <section class="account-section account-character-section">
          <div class="account-section-head">
            <div>
              <div class="account-section-title">Students</div>
              <div class="account-section-sub" id="account-character-summary"></div>
            </div>
            <div class="account-section-actions">
              <button type="button" id="account-create-character">Create Student</button>
              <button type="button" class="secondary" id="account-unlock-slot">Add Student Slot</button>
            </div>
          </div>
          <div class="account-character-grid" id="account-character-grid"></div>
        </section>
        <section class="account-section account-security-section" id="account-security-section">
          <div class="account-section-head">
            <div>
              <div class="account-section-title">Passkey security</div>
              <div class="account-section-sub" id="passkey-security-summary">Save your progress across devices.</div>
            </div>
            <div class="account-section-actions">
              <button type="button" class="secondary" id="passkey-recovery-create" hidden>New recovery code</button>
            </div>
          </div>
          <label class="passkey-autofill-field" id="passkey-autofill-label">
            <span>Passkey account</span>
            <input id="passkey-autofill" name="username" type="text" autocomplete="username webauthn" placeholder="Choose a saved passkey" />
          </label>
          <div class="passkey-list" id="passkey-list"></div>
          <div class="passkey-recovery-card" id="passkey-recovery-card">
            <label for="passkey-recovery-input">Lost access? Enter your recovery code.</label>
            <div class="passkey-recovery-actions">
              <input id="passkey-recovery-input" type="text" inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXXX-XXXXX-XXXXX-XXXXX" />
              <button type="button" class="secondary" id="passkey-recovery-submit">Recover account</button>
            </div>
          </div>
          <div class="passkey-recovery-code" id="passkey-recovery-code" hidden>
            <strong>Save this recovery code now</strong>
            <p>Keep it in a password manager. It works once. A recovery creates a fresh code.</p>
            <code id="passkey-recovery-value"></code>
            <div class="account-section-actions">
              <button type="button" class="secondary" id="passkey-recovery-copy">Copy code</button>
              <button type="button" class="secondary" id="passkey-recovery-download">Download</button>
            </div>
          </div>
        </section>
        <section class="account-section account-public-world-section">
          <div class="account-section-head">
            <div>
              <div class="account-section-title">Show My Student</div>
              <div class="account-section-sub" id="account-public-world-summary"></div>
            </div>
            <div class="account-section-actions">
              <button type="button" class="secondary" id="account-public-world-toggle">Show</button>
            </div>
          </div>
          <div class="account-public-world-status" id="account-public-world-status"></div>
        </section>
        <details class="account-details">
          <summary>Account settings</summary>
          <section class="account-section account-receipts-section">
            <div class="account-section-title">Activity</div>
            <div class="account-section-sub">Purchases, rewards, and Hall Pass use.</div>
            <div class="account-history-list" id="account-history-list"></div>
          </section>
          <section class="account-section account-trust-section">
            <div class="account-section-title">Safety and links</div>
            <div class="account-section-sub">Official links, wallet safety, and current service details.</div>
            <div class="account-trust-list" id="account-trust-list"></div>
          </section>
          <section class="account-section account-danger-section">
            <div class="account-section-head">
              <div>
                <div class="account-section-title">Delete account</div>
                <div class="account-section-sub">Permanently delete this account and its school activity.</div>
              </div>
              <div class="account-section-actions">
                <button type="button" class="secondary danger" id="account-delete">Delete Account</button>
              </div>
            </div>
          </section>
        </details>
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
            <div><strong>Hall Passes</strong><span>Use them for images, course tools, collectible cards, and extra student slots.</span></div>
            <div><strong>Activity history</strong><span>Your purchases and collectible-card activity appear here.</span></div>
          </div>
        </section>
        <section class="account-section account-hall-pass-card-section">
          <div class="account-section-head">
            <div>
              <div class="account-section-title">Cards</div>
              <div class="account-section-sub" id="account-card-summary"></div>
            </div>
            <div class="account-section-actions">
	              <button type="button" id="account-buy-card-packs">Buy Collectible Packs</button>
              <button type="button" class="secondary" id="account-mint-cards">Mint Collectible</button>
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
    </div>
    <div id="privy-status" class="stat-budget" aria-live="polite"></div>
    </div>
</div>

<!-- Character sheet overlay (creation + profile view). The X-button in
     the corner is the universal close affordance now — per-card "Close"
     buttons are gone. Click anywhere outside .sheet-card also closes. -->
<div class="sheet-overlay" id="sheet-overlay" role="dialog" aria-modal="true" aria-label="Student card" aria-hidden="true">
  <button class="sheet-close" id="sheet-close" type="button" aria-label="Close">×</button>
  <div class="sheet-card" id="sheet-card"></div>
</div>

<!-- Billing overlay -->
<div class="sheet-overlay" id="billing-overlay" role="dialog" aria-modal="true" aria-labelledby="billing-title" aria-hidden="true">
  <button class="sheet-close" id="billing-close" type="button" aria-label="Close">×</button>
  <div class="sheet-card billing-card">
    <h2 id="billing-title">Buy Hall Passes</h2>
    <p class="sub" id="billing-sub">Buy Hall Passes or permanently destroy one collectible card to get 5.</p>
    <div class="wallet-panel" id="billing-wallet">0 Hall Passes · 0 Cards</div>
    <div class="billing-costs" id="billing-costs"></div>
    <div class="billing-products" id="billing-products"></div>
    <div id="billing-status" class="stat-budget" aria-live="polite"></div>
  </div>
</div>

<!-- Bug report overlay -->
<div class="sheet-overlay" id="bug-report-overlay" role="dialog" aria-modal="true" aria-labelledby="bug-report-title" aria-hidden="true">
  <button class="sheet-close" id="bug-report-close" type="button" aria-label="Close">×</button>
  <form class="sheet-card is-bug-report-sheet" id="bug-report-form">
    <h2 id="bug-report-title">Report a bug</h2>
    <p class="sub">Send details that can help us find and fix the problem.</p>
    <div class="field">
      <label for="bug-report-text">What broke?</label>
      <textarea id="bug-report-text" rows="5" maxlength="4000" placeholder="What happened, and what did you expect?"></textarea>
    </div>
    <div class="bug-report-context">Recent app errors and classroom details will be attached.</div>
    <div class="stat-budget" id="bug-report-status" aria-live="polite"></div>
    <div class="sheet-actions">
      <button type="button" class="secondary" id="bug-report-cancel">Cancel</button>
      <button type="submit" id="bug-report-submit">Send report</button>
    </div>
  </form>
</div>

<!-- Pack editor overlay -->
<div class="sheet-overlay" id="pack-overlay" role="dialog" aria-modal="true" aria-labelledby="pack-title" aria-hidden="true">
  <div class="sheet-card" id="pack-card">
    <h2 id="pack-title">Guest Teachers</h2>
    <p class="sub">Let Ruby High choose this week's guest teacher, or choose one from your courses.</p>
    <div class="pack-library-actions">
      <button type="button" class="pack-action" id="pack-auto-btn">Choose Weekly Guest</button>
      <button type="button" class="pack-action" id="pack-create-btn">+ Create Course</button>
    </div>
    <div class="pack-section-title">Ruby High courses and current guest</div>
    <div class="pack-grid" id="pack-list"></div>
    <div class="pack-section-title">Find courses</div>
    <div class="pack-search-row">
      <input type="search" id="pack-search-input" placeholder="Search course titles or subjects" autocomplete="off" />
      <button type="button" class="pack-action" id="pack-search-btn">Search</button>
    </div>
    <div class="pack-grid" id="pack-search-list"></div>
    <div class="pack-section-title">Draft courses</div>
    <div class="pack-grid" id="pack-draft-list"></div>
    <div class="pack-import-panel" id="pack-import-panel" hidden>
      <div class="pack-import-title" id="pack-import-title">Working</div>
      <div class="pack-import-detail" id="pack-import-detail">Ruby High is updating your courses.</div>
      <div class="pack-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-label="Course update progress">
        <div class="pack-progress-fill" id="pack-progress-fill"></div>
      </div>
    </div>
    <div id="pack-status" class="stat-budget" style="margin-top: 8px; min-height: 16px;"></div>
    <div class="sheet-actions">
      <button type="button" class="secondary" id="pack-close-btn">Close</button>
    </div>
  </div>
</div>

<div class="sheet-overlay" id="pack-edit-overlay" role="dialog" aria-modal="true" aria-labelledby="pack-edit-title" aria-hidden="true">
  <div class="sheet-card pack-edit-card" id="pack-edit-card">
    <h2 id="pack-edit-title">Edit course</h2>
    <p class="sub" id="pack-edit-subtitle">Draft course.</p>
    <div class="pack-editor">
      <section class="pack-course-generator" id="pack-course-generator" hidden>
        <textarea id="course-materials-input" rows="10" maxlength="80000" placeholder="Add course materials here"></textarea>
        <div class="pack-course-generator-actions">
          <button type="button" class="pack-action" id="course-generate-btn">Generate course</button>
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
          <button type="button" class="pack-editor-tab is-active" data-pack-tab="materials">Course materials</button>
          <button type="button" class="pack-editor-tab" data-pack-tab="questions">Questions</button>
          <button type="button" class="pack-editor-tab" data-pack-tab="settings">Settings</button>
        </div>
        <div class="pack-tab-panel is-active" id="pack-tab-materials">
          <div class="teacher-creator">
            <input id="teacher-material-url-input" type="url" placeholder="Link to a public Markdown file">
            <button type="button" class="secondary" id="teacher-load-url-btn">Load link</button>
            <textarea id="teacher-materials-input" rows="8" maxlength="80000" placeholder="Paste your course materials"></textarea>
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
              <input id="teacher-socials-input" type="url" placeholder="Teacher's public profile link">
            </div>
            <input id="teacher-profile-image-input" type="url" placeholder="Profile image URL">
            <textarea id="teacher-persona-input" rows="4" maxlength="2400" placeholder="Describe how this teacher speaks and teaches"></textarea>
          </div>
        </div>
      </section>
    </div>
    <div id="pack-edit-status" class="stat-budget" style="margin-top: 8px; min-height: 16px;"></div>
    <div class="sheet-actions">
      <button type="button" class="secondary" id="pack-edit-close-btn">Close</button>
      <button type="button" class="secondary" id="pack-publish-btn">Publish course (3 Hall Passes)</button>
    </div>
  </div>
</div>
`;
}
