/**
 * The appointment drawer's "History of changes" rows (pure – tested in history-rows.test.ts): the audit rows about
 * one diary item, newest first, as When (DD/MM/YYYY HH:mm, UK time) / Who / What / Detail. Redacted the way the
 * patient record's History is (records/history-service.ts): for a member without clinical.view (reception) the
 * rows about clinical records – the note started from the appointment – keep only what happened and when.
 */
import type { AuditEntry } from "../../repos/audit";
import { presentActivity, type ActivityLookups } from "../../admin/activity";
import { redactClinicalDetail } from "../records/history-service";

export interface AppointmentHistoryRow {
  id: string;
  /** "29/10/2026 09:41" (UK time). */
  when: string;
  who: string;
  what: string;
  detail: string | null;
}

const UK = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** "29/10/2026 09:41" (UK time). */
export function ukDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : UK.format(d).replace(",", "");
}

export function appointmentHistoryRows(entries: readonly AuditEntry[], canSeeClinical: boolean, lookups: ActivityLookups): AppointmentHistoryRow[] {
  const unique = Array.from(new Map(entries.map((e) => [e.id, e])).values()).sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  const safe = redactClinicalDetail(unique, canSeeClinical);
  return presentActivity(safe, lookups).map((r) => ({ id: r.id, when: ukDateTime(r.at), who: r.who, what: r.label, detail: r.detail }));
}
