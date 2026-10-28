/** Handover §13.4 item 2: arrived / in treatment / completed are refused for an appointment that starts in the future. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nextStatusesAt, statusAllowedAt } from "./rules";

describe("seen statuses and the clock", () => {
  it("seen statuses open 60 minutes before the start; did not attend only after it; undo and cancelling any time", () => {
    const start = "2026-10-29T10:00:00.000Z";
    assert.equal(statusAllowedAt("arrived", start, "2026-10-28T21:00:00.000Z"), false, "the night before");
    assert.equal(statusAllowedAt("arrived", start, "2026-10-29T09:00:00.000Z"), true, "an hour early");
    assert.equal(statusAllowedAt("in_treatment", start, "2026-10-29T08:00:00.000Z"), false);
    assert.equal(statusAllowedAt("attended", start, "2026-10-29T08:59:00.000Z"), false);
    assert.equal(statusAllowedAt("dna", start, "2026-10-29T09:59:00.000Z"), false);
    assert.equal(statusAllowedAt("dna", start, "2026-10-29T10:00:00.000Z"), true);
    assert.equal(statusAllowedAt("cancelled", start, "2026-10-01T00:00:00.000Z"), true);
    assert.deepEqual(nextStatusesAt("appointment", "booked", start, "2026-10-28T21:00:00.000Z"), ["cancelled", "late_cancelled"]);
    assert.deepEqual(nextStatusesAt("appointment", "attended", start, "2026-10-28T21:00:00.000Z"), ["in_treatment", "arrived", "booked"], "undo is never time-limited");
  });
});
