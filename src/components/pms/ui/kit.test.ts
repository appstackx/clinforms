/**
 * The clinic-system kit's rules (design system v1): status → pill, the diary block's one-line collapse, page
 * numbers, avatar colours and initials, the "is the person typing" rule – and that the pill and block render the
 * word, never colour alone.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { APPOINTMENT_STATUS_STYLES, INVOICE_STATUS_STYLES, NOTE_STATUS_STYLES, statusStyle, TONE_CLASSES } from "./status";
import { blockMinutes, diaryBlockStyle, isCollapsedBlock, minutesOf, type DiaryBlockStatus } from "./diary-block-model";
import { pageItems, showingText, totalPagesOf } from "./pagination-model";
import { AVATAR_COLOURS, avatarColour, initialsOf } from "./avatar-colour";
import { isPlainKey, isTypingTarget } from "./shortcuts";
import { StatusPill } from "./status-pill";
import { DiaryBlock } from "./diary-block";
import { APPOINTMENT_STATUSES } from "@/modules/pms/diary/rules";

describe("status → pill", () => {
  it("maps the design's appointment states to their words, tones and icons", () => {
    const expected: Record<string, [string, string, string]> = {
      booked: ["Booked", "blue", "calendar"],
      arrived: ["Arrived", "amber", "user-check"],
      in_treatment: ["In treatment", "teal", "activity"],
      completed: ["Completed", "green", "check-circle"],
      dna: ["Did not attend (DNA)", "red", "user-x"],
      late_cancelled: ["Late cancellation", "orange", "calendar-x"],
      cancelled: ["Cancelled", "slate", "x-circle"],
    };
    for (const [status, [label, tone, icon]] of Object.entries(expected)) {
      const s = statusStyle("appointment", status);
      assert.deepEqual([s.label, s.tone, s.icon], [label, tone, icon], status);
    }
    assert.equal(statusStyle("appointment", "cancelled").strike, true);
    assert.equal(statusStyle("appointment", "booked").strike, false);
  });

  it("covers every status the diary stores", () => {
    for (const status of APPOINTMENT_STATUSES) assert.ok(APPOINTMENT_STATUS_STYLES[status], status);
    assert.equal(statusStyle("appointment", "attended").tone, "green");
  });

  it("maps invoice and note states, including billing's stored values", () => {
    assert.equal(statusStyle("invoice", "part_paid").label, "Part-paid");
    assert.equal(statusStyle("invoice", "unpaid").label, "Issued");
    assert.equal(statusStyle("invoice", "cancelled").label, "Void");
    assert.equal(statusStyle("invoice", "void").strike, true);
    assert.equal(statusStyle("invoice", "overdue").tone, "red");
    assert.equal(statusStyle("note", "signed").icon, "lock");
    assert.equal(statusStyle("note", "unsigned").tone, "amber");
    assert.equal(statusStyle("note", "amended").label, "Amended");
  });

  it("an unknown status still gets a word (never a blank pill)", () => {
    const s = statusStyle("invoice", "written_off");
    assert.equal(s.label, "Written off");
    assert.equal(s.tone, "slate");
  });

  it("no two states of one kind look the same (tone + icon + word)", () => {
    for (const table of [APPOINTMENT_STATUS_STYLES, INVOICE_STATUS_STYLES, NOTE_STATUS_STYLES]) {
      const seen = new Map<string, string>();
      for (const [key, s] of Object.entries(table)) {
        const look = `${s.tone}|${s.icon}|${s.label}`;
        const prev = seen.get(look);
        // Aliases (unpaid = issued, cancelled = void) are the same state under two stored names.
        if (prev) assert.ok(["unpaid", "cancelled"].includes(key) || ["unpaid", "cancelled"].includes(prev), `${key} looks like ${prev}`);
        seen.set(look, key);
      }
    }
    for (const tone of Object.values(TONE_CLASSES)) assert.match(tone.text, /^text-\[#/);
  });

  it("renders icon + word, nowrap, and the line-through for cancelled", () => {
    const html = renderToStaticMarkup(createElement(StatusPill, { kind: "appointment", status: "cancelled" }));
    assert.match(html, /whitespace-nowrap/);
    assert.match(html, /line-through/);
    assert.match(html, /<svg[^>]*aria-hidden="true"/);
    assert.match(html, />Cancelled<\/span>$/);
    const custom = renderToStaticMarkup(createElement(StatusPill, { kind: "appointment", status: "arrived", label: "Arrived 10:27", size: "sm" }));
    assert.match(custom, /Arrived 10:27/);
    assert.doesNotMatch(custom, /border-\[#/);
  });
});

describe("diary block", () => {
  it("collapses at 15 minutes or less", () => {
    assert.equal(isCollapsedBlock(5), true);
    assert.equal(isCollapsedBlock(15), true);
    assert.equal(isCollapsedBlock(16), false);
    assert.equal(isCollapsedBlock(45), false);
    assert.equal(isCollapsedBlock(Number.NaN), false);
  });

  it("reads lengths from HH:MM", () => {
    assert.equal(minutesOf("09:05"), 545);
    assert.equal(minutesOf("24:00"), null);
    assert.equal(minutesOf("9.00"), null);
    assert.equal(blockMinutes("09:00", "09:45"), 45);
    assert.equal(blockMinutes("14:15", "14:30"), 15);
    assert.equal(blockMinutes("x", "09:00"), null);
  });

  it("hatches cancelled, late-cancelled and blocked time; crosses out cancelled names", () => {
    const hatched: DiaryBlockStatus[] = ["cancelled", "late_cancelled", "blocked"];
    for (const s of hatched) {
      assert.equal(diaryBlockStyle(s).hatched, true, s);
      assert.match(diaryBlockStyle(s).classes, /repeating-linear-gradient/);
    }
    assert.equal(diaryBlockStyle("booked").hatched, false);
    assert.equal(diaryBlockStyle("cancelled").strikeName, true);
    assert.equal(diaryBlockStyle("blocked").strikeName, false);
    assert.equal(diaryBlockStyle("dna").tag, "DNA");
  });

  it("renders one line at 15 minutes and three lines at 30; screen readers get the full words", () => {
    const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    const short = renderToStaticMarkup(createElement(DiaryBlock, { status: "arrived", start: "15:00", end: "15:15", title: "Tom Hughes", detail: "Review" }));
    assert.equal(text(short), "15:00–15:15,Tom Hughes, Review, Arrived");
    assert.equal((short.match(/class="[^"]*sr-only/g) ?? []).length, 2, "end time, type and status are for screen readers only");
    const long = renderToStaticMarkup(createElement(DiaryBlock, { status: "dna", start: "09:00", end: "09:45", title: "Margaret Ellis", detail: "Initial assessment", initial: true }));
    assert.equal(text(long), "09:00–09:45DNA (did not attend)Margaret Ellis+ Initial: Initial assessment");
    assert.doesNotMatch(long, /aria-label=/, "the visible words are the name (label in name)");
  });
});

describe("pagination", () => {
  it("shows first, last and three around the current page", () => {
    assert.deepEqual(pageItems(1, 13), [1, 2, 3, "gap", 13]);
    assert.deepEqual(pageItems(7, 13), [1, "gap", 6, 7, 8, "gap", 13]);
    assert.deepEqual(pageItems(13, 13), [1, "gap", 11, 12, 13]);
    assert.deepEqual(pageItems(3, 13), [1, 2, 3, 4, "gap", 13]);
    assert.deepEqual(pageItems(4, 13), [1, 2, 3, 4, 5, "gap", 13]);
    assert.deepEqual(pageItems(2, 4), [1, 2, 3, 4]);
    assert.deepEqual(pageItems(1, 0), [1]);
    assert.deepEqual(pageItems(99, 13), [1, "gap", 11, 12, 13]);
  });

  it("counts pages and says what is shown", () => {
    assert.equal(totalPagesOf(312, 25), 13);
    assert.equal(totalPagesOf(0, 25), 1);
    assert.equal(showingText(1, 25, 312), "Showing 1–25 of 312");
    assert.equal(showingText(13, 25, 312), "Showing 301–312 of 312");
    assert.equal(showingText(1, 25, 1200), "Showing 1–25 of 1,200");
    assert.equal(showingText(1, 25, 0), "Nothing to show");
  });
});

describe("avatar", () => {
  it("picks the same colour for the same name, whatever the spacing or case", () => {
    assert.deepEqual(avatarColour("Priya Shah"), avatarColour("  priya   SHAH "));
    assert.ok(AVATAR_COLOURS.includes(avatarColour("Tom Hughes")));
  });

  it("spreads names over the palette", () => {
    const names = ["Priya Shah", "Tom Hughes", "Amira Rahman", "Dan Morgan", "Helen Ward", "Jess Taylor", "Megan Hart", "Daniel Brooks", "Sarah Reid", "Grace Bennett", "Owen Price", "Chloe Bennett"];
    const used = new Set(names.map((n) => avatarColour(n).bg));
    assert.ok(used.size >= 4, `only ${used.size} colours for ${names.length} names`);
  });

  it("makes initials from the first and last word", () => {
    assert.equal(initialsOf("Priya Shah"), "PS");
    assert.equal(initialsOf("Anne-Marie de la Cruz"), "AC");
    assert.equal(initialsOf("madonna"), "M");
    assert.equal(initialsOf("Rita Owner (fictional)"), "RO");
    assert.equal(initialsOf("   "), "?");
  });
});

describe("keyboard shortcuts", () => {
  it("never fire while typing", () => {
    assert.equal(isTypingTarget({ tagName: "INPUT", type: "search" }), true);
    assert.equal(isTypingTarget({ tagName: "TEXTAREA" }), true);
    assert.equal(isTypingTarget({ tagName: "DIV", isContentEditable: true }), true);
    assert.equal(isTypingTarget({ tagName: "INPUT", type: "checkbox" }), false);
    assert.equal(isTypingTarget({ tagName: "BUTTON" }), false);
    assert.equal(isTypingTarget(null), false);
  });

  it("are plain keys (browser shortcuts with Ctrl/Alt/Cmd stay the browser's)", () => {
    assert.equal(isPlainKey({ key: "/" }, "/"), true);
    assert.equal(isPlainKey({ key: "/", metaKey: true }, "/"), false);
    assert.equal(isPlainKey({ key: "?", ctrlKey: true }, "?"), false);
  });
});
