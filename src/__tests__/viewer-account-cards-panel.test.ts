import { describe, expect, it } from "vitest";
import { accountHallPassCardsPanelView } from "../viewer-parts/client-pure.js";

describe("account Hall Pass cards panel view", () => {
  it("renders the empty wallet state with signed-out actions disabled", () => {
    expect(accountHallPassCardsPanelView([], [], [], {
      authed: false,
      billingBusy: false,
      checkout: { loaded: false, ready: true, reason: "" },
      hasSolanaWallet: false,
    })).toEqual({
      summaryText: "No collectible packs or cards in this wallet yet.",
      buyText: "Buy Collectible Packs",
      buyTitle: "Sign in to buy Ruby High collectible packs.",
      buyDisabled: true,
      mintHidden: true,
      mintDisabled: true,
      mintText: "Reveal Collectible",
      mintTitle: "No face-down collectible cards are ready to reveal.",
      needsWalletConnection: false,
    });
  });

  it("summarizes active packs, active cards, on-chain cards, and pending reveals", () => {
    const view = accountHallPassCardsPanelView([
      { id: "pack-1", status: "active" },
      { id: "pack-2", status: "opened" },
    ], [
      { id: "card-1", status: "active", mintAddress: "mint-1", mintSignature: "sig-1" },
      { id: "card-2", status: "active" },
      { id: "card-3", status: "burned" },
    ], [
      { id: "card-2", status: "active" },
    ], {
      authed: true,
      billingBusy: false,
      checkout: { loaded: true, ready: true, reason: "" },
      hasSolanaWallet: true,
    });

    expect(view).toMatchObject({
      summaryText: "1 unopened collectible pack · 2 active collectible cards · 1 collectible card on Solana · 1 face-down collectible card to reveal",
      buyDisabled: false,
      buyTitle: "Buy Ruby High collectible packs.",
      mintHidden: false,
      mintDisabled: false,
      mintText: "Reveal Collectible",
      mintTitle: "Create the next collectible card on Solana to reveal it.",
      needsWalletConnection: false,
    });
  });

  it("asks for a Solana wallet before opening packs or revealing cards", () => {
    const view = accountHallPassCardsPanelView([
      { id: "pack-1", status: "active" },
    ], [], [], {
      authed: true,
      billingBusy: false,
      checkout: { loaded: true, ready: true, reason: "" },
      hasSolanaWallet: false,
    });

    expect(view).toMatchObject({
      summaryText: "Connect a Solana wallet to open packs and reveal collectible cards.",
      mintHidden: false,
      mintText: "Connect Wallet",
      mintTitle: "Connect a Solana wallet before opening packs or revealing collectible cards.",
      needsWalletConnection: true,
    });
  });

  it("carries checkout blockers into the summary and buy action", () => {
    const view = accountHallPassCardsPanelView([], [], [], {
      authed: true,
      billingBusy: false,
      checkout: {
        loaded: true,
        ready: false,
        reason: "Solana pack checkout is not configured on this server.",
      },
      hasSolanaWallet: true,
    });

    expect(view).toMatchObject({
      summaryText: "No collectible packs or cards in this wallet yet. · Solana pack checkout is not configured on this server.",
      buyDisabled: true,
      buyTitle: "Solana pack checkout is not configured on this server.",
    });
  });

  it("labels busy card-pack and mint actions", () => {
    expect(accountHallPassCardsPanelView([], [], [{ id: "card-1", status: "active" }], {
      authed: true,
      billingBusy: true,
      billingMode: "card-packs",
      checkout: { loaded: true, ready: true, reason: "" },
      hasSolanaWallet: true,
    })).toMatchObject({
      buyText: "Loading...",
      buyDisabled: true,
      mintText: "Revealing...",
      mintDisabled: true,
    });
  });
});
