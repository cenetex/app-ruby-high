import React, { useCallback, useEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
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
  useSignAndSendTransaction,
  useWallets as useSolanaWallets,
  toSolanaWalletConnectors,
  type ConnectedStandardSolanaWallet,
} from "@privy-io/react-auth/solana";
import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createNoopSigner,
  createSolanaRpc,
  createTransactionMessage,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getTransferCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";

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
  solanaWalletAddress: string | null;
  solanaAccountAddress: string | null;
  accessToken?: string | null;
}

type SessionListener = (session: RubyHighPrivySession) => void | Promise<void>;

interface SolanaPaymentQuote {
  product?: {
    id?: string;
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
}

interface SolanaPaymentResult {
  signature: string;
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
  signAndSendSolanaTransaction(transaction: SolanaPreparedTransaction): Promise<SolanaPaymentResult>;
  onSession(listener: SessionListener): () => void;
}

interface BridgeApi {
  current(): Promise<RubyHighPrivySession>;
  login(): Promise<RubyHighPrivySession | null>;
  connectSolanaWallet(): Promise<RubyHighPrivySession | null>;
  logout(): Promise<void>;
  paySolanaQuote(quote: SolanaPaymentQuote): Promise<SolanaPaymentResult>;
  signAndSendSolanaTransaction(transaction: SolanaPreparedTransaction): Promise<SolanaPaymentResult>;
}

interface PendingLogin {
  resolve: (session: RubyHighPrivySession | null) => void;
  reject: (err: unknown) => void;
  timeoutId?: number;
}

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const DEFAULT_SOLANA_RPC_URL = "https://api.mainnet-beta.solana.com";
const PRIVY_ACTION_TIMEOUT_MS = 30_000;
const SOLANA_WALLET_READY_TIMEOUT_MS = 5_000;
const RUBY_HIGH_LOGIN_METHODS: NonNullable<PrivyClientConfig["loginMethods"]> = ["wallet", "email", "google", "twitter"];
const RUBY_HIGH_SOLANA_WALLET_LIST: WalletListEntry[] = ["phantom", "solflare", "backpack", "detected_solana_wallets"];

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
    connectSolanaWallet: () => requireBridge(bridgeApi).connectSolanaWallet(),
    logout: () => requireBridge(bridgeApi).logout(),
    paySolanaQuote: (quote) => requireBridge(bridgeApi).paySolanaQuote(quote),
    signAndSendSolanaTransaction: (transaction) => requireBridge(bridgeApi).signAndSendSolanaTransaction(transaction),
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
            loginMethods: RUBY_HIGH_LOGIN_METHODS,
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
              showWalletLoginFirst: true,
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
  notify: (session: RubyHighPrivySession) => void;
  register: (api: BridgeApi, ready: boolean) => void;
}): null {
  const privy = usePrivy();
  const modal = useModalStatus();
  const solanaWallets = useSolanaWallets();
  const { signAndSendTransaction } = useSignAndSendTransaction();
  const pendingLogin = useRef<PendingLogin | null>(null);
  const pendingWalletConnect = useRef<PendingLogin | null>(null);
  const modalOpenedForLogin = useRef(false);
  const modalOpenedForWalletConnect = useRef(false);
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
  ): Promise<RubyHighPrivySession> => {
    if (!privy.ready) return emptySession();
    const user = userOverride ?? privy.user;
    if (!privy.authenticated || !user) return emptySession();
    const accessToken = await privy.getAccessToken();
    return sessionFromUser(user, accessToken, firstSolanaWalletAddress(connectedWallets ?? solanaWalletsRef.current));
  }, [privy]);

  const paySolanaQuote = useCallback(async (quote: SolanaPaymentQuote): Promise<SolanaPaymentResult> => {
    if (!privy.ready || !privy.authenticated) throw new Error("Connect your Ruby High account first.");
    if (!solanaWallets.ready) throw new Error("Solana wallets are still starting.");
    const wallet = selectSolanaWallet(solanaWalletsRef.current);
    if (!wallet) throw new Error("Connect a Solana wallet first.");
    const transaction = quote.transactionBase64 || quote.transaction
      ? base64Decode(quote.transactionBase64 || quote.transaction || "")
      : await buildSplTokenPaymentTransaction(quote, wallet.address);
    const result = await signAndSendTransaction({
      transaction,
      wallet,
      chain: quote.chain || "solana:mainnet",
    });
    return {
      signature: base58Encode(result.signature),
      walletAddress: wallet.address,
    };
  }, [privy.authenticated, privy.ready, signAndSendTransaction, solanaWallets.ready]);

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
      signature: base58Encode(result.signature),
      walletAddress: wallet.address,
    };
  }, [privy.authenticated, privy.ready, signAndSendTransaction, solanaWallets.ready]);

  const { connectWallet } = useConnectWallet({
    onSuccess: () => {
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
      rejectPendingWalletConnect(new Error(String(error || "Solana wallet connection failed")));
    },
  });

  const { login } = useLogin({
    onComplete: ({ user }) => {
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
        const result = login({ loginMethods: RUBY_HIGH_LOGIN_METHODS, walletChainType: "solana-only" }) as unknown;
        if (result && typeof (result as PromiseLike<unknown>).then === "function") {
          void Promise.resolve(result).catch((err) => rejectPendingLogin(err));
        }
      } catch (err) {
        rejectPendingLogin(err);
      }
    });
  }, [current, login, privy.authenticated, privy.ready, privy.user]);

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
          description: "Connect Phantom or another Solana wallet to buy Ruby High packs.",
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
    void current().then((session) => {
      if (session.authenticated) props.notify(session);
    });
  }, [current, privy.ready, props]);

  return null;
}

