import {
  PrivyClient,
  verifyAccessToken,
  verifyIdentityToken,
  type User,
} from "@privy-io/node";

export interface PrivyPublicConfig {
  appId: string;
  clientId: string;
  loginMethods: PrivyPublicLoginMethod[];
}

interface PrivyServerConfig {
  appId: string;
  appSecret?: string;
  verificationKey?: string;
}

export interface VerifiedPrivyIdentity {
  privyUserId: string;
  privySessionId?: string;
  label?: string;
  walletAddress?: string;
  walletChainType?: "ethereum" | "solana";
}

export interface VerifyPrivyAuthInput {
  accessToken?: string | null;
  identityToken?: string | null;
}

type PrivyVerifier = (input: VerifyPrivyAuthInput) => Promise<VerifiedPrivyIdentity>;
export type PrivyPublicLoginMethod =
  | "wallet"
  | "email"
  | "sms"
  | "google"
  | "twitter"
  | "discord"
  | "github"
  | "linkedin"
  | "spotify"
  | "instagram"
  | "tiktok"
  | "line"
  | "twitch"
  | "apple"
  | "farcaster"
  | "telegram"
  | "passkey"
  | `privy:${string}`;

let verifierOverride: PrivyVerifier | null = null;
let cachedClientKey = "";
let cachedClient: PrivyClient | null = null;

