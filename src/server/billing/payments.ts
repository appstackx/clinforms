/**
 * Subscription billing at the payment service (31/10/2026) – the SAME account, key, pinned API version, live-key
 * guard and mode checks as text credits (src/server/pms/comms/credits/card-payments.ts: STRIPE_CLINDESK_SECRET_KEY,
 * STRIPE_CLINDESK_ALLOW_LIVE, CLINDESK_BILLING_LIVE), plain fetch, no SDK. Server only. Nothing clinical is sent: the
 * clinic's id and name on its customer, the plan's prices, the clinic id in metadata.
 *
 * What it does: finds the catalogue's prices by lookup key and checks them against src/lib/billing/plans.ts (amount,
 * currency, interval, reports_included metadata); the hosted checkout in subscription mode (one subscription, its
 * items); the customer portal (card or Direct Debit changes, invoices, cancelling); plan changes on the existing
 * subscription; re-reading subscriptions, checkouts and invoices; extra-report invoice items.
 */
import "server-only";
import { EXTRA_REPORT_KEY, EXTRA_REPORT_PENCE, catalogueItem, type PlanItem } from "../../lib/billing/plans";
import { CardPaymentsError, cardPaymentsConfig, paymentsHttp, type CardPaymentsConfig, type Fetch, type FormFields } from "../pms/comms/credits/card-payments";

