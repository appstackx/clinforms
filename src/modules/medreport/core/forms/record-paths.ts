/**
 * Referrer forms – record paths: values filled by CODE from the record (registration paths, computed facts, address
 * lines and postcodes, the attended appointments' dates and times) and where a registration-filled value really comes
 * from (recordSourceOf).
 *
 * Pure: no React, no Node built-ins, no env. Split out of core/forms.ts by W0.4 (bh2 module split, pure move; core/forms.ts re-exports it).
 * Owner: WE (data, maps and mapping page) – docs/bh2-ownership.json.
 */
import { bundleClinic } from "../clinic";
import { formatScore } from "../computed-facts";
import { ageOn, compareIsoDateTime, formatUkDate, isValidIsoDate } from "../dates";
import type { RecordSource } from "../labels";
import type { AnswerType, Clinician, ComputedFact, ComputedFactFormat, EpisodeBundle, FactId, FormField, InstructingParty, RegistrationPath } from "../types";

/* ------------------------------------------------------------------------------------------------
 * Values filled by CODE (registration, computed facts)
 * ----------------------------------------------------------------------------------------------*/

export interface FormValueContext {
  /** The unscoped bundle. */
  bundle: EpisodeBundle;
  instructingParty: InstructingParty;
  computedFacts: ComputedFact[];
  /** Treating clinician for clinician.* paths (default: the clinician who wrote most notes, latest on a tie). */
  clinician?: Clinician;
  /** ISO date of the report (age, report.date). */
  reportDate: string;
}

/** A value resolved by code: `text` is written for text anchors, `value` for structured answers. */
export interface ResolvedFormValue {
  text: string;
  /** ISO date for dates, digits for numbers, boolean for yes/no and tick boxes, otherwise the text. */
  value: string | boolean;
  /** Citable IDs ("REG", "FACT-…", "N-…"). */
  sourceIds: string[];
  /** 10/2026: the record leaves this answer space empty on purpose (an address line it does not have). */
  blank?: boolean;
}

function hasFact(facts: ComputedFact[], id: string): boolean {
  return facts.some((f) => f.id === id);
}

function withFact(facts: ComputedFact[], base: string[], id: FactId): string[] {
  return hasFact(facts, id) ? [...base, id] : base;
}

/** The clinician who wrote most notes (latest note wins a tie), if any. */
export function primaryTreatingClinician(bundle: EpisodeBundle): Clinician | null {
  const notes = [...bundle.notes].sort(compareIsoDateTime);
  const counts = new Map<string, { clinician: Clinician; n: number; last: number }>();
  notes.forEach((note, i) => {
    const key = `${note.author.name}|${note.author.hcpc}`;
    const entry = counts.get(key) ?? { clinician: note.author, n: 0, last: -1 };
    entry.n += 1;
    entry.last = i;
    counts.set(key, entry);
  });
  let best: { clinician: Clinician; n: number; last: number } | null = null;
  for (const entry of Array.from(counts.values())) {
    if (!best || entry.n > best.n || (entry.n === best.n && entry.last > best.last)) best = entry;
  }
  return best?.clinician ?? bundle.clinicians[0] ?? null;
}

function dateValue(iso: string, sourceIds: string[]): ResolvedFormValue {
  return { text: formatUkDate(iso), value: iso, sourceIds };
}

function textValue(text: string | undefined | null, sourceIds: string[]): ResolvedFormValue | null {
  const t = (text ?? "").trim();
  return t ? { text: t, value: t, sourceIds } : null;
}

/**
 * The patient's insurer as the record holds it: the referral's insurer name, or – for an insurer referral
 * that does not name one separately – the referring insurer itself. Null when the record names no insurer.
 */
export function insurerNameOnRecord(bundle: Pick<EpisodeBundle, "referral">): string | null {
  const named = bundle.referral.insurerName?.trim();
  if (named) return named;
  return bundle.referral.type === "insurer" && bundle.referral.name.trim() ? bundle.referral.name.trim() : null;
}

const SEX_TEXT: Record<EpisodeBundle["registration"]["sex"], string> = {
  female: "Female",
  male: "Male",
  other: "Other",
  not_recorded: "",
};

/**
 * Resolve a registration path from the bundle (code only, never AI). Returns null when the record does
 * not hold the value (the caller leaves the answer blank and raises a gap; it never guesses).
 */
