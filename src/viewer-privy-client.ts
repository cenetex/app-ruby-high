import React, { useCallback, useEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  PrivyProvider,
  useLogin,
  useModalStatus,
  usePrivy,
  type LinkedAccountWithMetadata,
  type User,
} from "@privy-io/react-auth";

interface RubyHighPrivyConfig {
  appId: string;
  clientId: string;
}

interface RubyHighPrivySession {
  authenticated: boolean;
  userId: string | null;
  label: string | null;
  walletAddress: string | null;
  walletChainType: "ethereum" | "solana" | null;
  accessToken?: string | null;
}

type SessionListener = (session: RubyHighPrivySession) => void | Promise<void>;

interface RubyHighPrivyClient {
  current(): Promise<RubyHighPrivySession>;
  login(): Promise<RubyHighPrivySession | null>;
  logout(): Promise<void>;
  onSession(listener: SessionListener): () => void;
}

interface BridgeApi {
  current(): Promise<RubyHighPrivySession>;
  login(): Promise<RubyHighPrivySession | null>;
  logout(): Promise<void>;
}

interface PendingLogin {
  resolve: (session: RubyHighPrivySession | null) => void;
  reject: (err: unknown) => void;
}

let mountedRoot: Root | null = null;
let mountedConfigKey = "";
let mountedClient: RubyHighPrivyClient | null = null;

