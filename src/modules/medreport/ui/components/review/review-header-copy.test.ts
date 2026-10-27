/**
 * bh2 WF: the review header's reference (review-header.tsx). A reference staff typed for another organisation's form can
 * be a long answer; shown unbroken it widened the header by 302 px at 375 px (bh2-base §8). It is shortened (in full on
 * hover) and may wrap.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { REFERENCE_SHOWN, shortReference } from "./review-header";

test("a short reference is shown as it is; a long one is shortened at a word-safe length, its spacing flattened", () => {
  assert.equal(shortReference("NCS-2026-118"), "NCS-2026-118");
  assert.equal(shortReference("  NCS-2026-118 \n"), "NCS-2026-118");
  const long = "The case manager's own reference is on the referral letter dated 01/09/2026 and the portal case page";
  const shown = shortReference(long);
  assert.ok(shown.length <= REFERENCE_SHOWN, shown);
  assert.ok(shown.endsWith("…"));
  assert.ok(long.startsWith(shown.slice(0, -1)));
  assert.equal(shortReference("x".repeat(REFERENCE_SHOWN)), "x".repeat(REFERENCE_SHOWN), "exactly the limit: unchanged");
});