export function resolveRegistrationValue(
  path: RegistrationPath,
  ctx: FormValueContext,
  answerType?: AnswerType,
  /** 10/2026: one line of an address printed over several lines (a registration fill source's `part`). */
  part?: AddressPart,
): ResolvedFormValue | null {
  const { bundle, instructingParty: party, computedFacts: facts } = ctx;
  const reg = bundle.registration;
  const REG = ["REG"];
  const notes = [...bundle.notes].sort(compareIsoDateTime);
  const attended = bundle.appointments.filter((a) => a.status === "ATT").sort(compareIsoDateTime);
  const episodeIds = (fallbackNoteId?: string) =>
    hasFact(facts, "FACT-episode") ? ["FACT-episode"] : fallbackNoteId ? [fallbackNoteId] : [];

  switch (path) {
    case "patient.fullName":
      return textValue(reg.fullName, REG);
    case "patient.firstName":
      return textValue(reg.firstName, REG);
    case "patient.lastName":
      return textValue(reg.lastName, REG);
    case "patient.dob":
      return isValidIsoDate(reg.dob) ? dateValue(reg.dob, REG) : null;
    case "patient.age": {
      if (!isValidIsoDate(reg.dob)) return null;
      const age = ageOn(reg.dob, ctx.reportDate);
      return {
        text: answerType === "number" ? String(age) : `${age} years`,
        value: String(age),
        sourceIds: withFact(facts, REG, "FACT-age"),
      };
    }
    case "patient.sex":
      return textValue(SEX_TEXT[reg.sex], REG);
    case "patient.address":
      return textValue(reg.addressSummary, REG);
    case "patient.addressLines":
      if (part) return addressPartValue(splitUkAddress(reg.addressSummary).lines, part, REG);
      return textValue(splitUkAddress(reg.addressSummary).lines.join("\n"), REG);
    case "patient.postcode":
      return textValue(splitUkAddress(reg.addressSummary).postcode, REG);
    case "patient.occupation":
      return textValue(reg.occupation, REG);
    case "patient.employer":
      return textValue(reg.employer, REG);
    case "patient.title":
      return textValue(reg.title, REG);
    case "patient.phone":
      return textValue(reg.contact?.phone, REG);
    case "patient.email":
      return textValue(reg.contact?.email, REG);
    case "referral.insurerName":
      return textValue(insurerNameOnRecord(bundle), REG);
    // Insurer identifiers: createFormReport copies them only onto the insurer's own form
    // (core/form-record-rules.ts withheldInsurerIdentifier).
    case "referral.membershipNumber":
      return textValue(bundle.referral.membershipNumber, REG);
    case "referral.authorisationNumber":
      return textValue(bundle.referral.authorisationNumber, REG);
    case "referral.referrerName":
      return textValue(party.name, REG);
    case "referral.reference":
      return textValue(party.reference, REG);
    case "incident.date":
      return bundle.incident?.date ? dateValue(bundle.incident.date, REG) : null;
    case "incident.mechanism":
      return textValue(bundle.incident?.mechanism, REG);
    case "episode.firstSeen": {
      const first = attended[0]?.date ?? notes[0]?.date;
      return first ? dateValue(first, episodeIds(notes[0]?.id)) : null;
    }
    // Fix round 1 (B0-15): the appointments' times are in the record (Check the notes shows them).
    case "episode.firstSeenTime":
      return attended[0]?.time ? textValue(attended[0].time, attended[0].noteId ? [attended[0].noteId] : episodeIds()) : null;
    case "episode.attendedDate":
    case "episode.attendedTime": {
      const n = Math.max(1, Math.floor(part?.index ?? 1));
      const appt = attended[n - 1];
      // A session the record does not have (the 7th of 6) is written as nothing; the first must be there.
      if (!appt) return n >= 2 && attended.length > 0 ? { text: "", value: "", sourceIds: episodeIds(), blank: true } : null;
      const ids = appt.noteId ? [appt.noteId] : episodeIds();
      if (path === "episode.attendedDate") return dateValue(appt.date, ids);
      return appt.time ? textValue(appt.time, ids) : null;
    }
    case "episode.lastSeen": {
      const last = attended[attended.length - 1]?.date ?? notes[notes.length - 1]?.date;
      return last ? dateValue(last, episodeIds(notes[notes.length - 1]?.id)) : null;
    }
    case "episode.dischargeDate": {
      if (bundle.episodeStatus !== "discharged") return null;
      const discharge = notes.filter((n) => n.type === "discharge").pop() ?? notes[notes.length - 1];
      return discharge ? dateValue(discharge.date, episodeIds(discharge.id)) : null;
    }
    // The clinic's own details (a clinic's profile on its bundle; DEMO_CLINIC in the public demo; blank for a
    // clinic without a profile – never the fictional demo clinic): core/clinic.ts bundleClinic().
    case "clinic.name":
      return textValue(bundleClinic(bundle)?.name, []);
    case "clinic.address":
      return textValue(bundleClinic(bundle)?.addressLines.join(", "), []);
    case "clinic.phone":
      return textValue(bundleClinic(bundle)?.phone, []);
    case "clinic.email":
      return textValue(bundleClinic(bundle)?.email, []);
    // 10/2026 (a clinic system's <<P_LOCATION_…>> codes): the clinic's address lines without the postcode, and the
    // postcode, from the same lines ("postcode last").
    case "clinic.addressLines": {
      const lines = clinicAddress(bundle).lines;
      if (part) return addressPartValue(lines, part, []);
      return textValue(lines.join("\n"), []);
    }
    case "clinic.postcode":
      return textValue(clinicAddress(bundle).postcode, []);
    // A detail the record here does not hold: never filled by code – staff enter it (the caller raises the gap).
    case "staff.entry":
      return null;
    // bh2 (plan W0.3): the list of attended appointment dates (fill source `sessions`) is defined in core/schemas.ts and
    // resolved by WE's record paths; until then nothing is filled (the caller raises the gap), so nothing is guessed.
    case "episode.attendedDates":
      return null;
    case "report.date":
      return dateValue(ctx.reportDate.slice(0, 10), []);
    case "clinician.name":
    case "clinician.hcpc":
    case "clinician.profession": {
      const clinician = ctx.clinician ?? primaryTreatingClinician(bundle);
      if (!clinician) return null;
      const noteId = notes.filter((n) => n.author.name === clinician.name).pop()?.id;
      const ids = noteId ? [noteId] : [];
      if (path === "clinician.name") return textValue(clinician.name, ids);
      if (path === "clinician.hcpc") return textValue(clinician.hcpc, ids);
      return textValue(clinician.role ?? "Physiotherapist", ids);
    }
  }
}

