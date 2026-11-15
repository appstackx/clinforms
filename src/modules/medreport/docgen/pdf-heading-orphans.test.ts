/**
 * 15/11/2026 (Khuram's live trial test): a section heading was printed alone at the foot of a page, its text starting on
 * the next. Renders the built-in RTA report with the text before each heading growing a line at a time (so every heading
 * passes through the foot of a page) and checks that no page ends on a heading. Fictional data only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createReport } from "../core/report-factory";
import { SOLICITOR_RTA_TEMPLATE } from "../templates/registry";
import type { EpisodeBundle } from "../core/types";
import { buildViewModel } from "./view-model";
import { renderPdf } from "./pdf";
import { readPrintedNotes } from "../connectors/file-import/pdf-notes";

const bundle: EpisodeBundle = {
  tenantId: "demo",
  source: { connectorId: "tm3-sim", simulated: true, fetchedAt: "2026-11-15T09:00:00.000Z", externalPatientId: "p1", externalEpisodeId: "e1", label: "Simulated TM3 sandbox" },
  registration: { id: "REG", externalPatientId: "p1", firstName: "Megan", lastName: "Hart", fullName: "Megan Hart", dob: "1990-03-14", sex: "female", addressSummary: "Milton Keynes", occupation: "Office administrator" },
  referral: { type: "solicitor", name: "Harrow & Pike Solicitors (fictional)", reference: "HP-DEMO-0001", contactName: "A. Clerk", address: "Milton Keynes" },
  incident: { date: "2026-11-02", mechanism: "Rear-end collision", type: "road_traffic_accident" },
  clinicians: [{ name: "S. Reid", hcpc: "PH-DEMO-01" }],
  notes: [{ id: "N-001", date: "2026-11-15", type: "initial_assessment", author: { name: "S. Reid", hcpc: "PH-DEMO-01" }, subjective: "Neck pain.", objective: "Reduced rotation.", assessment: "WAD II.", plan: "Exercises." }],
  appointments: [{ id: "A1", date: "2026-11-15", time: "09:00", status: "ATT", noteId: "N-001" }],
  outcomeMeasures: [],
  consent: { disclosureConsentRecorded: true, date: "2026-11-15" },
  episodeStatus: "open",
};

const SENTENCE = "Ms Hart reported neck pain and stiffness, worse turning to the left and after long drives, and occasional headaches. ";

test("no page of the built-in report ends on a section heading", { timeout: 180_000 }, async () => {
  const report = createReport({ template: SOLICITOR_RTA_TEMPLATE, bundle, instructingParty: bundle.referral, computedFacts: [], now: new Date("2026-11-15T10:00:00Z") });
  const base = buildViewModel(report, bundle, SOLICITOR_RTA_TEMPLATE, { now: new Date("2026-11-15T10:00:00Z") });
  const headings = new Set(base.sections.map((s) => s.heading));
  const offenders: string[] = [];
  for (let lines = 0; lines < 36; lines += 1) {
    // Every section gets two paragraphs; the first section's text grows, moving every later heading down the page.
    const vm = {
      ...base,
      sections: base.sections.map((s, i) => ({
        ...s,
        isPlaceholder: false,
        paragraphs: [
          { text: (i === 0 ? SENTENCE.repeat(1 + lines) : SENTENCE.repeat(3)).trim(), sourceIds: [] },
          { text: SENTENCE.repeat(2).trim(), sourceIds: [] },
        ],
      })),
    } as typeof base;
    const pdf = await renderPdf(vm);
    const { pageLines } = await readPrintedNotes(Buffer.from(pdf).toString("base64"));
    pageLines.forEach((page, p) => {
      const body = page.filter((l) => l.trim() && !/DRAFT – NOT SIGNED|not for disclosure|^Page \d+|^\d+ of \d+$|Private and confidential/.test(l));
      const last = body[body.length - 1]?.trim();
      if (last && headings.has(last)) offenders.push(`text +${lines}: page ${p + 1} ends on "${last}"`);
    });
  }
  assert.deepEqual(offenders, []);
});
