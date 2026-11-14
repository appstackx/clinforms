/**
 * TESTS ONLY: an in-memory stand-in for the payment provider's connected-account API (./../client.ts ConnectApi).
 * It keeps accounts, payment intents, set-up intents, hosted checkouts, refunds and balance lines per account,
 * honours idempotency keys (the same key answers the same object – like the provider), refuses references of
 * another account, and has test helpers to complete a checkout, decline a card or lose an answer. No network.
 */
import { CardPaymentsError } from "../../../comms/credits/card-payments";
import type { BalanceLine, CardDetails, ChargeOutcome, CheckoutInfo, ConnectApi, IntentInfo, PayoutInfo, ReaderInfo, RefundInfo, SetupInfo } from "../client";

interface Pi extends IntentInfo {
  account: string;
}
interface Cs extends CheckoutInfo {
  account: string;
  customer: string | null;
  amount: number;
  fee: number;
}
interface Si extends SetupInfo {
  account: string;
}
interface Rf extends RefundInfo {
  account: string;
}

export interface FakeConnect extends ConnectApi {
  accounts: Map<string, { closed: boolean; status: "restricted" | "active"; tenantId: string }>;
  intents: Map<string, Pi>;
  checkouts: Map<string, Cs>;
  refunds: Map<string, Rf>;
  calls: { method: string; account: string | null; key?: string }[];
  /** The provider's side of a checkout: the patient pays (payment) or saves a card (setup). */
  completeCheckout(account: string, id: string, card?: "visa" | "decline"): void;
  /** Cards the provider declines (payment method refs). */
  declining: Set<string>;
  /** The next N chargeSavedCard calls succeed at the provider but the answer is lost (a timeout). */
  loseAnswers: number;
  /** The next N createRefund calls succeed at the provider but the answer is lost (a timeout). */
  loseRefundAnswers: number;
  /** A refund made in the provider's own dashboard (not through the clinic system). */
  dashboardRefund(account: string, pi: string, amount: number): Rf;
  setAccountStatus(account: string, status: "restricted" | "active"): void;
}

let seq = 0;
const id = (p: string) => `${p}_FAKE${String(++seq).padStart(10, "0")}x`;
const nowS = () => Math.floor(Date.UTC(2026, 10, 10, 10) / 1000);

