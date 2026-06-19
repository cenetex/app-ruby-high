import { describe, expect, it } from "vitest";
import {
  accountHistoryRowView,
  walletTransactionCardCount,
  walletTransactionDescription,
  walletTransactionSource,
  walletTransactionTitle,
} from "../viewer-parts/client-pure.js";

describe("account history row view", () => {
  it("renders Hall Pass credits with source and date", () => {
    const view = accountHistoryRowView({
      kind: "hall-pass-grant",
      hallPasses: 5,
      source: "welcome-grant",
      at: Date.UTC(2026, 5, 19, 12),
    });

    expect(view).toMatchObject({
      className: "account-history-row is-credit",
      title: "Hall Pass grant",
      meta: "Welcome grant · Jun 19, 2026",
      delta: "+5 Hall Passes",
    });
  });

  it("renders pack purchases as swaps with token and pack deltas", () => {
    const view = accountHistoryRowView({
      kind: "hall-pass-pack-mint",
      description: "First Bell pack",
      source: "solana-checkout",
      at: Date.UTC(2026, 5, 19, 12),
      metadata: {
        packCount: 2,
        solanaTokenAmount: "123.45",
        solanaTokenSymbol: "RUBY",
      },
    });

    expect(view).toMatchObject({
      className: "account-history-row is-swap",
      title: "First Bell pack",
      meta: "Solana checkout · Jun 19, 2026",
      delta: "-123.45 RUBY · +2 Packs",
    });
  });

  it("uses card counts for pack opens and card burns", () => {
    expect(walletTransactionTitle({
      kind: "hall-pass-grant",
      metadata: { cardCount: 5 },
    })).toBe("Pack opened");
    expect(walletTransactionCardCount({
      kind: "hall-pass-spend",
      metadata: { hallPassCardCount: 1 },
    })).toBe(-1);
    expect(accountHistoryRowView({
      kind: "hall-pass-spend",
      source: "card-burn",
      at: Date.UTC(2026, 5, 19, 12),
      metadata: { hallPassCardCount: 1 },
    })).toMatchObject({
      className: "account-history-row is-debit",
      title: "Card burn",
      delta: "-1 Card",
    });
  });

  it("falls back cleanly for malformed wallet updates", () => {
    expect(walletTransactionDescription({ description: "  " })).toBe("Wallet update");
    expect(walletTransactionSource(null)).toBe("System");
    expect(accountHistoryRowView(null)).toMatchObject({
      className: "account-history-row",
      title: "Wallet update",
      meta: "System · unknown date",
      delta: "0",
    });
  });
});
