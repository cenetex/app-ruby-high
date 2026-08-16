import { describe, expect, it } from "vitest";
import {
  accountHallPassCardReaderView,
  accountHallPassCardTileView,
  accountHallPassPackTileView,
  hallPassCardDetail,
  hallPassCardDetailLabel,
  hallPassCardIsFaceDown,
  hallPassCardProfile,
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
      detail: "Collectible pack on Solana · 10 cards · #000042",
      proofLabel: "View pack on Solscan",
      openVisible: true,
      openText: "Open Pack",
      openDisabled: false,
      openTitle: "Open this Ruby High pack and get its collectible cards.",
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
      detail: "Opened collectible pack · 5 cards · #000abc",
      proofLabel: "View pack record",
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
      detail: "Face-down collectible · reveal on Solana · #abcdef",
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
    expect(hallPassCardStatus(card)).toBe("permanently destroyed");
    expect(hallPassCardTitle(card)).toBe("Ruby");
    expect(hallPassCardDetail(card)).toBe("Collectible on Solana · legendary! · permanently destroyed · #123456");
    expect(accountHallPassCardTileView(card)).toEqual({
      className: "account-card-tile is-redeemed is-teacher rarity-legendary",
      faceDown: false,
      title: "Ruby",
      detail: "Collectible on Solana · legendary! · permanently destroyed · #123456",
      ariaLabel: "Open Ruby",
      imageAlt: "Ruby Ruby High card",
      fallbackInitial: "R",
    });
  });

  it("renders face-down card reader copy and reveal action state", () => {
    const view = accountHallPassCardReaderView({
      id: "card-abcdef",
      status: "active",
      characterId: "card-back",
    }, {
      authed: true,
      billingBusy: false,
    });

    expect(view).toMatchObject({
      panelClassName: "account-card-reader-panel",
      artClassName: "account-card-reader-art",
      faceDown: true,
      title: "Mystery Card",
      detail: "Face-down collectible · reveal on Solana · #abcdef",
      artAlt: "Mystery Card",
      proofAddress: "",
      teachesVisible: false,
      noteText: "Create this collectible card on Solana to reveal it.",
      revealVisible: true,
      revealText: "Reveal on Solana",
      revealDisabled: false,
      revealTitle: "Create this collectible card with your Solana wallet to reveal it.",
    });
  });

  it("renders revealed card reader profile copy", () => {
    const card = {
      id: "card-123456",
      status: "active",
      role: "item",
      characterId: "item-library-card",
      characterName: "Library Card",
      mintAddress: "mint-abc",
      mintSignature: "sig",
    };
    const view = accountHallPassCardReaderView(card, {
      authed: true,
      billingBusy: true,
      flip: true,
      revealed: true,
      profile: {
        subtitle: "Quiet Wing",
        teaches: "Access · research",
        quote: "If the answer exists, this helps you find it.",
      },
    });

    expect(hallPassCardDetailLabel(card)).toBe("ITEM");
    expect(view).toMatchObject({
      panelClassName: "account-card-reader-panel is-revealed",
      artClassName: "account-card-reader-art is-flipped",
      faceDown: false,
      title: "Library Card",
      proofAddress: "mint-abc",
      teachesVisible: true,
      teachesLabel: "ITEM",
      teachesText: "Access · research",
      quoteText: "\"If the answer exists, this helps you find it.\"",
      noteText: "",
      revealVisible: false,
      revealText: "Revealing...",
      revealDisabled: true,
    });
  });

  it("looks up Hall Pass card reader profiles from typed pure data", () => {
    expect(hallPassCardProfile({
      characterId: "ruby",
    })).toEqual({
      subtitle: "Homeroom Teacher",
      teaches: "Homeroom · General Knowledge · AI Literacy · School Meta",
      stats: { head: 1, heart: 3, hustle: 2, honor: 2 },
      quote: "Let's learn together. Ask hard questions. Be kind. Have fun.",
    });
    expect(hallPassCardProfile({
      characterId: "item-library-card",
    })).toMatchObject({
      subtitle: "Quiet Wing",
      teaches: "Access · research · borrowed wisdom",
      quote: "If the answer exists, this helps you find it.",
    });
    expect(hallPassCardProfile({
      characterId: "unknown-card",
    })).toBeNull();
  });

  it("returns defensive Hall Pass card profile copies", () => {
    const first = hallPassCardProfile({ characterId: "ruby" });
    if (first?.stats) first.stats.head = 99;

    expect(hallPassCardProfile({ characterId: "ruby" })?.stats).toEqual({
      head: 1,
      heart: 3,
      hustle: 2,
      honor: 2,
    });
  });
});
