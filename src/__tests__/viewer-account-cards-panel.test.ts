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
      summaryText: "No packs or Cards in this wallet yet.",
      buyText: "Buy Card Packs",
      buyTitle: "Sign in to buy Ruby High card packs.",
      buyDisabled: true,
      mintHidden: true,
      mintDisabled: true,
      mintText: "Reveal Card",
      mintTitle: "No face-down cards are ready to reveal.",
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
      summaryText: "1 active pack · 2 active cards · 1 on-chain Card · 1 face-down Card to reveal",
      buyDisabled: false,
      buyTitle: "Buy Ruby High card packs.",
      mintHidden: false,
      mintDisabled: false,
      mintText: "Reveal Card",
      mintTitle: "Mint the next face-down Ruby High Card to reveal it.",
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
      summaryText: "Connect a Solana wallet to open packs and reveal Cards.",
      mintHidden: false,
      mintText: "Connect Wallet",
      mintTitle: "Connect a Solana wallet before opening packs or revealing Cards.",
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
        reason: "RUBY mint configuration is missing.",
      },
      hasSolanaWallet: true,
    });

    expect(view).toMatchObject({
      summaryText: "No packs or Cards in this wallet yet. · RUBY mint configuration is missing.",
      buyDisabled: true,
      buyTitle: "RUBY mint configuration is missing.",
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
      mintText: "Minting...",
      mintDisabled: true,
    });
  });
});
