import { createHash } from "node:crypto";
import { log } from "../services/logger.js";
import {
  buildExchangeTransaction,
  buildSourceSaleTransaction,
  exchangeRouteStats,
  publicExchangeStatus,
} from "../services/token-exchange.js";
import { sendHtmlResponse } from "./assets.js";
import { APP_ROUTE_PREFIX } from "./constants.js";
import type { RouteContext } from "./context.js";

export const EXCHANGE_PREFIX = `${APP_ROUTE_PREFIX}/exchange`;

const ROUTE_IDS = new Set(["ruby", "rati", "kyro"]);

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function firstHeader(value: string | string[] | null | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function exchangeRequestLooksLikeJson(ctx: RouteContext): boolean {
  const contentType = firstHeader(ctx.contentTypeHeader).toLowerCase();
  return !contentType || contentType.startsWith("application/json");
}

function rejectBadExchangeMutation(ctx: RouteContext): boolean {
  if (ctx.method === "GET" || ctx.method === "HEAD") return false;
  if (!exchangeRequestLooksLikeJson(ctx)) {
    ctx.error(ctx.res, "Exchange requests must be sent as JSON.", 415);
    return true;
  }
  return false;
}

function selectedRouteFromPath(pathname: string): string {
  const suffix = pathname.slice(EXCHANGE_PREFIX.length).replace(/^\/+/, "");
  const first = suffix.split("/", 1)[0] || "";
  return ROUTE_IDS.has(first) ? first : "ruby";
}

function renderExchangeHtml(opts: { selectedRoute: string; build: string }): string {
  const apiBase = APP_ROUTE_PREFIX;
  const selectedRoute = ROUTE_IDS.has(opts.selectedRoute) ? opts.selectedRoute : "ruby";
  const logoSrc = `${apiBase}/assets/logo.png?v=exchange-20260703`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>RATi Reference Exchange</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #171614;
      --muted: #5d5a55;
      --line: #d8d2c8;
      --paper: #fbfaf7;
      --panel: #ffffff;
      --amber: #ba7a14;
      --green: #176b4c;
      --red: #9d2d2d;
      --blue: #275d9d;
      --black: #111111;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      color: var(--ink);
      background: var(--paper);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: 0;
    }
    button, input, select { font: inherit; letter-spacing: 0; }
    a { color: inherit; }
    .exchange-shell {
      min-height: 100vh;
      display: grid;
      grid-template-columns: 280px minmax(0, 1fr);
    }
    .side {
      border-right: 1px solid var(--line);
      background: #f4efe5;
      padding: 18px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .brand {
      display: grid;
      grid-template-columns: 44px minmax(0, 1fr);
      gap: 10px;
      align-items: center;
    }
    .brand img {
      width: 44px;
      height: 44px;
      border-radius: 8px;
      object-fit: cover;
      border: 1px solid var(--line);
      background: #fff;
    }
    .brand-title { font-weight: 800; line-height: 1.1; }
    .brand-sub { color: var(--muted); font-size: 12px; margin-top: 3px; }
    .cluster-control, .wallet-panel, .source-shop {
      border: 1px solid var(--line);
      background: var(--panel);
      border-radius: 8px;
      padding: 12px;
    }
    .label {
      display: block;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      margin-bottom: 6px;
    }
    select, input {
      width: 100%;
      min-height: 40px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #fff;
      color: var(--ink);
      padding: 9px 10px;
    }
    .route-nav {
      display: grid;
      gap: 8px;
    }
    .route-button {
      min-height: 56px;
      border: 1px solid var(--line);
      background: var(--panel);
      color: var(--ink);
      border-radius: 8px;
      padding: 10px;
      text-align: left;
      cursor: pointer;
    }
    .route-button.is-active {
      border-color: var(--black);
      box-shadow: inset 4px 0 0 var(--green);
    }
    .route-name { display: block; font-weight: 800; }
    .route-meta { display: block; color: var(--muted); font-size: 12px; margin-top: 2px; overflow-wrap: anywhere; }
    .main {
      min-width: 0;
      padding: 22px;
      display: grid;
      gap: 18px;
      align-content: start;
    }
    .top-row {
      display: flex;
      gap: 12px;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      border-bottom: 1px solid var(--line);
      padding-bottom: 14px;
    }
    h1 {
      margin: 0;
      font-size: clamp(24px, 4vw, 42px);
      line-height: 1.05;
    }
    .build-tag {
      color: var(--muted);
      font-size: 12px;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 5px 9px;
      background: #fff;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
    }
    .stat {
      min-height: 74px;
      border: 1px solid var(--line);
      background: var(--panel);
      border-radius: 8px;
      padding: 10px;
      overflow: hidden;
    }
    .stat-label {
      color: var(--muted);
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      margin-bottom: 6px;
    }
    .stat-value {
      font-size: 16px;
      font-weight: 800;
      overflow-wrap: anywhere;
    }
    .work-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.15fr) minmax(320px, 0.85fr);
      gap: 14px;
      align-items: start;
    }
    .exchange-panel, .proof-panel {
      border: 1px solid var(--line);
      background: var(--panel);
      border-radius: 8px;
      padding: 14px;
    }
    .panel-head {
      display: flex;
      align-items: start;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 12px;
    }
    .panel-title { font-size: 18px; font-weight: 900; }
    .pill {
      flex: 0 0 auto;
      display: inline-flex;
      align-items: center;
      min-height: 26px;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 4px 8px;
      font-size: 12px;
      font-weight: 800;
      background: #f7f7f5;
    }
    .pill.is-enabled { color: #fff; background: var(--green); border-color: var(--green); }
    .pill.is-disabled { color: #fff; background: var(--amber); border-color: var(--amber); }
    .pill.is-missing { color: #fff; background: var(--red); border-color: var(--red); }
    .exchange-form {
      display: grid;
      gap: 12px;
    }
    .amount-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 8px;
      align-items: end;
    }
    .max-btn, .primary-btn, .secondary-btn {
      min-height: 40px;
      border: 1px solid var(--black);
      border-radius: 6px;
      padding: 9px 12px;
      font-weight: 800;
      background: #fff;
      color: var(--black);
      cursor: pointer;
      white-space: nowrap;
    }
    .primary-btn {
      background: var(--black);
      color: #fff;
      width: 100%;
    }
    .secondary-btn {
      border-color: var(--line);
      color: var(--ink);
      width: 100%;
    }
    button:disabled {
      cursor: not-allowed;
      opacity: .55;
    }
    .quote-box {
      min-height: 74px;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 10px;
      background: #f9f7f2;
      color: var(--muted);
      overflow-wrap: anywhere;
    }
    .proof-list {
      display: grid;
      gap: 9px;
    }
    .proof-row {
      display: grid;
      grid-template-columns: 120px minmax(0, 1fr);
      gap: 10px;
      min-height: 30px;
      align-items: start;
      border-bottom: 1px solid #ece7dd;
      padding-bottom: 8px;
    }
    .proof-key { color: var(--muted); font-size: 12px; font-weight: 800; }
    .proof-value { overflow-wrap: anywhere; font-size: 13px; }
    .status-line {
      min-height: 24px;
      color: var(--muted);
      overflow-wrap: anywhere;
    }
    .status-line.is-error { color: var(--red); }
    .status-line.is-ok { color: var(--green); }
    .shop-body {
      display: grid;
      gap: 8px;
    }
    .shop-title { font-weight: 900; }
    .shop-meta { color: var(--muted); font-size: 12px; line-height: 1.35; }
    @media (max-width: 920px) {
      .exchange-shell { grid-template-columns: 1fr; }
      .side { border-right: 0; border-bottom: 1px solid var(--line); }
      .route-nav { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .stats-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .work-grid { grid-template-columns: 1fr; }
    }
    @media (max-width: 560px) {
      .main, .side { padding: 14px; }
      .route-nav { grid-template-columns: 1fr; }
      .stats-grid { grid-template-columns: 1fr; }
      .proof-row { grid-template-columns: 1fr; gap: 2px; }
      .amount-row { grid-template-columns: 1fr; }
      h1 { font-size: 28px; }
    }
  </style>
</head>
<body>
  <div class="exchange-shell" data-api-base="${escapeHtml(apiBase)}" data-selected-route="${escapeHtml(selectedRoute)}">
    <aside class="side">
      <div class="brand">
        <img src="${escapeHtml(logoSrc)}" alt="" />
        <div>
          <div class="brand-title">RATi Reference Exchange</div>
          <div class="brand-sub">Burn source. Mint canonical.</div>
        </div>
      </div>
      <div class="cluster-control">
        <label class="label" for="cluster-select">Cluster</label>
        <select id="cluster-select"></select>
      </div>
      <nav class="route-nav" id="route-nav" aria-label="Exchange routes"></nav>
      <div class="wallet-panel">
        <span class="label">Wallet</span>
        <button class="secondary-btn" id="connect-wallet" type="button">Connect</button>
        <div class="route-meta" id="wallet-address">No wallet</div>
      </div>
      <div class="source-shop" id="source-shop"></div>
    </aside>
    <main class="main">
      <div class="top-row">
        <h1 id="page-title">Exchange</h1>
        <span class="build-tag">build ${escapeHtml(opts.build)}</span>
      </div>
      <section class="stats-grid" id="stats-grid"></section>
      <section class="work-grid">
        <div class="exchange-panel">
          <div class="panel-head">
            <div>
              <div class="panel-title" id="route-title">Route</div>
              <div class="route-meta" id="route-subtitle"></div>
            </div>
            <span class="pill" id="route-status">loading</span>
          </div>
          <form class="exchange-form" id="exchange-form">
            <div class="amount-row">
              <label>
                <span class="label" id="amount-label">Destination amount</span>
                <input id="amount-input" inputmode="decimal" autocomplete="off" placeholder="All available" />
              </label>
              <button class="max-btn" id="max-button" type="button">All</button>
            </div>
            <div class="quote-box" id="quote-box">Connect a wallet to prepare a burn.</div>
            <button class="primary-btn" id="burn-button" type="submit" disabled>Burn and Mint</button>
            <div class="status-line" id="status-line"></div>
          </form>
        </div>
        <div class="proof-panel">
          <div class="panel-head">
            <div class="panel-title">Reference Proof</div>
          </div>
          <div class="proof-list" id="proof-list"></div>
        </div>
      </section>
    </main>
  </div>
  <script type="module">
    const shell = document.querySelector(".exchange-shell");
    const apiBase = shell.dataset.apiBase;
    const state = {
      status: null,
      stats: null,
      cluster: "devnet",
      routeId: shell.dataset.selectedRoute || "ruby",
      wallet: null,
      busy: false,
      useMax: true
    };
    const els = {
      cluster: document.getElementById("cluster-select"),
      nav: document.getElementById("route-nav"),
      wallet: document.getElementById("wallet-address"),
      connect: document.getElementById("connect-wallet"),
      shop: document.getElementById("source-shop"),
      title: document.getElementById("page-title"),
      stats: document.getElementById("stats-grid"),
      routeTitle: document.getElementById("route-title"),
      routeSubtitle: document.getElementById("route-subtitle"),
      routeStatus: document.getElementById("route-status"),
      amountLabel: document.getElementById("amount-label"),
      amount: document.getElementById("amount-input"),
      max: document.getElementById("max-button"),
      quote: document.getElementById("quote-box"),
      burn: document.getElementById("burn-button"),
      form: document.getElementById("exchange-form"),
      proof: document.getElementById("proof-list"),
      status: document.getElementById("status-line")
    };
    function short(value) {
      const clean = String(value || "");
      return clean.length > 12 ? clean.slice(0, 5) + "..." + clean.slice(-5) : clean;
    }
    function selectedCluster() {
      return (state.status && state.status.clusters || []).find((cluster) => cluster.id === state.cluster);
    }
    function selectedRoute() {
      const cluster = selectedCluster();
      return cluster && cluster.routes.find((route) => route.id === state.routeId);
    }
    function setStatus(message, kind) {
      els.status.textContent = message || "";
      els.status.className = "status-line" + (kind ? " is-" + kind : "");
    }
    function baseUnitsFromUi(raw, decimals) {
      const clean = String(raw || "").trim();
      if (!clean) return "";
      if (!/^(?:0|[1-9]\\d*)(?:\\.\\d+)?$/.test(clean)) throw new Error("Enter a valid amount.");
      const parts = clean.split(".");
      const whole = parts[0] || "0";
      const frac = parts[1] || "";
      if (frac.length > decimals) throw new Error("Amount has too many decimal places.");
      return (BigInt(whole) * (10n ** BigInt(decimals)) + BigInt((frac || "0").padEnd(decimals, "0"))).toString();
    }
    function uiFromBaseUnits(value, decimals) {
      if (value == null || value === "") return "not found";
      const base = BigInt(value);
      if (decimals <= 0) return base.toString();
      const scale = 10n ** BigInt(decimals);
      const whole = base / scale;
      const frac = (base % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
      return frac ? whole.toString() + "." + frac : whole.toString();
    }
    function renderStats() {
      const route = selectedRoute();
      const stats = state.stats;
      const items = [
        ["Source burned", stats && stats.sourceBurnedBaseUnits != null ? uiFromBaseUnits(stats.sourceBurnedBaseUnits, route.sourceDecimals) + " " + route.sourceSymbol : "not configured"],
        ["Destination minted", stats && stats.destinationMintedBaseUnits != null ? uiFromBaseUnits(stats.destinationMintedBaseUnits, route.destinationDecimals) + " " + route.destinationSymbol : "not configured"],
        ["Migrations", stats && stats.migrationCount != null ? stats.migrationCount : "not configured"],
        ["Route state", stats && stats.sourceEnabled === true ? "enabled" : stats && stats.sourceEnabled === false ? "disabled" : route.status]
      ];
      els.stats.innerHTML = items.map(([label, value]) => '<div class="stat"><div class="stat-label">' + label + '</div><div class="stat-value">' + value + '</div></div>').join("");
    }
    function renderProof() {
      const cluster = selectedCluster();
      const route = selectedRoute();
      const stats = state.stats || {};
      const rows = [
        ["Program", cluster.programId],
        ["Source mint", route.sourceMint || "not configured"],
        ["Destination mint", route.destinationMint],
        ["Source config", stats.sourceConfigAddress || "pending"],
        ["Destination config", stats.destinationConfigAddress || "pending"],
        ["Mint authority", stats.mintAuthorityAddress || "pending"],
        ["Ratio", route.ratioLabel],
        ["Compatibility", route.compatibilityLabel || "RATi OS / RATi"],
        ["RPC", route.rpcHost]
      ];
      els.proof.innerHTML = rows.map(([key, value]) => '<div class="proof-row"><div class="proof-key">' + key + '</div><div class="proof-value">' + value + '</div></div>').join("");
    }
    function renderShop() {
      const route = selectedRoute();
      const seller = route.sourceSeller || {};
      const enabled = !!seller.enabled;
      els.shop.innerHTML = '<div class="shop-body"><div class="shop-title">Devnet Source Shop</div><div class="shop-meta">' + (enabled ? seller.mintAmount + ' ' + route.sourceSymbol + ' for ' + seller.priceSol + ' devnet SOL' : seller.reason || 'Source shop disabled.') + '</div><button class="secondary-btn" id="buy-source-button" type="button" ' + (enabled && !state.busy ? '' : 'disabled') + '>' + (enabled ? 'Buy source' : 'Not live') + '</button></div>';
      const button = document.getElementById("buy-source-button");
      if (button && enabled) button.addEventListener("click", buySource);
    }
    function renderRoutes() {
      const cluster = selectedCluster();
      els.nav.innerHTML = cluster.routes.map((route) => '<button class="route-button ' + (route.id === state.routeId ? 'is-active' : '') + '" data-route="' + route.id + '" type="button"><span class="route-name">' + route.destinationSymbol + '</span><span class="route-meta">' + route.sourceSymbol + ' -> ' + route.destinationSymbol + ' · ' + route.ratioLabel + '</span></button>').join("");
      els.nav.querySelectorAll("button[data-route]").forEach((button) => {
        button.addEventListener("click", () => {
          state.routeId = button.dataset.route;
          state.stats = null;
          history.replaceState(null, "", apiBase + "/exchange/" + state.routeId + "?cluster=" + encodeURIComponent(state.cluster));
          render();
          void refreshStats();
        });
      });
    }
    function render() {
      const cluster = selectedCluster();
      const route = selectedRoute();
      if (!cluster || !route) return;
      els.title.textContent = route.destinationSymbol + " Exchange";
      els.routeTitle.textContent = "Burn " + route.sourceSymbol + " for " + route.destinationSymbol;
      els.routeSubtitle.textContent = route.sourceDisplayName + " -> " + route.destinationDisplayName;
      els.amountLabel.textContent = "Destination amount (" + route.destinationSymbol + ")";
      els.routeStatus.textContent = route.status;
      els.routeStatus.className = "pill " + (route.enabled ? "is-enabled" : route.configured ? "is-disabled" : "is-missing");
      els.burn.disabled = state.busy || !state.wallet || !route.enabled;
      els.connect.textContent = state.wallet ? "Connected" : "Connect";
      els.wallet.textContent = state.wallet ? short(state.wallet) : "No wallet";
      els.quote.textContent = route.enabled
        ? state.wallet ? "Ready to prepare a burn." : "Connect a wallet to prepare a burn."
        : (route.reason || "Route is not enabled.");
      renderRoutes();
      renderStats();
      renderProof();
      renderShop();
    }
    async function refreshStatus() {
      const response = await fetch(apiBase + "/exchange/status", { headers: { Accept: "application/json" } });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Exchange status unavailable.");
      state.status = data;
      state.cluster = new URL(location.href).searchParams.get("cluster") || data.defaultCluster || "devnet";
      els.cluster.innerHTML = data.clusters.map((cluster) => '<option value="' + cluster.id + '">' + cluster.label + '</option>').join("");
      els.cluster.value = state.cluster;
      els.cluster.addEventListener("change", () => {
        state.cluster = els.cluster.value;
        state.stats = null;
        history.replaceState(null, "", apiBase + "/exchange/" + state.routeId + "?cluster=" + encodeURIComponent(state.cluster));
        render();
        void refreshStats();
      }, { once: false });
      render();
    }
    async function refreshStats() {
      const route = selectedRoute();
      if (!route || !route.sourceMint) {
        state.stats = null;
        render();
        return;
      }
      try {
        const response = await fetch(apiBase + "/exchange/stats?cluster=" + encodeURIComponent(state.cluster) + "&route=" + encodeURIComponent(state.routeId));
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error || "Stats unavailable.");
        state.stats = data.stats;
      } catch (err) {
        state.stats = null;
        setStatus(err && err.message ? err.message : String(err), "error");
      }
      render();
    }
    async function connectWallet() {
      const provider = window.solana;
      if (!provider) throw new Error("No Solana wallet detected.");
      const connected = await provider.connect();
      state.wallet = connected && connected.publicKey ? connected.publicKey.toString() : provider.publicKey && provider.publicKey.toString();
      if (!state.wallet) throw new Error("Wallet did not return an address.");
      render();
    }
    async function web3() {
      return await import("https://esm.sh/@solana/web3.js@1.98.4");
    }
    async function submitBurn(event) {
      event.preventDefault();
      if (state.busy) return;
      const route = selectedRoute();
      if (!route || !route.enabled) return;
      state.busy = true;
      render();
      setStatus("Preparing transaction...", "");
      try {
        if (!state.wallet) await connectWallet();
        const amountBaseUnits = state.useMax ? "" : baseUnitsFromUi(els.amount.value, route.destinationDecimals);
        const response = await fetch(apiBase + "/exchange/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cluster: state.cluster,
            routeId: state.routeId,
            ownerWalletAddress: state.wallet,
            amountBaseUnits: amountBaseUnits || undefined
          })
        });
        const quote = await response.json();
        if (!response.ok || !quote.ok) throw new Error(quote.error || "Quote failed.");
        els.quote.textContent = "Burn " + uiFromBaseUnits(quote.sourceAmountBaseUnits, route.sourceDecimals) + " " + route.sourceSymbol + " -> mint " + uiFromBaseUnits(quote.destinationAmountBaseUnits, route.destinationDecimals) + " " + route.destinationSymbol + ".";
        setStatus("Opening wallet...", "");
        const provider = window.solana;
        const solanaWeb3 = await web3();
        const bytes = Uint8Array.from(atob(quote.transactionBase64), (c) => c.charCodeAt(0));
        const tx = solanaWeb3.Transaction.from(bytes);
        const signed = await provider.signTransaction(tx);
        const connection = new solanaWeb3.Connection(quote.rpcUrl, "confirmed");
        const signature = await connection.sendRawTransaction(signed.serialize(), { maxRetries: 5 });
        setStatus("Submitted " + short(signature), "ok");
        await connection.confirmTransaction(signature, "confirmed").catch(() => null);
        void refreshStats();
      } catch (err) {
        setStatus(err && err.message ? err.message : String(err), "error");
      } finally {
        state.busy = false;
        render();
      }
    }
    async function buySource() {
      if (state.busy) return;
      const route = selectedRoute();
      if (!route || !route.sourceSeller || !route.sourceSeller.enabled) return;
      state.busy = true;
      render();
      setStatus("Preparing source-token purchase...", "");
      try {
        if (!state.wallet) await connectWallet();
        const response = await fetch(apiBase + "/exchange/source-sale", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cluster: state.cluster,
            routeId: state.routeId,
            ownerWalletAddress: state.wallet
          })
        });
        const sale = await response.json();
        if (!response.ok || !sale.ok) throw new Error(sale.error || "Source-token purchase failed.");
        setStatus("Opening wallet...", "");
        const provider = window.solana;
        const solanaWeb3 = await web3();
        const bytes = Uint8Array.from(atob(sale.transactionBase64), (c) => c.charCodeAt(0));
        const tx = solanaWeb3.Transaction.from(bytes);
        const signed = await provider.signTransaction(tx);
        const connection = new solanaWeb3.Connection(sale.rpcUrl, "confirmed");
        const signature = await connection.sendRawTransaction(signed.serialize(), { maxRetries: 5 });
        setStatus("Bought " + uiFromBaseUnits(sale.sourceAmountBaseUnits, route.sourceDecimals) + " " + route.sourceSymbol + " · " + short(signature), "ok");
      } catch (err) {
        setStatus(err && err.message ? err.message : String(err), "error");
      } finally {
        state.busy = false;
        render();
      }
    }
    els.connect.addEventListener("click", () => connectWallet().catch((err) => setStatus(err.message || String(err), "error")));
    els.max.addEventListener("click", () => {
      state.useMax = true;
      els.amount.value = "";
      render();
    });
    els.amount.addEventListener("input", () => { state.useMax = !els.amount.value.trim(); });
    els.form.addEventListener("submit", submitBurn);
    refreshStatus().then(refreshStats).catch((err) => setStatus(err.message || String(err), "error"));
  </script>
