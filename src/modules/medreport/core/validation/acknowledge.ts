/**
 * Acknowledgement rules: whether a flag may be cleared by acknowledging it with a reason (the UI offers "Acknowledge
 * with a reason" only then, and runValidators carries an acknowledgement over only then).
 *
 * Pure; browser and server. Split out of core/validation/index.ts by W0.4 (bh2 module split, pure move; index.ts re-exports it).
 * Owner: WC (review roles and provenance) – docs/bh2-ownership.json.
 */
import type { AckPolicy, FlagWithAckPolicy } from "../fix-types";
import type { Report, ReportFlag } from "../types";

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
export function canAcknowledge(flag: ReportFlag, report?: Pick<Report, "sections">): boolean {
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
