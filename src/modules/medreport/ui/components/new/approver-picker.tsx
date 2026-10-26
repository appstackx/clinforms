"use client";

/**
 * The approving clinician of a new report (bh2 WC design 1): chosen when the report is created, stored as
 * Report.approver (hashed). Only a member who may sign and has an HCPC number can be chosen; it starts as the member
 * creating the report when they may sign – staff always choose. The approver decides the clinician-only questions and
 * approves the form; someone else who may approve can take over on the review screen.
 *
 * - approverOptions(clinic, member): the clinic's signers (StudioClinic.signers), the member themselves first when they
 *   may sign – never a staff member, never one without an HCPC number;
 * - defaultApproverId(options, member): the member when they may sign, else none (an explicit choice);
 * - approverOf(option): the Report.approver stamp {memberId, name, hcpc};
 * - demoApprover(clinician): the public demo's one fictional user (member id "demo", as core/actor.ts demoActor).
 *
 * Owner: WC (review roles and provenance) – docs/bh2-ownership.json.
 */
import type { Clinician, ReportApprover } from "../../../core/types";
import type { StudioClinic, StudioMember } from "../../host-hooks";
import { cn } from "../../primitives";

export interface ApproverOption {
  memberId: string;
  name: string;
  hcpc: string;
}

/** The member may approve: not staff, "may sign", an HCPC number and an account id. */
export function memberMayApprove(member: StudioMember | undefined): member is StudioMember & { userId: string; hcpc: string } {
  return Boolean(member && member.role !== "staff" && member.canSign !== false && member.hcpc?.trim() && member.userId?.trim() && member.name.trim());
}

/** Who can be chosen as the approving clinician. */
export function approverOptions(clinic: Pick<StudioClinic, "signers"> | undefined, member: StudioMember | undefined): ApproverOption[] {
  const out: ApproverOption[] = [];
  const add = (o: ApproverOption) => {
    if (o.memberId.trim() && o.name.trim() && o.hcpc.trim() && !out.some((x) => x.memberId === o.memberId)) out.push({ memberId: o.memberId.trim(), name: o.name.trim(), hcpc: o.hcpc.trim() });
  };
  if (memberMayApprove(member)) add({ memberId: member.userId, name: member.name, hcpc: member.hcpc });
  for (const s of clinic?.signers ?? []) add({ memberId: s.userId, name: s.name, hcpc: s.hcpc });
  return out;
}

/** The member themselves when they may approve; otherwise nobody until someone is chosen. */
export function defaultApproverId(options: readonly ApproverOption[], member: StudioMember | undefined): string | null {
  return memberMayApprove(member) && options.some((o) => o.memberId === member.userId) ? member.userId : null;
}

/** The Report.approver stamp for an option. */
export function approverOf(option: ApproverOption): ReportApprover {
  return { memberId: option.memberId, name: option.name, hcpc: option.hcpc };
}

/** The public demo: its one fictional user approves (member id "demo" – core/actor.ts demoActor). */
export function demoApprover(clinician: Pick<Clinician, "name" | "hcpc"> | null | undefined): ReportApprover | null {
  const name = clinician?.name?.trim();
  const hcpc = clinician?.hcpc?.trim();
  return name && hcpc ? { memberId: "demo", name, hcpc } : null;
}

export function ApproverPicker({
  options,
  value,
  onChange,
  memberIsStaff,
}: {
  options: readonly ApproverOption[];
  value: string | null;
  onChange(memberId: string | null): void;
  /** Staff choose the approver (they never approve themselves). */
  memberIsStaff: boolean;
}) {
  const id = "approver-picker";
  if (options.length === 0) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950" role="status" data-approver-picker>
        <p className="font-medium">No member of your clinic can approve this form yet</p>
        <p className="mt-1">An owner adds signing details (an HCPC number and “may sign”) for a clinician under Clinic settings → Members.</p>
      </div>
    );
  }
  return (
    <div className="space-y-1.5 rounded-2xl border border-slate-200 bg-white p-4" data-approver-picker>
      <label htmlFor={id} className="block text-sm font-medium text-slate-900">
        Approving clinician
      </label>
      <p className="text-xs leading-relaxed text-slate-600">
        They decide the clinician-only answers and approve the form.{memberIsStaff ? " What you enter in those answers waits for them to adopt it." : ""}
      </p>
      <select
        id={id}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className={cn(
          "mt-1 h-10 w-full max-w-sm rounded-lg border bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-teal-600/20",
          value ? "border-slate-300 focus:border-[#0D9488]" : "border-amber-400",
        )}
      >
        <option value="">Choose the approving clinician…</option>
        {options.map((o) => (
          <option key={o.memberId} value={o.memberId}>
            {o.name} (HCPC {o.hcpc})
          </option>
        ))}
      </select>
    </div>
  );
}
