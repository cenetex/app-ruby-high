import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderViewerHtml } from "../viewer.js";
import { VIEWER_CSS } from "../viewer-parts/css.js";

const PRIVY_CLIENT_SOURCE = readFileSync(new URL("../viewer-privy-client.ts", import.meta.url), "utf8");

function renderedViewer(opts: Partial<Parameters<typeof renderViewerHtml>[0]> = {}): string {
  return renderViewerHtml({
    agentName: "Ruby",
    sessionId: "rh:test-viewer",
    apiBase: "/api/apps/ruby-high",
    role: "human",
    ...opts,
  });
}

function inlineScript(html: string): string {
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!match) throw new Error("viewer HTML has no inline script");
  return match[1]!;
}

function compactScript(value: string): string {
  return value.replace(/\s+/g, "");
}

function expectScriptToContain(script: string, snippet: string): void {
  const compact = compactScript(snippet);
  expect(
    compactScript(script).includes(compact),
    `missing script snippet: ${snippet}`,
  ).toBe(true);
}

function cssRule(selector: string): string {
  const needle = `${selector} {`;
  const start = VIEWER_CSS.indexOf(needle);
  if (start < 0) throw new Error(`missing selector: ${selector}`);
  const open = VIEWER_CSS.indexOf("{", start);
  if (open < 0) throw new Error(`missing rule body: ${selector}`);
  let depth = 0;
  for (let i = open; i < VIEWER_CSS.length; i += 1) {
    const ch = VIEWER_CSS[i];
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return VIEWER_CSS.slice(open + 1, i);
    }
  }
  throw new Error(`unterminated rule: ${selector}`);
}

