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
    expectScriptToContain(script, "reg.update().catch");
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
    expect(VIEWER_CSS).toContain("white-space: pre-line");
    expect(script).not.toContain("window.confirm");
    expect(script).not.toContain("window.alert");
    expect(script).not.toContain("window.prompt");
  });

  it("keeps lounge mode out of the empty-board class-start CTA", () => {
    const script = readFileSync(new URL("../viewer-parts/client.ts", import.meta.url), "utf8");

    expectScriptToContain(script, 'const isLounge = !!((faculty && faculty.id === LOUNGE_ID) || (!faculty && lastTelemetry && lastTelemetry.faculty === LOUNGE_ID));');
    expectScriptToContain(script, "Lounge mode: hide blackboard and show the faculty lounge roster.");
    expectScriptToContain(script, "t.faculty === LOUNGE_ID ? \"teachers' lounge\"");
    expectScriptToContain(script, 'const roster = (t.faculty_roster || []).filter((f) => f && f.id !== LOUNGE_ID);');
  });

  it("wires the Privy account UI through the lazy widget bundle", () => {
    const html = renderedViewer({ privy: { appId: "privy-app-test", clientId: "privy-client-test", loginMethods: ["wallet"] } });
    const script = inlineScript(html);

    expect(() => new Function(script)).not.toThrow();
    expect(html).toContain('id="privy-action"');
    expect(html).toContain('id="signin-privy"');
    expect(html).toContain('id="privy-overlay"');
    expect(html).not.toContain('id="privy-phantom-login"');
    expect(html).toContain('id="privy-login-widget"');
    expect(html).not.toContain('id="privy-connect-solana"');
    expect(html).toContain('id="account-ai-use-pass"');
    expect(html).toContain('id="account-ai-action"');
    expect(html).not.toContain('id="account-use-pass"');
    expect(html).toContain('id="account-buy-passes"');
    expect(html).toContain('id="account-buy-card-packs"');
    expect(html).toContain('title="Account"');
    expect(html).toContain("Connect AI key");
    expect(html).toContain("Burn Card");
    expect(html).toContain('id="account-create-character"');
    expect(html).toContain('id="account-history-list"');
    expect(html).toContain('id="account-comics"');
    expectScriptToContain(script, '"build":"dev"');
    expectScriptToContain(script, '"privyConfig":{"appId":"privy-app-test","clientId":"privy-client-test","loginMethods":["wallet"]}');
    expectScriptToContain(script, 'const PRIVY_CLIENT_URL = apiBase + "/assets/privy-client.global.js?v=" + encodeURIComponent(buildId)');
    expectScriptToContain(script, 'const PRIVY_CLIENT_GLOBAL = "RubyHighPrivyClientModule"');
    expectScriptToContain(script, "loadScriptGlobal(PRIVY_CLIENT_URL, PRIVY_CLIENT_GLOBAL)");
    expectScriptToContain(script, "createRubyHighPrivyClient(privyConfig)");
    expect(script).not.toContain("const loadViewerModule = (url) => import(url)");
    expect(script).not.toContain("loadViewerModule(PRIVY_CLIENT_URL)");
    expectScriptToContain(script, "client.login()");
    expectScriptToContain(script, "client.onDiagnostic(reportPrivyDiagnostic)");
    expectScriptToContain(script, 'postViewerMetricEvent("privy_auth_error"');
    expectScriptToContain(script, "client.connectSolanaWallet()");
    expectScriptToContain(script, "function reportPrivyDiagnostic(event)");
    expectScriptToContain(script, "startPrivyLogin");
    expectScriptToContain(script, "startSolanaWalletConnect");
    expectScriptToContain(script, "function friendlyPrivyAccountError(err, fallback)");
    expectScriptToContain(script, "Privy blocked wallet sign-in. Enable wallet login in the Privy dashboard, then refresh Ruby High.");
    expect(script).not.toContain('reportStatus(err && err.message ? err.message : "Privy sign-in failed", true)');
    expect(script).not.toContain("client.loginWithPhantom()");
    expect(script).not.toContain("function phantomWalletAvailable()");
    expect(script).not.toContain("Trying Phantom directly...");
    expect(script).not.toContain("startPhantomLogin");
    expectScriptToContain(script, 'apiBase + "/auth/privy"');
    expectScriptToContain(script, "initializePrivyFromStoredSession();");
    expect(script).not.toContain("sendEmailCode");
    expect(script).not.toContain("loginWithEmailCode");
  });

  it("keeps Stripe Hall Pass checkout separate from Solana pack checkout", () => {
    const script = inlineScript(renderedViewer({ privy: { appId: "privy-app-test", clientId: "privy-client-test" } }));

    expectScriptToContain(script, "function connectedSolanaWalletAddress()");
    expectScriptToContain(script, "function selectBillingProduct(productId)");
    expectScriptToContain(script, "function renderAccountHallPassCards()");
    expectScriptToContain(script, "async function ensureSolanaWalletFromAccount()");
    expectScriptToContain(script, "function confirmWalletTransactionPreview(opts)");
    expectScriptToContain(script, "function nftHttpErrorMessage(action, response, data, unchanged)");
    expectScriptToContain(script, "function friendlySolanaActionError(err, unchanged)");
    expectScriptToContain(script, "Ruby High never asks for a seed phrase.");
    expectScriptToContain(script, "Your card is still face-down; try again in a minute.");
    expectScriptToContain(script, "accountHallPassCards");
    expectScriptToContain(script, 'buy.addEventListener("click", () => selectBillingProduct(product.id))');
    expectScriptToContain(script, 'mode === "card-packs"');
    expectScriptToContain(script, "buildCardPackPaymentChoice(solana, product)");
    expectScriptToContain(script, "buildBillingPaymentChoice(payload, product)");
    expectScriptToContain(script, 'title.textContent = "Buy " + hallPassCostLabel(productHallPassCount(product));');
    expectScriptToContain(script, "meta.textContent = formatMoney(product.unitAmount, product.currency);");
    expectScriptToContain(script, 'stripe.textContent = "Checkout"');
    expectScriptToContain(script, 'crypto.textContent = cryptoUnavailable ? "Crypto unavailable" : "Buy Pack"');
    expectScriptToContain(script, "crypto.disabled = billingBusy || cryptoUnavailable || !(solana && solana.configured)");
    expectScriptToContain(script, "Card pack checkout is not configured in this preview.");
    expect(VIEWER_CSS).toContain(".billing-payment-note");
    expect(VIEWER_CSS).toContain(".account-hall-pass-card");
    expect(script).not.toContain('"Buy " + formatWholeNumber(product.hallPasses || 0) + " Hall Passes."');
    expect(script).not.toContain("Number(entry.hallPasses");
    expectScriptToContain(script, "async function ensureSolanaWalletForBilling()");
    expectScriptToContain(script, "function connectedSolanaWalletAddress() {\n    return privyState.solanaWalletAddress || null;\n  }");
    expectScriptToContain(script, "function knownSolanaOwnerWalletAddress()");
    expectScriptToContain(script, "function appendSolanaProofLink(parent, address, label)");
    expectScriptToContain(script, '"Connect a Solana wallet to open packs and reveal Cards."');
    expectScriptToContain(script, '"Privy account · no Solana wallet"');
    expectScriptToContain(script, "function hallPassPacksForTelemetry(t)");
    expectScriptToContain(script, "function buildHallPassPack(pack)");
    expectScriptToContain(script, "No packs or Cards in this wallet yet.");
    expectScriptToContain(script, "async function openHallPassPackFromAccount(packId)");
    expectScriptToContain(script, 'apiBase + "/nft/open-pack"');
    expectScriptToContain(script, 'prompt: "No wallet signature is expected for pack opening."');
    expectScriptToContain(script, "async function syncWalletPackNftsFromAccount(opts)");
    expectScriptToContain(script, 'apiBase + "/nft/sync-packs"');
    expectScriptToContain(script, 'void syncWalletPackNftsFromAccount({ force: true })');
    expectScriptToContain(script, 'img.src = status === "active" ? PACK_NFT_ART_URL : PACK_OPENED_NFT_ART_URL');
    expectScriptToContain(script, 'item.className = "account-pack-tile is-" + String(pack.status || "active")');
    expectScriptToContain(script, '"On-chain Core NFT"');
    expectScriptToContain(script, '"Opened pack record"');
    expectScriptToContain(script, '"View pack NFT"');
    expectScriptToContain(script, 'item.className = "account-card-tile is-" + String(card.status || "active")');
    expectScriptToContain(script, 'item.type = "button"');
    expectScriptToContain(script, 'item.addEventListener("click", () => showHallPassCardReader(card))');
    expectScriptToContain(script, '"Face-down Card · mint to reveal · #"');
    expectScriptToContain(script, '"View Card on Solscan"');
    expectScriptToContain(script, "function showHallPassCardReader(card)");
    expectScriptToContain(script, "const render = (nextCard, opts) =>");
    expectScriptToContain(script, "const revealedCard = await mintHallPassCardFromAccount(currentCard.id)");
    expectScriptToContain(script, "render(revealedCard, { flip: true, revealed: true })");
    expectScriptToContain(script, "function hallPassCardById(cardId)");
    expectScriptToContain(script, "function hallPassCardNftImageUrl(card)");
    expectScriptToContain(script, "Opening pack. Laying out five face-down cards...");
    expectScriptToContain(script, 'const PACK_NFT_ART_URL = apiBase + "/assets/nft/ruby-high-pack.png?v=pack-nft-v2"');
    expectScriptToContain(script, 'const PACK_OPENED_NFT_ART_URL = apiBase + "/assets/nft/ruby-high-pack-opened.png?v=opened-v2"');
    expectScriptToContain(script, 'const CARD_BACK_ART_URL = apiBase + "/assets/nft/ruby-high-card-back.png?v=card-back-v1"');
    expectScriptToContain(script, 'const CARD_NFT_ART_VERSION = "card-crop-v1"');
    expectScriptToContain(script, 'apiBase + "/assets/nft/market-cards/"');
    expectScriptToContain(script, "const HALL_PASS_CARDS_PER_PACK = 5");
    expectScriptToContain(script, "function showPackMintProgress(message, options)");
    expectScriptToContain(script, "Please wait: minting pack");
    expectScriptToContain(script, "Please wait: minting card");
    expectScriptToContain(script, "rotate: false");
    expectScriptToContain(script, "hidePackMintProgress();\n      setPrivyStatus(\"Review the mint preview...\", false);");
    expectScriptToContain(script, "showPackMintProgress(\"Confirm the mint in your wallet...\"");
    const packBuilder = script.slice(script.indexOf("function buildHallPassPack(pack)"), script.indexOf("function buildHallPassCard(card)"));
    expect(packBuilder).toContain("PACK_NFT_ART_URL");
    expect(packBuilder).toContain("PACK_OPENED_NFT_ART_URL");
    expect(packBuilder).not.toContain("WELCOME_HALL_PASS_ART_URL");
    const cardBuilder = script.slice(script.indexOf("function buildHallPassCard(card)"), script.indexOf("function hallPassCardArtUrl(card)"));
    expect(cardBuilder).toContain("CARD_BACK_ART_URL");
    expect(cardBuilder).not.toContain("faceDown ? PACK_NFT_ART_URL");
    expect(VIEWER_CSS).toContain(".pack-mint-overlay");
    expect(VIEWER_CSS).toContain("z-index: 130");
    expect(VIEWER_CSS).toContain(".account-pack-tile");
    expect(VIEWER_CSS).toContain(".account-card-tile");
    expect(VIEWER_CSS).toContain(".account-chain-link");
    expect(VIEWER_CSS).toContain("grid-template-columns: repeat(auto-fill, minmax(72px, 1fr))");
    expect(VIEWER_CSS).toContain(".account-card-reader");
    expect(VIEWER_CSS).toContain(".account-card-reader-art.is-flipped");
    expect(VIEWER_CSS).toContain("@keyframes accountCardReaderFlip");
    expect(VIEWER_CSS).toContain(".account-card-tile-reveal");
    expect(VIEWER_CSS).toContain("aspect-ratio: 3 / 4");
    expect(VIEWER_CSS).toContain("aspect-ratio: 1122 / 1402");
    expect(script).not.toContain("mintPurchasedHallPassCards");
    expectScriptToContain(script, "function mintPendingCardNftsFromAccount()");
    expectScriptToContain(script, "function mintHallPassCardFromAccount(cardId)");
    expectScriptToContain(script, 'apiBase + "/nft/mint-card-prepare"');
    expectScriptToContain(script, 'apiBase + "/nft/mint-card-submit"');
    expectScriptToContain(script, 'typeof client.signSolanaTransaction !== "function"');
    expectScriptToContain(script, "client.signSolanaTransaction(preparedData.mint)");
    expectScriptToContain(script, "signedTransactionBase64: signed.signedTransactionBase64");
    expectScriptToContain(script, 'prompt: "Your wallet should show one card-mint transaction."');
    expectScriptToContain(script, "Mint to Reveal");
    expectScriptToContain(script, "return hallPassCardById(cleanCardId) || data.card || null");
    expect(script).not.toContain("remove();\n        void mintHallPassCardFromAccount(card.id);");
    expectScriptToContain(script, "Mint the next face-down Ruby High Card to reveal it.");
    expect(script).not.toContain("unmintedCardCount");
    expect(script).not.toContain("/nft/mint-pending");
    expect(script).not.toContain("Mint \" + mintableCount + \" Pending");
    expect(script).not.toContain("Burn for 5 Passes");
    expect(script).not.toContain("burnHallPassCardFromAccount");
    expectScriptToContain(script, 'await startPrivyLogin({ source: "billing" })');
    expectScriptToContain(script, 'await startSolanaWalletConnect({ source: "billing" })');
    expectScriptToContain(script, 'typeof client.paySolanaQuote !== "function"');
    expectScriptToContain(script, 'title: "Connect Solana wallet?"');
    expectScriptToContain(script, 'title: "Confirm card pack payment?"');
    expectScriptToContain(script, "Your wallet may show only the RUBY debit; Ruby High files the pack NFT after confirmation.");
    expectScriptToContain(script, 'setBillingStatus("Starting card pack checkout...", false)');
    expectScriptToContain(script, "await client.paySolanaQuote(data)");
    expect(script).not.toContain('"prepare card mint " + prepared.status');
    expect(script).not.toContain('"solana quote " + r.status');
    expect(PRIVY_CLIENT_SOURCE).toContain('useSignTransaction');
    expect(PRIVY_CLIENT_SOURCE).toContain('/billing/solana/submit');
    expect(PRIVY_CLIENT_SOURCE).toContain('signSolanaTransaction');
    expect(script).not.toContain('buy.textContent = "Pay with wallet"');
    expect(script).not.toContain("if (solanaWalletAddress && solana && solana.configured && solanaProducts.length > 0)");
    expect(script).not.toContain("Solana transaction signature");
    expect(script).not.toContain("paste the transaction");
    expect(script).not.toContain("Pay Crypto");
    expectScriptToContain(script, 'setAccountPane("account");');
    expectScriptToContain(script, 'els.accountBuyPasses.addEventListener("click", () => openBilling({ mode: "hall-passes" }))');
    expectScriptToContain(script, 'els.accountBuyCardPacks.addEventListener("click", () => openBilling({ mode: "card-packs" }))');
  });

  it("shows a thumbnail selector before burning collectible cards", () => {
    const script = inlineScript(renderedViewer({ privy: { appId: "privy-app-test", clientId: "privy-client-test" } }));

    expectScriptToContain(script, "function selectHallPassCardsForBurn(cards, needed)");
    expectScriptToContain(script, 'overlay.className = "card-burn-overlay"');
    expectScriptToContain(script, 'grid.className = "card-burn-grid"');
    expectScriptToContain(script, 'thumb.className = "card-burn-thumb"');
    expectScriptToContain(script, "img.src = hallPassCardArtUrl(card)");
    expectScriptToContain(script, "const selectedCards = presetCards.length === needed");
    expectScriptToContain(script, "function buildHallPassCardBurnChoice(hallPassesPerBurnedCard)");
    expectScriptToContain(script, "els.billingProducts.appendChild(buildHallPassCardBurnChoice(hallPassesPerBurnedCard))");
    expectScriptToContain(script, "async function burnHallPassCardFromBilling()");
    expectScriptToContain(script, "body: JSON.stringify({ hallPassBurns: burns })");
    expectScriptToContain(script, "async function convertHallPassCardsToHallPasses(count, opts)");
    expectScriptToContain(script, 'apiBase + "/billing/card-burn"');
    expectScriptToContain(script, 'title: selectedCards.length === 1 ? "Burn this card?"');
    expectScriptToContain(script, "credit: hallPassCostLabel(hallPassBurnCreditForCards(1))");
    expectScriptToContain(script, 'prompt: "Your wallet should show one card-burn transaction."');
    expect(VIEWER_CSS).toContain(".card-burn-overlay");
    expect(VIEWER_CSS).toContain(".card-burn-grid");
    expect(VIEWER_CSS).toContain(".card-burn-thumb img");
  });

  it("keeps Privy modal actions from getting stuck while Privy owns Solana wallet selection", () => {
    expect(PRIVY_CLIENT_SOURCE).toContain("toSolanaWalletConnectors({ shouldAutoConnect: true })");
    expect(PRIVY_CLIENT_SOURCE).toContain("getIdentityToken");
    expect(PRIVY_CLIENT_SOURCE).toContain('const RUBY_HIGH_SOLANA_WALLET_LIST: WalletListEntry[] = ["phantom", "solflare", "backpack", "detected_solana_wallets"];');
    expect(PRIVY_CLIENT_SOURCE).toContain('const DEFAULT_RUBY_HIGH_PRIVY_LOGIN_METHODS: RubyHighPrivyLoginMethod[] = ["wallet"];');
    expect(PRIVY_CLIENT_SOURCE).toContain("const RUBY_HIGH_PRIVY_LOGIN_METHODS");
    expect(PRIVY_CLIENT_SOURCE).toContain("const loginMethods = loginMethodsForConfig(config);");
    expect(PRIVY_CLIENT_SOURCE).toContain("loginMethods,");
    expect(PRIVY_CLIENT_SOURCE).toContain("loginMethods: props.loginMethods,");
    expect(PRIVY_CLIENT_SOURCE).toContain('walletChainType: "solana-only",');
    expect(PRIVY_CLIENT_SOURCE).toContain('walletChainType: "solana-only"');
    expect(PRIVY_CLIENT_SOURCE).toContain("walletList: RUBY_HIGH_SOLANA_WALLET_LIST");
    expect(PRIVY_CLIENT_SOURCE).toContain('showWalletLoginFirst: loginMethods.includes("wallet")');
    expect(PRIVY_CLIENT_SOURCE).toContain('ethereum: { createOnLogin: "off" }');
    expect(PRIVY_CLIENT_SOURCE).toContain("const SOLANA_WALLET_READY_TIMEOUT_MS = 5_000;");
    expect(PRIVY_CLIENT_SOURCE).toContain("const solanaWalletsRef = useRef<ConnectedStandardSolanaWallet[]>([]);");
    expect(PRIVY_CLIENT_SOURCE).toContain("waitForSolanaWallets(() => solanaWalletsRef.current)");
    expect(PRIVY_CLIENT_SOURCE).toContain("const raw = record.chainType ?? record.chain_type;");
    expect(PRIVY_CLIENT_SOURCE).toContain('return raw === "ethereum" || raw === "solana" ? raw : null;');
    expect(PRIVY_CLIENT_SOURCE).toContain("const solanaWalletAddress = connectedSolanaWalletAddress;");
    expect(PRIVY_CLIENT_SOURCE).toContain("onDiagnostic(listener)");
    expect(PRIVY_CLIENT_SOURCE).toContain("diagnosticFromError");
    expect(PRIVY_CLIENT_SOURCE).toContain("sanitizeDiagnosticEvent");
    expect(PRIVY_CLIENT_SOURCE).toContain("Connect a Solana wallet through Privy to buy Ruby High packs.");
    expect(PRIVY_CLIENT_SOURCE).not.toContain("useLoginWithSiws");
    expect(PRIVY_CLIENT_SOURCE).not.toContain("loginWithPhantom");
    expect(PRIVY_CLIENT_SOURCE).not.toContain("loginWithInjectedPhantom");
    expect(PRIVY_CLIENT_SOURCE).not.toContain("phantom.siws.authenticate.error");
    expect(PRIVY_CLIENT_SOURCE).not.toContain('walletClientType: "phantom"');
    expect(PRIVY_CLIENT_SOURCE).not.toContain('connectorType: "injected"');
    expect(PRIVY_CLIENT_SOURCE).toContain("identityToken");
    expect(PRIVY_CLIENT_SOURCE).not.toContain("linkedSolanaWallet");
    expect(PRIVY_CLIENT_SOURCE).not.toContain("function solanaWalletFromUser");
    expect(PRIVY_CLIENT_SOURCE).toContain("const PRIVY_ACTION_TIMEOUT_MS = 30_000;");
    expect(PRIVY_CLIENT_SOURCE).toContain("Privy sign-in did not open. Refresh Ruby High and try again.");
    expect(PRIVY_CLIENT_SOURCE).toContain("Solana wallet connection did not open. Refresh Ruby High and try again.");
    expect(PRIVY_CLIENT_SOURCE).toContain("Privy connected a wallet, but did not expose a Solana signer.");
    expect(PRIVY_CLIENT_SOURCE).toContain('diagnosticFromError("privy.login.promise_error"');
    expect(PRIVY_CLIENT_SOURCE).toContain("rejectPendingLogin(err);");
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

  it("keeps Account split into focused account, wallet, cards, library, receipts, and trust panes", () => {
    const html = renderedViewer({ privy: { appId: "privy-app-test", clientId: "privy-client-test" } });
    const script = inlineScript(html);
    const characters = html.indexOf('class="account-section account-character-section"');
    const wallet = html.indexOf('class="account-section account-wallet-section"');
    const cards = html.indexOf('class="account-section account-hall-pass-card-section"');
    const history = html.indexOf('id="account-history-list"');
    const comics = html.indexOf('class="account-section account-comics-section"');
    const ai = html.indexOf('class="account-section account-ai-section"');

    expect(html).toContain('data-account-tab="account"');
    expect(html).toContain('data-account-tab="wallet"');
    expect(html).toContain('data-account-tab="cards"');
    expect(html).toContain('data-account-tab="library"');
    expect(html).toContain('data-account-tab="receipts"');
    expect(html).toContain('data-account-tab="trust"');
    expect(html).toContain('id="account-trust-list"');
    expect(html).toContain("Receipts");
    expect(characters).toBeGreaterThan(-1);
    expect(wallet).toBeGreaterThan(characters);
    expect(ai).toBeGreaterThan(wallet);
    expect(cards).toBeGreaterThan(ai);
    expect(comics).toBeGreaterThan(cards);
    expect(history).toBeGreaterThan(comics);
    expectScriptToContain(script, "function setAccountPane(pane)");
    expectScriptToContain(script, "function renderAccountTrust()");
    expectScriptToContain(script, "Ruby High never asks for a seed phrase.");
    expect(VIEWER_CSS).toContain(".account-tabs");
    expect(VIEWER_CSS).toContain(".account-workspace");
    expect(VIEWER_CSS).toContain(".account-trust-row");
    expectScriptToContain(script, "function openCharacterCreationFromAccount()");
    expect(html).toContain('id="blackboard-empty-action"');
    expectScriptToContain(script, "Create your first Ruby High student.");
    expectScriptToContain(script, 'els.blackboardEmptyAction.addEventListener("click", handleBlackboardEmptyAction)');
    expectScriptToContain(script, "function maybeShowWelcomeHallPassPopup");
    expectScriptToContain(script, "function claimWelcomeHallPassesFromBilling()");
    expectScriptToContain(script, 'apiBase + "/billing/welcome"');
    expectScriptToContain(script, "No Hall Passes yet");
    expectScriptToContain(script, "Open Account");
    expectScriptToContain(script, 'if (billingMode === "hall-passes") void claimWelcomeHallPassesFromBilling();');
    expect(script).not.toContain("maybeShowWelcomeHallPassPopup(t);");
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
