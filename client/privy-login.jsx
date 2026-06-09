import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { PrivyProvider, usePrivy } from "@privy-io/react-auth";

const config = window.RUBY_HIGH_PRIVY_CONFIG || {};

function buildPrivyConfig() {
  const order = config.loginMethodsAndOrder || {};
  const primary = Array.isArray(order.primary) && order.primary.length > 0
    ? order.primary
    : ["google", "twitter", "email", "wallet"];
  const overflow = Array.isArray(order.overflow) ? order.overflow : [];
  return {
    loginMethodsAndOrder: { primary, overflow },
    appearance: {
      theme: "dark",
      accentColor: "#f4d35e",
      landingHeader: "Sign in to Ruby High",
      loginMessage: "Recover Hall Passes, purchases, and saved progress.",
      showWalletLoginFirst: false,
      loginGroupPriority: "web2-first",
      walletChainType: config.walletChainType || "ethereum-and-solana",
      walletList: [
        "detected_ethereum_wallets",
        "metamask",
        "coinbase_wallet",
        "wallet_connect",
        "detected_solana_wallets",
        "phantom",
        "solflare",
        "backpack",
        "wallet_connect_qr_solana",
      ],
    },
  };
}

function SigninPanel() {
  const { ready, authenticated, user, login, logout, getAccessToken } = usePrivy();
  const [status, setStatus] = useState("Choose a sign-in method to save this account.");
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (!ready || !authenticated || syncing) return;
    let cancelled = false;
    (async () => {
      setSyncing(true);
      setError("");
      setStatus("Saving account...");
      try {
        const accessToken = await getAccessToken();
        if (!accessToken) throw new Error("Privy did not return an access token.");
        const response = await fetch(config.authEndpoint || "/api/apps/ruby-high/auth/privy", {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            accessToken,
            userId: user && user.id,
          }),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok || !body.ok) {
          throw new Error(body.error || `Ruby High auth failed (${response.status}).`);
        }
        if (!cancelled) window.location.replace(config.redirectTo || "/api/apps/ruby-high/viewer");
      } catch (err) {
        if (!cancelled) {
          setError(err && err.message ? err.message : "Sign-in failed.");
          setStatus("Could not save the account.");
          try { await logout(); } catch {}
        }
      } finally {
        if (!cancelled) setSyncing(false);
      }
    })();
    return () => { cancelled = true; };
  }, [ready, authenticated, user && user.id, syncing, getAccessToken, logout]);

  const disabled = !ready || syncing;
  return (
    <div className="privy-shell">
      <h1>Save Your Ruby High Account</h1>
      <p>Use the same RATi account to recover Hall Passes, purchases, and saved progress across browsers.</p>
      <button type="button" onClick={() => login()} disabled={disabled}>
        {syncing ? "Saving..." : ready ? "Continue" : "Loading..."}
      </button>
      <a href={config.redirectTo || "/api/apps/ruby-high/viewer"}>Back to Ruby High</a>
      <div className={`privy-status${error ? " is-error" : ""}`} aria-live="polite">
        {error || status}
      </div>
    </div>
  );
}

function App() {
  const privyConfig = useMemo(() => buildPrivyConfig(), []);
  if (!config.appId) {
    return (
      <div className="privy-shell">
        <h1>Sign-in is not configured</h1>
        <p>Ruby High needs a Privy App ID before account recovery can be enabled.</p>
        <a href="/api/apps/ruby-high/viewer">Back to Ruby High</a>
      </div>
    );
  }
  return (
    <PrivyProvider appId={config.appId} config={privyConfig}>
      <SigninPanel />
    </PrivyProvider>
  );
}

createRoot(document.getElementById("root")).render(<App />);