async function buildSplTokenPaymentTransaction(
  quote: SolanaPaymentQuote,
  payerAddressText: string,
): Promise<Uint8Array> {
  const payerAddress = address(cleanAddress(payerAddressText, "Solana wallet"));
  const recipientAddress = address(cleanAddress(quote.recipient, "Solana recipient"));
  const mintAddress = address(cleanAddress(quote.mint, "Solana token mint"));
  const referenceAddress = address(cleanAddress(quote.reference, "Solana payment reference"));
  const decimals = readTokenDecimals(quote.decimals);
  const amount = readBaseUnitAmount(quote.product?.tokenAmountBaseUnits);
  const rpcUrl = cleanRpcUrl(quote.rpcUrl);
  const payer = createNoopSigner(payerAddress);
  const [sourceAta] = await findAssociatedTokenPda({
    owner: payerAddress,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
    mint: mintAddress,
  });
  const [destinationAta] = await findAssociatedTokenPda({
    owner: recipientAddress,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
    mint: mintAddress,
  });
  const createDestinationAtaInstruction = getCreateAssociatedTokenIdempotentInstruction({
    payer,
    ata: destinationAta,
    owner: recipientAddress,
    mint: mintAddress,
  });
  const transferInstruction = getTransferCheckedInstruction({
    source: sourceAta,
    mint: mintAddress,
    destination: destinationAta,
    authority: payer,
    amount,
    decimals,
  });
  const transferWithReference = {
    ...transferInstruction,
    accounts: [
      ...transferInstruction.accounts,
      { address: referenceAddress, role: AccountRole.READONLY },
    ],
  };
  const { value: latestBlockhash } = await createSolanaRpc(rpcUrl).getLatestBlockhash().send();
  return pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayer(payerAddress, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
    (tx) => appendTransactionMessageInstructions([createDestinationAtaInstruction, transferWithReference], tx),
    (tx) => compileTransaction(tx),
    (tx) => new Uint8Array(getTransactionEncoder().encode(tx)),
  );
}

function cleanAddress(value: unknown, label: string): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) throw new Error(`${label} is missing.`);
  return raw;
}

function cleanRpcUrl(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw || DEFAULT_SOLANA_RPC_URL;
}

function readBaseUnitAmount(value: unknown): bigint {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!/^\d+$/.test(raw)) throw new Error("Solana payment amount is missing.");
  const amount = BigInt(raw);
  if (amount <= 0n) throw new Error("Solana payment amount must be positive.");
  return amount;
}

function readTokenDecimals(value: unknown): number {
  const decimals = Math.floor(Number(value));
  if (!Number.isFinite(decimals) || decimals < 0 || decimals > 18) {
    throw new Error("Solana token decimals are invalid.");
  }
  return decimals;
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

function base64Decode(value: string): Uint8Array {
  const clean = value.trim();
  if (!clean) throw new Error("Solana transaction is missing.");
  const binary = window.atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
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
