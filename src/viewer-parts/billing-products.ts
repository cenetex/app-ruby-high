import type {
  BillingCardBurnChoiceView,
  BillingCardPackPaymentChoiceView,
  BillingHallPassPaymentChoiceView,
  BillingProductRowView,
} from "./client-pure.js";

export interface BillingProductsRendererDeps {
  document: Pick<Document, "createElement">;
  productRowView(
    mode: unknown,
    product: unknown,
    solana: unknown,
    opts: { selected: boolean; billingBusy: boolean },
  ): BillingProductRowView;
  hallPassPaymentChoiceView(payload: unknown, product: unknown, opts: { billingBusy: boolean }): BillingHallPassPaymentChoiceView;
  cardPackPaymentChoiceView(
    solana: unknown,
    product: unknown,
    opts: { cryptoUnavailable: boolean; canPackCheckout: boolean; billingBusy: boolean },
  ): BillingCardPackPaymentChoiceView;
  cardBurnChoiceView(opts: {
    hasWallet: boolean;
    burnableCards: number;
    hallPassesPerBurnedCard: number;
    authed: boolean;
    billingBusy: boolean;
  }): BillingCardBurnChoiceView;
  isPrivyConfigured(): boolean;
  canPackCheckout(solana: unknown): boolean;
  onSelectProduct(productId: unknown): void;
  onStartCheckout(productId: unknown): void;
  onStartSolanaPayment(productId: unknown): void;
  onBurnCard(): void;
}

export interface BillingProductsRenderer {
  buildProductRow(mode: unknown, product: unknown, solana: unknown, opts: { selected: boolean; billingBusy: boolean }): HTMLElement;
  buildHallPassPaymentChoice(payload: unknown, product: unknown, opts: { billingBusy: boolean }): HTMLElement;
  buildCardPackPaymentChoice(solana: unknown, product: unknown, opts: { billingBusy: boolean }): HTMLElement;
  buildCardBurnChoice(opts: {
    hasWallet: boolean;
    burnableCards: number;
    hallPassesPerBurnedCard: number;
    authed: boolean;
    billingBusy: boolean;
  }): HTMLElement;
}

export function createBillingProductsRenderer(deps: BillingProductsRendererDeps): BillingProductsRenderer {
  function recordValue(record: unknown, key: string): unknown {
    return record && typeof record === "object" ? (record as Record<string, unknown>)[key] : undefined;
  }

  function appendProductCopy(parent: HTMLElement, titleText: string, metaText: string): void {
    const body = deps.document.createElement("div");
    const title = deps.document.createElement("div");
    title.className = "billing-product-title";
    title.textContent = titleText;
    const meta = deps.document.createElement("div");
    meta.className = "billing-product-meta";
    meta.textContent = metaText;
    body.appendChild(title);
    body.appendChild(meta);
    parent.appendChild(body);
  }

  function buildPaymentChoice(
    view: BillingHallPassPaymentChoiceView | BillingCardPackPaymentChoiceView,
    onClick: () => void,
  ): HTMLElement {
    const panel = deps.document.createElement("div");
    panel.className = "billing-payment-choice";
    const title = deps.document.createElement("div");
    title.className = "billing-payment-title";
    title.textContent = view.titleText;
    const meta = deps.document.createElement("div");
    meta.className = "billing-product-meta";
    meta.textContent = view.metaText;
    const actions = deps.document.createElement("div");
    actions.className = "billing-payment-actions";
    const button = deps.document.createElement("button");
    button.type = "button";
    button.className = "billing-buy";
    button.textContent = view.buttonText;
    button.disabled = view.buttonDisabled;
    button.title = view.buttonTitle;
    button.addEventListener("click", onClick);
    actions.appendChild(button);
    panel.appendChild(title);
    panel.appendChild(meta);
    panel.appendChild(actions);
    return panel;
  }

  return {
    buildProductRow(mode, product, solana, opts): HTMLElement {
      const view = deps.productRowView(mode, product, solana, opts);
      const row = deps.document.createElement("div");
      row.className = "billing-product";
      if (view.selected) row.classList.add("is-selected");
      appendProductCopy(row, view.titleText, view.metaText);
      const buy = deps.document.createElement("button");
      buy.type = "button";
      buy.className = "billing-buy";
      buy.textContent = view.buttonText;
      buy.disabled = view.buttonDisabled;
      buy.addEventListener("click", () => deps.onSelectProduct(recordValue(product, "id")));
      row.appendChild(buy);
      return row;
    },
    buildHallPassPaymentChoice(payload, product, opts): HTMLElement {
      const view = deps.hallPassPaymentChoiceView(payload, product, opts);
      return buildPaymentChoice(view, () => deps.onStartCheckout(recordValue(product, "id")));
    },
    buildCardPackPaymentChoice(solana, product, opts): HTMLElement {
      const cryptoUnavailable = !deps.isPrivyConfigured();
      const view = deps.cardPackPaymentChoiceView(solana, product, {
        cryptoUnavailable,
        canPackCheckout: deps.canPackCheckout(solana),
        billingBusy: opts.billingBusy,
      });
      const panel = buildPaymentChoice(view, () => deps.onStartSolanaPayment(recordValue(product, "id")));
      if (view.noteText) {
        const note = deps.document.createElement("div");
        note.className = "billing-payment-note";
        note.textContent = view.noteText;
        panel.appendChild(note);
      }
      return panel;
    },
    buildCardBurnChoice(opts): HTMLElement {
      const view = deps.cardBurnChoiceView(opts);
      const row = deps.document.createElement("div");
      row.className = "billing-product billing-card-burn";
      appendProductCopy(row, view.titleText, view.metaText);
      const burn = deps.document.createElement("button");
      burn.type = "button";
      burn.className = "billing-buy";
      burn.textContent = view.buttonText;
      burn.disabled = view.buttonDisabled;
      burn.title = view.buttonTitle;
      burn.addEventListener("click", () => deps.onBurnCard());
      row.appendChild(burn);
      return row;
    },
  };
}
