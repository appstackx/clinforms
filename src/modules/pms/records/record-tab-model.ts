/**
 * The patient record's tab row in the design's order (design round 2, "Patient record – tabs by role"):
 *
 *   Overview · Appointments · Cases · Clinical notes · Outcomes · Attachments · Invoices · Messages · Forms · History
 *
 * Each module declares its own tabs (src/modules/pms/record-tabs/<module>.ts) and owns their route folders. A module
 * that has not declared its tab yet still gets one here, pointing at the records module's stand-in page
 * (/patients/[id]/tab/<key>): Appointments reads the diary's merged server read; Invoices, Messages and Forms say
 * what is coming – never a broken page. A module's own tab replaces its stand-in as soon as it is registered.
 * Tabs the member's role does not allow are left out entirely (reception: no clinical tabs). Pure.
 */
import type { PmsModuleId } from "../core/modules";
import type { PmsPermission } from "../core/permissions";
import { visibleRecordTabs, type PmsRecordTab } from "../core/record-tabs";

export interface RecordTabItem {
  key: string;
  label: string;
  /** Segment under the record ("" = overview). */
  segment: string;
  /** A stand-in for a module that has no tab of its own yet. */
  standIn: boolean;
}

interface Slot {
  key: string;
  label: string;
  module: PmsModuleId;
  /** Which registered tab fills the slot (by segment). */
  segment: string;
  permission: PmsPermission;
  /** Stand-in when the module has not registered the tab. */
  standIn: boolean;
}

const SLOTS: readonly Slot[] = [
  { key: "overview", label: "Overview", module: "records", segment: "", permission: "patients.view", standIn: false },
  { key: "appointments", label: "Appointments", module: "diary", segment: "appointments", permission: "diary.view", standIn: true },
  { key: "cases", label: "Cases", module: "records", segment: "cases", permission: "patients.view", standIn: false },
  { key: "notes", label: "Clinical notes", module: "records", segment: "notes", permission: "clinical.view", standIn: false },
  { key: "outcomes", label: "Outcomes", module: "records", segment: "outcomes", permission: "clinical.view", standIn: false },
  { key: "attachments", label: "Attachments", module: "records", segment: "attachments", permission: "clinical.view", standIn: false },
  { key: "invoices", label: "Invoices", module: "billing", segment: "invoices", permission: "billing.view", standIn: true },
  { key: "messages", label: "Messages", module: "comms", segment: "messages", permission: "messages.send", standIn: true },
  { key: "forms", label: "Forms", module: "portal", segment: "forms", permission: "patients.view", standIn: true },
  { key: "history", label: "History", module: "records", segment: "history", permission: "patients.view", standIn: false },
];

/** What a stand-in tab says until its module is merged. */
export const STAND_IN_COPY: Readonly<Record<string, { title: string; body: string }>> = {
  invoices: { title: "Coming with billing", body: "Invoices, payments and the patient's account will show here once billing is switched on for the clinic system." },
  messages: { title: "Coming with messages", body: "Reminders, texts and emails to and from the patient will show here once messaging is switched on." },
  forms: { title: "Coming with the patient portal", body: "Intake and consent forms the patient has been sent or has signed will show here." },
};

export function recordTabItems(registered: readonly PmsRecordTab[], can: (permission: PmsPermission) => boolean): RecordTabItem[] {
  const visible = visibleRecordTabs(registered, can);
  const used = new Set<string>();
  const out: RecordTabItem[] = [];
  for (const slot of SLOTS) {
    const own = visible.find((t) => t.segment === slot.segment && t.module === slot.module);
    if (own) {
      used.add(own.id);
      out.push({ key: slot.key, label: slot.label, segment: own.segment, standIn: false });
    } else if (slot.standIn && can(slot.permission) && !registered.some((t) => t.module === slot.module && t.segment === slot.segment)) {
      out.push({ key: slot.key, label: slot.label, segment: `tab/${slot.key}`, standIn: true });
    }
  }
  // Tabs of other modules the design does not name go before History, in their own order.
  const extra = visible.filter((t) => !used.has(t.id)).map((t) => ({ key: t.id, label: t.label, segment: t.segment, standIn: false }));
  if (extra.length) out.splice(out.findIndex((t) => t.key === "history") === -1 ? out.length : out.findIndex((t) => t.key === "history"), 0, ...extra);
  return out;
}

/** The stand-in keys the records module serves at /patients/[id]/tab/<key>. */
export const STAND_IN_KEYS = SLOTS.filter((s) => s.standIn).map((s) => s.key);

/** Whether the member may open a stand-in tab (the same rule as its slot). */
export function standInPermission(key: string): PmsPermission | null {
  return SLOTS.find((s) => s.standIn && s.key === key)?.permission ?? null;
}