/** One line of a postal address printed over `of` lines: which line, 1-based (a registration fill source's `part`). */
export interface AddressPart {
  index: number;
  of: number;
}

/** The clinic's address lines (postcode last in its settings) split into lines and postcode. */
function clinicAddress(bundle: EpisodeBundle): { lines: string[]; postcode: string } {
  const lines = (bundleClinic(bundle)?.addressLines ?? []).map((l) => l.trim()).filter(Boolean);
  return splitUkAddress(lines.join(", "));
}

/**
 * Line `part.index` of an address printed over `part.of` lines: the record's lines in order; the last printed line
 * takes every line left over (joined with commas); a printed line the record has no line for is BLANK on purpose
 * (`blank: true` – written as nothing, the clinic system's code removed). An address the record does not hold at all
 * leaves the first line unanswered (one gap for staff) and the others blank.
 */
export function addressPartValue(lines: readonly string[], part: AddressPart, sourceIds: string[]): ResolvedFormValue | null {
  const of = Math.max(1, Math.floor(part.of));
  const index = Math.min(of, Math.max(1, Math.floor(part.index)));
  if (lines.length === 0) return index === 1 ? null : { text: "", value: "", sourceIds, blank: true };
  const text = index < of ? (lines[index - 1] ?? "") : lines.slice(index - 1).join(", ");
  return text.trim() ? { text: text.trim(), value: text.trim(), sourceIds } : { text: "", value: "", sourceIds, blank: true };
}

/** A UK postcode at the end of an address ("MK5 8ZZ", "SW1A 1AA"). */
const UK_POSTCODE_AT_END = /[,\s]*\b([A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2})\s*$/i;

/**
 * "22 Larkspur Mews, Loughton, Milton Keynes, MK5 8ZZ" → lines ["22 Larkspur Mews", "Loughton", "Milton
 * Keynes"] and postcode "MK5 8ZZ" – for a form with printed address lines and a separate postcode box.
 * Commas inside brackets ("(fictional)") never split a line. No postcode found: all parts are lines.
 */
export function splitUkAddress(address: string): { lines: string[]; postcode: string } {
  const text = address.trim();
  const m = UK_POSTCODE_AT_END.exec(text);
  const postcode = m ? m[1].toUpperCase().replace(/^(\S+?)(\d[A-Z]{2})$/, "$1 $2") : "";
  const rest = m ? text.slice(0, m.index) : text;
  const lines: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of Array.from(rest)) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if ((ch === "," || ch === "\n") && depth === 0) {
      if (cur.trim()) lines.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) lines.push(cur.trim());
  return { lines, postcode };
}

