import { describe, expect, it, vi } from "vitest";
import { createBillingProductsRenderer } from "../viewer-parts/billing-products.js";
import type {
  BillingCardBurnChoiceView,
  BillingCardPackPaymentChoiceView,
  BillingHallPassPaymentChoiceView,
  BillingProductRowView,
} from "../viewer-parts/client-pure.js";

class FakeClassList {
  values = new Set<string>();

  add(...names: string[]): void {
    names.forEach((name) => this.values.add(name));
  }

  contains(name: string): boolean {
    return this.values.has(name);
  }
}

class FakeElement {
  className = "";
  textContent = "";
  type = "";
  disabled = false;
  title = "";
  children: FakeElement[] = [];
  listeners: Record<string, Array<() => void>> = {};
  classList = new FakeClassList();

  constructor(readonly tagName: string) {}

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  addEventListener(name: string, listener: () => void): void {
    this.listeners[name] = [...(this.listeners[name] || []), listener];
  }

  click(): void {
    (this.listeners.click || []).forEach((listener) => listener());
  }
}

function createDocument() {
  return {
    createElement(tagName: string) {
      return new FakeElement(tagName) as unknown as HTMLElement;
    },
  };
}

function rowView(overrides?: Partial<BillingProductRowView>): BillingProductRowView {
  return {
    titleText: "Starter Pack",
    metaText: "$5.00 · 5 Hall Passes",
    buttonText: "Select",
    buttonDisabled: false,
    selected: false,
    ...overrides,
  };
}

function hallPassPaymentView(overrides?: Partial<BillingHallPassPaymentChoiceView>): BillingHallPassPaymentChoiceView {
  return {
    titleText: "Buy 5 Hall Passes",
    metaText: "$5.00",
    buttonText: "Checkout",
    buttonDisabled: false,
    buttonTitle: "Pay by card with Stripe.",
    ...overrides,
  };
}

function cardPackPaymentView(overrides?: Partial<BillingCardPackPaymentChoiceView>): BillingCardPackPaymentChoiceView {
  return {
    titleText: "Buy Ruby High Pack",
    metaText: "-100 RUBY · +1 Pack NFT",
    buttonText: "Buy Pack",
    buttonDisabled: false,
    buttonTitle: "Pay with RUBY and mint a pack NFT.",
    noteText: "",
    showGetRubyLink: false,
    ...overrides,
  };
}

function burnView(overrides?: Partial<BillingCardBurnChoiceView>): BillingCardBurnChoiceView {
  return {
    titleText: "Burn Card",
    metaText: "1 burnable Card · +5 Hall Passes",
    buttonText: "Burn Card",
    buttonDisabled: false,
    buttonTitle: "Burn one Card for 5 Hall Passes.",
    ...overrides,
  };
}

function textTree(node: FakeElement): string[] {
  return [
    node.textContent,
    ...node.children.flatMap((child) => textTree(child)),
  ].filter(Boolean);
}

