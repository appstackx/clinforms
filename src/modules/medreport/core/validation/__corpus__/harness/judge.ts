/**
 * Safety corpus: what BLOCK / FLAG / PASS mean for a box, from the validators' result.
 *
 * - The SUBJECT is the case's paragraph (its flags plus the box's own box-level flags), else the whole box, else the
 *   whole report.
 * - BLOCK: at least one unacknowledged blocking flag on the subject whose code is SUBSTANTIVE – anything but the
 *   incidental checks below (citations, figures, terms, data checks, scope, open gaps, missing answers / merge codes,
 *   draft-fit), unless the case lists that code in `blockBy`. So a case never "blocks" because of a stray figure.
 *   With `ack`:
 *     never    – at least one such flag cannot be acknowledged by anyone (staff, another clinician, the approver, an
 *                administrator without may-sign);
 *     approver – no one but the approver can acknowledge at least one such flag, and the approver can acknowledge
 *                every one (so the approver is never forced to rewrite);
 *     member   – every such flag can be acknowledged by any member.
 * - PASS: no unacknowledged blocking flag of ANY code on the subject, and none of `check.forbid`.
 * - FLAG: some flag on the subject (matching `check.flag` when given).
 *
 * Pure.
 */
import type { Report, ReportFlag } from "../../../types";
import type { ValidatorEngine } from "./engine";
import { actorOf } from "./fixtures";
import { ACTOR_KINDS, type ActorKind, type AckPolicy, type PersonKey } from "./types";

export const INCIDENTAL_CODES: ReadonlySet<string> = new Set([
  "UNCITED_PARAGRAPH",
  "UNKNOWN_SOURCE_ID",
  "FIGURE_NOT_IN_SOURCE",
  "TERM_NOT_IN_SOURCE",
  "DATA_CHECK",
  "SCOPE_TERM",
  "OPEN_GAP",
  "MISSING_PLACEHOLDER",
  "DRAFT_FIT",
]);

export interface Subject {
  box: string | null;
  paragraphId: string | null;
}

export function onSubject(f: Pick<ReportFlag, "sectionKey" | "paragraphId">, s: Subject): boolean {
  if (s.paragraphId) return f.paragraphId === s.paragraphId || (f.sectionKey === s.box && !f.paragraphId);
  if (s.box) return f.sectionKey === s.box;
  return true;
}

/** The person who plays each actor kind for an approver (the other clinician is Tom, or Sarah when Tom approves). */
export function actorKeyFor(kind: ActorKind, approver: PersonKey | null): PersonKey {
  switch (kind) {
    case "staff":
      return "pat";
    case "admin":
      return "chris";
    case "approver":
      return approver ?? "sarah";
    case "other":
      return approver === "tom" ? "sarah" : "tom";
  }
}

export interface FlagMatcher {
  code?: string;
  severity?: "blocking" | "warning";
  evidence?: string;
  message?: string;
}

export function matches(f: ReportFlag, m: FlagMatcher): boolean {
  if (m.code && f.code !== m.code) return false;
  if (m.severity && f.severity !== m.severity) return false;
  if (m.evidence && !new RegExp(m.evidence, "i").test(f.evidence ?? "")) return false;
  if (m.message && !new RegExp(m.message, "i").test(f.message)) return false;
  return true;
}

export interface Judgement {
  ok: boolean;
  detail: string;
}

export function describeFlags(flags: readonly ReportFlag[]): string {
  return flags.map((f) => `${f.code}/${f.severity}${f.acknowledged ? "/ack" : ""}${f.evidence ? `:${String(f.evidence).slice(0, 40)}` : ""}`).join(", ") || "no flags";
}

export interface JudgeInput {
  expect: "BLOCK" | "FLAG" | "PASS";
  ack?: AckPolicy;
  blockBy?: readonly string[];
  check?: Record<string, unknown>;
  engine: ValidatorEngine;
  report: Report;
  flags: ReportFlag[];
  blocking: ReportFlag[];
  subject: Subject;
  approver: PersonKey | null;
}

export function judge(input: JudgeInput): Judgement {
  const { engine, report, subject } = input;
  const subjectFlags = input.flags.filter((f) => onSubject(f, subject));
  const subjectBlocking = input.blocking.filter((f) => onSubject(f, subject));
  const allowed = new Set(input.blockBy ?? []);
  const substantive = subjectBlocking.filter((f) => !INCIDENTAL_CODES.has(f.code) || allowed.has(f.code));
  const detail = `subject: ${describeFlags(subjectFlags)}`;
  const forbid = (input.check?.forbid ?? []) as FlagMatcher[];
  const forbidden = subjectFlags.filter((f) => forbid.some((m) => matches(f, m)));

  if (input.expect === "PASS") {
    if (subjectBlocking.length > 0) return { ok: false, detail: `expected PASS, blocked – ${detail}` };
    if (forbidden.length > 0) return { ok: false, detail: `expected PASS, forbidden flag – ${describeFlags(forbidden)}` };
    return { ok: true, detail };
  }
  if (input.expect === "FLAG") {
    const want = input.check?.flag as FlagMatcher | undefined;
    const hit = subjectFlags.filter((f) => !want || matches(f, want));
    if (hit.length === 0) return { ok: false, detail: `expected FLAG${want ? ` ${JSON.stringify(want)}` : ""} – ${detail}` };
    if (input.check?.notBlocking === true && subjectBlocking.length > 0) return { ok: false, detail: `expected a non-blocking FLAG, blocked – ${detail}` };
    if (forbidden.length > 0) return { ok: false, detail: `forbidden flag – ${describeFlags(forbidden)}` };
    return { ok: true, detail };
  }
  // BLOCK
  if (substantive.length === 0) {
    return { ok: false, detail: `expected BLOCK${subjectBlocking.length ? " (only incidental codes block)" : ""} – ${detail}` };
  }
  if (!input.ack) return { ok: true, detail };
  const canAck = (f: ReportFlag, kind: ActorKind) => engine.canAcknowledge(f, report, actorOf(actorKeyFor(kind, input.approver)));
  if (input.ack === "never") {
    const hard = substantive.filter((f) => ACTOR_KINDS.every((k) => !canAck(f, k)));
    return hard.length > 0
      ? { ok: true, detail: `${detail}; not acknowledgeable: ${describeFlags(hard)}` }
      : { ok: false, detail: `expected BLOCK that nobody can acknowledge – every blocking flag can be acknowledged (${describeFlags(substantive)})` };
  }
  if (input.ack === "approver") {
    const othersCannot = substantive.filter((f) => !canAck(f, "staff") && !canAck(f, "other") && !canAck(f, "admin"));
    if (othersCannot.length === 0) return { ok: false, detail: `expected only the approver to clear it – staff or another member can acknowledge (${describeFlags(substantive)})` };
    const approverCannot = substantive.filter((f) => !canAck(f, "approver"));
    if (approverCannot.length > 0) return { ok: false, detail: `expected the approver to be able to acknowledge – forced rewrite (${describeFlags(approverCannot)})` };
    return { ok: true, detail };
  }
  // member
  const notByStaff = substantive.filter((f) => !canAck(f, "staff"));
  return notByStaff.length === 0 ? { ok: true, detail } : { ok: false, detail: `expected any member to acknowledge – ${describeFlags(notByStaff)}` };
}
