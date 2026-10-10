/**
 * A clinic's Studio home as a work queue (fix wave 2): counts, the first filter, filters and search.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Report } from "../../../core/types";
import { defaultQueueFilter, filterQueue, queueCounts } from "./work-queue";

function report(id: string, patient: string, status: Report["status"], extra: Partial<Report> = {}): Report {
  return {
    id,
    patientLabel: patient,
    status,
    instructingParty: { name: "Harbour Claims (fictional)", type: "insurer" },
    form: { formId: "frm_1", title: "Progress report", referrer: { name: "Northfield Rehab (fictional)", type: "insurer" }, fileSha256: "a".repeat(64), kind: "docx" },
    ...extra,
  } as unknown as Report;
}

const DRAFT = report("r1", "Alex Brown", "draft");
const APPROVED = report("r2", "Casey Doe", "signed", {
  receipt: { signer: { name: "Sam Patel", hcpc: "PH123456" } } as Report["receipt"],
});
const OTHER_FORM = report("r3", "Dana Evans", "draft", {
  form: { formId: "frm_2", title: "Return to work", referrer: { name: "Kingsway Mutual (fictional)", type: "employer" }, fileSha256: "b".repeat(64), kind: "pdf_acroform" },
} as Partial<Report>);
const ALL = [DRAFT, APPROVED, OTHER_FORM];

describe("work queue", () => {
  it("counts what is in progress and what is approved", () => {
    assert.deepEqual(queueCounts(ALL), { open: 2, approved: 1, all: 3 });
    assert.deepEqual(queueCounts([]), { open: 0, approved: 0, all: 0 });
  });

  it("leads with what is in progress, or everything when nothing is", () => {
    assert.equal(defaultQueueFilter(queueCounts(ALL)), "open");
    assert.equal(defaultQueueFilter(queueCounts([APPROVED])), "all");
  });

  it("filters by status and keeps the order given", () => {
    assert.deepEqual(filterQueue(ALL, "open", "").map((r) => r.id), ["r1", "r3"]);
    assert.deepEqual(filterQueue(ALL, "approved", "").map((r) => r.id), ["r2"]);
    assert.deepEqual(filterQueue(ALL, "all", "").map((r) => r.id), ["r1", "r2", "r3"]);
  });

  it("searches patient, referrer, form title and approver; every word must match, any case", () => {
    assert.deepEqual(filterQueue(ALL, "all", "casey").map((r) => r.id), ["r2"]);
    assert.deepEqual(filterQueue(ALL, "all", "kingsway").map((r) => r.id), ["r3"]);
    assert.deepEqual(filterQueue(ALL, "all", "RETURN to").map((r) => r.id), ["r3"]);
    assert.deepEqual(filterQueue(ALL, "all", "sam patel").map((r) => r.id), ["r2"], "who approved it");
    assert.deepEqual(filterQueue(ALL, "all", "  progress   alex ").map((r) => r.id), ["r1"]);
    assert.deepEqual(filterQueue(ALL, "open", "casey"), [], "the filter still applies");
    assert.deepEqual(filterQueue(ALL, "all", "nobody"), []);
  });
});
