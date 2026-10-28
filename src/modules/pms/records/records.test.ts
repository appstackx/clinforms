/** Pure rules of the records module: outcome scoring, notes, templates, body chart, attachments, anonymising, forms. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { anonymiseCheck, lastTreatmentDate } from "./anonymise";
import { asciiFileName, checkAttachment, formatBytes, MAX_ATTACHMENT_BYTES, safeFileName, sniffAttachmentType } from "./attachments";
import { BodyChartSchema, describeMarker, MAX_MARKERS, normaliseChart, nudgeMarker, parseBodyChart } from "./body-chart";
import { addressLines, ageOn, displayName, isPlausibleRecordId, poundsToPence, penceToPounds, wholeNumber } from "./form-values";
import { AmendmentInputSchema, NoteContentSchema, canSign, canonicalNoteContent, noteHasContent, noteStatusLabel, sectionsForTemplate, shortFingerprint } from "./notes";
import { pmsCan } from "../core/permissions";
import { PMS_RECORD_TABS } from "../record-tabs";
import { recordTabItems, standInPermission } from "./record-tab-model";
import { ClinicalFlagInputSchema, PronounsSchema, titleLine } from "./flags";
import { DEFAULT_PATIENT_FILTERS, csvCell, csvLine, filtersFromParams, paramsFromFilters } from "./patient-list";
import { DEFAULT_UNSIGNED_NOTE_DAYS, overdueWindowLabel, signWithinText } from "./settings";
import { MEASURES, answersFromForm, formatScore, outcomeChange, scoreOutcome } from "./outcomes";
import { BUILTIN_TEMPLATES, NoteTemplateInputSchema, NoteTemplatePatchSchema, TemplateSectionsSchema, builtinTemplate, checkedOptions, isBuiltinTemplateId, parseSnapshot, sectionKeyFor, sectionLetter, toSnapshot } from "./templates";

const items = (values: (number | null)[], prefix = "s") => Object.fromEntries(values.map((v, i) => [`${prefix}${i + 1}`, v]));

describe("outcome measures: scoring", () => {
  it("NDI: % of the maximum for the answered sections; bands", () => {
    const all = scoreOutcome("ndi", { items: items([2, 2, 2, 2, 2, 2, 2, 2, 2, 2]) });
    assert.deepEqual(all, { ok: true, score: 40, scoreTenths: 400, answered: 10, band: "Moderate" });
    // one section missing: 18 of 45 = 40 %
    const nine = scoreOutcome("ndi", { items: items([2, 2, 2, 2, 2, 2, 2, 2, 2, null]) });
    assert.ok(nine.ok && nine.score === 40 && nine.answered === 9);
    const none = scoreOutcome("ndi", { items: items([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]) });
    assert.ok(none.ok && none.band === "No disability");
    const complete = scoreOutcome("ndi", { items: items([5, 5, 4, 4, 4, 3, 3, 3, 3, 3]) });
    assert.ok(complete.ok && complete.score === 74 && complete.band === "Complete");
    const tooFew = scoreOutcome("ndi", { items: items([1, 1, 1, 1, 1, 1, 1, null, null, null]) });
    assert.deepEqual(tooFew.ok, false);
    assert.equal(scoreOutcome("ndi", { items: items([6, 1, 1, 1, 1, 1, 1, 1, 1, 1]) }).ok, false, "above 5");
    assert.equal(scoreOutcome("ndi", { items: { ...items([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]), s11: 1 } }).ok, false, "unknown item");
    assert.equal(scoreOutcome("ndi", { items: items([1.5, 1, 1, 1, 1, 1, 1, 1, 1, 1]) }).ok, false, "whole numbers only");
  });

  it("ODI: Fairbank bands, one decimal", () => {
    const r = scoreOutcome("odi", { items: items([3, 2, 4, 2, 3, 2, 2, 0, 2, 3]) });
    assert.deepEqual(r, { ok: true, score: 46, scoreTenths: 460, answered: 10, band: "Severe" });
    const odd = scoreOutcome("odi", { items: items([1, 1, 1, 1, 1, 1, 1, 1, 2, null]) });
    assert.ok(odd.ok && odd.score === 22.2 && odd.scoreTenths === 222 && odd.band === "Moderate");
    assert.ok((scoreOutcome("odi", { items: items([0, 0, 0, 0, 1, 0, 0, 0, 0, 0]) }) as { band: string }).band === "Minimal");
    assert.ok((scoreOutcome("odi", { items: items([5, 5, 5, 5, 5, 5, 5, 5, 5, 4]) }) as { band: string }).band.startsWith("Bed-bound"));
  });

  it("NPRS: one rating 0–10 with a band", () => {
    assert.deepEqual(scoreOutcome("nprs", { items: { pain: 7 } }), { ok: true, score: 7, scoreTenths: 70, answered: 1, band: "Severe" });
    assert.deepEqual(scoreOutcome("nprs", { items: { pain: 0 } }), { ok: true, score: 0, scoreTenths: 0, answered: 1, band: "No pain" });
    assert.equal(scoreOutcome("nprs", { items: { pain: null } }).ok, false);
    assert.equal(scoreOutcome("nprs", { items: { pain: 11 } }).ok, false);
  });

  it("PSFS: 3–5 named activities, the average, higher is better", () => {
    const r = scoreOutcome("psfs", { items: { a1: 3, a2: 4, a3: 6, a4: null, a5: null }, activities: { a1: "Lifting boxes", a2: "Driving", a3: "Sleeping" } });
    assert.deepEqual(r, { ok: true, score: 4.3, scoreTenths: 43, answered: 3, band: null });
    assert.equal(scoreOutcome("psfs", { items: { a1: 3, a2: 4 }, activities: { a1: "x", a2: "y" } }).ok, false, "at least three");
    assert.equal(scoreOutcome("psfs", { items: { a1: 3, a2: 4, a3: 5 }, activities: { a1: "x", a2: "y" } }).ok, false, "a rating without an activity");
    assert.equal(scoreOutcome("psfs", { items: { a1: 3, a2: 4, a3: null }, activities: { a1: "x", a2: "y", a3: "z" } }).ok, false, "an activity without a rating");
    assert.equal(MEASURES.psfs.higherIsBetter, true);
    assert.deepEqual(outcomeChange("psfs", 43, 70), { deltaTenths: 27, direction: "better" });
  });

  it("QuickDASH: ((sum ÷ n) − 1) × 25, at least 10 of 11 answered", () => {
    const r = scoreOutcome("quickdash", { items: items([2, 3, 2, 2, 3, 2, 2, 3, 2, 2, 3], "q") });
    assert.ok(r.ok);
    assert.equal(r.ok && r.score, 34.1);
    const ten = scoreOutcome("quickdash", { items: items([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, null], "q") });
    assert.ok(ten.ok && ten.score === 0);
    assert.equal(scoreOutcome("quickdash", { items: items([1, 1, 1, 1, 1, 1, 1, 1, 1, null, null], "q") }).ok, false);
    assert.equal(scoreOutcome("quickdash", { items: items([0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], "q") }).ok, false, "1–5 only");
    const worst = scoreOutcome("quickdash", { items: items([5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5], "q") });
    assert.ok(worst.ok && worst.score === 100);
  });

  it("formats scores and the direction of change", () => {
    assert.equal(formatScore("ndi", 425), "42.5%");
    assert.equal(formatScore("nprs", 70), "7/10");
    assert.equal(formatScore("quickdash", 341), "34.1/100");
    assert.deepEqual(outcomeChange("ndi", 440, 300), { deltaTenths: -140, direction: "better" });
    assert.deepEqual(outcomeChange("nprs", 40, 60), { deltaTenths: 20, direction: "worse" });
    assert.deepEqual(outcomeChange("odi", 200, 200), { deltaTenths: 0, direction: "same" });
  });

  it("reads answers from a form (empty = unanswered, junk = reported)", () => {
    const form = new Map([
      ["item_s1", "3"],
      ["item_s2", ""],
      ["item_s3", "x"],
    ]);
    const a = answersFromForm("ndi", (n) => form.get(n) ?? null);
    assert.equal(a.items.s1, 3);
    assert.equal(a.items.s2, null);
    assert.ok(Number.isNaN(a.items.s3 as number));
    const p = answersFromForm("psfs", (n) => (n === "activity_a1" ? "  Running  " : n === "item_a1" ? "2" : null));
    assert.deepEqual(p.activities, { a1: "Running" });
  });

  it("holds no questionnaire wording: only section topics or item numbers", () => {
    for (const m of Object.values(MEASURES)) {
      for (const item of m.items) assert.ok(item.label.length <= 24, `${m.id}: ${item.label}`);
    }
  });
});

describe("clinical notes", () => {
  const ia = builtinTemplate("builtin-initial-soap")!;
  it("keeps only the template's sections, one-line sections on one line", () => {
    const parsed = NoteContentSchema.parse({ sections: { subjective: "  Neck pain\r\n", consent: "Verbal\nconsent", extra_thing: "smuggled", objective: "   " } });
    assert.deepEqual(parsed.sections, { subjective: "Neck pain", consent: "Verbal\nconsent", extra_thing: "smuggled" });
    assert.deepEqual(sectionsForTemplate(ia, parsed.sections), { subjective: "Neck pain", consent: "Verbal consent" });
    assert.equal(noteHasContent({}, null), false);
    assert.equal(noteHasContent({}, { markers: [{ view: "front", x: 50, y: 20, kind: "pain", intensity: null, label: null }] }), true);
  });

  it("a checklist section keeps only its own tick boxes, in the template's order", () => {
    assert.deepEqual(
      ia.sections.map((x) => sectionLetter(x)),
      ["S", "R", "O", "A", "P", "C"],
    );
    const flags = ia.sections.find((x) => x.kind === "checklist")!;
    assert.deepEqual(flags.options, ["Weight loss", "Night pain unrelated to position", "Fever", "Trauma", "Neurological signs"]);
    const kept = sectionsForTemplate(ia, { red_flags: "Trauma\nnot an option\nWeight loss" });
    assert.deepEqual(kept, { red_flags: "Weight loss\nTrauma" });
    assert.deepEqual(checkedOptions(flags, kept.red_flags), ["Weight loss", "Trauma"]);
    assert.deepEqual(sectionsForTemplate(ia, { red_flags: "nothing valid" }), {});
    assert.equal(TemplateSectionsSchema.safeParse([{ key: "flags", label: "Flags", kind: "checklist", options: [] }]).success, false, "a checklist needs tick boxes");
    const ok = TemplateSectionsSchema.parse([{ key: "flags", label: "Flags", kind: "checklist", options: [" Fever "] }, { key: "s", label: "S", options: ["dropped"] }]);
    assert.deepEqual((ok[0] as { options?: string[] }).options, ["Fever"]);
    assert.equal("options" in ok[1], false, "options belong to checklists only");
  });

  it("only the author signs, a draft, not in the future, with content", () => {
    const draft = { status: "draft" as const, authorUserId: "u1", seenOn: "2026-10-24" };
    assert.deepEqual(canSign(draft, "u1", "2026-10-24", true), { ok: true });
    assert.equal(canSign(draft, "u2", "2026-10-24", true).ok, false);
    assert.equal(canSign(draft, null, "2026-10-24", true).ok, false);
    assert.equal(canSign(draft, "u1", "2026-10-23", true).ok, false, "future consultation");
    assert.equal(canSign(draft, "u1", "2026-10-24", false).ok, false, "empty");
    assert.equal(canSign({ ...draft, status: "signed" }, "u1", "2026-10-24", true).ok, false);
    assert.equal(canSign({ ...draft, status: "discarded" }, "u1", "2026-10-24", true).ok, false);
  });

  it("the content fingerprint input is canonical (key order does not matter)", () => {
    const a = canonicalNoteContent({ templateId: "t", seenOn: "2026-10-24", sections: { b: "2", a: "1" }, bodyChart: null });
    const b = canonicalNoteContent({ templateId: "t", seenOn: "2026-10-24", sections: { a: "1", b: "2" }, bodyChart: { markers: [] } });
    assert.equal(a, b);
    assert.notEqual(a, canonicalNoteContent({ templateId: "t", seenOn: "2026-10-25", sections: { a: "1", b: "2" }, bodyChart: null }));
    assert.equal(shortFingerprint("3f2a9c01".padEnd(64, "0")), "3f2a 9c01");
    assert.equal(shortFingerprint("nope"), "");
  });

  it("amendments: a correction names its section and reason; an error marking needs a reason only", () => {
    assert.ok(AmendmentInputSchema.safeParse({ kind: "addendum", text: "Patient phoned: pain eased." }).success);
    assert.equal(AmendmentInputSchema.safeParse({ kind: "addendum", text: "  " }).success, false);
    assert.equal(AmendmentInputSchema.safeParse({ kind: "correction", text: "Left side, not right", reason: "Side recorded wrongly" }).success, false, "section");
    assert.ok(AmendmentInputSchema.safeParse({ kind: "correction", sectionKey: "objective", text: "Left side", reason: "Side recorded wrongly" }).success);
    assert.equal(AmendmentInputSchema.safeParse({ kind: "entered_in_error", text: "" }).success, false, "reason");
    assert.ok(AmendmentInputSchema.safeParse({ kind: "entered_in_error", text: "", reason: "Wrong patient" }).success);
  });

  it("status labels", () => {
    assert.equal(noteStatusLabel({ status: "draft", enteredInError: false, amendmentCount: 0 }), "Draft");
    assert.equal(noteStatusLabel({ status: "signed", enteredInError: false, amendmentCount: 0 }), "Signed");
    assert.equal(noteStatusLabel({ status: "signed", enteredInError: false, amendmentCount: 2 }), "Signed, amended");
    assert.equal(noteStatusLabel({ status: "signed", enteredInError: true, amendmentCount: 1 }), "Entered in error");
  });
});

describe("note templates", () => {
  it("three built-in templates with unique section keys", () => {
    assert.deepEqual(
      BUILTIN_TEMPLATES.map((t) => t.noteType),
      ["initial", "follow_up", "discharge"],
    );
    for (const t of BUILTIN_TEMPLATES) {
      assert.ok(isBuiltinTemplateId(t.id));
      assert.ok(NoteTemplateInputSchema.safeParse({ name: t.name, noteType: t.noteType, sections: t.sections }).success, t.id);
    }
    assert.equal(builtinTemplate("builtin-nope"), null);
  });

  it("validates a clinic template; a patch never resets fields it does not name", () => {
    const bad = NoteTemplateInputSchema.safeParse({ name: "x", noteType: "general", sections: [{ key: "a", label: "A" }, { key: "a", label: "B" }] });
    assert.equal(bad.success, false);
    assert.equal(NoteTemplateInputSchema.safeParse({ name: "x", noteType: "general", sections: [] }).success, false);
    assert.equal(NoteTemplateInputSchema.safeParse({ name: "x", noteType: "general", sections: [{ key: "1a", label: "A" }] }).success, false);
    const full = NoteTemplateInputSchema.parse({ name: " Knee review ", noteType: "follow_up", sections: [{ key: "a", label: "A" }] });
    assert.deepEqual([full.name, full.bodyChart, full.active, full.sortOrder, full.sections[0].kind], ["Knee review", false, true, 100, "text"]);
    assert.deepEqual(NoteTemplatePatchSchema.parse({ name: "New" }), { name: "New" });
  });

  it("makes section keys from headings and parses snapshots defensively", () => {
    assert.equal(sectionKeyFor("Plan & treatment given", []), "plan_treatment_given");
    assert.equal(sectionKeyFor("Plan & treatment given", ["plan_treatment_given"]), "plan_treatment_given_2");
    assert.equal(sectionKeyFor("1st impressions", []), "section_1st_impressions");
    assert.equal(sectionKeyFor("!!!", []), "section");
    const snap = toSnapshot(builtinTemplate("builtin-follow-up-soap")!);
    assert.deepEqual(parseSnapshot(JSON.stringify(snap)), snap);
    assert.equal(parseSnapshot("{"), null);
    assert.equal(parseSnapshot(JSON.stringify({ id: "x", name: "y", noteType: "nope", sections: [] })), null);
  });
});

describe("body chart", () => {
  it("validates, rounds and nudges markers inside the drawing", () => {
    const chart = BodyChartSchema.parse({ markers: [{ view: "front", x: 33.333, y: 12.04, kind: "pain", intensity: 6, label: " sharp " }] });
    assert.deepEqual(normaliseChart(chart).markers[0], { view: "front", x: 33.3, y: 12, kind: "pain", intensity: 6, label: "sharp" });
    assert.equal(BodyChartSchema.safeParse({ markers: [{ view: "side", x: 1, y: 1, kind: "pain" }] }).success, false);
    assert.equal(BodyChartSchema.safeParse({ markers: [{ view: "front", x: 101, y: 1, kind: "pain" }] }).success, false);
    const many = Array.from({ length: MAX_MARKERS + 1 }, () => ({ view: "back", x: 50, y: 50, kind: "ache" }));
    assert.equal(BodyChartSchema.safeParse({ markers: many }).success, false);
    const m = chart.markers[0];
    assert.deepEqual([nudgeMarker(m, -50, 0).x, nudgeMarker(m, 0, 100).y], [0, 100]);
    assert.equal(parseBodyChart("not json"), null);
    assert.match(describeMarker(m, 0), /^1\. Pain – front, .*patient's right – intensity 6\/10 – sharp$/);
  });
});

describe("attachments", () => {
  const pdf = new TextEncoder().encode("%PDF-1.7\n%…");
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
  it("knows a file by its bytes, not its name", () => {
    assert.equal(sniffAttachmentType(pdf), "pdf");
    assert.equal(sniffAttachmentType(png), "png");
    assert.equal(sniffAttachmentType(jpeg), "jpeg");
    const zip = new TextEncoder().encode("PK\u0003\u0004....[Content_Types].xml....word/document.xml");
    assert.equal(sniffAttachmentType(zip), "docx");
    assert.equal(sniffAttachmentType(new TextEncoder().encode("PK\u0003\u0004 something else")), null, "a ZIP that is not a Word file");
    assert.equal(sniffAttachmentType(new TextEncoder().encode("<html>")), null);
    assert.deepEqual(checkAttachment(new Uint8Array()), { ok: false, error: "The file is empty." });
    assert.equal(checkAttachment(new Uint8Array(MAX_ATTACHMENT_BYTES + 1)).ok, false);
  });

  it("makes safe file names with the real extension", () => {
    assert.equal(safeFileName("../../etc/passwd", "pdf"), "passwd.pdf");
    assert.equal(safeFileName("C:\\scans\\MRI report.exe", "pdf"), "MRI report.pdf");
    assert.equal(safeFileName('a<b>c:"d|e?f*.png', "png"), "abcdef.png");
    assert.equal(safeFileName("", "jpeg"), "attachment.jpg");
    assert.equal(asciiFileName("Rücken – Befund.pdf"), "Rucken  Befund.pdf");
    assert.equal(formatBytes(950), "950 bytes");
    assert.equal(formatBytes(1_500), "1.5 KB");
    assert.equal(formatBytes(4_000_000), "4 MB");
  });
});

describe("anonymising", () => {
  const policy = { adultYears: 8, childUntilAge: 25 };
  const adult = { dateOfBirth: "1970-01-01", lastTreatmentOn: "2016-05-01", legalHold: false, status: "archived" as const, alreadyAnonymised: false };
  it("only after the record-keeping period, never on hold, once", () => {
    assert.equal(anonymiseCheck(adult, "2026-10-24", policy).allowed, true);
    const early = anonymiseCheck({ ...adult, lastTreatmentOn: "2020-01-01" }, "2026-10-24", policy);
    assert.ok(!early.allowed && early.reason === "too_early" && early.decision?.kind === "review_from" && early.decision.date === "2028-01-01");
    const hold = anonymiseCheck({ ...adult, legalHold: true }, "2026-10-24", policy);
    assert.ok(!hold.allowed && hold.reason === "legal_hold");
    assert.equal((anonymiseCheck({ ...adult, alreadyAnonymised: true }, "2026-10-24", policy) as { reason: string }).reason, "already");
    const noDates = anonymiseCheck({ ...adult, lastTreatmentOn: null }, "2026-10-24", policy);
    assert.ok(noDates.allowed && noDates.needsReview, "no treatment date: a person decides");
    // a clinic keeping records longer
    assert.equal(anonymiseCheck(adult, "2026-10-24", { adultYears: 12, childUntilAge: 25 }).allowed, false);
    // a child at the last treatment: kept until their 25th birthday at least
    assert.equal(anonymiseCheck({ ...adult, dateOfBirth: "2005-06-01", lastTreatmentOn: "2016-05-01" }, "2026-10-24", policy).allowed, false);
  });
  it("finds the latest treatment date", () => {
    assert.equal(lastTreatmentDate([null, "2016-01-02", "2015-12-31", undefined, "bad"]), "2016-01-02");
    assert.equal(lastTreatmentDate([null]), null);
  });
});

describe("form values", () => {
  it("money, address lines, numbers, ages, names, ids", () => {
    assert.equal(poundsToPence("£1,234.50"), 123450);
    assert.equal(poundsToPence("65"), 6500);
    assert.equal(poundsToPence("65.5"), 6550);
    assert.equal(poundsToPence(""), null);
    assert.ok(Number.isNaN(poundsToPence("12.345") as number));
    assert.ok(Number.isNaN(poundsToPence("-5") as number));
    assert.equal(penceToPounds(6550), "65.50");
    assert.equal(penceToPounds(null), "");
    assert.deepEqual(addressLines(" 1 High Street \n\n Bletchley "), ["1 High Street", "Bletchley"]);
    assert.equal(addressLines("  "), null);
    assert.equal(wholeNumber("12"), 12);
    assert.ok(Number.isNaN(wholeNumber("1.5") as number));
    assert.equal(ageOn("1991-11-22", "2026-10-24"), 34);
    assert.equal(ageOn(null, "2026-10-24"), null);
    assert.equal(displayName({ title: "Ms", firstName: "Megan", lastName: "Hart", preferredName: "Meg" }), "Ms Megan (Meg) Hart");
    assert.equal(isPlausibleRecordId("pat_01JA2B3C4D5E6F7G8H9JKMNPQR"), true);
    assert.equal(isPlausibleRecordId("pat_1' OR 1=1"), false);
  });
});

describe("patient list filters, CSV cells, pronouns and flags", () => {
  it("reads filters from the URL, dropping anything unknown", () => {
    const f = filtersFromParams({ q: "  hart ", status: "nonsense", payer: "insurer", practitioner: "not-an-id", nofuture: "1", sort: "desc", page: "3" });
    assert.deepEqual(f, { ...DEFAULT_PATIENT_FILTERS, q: "hart", payer: "insurer", noFuture: true, sort: "desc", page: 3 });
    assert.equal(paramsFromFilters(f).toString(), "q=hart&payer=insurer&nofuture=1&sort=desc&page=3");
    assert.equal(paramsFromFilters(DEFAULT_PATIENT_FILTERS).toString(), "");
    assert.deepEqual(filtersFromParams(new URLSearchParams("status=any&seen=today")), { ...DEFAULT_PATIENT_FILTERS, status: "any", seenToday: true });
  });

  it("CSV cells: quoted when needed, formulas defused", () => {
    assert.equal(csvCell("Hart"), "Hart");
    assert.equal(csvCell('O"Neil, Jo'), '"O""Neil, Jo"');
    assert.equal(csvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
    assert.equal(csvCell("+44 7700"), "'+44 7700");
    assert.equal(csvCell("-1"), "'-1");
    assert.equal(csvCell("@cmd"), "'@cmd");
    assert.equal(csvCell(null), "");
    assert.equal(csvLine(["a", 1, null]), "a,1,");
  });

  it("pronouns and flags: trimmed, bounded; the title line", () => {
    assert.equal(PronounsSchema.parse("  she / her "), "she / her");
    assert.equal(PronounsSchema.parse("   "), null);
    assert.equal(PronounsSchema.safeParse("x".repeat(41)).success, false);
    assert.equal(ClinicalFlagInputSchema.parse({ text: " On   anticoagulants " }).text, "On anticoagulants");
    assert.equal(ClinicalFlagInputSchema.safeParse({ text: " " }).success, false);
    assert.equal(titleLine("Mrs", "she/her"), "Mrs · she/her");
    assert.equal(titleLine(null, null), null);
  });

  it("unsigned-notes wording follows the clinic's setting", () => {
    assert.equal(DEFAULT_UNSIGNED_NOTE_DAYS, 1);
    assert.equal(overdueWindowLabel(1), "24 h");
    assert.equal(overdueWindowLabel(3), "3 days");
    assert.equal(signWithinText(1), "Sign within 24 hours of the visit.");
  });
});

describe("record tabs in the design's order, by role", () => {
  it("clinician: every tab, stand-ins for modules not merged yet (the diary and billing tabs are registered)", () => {
    const tabs = recordTabItems(PMS_RECORD_TABS, (p) => pmsCan("clinician", p));
    assert.deepEqual(
      tabs.map((t) => t.label),
      ["Overview", "Appointments", "Cases", "Clinical notes", "Outcomes", "Attachments", "Invoices", "Messages", "Forms", "History"],
    );
    assert.deepEqual(tabs.filter((t) => t.standIn).map((t) => t.segment), ["tab/messages", "tab/forms"]);
    assert.equal(tabs.find((t) => t.key === "appointments")?.segment, "appointments");
  });
  it("reception: no clinical tab at all (absent, not disabled)", () => {
    const tabs = recordTabItems(PMS_RECORD_TABS, (p) => pmsCan("staff", p)).map((t) => t.label);
    assert.deepEqual(tabs, ["Overview", "Appointments", "Cases", "Invoices", "Messages", "Forms", "History"]);
  });
  it("a module's own tab replaces its stand-in", () => {
    const withDiary = [...PMS_RECORD_TABS, { id: "diary.appointments", module: "diary" as const, label: "Appointments", segment: "appointments", order: 10, permission: "diary.view" as const }];
    const tabs = recordTabItems(withDiary, (p) => pmsCan("owner", p));
    assert.equal(tabs.find((t) => t.key === "appointments")?.segment, "appointments");
    assert.equal(tabs[1].label, "Appointments");
    assert.equal(standInPermission("invoices"), "billing.view");
    assert.equal(standInPermission("notes"), null);
  });
});