/** Resolve a computed fact for a form answer (code only). Null when the record does not support it. */
export function resolveComputedFactValue(
  factId: FactId,
  format: ComputedFactFormat | undefined,
  ctx: FormValueContext,
  answerType?: AnswerType,
): ResolvedFormValue | null {
  const fact = ctx.computedFacts.find((f) => f.id === factId);
  const ids = fact ? [fact.id] : [];
  if (format === "sessions_attended" || format === "dna_count") {
    if (ctx.bundle.appointments.length === 0) return null;
    const status = format === "sessions_attended" ? "ATT" : "DNA";
    const n = ctx.bundle.appointments.filter((a) => a.status === status).length;
    return { text: String(n), value: String(n), sourceIds: hasFact(ctx.computedFacts, "FACT-attendance") ? ["FACT-attendance"] : ids };
  }
  if (format === "first_scores" || format === "latest_scores") {
    // Every outcome measure the record holds, in the record's order: its first (or latest) score.
    const first = format === "first_scores";
    const picked = ctx.bundle.outcomeMeasures
      .map((m) => {
        const sorted = m.points.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
        const point = first ? sorted[0] : sorted[sorted.length - 1];
        return point ? { instrument: m.instrument, unit: m.unit, point } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    if (picked.length === 0) return null;
    const sameDate = picked.every((p) => p.point.date === picked[0].point.date);
    const parts = picked.map((p) => `${p.instrument} ${formatScore(p.point.value, p.unit)}${sameDate ? "" : ` (${formatUkDate(p.point.date)})`}`);
    const sourceIds = picked.map((p) => `FACT-outcomes-${p.instrument}`).filter((id) => hasFact(ctx.computedFacts, id));
    return textValue(`${parts.join(" · ")}${sameDate ? ` (${formatUkDate(picked[0].point.date)})` : ""}`, sourceIds.length ? sourceIds : ids);
  }
  if (format === "first_score" || format === "latest_score") {
    const instrument = /^FACT-outcomes-(.+)$/.exec(factId)?.[1];
    const points = ctx.bundle.outcomeMeasures
      .filter((m) => m.instrument === instrument)
      .flatMap((m) => m.points.map((p) => ({ ...p, unit: m.unit })))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const point = format === "first_score" ? points[0] : points[points.length - 1];
    if (!point || !instrument) return null;
    return textValue(`${instrument} ${formatScore(point.value, point.unit)} (${formatUkDate(point.date)})`, ids);
  }
  if (!fact) return null;
  const text = answerType === "long_text" && fact.detail ? `${formFactText(fact.value)}. ${formFactText(fact.detail)}` : formFactText(fact.value);
  return textValue(text, ids);
}

/**
 * A computed fact's value or detail as text for a referrer's form. The facts are written for citing
 * (FACT-*, N-###, A-### IDs, status codes, arrows); a form gets plain words: no internal note or
 * appointment IDs, no ATT/DNA/LCN/CNC codes after their words, and "→" read as "then".
 */
export function formFactText(text: string): string {
  return text
    .replace(/\s*\((?:[A-Z]{1,4}-\d{2,}(?:,\s*)?)+\)/g, "") // " (N-001)", " (N-001, N-003)"
    .replace(/\((?:[A-Z]{1,4}-\d{2,}),\s*/g, "(") // "(A-004, reason recorded: …)" → "(reason recorded: …)"
    .replace(/\s*\((?:ATT|DNA|LCN|CNC)\)/g, "") // "Attended (ATT): 5" → "Attended: 5"
    .replace(/\((?:CNC),\s*/g, "(") // "(CNC, not counted above)" → "(not counted above)"
    .replace(/\s*→\s*/g, ", then ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * Fix round 1 (B0-19): where a registration-filled question's value really comes from (core/labels.ts RecordSource) –
 * "staff.entry" is typed by staff on each report, or chosen by the physiotherapist when the map's guidance says so;
 * "clinic.*" comes from the clinic's own details. Null for the patient's record and everything else.
 */
export function recordSourceOf(field: Pick<FormField, "fillSource" | "guidance">): RecordSource | null {
  if (field.fillSource.kind !== "registration") return null;
  const path = field.fillSource.path;
  if (path === "staff.entry") return /\bchosen by the (?:physiotherapist|clinician)\b/i.test(field.guidance ?? "") ? "physio_choice" : "staff_entry";
  return path.startsWith("clinic.") ? "clinic" : null;
}
