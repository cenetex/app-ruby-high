import Privy, {
  LocalStorage,
  getUserEmbeddedEthereumWallet,
  getUserEmbeddedSolanaWallet,
} from "@privy-io/js-sdk-core";

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
  identityToken?: string | null;
}

type PrivyUser = Record<string, unknown> | null;

export async function createRubyHighPrivyClient(config: RubyHighPrivyConfig): Promise<{
  current(): Promise<RubyHighPrivySession>;
  sendEmailCode(email: string): Promise<void>;
  loginWithEmailCode(email: string, code: string): Promise<RubyHighPrivySession>;
  logout(): Promise<void>;
}> {
  const privy = new Privy({
    appId: config.appId,
    clientId: config.clientId,
    storage: new LocalStorage(),
    logger: {
      level: "ERROR",
      info: () => {},
      warn: console.warn.bind(console),
      error: console.error.bind(console),
      debug: () => {},
    },
  });

  await privy.initialize();
  mountEmbeddedWalletFrame(privy);
  let lastIdentityToken: string | null = null;

  async function current(): Promise<RubyHighPrivySession> {
    const { user } = await privy.user.get();
    if (!user) return emptySession();
    const [accessToken, identityToken] = await Promise.all([
      privy.getAccessToken(),
      privy.getIdentityToken(),
    ]);
    lastIdentityToken = identityToken;
    return sessionFromUser(user as unknown as PrivyUser, accessToken, identityToken);
  }

  async function sendEmailCode(email: string): Promise<void> {
    await privy.auth.email.sendCode(email);
  }

  async function loginWithEmailCode(email: string, code: string): Promise<RubyHighPrivySession> {
    const session = await privy.auth.email.loginWithCode(
      email,
      code,
      "login-or-sign-up",
      { embedded: { ethereum: { createOnLogin: "users-without-wallets" } } },
    );
    lastIdentityToken = typeof session.identity_token === "string" ? session.identity_token : await privy.getIdentityToken();
    return sessionFromUser(session.user as unknown as PrivyUser, await privy.getAccessToken(), lastIdentityToken);
  }

  async function logout(): Promise<void> {
    const { user } = await privy.user.get();
    if (user && typeof user.id === "string") {
      await privy.auth.logout({ userId: user.id });
    }
    lastIdentityToken = null;
  }

  return { current, sendEmailCode, loginWithEmailCode, logout };
}

function mountEmbeddedWalletFrame(privy: Privy): void {
  const existing = document.getElementById("ruby-high-privy-frame") as HTMLIFrameElement | null;
  if (existing && existing.contentWindow) {
    privy.setMessagePoster(existing.contentWindow as never);
    return;
  }
  const iframe = document.createElement("iframe");
  iframe.id = "ruby-high-privy-frame";
  iframe.src = privy.embeddedWallet.getURL();
  iframe.style.display = "none";
  iframe.setAttribute("aria-hidden", "true");
  document.body.appendChild(iframe);
  iframe.addEventListener("load", () => {
    if (iframe.contentWindow) privy.setMessagePoster(iframe.contentWindow as never);
  });
  window.addEventListener("message", (event) => {
    if (event.source !== iframe.contentWindow) return;
    let data: unknown = event.data;
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch {
        return;
      }
    }
    privy.embeddedWallet.onMessage(data as never);
  });
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

function sessionFromUser(
  user: PrivyUser,
  accessToken: string | null,
  identityToken: string | null,
): RubyHighPrivySession {
  if (!user) return emptySession();
  const wallet = walletFromUser(user);
  return {
    authenticated: true,
    userId: typeof user.id === "string" ? user.id : null,
    label: labelFromUser(user, wallet?.address ?? null),
    walletAddress: wallet?.address ?? null,
    walletChainType: wallet?.chainType ?? null,
    accessToken,
    identityToken,
  };
}

function walletFromUser(user: PrivyUser): { address: string; chainType: "ethereum" | "solana"; rank: number } | null {
  const embeddedEth = getUserEmbeddedEthereumWallet(user as never);
  if (embeddedEth?.address) return { address: embeddedEth.address, chainType: "ethereum", rank: 0 };
  const embeddedSol = getUserEmbeddedSolanaWallet(user as never);
  if (embeddedSol?.address) return { address: embeddedSol.address, chainType: "solana", rank: 1 };
  const accounts = Array.isArray(user?.linked_accounts) ? user.linked_accounts : [];
  const wallets = accounts
    .map((account) => walletCandidate(account))
    .filter((wallet): wallet is { address: string; chainType: "ethereum" | "solana"; rank: number } => !!wallet)
    .sort((a, b) => a.rank - b.rank);
  return wallets[0] ?? null;
}

function walletCandidate(account: unknown): { address: string; chainType: "ethereum" | "solana"; rank: number } | null {
  if (!account || typeof account !== "object") return null;
  const record = account as Record<string, unknown>;
  const address = typeof record.address === "string" ? record.address.trim() : "";
  const chainType = record.chain_type === "ethereum" || record.chain_type === "solana" ? record.chain_type : null;
  if (!address || !chainType || (record.type !== "wallet" && record.type !== "smart_wallet")) return null;
  return { address, chainType, rank: chainType === "ethereum" ? 2 : 3 };
}

function labelFromUser(user: PrivyUser, walletAddress: string | null): string | null {
  const accounts = Array.isArray(user?.linked_accounts) ? user.linked_accounts : [];
  for (const account of accounts) {
    if (!account || typeof account !== "object") continue;
    const record = account as Record<string, unknown>;
    if (record.type === "email" && typeof record.address === "string" && record.address.trim()) {
      return record.address.trim();
    }
  }
  return walletAddress ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}` : null;
}
