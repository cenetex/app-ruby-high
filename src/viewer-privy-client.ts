import React, { useCallback, useEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  getIdentityToken,
  PrivyProvider,
  useConnectWallet,
  useLogin,
  useModalStatus,
  usePrivy,
  type LinkedAccountWithMetadata,
  type PrivyClientConfig,
  type User,
  type WalletListEntry,
} from "@privy-io/react-auth";
import {
  useSignTransaction,
  useSignAndSendTransaction,
  useWallets as useSolanaWallets,
  toSolanaWalletConnectors,
  type ConnectedStandardSolanaWallet,
} from "@privy-io/react-auth/solana";

interface RubyHighPrivyConfig {
  appId: string;
  clientId: string;
  loginMethods?: RubyHighPrivyLoginMethod[];
}

interface RubyHighPrivySession {
  authenticated: boolean;
  userId: string | null;
  label: string | null;
  walletAddress: string | null;
  walletChainType: "ethereum" | "solana" | null;
  solanaWalletAddress: string | null;
  solanaAccountAddress: string | null;
  accessToken?: string | null;
  identityToken?: string | null;
}

type SessionListener = (session: RubyHighPrivySession) => void | Promise<void>;
type RubyHighPrivyLoginMethod = NonNullable<PrivyClientConfig["loginMethods"]>[number];
type DiagnosticValue = string | number | boolean | null | undefined;

interface PrivyDiagnosticEvent {
  [key: string]: DiagnosticValue;
  type: string;
  level?: "info" | "error";
  stage?: string;
  errorMessage?: string;
  errorName?: string;
  errorCode?: string;
  privyErrorCode?: string;
  status?: number;
  walletClientType?: string;
  connectorType?: string;
  provider?: string;
  addressPreview?: string | null;
  userIdPreview?: string | null;
  signatureBytes?: number;
}

type DiagnosticListener = (event: PrivyDiagnosticEvent) => void | Promise<void>;

interface SolanaPaymentQuote {
  product?: {
    id?: string;
    packCount?: number;
    cardCount?: number;
    hallPasses?: number;
    tokenAmount?: string;
    tokenAmountBaseUnits?: string;
    tokenSymbol?: string;
  };
  recipient?: string;
  mint?: string;
  symbol?: string;
  decimals?: number;
  reference?: string;
  rpcUrl?: string;
  transaction?: string;
  transactionBase64?: string;
  chain?: "solana:mainnet" | "solana:devnet" | "solana:testnet";
  assetAddress?: string;
  metadataUri?: string;
}

interface SolanaPaymentResult {
  signature: string;
  walletAddress: string;
}

interface SolanaSignedTransactionResult {
  signedTransactionBase64: string;
  walletAddress: string;
}

interface SolanaPreparedTransaction {
  transaction?: string;
  transactionBase64?: string;
  chain?: "solana:mainnet" | "solana:devnet" | "solana:testnet";
}

interface RubyHighPrivyClient {
  current(): Promise<RubyHighPrivySession>;
  login(): Promise<RubyHighPrivySession | null>;
  connectSolanaWallet(): Promise<RubyHighPrivySession | null>;
  logout(): Promise<void>;
  paySolanaQuote(quote: SolanaPaymentQuote): Promise<SolanaPaymentResult>;
  signSolanaTransaction(transaction: SolanaPreparedTransaction): Promise<SolanaSignedTransactionResult>;
  signAndSendSolanaTransaction(transaction: SolanaPreparedTransaction): Promise<SolanaPaymentResult>;
  onSession(listener: SessionListener): () => void;
  onDiagnostic(listener: DiagnosticListener): () => void;
}

interface BridgeApi {
  current(): Promise<RubyHighPrivySession>;
  login(): Promise<RubyHighPrivySession | null>;
  connectSolanaWallet(): Promise<RubyHighPrivySession | null>;
  logout(): Promise<void>;
  paySolanaQuote(quote: SolanaPaymentQuote): Promise<SolanaPaymentResult>;
  signSolanaTransaction(transaction: SolanaPreparedTransaction): Promise<SolanaSignedTransactionResult>;
  signAndSendSolanaTransaction(transaction: SolanaPreparedTransaction): Promise<SolanaPaymentResult>;
}

