/**
 * Acknowledgement rules: whether a flag may be cleared by acknowledging it with a reason (the UI offers "Acknowledge
 * with a reason" only then, and runValidators carries an acknowledgement over only then).
 *
 * Pure; browser and server. Split out of core/validation/index.ts by W0.4 (bh2 module split, pure move; index.ts re-exports it).
 * Owner: WC (review roles and provenance) – docs/bh2-ownership.json.
 */
import type { AckPolicy, FlagWithAckPolicy } from "../fix-types";
import type { Actor } from "../actor";
import type { Report, ReportFlag } from "../types";

/** The actor is the report's approving clinician (who may sign); no approver chosen yet: any member who may sign. */
function isReportApprover(report: (Partial<Pick<Report, "approver">> & object) | undefined, actor: Pick<Actor, "memberId" | "canSign">): boolean {
  if (!actor.canSign) return false;
  const approver = report?.approver;
  return approver ? approver.memberId === actor.memberId : true;
}

/* ------------------------------------------------------------------------------------------------
 * Acknowledgement rules
 * ----------------------------------------------------------------------------------------------*/

/**
 * Whether a flag may be cleared by acknowledging it with a reason:
 * - warnings: yes;
 * - FIGURE_NOT_IN_SOURCE (dates): yes – the signer confirms the date from their own knowledge;
 * - TERM_NOT_IN_SOURCE: yes – the signer confirms the wording is right;
 * - OPINION_LANGUAGE and OTHER_CLINICIAN_VOICE: only on "edited" text (the clinician's own words); never on AI text;
 * - UNCITED_PARAGRAPH, SCOPE_TERM, MISSING_PLACEHOLDER, blocking DATA_CHECK: no – fix the text or the record;
 * - OPEN_GAP: no – resolve or acknowledge the gap itself.
 */
export function canAcknowledge(flag: ReportFlag, report?: Pick<Report, "sections"> & Partial<Pick<Report, "approver">>, actor?: Pick<Actor, "memberId" | "canSign">): boolean {
  // bh2 (WB, ownership exception – WC's file; WC design 4 extends it): a validator's own policy decides first. "never":
  // fix the text or the record. "approver": the report's approving clinician – asked without an actor (the carry-over
  // in runValidators, a screen that does not say who is looking), the acknowledgement may stand; WC stamps and checks
  // `acknowledged.by`. "member": anyone working on the report.
  if (flag.ackPolicy === "never") return false;
  if (flag.ackPolicy === "approver") return actor ? isReportApprover(report, actor) : true;
  if (flag.ackPolicy === "member") return true;
  if (flag.severity === "warning") return true;
  switch (flag.code) {
    case "FIGURE_NOT_IN_SOURCE":
    case "TERM_NOT_IN_SOURCE":
      return true;
    case "OPINION_LANGUAGE":
    case "OTHER_CLINICIAN_VOICE": {
      if (!report || !flag.paragraphId) return false;
      for (const s of report.sections) {
        const p = s.paragraphs.find((x) => x.id === flag.paragraphId);
        if (p) return p.origin === "edited";
      }
      return false;
    }
    default:
      return false;
  }
}

/**
 * W0.6 plumbing: who may acknowledge this flag (core/fix-types.ts AckPolicy) – the flag's own `ackPolicy` once a
 * validator sets one (WB, WC), else today's rule: "member" where canAcknowledge allows it, "never" where it does not.
 * Nothing yields "approver" yet; WC's canAcknowledge(flag, report, actor) enforces it.
 */
export function ackPolicyOf(flag: FlagWithAckPolicy, report?: Pick<Report, "sections">): AckPolicy {
  if (flag.ackPolicy) return flag.ackPolicy;
  return canAcknowledge(flag, report) ? "member" : "never";
}
