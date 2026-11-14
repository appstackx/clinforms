/**
 * Card payments through the clinic's own connected account: the pure rules, and the whole suite (./testing/card-suite.ts)
 * on node:sqlite and PGlite with the tenant-scope guard. The D1 runs (in-process gateway and real local workerd D1)
 * are in workers/data-gateway/test/pms-billing-cards-stack.test.ts. Run by `npm run test:pms` and `npm run test:db`.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  accountStateOf,
  cardConsentWording,
  cardPaymentsReady,
  cardPaymentsSwitchOn,
  membershipConsentWording,
  nextChargeOn,
  noShowChargeRefusal,
  periodOf,
  platformFeePence,
} from "../../../../modules/pms/billing/card-payments";
import { createGuardedPgliteDb, createGuardedSqliteDb } from "../../../repos/pms/testing/guarded-db";
import { connectConfig, v2Base } from "./client";
import { defineCardPaymentsSuite } from "./testing/card-suite";

describe("card payments – pure rules", () => {
  it("the platform switch is 'on' only", () => {
    assert.equal(cardPaymentsSwitchOn({ CLINFORMS_CARD_PAYMENTS: " ON " }), true);
    for (const v of [undefined, "", "1", "true", "yes", "off"]) assert.equal(cardPaymentsSwitchOn({ CLINFORMS_CARD_PAYMENTS: v }), false);
  });

  it("platform fee: 0 by default, basis points + fixed, never more than half the payment", () => {
    assert.equal(platformFeePence(5500, { bps: 0, fixedPence: 0 }), 0);
    assert.equal(platformFeePence(5500, { bps: 100, fixedPence: 0 }), 55);
    assert.equal(platformFeePence(5550, { bps: 150, fixedPence: 20 }), 103);
    assert.equal(platformFeePence(40, { bps: 1000, fixedPence: 500 }), 20);
    assert.equal(platformFeePence(5500, { bps: 99999, fixedPence: 99999 }), 1050, "capped at 10% + £5");
    assert.equal(platformFeePence(-1, { bps: 100, fixedPence: 0 }), 0);
  });

  it("account state from the provider's v2 account", () => {
    assert.equal(accountStateOf({ configuration: { merchant: { capabilities: { card_payments: { status: "active" } } } } }).status, "active");
    assert.equal(accountStateOf({ configuration: { merchant: { capabilities: { card_payments: { status: "restricted" } } } } }).status, "pending", "never onboarded");
    assert.equal(accountStateOf({ configuration: { merchant: { capabilities: { card_payments: { status: "restricted" } } } }, identity: { attestations: { terms_of_service: { account: { date: "2026-11-01T00:00:00Z" } } } } }).status, "restricted");
    assert.equal(accountStateOf({ closed: true }).status, "closed");
    assert.equal(accountStateOf({}).status, "pending", "anything unknown is not active");
    assert.equal(accountStateOf({ requirements: { entries: [{ awaiting_action_from: "user" }, { awaiting_action_from: "stripe" }] } }).requirementsDue, 1);
  });

  it("ready: switch on, account of the key's mode; live needs active, test allows unverified test accounts", () => {
    const base = { enabled: true, accountRef: "acct_123456", status: "active" as const, mode: "live" as const, keyMode: "live" as const };
    assert.equal(cardPaymentsReady(base), true);
    assert.equal(cardPaymentsReady({ ...base, enabled: false }), false);
    assert.equal(cardPaymentsReady({ ...base, status: "restricted" }), false);
    assert.equal(cardPaymentsReady({ ...base, mode: "test" }), false, "a test account never takes live payments");
    assert.equal(cardPaymentsReady({ ...base, mode: "test", keyMode: "test", status: "pending" }), true);
    assert.equal(cardPaymentsReady({ ...base, mode: "test", keyMode: "test", status: "closed" }), false);
  });

  it("consent wording names the clinic and the provider; no-show part only with a policy", () => {
    const plain = cardConsentWording({ clinicName: "Riverside Physio (fictional)", noShowPolicy: null });
    assert.match(plain, /Riverside Physio \(fictional\)/);
    assert.match(plain, /Stripe/);
    assert.doesNotMatch(plain, /missed/);
    assert.match(cardConsentWording({ clinicName: "X", noShowPolicy: "Charged in full." }), /missed appointment.*Charged in full\./);
    assert.match(membershipConsentWording({ clinicName: "X", planName: "Gold", pricePence: 4500, chargeDay: 3 }), /£45\.00 today and then on day 3 of every month.*"Gold"/);
  });

  it("no-show rules", () => {
    assert.match(noShowChargeRefusal({ policyOn: false, mandateAllowsNoShow: true }) ?? "", /does not charge/);
    assert.match(noShowChargeRefusal({ policyOn: true, mandateAllowsNoShow: false }) ?? "", /did not agree/);
    assert.equal(noShowChargeRefusal({ policyOn: true, mandateAllowsNoShow: true }), null);
  });

  it("membership dates", () => {
    assert.equal(periodOf("2026-11-10"), "2026-11");
    assert.equal(nextChargeOn("2026-11-10", 10), "2026-12-10");
    assert.equal(nextChargeOn("2026-12-28", 28), "2027-01-28");
    assert.equal(nextChargeOn("2026-01-31", 31), "2026-02-28", "day clamped to 28");
  });

  it("configuration: the platform key's rules; the connect webhook has its own secrets; v2 base", () => {
    assert.equal(connectConfig({}).ok, false);
    const c = connectConfig({ STRIPE_CLINDESK_SECRET_KEY: "sk_test_abcdefghijklmnop", STRIPE_CLINDESK_CONNECT_WEBHOOK_SECRET: "whsec_0123456789abcdef", STRIPE_CLINDESK_WEBHOOK_SECRET: "whsec_platform_only_000000" });
    assert.ok(c.ok);
    if (c.ok) {
      assert.equal(c.config.mode, "test");
      assert.deepEqual(c.config.webhookSecrets, ["whsec_0123456789abcdef"], "never the platform webhook's secret");
    }
    assert.equal(connectConfig({ STRIPE_CLINDESK_SECRET_KEY: "sk_live_abcdefghijklmnop" }).ok, false, "a live key needs the go-live switch");
    assert.equal(v2Base("https://api.stripe.com/v1"), "https://api.stripe.com/v2");
  });
});

defineCardPaymentsSuite("SQLite (node:sqlite)", async () => createGuardedSqliteDb());
defineCardPaymentsSuite("Postgres (PGlite)", () => createGuardedPgliteDb());
