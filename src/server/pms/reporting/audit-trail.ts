/**
 * Set-up → Audit trail (K2-AUD-003): search the clinic's own audit trail by date, area or action, person, record
 * type, record id – and patient: the name typed is looked up with the ordinary patient search (its search keys,
 * limited to the member's sites; needs "View patients" too), and the entries about the patients found are shown
 * (the patient record itself, or an entry whose detail names the patient's id). settings.members to read,
 * reports.export to download (CSV, formula-safe, the download itself audited – with whether a patient was searched
 * for, never the text). Rows hold ids, codes and labels only – audit rows never hold patient data.
 */
import "server-only";
import { PMS_AUDIT_LABELS, PMS_AUDIT_TARGETS } from "../../../modules/pms/audit";
import { areaPrefix, auditIdRange, clinicSystemAuditAreas } from "../../../modules/pms/reporting/audit-search";
import type { AuditSearchParams } from "../../../modules/pms/reporting/schemas";
import { toCsv } from "../../../modules/pms/reporting/csv";
import type { AuditEntry } from "../../repos/audit";
import { pmsAudit } from "../../repos/pms/context";
import { searchAudit } from "../../repos/pms/reporting/audit-search";
import { auditPatientFilter } from "./audit-patients";
import { listClinicMembers, nameResolver } from "../access-screens";
import type { ClinicActor } from "../actor";
import type { AuditRow, AuditScreen } from "../../../modules/pms/reporting/setup-view";

export type { AuditRow, AuditScreen };

export type AuditActor = Pick<ClinicActor, "tenantId" | "organizationId" | "can" | "actor" | "repo"> & { siteIds?: ReadonlySet<string> | null };

function detailText(detail: Record<string, unknown> | null): string {
  if (!detail) return "";
  return Object.entries(detail)
    .slice(0, 8)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(" ") : typeof v === "object" && v !== null ? "…" : String(v)}`)
    .join(" · ")
    .slice(0, 300);
}

function toRows(entries: AuditEntry[], nameOf: (id: string | null) => string): AuditRow[] {
  return entries.map((e) => ({
    id: e.id,
    at: e.at,
    who: nameOf(e.userId),
    action: e.action,
    label: PMS_AUDIT_LABELS[e.action] ?? e.action,
    recordType: e.targetType ? (PMS_AUDIT_TARGETS[e.targetType] ?? e.targetType) : "",
    recordId: e.targetId,
    detail: detailText(e.detail),
  }));
}

function searchOf(p: AuditSearchParams, limit: number, relatedIds: string[] | null = null) {
  const range = auditIdRange(p.from, p.to);
  return {
    lowerId: range.lower,
    upperId: range.upper,
    actions: p.action ? [p.action] : null,
    actionPrefix: !p.action && p.area ? areaPrefix(p.area) : null,
    userId: p.userId,
    targetType: p.targetType,
    targetId: p.targetId,
    relatedIds,
    beforeId: p.before,
    afterId: p.after,
    limit,
  };
}

export async function auditScreenFor(actor: AuditActor, p: AuditSearchParams): Promise<{ ok: true; value: AuditScreen } | { ok: false; error: string }> {
  if (!actor.can("settings.members")) return { ok: false, error: "You do not have permission to do that." };
  const patients = await auditPatientFilter(actor, p.patient);
  if ("error" in patients) return { ok: false, error: patients.error };
  const [members, page] = await Promise.all([listClinicMembers(actor), searchAudit(actor.repo(), actor.tenantId, searchOf(p, 50, patients.ids))]);
  return {
    ok: true,
    value: {
      patient: patients.matches,
      canSearchPatients: actor.can("patients.view"),
      rows: toRows(page.entries, nameResolver(members)),
      hasOlder: page.hasOlder,
      hasNewer: page.hasNewer,
      areas: clinicSystemAuditAreas(),
      members: members.map((m) => ({ userId: m.userId, name: m.name })),
      types: Object.entries(PMS_AUDIT_TARGETS)
        .map(([id, label]) => ({ id, label }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      canExport: actor.can("reports.export"),
    },
  };
}

/** The search as CSV (at most 2,000 rows), audited as "pms.audit.export". */
export async function auditCsvFor(actor: AuditActor, p: AuditSearchParams): Promise<{ ok: true; csv: string; rows: number } | { ok: false; status: number }> {
  if (!actor.can("settings.members") || !actor.can("reports.export")) return { ok: false, status: 403 };
  const patients = await auditPatientFilter(actor, p.patient);
  if ("error" in patients) return { ok: false, status: 403 };
  const members = await listClinicMembers(actor);
  const nameOf = nameResolver(members);
  const rows: AuditRow[] = [];
  let before: string | null = p.before;
  for (let i = 0; i < 10; i++) {
    const page = await searchAudit(actor.repo(), actor.tenantId, { ...searchOf({ ...p, before, after: null }, 200, patients.ids) });
    rows.push(...toRows(page.entries, nameOf));
    if (!page.hasOlder || page.entries.length === 0) break;
    before = page.entries[page.entries.length - 1].id;
  }
  await pmsAudit(actor.repo(), actor.tenantId, actor.actor, { action: "pms.audit.export", targetType: "pms_audit", targetId: actor.tenantId, detail: { rows: rows.length, area: p.area, action: p.action, type: p.targetType, from: p.from, to: p.to, patientSearch: p.patient !== null } });
  const csv = toCsv(
    ["When (UTC)", "Who", "What", "Action code", "Record type", "Record id", "Detail"],
    rows.map((r) => [r.at, r.who, r.label, r.action, r.recordType, r.recordId, r.detail]),
  );
  return { ok: true, csv, rows: rows.length };
}