</body>
</html>`;
}

export function renderExchangePage(pathname: string): string {
  return renderExchangeHtml({
    selectedRoute: selectedRouteFromPath(pathname),
    build: process.env.RUBY_HIGH_BUILD ?? "dev",
  });
}

function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = [];
  const scriptPattern = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(scriptPattern)) {
    const source = match[1] ?? "";
    if (!source.trim()) continue;
    const digest = createHash("sha256").update(source, "utf8").digest("base64");
    hashes.push(`'sha256-${digest}'`);
  }
  return hashes;
}

function setExchangeCsp(ctx: RouteContext, html: string): void {
  const res = ctx.res as { setHeader?: (name: string, value: string) => void };
  const hashes = inlineScriptHashes(html);
  res.setHeader?.("Content-Security-Policy", [
    "script-src 'self' https://esm.sh " + hashes.join(" "),
  ].join("; "));
}

export async function handleExchangeRoutes(ctx: RouteContext): Promise<boolean> {
  if (!ctx.pathname.startsWith(EXCHANGE_PREFIX)) return false;
  if (rejectBadExchangeMutation(ctx)) return true;

  if (ctx.method === "GET" && ctx.pathname === `${EXCHANGE_PREFIX}/status`) {
    ctx.json(ctx.res, publicExchangeStatus());
    return true;
  }

  if (ctx.method === "GET" && ctx.pathname === `${EXCHANGE_PREFIX}/stats`) {
    try {
      const stats = await exchangeRouteStats(
        ctx.url?.searchParams.get("cluster") ?? undefined,
        ctx.url?.searchParams.get("route") ?? undefined,
      );
      ctx.json(ctx.res, { ok: true, stats });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.error(ctx.res, message, 400);
    }
    return true;
  }

  if (ctx.method === "POST" && ctx.pathname === `${EXCHANGE_PREFIX}/quote`) {
    const body = (await ctx.readJsonBody().catch(() => ({}))) as Record<string, unknown>;
    const ownerWalletAddress = typeof body.ownerWalletAddress === "string" ? body.ownerWalletAddress.trim() : "";
    if (!ownerWalletAddress) {
      ctx.error(ctx.res, "Connect a Solana wallet before preparing an exchange.", 400);
      return true;
    }
    try {
      const prepared = await buildExchangeTransaction({
        cluster: typeof body.cluster === "string" ? body.cluster : undefined,
        routeId: typeof body.routeId === "string" ? body.routeId : undefined,
        ownerWalletAddress,
        amountBaseUnits: typeof body.amountBaseUnits === "string" ? body.amountBaseUnits : undefined,
        maxSourceAmountBaseUnits: typeof body.maxSourceAmountBaseUnits === "string" ? body.maxSourceAmountBaseUnits : undefined,
        sourceTokenAccountAddress: typeof body.sourceTokenAccountAddress === "string" ? body.sourceTokenAccountAddress : undefined,
        userNonce: typeof body.userNonce === "string" || typeof body.userNonce === "number" ? body.userNonce : undefined,
      });
      ctx.json(ctx.res, { ok: true, ...prepared });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error("exchange.quote-failed", err, {
        ownerWalletAddress,
        cluster: typeof body.cluster === "string" ? body.cluster : null,
        routeId: typeof body.routeId === "string" ? body.routeId : null,
      });
      ctx.error(ctx.res, message, /not enabled|not configured|invalid/i.test(message) ? 400 : 502);
    }
    return true;
  }

  if (ctx.method === "POST" && ctx.pathname === `${EXCHANGE_PREFIX}/source-sale`) {
    const body = (await ctx.readJsonBody().catch(() => ({}))) as Record<string, unknown>;
    const ownerWalletAddress = typeof body.ownerWalletAddress === "string" ? body.ownerWalletAddress.trim() : "";
    if (!ownerWalletAddress) {
      ctx.error(ctx.res, "Connect a Solana wallet before buying devnet source tokens.", 400);
      return true;
    }
    try {
      const prepared = await buildSourceSaleTransaction({
        cluster: typeof body.cluster === "string" ? body.cluster : undefined,
        routeId: typeof body.routeId === "string" ? body.routeId : undefined,
        ownerWalletAddress,
      });
      ctx.json(ctx.res, { ok: true, ...prepared });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error("exchange.source-sale-failed", err, {
        ownerWalletAddress,
        cluster: typeof body.cluster === "string" ? body.cluster : null,
        routeId: typeof body.routeId === "string" ? body.routeId : null,
      });
      ctx.error(ctx.res, message, /not enabled|not configured|invalid|devnet-only/i.test(message) ? 400 : 502);
    }
    return true;
  }

  if (ctx.method === "GET" || ctx.method === "HEAD") {
    const html = renderExchangePage(ctx.pathname);
    setExchangeCsp(ctx, html);
    sendHtmlResponse(ctx.res, ctx.method === "GET" ? html : "", ctx.acceptEncoding);
    return true;
  }

  ctx.error(ctx.res, "Exchange route not found.", 404);
  return true;
}
