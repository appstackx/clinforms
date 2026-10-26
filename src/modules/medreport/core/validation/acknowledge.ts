/**
 * Acknowledgement rules: who may clear a flag by acknowledging it with a reason (the UI offers "Acknowledge with a
 * reason" only to them, the review reducer refuses anyone else, and runValidators carries an acknowledgement over only
 * where it is allowed).
 *
 * bh2 WC design 4: flags carry an acknowledgement policy (core/schemas.ts AckPolicySchema) – never, approver (only the
 * report's approving clinician, Report.approver) or member (anyone working on the report). A validator may set
 * `flag.ackPolicy`; the policy here is never weaker than the one derived from the flag and its text:
 * - warnings; FIGURE_NOT_IN_SOURCE (dates) and TERM_NOT_IN_SOURCE (the signer confirms them): member;
 * - OPINION_LANGUAGE and OTHER_CLINICIAN_VOICE: never on drafted text, nor on drafted residue kept in a person's text
 *   (core/provenance.ts paragraphResidue – a drafted sentence kept, pasted back or changed by a word or a mark); on the
 *   rest of a person's text, the approver – and only the approver (ledger hook "edited-ack");
 * - APPROVER_DECISION: cleared by the approver's one-click "Adopt" (never with a stored acknowledgement);
 * - everything else (uncited text, scope terms, merge codes, blocking data checks, open gaps, an answer in a question
 *   that does not apply): never – fix the text, the record or the gap itself.
 * Who acknowledged is stamped on the acknowledgement (FlagAcknowledgement.by) by the review and checked by the store.
 *
 * Pure; browser and server. Split out of core/validation/index.ts by W0.4 (bh2 module split; index.ts re-exports it).
 * Owner: WC (review roles and provenance) – docs/bh2-ownership.json.
 */
import type { AckPolicy, FlagWithAckPolicy } from "../fix-types";
import { actsAsApprover, evidenceInSpans, paragraphResidue } from "../provenance";
import { firstPersonUses } from "../voice";
import type { Actor, Report, ReportFlag } from "../types";
import { defineHook, hookEnabled } from "./hooks";

/** Ledger hook (__corpus__/ledger.json "edited-ack"): the approver may acknowledge opinion and voice checks on a person's text. */
export const EDITED_ACK_HOOK = defineHook("edited-ack");

const RANK: Record<AckPolicy, number> = { member: 0, approver: 1, never: 2 };

/** The stricter of two policies. */
export function strictestPolicy(a: AckPolicy, b: AckPolicy): AckPolicy {
  return RANK[a] >= RANK[b] ? a : b;
}

/** The policy the flag itself warrants (its code, severity and the text it is about). */
function derivedPolicy(flag: ReportFlag, report?: Pick<Report, "sections">): AckPolicy {
  if (flag.code === "APPROVER_DECISION") return "approver";
  if (flag.severity === "warning") return "member";
  switch (flag.code) {
    case "FIGURE_NOT_IN_SOURCE":
    case "TERM_NOT_IN_SOURCE":
      return "member";
    case "OPINION_LANGUAGE":
    case "OTHER_CLINICIAN_VOICE": {
      if (!report || !flag.paragraphId) return "never";
      for (const s of report.sections ?? []) {
        const p = s.paragraphs.find((x) => x.id === flag.paragraphId);
        if (!p) continue;
        if (p.origin === "ai" || p.origin === "from_records") return "never";
        if (!hookEnabled(EDITED_ACK_HOOK)) return "never";
        // Drafted residue keeps drafted-text strictness: nobody acknowledges a drafted opinion.
        const residue = paragraphResidue(s, p, { forAcknowledgement: true });
        // bh2-rc1 (WB x WC): a voice flag's evidence names the colleague, not the words at fault – those are the
        // first-person words (core/voice.ts firstPersonUses). Only a first person inside drafted residue is drafted
        // text's; a person's own "I recorded …" beside a kept drafted sentence is theirs, for the approver to confirm.
        if (flag.code === "OTHER_CLINICIAN_VOICE") {
          const uses = firstPersonUses(p.text);
          if (uses.length > 0) return uses.some((u) => residue.some((r) => u.index < r.end && u.index + u.word.length > r.start)) ? "never" : "approver";
        }
        return evidenceInSpans(p.text, flag.evidence, residue) ? "never" : "approver";
      }
      return "never";
    }
    default:
      return "never";
  }
}

