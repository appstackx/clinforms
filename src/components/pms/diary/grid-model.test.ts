/** The diary grid's geometry and shared rules (run by npm run test:site). */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DiaryCard } from "@/modules/pms/diary/view";
import { clampLength, clampStart, clashInColumn, hourMarks, longDate, minutesToPx, offRotaBands, snap, startTimeOptions, ukToIso, weekdayDate, weekRange } from "./grid-model";

const card = (id: string, start: string, end: string, status: DiaryCard["status"] = "booked", columnKey = "p:1"): DiaryCard =>
  ({ id, kind: "appointment", status, columnKey, startsAt: `2026-10-27T${start}:00.000Z`, endsAt: `2026-10-27T${end}:00.000Z` }) as DiaryCard;

describe("diary grid model", () => {
  it("15 minutes are 20 px; snaps to 15 minutes; keeps blocks inside the grid", () => {
    assert.equal(minutesToPx(15), 20);
    assert.equal(minutesToPx(60), 80);
    assert.equal(snap(607), 600);
    assert.equal(snap(608), 615);
    assert.equal(clampStart(1050, 45, { start: 480, end: 1080 }), 1035);
    assert.equal(clampLength(5, 600, { start: 480, end: 1080 }), 15);
    assert.equal(clampLength(600, 900, { start: 480, end: 1080 }), 180);
  });

  it("hour marks and the bands outside the rota", () => {
    assert.deepEqual(hourMarks({ start: 480, end: 600 }).map((h) => h.label), ["08:00", "09:00"]);
    assert.deepEqual(offRotaBands({ windows: [{ startMinute: 540, endMinute: 720, siteId: "s" }] }, { start: 480, end: 1080 }), [
      { top: 0, height: 60 },
      { top: 240, height: 360 },
    ]);
  });

  it("a move's clash: occupying items only, never the card itself, cancelled ones read as free", () => {
    // 27/10/2026 is GMT: UTC times are UK times.
    const cards = [card("a", "10:00", "10:30"), card("b", "11:00", "11:30", "cancelled"), card("c", "12:00", "12:30", "booked", "p:2")];
    const col = { key: "p:1", date: "2026-10-27" };
    assert.equal(clashInColumn(cards, col, "x", 600, 630)?.id, "a");
    assert.equal(clashInColumn(cards, col, "a", 600, 630), null);
    assert.equal(clashInColumn(cards, col, "x", 660, 690), null, "cancelled frees its slot");
    assert.equal(clashInColumn(cards, col, "x", 720, 750), null, "other column");
    assert.equal(clashInColumn(cards, col, "x", 630, 660), null, "half-open: 10:30 after 10:00–10:30");
  });

  it("UK dates and times", () => {
    assert.equal(weekdayDate("2026-10-27"), "Tue 27/10/2026");
    assert.equal(longDate("2026-10-27"), "Tuesday 27/10/2026");
    assert.equal(weekRange("2026-10-26", "2026-10-31"), "26/10 – 31/10/2026");
    assert.equal(ukToIso("02/07/1988"), "1988-07-02");
    assert.equal(ukToIso("31/02/1988"), null);
    assert.equal(startTimeOptions()[0], "07:00");
    assert.equal(startTimeOptions().at(-1), "20:45");
  });
});