interface PendingLogin {
  resolve: (session: RubyHighPrivySession | null) => void;
  reject: (err: unknown) => void;
  timeoutId?: number;
}

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const PRIVY_ACTION_TIMEOUT_MS = 30_000;
const SOLANA_WALLET_READY_TIMEOUT_MS = 5_000;
const RUBY_HIGH_SOLANA_WALLET_LIST: WalletListEntry[] = ["phantom", "solflare", "backpack", "detected_solana_wallets"];
const DEFAULT_RUBY_HIGH_PRIVY_LOGIN_METHODS: RubyHighPrivyLoginMethod[] = ["email", "wallet", "google", "twitter", "passkey"];
const RUBY_HIGH_PRIVY_LOGIN_METHODS = new Set<RubyHighPrivyLoginMethod>([
  "wallet",
  "email",
  "sms",
  "google",
  "twitter",
  "discord",
  "github",
  "linkedin",
  "spotify",
  "instagram",
  "tiktok",
  "line",
  "twitch",
  "apple",
  "farcaster",
  "telegram",
  "passkey",
]);

let mountedRoot: Root | null = null;
let mountedConfigKey = "";
let mountedClient: RubyHighPrivyClient | null = null;

function loginMethodsForConfig(config: RubyHighPrivyConfig): RubyHighPrivyLoginMethod[] {
  const methods: RubyHighPrivyLoginMethod[] = [];
  for (const method of Array.isArray(config.loginMethods) ? config.loginMethods : []) {
    const normalized = normalizePrivyLoginMethod(String(method));
    if (normalized && !methods.includes(normalized)) methods.push(normalized);
  }
  return methods.length ? methods : [...DEFAULT_RUBY_HIGH_PRIVY_LOGIN_METHODS];
}

function normalizePrivyLoginMethod(value: string): RubyHighPrivyLoginMethod | null {
  const method = value.trim().toLowerCase();
  if (!method) return null;
  if (method.startsWith("privy:") && method.length > "privy:".length) {
    return method as RubyHighPrivyLoginMethod;
  }
  return RUBY_HIGH_PRIVY_LOGIN_METHODS.has(method as RubyHighPrivyLoginMethod)
    ? method as RubyHighPrivyLoginMethod
    : null;
}

