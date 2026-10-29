/**
 * The kit's Part A components (round 2 brief): the date rules behind the date and time pickers, the dropdown menu's
 * keyboard moves, file checks, chart scales, step states, the breadcrumb's back link and the banners' words – and that
 * the rendered markup carries the roles and names assistive technology needs.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { addDays, addMonths, clampDate, formatUkDate, inRange, longUkDate, monthGrid, moveFocus, parseUkDate, timeSlots, weekdayOf } from "./date-model";
import { nextEnabled, typeAhead } from "./dropdown-menu";
import { acceptText, checkFile, formatBytes } from "./file-upload";
import { axisTicks, dataMax, niceMax, SERIES_STYLES, stackSegments } from "./chart-model";
import { StepIndicator, stepStates } from "./step-indicator";
import { Breadcrumb, parentOf } from "./breadcrumb";
import { LockedBanner, UnsavedChangesBanner, unsavedText } from "./banners";
import { SegmentedControl } from "./segmented-control";
import { DatePicker, TimePicker } from "./date-picker";
import { PatientCombobox } from "./patient-combobox";
import { FileUpload } from "./file-upload";
import { PmsChart } from "./chart";

describe("dates (DD/MM/YYYY, Monday-first)", () => {
  it("formats and parses UK dates, refusing impossible ones and two-digit years", () => {
    assert.equal(formatUkDate("2026-10-27"), "27/10/2026");
    assert.equal(formatUkDate("2026-02-30"), "");
    assert.equal(parseUkDate("27/10/2026"), "2026-10-27");
    assert.equal(parseUkDate("1.2.2026"), "2026-02-01");
    assert.equal(parseUkDate(" 05-11-2026 "), "2026-11-05");
    assert.equal(parseUkDate("31/02/2026"), null);
    assert.equal(parseUkDate("27/10/26"), null);
    assert.equal(parseUkDate("2026-10-27"), null);
    assert.equal(longUkDate("2026-10-27"), "Tuesday 27 October 2026");
  });

  it("adds days and months across month and year ends, clamping to the month's last day", () => {
    assert.equal(addDays("2026-12-31", 1), "2027-01-01");
    assert.equal(addDays("2026-03-01", -1), "2026-02-28");
    assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
    assert.equal(addMonths("2028-01-31", 1), "2028-02-29");
    assert.equal(addMonths("2026-11-15", -12), "2025-11-15");
    assert.equal(weekdayOf("2026-10-26"), 1);
    assert.equal(weekdayOf("2026-11-01"), 7);
  });

  it("builds whole Monday-first weeks with the neighbouring months' days marked", () => {
    const weeks = monthGrid(2026, 10);
    assert.ok(weeks.every((w) => w.length === 7));
    assert.equal(weeks[0][0].iso, "2026-09-28");
    assert.equal(weeks[0][0].inMonth, false);
    assert.equal(weeks[0][3].iso, "2026-10-01");
    assert.equal(weeks.at(-1)!.at(-1)!.iso, "2026-11-01");
    assert.equal(weeks.flat().filter((d) => d.inMonth).length, 31);
  });

  it("moves the calendar's focus like the WAI-ARIA date picker", () => {
    assert.equal(moveFocus("2026-10-27", "ArrowRight"), "2026-10-28");
    assert.equal(moveFocus("2026-10-27", "ArrowUp"), "2026-10-20");
    assert.equal(moveFocus("2026-10-27", "Home"), "2026-10-26");
    assert.equal(moveFocus("2026-10-27", "End"), "2026-11-01");
    assert.equal(moveFocus("2026-10-31", "PageDown"), "2026-11-30");
    assert.equal(moveFocus("2026-10-27", "PageUp", true), "2025-10-27");
    assert.equal(moveFocus("2026-10-27", "a"), null);
  });

  it("keeps dates inside min and max", () => {
    assert.ok(inRange("2026-10-27", "2026-10-27", "2026-12-31"));
    assert.ok(!inRange("2026-10-26", "2026-10-27"));
    assert.equal(clampDate("2027-02-01", undefined, "2026-12-31"), "2026-12-31");
    assert.equal(clampDate("2026-01-01", "2026-10-27"), "2026-10-27");
  });

  it("offers 24-hour times in 5- and 15-minute steps", () => {
    assert.deepEqual(timeSlots(15, "08:00", "09:00"), ["08:00", "08:15", "08:30", "08:45", "09:00"]);
    assert.equal(timeSlots(5, "08:00", "08:30").length, 7);
    assert.deepEqual(timeSlots(15, "08:05", "08:40"), ["08:15", "08:30"]);
    assert.equal(timeSlots(15).length, 96);
    assert.equal(timeSlots(15).at(-1), "23:45");
  });
});

describe("dropdown menu keys", () => {
  it("skips disabled items and wraps", () => {
    const enabled = [true, false, true, true];
    assert.equal(nextEnabled(enabled, 0, 1), 2);
    assert.equal(nextEnabled(enabled, 3, 1), 0);
    assert.equal(nextEnabled(enabled, 0, -1), 3);
    assert.equal(nextEnabled(enabled, -1, 1), 0);
    assert.equal(nextEnabled([false, false], 0, 1), -1);
  });
  it("jumps to the next item starting with a typed letter", () => {
    const labels = ["Mark as arrived", "Start treatment", "Rebook", "Did not attend (DNA)…", "Cancel appointment…"];
    const enabled = labels.map(() => true);
    assert.equal(typeAhead(labels, enabled, 0, "c"), 4);
    assert.equal(typeAhead(labels, enabled, 0, "R"), 2);
    assert.equal(typeAhead(labels, enabled, 0, "z"), -1);
  });
});

describe("file upload checks", () => {
  it("refuses wrong types, too-big and empty files in plain words", () => {
    const accept = [".pdf", ".jpg", ".png"];
    assert.equal(checkFile({ name: "Letter.PDF", type: "application/pdf", size: 1000 }, accept, 10 * 1024 * 1024), null);
    assert.match(checkFile({ name: "photo.heic", type: "image/heic", size: 1000 }, accept) ?? "", /isn’t a file type we accept\. Use PDF, JPG or PNG\./);
    assert.match(checkFile({ name: "scan.pdf", type: "application/pdf", size: 12 * 1024 * 1024 }, accept, 10 * 1024 * 1024) ?? "", /is 12 MB – the limit is 10 MB/);
    assert.match(checkFile({ name: "blank.pdf", type: "application/pdf", size: 0 }, accept) ?? "", /is empty/);
    assert.equal(checkFile({ name: "x.webp", type: "image/webp", size: 5 }, ["image/*"]), null);
  });
  it("formats sizes and type lists", () => {
    assert.equal(formatBytes(512), "512 bytes");
    assert.equal(formatBytes(1536), "1.5 KB");
    assert.equal(formatBytes(10 * 1024 * 1024), "10 MB");
    assert.equal(acceptText([".pdf"]), "PDF");
    assert.equal(acceptText([".pdf", ".jpg", ".png"]), "PDF, JPG or PNG");
  });
});

describe("chart scales", () => {
  it("rounds the axis up to a nice number and spaces the ticks", () => {
    assert.equal(niceMax(171), 200);
    assert.equal(niceMax(52), 100);
    assert.equal(niceMax(21), 25);
    assert.equal(niceMax(20950), 25000);
    assert.equal(niceMax(0), 1);
    assert.deepEqual(axisTicks(200), [0, 50, 100, 150, 200]);
  });
  it("stacks per category and takes the stacked total as the maximum", () => {
    const series = [
      { name: "A", values: [1, 2] },
      { name: "B", values: [3, 4] },
    ];
    assert.equal(dataMax("stacked", series, 2), 6);
    assert.equal(dataMax("bar", series, 2), 4);
    assert.deepEqual(stackSegments(series, 2), [
      [
        [0, 1],
        [1, 4],
      ],
      [
        [0, 2],
        [2, 6],
      ],
    ]);
  });
  it("uses token colours with a distinct marker per series", () => {
    assert.equal(new Set(SERIES_STYLES.map((s) => s.marker)).size, SERIES_STYLES.length);
    assert.ok(SERIES_STYLES.every((s) => /^fill-(primary|secondary|accent-text|muted-foreground)$/.test(s.fill)));
  });
  it("renders one named image and a Chart | Table switch", () => {
    const html = renderToStaticMarkup(createElement(PmsChart, { kind: "stacked", title: "Income by payer", summary: "Income rose.", categories: ["Sep", "Oct"], series: [{ name: "Self-pay", values: [1, 2] }, { name: "Insurer", values: [3, 4] }] }));
    assert.match(html, /role="img" aria-label="Income rose\."/);
    assert.match(html, /role="radiogroup" aria-label="Show Income by payer as"/);
    assert.match(html, /role="radio" aria-checked="true"[^>]*>Chart</);
    assert.match(html, /aria-label="Legend"/);
    const table = renderToStaticMarkup(createElement(PmsChart, { kind: "bar", title: "New", summary: "s", categories: ["Oct"], series: [{ name: "New patients", values: [47] }], defaultView: "table" }));
    assert.match(table, /<th scope="row"[^>]*>Oct<\/th><td[^>]*>47<\/td>/);
  });
});

describe("step indicator", () => {
  it("marks past steps done, one current, the rest upcoming", () => {
    assert.deepEqual(stepStates(4, 2), ["done", "done", "current", "upcoming"]);
    const html = renderToStaticMarkup(createElement(StepIndicator, { label: "Booking steps", steps: ["Clinic", "Service", "Time"], current: 1 }));
    assert.match(html, /<nav aria-label="Booking steps"/);
    assert.match(html, /aria-current="step"/);
    assert.match(html, /Clinic<span class="sr-only"> \(done\)<\/span>/);
    assert.match(html, /Step (?:<!-- -->)?2(?:<!-- -->)? of (?:<!-- -->)?3/);
  });
});

describe("breadcrumb", () => {
  it("marks the current page and backs up to the parent on a phone", () => {
    const items = [{ label: "Patients", href: "/p" }, { label: "Margaret Ellis", href: "/p/1" }, { label: "Note" }];
    assert.deepEqual(parentOf(items), { label: "Margaret Ellis", href: "/p/1" });
    assert.equal(parentOf([{ label: "Only" }]), null);
    const html = renderToStaticMarkup(createElement(Breadcrumb, { items }));
    assert.match(html, /<nav aria-label="Breadcrumb"/);
    assert.match(html, /aria-current="page"[^>]*>Note</);
    assert.match(html, /href="\/p\/1"[^>]*>.*Back to (?:<!-- -->)?Margaret Ellis/);
  });
});

describe("banners", () => {
  it("counts unsaved changes in words", () => {
    assert.equal(unsavedText(), "Unsaved changes");
    assert.equal(unsavedText(1), "1 unsaved change");
    assert.equal(unsavedText(3), "3 unsaved changes");
    const html = renderToStaticMarkup(createElement(UnsavedChangesBanner, { count: 2, onDiscard: () => undefined, onSave: () => undefined }));
    assert.match(html, /role="status"/);
    assert.match(html, />Discard</);
    assert.match(html, />Save changes</);
  });
  it("locks with a reason, as a note", () => {
    const html = renderToStaticMarkup(createElement(LockedBanner, { title: "Read only.", variant: "read-only" }, "Only an administrator can change it."));
    assert.match(html, /role="note"/);
    assert.match(html, /Read only\./);
  });
});

describe("controls' roles and names", () => {
  it("segmented control is a radio group with one Tab stop", () => {
    const html = renderToStaticMarkup(createElement(SegmentedControl, { label: "Diary view", value: "week", onChange: () => undefined, options: [{ value: "day", label: "Day" }, { value: "week", label: "Week" }] }));
    assert.match(html, /role="radiogroup" aria-label="Diary view"/);
    assert.match(html, /aria-checked="false" tabindex="-1"[^>]*>Day</);
    assert.match(html, /aria-checked="true" tabindex="0"[^>]*>Week</);
  });
  it("date picker has a DD/MM/YYYY box and a named calendar button; time picker lists 24-hour steps", () => {
    const html = renderToStaticMarkup(createElement(DatePicker, { id: "d", value: "2026-10-27", onChange: () => undefined, today: "2026-10-27" }));
    assert.match(html, /id="d"[^>]*value="27\/10\/2026"/);
    assert.match(html, /aria-haspopup="dialog"/);
    assert.match(html, /aria-label="Choose a date, selected Tuesday 27 October 2026"/);
    const t = renderToStaticMarkup(createElement(TimePicker, { id: "t", value: "09:07", onChange: () => undefined, step: 15, from: "09:00", to: "09:30" }));
    assert.match(t, /<option value="09:00">09:00<\/option><option value="09:07"[^>]*>09:07<\/option><option value="09:15">/);
  });
  it("patient combobox wires combobox → listbox", () => {
    const html = renderToStaticMarkup(createElement(PatientCombobox, { id: "pc", label: "Patient", query: "", onQueryChange: () => undefined, results: [], onSelect: () => undefined, onCreate: () => undefined }));
    assert.match(html, /role="combobox" aria-expanded="false" aria-controls="pc-list" aria-autocomplete="list"/);
    assert.match(html, /id="pc-list" role="listbox"[^>]*hidden/);
  });
  it("file upload names the drop zone, the rules and each file's progress", () => {
    const html = renderToStaticMarkup(
      createElement(FileUpload, { id: "fu", label: "Attachments", accept: [".pdf"], maxBytes: 1024 * 1024, onFiles: () => undefined, items: [{ id: "1", name: "a.pdf", size: 10, progress: 40 }] }),
    );
    assert.match(html, /role="group" aria-labelledby="fu-label" aria-describedby="fu-rules"/);
    assert.match(html, /PDF(?:<!-- -->)?, up to 1 MB each/);
    assert.match(html, /role="progressbar" aria-label="Uploading a.pdf" aria-valuemin="0" aria-valuemax="100" aria-valuenow="40"/);
  });
});
