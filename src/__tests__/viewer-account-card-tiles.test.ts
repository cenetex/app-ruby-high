import { describe, expect, it } from "vitest";
import {
  accountHallPassCardTileView,
  accountHallPassPackTileView,
  hallPassCardDetail,
  hallPassCardIsFaceDown,
  hallPassCardStatus,
  hallPassCardTitle,
} from "../viewer-parts/client-pure.js";

describe("account card and pack tile views", () => {
  it("renders active pack tiles with open-pack controls", () => {
    expect(accountHallPassPackTileView({
      id: "pack-1",
      status: "active",
      packCount: 2,
      cardCount: 7,
      serial: 42,
    }, {
      authed: true,
      billingBusy: false,
      walletReady: true,
    })).toEqual({
      className: "account-pack-tile is-active",
      status: "active",
      packCount: 2,
      cardCount: 10,
      imageAlt: "Ruby High Pack",
      imageKind: "active",
      title: "Ruby High 2-Pack",
      detail: "On-chain Core NFT · 10 cards · #000042",
      proofLabel: "View pack NFT",
      openVisible: true,
      openText: "Open Pack",
      openDisabled: false,
      openTitle: "Open this Ruby High pack and create its Cards.",
      walletReady: true,
    });
  });

  it("renders connect-wallet and opened pack states", () => {
    expect(accountHallPassPackTileView({ status: "active" }, {
      authed: true,
      billingBusy: true,
      walletReady: false,
    })).toMatchObject({
      openText: "Connecting...",
      openDisabled: true,
      openTitle: "Connect a Solana wallet before opening this Ruby High pack.",
      walletReady: false,
    });
    expect(accountHallPassPackTileView({ status: "opened", serial: "abc" }, {
      authed: true,
      walletReady: true,
    })).toMatchObject({
      className: "account-pack-tile is-opened",
      imageAlt: "Opened Ruby High Pack",
      imageKind: "opened",
      title: "Ruby High Pack",
      detail: "Opened pack record · 5 cards · #000abc",
      proofLabel: "Pack proof",
      openVisible: false,
    });
  });

  it("renders face-down card tile state", () => {
    const card = {
      id: "card-abcdef",
      status: "active",
      role: "student",
      rarity: "rare",
      characterId: "card-back",
    };

    expect(hallPassCardIsFaceDown(card)).toBe(true);
    expect(accountHallPassCardTileView(card)).toEqual({
      className: "account-card-tile is-active is-student rarity-rare is-face-down",
      faceDown: true,
      title: "Mystery Card",
      detail: "Face-down Card · mint to reveal · #abcdef",
      ariaLabel: "Open Mystery Card",
      imageAlt: "Face-down Ruby High card",
      fallbackInitial: "R",
    });
  });

  it("renders revealed card tile state and status labels", () => {
    const card = {
      id: "card-123456",
      status: "redeemed",
      role: "teacher",
      rarity: "legendary!",
      characterId: "ruby",
      characterName: "Ruby",
      mintAddress: "mint",
      mintSignature: "sig",
    };

    expect(hallPassCardIsFaceDown(card)).toBe(false);
    expect(hallPassCardStatus(card)).toBe("burned");
    expect(hallPassCardTitle(card)).toBe("Ruby");
    expect(hallPassCardDetail(card)).toBe("On-chain Card · legendary! · burned · #123456");
    expect(accountHallPassCardTileView(card)).toEqual({
      className: "account-card-tile is-redeemed is-teacher rarity-legendary",
      faceDown: false,
      title: "Ruby",
      detail: "On-chain Card · legendary! · burned · #123456",
      ariaLabel: "Open Ruby",
      imageAlt: "Ruby Ruby High card",
      fallbackInitial: "R",
    });
  });
});
