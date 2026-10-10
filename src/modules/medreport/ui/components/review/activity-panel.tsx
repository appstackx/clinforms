"use client";

/**
 * Activity tab: the report's audit trail (demo-grade, kept in this browser), newest first.
 *
 * Owner: studio-b agent.
 */
import { formatUkDateTime } from "../../../core/dates";
import type { ActivityEntry } from "../../../core/types";
import { useStudioMode } from "../../host-hooks";
import { TENANT_COPY } from "../../studio-copy";
import { neutralLegacyText } from "../../wording";

const ACTION_LABELS: Record<string, string> = {
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
};

const ACTION_DOT: Record<string, string> = {
  approved: "bg-teal-600",
  signed: "bg-teal-600",
  filed: "bg-teal-600",
  drafted: "bg-sky-500",
  draft_failed: "bg-red-600",
  gap_resolved: "bg-amber-500",
  gap_acknowledged: "bg-amber-500",
  flag_acknowledged: "bg-amber-500",
  consent_recorded: "bg-teal-600",
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
              {ACTION_LABELS[a.action] ?? a.action}
              <span className="ml-1.5 font-normal text-slate-500">· {a.actor}</span>
            </p>
            <p className="text-[12px] leading-relaxed text-slate-600">{neutralLegacyText(a.detail)}</p>
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
