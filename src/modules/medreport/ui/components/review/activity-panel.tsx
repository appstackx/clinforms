"use client";

/**
 * Activity tab: the report's audit trail, newest first.
 *
 * bh2 WF (AC-CPY-2): every action the Studio records (core/report-factory.ts KNOWN_ACTIVITY_ACTIONS, which spreads the
 * release's codes from core/activity-actions.ts) has a plain label here – the compiler checks the list is complete – and
 * an action this build does not know reads "Updated", never its code. A check's code inside an entry's details is shown
 * by its label (core/labels.ts).
 *
 * Owner: WF (copy, preview and guide) – docs/bh2-ownership.json.
 */
import { formatUkDateTime } from "../../../core/dates";
import { FLAG_CODE_LABELS } from "../../../core/labels";
import type { KnownActivityAction } from "../../../core/report-factory";
import type { ActivityEntry } from "../../../core/types";
import { useStudioMode } from "../../host-hooks";
import { TENANT_COPY } from "../../studio-copy";
import { neutralLegacyText } from "../../wording";

/** Written by the notes step, not listed in KNOWN_ACTIVITY_ACTIONS. */
type OtherRecordedAction = "consent_recorded";

export const ACTION_LABELS: Readonly<Record<KnownActivityAction | OtherRecordedAction, string>> = {
  created: "Created",
  drafted: "Drafted",
  draft_failed: "Drafting failed",
  edited: "Edited",
  paragraph_added: "Paragraph added",
  gap_resolved: "Gap resolved",
  gap_acknowledged: "Gap acknowledged",
  flag_acknowledged: "Check acknowledged",
  validated: "Checked",
  signed: "Signed",
  approved: "Approved",
  rendered: "Downloaded",
  filed: "Saved to clinic record",
  exported: "Exported",
  answer_set: "Answer changed",
  previewed: "Previewed",
  consent_recorded: "Consent recorded",
  notes_reused: "Notes reused from an earlier report",
  // Amendments (kept from fix round 2, B1-19).
  amendment_started: "Amended version started",
  superseded: "Replaced by a newer version",
  // The release's review decisions (core/activity-actions.ts), in the words of the buttons that make them.
  adopted: "Adopted by the approving clinician",
  disposition_set: "Decision recorded for a question",
  disposition_cleared: "Decision for a question cancelled",
  approver_taken_over: "Taken over as approver",
  note_words_accepted: "Accepted as the note's words",
  own_words: "Marked as own words",
  fix_applied: "One-click fix applied",
  held_back: "Drafted text held back for checking",
};

/** The label for an action never seen by this build. */
export const UNKNOWN_ACTION_LABEL = "Updated";

function hasLabel(action: string): action is keyof typeof ACTION_LABELS {
  return Object.prototype.hasOwnProperty.call(ACTION_LABELS, action);
}

/**
 * The label of an activity action – "Updated" for one without a label, never the raw code. Kept from fix round 3
 * (B2-20): a structured answer given where there was none ("… (was blank).") is entered, not changed.
 */
export function activityLabel(action: string, detail = ""): string {
  if (action === "answer_set" && /\(was blank\)\.?\s*$/.test(detail)) return "Answer entered";
  return hasLabel(action) ? ACTION_LABELS[action] : UNKNOWN_ACTION_LABEL;
}

const FLAG_CODE = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g;

/** An entry's details as shown: neutral wording, and a check's code (OPINION_LANGUAGE) by its label. */
export function activityDetail(detail: string): string {
  return neutralLegacyText(detail).replace(FLAG_CODE, (code) =>
    Object.prototype.hasOwnProperty.call(FLAG_CODE_LABELS, code) ? `“${FLAG_CODE_LABELS[code as keyof typeof FLAG_CODE_LABELS]}”` : code,
  );
}

const ACTION_DOT: Partial<Record<string, string>> = {
  approved: "bg-teal-600",
  signed: "bg-teal-600",
  filed: "bg-teal-600",
  drafted: "bg-sky-500",
  draft_failed: "bg-red-600",
  gap_resolved: "bg-amber-500",
  gap_acknowledged: "bg-amber-500",
  flag_acknowledged: "bg-amber-500",
  consent_recorded: "bg-teal-600",
  adopted: "bg-amber-500",
  note_words_accepted: "bg-amber-500",
  own_words: "bg-amber-500",
  disposition_set: "bg-amber-500",
  approver_taken_over: "bg-violet-500",
  superseded: "bg-violet-500",
};

export function ActivityPanel({ activity }: { activity: ActivityEntry[] }) {
  const entries = [...activity].reverse();
  const tenant = useStudioMode() === "tenant";
  return (
    <div className="space-y-3">
      <ol className="relative space-y-3 border-l border-slate-200 pl-4">
        {entries.map((a, i) => (
          <li key={`${a.at}-${i}`} className="relative">
            <span aria-hidden className={`absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-white ${ACTION_DOT[a.action] ?? "bg-slate-400"}`} />
            <p className="text-[13px] font-medium text-slate-900">
              {activityLabel(a.action, a.detail)}
              <span className="ml-1.5 font-normal text-slate-500">· {a.actor}</span>
            </p>
            <p className="text-[12px] leading-relaxed text-slate-600">{activityDetail(a.detail)}</p>
            <p className="text-[11px] tabular-nums text-slate-500">{formatUkDateTime(a.at)}</p>
          </li>
        ))}
      </ol>
      <p className="text-[11px] text-slate-500">
        {tenant
          ? TENANT_COPY.review.activityNote
          : "Demo-grade audit trail, kept with the report in this browser. In production it is stored server-side and cannot be edited."}
      </p>
    </div>
  );
}
