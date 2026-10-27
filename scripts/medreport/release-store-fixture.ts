/**
 * TESTS ONLY (bh2 fix round 1, WC – R1T-WC-03 and R1T-WC-06): store-test fixtures as this release's Studio stores
 * them. The clinic's store now refuses a create with no approving clinician (the Studio always chooses one), and an
 * answer in an opinion box that nobody's stamp vouches for (drafting never answers one). The bundled sample reports
 * (form-sample-answers.ts completedSampleReport) are made without an approver and with drafted opinion answers – the
 * shape of a report from before this release – so store tests whose subject is the store's own mechanics (revisions,
 * clinics, receipts, limits, the Studio's sync) make them with these:
 *
 * - signingMember(tenantId, opts): a member who may approve (clinic profile with a registration number, may sign);
 * - asApproversReport(report, member): the report with that member as its approving clinician, and their stamp on every
 *   opinion box's answer and every answer in a records box the factory did not fill (they chose it);
 * - asFactoryCopy(report): the report as the factory hands it to anyone else – no opinion box answered.
 */
import type { AuthContext } from "../../src/modules/medreport/api/deps";
import type { Actor, Report } from "../../src/modules/medreport/core/types";
import { member } from "./store-harness";

/** The fictional clinician store fixtures name as the approving clinician. */
export const FIXTURE_SIGNER = { name: "Sam Ward (fictional)", hcpc: "ZZ0005", jobTitle: "Physiotherapist", canSign: true } as const;

/** An approving clinician who is nobody's sign-in in the test (a create names them; the creator is then not the approver). */
export const FIXTURE_APPROVER_REF = { memberId: "user-fixture-approver", name: FIXTURE_SIGNER.name, hcpc: FIXTURE_SIGNER.hcpc } as const;

/** A member of `tenantId` who may approve (signing details from their clinic profile). */
export function signingMember(tenantId: string, opts: Partial<AuthContext> = {}): AuthContext {
  return member(tenantId, { name: FIXTURE_SIGNER.name, clinician: { ...FIXTURE_SIGNER }, ...opts });
}

/** The stamp the store reads for `m` (api/handlers/store-reports.ts storeMemberOf). */
export function stampOf(m: AuthContext): Actor {
  const hcpc = m.clinician?.hcpc?.trim();
  return {
    memberId: m.userId,
    name: m.name ?? m.clinician?.name ?? "",
    role: m.role as Actor["role"],
    canSign: m.role !== "staff" && m.clinician?.canSign === true && Boolean(hcpc),
    ...(hcpc ? { hcpc } : {}),
  };
}

/** `m` as a report's approving clinician (Report.approver). */
export function approverRef(m: AuthContext): NonNullable<Report["approver"]> {
  const by = stampOf(m);
  if (!by.hcpc) throw new Error("the approving clinician needs a registration number (signingMember)");
  return { memberId: by.memberId, name: by.name, hcpc: by.hcpc };
}

/** `report` with `m` as its approving clinician, who chose every opinion box's answer. */
export function asApproversReport(report: Report, m: AuthContext): Report {
  const by = stampOf(m);
  if (!by.hcpc) throw new Error("the approving clinician needs a registration number (signingMember)");
  return {
    ...report,
    approver: { memberId: by.memberId, name: by.name, hcpc: by.hcpc },
    sections: report.sections.map((s) => {
      const set = s.answer && s.answer.kind !== "text" && s.answer.value !== null && s.answer.value !== "" && !(Array.isArray(s.answer.value) && s.answer.value.length === 0);
      const unfilledRecord = s.kind === "from_records" && !s.paragraphs.some((p) => p.origin === "from_records");
      return (s.kind === "clinician_opinion" || unfilledRecord) && set ? { ...s, answerBy: by } : s;
    }),
  };
}

/**
 * `report` as the factory hands it to a member who is not its approver: drafted text and the records only – no opinion box
 * answered, no one's own words, no one's stamp on an answer.
 */
export function asFactoryCopy(report: Report): Report {
  return {
    ...report,
    sections: report.sections.map((s) => {
      const next = { ...s, paragraphs: s.paragraphs.filter((p) => p.origin !== "clinician") };
      // A records box the factory did not fill (a staff entry, the physiotherapist's choice) is empty too.
      const unfilledRecord = s.kind === "from_records" && !s.paragraphs.some((p) => p.origin === "from_records");
      if ((s.kind === "clinician_opinion" || unfilledRecord) && s.answer && s.answer.kind !== "text") next.answer = { ...s.answer, value: null };
      delete next.answerBy;
      return next;
    }),
  };
}