describe("billing products renderer", () => {
  it("renders selectable product rows", () => {
    const calls: unknown[] = [];
    const product = { id: "pass-5" };
    const renderer = createBillingProductsRenderer({
      document: createDocument(),
      productRowView(mode, productArg, solana, opts) {
        expect(mode).toBe("hall-passes");
        expect(productArg).toBe(product);
        expect(solana).toEqual({ configured: true });
        expect(opts).toEqual({ selected: true, billingBusy: false });
        return rowView({ selected: true });
      },
      hallPassPaymentChoiceView: () => hallPassPaymentView(),
      cardPackPaymentChoiceView: () => cardPackPaymentView(),
      cardBurnChoiceView: () => burnView(),
      getRubyLink: () => new FakeElement("a") as unknown as HTMLElement,
      isPrivyConfigured: () => true,
      canPackCheckout: () => true,
      onSelectProduct(id) {
        calls.push(id);
      },
      onStartCheckout: vi.fn(),
      onStartSolanaPayment: vi.fn(),
      onBurnCard: vi.fn(),
    });

    const row = renderer.buildProductRow("hall-passes", product, { configured: true }, {
      selected: true,
      billingBusy: false,
    }) as unknown as FakeElement;

    expect(row.className).toBe("billing-product");
    expect(row.classList.contains("is-selected")).toBe(true);
    expect(textTree(row)).toEqual(["Starter Pack", "$5.00 · 5 Hall Passes", "Select"]);
    expect(row.children[1]!.className).toBe("billing-buy");
    row.children[1]!.click();
    expect(calls).toEqual(["pass-5"]);
  });

  it("renders Stripe and card-pack payment choices with injected actions", () => {
    const calls: string[] = [];
    const product = { id: "pack-1" };
    const renderer = createBillingProductsRenderer({
      document: createDocument(),
      productRowView: () => rowView(),
      hallPassPaymentChoiceView(payload, productArg, opts) {
        expect(payload).toEqual({ configured: true });
        expect(productArg).toEqual({ id: "pass-5" });
        expect(opts).toEqual({ billingBusy: true });
        return hallPassPaymentView({ buttonDisabled: true });
      },
      cardPackPaymentChoiceView(solana, productArg, opts) {
        expect(solana).toEqual({ configured: true });
        expect(productArg).toBe(product);
        expect(opts).toEqual({ cryptoUnavailable: false, canPackCheckout: false, billingBusy: false });
        return cardPackPaymentView({
          buttonDisabled: true,
          noteText: "RUBY token setup is incomplete. Get $RUBY, then choose a pack.",
          showGetRubyLink: true,
        });
      },
      cardBurnChoiceView: () => burnView(),
      getRubyLink(className) {
        const link = new FakeElement("a");
        link.className = className;
        link.textContent = "Get $RUBY";
        return link as unknown as HTMLElement;
      },
      isPrivyConfigured: () => true,
      canPackCheckout: () => false,
      onSelectProduct: vi.fn(),
      onStartCheckout(id) {
        calls.push("stripe:" + String(id));
      },
      onStartSolanaPayment(id) {
        calls.push("solana:" + String(id));
      },
      onBurnCard: vi.fn(),
    });

    const stripe = renderer.buildHallPassPaymentChoice({ configured: true }, { id: "pass-5" }, {
      billingBusy: true,
    }) as unknown as FakeElement;
    expect(stripe.className).toBe("billing-payment-choice");
    expect(textTree(stripe)).toEqual(["Buy 5 Hall Passes", "$5.00", "Checkout"]);
    expect(stripe.children[2]!.children[0]!.disabled).toBe(true);
    stripe.children[2]!.children[0]!.click();
    expect(calls).toEqual(["stripe:pass-5"]);

    const pack = renderer.buildCardPackPaymentChoice({ configured: true }, product, {
      billingBusy: false,
    }) as unknown as FakeElement;
    expect(textTree(pack)).toEqual([
      "Buy Ruby High Pack",
      "-100 RUBY · +1 Pack NFT",
      "Buy Pack",
      "RUBY token setup is incomplete. Get $RUBY, then choose a pack.",
      "Get $RUBY",
    ]);
    expect(pack.children[4]!.className).toBe("billing-get-ruby-link billing-payment-note-link");
    pack.children[2]!.children[0]!.click();
    expect(calls).toEqual(["stripe:pass-5", "solana:pack-1"]);
  });

  it("renders card-burn rows with injected state and action", () => {
    const burn = vi.fn();
    const renderer = createBillingProductsRenderer({
      document: createDocument(),
      productRowView: () => rowView(),
      hallPassPaymentChoiceView: () => hallPassPaymentView(),
      cardPackPaymentChoiceView: () => cardPackPaymentView(),
      cardBurnChoiceView(opts) {
        expect(opts).toEqual({
          hasWallet: true,
          burnableCards: 2,
          hallPassesPerBurnedCard: 5,
          authed: true,
          billingBusy: false,
        });
        return burnView();
      },
      getRubyLink: () => new FakeElement("a") as unknown as HTMLElement,
      isPrivyConfigured: () => true,
      canPackCheckout: () => true,
      onSelectProduct: vi.fn(),
      onStartCheckout: vi.fn(),
      onStartSolanaPayment: vi.fn(),
      onBurnCard: burn,
    });

    const row = renderer.buildCardBurnChoice({
      hasWallet: true,
      burnableCards: 2,
      hallPassesPerBurnedCard: 5,
      authed: true,
      billingBusy: false,
    }) as unknown as FakeElement;

    expect(row.className).toBe("billing-product billing-card-burn");
    expect(textTree(row)).toEqual(["Burn Card", "1 burnable Card · +5 Hall Passes", "Burn Card"]);
    expect(row.children[1]!.title).toBe("Burn one Card for 5 Hall Passes.");
    row.children[1]!.click();
    expect(burn).toHaveBeenCalledTimes(1);
  });
});
