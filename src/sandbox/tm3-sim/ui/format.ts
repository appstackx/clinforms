/**
 * Display helpers for the simulated TM3 sandbox (UK formats: DD/MM/YYYY, 24-hour times).
 * Pure functions; safe on server and client. Dates are treated as calendar dates (no time-zone shift).
 *
 * Owner: sandbox agent.
 */
import type {
  SimAppointmentStatus,
  SimIncidentType,
  SimInstrument,
  SimNoteType,
  SimPatient,
  SimReferralSourceType,
  SimSex,
} from "../wire-types";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function parts(iso: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** "2026-03-18" → "18/03/2026". */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "–";
  const p = parts(iso);
  if (!p) return iso;
  return `${String(p[2]).padStart(2, "0")}/${String(p[1]).padStart(2, "0")}/${p[0]}`;
}

/** "2026-03-18" → "Wed 18/03/2026". */
export function formatDateWithDay(iso: string): string {
  const p = parts(iso);
  if (!p) return iso;
  const day = new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
  return `${WEEKDAYS[day]} ${formatDate(iso)}`;
}

/** 55 → "£55.00" (amounts are in pounds). */
export function formatGbp(amount: number): string {
  return `£${amount.toFixed(2)}`;
}

/** ISO date-time → "06/10/2026, 14:05" in UK local time. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/London" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
  return `${date}, ${time}`;
}

/** Whole years between a date of birth and `asOf` (default: today). */
export function ageOn(dobIso: string, asOf: Date = new Date()): number | null {
  const p = parts(dobIso);
  if (!p) return null;
  const y = asOf.getFullYear();
  const m = asOf.getMonth() + 1;
  const d = asOf.getDate();
  let age = y - p[0];
  if (m < p[1] || (m === p[1] && d < p[2])) age -= 1;
  return age;
}

export function fullName(p: Pick<SimPatient, "first_name" | "last_name">): string {
  return `${p.first_name} ${p.last_name}`;
}

export function initials(p: Pick<SimPatient, "first_name" | "last_name">): string {
  return `${p.first_name.charAt(0)}${p.last_name.charAt(0)}`.toUpperCase();
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "–";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const SEX_LABELS: Record<SimSex, string> = {
  female: "Female",
  male: "Male",
  other: "Other",
  not_recorded: "Not recorded",
};

export const REFERRAL_LABELS: Record<SimReferralSourceType, string> = {
  solicitor: "Solicitor",
  employer: "Employer",
  insurer: "Insurer",
  case_manager: "Case manager",
  self: "Self-referral",
  gp: "GP",
};

export const INCIDENT_LABELS: Record<SimIncidentType, string> = {
  road_traffic_accident: "Road traffic accident",
  workplace: "Workplace injury",
  slip_trip_fall: "Slip, trip or fall",
  sport: "Sports injury",
  other: "Other",
};

export const NOTE_TYPE_LABELS: Record<SimNoteType, string> = {
  initial_assessment: "Initial assessment",
  follow_up: "Follow-up",
  discharge: "Discharge",
  telephone: "Telephone",
  other: "Other",
};

export const APPOINTMENT_STATUS: Record<SimAppointmentStatus, { label: string; className: string }> = {
  ATT: { label: "Attended", className: "bg-emerald-50 text-emerald-800 ring-emerald-600/25" },
  DNA: { label: "Did not attend", className: "bg-rose-50 text-rose-800 ring-rose-600/25" },
  LCN: { label: "Late cancellation", className: "bg-violet-50 text-violet-800 ring-violet-600/25" },
  CNC: { label: "Cancelled", className: "bg-slate-100 text-slate-700 ring-slate-500/25" },
  BOOKED: { label: "Booked", className: "bg-blue-50 text-blue-800 ring-blue-600/25" },
};

export const INSTRUMENT_NAMES: Record<SimInstrument, string> = {
  NDI: "Neck Disability Index",
  ODI: "Oswestry Disability Index",
  NPRS: "Numeric Pain Rating Scale",
  PSFS: "Patient-Specific Functional Scale",
  QuickDASH: "QuickDASH",
};

/** Label of the launch button for a referral type, or null when no report type fits. */
export function reportActionLabel(source: SimReferralSourceType): string | null {
  if (source === "solicitor" || source === "insurer" || source === "case_manager" || source === "employer") return "Complete referrer's report form";
  return null;
}