type Env = Readonly<Record<string, string | undefined>>;

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const idOf = (v: unknown): string | null => str(v) ?? (v && typeof v === "object" ? str((v as Record<string, unknown>).id) : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const iso = (unix: unknown): string | null => (typeof unix === "number" && unix > 0 ? new Date(unix * 1000).toISOString() : null);
function meta(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (v && typeof v === "object") for (const [k, val] of Object.entries(v as Record<string, unknown>)) if (typeof val === "string") out[k] = val;
  return out;
}

export interface SubscriptionInfo {
  id: string;
  status: string;
  livemode: boolean;
  customer: string | null;
  metadata: Record<string, string>;
  /** The items' price lookup keys (and the price ids, for plan changes). */
  items: { itemId: string; priceId: string; lookupKey: string | null; reportsIncluded: number | null; unitAmount: number | null; interval: string | null }[];
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  cancelAt: string | null;
  canceledAt: string | null;
  endedAt: string | null;
  latestInvoice: { id: string; status: string | null; amountDue: number | null; paid: boolean } | null;
  defaultPaymentMethodType: string | null;
}

export interface SubscriptionCheckoutInfo {
  id: string;
  mode: string;
  status: string | null;
  paymentStatus: string | null;
  livemode: boolean;
  customer: string | null;
  clientReferenceId: string | null;
  metadata: Record<string, string>;
  subscription: string | null;
  url: string | null;
}

export interface InvoiceInfo {
  id: string;
  status: string | null;
  livemode: boolean;
  customer: string | null;
  subscription: string | null;
  billingReason: string | null;
  paid: boolean;
}

/** Reads a subscription (an API answer or an event's data.object). */
export function subscriptionInfo(o: Record<string, unknown>): SubscriptionInfo {
  const itemsRaw = o.items && typeof o.items === "object" ? ((o.items as Record<string, unknown>).data as unknown[]) : [];
  const items = (Array.isArray(itemsRaw) ? itemsRaw : []).map((it) => {
    const i = (it ?? {}) as Record<string, unknown>;
    const price = (i.price ?? {}) as Record<string, unknown>;
    const pm = meta(price.metadata);
    const rec = (price.recurring ?? {}) as Record<string, unknown>;
    return {
      itemId: String(i.id ?? ""),
      priceId: String(price.id ?? ""),
      lookupKey: str(price.lookup_key),
      reportsIncluded: pm.reports_included && /^\d{1,7}$/.test(pm.reports_included) ? Number(pm.reports_included) : null,
      unitAmount: num(price.unit_amount),
      interval: str(rec.interval),
      // Newer API versions keep the period on the item.
      _start: num(i.current_period_start),
      _end: num(i.current_period_end),
    };
  });
  const inv = o.latest_invoice && typeof o.latest_invoice === "object" ? (o.latest_invoice as Record<string, unknown>) : null;
  const start = num(o.current_period_start) ?? items.map((i) => i._start).find((v) => v !== null) ?? null;
  const end = num(o.current_period_end) ?? items.map((i) => i._end).find((v) => v !== null) ?? null;
  const pmRaw = o.default_payment_method && typeof o.default_payment_method === "object" ? (o.default_payment_method as Record<string, unknown>) : null;
  return {
    id: String(o.id ?? ""),
    status: String(o.status ?? ""),
    livemode: o.livemode === true,
    customer: idOf(o.customer),
    metadata: meta(o.metadata),
    items: items.map(({ _start, _end, ...rest }) => rest),
    currentPeriodStart: iso(start),
    currentPeriodEnd: iso(end),
    cancelAtPeriodEnd: o.cancel_at_period_end === true,
    cancelAt: iso(o.cancel_at),
    canceledAt: iso(o.canceled_at),
    endedAt: iso(o.ended_at),
    latestInvoice: inv
      ? { id: String(inv.id ?? ""), status: str(inv.status), amountDue: num(inv.amount_due), paid: inv.status === "paid" || inv.paid === true }
      : typeof o.latest_invoice === "string"
        ? { id: o.latest_invoice, status: null, amountDue: null, paid: false }
        : null,
    defaultPaymentMethodType: pmRaw ? str(pmRaw.type) : null,
  };
}

export function subscriptionCheckoutInfo(o: Record<string, unknown>): SubscriptionCheckoutInfo {
  return {
    id: String(o.id ?? ""),
    mode: String(o.mode ?? ""),
    status: str(o.status),
    paymentStatus: str(o.payment_status),
    livemode: o.livemode === true,
    customer: idOf(o.customer),
    clientReferenceId: str(o.client_reference_id),
    metadata: meta(o.metadata),
    subscription: idOf(o.subscription),
    url: str(o.url),
  };
}

export function invoiceInfo(o: Record<string, unknown>): InvoiceInfo {
  const parent = o.parent && typeof o.parent === "object" ? (o.parent as Record<string, unknown>) : null;
  const subDetails = parent && parent.subscription_details && typeof parent.subscription_details === "object" ? (parent.subscription_details as Record<string, unknown>) : null;
  return {
    id: String(o.id ?? ""),
    status: str(o.status),
    livemode: o.livemode === true,
    customer: idOf(o.customer),
    subscription: idOf(o.subscription) ?? (subDetails ? idOf(subDetails.subscription) : null),
    billingReason: str(o.billing_reason),
    paid: o.status === "paid" || o.paid === true,
  };
}

export interface SubscriptionPayments {
  readonly live: boolean;
  readonly mode: "test" | "live";
  /** The catalogue's prices for these lookup keys, checked against plans.ts (price id by lookup key). */
  prices(lookupKeys: readonly string[]): Promise<Map<string, string>>;
  createSubscriptionCheckout(input: { tenantId: string; customerRef: string; items: { priceId: string }[]; planLabel: string; successUrl: string; cancelUrl: string; idempotencyKey: string }): Promise<SubscriptionCheckoutInfo>;
  getCheckout(id: string): Promise<SubscriptionCheckoutInfo>;
  getSubscription(id: string): Promise<SubscriptionInfo>;
  /** The clinic's subscriptions at the service (newest first) – to find one the app has not recorded yet. */
  listSubscriptions(customerRef: string): Promise<SubscriptionInfo[]>;
  /** Replaces the subscription's items (a plan change), prorated on the next invoice. */
  changeSubscription(input: { subscriptionId: string; removeItemIds: string[]; addPriceIds: string[]; tenantId: string; idempotencyKey: string }): Promise<SubscriptionInfo>;
  portalSession(input: { customerRef: string; returnUrl: string }): Promise<string>;
  getInvoice(id: string): Promise<InvoiceInfo>;
  /** Extra reports as one invoice item (on `invoiceId` while it is a draft, else the next invoice). */
  addExtraReports(input: { customerRef: string; subscriptionId: string; invoiceId: string | null; quantity: number; period: string; tenantId: string; idempotencyKey: string }): Promise<{ itemId: string; invoiceId: string | null }>;
  /** A yearly plan's extra reports: an invoice now for the subscription's pending items (charged automatically). */
  invoicePendingItems(input: { customerRef: string; subscriptionId: string; idempotencyKey: string }): Promise<string>;
}

const SUB_ID = /^sub_[A-Za-z0-9_]{6,200}$/;
const CS_ID = /^cs_[A-Za-z0-9_]{6,200}$/;
const IN_ID = /^in_[A-Za-z0-9_]{6,200}$/;

export function createSubscriptionPayments(config: CardPaymentsConfig, fetchImpl?: Fetch): SubscriptionPayments {
  const { ok } = paymentsHttp(config, fetchImpl);
  let cache: { at: number; map: Map<string, string> } | null = null;
  const getSub = async (id: string) => {
    if (!SUB_ID.test(id)) throw new CardPaymentsError("That is not a subscription reference.", "bad_reference");
    return subscriptionInfo(await ok("GET", `/subscriptions/${encodeURIComponent(id)}?expand[]=latest_invoice&expand[]=default_payment_method`));
  };
  /**
   * The billing page's configuration: ours (metadata app=clindesk), made once if the account has none – card / Direct
   * Debit details, invoices, cancelling at the period end with a reason; plan changes stay in the app (prices must match
   * our list). Cached for the process.
   */
  let portalConfig: string | null = null;
  const portalConfiguration = async (): Promise<string> => {
    if (portalConfig) return portalConfig;
    const list = await ok("GET", "/billing_portal/configurations?active=true&limit=20");
    const found = ((Array.isArray(list.data) ? list.data : []) as Record<string, unknown>[]).find((c) => meta(c.metadata).app === "clindesk" && typeof c.id === "string");
    if (found) return (portalConfig = String(found.id));
    const made = await ok(
      "POST",
      "/billing_portal/configurations",
      {
        "metadata[app]": "clindesk",
        "business_profile[headline]": "Your plan, payment details and invoices",
        "features[invoice_history][enabled]": true,
        "features[payment_method_update][enabled]": true,
        "features[customer_update][enabled]": true,
        "features[customer_update][allowed_updates][0]": "email",
        "features[customer_update][allowed_updates][1]": "address",
        "features[customer_update][allowed_updates][2]": "tax_id",
        "features[subscription_cancel][enabled]": true,
        "features[subscription_cancel][mode]": "at_period_end",
        "features[subscription_cancel][cancellation_reason][enabled]": true,
        "features[subscription_cancel][cancellation_reason][options][0]": "too_expensive",
        "features[subscription_cancel][cancellation_reason][options][1]": "missing_features",
        "features[subscription_cancel][cancellation_reason][options][2]": "switched_service",
        "features[subscription_cancel][cancellation_reason][options][3]": "unused",
        "features[subscription_cancel][cancellation_reason][options][4]": "other",
        "features[subscription_update][enabled]": false,
      },
      `portal-config-${config.live ? "live" : "test"}-v1`,
    );
    if (typeof made.id !== "string") throw new CardPaymentsError("The billing page could not be set up.", "no_portal_config");
    return (portalConfig = made.id);
  };
  return {
    live: config.live,
    mode: config.mode ?? (config.live ? "live" : "test"),
    async prices(lookupKeys) {
      const want = Array.from(new Set(lookupKeys));
      if (cache && Date.now() - cache.at < 10 * 60_000 && want.every((k) => cache!.map.has(k))) return cache.map;
      const map = new Map<string, string>(cache?.map ?? []);
      for (let i = 0; i < want.length; i += 10) {
        const q = want.slice(i, i + 10).map((k) => `lookup_keys[]=${encodeURIComponent(k)}`).join("&");
        const list = await ok("GET", `/prices?active=true&limit=10&${q}`);
        for (const p of (Array.isArray(list.data) ? list.data : []) as Record<string, unknown>[]) {
          const key = str(p.lookup_key);
          if (!key || typeof p.id !== "string") continue;
          const rec = (p.recurring ?? {}) as Record<string, unknown>;
          const m = meta(p.metadata);
          if (key === EXTRA_REPORT_KEY) {
            if (p.currency !== "gbp" || p.unit_amount !== EXTRA_REPORT_PENCE || p.type !== "one_time") throw new CardPaymentsError(`The price for ${key} does not match the plan list.`, "price_mismatch");
            map.set(key, p.id);
            continue;
          }
          const item: PlanItem | null = catalogueItem(key);
          if (!item) continue;
          const good =
            p.currency === "gbp" &&
            p.type === "recurring" &&
            p.unit_amount === item.pence &&
            rec.interval === item.interval &&
            (item.reportsIncluded === null || m.reports_included === String(item.reportsIncluded));
          if (!good) throw new CardPaymentsError(`The price for ${key} does not match the plan list (amount, interval or reports).`, "price_mismatch");
          map.set(key, p.id);
        }
      }
      cache = { at: Date.now(), map };
      return map;
    },
    async createSubscriptionCheckout(input) {
      const body: FormFields = {
        mode: "subscription",
        customer: input.customerRef,
        client_reference_id: input.tenantId,
        locale: "en-GB",
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        "metadata[tenant_id]": input.tenantId,
        "metadata[kind]": "subscription",
        "subscription_data[metadata][tenant_id]": input.tenantId,
        "subscription_data[metadata][kind]": "clinic_plan",
        "subscription_data[description]": input.planLabel.slice(0, 200),
      };
      input.items.forEach((it, i) => {
        body[`line_items[${i}][price]`] = it.priceId;
        body[`line_items[${i}][quantity]`] = 1;
      });
      return subscriptionCheckoutInfo(await ok("POST", "/checkout/sessions", body, input.idempotencyKey));
    },
    async getCheckout(id) {
      if (!CS_ID.test(id)) throw new CardPaymentsError("That is not a checkout reference.", "bad_reference");
      return subscriptionCheckoutInfo(await ok("GET", `/checkout/sessions/${encodeURIComponent(id)}`));
    },
    getSubscription: getSub,
    async listSubscriptions(customerRef) {
      const list = await ok("GET", `/subscriptions?customer=${encodeURIComponent(customerRef)}&status=all&limit=10&expand[]=data.latest_invoice`);
      return ((Array.isArray(list.data) ? list.data : []) as Record<string, unknown>[]).map(subscriptionInfo);
    },
    async changeSubscription(input) {
      // Khuram 01/11/2026: a plan change is paid for at once (prepaid, as text credits) – the difference is invoiced and
      // charged straight away, and the change only takes effect once that payment succeeds (pending_if_incomplete: a
      // declined card leaves the plan as it was). The subscription's metadata was set at checkout and is not resent
      // (Stripe refuses metadata on a pending-if-incomplete update).
      const body: FormFields = { proration_behavior: "always_invoice", payment_behavior: "pending_if_incomplete" };
      let i = 0;
      for (const itemId of input.removeItemIds) {
        body[`items[${i}][id]`] = itemId;
        body[`items[${i}][deleted]`] = true;
        i++;
      }
      for (const priceId of input.addPriceIds) {
        body[`items[${i}][price]`] = priceId;
        body[`items[${i}][quantity]`] = 1;
        i++;
      }
      const res = await ok("POST", `/subscriptions/${encodeURIComponent(input.subscriptionId)}`, body, input.idempotencyKey);
      if (res.pending_update) throw new CardPaymentsError("The payment for the change did not go through, so the plan was not changed.", "payment_failed");
      return getSub(input.subscriptionId);
    },
    async portalSession(input) {
      const configuration = await portalConfiguration();
      const s = await ok("POST", "/billing_portal/sessions", { customer: input.customerRef, return_url: input.returnUrl, locale: "en-GB", configuration });
      const url = str(s.url);
      if (!url || !/^https:\/\//.test(url)) throw new CardPaymentsError("The billing page could not be opened.", "no_url");
      return url;
    },
    async getInvoice(id) {
      if (!IN_ID.test(id)) throw new CardPaymentsError("That is not an invoice reference.", "bad_reference");
      return invoiceInfo(await ok("GET", `/invoices/${encodeURIComponent(id)}`));
    },
    async addExtraReports(input) {
      const prices = await this.prices([EXTRA_REPORT_KEY]);
      const price = prices.get(EXTRA_REPORT_KEY);
      if (!price) throw new CardPaymentsError("The extra report price is not on sale.", "no_price");
      const body: FormFields = {
        customer: input.customerRef,
        "pricing[price]": price,
        quantity: input.quantity,
        description: `Extra reports, ${input.period}`,
        "metadata[tenant_id]": input.tenantId,
        "metadata[kind]": "extra_reports",
        "metadata[period]": input.period,
      };
      if (input.invoiceId) body.invoice = input.invoiceId;
      else body.subscription = input.subscriptionId;
      const item = await ok("POST", "/invoiceitems", body, input.idempotencyKey);
      if (typeof item.id !== "string") throw new CardPaymentsError("The invoice item was not made.", "no_item");
      return { itemId: item.id, invoiceId: idOf(item.invoice) };
    },
    async invoicePendingItems(input) {
      const inv = await ok(
        "POST",
        "/invoices",
        { customer: input.customerRef, subscription: input.subscriptionId, pending_invoice_items_behavior: "include", auto_advance: true, collection_method: "charge_automatically", description: "Extra reports" },
        input.idempotencyKey,
      );
      if (typeof inv.id !== "string") throw new CardPaymentsError("The invoice was not made.", "no_invoice");
      return inv.id;
    },
  };
}

/** From env (the text credits' configuration), or why billing is off. */
export function subscriptionPaymentsFromEnv(env: Env = process.env): { ok: true; payments: SubscriptionPayments; webhookReady: boolean } | { ok: false; reason: string } {
  const c = cardPaymentsConfig(env);
  if (!c.ok) return { ok: false, reason: "Online payment for plans is not set up yet." };
  return { ok: true, payments: createSubscriptionPayments(c.config), webhookReady: Boolean(c.config.webhookSecret) };
}
