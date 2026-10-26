/**
 * APPROVER_DECISION (bh2 WC design 5): what staff, or a clinician who is not the approver, entered in a clinician box
 * is a proposal. It blocks approval until the approving clinician adopts it with one audited click (Section.adoptedBy;
 * any later change by someone else clears the adoption). The approver's own answer needs no extra click. One flag per
 * box, naming who entered it ("Entered by Pat Morgan (staff) – the approving physio must adopt it."); its policy is
 * "approver" – cleared by the approver's adoption, never by an acknowledgement (validation/acknowledge.ts).
 *
 * Reads the stored provenance only (paragraph `by`, Section.answerBy, Section.adoptedBy, Report.approver – all hashed),
 * never who is viewing, so the review, /validate and /sign agree. A report with no approver (an earlier build's) has
 * no proposals, and nor has an approved one (its approval covers everything in it).
 *
 * Pure; browser and server. Owner: WC (review roles and provenance).
 */
import { pendingProposal } from "../provenance";
import type { ReportFlag } from "../types";
import { makeFlag } from "./context";
import type { Validator } from "./registry";

export const validateApproverDecisions: Validator = (input) => {
  const report = input.report;
  // Approving the report is the approver's decision over everything in it: an approved report holds no proposal.
  if (!report.approver || report.status === "signed") return [];
  const ctx = { fields: input.form?.fields ?? null };
  const flags: ReportFlag[] = [];
  for (const section of report.sections ?? []) {
    const proposal = pendingProposal(report, section, ctx);
    if (!proposal) continue;
    flags.push({
      ...makeFlag({
        code: "APPROVER_DECISION",
        severity: "blocking",
        sectionKey: section.key,
        evidence: `entered by ${proposal.names}`,
        message: `Entered by ${proposal.names} – the approving physio must adopt it (${report.approver.name}).`,
      }),
      ackPolicy: "approver",
    });
  }
  return flags;
};