export function createFakeConnect(mode: "test" | "live" = "test"): FakeConnect {
  const accounts = new Map<string, { closed: boolean; status: "restricted" | "active"; tenantId: string }>();
  const intents = new Map<string, Pi>();
  const checkouts = new Map<string, Cs>();
  const setups = new Map<string, Si>();
  const refunds = new Map<string, Rf>();
  const cards = new Map<string, { account: string; customer: string; card: CardDetails }>();
  const readers = new Map<string, { account: string; location: string; label: string; action: ReaderInfo["action"] }>();
  const idem = new Map<string, unknown>();
  const calls: FakeConnect["calls"] = [];
  const declining = new Set<string>();
  const lines: (BalanceLine & { account: string })[] = [];
  const live = mode === "live";

  const acc = (a: string) => {
    const x = accounts.get(a);
    if (!x || x.closed) throw new CardPaymentsError("No such account.", "account_invalid");
    return x;
  };
  function once<T>(key: string | undefined, make: () => T): T {
    if (!key) return make();
    if (idem.has(key)) return idem.get(key) as T;
    const v = make();
    idem.set(key, v);
    return v;
  }
  const pi = (a: string, ref: string): Pi => {
    const x = intents.get(ref);
    if (!x || x.account !== a) throw new CardPaymentsError("The card payment service refused the request.", "resource_missing");
    return x;
  };
  const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
  const succeed = (p: Pi, card: CardDetails) => {
    p.status = "succeeded";
    p.amountReceived = p.amount;
    p.card = card;
    p.createdAt = nowS();
    const fee = Math.round(p.amount * 0.015) + 20;
    lines.push({ account: p.account, id: id("txn"), type: "charge", amount: p.amount, fee: fee + p.applicationFee, platformFee: p.applicationFee, providerFee: fee, net: p.amount - fee - p.applicationFee, availableOn: nowS() + 86400 * 3, paymentIntent: p.id });
  };
  const VISA: CardDetails = { brand: "visa", last4: "4242", expMonth: 12, expYear: 2034 };

  const api: FakeConnect = {
    mode,
    accounts,
    intents,
    checkouts,
    refunds,
    calls,
    declining,
    loseAnswers: 0,
    loseRefundAnswers: 0,
    async createAccount(input, key) {
      calls.push({ method: "createAccount", account: null, key });
      return once(key, () => {
        const a = id("acct").replace("acct_FAKE", "acct_FAKE");
        accounts.set(a, { closed: false, status: "restricted", tenantId: input.tenantId });
        return { id: a, raw: { id: a, closed: false, configuration: { merchant: { capabilities: { card_payments: { status: "restricted" }, stripe_balance: { payouts: { status: "restricted" } } } } }, requirements: { entries: [{ awaiting_action_from: "user" }] }, identity: {} } };
      });
    },
    async getAccount(a) {
      const x = acc(a);
      const card = x.status;
      return { id: a, closed: x.closed, configuration: { merchant: { capabilities: { card_payments: { status: card }, stripe_balance: { payouts: { status: card } } } } }, requirements: { entries: card === "active" ? [] : [{ awaiting_action_from: "user" }] }, identity: { attestations: { terms_of_service: { account: card === "active" ? { date: "2026-11-10T10:00:00Z" } : null } } } };
    },
    async onboardingLink(a) {
      acc(a);
      return `https://connect.example.test/setup/${a}`;
    },
    async closeAccount(a) {
      acc(a).closed = true;
    },
    async createLocation(a, _input, key) {
      acc(a);
      return once(key, () => id("tml"));
    },
    async registerReader(a, input) {
      acc(a);
      const r = id("tmr");
      readers.set(r, { account: a, location: input.location, label: input.label, action: null });
      return { id: r, label: input.label, deviceType: "simulated_wisepos_e", status: "online", location: input.location, action: null };
    },
    async getReader(a, r) {
      const x = readers.get(r);
      if (!x || x.account !== a) throw new CardPaymentsError("No such reader.", "resource_missing");
      return { id: r, label: x.label, deviceType: "simulated_wisepos_e", status: "online", location: x.location, action: x.action };
    },
    async deleteReader(a, r) {
      if (readers.get(r)?.account === a) readers.delete(r);
    },
    async processOnReader(a, r, ref) {
      pi(a, ref);
      const x = readers.get(r);
      if (!x || x.account !== a) throw new CardPaymentsError("No such reader.", "resource_missing");
      x.action = { type: "process_payment_intent", status: "in_progress", paymentIntent: ref, failureCode: null };
      return api.getReader(a, r);
    },
    async cancelReaderAction(a, r) {
      const x = readers.get(r);
      if (x && x.account === a) x.action = null;
      return api.getReader(a, r);
    },
    async presentTestCard(a, r, number) {
      if (live) throw new CardPaymentsError("test only", "live_mode");
      const x = readers.get(r);
      if (!x || x.account !== a || !x.action?.paymentIntent) throw new CardPaymentsError("Nothing to pay on the reader.", "no_action");
      const p = pi(a, x.action.paymentIntent);
      if (number === "4000000000009995") {
        p.status = "requires_payment_method";
        p.errorCode = "insufficient_funds";
        x.action = { ...x.action, status: "failed", failureCode: "card_declined" };
      } else {
        succeed(p, VISA);
        x.action = { ...x.action, status: "succeeded" };
      }
      return api.getReader(a, r);
    },
    async createReaderPayment(a, input, key) {
      acc(a);
      calls.push({ method: "createReaderPayment", account: a, key });
      return copy(
        once(key, () => {
          const p: Pi = { account: a, id: id("pi"), status: "requires_payment_method", amount: input.amountPence, amountReceived: 0, currency: "gbp", livemode: live, metadata: { ...input.metadata }, customer: null, paymentMethod: null, applicationFee: input.feePence, card: null, errorCode: null, createdAt: nowS() };
          intents.set(p.id, p);
          return p;
        }),
      );
    },
    async chargeSavedCard(a, input, key): Promise<ChargeOutcome> {
      acc(a);
      calls.push({ method: "chargeSavedCard", account: a, key });
      const card = cards.get(input.paymentMethod);
      if (!card || card.account !== a || card.customer !== input.customer) throw new CardPaymentsError("The card payment service refused the request.", "resource_missing");
      const result = once(key, (): ChargeOutcome => {
        const p: Pi = { account: a, id: id("pi"), status: "requires_payment_method", amount: input.amountPence, amountReceived: 0, currency: "gbp", livemode: live, metadata: { ...input.metadata }, customer: input.customer, paymentMethod: input.paymentMethod, applicationFee: input.feePence, card: null, errorCode: null, createdAt: nowS() };
        intents.set(p.id, p);
        if (declining.has(input.paymentMethod)) {
          p.errorCode = "card_declined";
          return { ok: false, code: "card_declined", intent: copy(p) };
        }
        succeed(p, card.card);
        return { ok: true, intent: copy(p) };
      });
      if (api.loseAnswers > 0) {
        api.loseAnswers -= 1;
        throw new CardPaymentsError("The card payment service could not be reached. Try again.", "unreachable");
      }
      return copy(result);
    },
    async getPaymentIntent(a, ref) {
      return copy(pi(a, ref));
    },
    async cancelPaymentIntent(a, ref) {
      const p = pi(a, ref);
      if (p.status === "succeeded") throw new CardPaymentsError("Already succeeded.", "payment_intent_unexpected_state");
      p.status = "canceled";
      return copy(p);
    },
    async findPaymentsForIntent(a, cardIntentId) {
      return Array.from(intents.values()).filter((p) => p.account === a && p.metadata.card_intent_id === cardIntentId).map(copy);
    },
    async createCustomer(a, _input, key) {
      acc(a);
      return once(key, () => id("cus"));
    },
    async createPaymentCheckout(a, input, key) {
      acc(a);
      return copy(
        once(key, () => {
          const c: Cs = { account: a, id: id("cs"), mode: "payment", status: "open", paymentStatus: "unpaid", paymentIntent: null, setupIntent: null, metadata: { ...input.metadata }, url: `https://checkout.example.test/pay`, livemode: live, amountTotal: input.amountPence, customer: null, amount: input.amountPence, fee: input.feePence };
          checkouts.set(c.id, c);
          return c;
        }),
      );
    },
    async createSetupCheckout(a, input, key) {
      acc(a);
      return copy(
        once(key, () => {
          const c: Cs = { account: a, id: id("cs"), mode: "setup", status: "open", paymentStatus: "no_payment_required", paymentIntent: null, setupIntent: null, metadata: { ...input.metadata }, url: `https://checkout.example.test/setup`, livemode: live, amountTotal: null, customer: input.customer, amount: 0, fee: 0 };
          checkouts.set(c.id, c);
          return c;
        }),
      );
    },
    async getCheckout(a, ref) {
      const c = checkouts.get(ref);
      if (!c || c.account !== a) throw new CardPaymentsError("The card payment service refused the request.", "resource_missing");
      return copy(c);
    },
    async expireCheckout(a, ref) {
      const c = checkouts.get(ref);
      if (c && c.account === a && c.status === "open") c.status = "expired";
    },
    async getSetupIntent(a, ref) {
      const x = setups.get(ref);
      if (!x || x.account !== a) throw new CardPaymentsError("The card payment service refused the request.", "resource_missing");
      return copy(x);
    },
    async getCard(a, ref) {
      const c = cards.get(ref);
      if (!c || c.account !== a) throw new CardPaymentsError("No card.", "resource_missing");
      return { ...c.card, customer: c.customer };
    },
    async detachCard(a, ref) {
      if (cards.get(ref)?.account === a) cards.delete(ref);
    },
    async createRefund(a, input, key) {
      const p = pi(a, input.paymentIntent);
      calls.push({ method: "createRefund", account: a, key });
      const out = copy(
        once(key, () => {
          const done = Array.from(refunds.values()).filter((r) => r.paymentIntent === p.id && r.status !== "failed").reduce((x, r) => x + r.amount, 0);
          if (done + input.amountPence > p.amountReceived) throw new CardPaymentsError("The card payment service refused the request.", "charge_already_refunded");
          const r: Rf = { account: a, id: id("re"), status: "succeeded", amount: input.amountPence, paymentIntent: p.id, metadata: { ...input.metadata }, livemode: live };
          refunds.set(r.id, r);
          lines.push({ account: a, id: id("txn"), type: "refund", amount: -r.amount, fee: 0, platformFee: 0, providerFee: 0, net: -r.amount, availableOn: nowS(), paymentIntent: p.id });
          return r;
        }),
      );
      if (api.loseRefundAnswers > 0) {
        api.loseRefundAnswers -= 1;
        throw new CardPaymentsError("The card payment service could not be reached. Try again.", "unreachable");
      }
      return out;
    },
    async getRefund(a, ref) {
      const r = refunds.get(ref);
      if (!r || r.account !== a) throw new CardPaymentsError("The card payment service refused the request.", "resource_missing");
      return copy(r);
    },
    async getBalance(a) {
      acc(a);
      return { available: 0, pending: lines.filter((l) => l.account === a).reduce((x, l) => x + l.net, 0) };
    },
    async listPayouts(a): Promise<PayoutInfo[]> {
      acc(a);
      return [];
    },
    async listBalanceLines(a) {
      return lines.filter((l) => l.account === a).map(({ account, ...l }) => (void account, l));
    },
    completeCheckout(a, ref, card = "visa") {
      const c = checkouts.get(ref);
      if (!c || c.account !== a) throw new Error("no checkout");
      if (c.mode === "payment") {
        const p: Pi = { account: a, id: id("pi"), status: "requires_payment_method", amount: c.amount, amountReceived: 0, currency: "gbp", livemode: live, metadata: { ...c.metadata }, customer: null, paymentMethod: null, applicationFee: c.fee, card: null, errorCode: null, createdAt: nowS() };
        intents.set(p.id, p);
        succeed(p, VISA);
        c.paymentIntent = p.id;
        c.paymentStatus = "paid";
      } else {
        const pm = id("pm");
        cards.set(pm, { account: a, customer: c.customer as string, card: VISA });
        if (card === "decline") declining.add(pm);
        const s: Si = { account: a, id: id("seti"), status: "succeeded", customer: c.customer, paymentMethod: pm, metadata: { ...c.metadata }, livemode: live };
        setups.set(s.id, s);
        c.setupIntent = s.id;
      }
      c.status = "complete";
    },
    dashboardRefund(a, ref, amount) {
      const p = pi(a, ref);
      const r: Rf = { account: a, id: id("re"), status: "succeeded", amount, paymentIntent: p.id, metadata: {}, livemode: live };
      refunds.set(r.id, r);
      return r;
    },
    setAccountStatus(a, status) {
      acc(a).status = status;
    },
  };
  return api;
}
