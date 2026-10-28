/**
 * The clinic's audit search (pure parts). Audit entries have ULID ids, which start with the time they were
 * written (ms, Crockford base32), so a date range becomes an id range on the (tenant_id, id) index: no scan of a
 * clinic's whole trail.
 */
import { PMS_AUDIT_LABELS, PMS_AUDIT_TARGETS } from "../audit";
import { addDays, ukMidnightMs } from "./periods";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** The 10-character time part of a ULID for an instant (ms since 1970). */
export function ulidTimePart(ms: number): string {
  let t = Math.max(0, Math.floor(ms));
  let out = "";
  for (let i = 0; i < 10; i++) {
    out = CROCKFORD[t % 32] + out;
    t = Math.floor(t / 32);
  }
  return out;
}

/** The smallest ULID written at or after the instant. */
export function ulidLowerBound(ms: number): string {
  return `${ulidTimePart(ms)}${"0".repeat(16)}`;
}

/**
 * Id bounds of UK calendar dates: entries with `lower <= id < upper` were written from the start of `from` to the
 * end of `to` (UK time). Either side may be missing.
 */
export function auditIdRange(from: string | null, to: string | null): { lower: string | null; upper: string | null } {
  return {
    lower: from ? ulidLowerBound(ukMidnightMs(from)) : null,
    upper: to ? ulidLowerBound(ukMidnightMs(addDays(to, 1))) : null,
  };
}

/** The instant (ISO) a ULID was written, or null for something that is not a ULID. */
export function ulidTime(id: string): string | null {
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(id)) return null;
  let t = 0;
  for (const ch of id.slice(0, 10)) t = t * 32 + CROCKFORD.indexOf(ch);
  return new Date(t).toISOString();
}

/** An area of the clinic system's trail: "pms.<entity>" and its label. */
export interface AuditArea {
  id: string;
  label: string;
  actions: string[];
}

function humanise(entity: string): string {
  const text = entity.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The clinic system's areas from every module's audit labels (pms.<entity>.<verb>), sorted by label. */
export function clinicSystemAuditAreas(labels: Readonly<Record<string, string>> = PMS_AUDIT_LABELS, targets: Readonly<Record<string, string>> = PMS_AUDIT_TARGETS): AuditArea[] {
  const areas = new Map<string, AuditArea>();
  for (const code of Object.keys(labels)) {
    const m = /^pms\.([a-z0-9_]+)\.[a-z0-9_]+$/.exec(code);
    if (!m) continue;
    const id = `pms.${m[1]}`;
    let area = areas.get(id);
    if (!area) areas.set(id, (area = { id, label: targets[`pms_${m[1]}`] ?? humanise(m[1]), actions: [] }));
    area.actions.push(code);
  }
  return Array.from(areas.values()).sort((a, b) => a.label.localeCompare(b.label));
}

/** The action-code prefix an area stands for ("pms.patient" → "pms.patient."), or null for a full code. */
export function areaPrefix(area: string): string {
  return area.endsWith(".") ? area : `${area}.`;
}