export async function createRubyHighPrivyClient(
  config: RubyHighPrivyConfig,
): Promise<RubyHighPrivyClient> {
  const loginMethods = loginMethodsForConfig(config);
  const configKey = `${config.appId}:${config.clientId}:${loginMethods.join(",")}`;
  if (mountedClient && mountedConfigKey === configKey) return mountedClient;

  const host = ensureHost();
  const listeners = new Set<SessionListener>();
  const diagnosticListeners = new Set<DiagnosticListener>();
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
    connectSolanaWallet: () => requireBridge(bridgeApi).connectSolanaWallet(),
    logout: () => requireBridge(bridgeApi).logout(),
    paySolanaQuote: (quote) => requireBridge(bridgeApi).paySolanaQuote(quote),
    signSolanaTransaction: (transaction) => requireBridge(bridgeApi).signSolanaTransaction(transaction),
    signAndSendSolanaTransaction: (transaction) => requireBridge(bridgeApi).signAndSendSolanaTransaction(transaction),
    onSession(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onDiagnostic(listener) {
      diagnosticListeners.add(listener);
      return () => diagnosticListeners.delete(listener);
    },
  };

  const notify = (session: RubyHighPrivySession) => {
    for (const listener of listeners) {
      void Promise.resolve(listener(session));
    }
  };

  const diagnose = (event: PrivyDiagnosticEvent) => {
    const clean = sanitizeDiagnosticEvent(event);
    for (const listener of diagnosticListeners) {
      void Promise.resolve(listener(clean));
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
    const bridge = React.createElement(RubyHighPrivyBridge, { diagnose, notify, register, loginMethods });
    mountedRoot.render(
      React.createElement(
        PrivyProvider,
        {
          appId: config.appId,
          clientId: config.clientId,
          config: {
            loginMethods,
            embeddedWallets: {
              ethereum: { createOnLogin: "off" },
              solana: { createOnLogin: "off" },
            },
            externalWallets: {
              solana: { connectors: toSolanaWalletConnectors({ shouldAutoConnect: true }) },
            },
            appearance: {
              theme: "dark",
              accentColor: "#df2f2f",
              showWalletLoginFirst: loginMethods[0] === "wallet",
              walletChainType: "solana-only",
              walletList: RUBY_HIGH_SOLANA_WALLET_LIST,
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
  diagnose: (event: PrivyDiagnosticEvent) => void;
  loginMethods: RubyHighPrivyLoginMethod[];
  notify: (session: RubyHighPrivySession) => void;
  register: (api: BridgeApi, ready: boolean) => void;
}): null {
  const privy = usePrivy();
  const modal = useModalStatus();
  const solanaWallets = useSolanaWallets();
  const { signTransaction } = useSignTransaction();
  const { signAndSendTransaction } = useSignAndSendTransaction();
  const pendingLogin = useRef<PendingLogin | null>(null);
  const pendingWalletConnect = useRef<PendingLogin | null>(null);
  const modalOpenedForLogin = useRef(false);
  const modalOpenedForWalletConnect = useRef(false);
  const initialSessionChecked = useRef(false);
  const solanaWalletsRef = useRef<ConnectedStandardSolanaWallet[]>([]);

  useEffect(() => {
    solanaWalletsRef.current = solanaWallets.wallets;
  }, [solanaWallets.wallets]);

  const resolvePendingLogin = (session: RubyHighPrivySession | null) => {
    const pending = pendingLogin.current;
    if (pending?.timeoutId) window.clearTimeout(pending.timeoutId);
    pending?.resolve(session);
    pendingLogin.current = null;
    modalOpenedForLogin.current = false;
  };

  const rejectPendingLogin = (err: unknown) => {
    const pending = pendingLogin.current;
    if (pending?.timeoutId) window.clearTimeout(pending.timeoutId);
    pending?.reject(err);
    pendingLogin.current = null;
    modalOpenedForLogin.current = false;
  };

  const resolvePendingWalletConnect = (session: RubyHighPrivySession | null) => {
    const pending = pendingWalletConnect.current;
    if (pending?.timeoutId) window.clearTimeout(pending.timeoutId);
    pending?.resolve(session);
    pendingWalletConnect.current = null;
    modalOpenedForWalletConnect.current = false;
  };

  const rejectPendingWalletConnect = (err: unknown) => {
    const pending = pendingWalletConnect.current;
    if (pending?.timeoutId) window.clearTimeout(pending.timeoutId);
    pending?.reject(err);
    pendingWalletConnect.current = null;
    modalOpenedForWalletConnect.current = false;
  };

  const current = useCallback(async (
    userOverride?: User | null,
    connectedWallets?: ConnectedStandardSolanaWallet[],
    connectedSolanaWalletAddress?: string | null,
  ): Promise<RubyHighPrivySession> => {
    if (!privy.ready) return emptySession();
    const user = userOverride ?? privy.user;
    if (!user || (!privy.authenticated && !userOverride)) return emptySession();
    const accessToken = await privy.getAccessToken();
    const identityToken = await getIdentityToken().catch(() => null);
    return sessionFromUser(
      user,
      accessToken,
      identityToken,
      connectedSolanaWalletAddress ?? firstSolanaWalletAddress(connectedWallets ?? solanaWalletsRef.current),
    );
  }, [privy]);

  const paySolanaQuote = useCallback(async (quote: SolanaPaymentQuote): Promise<SolanaPaymentResult> => {
    if (!privy.ready || !privy.authenticated) throw new Error("Connect your Ruby High account first.");
    if (!solanaWallets.ready) throw new Error("Solana wallets are still starting.");
    const wallet = selectSolanaWallet(solanaWalletsRef.current);
    if (!wallet) throw new Error("Connect a Solana wallet first.");
    if (!quote.transactionBase64 && !quote.transaction) {
      throw new Error("Pack checkout is missing its NFT transaction. Refresh Ruby High and try again.");
    }
    const transaction = base64Decode(quote.transactionBase64 || quote.transaction || "");
    const signed = await signTransaction({
      transaction,
      wallet,
      chain: quote.chain || "solana:mainnet",
    });
    const submitted = await submitSignedSolanaQuote(quote, signedTransactionBytes(signed), wallet.address);
    return {
      signature: submitted.signature,
      walletAddress: wallet.address,
    };
  }, [privy.authenticated, privy.ready, signTransaction, solanaWallets.ready]);

  const signSolanaPreparedTransaction = useCallback(async (
    prepared: SolanaPreparedTransaction,
  ): Promise<SolanaSignedTransactionResult> => {
    if (!privy.ready || !privy.authenticated) throw new Error("Connect your Ruby High account first.");
    if (!solanaWallets.ready) throw new Error("Solana wallets are still starting.");
    const wallet = selectSolanaWallet(solanaWalletsRef.current);
    if (!wallet) throw new Error("Connect a Solana wallet first.");
    const transaction = base64Decode(prepared.transactionBase64 || prepared.transaction || "");
    try {
      const signed = await signTransaction({
        transaction,
        wallet,
        chain: prepared.chain || "solana:mainnet",
      });
      return {
        signedTransactionBase64: base64Encode(signedTransactionBytes(signed)),
        walletAddress: wallet.address,
      };
    } catch (err) {
      props.diagnose(diagnosticFromError("privy.sign_transaction.error", err, { stage: "sign_transaction" }));
      if (/429|too many requests|rate.?limit/i.test(err instanceof Error ? err.message : String(err || ""))) {
        throw new Error("Privy is rate limiting wallet requests. Wait a minute, then try again.");
      }
      throw err;
    }
  }, [privy.authenticated, privy.ready, props, signTransaction, solanaWallets.ready]);

  const signAndSendSolanaPreparedTransaction = useCallback(async (
    prepared: SolanaPreparedTransaction,
  ): Promise<SolanaPaymentResult> => {
    if (!privy.ready || !privy.authenticated) throw new Error("Connect your Ruby High account first.");
    if (!solanaWallets.ready) throw new Error("Solana wallets are still starting.");
    const wallet = selectSolanaWallet(solanaWalletsRef.current);
    if (!wallet) throw new Error("Connect a Solana wallet first.");
    const transaction = base64Decode(prepared.transactionBase64 || prepared.transaction || "");
    const result = await signAndSendTransaction({
      transaction,
      wallet,
      chain: prepared.chain || "solana:mainnet",
    });
    return {
      signature: solanaSignatureString(result.signature),
      walletAddress: wallet.address,
    };
  }, [privy.authenticated, privy.ready, signAndSendTransaction, solanaWallets.ready]);

  const { connectWallet } = useConnectWallet({
    onSuccess: () => {
      props.diagnose({ type: "privy.connect_wallet.success", level: "info", stage: "connect_wallet" });
      window.setTimeout(() => {
        void waitForSolanaWallets(() => solanaWalletsRef.current).then(
          (wallets) => current(undefined, wallets),
        ).then(
          (session) => {
            props.notify(session);
            resolvePendingWalletConnect(session);
          },
          (err) => {
            rejectPendingWalletConnect(err);
          },
        );
      }, 0);
    },
    onError: (error) => {
      props.diagnose(diagnosticFromError("privy.connect_wallet.error", error, { stage: "connect_wallet" }));
      rejectPendingWalletConnect(new Error(String(error || "Solana wallet connection failed")));
    },
  });

  const { login } = useLogin({
    onComplete: ({ user }) => {
      props.diagnose({ type: "privy.login.success", level: "info", stage: "modal", userIdPreview: shortIdentifier(user.id) });
      void current(user).then(
        (session) => {
          props.notify(session);
          resolvePendingLogin(session);
        },
        (err) => {
          rejectPendingLogin(err);
        },
      );
    },
    onError: (error) => {
      props.diagnose(diagnosticFromError("privy.login.error", error, { stage: "modal" }));
      rejectPendingLogin(new Error(String(error || "Privy login failed")));
    },
  });

  const openLogin = useCallback((): Promise<RubyHighPrivySession | null> => {
    if (!privy.ready) return Promise.reject(new Error("Privy is still starting."));
    if (privy.authenticated && privy.user) return current(privy.user);
    if (pendingLogin.current) {
      return new Promise((resolve, reject) => {
        const previous = pendingLogin.current;
        if (!previous) {
          reject(new Error("Privy sign-in is not ready."));
          return;
        }
        const previousResolve = previous.resolve;
        const previousReject = previous.reject;
        previous.resolve = (session) => {
          previousResolve(session);
          resolve(session);
        };
        previous.reject = (err) => {
          previousReject(err);
          reject(err);
        };
      });
    }
    return new Promise((resolve, reject) => {
      const pending: PendingLogin = { resolve, reject };
      pending.timeoutId = window.setTimeout(() => {
        if (pendingLogin.current !== pending) return;
        rejectPendingLogin(new Error("Privy sign-in did not open. Refresh Ruby High and try again."));
      }, PRIVY_ACTION_TIMEOUT_MS);
      pendingLogin.current = pending;
      modalOpenedForLogin.current = false;
      try {
        props.diagnose({
          type: "privy.login.start",
          level: "info",
          stage: "modal",
          walletClientType: "solana_wallet",
          connectorType: "privy_modal",
          provider: "privy",
        });
        const result = login({
          loginMethods: props.loginMethods,
          walletChainType: "solana-only",
        }) as unknown;
        if (result && typeof (result as PromiseLike<unknown>).then === "function") {
          void Promise.resolve(result).catch((err) => {
            props.diagnose(diagnosticFromError("privy.login.promise_error", err, { stage: "modal" }));
            rejectPendingLogin(err);
          });
        }
      } catch (err) {
        props.diagnose(diagnosticFromError("privy.login.throw", err, { stage: "modal" }));
        rejectPendingLogin(err);
      }
    });
  }, [current, login, privy.authenticated, privy.ready, privy.user, props.loginMethods]);

  const connectSolanaWallet = useCallback((): Promise<RubyHighPrivySession | null> => {
    if (!privy.ready) return Promise.reject(new Error("Privy is still starting."));
    if (!privy.authenticated || !privy.user) return openLogin();
    if (pendingWalletConnect.current) {
      return new Promise((resolve, reject) => {
        const previous = pendingWalletConnect.current;
        if (!previous) {
          reject(new Error("Solana wallet connection is not ready."));
          return;
        }
        const previousResolve = previous.resolve;
        const previousReject = previous.reject;
        previous.resolve = (session) => {
          previousResolve(session);
          resolve(session);
        };
        previous.reject = (err) => {
          previousReject(err);
          reject(err);
        };
      });
    }
    return new Promise((resolve, reject) => {
      const pending: PendingLogin = { resolve, reject };
      pending.timeoutId = window.setTimeout(() => {
        if (pendingWalletConnect.current !== pending) return;
        rejectPendingWalletConnect(new Error("Solana wallet connection did not open. Refresh Ruby High and try again."));
      }, PRIVY_ACTION_TIMEOUT_MS);
      pendingWalletConnect.current = pending;
      modalOpenedForWalletConnect.current = false;
      try {
        const result = connectWallet({
          walletChainType: "solana-only",
          walletList: RUBY_HIGH_SOLANA_WALLET_LIST,
          description: "Connect a Solana wallet through Privy to buy Ruby High packs.",
        }) as unknown;
        if (result && typeof (result as PromiseLike<unknown>).then === "function") {
          void Promise.resolve(result).catch((err) => rejectPendingWalletConnect(err));
        }
      } catch (err) {
        rejectPendingWalletConnect(err);
      }
    });
  }, [connectWallet, openLogin, privy.authenticated, privy.ready, privy.user]);

  const logout = useCallback(async () => {
    await privy.logout();
    const session = emptySession();
    props.notify(session);
    resolvePendingLogin(null);
    resolvePendingWalletConnect(null);
  }, [privy, props]);

  useEffect(() => {
    props.register({
      current,
      login: openLogin,
      connectSolanaWallet,
      logout,
      paySolanaQuote,
      signSolanaTransaction: signSolanaPreparedTransaction,
      signAndSendSolanaTransaction: signAndSendSolanaPreparedTransaction,
    }, privy.ready);
  }, [
    connectSolanaWallet,
    current,
    logout,
    openLogin,
    paySolanaQuote,
    privy.ready,
    props,
    signSolanaPreparedTransaction,
    signAndSendSolanaPreparedTransaction,
  ]);

  useEffect(() => {
    if (modal.isOpen) {
      if (pendingLogin.current) modalOpenedForLogin.current = true;
      return;
    }
    if (!modalOpenedForLogin.current || !pendingLogin.current) return;
    resolvePendingLogin(null);
  }, [modal.isOpen]);

  useEffect(() => {
    if (modal.isOpen) {
      if (pendingWalletConnect.current) modalOpenedForWalletConnect.current = true;
      return;
    }
    if (!modalOpenedForWalletConnect.current || !pendingWalletConnect.current) return;
    resolvePendingWalletConnect(null);
  }, [modal.isOpen]);

  useEffect(() => {
    if (!privy.ready) return;
    if (initialSessionChecked.current) return;
    initialSessionChecked.current = true;
    void current().then((session) => {
      if (session.authenticated) props.notify(session);
    });
  }, [current, privy.ready, props]);

  return null;
}

function base58Encode(bytes: Uint8Array): string {
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i += 1) {
      carry += digits[i] * 256;
      digits[i] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let out = "";
  for (const byte of bytes) {
    if (byte !== 0) break;
    out += "1";
  }
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    out += BASE58_ALPHABET[digits[i]];
  }
  return out || "1";
}

function solanaSignatureString(signature: unknown): string {
  if (typeof signature === "string" && signature.trim()) return signature.trim();
  if (signature instanceof Uint8Array) return base58Encode(signature);
  throw new Error("Wallet did not return a Solana transaction signature.");
}

function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return window.btoa(binary);
}

function diagnosticFromError(
  type: string,
  err: unknown,
  extra: Partial<PrivyDiagnosticEvent> = {},
): PrivyDiagnosticEvent {
  const record = isRecord(err) ? err : {};
  const details = isRecord(record.details) ? record.details : {};
  const data = isRecord(record.data) ? record.data : {};
  const cause = isRecord(record.cause) ? record.cause : {};
  return sanitizeDiagnosticEvent({
    type,
    level: "error",
    ...extra,
    errorMessage: errorMessageFrom(err),
    errorName: stringDiagnostic(record.name),
    errorCode: stringDiagnostic(record.code ?? details.code ?? data.code),
    privyErrorCode: stringDiagnostic(record.privyErrorCode ?? record.privy_error_code ?? details.privyErrorCode),
    status: numberDiagnostic(record.status ?? record.statusCode ?? data.status),
    walletClientType: stringDiagnostic(record.walletClientType ?? record.wallet_client_type ?? extra.walletClientType),
    connectorType: stringDiagnostic(record.connectorType ?? record.connector_type ?? extra.connectorType),
    ...(stringDiagnostic(data.error) ? { dataError: stringDiagnostic(data.error) } as Record<string, DiagnosticValue> : {}),
    ...(stringDiagnostic(data.message) ? { dataMessage: stringDiagnostic(data.message) } as Record<string, DiagnosticValue> : {}),
    ...(stringDiagnostic(cause.message) ? { causeMessage: stringDiagnostic(cause.message) } as Record<string, DiagnosticValue> : {}),
  });
}

function sanitizeDiagnosticEvent(event: PrivyDiagnosticEvent): PrivyDiagnosticEvent {
  const out: Record<string, DiagnosticValue> = {};
  for (const [key, value] of Object.entries(event)) {
    if (/token|secret|signature$|siws|messageText/i.test(key)) continue;
    if (value == null || typeof value === "boolean" || typeof value === "number") {
      out[key] = value;
    } else if (typeof value === "string") {
      out[key] = clipDiagnostic(value, key === "errorMessage" || key.endsWith("Message") ? 240 : 96);
    }
  }
  out.type = typeof out.type === "string" && out.type ? out.type : "privy.diagnostic";
  return out as unknown as PrivyDiagnosticEvent;
}

function errorMessageFrom(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string") return err;
  const record = isRecord(err) ? err : {};
  const message = record.message ?? record.error_description ?? record.error;
  return stringDiagnostic(message) || String(err || "unknown error");
}

function shortIdentifier(value: string | null | undefined): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  return raw.length > 16 ? `${raw.slice(0, 6)}...${raw.slice(-4)}` : raw;
}

function stringDiagnostic(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const text = String(value).replace(/\s+/g, " ").trim();
  return text ? clipDiagnostic(text, 240) : undefined;
}

function numberDiagnostic(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? Math.floor(number) : undefined;
}

function clipDiagnostic(value: string, max: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}...` : clean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function base64Decode(value: string): Uint8Array {
  const clean = value.trim();
  if (!clean) throw new Error("Solana transaction is missing.");
  const binary = window.atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function signedTransactionBytes(result: unknown): Uint8Array {
  if (result instanceof Uint8Array) return result;
  if (result && typeof result === "object") {
    const record = result as Record<string, unknown>;
    const signed = record.signedTransaction ?? record.transaction;
    if (signed instanceof Uint8Array) return signed;
    if (typeof signed === "string") return base64Decode(signed);
  }
  throw new Error("Wallet did not return a signed Solana transaction.");
}

async function submitSignedSolanaQuote(
  quote: SolanaPaymentQuote,
  signedTransaction: Uint8Array,
  walletAddress: string,
): Promise<{ signature: string }> {
  const response = await fetch("/api/apps/ruby-high/billing/solana/submit", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      productId: quote.product?.id || "",
      ownerWalletAddress: walletAddress,
      packAssetAddress: quote.assetAddress || null,
      packMetadataUri: quote.metadataUri || null,
      signedTransactionBase64: base64Encode(signedTransaction),
    }),
  });
  const data = await response.json().catch(() => ({})) as { ok?: boolean; signature?: string; error?: string };
  if (!response.ok || !data?.ok || !data.signature) {
    throw new Error(data?.error || `Solana submit ${response.status}`);
  }
  return { signature: data.signature };
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
    solanaWalletAddress: null,
    solanaAccountAddress: null,
  };
}

function sessionFromUser(
  user: User,
  accessToken: string | null,
  identityToken: string | null,
  connectedSolanaWalletAddress: string | null,
): RubyHighPrivySession {
  const wallet = walletFromUser(user);
  const solanaWalletAddress = connectedSolanaWalletAddress;
  const solanaAccountAddress = solanaWalletAddress || solanaAddressFromUser(user);
  return {
    authenticated: true,
    userId: user.id,
    label: labelFromUser(user, wallet?.address ?? null),
    walletAddress: wallet?.address ?? null,
    walletChainType: wallet?.chainType ?? null,
    solanaWalletAddress,
    solanaAccountAddress,
    accessToken,
    identityToken,
  };
}

function walletFromUser(user: User): { address: string; chainType: "ethereum" | "solana"; rank: number } | null {
  const direct = walletCandidate(user.wallet);
  const wallets = [
    ...(direct ? [direct] : []),
    ...user.linkedAccounts
    .map((account) => walletCandidate(account))
    .filter((wallet): wallet is { address: string; chainType: "ethereum" | "solana"; rank: number } => !!wallet),
  ]
    .sort((a, b) => a.rank - b.rank);
  return wallets[0] ?? null;
}

function firstSolanaWalletAddress(wallets: ConnectedStandardSolanaWallet[]): string | null {
  return selectSolanaWallet(wallets)?.address ?? null;
}

function selectSolanaWallet(wallets: ConnectedStandardSolanaWallet[]): ConnectedStandardSolanaWallet | null {
  return wallets.find((wallet) => typeof wallet.address === "string" && !!wallet.address.trim()) ?? null;
}

function solanaAddressFromUser(user: User): string | null {
  const direct = walletCandidate(user.wallet);
  if (direct?.chainType === "solana") return direct.address;
  for (const account of user.linkedAccounts) {
    const wallet = walletCandidate(account);
    if (wallet?.chainType === "solana") return wallet.address;
  }
  return null;
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
  const rank = chainType === "solana"
    ? (embedded ? 0 : 1)
    : (embedded ? 2 : 3);
  return { address, chainType, rank };
}

function readChainType(record: Record<string, unknown>): "ethereum" | "solana" | null {
  const raw = record.chainType ?? record.chain_type;
  return raw === "ethereum" || raw === "solana" ? raw : null;
}

function waitForSolanaWallets(
  readWallets: () => ConnectedStandardSolanaWallet[],
): Promise<ConnectedStandardSolanaWallet[]> {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const wallets = readWallets();
      if (selectSolanaWallet(wallets)) {
        resolve(wallets);
        return;
      }
      if (Date.now() - startedAt >= SOLANA_WALLET_READY_TIMEOUT_MS) {
        reject(new Error("Privy connected a wallet, but did not expose a Solana signer. Refresh Ruby High and try again."));
        return;
      }
      window.setTimeout(check, 100);
    };
    check();
  });
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
