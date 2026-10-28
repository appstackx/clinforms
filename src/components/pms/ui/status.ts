/**
 * Status → pill (design system v1, docs/clinic-system/design/): every state has its own colour, icon AND word, so
 * colour is never the only signal. Pure and browser-safe; the icons are named here and drawn by status-pill.tsx.
 *
 * The keys cover both the design's words and the modules' stored values (diary `attended`, billing `unpaid` /
 * `cancelled`), so a screen can pass a stored status straight in.
 */

export type StatusTone = "blue" | "amber" | "teal" | "green" | "red" | "orange" | "slate" | "draft";

export type StatusIcon =
  | "calendar"
  | "user-check"
  | "activity"
  | "check-circle"
  | "user-x"
  | "calendar-x"
  | "x-circle"
  | "pen"
  | "send"
  | "half"
  | "check"
  | "alert-circle"
  | "ban"
  | "clock"
  | "lock"
  | "file-plus";

export interface StatusStyle {
  label: string;
  tone: StatusTone;
  icon: StatusIcon;
  /** Crossed out (cancelled, void): the word stays readable, the line says "no longer counts". */
  strike: boolean;
}

export type StatusKind = "appointment" | "invoice" | "note";

/** Tailwind classes per tone (literal strings so Tailwind keeps them). Contrast of text on fill ≥ 4.5:1. */
export const TONE_CLASSES: Readonly<Record<StatusTone, { fill: string; text: string; border: string }>> = {
  blue: { fill: "bg-[#E8EEFB]", text: "text-[#1842B4]", border: "border-[#C7D4F5]" },
  amber: { fill: "bg-[#FEF3C7]", text: "text-[#864E0E]", border: "border-[#FBD38D]" },
  teal: { fill: "bg-[#D5F5F0]", text: "text-[#0B5F58]", border: "border-[#99E2D8]" },
  green: { fill: "bg-[#DCFCE7]", text: "text-[#166534]", border: "border-[#A7E8BE]" },
  red: { fill: "bg-[#FEE2E2]", text: "text-[#991B1B]", border: "border-[#FCA5A5]" },
  orange: { fill: "bg-[#FFEDD5]", text: "text-[#9A3412]", border: "border-[#FDBA74]" },
  slate: { fill: "bg-[#F1F5F9]", text: "text-[#475569]", border: "border-[#CBD5E1]" },
  draft: { fill: "bg-[#F1F5F9]", text: "text-[#334155]", border: "border-[#CBD5E1]" },
};

const s = (label: string, tone: StatusTone, icon: StatusIcon, strike = false): StatusStyle => ({ label, tone, icon, strike });

export const APPOINTMENT_STATUS_STYLES: Readonly<Record<string, StatusStyle>> = {
  booked: s("Booked", "blue", "calendar"),
  arrived: s("Arrived", "amber", "user-check"),
  in_treatment: s("In treatment", "teal", "activity"),
  completed: s("Completed", "green", "check-circle"),
  // The diary stores "attended" (src/modules/pms/diary/rules.ts) – same look as the design's "Completed".
  attended: s("Attended", "green", "check-circle"),
  dna: s("Did not attend (DNA)", "red", "user-x"),
  late_cancelled: s("Late cancellation", "orange", "calendar-x"),
  cancelled: s("Cancelled", "slate", "x-circle", true),
};

export const INVOICE_STATUS_STYLES: Readonly<Record<string, StatusStyle>> = {
  draft: s("Draft", "draft", "pen"),
  issued: s("Issued", "blue", "send"),
  // billing's invoiceState(): an issued invoice with nothing paid is "unpaid" – on screen it reads "Issued".
  unpaid: s("Issued", "blue", "send"),
  part_paid: s("Part-paid", "amber", "half"),
  paid: s("Paid", "green", "check"),
  overdue: s("Overdue", "red", "alert-circle"),
  void: s("Void", "slate", "ban", true),
  cancelled: s("Void", "slate", "ban", true),
  credited: s("Credited", "slate", "check"),
  refund_due: s("Refund due", "amber", "alert-circle"),
};

export const NOTE_STATUS_STYLES: Readonly<Record<string, StatusStyle>> = {
  draft: s("Draft", "draft", "pen"),
  unsigned: s("Unsigned", "amber", "clock"),
  signed: s("Signed", "green", "lock"),
  amended: s("Amended", "blue", "file-plus"),
  discarded: s("Discarded draft", "slate", "ban", true),
};

const BY_KIND: Readonly<Record<StatusKind, Readonly<Record<string, StatusStyle>>>> = {
  appointment: APPOINTMENT_STATUS_STYLES,
  invoice: INVOICE_STATUS_STYLES,
  note: NOTE_STATUS_STYLES,
};

/** "part_paid" → "Part paid" (for a status the kit does not know: still a word, never a blank pill). */
function humanise(status: string): string {
  const words = status.replace(/[_-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Unknown";
}

/** The pill for a stored status. Unknown statuses get a neutral pill with the status as a word. */
export function statusStyle(kind: StatusKind, status: string): StatusStyle {
  return BY_KIND[kind][status] ?? s(humanise(status), "slate", "alert-circle");
}