/** The paragraph a flag is about is drafted text (origin "ai"), on this report. */
function onDraftedText(flag: ReportFlag, report?: Pick<Report, "sections">): boolean {
  if (!report || !flag.paragraphId) return false;
  for (const s of report.sections ?? []) {
    const p = s.paragraphs.find((x) => x.id === flag.paragraphId);
    if (p) return p.origin === "ai";
  }
  return false;
}

/**
 * Who may acknowledge this flag (W0.6 AckPolicy): the flag's own `ackPolicy`, never weaker than what it warrants –
 * with one exception the voice check owns (bh2-rc1, WB x WC): on drafted text the voice check (validation/voice.ts,
 * WB) raises OTHER_CLINICIAN_VOICE with "approver" only for the first-person licence (ii) – "my" / "me" / "our" beside
 * a colleague's note that names the approver ("covering my annual leave", AC-OPN-4) – and with "never" for every other
 * drafted first person. That licence is the approver's to confirm, so it stands; drafted text anywhere else stays
 * "never", and a person's text keeps the stricter of the two (drafted residue: never).
 */
export function ackPolicyOf(flag: FlagWithAckPolicy, report?: Pick<Report, "sections">): AckPolicy {
  const derived = derivedPolicy(flag, report);
  if (!flag.ackPolicy) return derived;
  if (flag.code === "OTHER_CLINICIAN_VOICE" && flag.ackPolicy === "approver" && derived === "never" && hookEnabled(EDITED_ACK_HOOK) && onDraftedText(flag, report)) return "approver";
  return strictestPolicy(flag.ackPolicy, derived);
}

/**
 * Whether a flag may be acknowledged – by `actor` when one is given (the review offers it, the reducer accepts it),
 * else by someone (an acknowledgement already on the report may stand – runValidators' carry-over). An approver-only
 * flag needs the report's approver (core/provenance.ts actsAsApprover; a report from an earlier build has none: any
 * member who is not staff). APPROVER_DECISION is cleared only by the approver's adoption, never by a stored
 * acknowledgement.
 */
export function canAcknowledge(
  flag: ReportFlag,
  report?: Pick<Report, "sections"> & Partial<Pick<Report, "approver">>,
  actor?: Pick<Actor, "memberId" | "role"> | null,
): boolean {
  const policy = ackPolicyOf(flag, report);
  if (policy === "never") return false;
  if (flag.code === "APPROVER_DECISION") return Boolean(actor) && actsAsApprover(actor, { approver: report?.approver });
  if (policy === "member" || !actor) return true;
  return actsAsApprover(actor, { approver: report?.approver });
}

/**
 * Whether an acknowledgement already on the report stands when the validators run again (runValidators' carry-over):
 * only where the flag may be acknowledged at all, by the member it is stamped with (FlagAcknowledgement.by – the review
 * stamps every acknowledgement it makes). One with no stamp stands only where anyone may acknowledge (policy
 * "member"); on a report from an earlier build (no approver) it stands as it did there. A proposal (APPROVER_DECISION)
 * is never cleared this way.
 */
export function acknowledgementStands(
  flag: ReportFlag,
  report: Pick<Report, "sections"> & Partial<Pick<Report, "approver">>,
  ack: { by?: Pick<Actor, "memberId" | "role"> } | null | undefined,
): boolean {
  if (!ack || flag.code === "APPROVER_DECISION") return false;
  if (!ack.by) return report.approver ? ackPolicyOf(flag, report) === "member" : canAcknowledge(flag, report, null);
  return canAcknowledge(flag, report, ack.by);
}

/** Why an actor may not acknowledge a flag, for the review's "only … can" line (null when they may). */
export function acknowledgeRefusal(
  flag: ReportFlag,
  report: Pick<Report, "sections"> & Partial<Pick<Report, "approver">>,
  actor: Pick<Actor, "memberId" | "role">,
): "never" | "approver" | null {
  const policy = ackPolicyOf(flag, report);
  if (policy === "never") return "never";
  return canAcknowledge(flag, report, actor) ? null : "approver";
}
