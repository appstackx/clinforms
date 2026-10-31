/** Text credit rules: segment counting (1 credit = 1 segment), packs, the warning lines, automatic top-up. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AutoTopupInputSchema,
  CREDIT_COPY,
  CreditAdjustmentSchema,
  SMS_PACKS,
  creditsForSms,
  creditsText,
  lowThresholdFor,
  pencePerCredit,
  smsPack,
  topUpDue,
  warningDue,
} from "./credits";

describe("text credits: what a text costs (1 credit = 1 UK text segment)", () => {
  it("GSM-7: up to 160 characters is one credit, then one per 153", () => {
    assert.equal(creditsForSms(""), 0);
    assert.equal(creditsForSms("a"), 1);
    assert.equal(creditsForSms("a".repeat(160)), 1);
    assert.equal(creditsForSms("a".repeat(161)), 2);
    assert.equal(creditsForSms("a".repeat(306)), 2);
    assert.equal(creditsForSms("a".repeat(307)), 3);
    assert.equal(creditsForSms("a".repeat(459)), 3);
    assert.equal(creditsForSms("a".repeat(460)), 4);
  });

  it("GSM-7 extension characters (€ [ ] { } ^ ~ | \\) count twice", () => {
    assert.equal(creditsForSms("€".repeat(80)), 1, "80 × 2 = 160 units");
    assert.equal(creditsForSms(`${"€".repeat(80)}a`), 2, "161 units");
    assert.equal(creditsForSms(`Fee £20 ${"[x]".repeat(10)}`), 1);
  });

  it("£ and the usual accented letters stay GSM-7", () => {
    assert.equal(creditsForSms(`£${"é".repeat(159)}`), 1);
  });

  it("unicode (a character outside GSM-7): 70 per text, then one per 67", () => {
    assert.equal(creditsForSms("ł".repeat(70)), 1);
    assert.equal(creditsForSms("ł".repeat(71)), 2);
    assert.equal(creditsForSms("ł".repeat(134)), 2);
    assert.equal(creditsForSms("ł".repeat(135)), 3);
    // One curly quote turns the whole text unicode.
    assert.equal(creditsForSms(`${"a".repeat(100)}’`), 2);
  });

  it("an emoji counts as two UTF-16 units", () => {
    assert.equal(creditsForSms("🙂".repeat(35)), 1);
    assert.equal(creditsForSms("🙂".repeat(36)), 2);
  });
});

describe("text credits: packs", () => {
  it("the three packs and their prices", () => {
    assert.deepEqual(
      SMS_PACKS.map((p) => [p.key, p.credits, p.pricePence]),
      [
        ["sms_500", 500, 3000],
        ["sms_1000", 1000, 5500],
        ["sms_5000", 5000, 25000],
      ],
    );
    assert.equal(smsPack("sms_1000")?.credits, 1000);
    assert.equal(smsPack("sms_2"), null);
    assert.equal(smsPack(undefined), null);
    assert.deepEqual(SMS_PACKS.map(pencePerCredit), [6, 5.5, 5]);
    assert.equal(creditsText(1), "1 credit");
    assert.equal(creditsText(1500), "1,500 credits");
  });
});

describe("text credits: warnings at 20 % of the last pack and at zero, once per crossing", () => {
  it("the low line is 20 % of the last pack (the smallest pack until one is bought)", () => {
    assert.equal(lowThresholdFor(null), 100);
    assert.equal(lowThresholdFor(1000), 200);
    assert.equal(lowThresholdFor(5000), 1000);
  });

  it("low at or under the line, zero at 0 – each only when not already sent", () => {
    const s = { balance: 250, lowThreshold: 200, lowWarned: false, zeroWarned: false };
    assert.equal(warningDue(s), null);
    assert.equal(warningDue({ ...s, balance: 200 }), "low");
    assert.equal(warningDue({ ...s, balance: 1, lowWarned: true }), null);
    assert.equal(warningDue({ ...s, balance: 0, lowWarned: true }), "zero");
    assert.equal(warningDue({ ...s, balance: 0, lowWarned: true, zeroWarned: true }), null);
    assert.equal(warningDue({ ...s, balance: 0 }), "zero", "zero covers low when both are crossed at once");
  });
});

describe("text credits: automatic top-up", () => {
  const on = { autoTopup: true, paused: false, hasCard: true, pack: "sms_500" as const, balance: 150, threshold: 100 };
  it("due when a text would take the balance below the threshold", () => {
    assert.equal(topUpDue(on, 1), false);
    assert.equal(topUpDue(on, 51), true);
    assert.equal(topUpDue({ ...on, balance: 99 }, 0), true);
  });
  it("never without the setting, a saved card, a pack, or while paused", () => {
    assert.equal(topUpDue({ ...on, autoTopup: false }, 200), false);
    assert.equal(topUpDue({ ...on, hasCard: false }, 200), false);
    assert.equal(topUpDue({ ...on, pack: null }, 200), false);
    assert.equal(topUpDue({ ...on, paused: true }, 200), false);
  });
});

describe("text credits: inputs and copy", () => {
  it("automatic top-up settings", () => {
    assert.equal(AutoTopupInputSchema.safeParse({ enabled: true, threshold: "100", pack: "sms_500" }).success, true);
    assert.equal(AutoTopupInputSchema.safeParse({ enabled: true, threshold: 0, pack: "sms_500" }).success, false);
    assert.equal(AutoTopupInputSchema.safeParse({ enabled: true, threshold: 10.5, pack: "sms_500" }).success, false);
    assert.equal(AutoTopupInputSchema.safeParse({ enabled: true, threshold: 100, pack: "sms_2" }).success, false);
  });
  it("support adjustments need a whole non-zero number and a reason", () => {
    assert.equal(CreditAdjustmentSchema.safeParse({ credits: -50, reason: "Goodwill reversal" }).success, true);
    assert.equal(CreditAdjustmentSchema.safeParse({ credits: 0, reason: "None" }).success, false);
    assert.equal(CreditAdjustmentSchema.safeParse({ credits: 5, reason: "" }).success, false);
    assert.equal(CreditAdjustmentSchema.safeParse({ credits: 200_000, reason: "Too many" }).success, false);
  });
  it("the copy is plain and never names the payment provider", () => {
    const all = Object.values(CREDIT_COPY).join(" ");
    assert.doesNotMatch(all, /stripe|twilio|ai\b/i);
    assert.match(CREDIT_COPY.nonRefundable, /not refundable/);
  });
});
