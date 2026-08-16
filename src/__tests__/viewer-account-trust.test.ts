import { describe, expect, it } from "vitest";
import {
  accountTrustPanelView,
  officialRubyHighWebsite,
  solanaAccountLink,
} from "../viewer-parts/client-pure.js";

describe("account trust panel view", () => {
  it("renders trust rows from wallet and billing configuration", () => {
    const view = accountTrustPanelView({
      solana: {
        recipient: "TreasuryWallet111111111111111111111111111111",
        symbol: "SOL",
      },
      nfts: {
        collectionAddress: "CardCollection3333333333333333333333333333",
        corePacks: {
          collectionAddress: "PackCollection4444444444444444444444444444",
        },
      },
    }, "ConnectedWallet5555555555555555555555555555555", "build-123");

    expect(view.rows).toEqual([
      {
        label: "Official website",
        value: "https://ruby-high.ai/",
        href: "https://ruby-high.ai/",
      },
      { label: "Current build", value: "build-123", href: "" },
      {
        label: "Connected wallet",
        value: "Connec...5555",
        href: "https://solscan.io/account/ConnectedWallet5555555555555555555555555555555",
      },
      {
        label: "Treasury",
        value: "Treasu...1111",
        href: "https://solscan.io/account/TreasuryWallet111111111111111111111111111111",
      },
      {
        label: "Pack payment",
        value: "Native SOL",
        href: "",
      },
      {
        label: "Pack collection",
        value: "PackCo...4444",
        href: "https://solscan.io/account/PackCollection4444444444444444444444444444",
      },
      {
        label: "Card collection",
        value: "CardCo...3333",
        href: "https://solscan.io/account/CardCollection3333333333333333333333333333",
      },
    ]);
    expect(view.note).toContain("never asks for your seed phrase");
  });

  it("falls back before wallet payment configuration is loaded", () => {
    const view = accountTrustPanelView(null, "", "");

    expect(view.rows).toMatchObject([
      { label: "Official website", value: officialRubyHighWebsite(), href: officialRubyHighWebsite() },
      { label: "Current build", value: "dev", href: "" },
      { label: "Connected wallet", value: "Not connected", href: "" },
      { label: "Treasury", value: "Shown before wallet payment", href: "" },
      { label: "Pack payment", value: "Native SOL", href: "" },
      { label: "Pack collection", value: "Loading configuration", href: "" },
      { label: "Card collection", value: "Loading configuration", href: "" },
    ]);
  });

  it("uses legacy pack NFT configuration when core packs are absent", () => {
    const view = accountTrustPanelView({
      solana: {
        packNfts: {
          collectionAddress: "LegacyPackCollection6666666666666666666666",
        },
      },
    }, null, "dev");

    expect(view.rows.find((row) => row.label === "Pack collection")).toMatchObject({
      value: "Legacy...6666",
      href: "https://solscan.io/account/LegacyPackCollection6666666666666666666666",
    });
  });

  it("builds Solscan links only for present addresses", () => {
    expect(solanaAccountLink("Wallet With Spaces")).toBe("https://solscan.io/account/Wallet%20With%20Spaces");
    expect(solanaAccountLink("")).toBe("");
    expect(solanaAccountLink(null)).toBe("");
  });
});