export async function createRubyHighPrivyClient(
  config: RubyHighPrivyConfig,
): Promise<RubyHighPrivyClient> {
  const configKey = `${config.appId}:${config.clientId}`;
  if (mountedClient && mountedConfigKey === configKey) return mountedClient;

  const host = ensureHost();
  const listeners = new Set<SessionListener>();
  let bridgeApi: BridgeApi | null = null;
  let resolveReady!: (client: RubyHighPrivyClient) => void;
  let rejectReady!: (err: unknown) => void;

  const ready = new Promise<RubyHighPrivyClient>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const client: RubyHighPrivyClient = {
    current: () => requireBridge(bridgeApi).current(),
    login: () => requireBridge(bridgeApi).login(),
    logout: () => requireBridge(bridgeApi).logout(),
    onSession(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  const notify = (session: RubyHighPrivySession) => {
    for (const listener of listeners) {
      void Promise.resolve(listener(session));
    }
  };

  const register = (api: BridgeApi, readyState: boolean) => {
    bridgeApi = api;
    if (readyState) resolveReady(client);
  };

  try {
    mountedRoot?.unmount();
    mountedRoot = createRoot(host);
    mountedConfigKey = configKey;
    mountedClient = client;
    const bridge = React.createElement(RubyHighPrivyBridge, { notify, register });
    mountedRoot.render(
      React.createElement(
        PrivyProvider,
        {
          appId: config.appId,
          clientId: config.clientId,
          config: {
            embeddedWallets: {
              ethereum: { createOnLogin: "users-without-wallets" },
            },
            appearance: {
              theme: "dark",
              accentColor: "#df2f2f",
              showWalletLoginFirst: false,
            },
          },
          children: bridge,
        },
      ),
    );
  } catch (err) {
    mountedClient = null;
    rejectReady(err);
  }

  return ready;
}

function RubyHighPrivyBridge(props: {
  notify: (session: RubyHighPrivySession) => void;
  register: (api: BridgeApi, ready: boolean) => void;
}): null {
  const privy = usePrivy();
  const modal = useModalStatus();
  const pendingLogin = useRef<PendingLogin | null>(null);
  const modalOpenedForLogin = useRef(false);

  const current = useCallback(async (userOverride?: User | null): Promise<RubyHighPrivySession> => {
    if (!privy.ready) return emptySession();
    const user = userOverride ?? privy.user;
    if (!privy.authenticated || !user) return emptySession();
    const accessToken = await privy.getAccessToken();
    return sessionFromUser(user, accessToken);
  }, [privy]);

  const { login } = useLogin({
    onComplete: ({ user }) => {
      void current(user).then(
        (session) => {
          props.notify(session);
          pendingLogin.current?.resolve(session);
          pendingLogin.current = null;
          modalOpenedForLogin.current = false;
        },
        (err) => {
          pendingLogin.current?.reject(err);
          pendingLogin.current = null;
          modalOpenedForLogin.current = false;
        },
      );
    },
    onError: (error) => {
      pendingLogin.current?.reject(new Error(String(error || "Privy login failed")));
      pendingLogin.current = null;
      modalOpenedForLogin.current = false;
    },
  });

  const openLogin = useCallback((): Promise<RubyHighPrivySession | null> => {
    if (!privy.ready) return Promise.reject(new Error("Privy is still starting."));
    if (privy.authenticated && privy.user) return current(privy.user);
    if (pendingLogin.current) {
      return new Promise((resolve, reject) => {
        const previous = pendingLogin.current;
        pendingLogin.current = {
          resolve: (session) => {
            previous?.resolve(session);
            resolve(session);
          },
          reject: (err) => {
            previous?.reject(err);
            reject(err);
          },
        };
      });
    }
    return new Promise((resolve, reject) => {
      pendingLogin.current = { resolve, reject };
      modalOpenedForLogin.current = true;
      login();
    });
  }, [current, login, privy.authenticated, privy.ready, privy.user]);

  const logout = useCallback(async () => {
    await privy.logout();
    const session = emptySession();
    props.notify(session);
    pendingLogin.current?.resolve(null);
    pendingLogin.current = null;
    modalOpenedForLogin.current = false;
  }, [privy, props]);

  useEffect(() => {
    props.register({ current, login: openLogin, logout }, privy.ready);
  }, [current, logout, openLogin, privy.ready, props]);

  useEffect(() => {
    if (modal.isOpen) return;
    if (!modalOpenedForLogin.current || !pendingLogin.current) return;
    pendingLogin.current.resolve(null);
    pendingLogin.current = null;
    modalOpenedForLogin.current = false;
  }, [modal.isOpen]);

  useEffect(() => {
    if (!privy.ready) return;
    void current().then((session) => {
      if (session.authenticated) props.notify(session);
    });
  }, [current, privy.ready, props]);

  return null;
}

function ensureHost(): HTMLElement {
  const existing = document.getElementById("ruby-high-privy-root");
  if (existing) return existing;
  const host = document.createElement("div");
  host.id = "ruby-high-privy-root";
  document.body.appendChild(host);
  return host;
}

function requireBridge(api: BridgeApi | null): BridgeApi {
  if (!api) throw new Error("Privy is not ready.");
  return api;
}

function emptySession(): RubyHighPrivySession {
  return {
    authenticated: false,
    userId: null,
    label: null,
    walletAddress: null,
    walletChainType: null,
  };
}

function sessionFromUser(user: User, accessToken: string | null): RubyHighPrivySession {
  const wallet = walletFromUser(user);
  return {
    authenticated: true,
    userId: user.id,
    label: labelFromUser(user, wallet?.address ?? null),
    walletAddress: wallet?.address ?? null,
    walletChainType: wallet?.chainType ?? null,
    accessToken,
  };
}

function walletFromUser(user: User): { address: string; chainType: "ethereum" | "solana"; rank: number } | null {
  const direct = walletCandidate(user.wallet);
  if (direct) return direct;
  const wallets = user.linkedAccounts
    .map((account) => walletCandidate(account))
    .filter((wallet): wallet is { address: string; chainType: "ethereum" | "solana"; rank: number } => !!wallet)
    .sort((a, b) => a.rank - b.rank);
  return wallets[0] ?? null;
}

function walletCandidate(account: unknown): { address: string; chainType: "ethereum" | "solana"; rank: number } | null {
  if (!account || typeof account !== "object") return null;
  const record = account as Record<string, unknown>;
  const address = typeof record.address === "string" ? record.address.trim() : "";
  const chainType = readChainType(record);
  if (!address || !chainType) return null;
  const walletClient = typeof record.walletClientType === "string"
    ? record.walletClientType
    : typeof record.wallet_client === "string"
      ? record.wallet_client
      : "";
  const connectorType = typeof record.connectorType === "string"
    ? record.connectorType
    : typeof record.connector_type === "string"
      ? record.connector_type
      : "";
  const embedded = walletClient === "privy" || connectorType === "embedded";
  const rank = chainType === "ethereum"
    ? (embedded ? 0 : 1)
    : (embedded ? 2 : 3);
  return { address, chainType, rank };
}

function readChainType(record: Record<string, unknown>): "ethereum" | "solana" | null {
  const raw = record.chainType ?? record.chain_type;
  if (raw === "ethereum" || raw === "solana") return raw;
  const type = record.type;
  if (type === "wallet" || type === "smart_wallet") {
    const walletClient = record.walletClientType ?? record.wallet_client;
    if (walletClient === "phantom" || walletClient === "solflare") return "solana";
    return "ethereum";
  }
  return null;
}

function labelFromUser(user: User, walletAddress: string | null): string | null {
  if (user.email?.address) return user.email.address;
  for (const account of user.linkedAccounts) {
    const label = labelFromLinkedAccount(account);
    if (label) return label;
  }
  return walletAddress ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}` : null;
}

function labelFromLinkedAccount(account: LinkedAccountWithMetadata): string | null {
  const record = account as unknown as Record<string, unknown>;
  if (record.type === "email" && typeof record.address === "string" && record.address.trim()) {
    return record.address.trim();
  }
  if (record.type === "google_oauth" && typeof record.email === "string" && record.email.trim()) {
    return record.email.trim();
  }
  return null;
}