describe("viewer regression guardrails", () => {
  it("renders parseable inline JS with the critical offline boot and PWA paths", () => {
    const script = inlineScript(renderedViewer());

    expect(() => new Function(script)).not.toThrow();
    expectScriptToContain(script, "/api/apps/ruby-high/auth/guest");
    expectScriptToContain(script, '["localhost", "127.0.0.1", "::1"].includes(window.location.hostname)');
    expectScriptToContain(script, "navigator.serviceWorker.getRegistrations()");
    expectScriptToContain(script, 'navigator.serviceWorker.register(apiBase + "/service-worker.js", { scope: apiBase + "/" })');
    expectScriptToContain(script, "async function bootInitialSession()");
    const boot = script.slice(script.indexOf("async function bootInitialSession()"));
    expect(boot.indexOf("await deriveAuth();")).toBeLessThan(boot.indexOf('postViewerMetricEvent("app_open"'));
    expect(boot.indexOf('postViewerMetricEvent("app_open"')).toBeLessThan(boot.indexOf("await fetchSession();"));
  });

  it("uses an in-app confirmation dialog instead of native browser prompts", () => {
    const html = renderedViewer();
    const script = inlineScript(html);

    expect(html).toContain('id="app-confirm-overlay"');
    expect(html).toContain('role="dialog"');
    expectScriptToContain(script, "function confirmInApp(options)");
    expectScriptToContain(script, "return confirmInApp({");
    expect(VIEWER_CSS).toContain(".app-confirm-overlay");
    expect(script).not.toContain("window.confirm");
    expect(script).not.toContain("window.alert");
    expect(script).not.toContain("window.prompt");
  });

  it("wires the Privy account UI through the lazy widget bundle", () => {
    const html = renderedViewer({ privy: { appId: "privy-app-test", clientId: "privy-client-test" } });
    const script = inlineScript(html);

    expect(() => new Function(script)).not.toThrow();
    expect(html).toContain('id="privy-action"');
    expect(html).toContain('id="signin-privy"');
    expect(html).toContain('id="privy-overlay"');
    expect(html).toContain('id="privy-login-widget"');
    expect(html).not.toContain('id="privy-connect-solana"');
    expect(html).toContain('id="account-ai-use-pass"');
    expect(html).toContain('id="account-ai-action"');
    expect(html).not.toContain('id="account-use-pass"');
    expect(html).not.toContain('id="account-buy-passes"');
    expect(html).toContain("Connect AI key");
    expect(html).toContain("Burn Card");
    expect(html).toContain('id="account-create-character"');
    expect(html).toContain('id="account-history-list"');
    expect(html).toContain('id="account-comics"');
    expectScriptToContain(script, '"build":"dev"');
    expectScriptToContain(script, '"privyConfig":{"appId":"privy-app-test","clientId":"privy-client-test"}');
    expectScriptToContain(script, 'const PRIVY_CLIENT_URL = apiBase + "/assets/privy-client.js?v=" + encodeURIComponent(buildId)');
    expectScriptToContain(script, "const loadViewerModule = (url) => import(url)");
    expectScriptToContain(script, "loadViewerModule(PRIVY_CLIENT_URL)");
    expectScriptToContain(script, "createRubyHighPrivyClient(privyConfig)");
    expectScriptToContain(script, "client.login()");
    expectScriptToContain(script, "client.connectSolanaWallet()");
    expectScriptToContain(script, "startPrivyLogin");
    expectScriptToContain(script, "startSolanaWalletConnect");
    expectScriptToContain(script, 'apiBase + "/auth/privy"');
    expectScriptToContain(script, "initializePrivyFromStoredSession();");
    expect(script).not.toContain("sendEmailCode");
    expect(script).not.toContain("loginWithEmailCode");
  });

  it("offers crypto checkout only after a card pack is selected", () => {
    const script = inlineScript(renderedViewer({ privy: { appId: "privy-app-test", clientId: "privy-client-test" } }));

    expectScriptToContain(script, "function connectedSolanaWalletAddress()");
    expectScriptToContain(script, "function selectBillingProduct(productId)");
    expectScriptToContain(script, "function renderAccountHallPassCards()");
    expectScriptToContain(script, "accountHallPassCards");
    expectScriptToContain(script, 'buy.addEventListener("click", () => selectBillingProduct(product.id))');
    expectScriptToContain(script, "buildBillingPaymentChoice(payload, product, solana, solanaProduct)");
    expectScriptToContain(script, "prices.push(formatTokenAmount(solanaProduct.tokenAmount, solanaProduct.tokenSymbol || solana.symbol))");
    expectScriptToContain(script, 'meta.textContent = prices.join(" or ")');
    expectScriptToContain(script, 'stripe.textContent = "Stripe"');
    expectScriptToContain(script, 'crypto.textContent = cryptoUnavailable ? "Crypto unavailable" : "Crypto"');
    expectScriptToContain(script, "crypto.disabled = billingBusy || cryptoUnavailable");
    expectScriptToContain(script, "Crypto checkout is not configured in this preview.");
    expect(VIEWER_CSS).toContain(".billing-payment-note");
    expect(VIEWER_CSS).toContain(".account-hall-pass-card");
    expect(script).not.toContain('"Buy " + formatWholeNumber(product.hallPasses || 0) + " Hall Passes."');
    expectScriptToContain(script, "async function ensureSolanaWalletForBilling()");
    expectScriptToContain(script, "function connectedSolanaWalletAddress() {\n    return privyState.solanaWalletAddress || null;\n  }");
    expectScriptToContain(script, "function knownSolanaOwnerWalletAddress()");
    expectScriptToContain(script, "async function ensureSolanaWalletAddressForMint()");
    expectScriptToContain(script, "await mintPurchasedHallPassCards(ownerWalletAddress, { source: \"account\" })");
    expectScriptToContain(script, 'apiBase + "/nft/mint-pack"');
    expectScriptToContain(script, "function unmintedCardCount(t)");
    expectScriptToContain(script, "No minted cards in this wallet yet.");
    expect(script).not.toContain("/nft/mint-pending");
    expect(script).not.toContain("Mint \" + mintableCount + \" Pending");
    expectScriptToContain(script, 'await startPrivyLogin({ source: "billing" })');
    expectScriptToContain(script, 'await startSolanaWalletConnect({ source: "billing" })');
    expectScriptToContain(script, 'typeof client.paySolanaQuote !== "function"');
    expectScriptToContain(script, 'setBillingStatus("Starting crypto checkout...", false)');
    expectScriptToContain(script, "await client.paySolanaQuote(data)");
    expect(script).not.toContain('buy.textContent = "Pay with wallet"');
    expect(script).not.toContain("if (solanaWalletAddress && solana && solana.configured && solanaProducts.length > 0)");
    expect(script).not.toContain("Solana transaction signature");
    expect(script).not.toContain("paste the transaction");
    expect(script).not.toContain("Pay Crypto");
  });

  it("shows a thumbnail selector before burning collectible cards", () => {
    const script = inlineScript(renderedViewer({ privy: { appId: "privy-app-test", clientId: "privy-client-test" } }));

    expectScriptToContain(script, "function selectHallPassCardsForBurn(cards, needed)");
    expectScriptToContain(script, 'overlay.className = "card-burn-overlay"');
    expectScriptToContain(script, 'grid.className = "card-burn-grid"');
    expectScriptToContain(script, 'thumb.className = "card-burn-thumb"');
    expectScriptToContain(script, "img.src = hallPassCardArtUrl(card)");
    expectScriptToContain(script, "const selectedCards = await selectHallPassCardsForBurn(cards, needed)");
    expectScriptToContain(script, "body: JSON.stringify({ cardIds: selectedCards.map((card) => card.id), ownerWalletAddress })");
    expect(VIEWER_CSS).toContain(".card-burn-overlay");
    expect(VIEWER_CSS).toContain(".card-burn-grid");
    expect(VIEWER_CSS).toContain(".card-burn-thumb img");
  });

  it("keeps Privy modal actions from getting stuck while Privy owns Solana wallet selection", () => {
    expect(PRIVY_CLIENT_SOURCE).toContain("toSolanaWalletConnectors({ shouldAutoConnect: true })");
    expect(PRIVY_CLIENT_SOURCE).toContain('const RUBY_HIGH_LOGIN_METHODS: NonNullable<PrivyClientConfig["loginMethods"]> = ["wallet", "email", "google", "twitter"];');
    expect(PRIVY_CLIENT_SOURCE).toContain('const RUBY_HIGH_SOLANA_WALLET_LIST: WalletListEntry[] = ["phantom", "solflare", "backpack", "detected_solana_wallets"];');
    expect(PRIVY_CLIENT_SOURCE).toContain("loginMethods: RUBY_HIGH_LOGIN_METHODS");
    expect(PRIVY_CLIENT_SOURCE).toContain('login({ loginMethods: RUBY_HIGH_LOGIN_METHODS, walletChainType: "solana-only" })');
    expect(PRIVY_CLIENT_SOURCE).toContain('walletChainType: "solana-only"');
    expect(PRIVY_CLIENT_SOURCE).toContain("walletList: RUBY_HIGH_SOLANA_WALLET_LIST");
    expect(PRIVY_CLIENT_SOURCE).toContain("showWalletLoginFirst: true");
    expect(PRIVY_CLIENT_SOURCE).toContain('ethereum: { createOnLogin: "off" }');
    expect(PRIVY_CLIENT_SOURCE).toContain("const SOLANA_WALLET_READY_TIMEOUT_MS = 5_000;");
    expect(PRIVY_CLIENT_SOURCE).toContain("const solanaWalletsRef = useRef<ConnectedStandardSolanaWallet[]>([]);");
    expect(PRIVY_CLIENT_SOURCE).toContain("waitForSolanaWallets(() => solanaWalletsRef.current)");
    expect(PRIVY_CLIENT_SOURCE).toContain("const raw = record.chainType ?? record.chain_type;");
    expect(PRIVY_CLIENT_SOURCE).toContain('return raw === "ethereum" || raw === "solana" ? raw : null;');
    expect(PRIVY_CLIENT_SOURCE).toContain("const solanaWalletAddress = connectedSolanaWalletAddress;");
    expect(PRIVY_CLIENT_SOURCE).not.toContain("linkedSolanaWallet");
    expect(PRIVY_CLIENT_SOURCE).not.toContain("function solanaWalletFromUser");
    expect(PRIVY_CLIENT_SOURCE).toContain("const PRIVY_ACTION_TIMEOUT_MS = 30_000;");
    expect(PRIVY_CLIENT_SOURCE).toContain("Privy sign-in did not open. Refresh Ruby High and try again.");
    expect(PRIVY_CLIENT_SOURCE).toContain("Solana wallet connection did not open. Refresh Ruby High and try again.");
    expect(PRIVY_CLIENT_SOURCE).toContain("Privy connected a wallet, but did not expose a Solana signer.");
    expect(PRIVY_CLIENT_SOURCE).toContain("Promise.resolve(result).catch((err) => rejectPendingLogin(err))");
    expect(PRIVY_CLIENT_SOURCE).toContain("Promise.resolve(result).catch((err) => rejectPendingWalletConnect(err))");
    expect(PRIVY_CLIENT_SOURCE).toContain("if (modal.isOpen) {");
    expect(PRIVY_CLIENT_SOURCE).toContain("if (pendingLogin.current) modalOpenedForLogin.current = true;");
    expect(PRIVY_CLIENT_SOURCE).toContain("if (pendingWalletConnect.current) modalOpenedForWalletConnect.current = true;");
    expect(PRIVY_CLIENT_SOURCE).toContain("modalOpenedForLogin.current = false;");
    expect(PRIVY_CLIENT_SOURCE).toContain("modalOpenedForWalletConnect.current = false;");
    expect(PRIVY_CLIENT_SOURCE).toContain('"phantom"');
    expect(PRIVY_CLIENT_SOURCE).not.toContain("readNestedSolanaAddress");
    expect(PRIVY_CLIENT_SOURCE).not.toContain("solanaAddressFromConnectedWallet");
    expect(PRIVY_CLIENT_SOURCE).not.toContain('walletClient === "phantom"');
    expect(PRIVY_CLIENT_SOURCE).not.toContain('walletChainType: "ethereum-and-solana"');
    expect(PRIVY_CLIENT_SOURCE).not.toContain('createOnLogin: "users-without-wallets"');
    expect(PRIVY_CLIENT_SOURCE).not.toContain("modalOpenedForLogin.current = true;\n      login();");
    expect(PRIVY_CLIENT_SOURCE).not.toContain("modalOpenedForWalletConnect.current = true;\n      connectWallet({");
  });

  it("makes Account the character home before wallet, history, comics, and AI access", () => {
    const html = renderedViewer({ privy: { appId: "privy-app-test", clientId: "privy-client-test" } });
    const script = inlineScript(html);
    const characters = html.indexOf('class="account-section account-character-section"');
    const wallet = html.indexOf('class="account-section account-wallet-section"');
    const history = html.indexOf('id="account-history-list"');
    const comics = html.indexOf('class="account-section account-comics-section"');
    const ai = html.indexOf('class="account-section account-ai-section"');

    expect(characters).toBeGreaterThan(-1);
    expect(wallet).toBeGreaterThan(characters);
    expect(history).toBeGreaterThan(wallet);
    expect(comics).toBeGreaterThan(history);
    expect(ai).toBeGreaterThan(comics);
    expectScriptToContain(script, "function openCharacterCreationFromAccount()");
    expect(html).toContain('id="blackboard-empty-action"');
    expectScriptToContain(script, "Create your first Ruby High student.");
    expectScriptToContain(script, 'els.blackboardEmptyAction.addEventListener("click", handleBlackboardEmptyAction)');
    expectScriptToContain(script, "function maybeShowWelcomeHallPassPopup");
    expectScriptToContain(script, 'const WELCOME_HALL_PASS_ART_URL = apiBase + "/assets/welcome-hall-passes.png"');
    expect(VIEWER_CSS).toContain(".welcome-hall-pass-art");
    expectScriptToContain(script, "Roll your first student and try a custom portrait");
    expectScriptToContain(script, 'els.accountAiUsePass.addEventListener("click", () => activateAiPass({ source: "account" }))');
    expect(script).not.toContain('els.accountUsePass.addEventListener("click", () => activateAiPass({ source: "account" }))');
    expect(script).not.toContain("els.accountBuyPasses.disabled = !authed;");
    expect(script).not.toContain("els.accountUsePass.disabled = !authed || billingBusy");
    expectScriptToContain(script, "els.accountAiUsePass.disabled = primaryDisabled;");
    expect(script).not.toContain("els.accountBuyPasses.disabled = !unlocked || !authed");
    expect(script).not.toContain("els.accountUsePass.disabled = !unlocked || !authed");
    expect(script).not.toContain("els.accountAiUsePass.disabled = !unlocked || primaryDisabled");
    expectScriptToContain(script, "formatDuration(ai.durationMs || 6048e5)");
    expectScriptToContain(script, "AI Access active");
    expect(script).not.toContain("Roll your character to start today's class.");
  });

  it("labels offline classroom advance as Continue instead of Chat", () => {
    const script = inlineScript(renderedViewer());

    expectScriptToContain(script, 'offlineClassroom ? "Continue" : "Chat"');
    expectScriptToContain(script, 'const advanceLabel = teacherChatEnabled() ? "Chat" : "Continue";');
    expectScriptToContain(script, "Connect AI for hints.");
    expect(script).not.toContain("Connect OpenRouter for hints.");
  });

  it("keeps opinion submit, waiting refresh, and force-grade paths wired in the client", () => {
    const script = inlineScript(renderedViewer());

    expectScriptToContain(script, '/api/apps/ruby-high/chat/opinion-submit');
    expectScriptToContain(script, 'event === "waiting" || event === "opinion-graded"');
    expectScriptToContain(script, "refreshSessionAfterStreamEvent();");
    expectScriptToContain(script, "body: JSON.stringify({ force: true })");
    expectScriptToContain(script, "opinionGradeFired = true");
  });

  it("wires sealed yearbook share controls in the character sheet", () => {
    const script = inlineScript(renderedViewer());

    expectScriptToContain(script, "function buildYearbookShareActions");
    expectScriptToContain(script, "yearbook_shares");
    expectScriptToContain(script, "Open yearbook card");
    expectScriptToContain(script, "Copy yearbook card link");
    expect(VIEWER_CSS).toContain(".paper-archive-action");
  });

  it("keeps stream refreshes from holding the Chat/Practice busy lock", () => {
    const script = inlineScript(renderedViewer());
    const consumeStart = script.indexOf("async function consumeSseStream");
    const consumeEnd = script.indexOf("async function sendChatMessage");
    const consumeBody = script.slice(consumeStart, consumeEnd);

    expectScriptToContain(script, "function withViewerTimeoutSignal");
    expectScriptToContain(script, "const SESSION_REFRESH_TIMEOUT_MS = 8e3");
    expectScriptToContain(script, "function createViewerApiClient");
    expectScriptToContain(script, "const apiClient = createViewerApiClient");
    expectScriptToContain(script, "function imageRequestId(prefix)");
    expectScriptToContain(script, "function createViewerTurnController");
    expectScriptToContain(script, "const turnController = createViewerTurnController");
    expectScriptToContain(script, "function syncNextButtonDisabled()");
    expectScriptToContain(script, "const manualTurn = turnController.beginManual()");
    expectScriptToContain(script, "const agentTurn = turnController.beginAgent(false)");
    expectScriptToContain(script, "const buttonTurn = turnController.beginButtonAction()");
    expectScriptToContain(script, "turnController.syncControls()");
    expectScriptToContain(script, "if (!els.chatInput.disabled) els.chatInput.focus();");
    expect(script).not.toContain("els.chatInput.disabled = !teacherChatEnabled()");
    expectScriptToContain(consumeBody, "refreshSessionAfterStreamEvent();");
    expect(consumeBody).not.toContain("await fetchSession(");
    expect(script).not.toContain("let agentBusy =");
    expect(script).not.toContain("let manualChatBusy =");
  });

  it("keeps SSE streams bounded so stale network reads cannot hold the UI lock forever", () => {
    const script = inlineScript(renderedViewer());

    expectScriptToContain(script, "function chatStreamStillCurrent(opts)");
    expectScriptToContain(script, "const watchdog = setTimeout");
    expectScriptToContain(script, "reader.cancel()");
    expectScriptToContain(script, "clearTimeout(watchdog)");
    expectScriptToContain(script, "opts.streamSeq !== state.streamSeq");
    expectScriptToContain(script, "turnController.nextStreamGuard(targetFaculty)");
  });

  it("drops session polls that overlap command requests", () => {
    const script = inlineScript(renderedViewer());

    expectScriptToContain(script, "const seqAtStart = commandSeq");
    expectScriptToContain(script, "const settledAtStart = lastSettledCommandSeq");
    expectScriptToContain(script, "commandSeq !== seqAtStart || lastSettledCommandSeq !== settledAtStart");
  });

  it("uses explicit top status labels instead of ambiguous streak/classes copy", () => {
    const html = renderedViewer();
    const script = inlineScript(html);

    expect(html).toContain('title="Passed daily classes needed for this year"');
    expect(html).toContain('title="Subjects cleared with a C or better this year"');
    expectScriptToContain(script, 'streakCount + "/" + streakReq + " daily classes"');
    expectScriptToContain(script, 'subjects.met + "/" + subjects.total + " subjects cleared"');
    expectScriptToContain(script, 'walletSummaryText(t)');
    expectScriptToContain(script, '" Merit Stars · "');
  });

  it("keeps answer reveals until player advance and uses room completion dots", () => {
    const script = inlineScript(renderedViewer());

    expect(script).not.toContain("clearResolvedBoardAfterTeacherTurn");
    expectScriptToContain(script, "function buildRoomCompletionMeter(fac)");
    expectScriptToContain(script, "function earnedCourseGrade(progress)");
    expectScriptToContain(script, "function subjectProgressShortLabel(progress)");
    expectScriptToContain(script, "if (phase === \"revealed\")");
    expect(script).not.toContain("subjectMark.textContent = fac.courseGrade");
    expect(script).not.toContain("const grade = spec.grade || \"F\"");
    expect(script).not.toContain("(\" + cg.grade + \")");
    expect(cssRule(".channel-row.room-row")).toContain("min-height: 52px");
    expect(cssRule(".room-row-meta")).toContain("flex-direction: column");
  });

  it("uses one teacher pfp source for channel thumbs and class chat bubbles", () => {
    const script = inlineScript(renderedViewer());

    expectScriptToContain(script, "function teacherSmallAvatarUrl(facultyOrId)");
    expectScriptToContain(script, 'return teacherPortraitUrl(facultyOrId, "face");');
    expectScriptToContain(script, "avatarImgSrc = teacherSmallAvatarUrl(facultyId)");
    expectScriptToContain(script, "const thumbUrl = teacherSmallAvatarUrl(fac);");
    expectScriptToContain(script, '+ ":" + (f.assetTeacherId || "") + ":" + (f.profileImageUrl || "")');
    expect(script).not.toContain("function teacherStickerUrl");
    expect(script).not.toContain('avatarImgSrc = teacherPortraitUrl(facultyId, "")');
  });

  it("routes bug reports through the first-party issue endpoint", () => {
    const html = renderedViewer();
    const script = inlineScript(html);

    expect(html).toContain('title="Something broken? Send a bug report."');
    expect(html).toContain('id="bug-report-form"');
    expectScriptToContain(script, 'apiBase + "/bug-report"');
    expectScriptToContain(script, "RECENT_ERRORS");
    expect(script).not.toContain("github.com/cenetex/app-ruby-high/issues/new");
    expect(script).not.toContain("mailto:hello@ratimics.com");
  });

  it("keeps installed packs as one-click rows and searches creator packs separately", () => {
    const html = renderedViewer();
    const script = inlineScript(html);

    expect(html).toContain("Ruby High is always on. Pick this week's guest teacher automatically or set your own from creator packs.");
    expect(html).toContain('id="pack-search-input"');
    expect(html).toContain('id="pack-search-btn"');
    expect(html).toContain('id="pack-search-list"');
    expect(html).toContain("Find creator packs");
    expect(cssRule(".pack-grid")).toContain("display: flex");
    expect(cssRule(".pack-grid")).toContain("flex-direction: column");
    expect(cssRule(".pack-grid")).not.toContain("grid-template-columns");
    expect(cssRule(".pack-search-row")).toContain("grid-template-columns: minmax(0, 1fr) auto");
    expect(cssRule(".pack-card-item")).toContain("grid-template-columns: minmax(0, 1fr) auto");
    expectScriptToContain(script, 'card.addEventListener("click", () => {');
    expectScriptToContain(script, "state.textContent = isSearch");
    expectScriptToContain(script, ': pack.active ? "Guest now" : "Set guest"');
    expectScriptToContain(script, "async searchCreatorPacks(query)");
    expectScriptToContain(script, "async function refreshPackSearchResults()");
    expectScriptToContain(script, '"/api/apps/ruby-high/pack-library/search?q="');
    expectScriptToContain(script, "async function installCreatorPack(pack)");
    expect((script.match(/await refreshPackSearchResults\(\);/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expectScriptToContain(script, 'installBtn.textContent = pack.installed ? pack.active ? "Guest" : "Set Guest" : "Install"');
    expectScriptToContain(script, 'packSearchBtn.addEventListener("click", searchCreatorPacks)');
    expectScriptToContain(script, '"Setting guest teacher..."');
    expectScriptToContain(script, "async function deleteLibraryPack");
    expectScriptToContain(script, "deleteDraftPack");
    expectScriptToContain(script, "deletePublishedPack");
    expectScriptToContain(script, "createEditDraftForPublishedPack");
    expectScriptToContain(script, "async function editPublishedPack(pack)");
    expectScriptToContain(script, "teacherFormVersion += 1");
    expectScriptToContain(script, "mergeTeacherPatchIntoDraft(currentDraft, selectedPackTeacherId, selectedTeacherFormPatch())");
    expectScriptToContain(script, "formVersion !== teacherFormVersion");
    expectScriptToContain(script, "pack.canDelete");
    expectScriptToContain(script, "if (isDraft) editDraftPack(pack.id)");
    expectScriptToContain(script, "await editDraftPack(pack.draftId)");
    expect(cssRule(".pack-card-actions .pack-action.danger")).toContain("#ff8c8c");
    expect(script).not.toContain('document.createTextNode("Enabled")');
    expect(script).not.toContain("togglePackInstall");
    expect(script).not.toContain("activeBtn.textContent");
    expect(script).not.toContain('"Activating pack..."');
    expect(script).not.toContain('"Active pack switched. Reloading..."');
  });

  it("keeps new content pack setup focused on pasted course materials", () => {
    const html = renderedViewer();
    const script = inlineScript(html);

    expect(html).toContain('id="course-materials-input"');
    expect(html).toContain("Add course materials here");
    expect(html).toContain("Generate Course");
    expect(html).not.toContain('id="pack-name-input"');
    expect(html).not.toContain('id="pack-description-input"');
    expect(html).not.toContain('id="pack-add-teacher-btn"');
    expect(html).not.toContain('<span class="pack-teacher-title">New Teacher</span>');
    expect(html).not.toContain('<span class="pack-teacher-subtitle">Create manually</span>');
    expectScriptToContain(script, 'packEditTitleEl.textContent = emptyDraft ? "Create content pack" : "Edit pack"');
    expectScriptToContain(script, 'packEditSubtitleEl.textContent = emptyDraft ? "Add course materials here."');
    expectScriptToContain(script, 'if (teacherSidebar) teacherSidebar.hidden = emptyDraft');
    expectScriptToContain(script, "if (Object.keys(patch).length === 0) return;");
    expect(script).not.toContain('packAddTeacherBtn.addEventListener("click", addDraftTeacher)');
  });

  it("uses BYOK course generation and paid publish slots for draft pack setup", () => {
    const html = renderedViewer();
    const script = inlineScript(html);

    expect(html).toContain('id="pack-course-generator"');
    expect(html).toContain('id="course-materials-input"');
    expect(html).toContain('id="course-generation-progress"');
    expect(html).toContain('id="course-generation-checklist"');
    expect(html).toContain("Add course materials here");
    expect(html).toContain("Generate Course");
    expect(html).toContain("Publish Course (3 Hall Passes)");
    expect(html).toContain('id="course-generate-btn"');
    expect(html).not.toContain('class="pack-teacher-tab pack-new-teacher-tab"');
    expect(html).not.toContain('class="pack-teacher-avatar pack-new-teacher-avatar">+</span>');
    expectScriptToContain(script, "async generateCourse(draftId, payload, options)");
    expectScriptToContain(script, '"/course/generate"');
    expectScriptToContain(script, "function creatorPricing(t)");
    expectScriptToContain(script, "COURSE_GENERATION_STEPS");
    expectScriptToContain(script, "Generate teacher portrait");
    expectScriptToContain(script, "function startCourseGenerationProgress()");
    expectScriptToContain(script, "function finishCourseGenerationProgress()");
    expectScriptToContain(script, "function generateCourseFromMaterials()");
    expectScriptToContain(script, "function runCourseGeneration(teacher)");
    expectScriptToContain(script, 'label.textContent = packQuestionGenerationBusy');
    expectScriptToContain(script, '"Generate More Questions (" + questionCostLabel + ")" : "Generate More Questions"');
    expectScriptToContain(script, 'packPublishBtn.textContent = draftHasCourseSlot() ? "Publish Course" : "Publish Course (" + hallPassCostLabel(cost) + ")"');
    expectScriptToContain(script, "teacherGenerateQuestionsBtn.disabled = packImportBusy || packQuestionGenerationBusy || !selectedDraftTeacher() || !canGenerateQuestions");
    expectScriptToContain(script, "applyHallPassBalance(data.hallPasses, data.entitlements)");
    expectScriptToContain(script, "function deleteDraftTeacher(teacherId)");
    expectScriptToContain(script, "packStudioClient.deleteTeacher");
    expectScriptToContain(script, "function editDraftTeacher(teacherId)");
    expectScriptToContain(script, 'selectDraftTeacher(teacherId, { tab: "settings", focus: true })');
    expectScriptToContain(script, 'edit.textContent = "Edit"');
    expectScriptToContain(script, 'del.textContent = "Delete"');
    expectScriptToContain(script, "Cancel generation before closing.");
    expect(script).not.toContain("Generate Questions");
  });

  it("routes the post-class Practice button to a practice board or teacher advance", () => {
    const script = inlineScript(renderedViewer());

    expectScriptToContain(script, "async function startPostClassPractice(postClass)");
    expectScriptToContain(script, 'type: "pick"');
    expectScriptToContain(script, 'mode: "practice"');
    expectScriptToContain(script, "faculty: lastTelemetry && lastTelemetry.faculty");
    expectScriptToContain(script, 'intent: "advance"');
    expectScriptToContain(script, 'runAgentTurn("manual"');
    expectScriptToContain(script, "if (postClass.report)");
    expectScriptToContain(script, "function subjectDisplayName(fid, progress)");
    expectScriptToContain(script, "subjectDisplayName(cg.facultyId, cg.progress)");
  });

  it("builds the class report with full-body teacher standee art and a score metric", () => {
    const script = inlineScript(renderedViewer());

    expectScriptToContain(script, "function buildClassReportCard");
    expectScriptToContain(script, "function shouldShowClassReport");
    expectScriptToContain(script, "let dismissedClassReportKey = null");
    expectScriptToContain(script, "key !== dismissedClassReportKey");
    expectScriptToContain(script, "dismissedClassReportKey = reportKey");
    expectScriptToContain(script, "class-report-teacher-art");
    expectScriptToContain(script, 'teacherAssetUrl(artAssetId, "full-sticker")');
    expectScriptToContain(script, 'addMetric("score"');
    expectScriptToContain(script, '"grade score"');
    expect(script).not.toContain('addMetric("score / grade"');
    expect(script).not.toContain('addMetric("questions"');
  });

  it("stages class report teachers as full-body standees in front of the report card", () => {
    expect(cssRule('.blackboard-panel[data-question-type="class-report"] .board')).toContain("overflow: visible");
    expect(cssRule(".board .class-report-card")).toContain("overflow: visible");
    expect(cssRule(".board .class-report-card")).toContain("position: relative");
    expect(cssRule(".board .class-report-metric")).toContain("overflow: visible");
    expect(cssRule(".board .class-report-metric .v")).toContain("overflow: visible");

    expect(cssRule(".board .class-report-main")).toContain("overflow: visible");
    expect(cssRule(".board .class-report-teacher-art")).toContain("position: absolute");
    expect(cssRule(".board .class-report-teacher-art")).toContain("height: clamp(176px, 27vw, 236px)");
    expect(cssRule(".board .class-report-teacher-art")).toContain("drop-shadow");
    expect(cssRule(".board .class-report-teacher-art img")).toContain("height: 100%");
    expect(cssRule(".board .class-report-teacher-art img")).toContain("max-width: none");
  });
});