const DEFAULT_PRIVY_LOGIN_METHODS: PrivyPublicLoginMethod[] = ["wallet"];
const PRIVY_LOGIN_METHODS = new Set<PrivyPublicLoginMethod>([
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

export function getPrivyPublicConfigFromEnv(env: NodeJS.ProcessEnv = process.env): PrivyPublicConfig | null {
  const appId = cleanEnv(env.RUBY_HIGH_PRIVY_APP_ID);
  const clientId = cleanEnv(env.RUBY_HIGH_PRIVY_CLIENT_ID);
  if (!appId || !clientId) return null;
  return {
    appId,
    clientId,
    loginMethods: parsePrivyLoginMethods(env.RUBY_HIGH_PRIVY_LOGIN_METHODS),
  };
}

export function privyServerConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const config = readServerConfig(env);
  return !!(config && (config.appSecret || config.verificationKey));
}

export function setPrivyAuthVerifierForTest(verifier: PrivyVerifier | null): () => void {
  const previous = verifierOverride;
  verifierOverride = verifier;
  return () => {
    verifierOverride = previous;
  };
}

export async function verifyPrivyAuth(input: VerifyPrivyAuthInput): Promise<VerifiedPrivyIdentity> {
  if (verifierOverride) return verifierOverride(input);

  const accessToken = cleanInput(input.accessToken);
  const identityToken = cleanInput(input.identityToken);
  if (!accessToken && !identityToken) {
    throw new Error("Privy token missing.");
  }

  const config = readServerConfig();
  if (!config) throw new Error("Privy server config is missing RUBY_HIGH_PRIVY_APP_ID.");
  if (!config.appSecret && !config.verificationKey) {
    throw new Error("Privy server config needs RUBY_HIGH_PRIVY_APP_SECRET or RUBY_HIGH_PRIVY_VERIFICATION_KEY.");
  }

  const client = config.appSecret ? getPrivyClient(config) : null;
  let privyUserId = "";
  let privySessionId: string | undefined;
  let user: User | null = null;

  if (accessToken) {
    const claims = client
      ? await client.utils().auth().verifyAccessToken(accessToken)
      : await verifyAccessToken({
          access_token: accessToken,
          app_id: config.appId,
          verification_key: config.verificationKey!,
        });
    privyUserId = claims.user_id;
    privySessionId = claims.session_id;
  }

  if (identityToken) {
    user = client
      ? await client.users().get({ id_token: identityToken })
      : await verifyIdentityToken({
          identity_token: identityToken,
          app_id: config.appId,
          verification_key: config.verificationKey!,
        });
    if (privyUserId && user.id !== privyUserId) {
      throw new Error("Privy token user mismatch.");
    }
    privyUserId = user.id;
  }

  if (!user && client && privyUserId) {
    user = await client.users()._get(privyUserId);
  }

  if (!privyUserId) throw new Error("Privy token did not identify a user.");
  const wallet = user ? primaryWallet(user) : null;
  return {
    privyUserId,
    ...(privySessionId ? { privySessionId } : {}),
    ...(user ? { label: labelForUser(user, wallet?.address) } : {}),
    ...(wallet ? {
      walletAddress: wallet.chainType === "ethereum" ? wallet.address.toLowerCase() : wallet.address,
      walletChainType: wallet.chainType,
    } : {}),
  };
}

function readServerConfig(env: NodeJS.ProcessEnv = process.env): PrivyServerConfig | null {
  const appId = cleanEnv(env.RUBY_HIGH_PRIVY_APP_ID);
  if (!appId) return null;
  return {
    appId,
    ...(cleanEnv(env.RUBY_HIGH_PRIVY_APP_SECRET) ? { appSecret: cleanEnv(env.RUBY_HIGH_PRIVY_APP_SECRET) } : {}),
    ...(cleanEnv(env.RUBY_HIGH_PRIVY_VERIFICATION_KEY) ? { verificationKey: cleanEnv(env.RUBY_HIGH_PRIVY_VERIFICATION_KEY) } : {}),
  };
}

function parsePrivyLoginMethods(value: string | undefined): PrivyPublicLoginMethod[] {
  const raw = cleanEnv(value);
  if (!raw) return [...DEFAULT_PRIVY_LOGIN_METHODS];
  const methods: PrivyPublicLoginMethod[] = [];
  for (const part of raw.split(/[\s,]+/)) {
    const method = normalizePrivyLoginMethod(part);
    if (method && !methods.includes(method)) methods.push(method);
  }
  return methods.length ? methods : [...DEFAULT_PRIVY_LOGIN_METHODS];
}

function normalizePrivyLoginMethod(value: string): PrivyPublicLoginMethod | null {
  const method = value.trim().toLowerCase();
  if (!method) return null;
  if (method.startsWith("privy:") && method.length > "privy:".length) {
    return method as PrivyPublicLoginMethod;
  }
  return PRIVY_LOGIN_METHODS.has(method as PrivyPublicLoginMethod)
    ? method as PrivyPublicLoginMethod
    : null;
}

function getPrivyClient(config: PrivyServerConfig): PrivyClient {
  const key = `${config.appId}:${config.appSecret ?? ""}:${config.verificationKey ?? ""}`;
  if (cachedClient && cachedClientKey === key) return cachedClient;
  cachedClientKey = key;
  cachedClient = new PrivyClient({
    appId: config.appId,
    appSecret: config.appSecret!,
    ...(config.verificationKey ? { jwtVerificationKey: config.verificationKey } : {}),
  });
  return cachedClient;
}

function primaryWallet(user: User): { address: string; chainType: "ethereum" | "solana" } | null {
  const accounts = Array.isArray(user.linked_accounts) ? user.linked_accounts : [];
  const wallets = accounts
    .map((account) => walletCandidate(account))
    .filter((wallet): wallet is { address: string; chainType: "ethereum" | "solana"; rank: number } => !!wallet)
    .sort((a, b) => a.rank - b.rank);
  return wallets[0] ? { address: wallets[0].address, chainType: wallets[0].chainType } : null;
}

function walletCandidate(account: unknown): { address: string; chainType: "ethereum" | "solana"; rank: number } | null {
  if (!account || typeof account !== "object") return null;
  const record = account as Record<string, unknown>;
  const address = typeof record.address === "string" ? record.address.trim() : "";
  const rawChainType = record.chainType ?? record.chain_type;
  const chainType = rawChainType === "ethereum" || rawChainType === "solana" ? rawChainType : null;
  if (!address || !chainType || (record.type !== "wallet" && record.type !== "smart_wallet")) return null;
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

function labelForUser(user: User, walletAddress?: string): string {
  const accounts = Array.isArray(user.linked_accounts) ? user.linked_accounts : [];
  for (const account of accounts) {
    if (!account || typeof account !== "object") continue;
    const record = account as unknown as Record<string, unknown>;
    if (record.type === "email" && typeof record.address === "string" && record.address.trim()) {
      return record.address.trim();
    }
  }
  if (walletAddress) return `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}`;
  return "Privy";
}

function cleanEnv(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanInput(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}
