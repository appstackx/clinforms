/**
 * Computed facts: everything that can be checked is computed by code, never by the AI.
 *
 * The AI receives these as `<computed_facts>` and may quote them by ID (FACT-*), never recalculate
 * them. FIGURE_NOT_IN_SOURCE accepts a figure in a paragraph when it appears in the `value` or
 * `detail` of a cited fact, so every date here is written DD/MM/YYYY and every number as digits.
 *
 * Data minimisation: facts never contain the patient's name, date of birth, address or contact
 * details (they are sent to the AI). Clinician names are fine.
 *
 * Pure (no I/O, no clock unless `asOf` is omitted): safe in the browser and on the server.
 *
 * Owner: integration agent. Signature is final.
 */
import { ageOn, compareIsoDateTime, daysBetween, formatUkDate, todayIso } from "./dates";
import type {
  Appointment,
  ComputedFact,
  EpisodeBundle,
  Note,
  OutcomeMeasureSeries,
  OutcomePoint,
} from "./types";

type Instrument = OutcomeMeasureSeries["instrument"];

/** Display names of the outcome instruments (labels of the FACT-outcomes-* entries). */
export const OUTCOME_INSTRUMENT_NAMES: Record<Instrument, string> = {
  NDI: "Neck Disability Index",
  ODI: "Oswestry Disability Index",
  NPRS: "Numeric Pain Rating Scale",
  PSFS: "Patient-Specific Functional Scale",
  QuickDASH: "QuickDASH (arm, shoulder and hand)",
};

/** Appointment statuses that count towards "X of Y attended" (CNC and BOOKED are reported separately). */
const COUNTED_STATUSES: ReadonlyArray<Appointment["status"]> = ["ATT", "DNA", "LCN"];

/**
 * Compute the citable FACT-* entries for a bundle.
 *
 * Returns, where the data allows (in this order):
 * - `FACT-attendance` – counts by status, e.g. value "10 of 11 appointments attended (1 DNA)", detail
 *   listing DNA/LCN dates (DD/MM/YYYY) with their appointment IDs and recorded reasons.
 * - `FACT-age` – age in whole years at `asOf` (default today, Europe/London), e.g. "34 years", and at
 *   the incident date when one is recorded. The date of birth itself is never included.
 * - `FACT-episode` – first/last appointment dates, discharge date and note, duration, number of notes
 *   and clinicians, episode status.
 * - `FACT-outcomes-<instrument>` – one per instrument with ≥1 point: first → … → latest with dates and
 *   the change, e.g. "NDI 42% → 24% → 12% (lower is better)".
 *
 * @param bundle the (unscoped) episode bundle
 * @param opts.asOf ISO date used for FACT-age (default: today, Europe/London) – normally the report date
 */
export function computeFacts(bundle: EpisodeBundle, opts: { asOf?: string } = {}): ComputedFact[] {
  const asOf = (opts.asOf ?? todayIso()).slice(0, 10);
  const facts: ComputedFact[] = [];

  const attendance = attendanceFact(bundle);
  if (attendance) facts.push(attendance);

  const age = ageFact(bundle, asOf);
  if (age) facts.push(age);

  const episode = episodeFact(bundle);
  if (episode) facts.push(episode);

  facts.push(...outcomeFacts(bundle));
  return facts;
}

/* ------------------------------------------------------------------------------------------------
 * FACT-attendance
 * ----------------------------------------------------------------------------------------------*/

function attendanceFact(bundle: EpisodeBundle): ComputedFact | null {
  const appts = sortedAppointments(bundle.appointments);
  if (appts.length === 0) return null;

  const by = (status: Appointment["status"]) => appts.filter((a) => a.status === status);
  const att = by("ATT");
  const dna = by("DNA");
  const lcn = by("LCN");
  const cnc = by("CNC");
  const booked = by("BOOKED");
  const counted = appts.filter((a) => COUNTED_STATUSES.indexOf(a.status) >= 0);

  const extras: string[] = [];
  if (dna.length) extras.push(`${dna.length} DNA`);
  if (lcn.length) extras.push(`${lcn.length} late cancellation${lcn.length === 1 ? "" : "s"}`);
  // None missed: "5 appointments attended to date, none missed (1 cancelled with notice; 1 more booked)" –
  // not "5 of 5", which reads as if those were all the appointments.
  const besides = [cnc.length ? `${cnc.length} cancelled with notice` : "", booked.length ? `${booked.length} more booked` : ""].filter(Boolean);
  const value =
    counted.length === 0
      ? `No appointments have taken place yet (${booked.length} booked)`
      : extras.length === 0
        ? `${att.length} appointment${att.length === 1 ? "" : "s"} attended to date, none missed${besides.length ? ` (${besides.join("; ")})` : ""}`
        : `${att.length} of ${counted.length} appointments attended (${extras.join(", ")})`;

  const missed = (list: Appointment[]) =>
    list.length === 0
      ? "none"
      : list
          .map((a) => {
            const reason = a.reason ? `reason recorded: "${a.reason}"` : "no reason recorded";
            return `${formatUkDate(a.date)} (${a.id}, ${reason})`;
          })
          .join("; ");

  const parts = [
    `Attended (ATT): ${att.length}.`,
    `Did not attend (DNA): ${dna.length}${dna.length ? ` – ${missed(dna)}` : ""}.`,
    `Late cancellations (LCN): ${lcn.length}${lcn.length ? ` – ${missed(lcn)}` : ""}.`,
  ];
  if (cnc.length) {
    parts.push(
      `Cancelled with notice (CNC, not counted above): ${cnc.length} – ${cnc.map((a) => `${formatUkDate(a.date)} (${a.id})`).join("; ")}.`,
    );
  }
  if (booked.length) parts.push(`Booked for a future date (not counted above): ${booked.length}.`);
  if (att.length) {
    parts.push(
      `First attended appointment ${formatUkDate(att[0].date)}; last attended appointment ${formatUkDate(att[att.length - 1].date)}.`,
    );
  }

  return { id: "FACT-attendance", label: "Attendance", value, detail: parts.join(" ") };
}

/* ------------------------------------------------------------------------------------------------
 * FACT-age
 * ----------------------------------------------------------------------------------------------*/

function ageFact(bundle: EpisodeBundle, asOf: string): ComputedFact | null {
  const dob = bundle.registration.dob;
  if (!dob || dob > asOf) return null;
  const age = ageOn(dob, asOf);
  const parts = [
    `Age in whole years on ${formatUkDate(asOf)} (the report date), calculated from the date of birth on the registration record.`,
  ];
  const incidentDate = bundle.incident?.date;
  if (incidentDate && incidentDate >= dob) {
    parts.push(`Age at the incident on ${formatUkDate(incidentDate)}: ${ageOn(dob, incidentDate)} years.`);
  }
  return { id: "FACT-age", label: "Age", value: `${age} years`, detail: parts.join(" ") };
}

/* ------------------------------------------------------------------------------------------------
 * FACT-episode
 * ----------------------------------------------------------------------------------------------*/

function episodeFact(bundle: EpisodeBundle): ComputedFact | null {
  const notes = sortedNotes(bundle.notes);
  const attended = sortedAppointments(bundle.appointments).filter((a) => a.status === "ATT");
  const contactDates = attended.map((a) => a.date).concat(notes.map((n) => n.date)).sort();
  if (contactDates.length === 0) return null;

  const first = contactDates[0];
  const lastContact = contactDates[contactDates.length - 1];
  const dischargeNotes = notes.filter((n) => n.type === "discharge");
  const discharge = dischargeNotes.length ? dischargeNotes[dischargeNotes.length - 1] : undefined;
  const discharged = bundle.episodeStatus === "discharged";
  const end = discharged ? (discharge?.date ?? lastContact) : lastContact;

  const value = discharged
    ? `${formatUkDate(first)} to ${formatUkDate(end)} (discharged)`
    : `${formatUkDate(first)} to date (episode open; last contact ${formatUkDate(lastContact)})`;

  const parts: string[] = [];
  const incidentDate = bundle.incident?.date;
  if (incidentDate) parts.push(`Incident: ${formatUkDate(incidentDate)}.`);
  if (bundle.referral.referralDate) parts.push(`Referral received: ${formatUkDate(bundle.referral.referralDate)}.`);
  const firstGap = incidentDate ? daysBetween(incidentDate, first) : null;
  parts.push(
    `First appointment: ${formatUkDate(first)}${firstGap !== null && firstGap >= 0 ? ` (${plural(firstGap, "day")} after the incident)` : ""}.`,
  );
  if (attended.length) parts.push(`Last attended appointment: ${formatUkDate(attended[attended.length - 1].date)}.`);
  if (discharge) parts.push(`Discharge note: ${formatUkDate(discharge.date)} (${discharge.id}).`);
  else if (discharged) parts.push("Episode marked as discharged, but no discharge note is recorded.");

  const days = daysBetween(first, end);
  if (days > 0) parts.push(`Duration: ${plural(days, "day")} (${weeksAndDays(days)}).`);

  const byAuthor = notesByAuthor(notes);
  if (notes.length) {
    parts.push(
      `${plural(notes.length, "clinical note")} by ${plural(byAuthor.length, "clinician")}: ${byAuthor
        .map((a) => `${a.name} (${a.hcpc}) ${plural(a.noteIds.length, "note")}`)
        .join("; ")}.`,
    );
  }
  parts.push(`Episode status: ${discharged ? "discharged" : "open"}.`);

  return { id: "FACT-episode", label: "Episode of care", value, detail: parts.join(" ") };
}

/* ------------------------------------------------------------------------------------------------
 * FACT-outcomes-<instrument>
 * ----------------------------------------------------------------------------------------------*/

function outcomeFacts(bundle: EpisodeBundle): ComputedFact[] {
  // Merge series of the same instrument (one fact ID per instrument), keeping first-seen order.
  const order: Instrument[] = [];
  const merged = new Map<Instrument, { unit: string; higherIsWorse: boolean; points: OutcomePoint[] }>();
  for (const series of bundle.outcomeMeasures) {
    if (series.points.length === 0) continue;
    const existing = merged.get(series.instrument);
    if (existing) {
      existing.points = existing.points.concat(series.points);
    } else {
      order.push(series.instrument);
      merged.set(series.instrument, {
        unit: series.unit,
        higherIsWorse: series.higherIsWorse,
        points: series.points.slice(),
      });
    }
  }

  return order.map((instrument) => {
    const m = merged.get(instrument) as { unit: string; higherIsWorse: boolean; points: OutcomePoint[] };
    const points = m.points.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const fmt = (v: number) => formatScore(v, m.unit);
    const better = m.higherIsWorse ? "lower is better" : "higher is better";
    const first = points[0];
    const last = points[points.length - 1];

    const value =
      points.length === 1
        ? `${instrument} ${fmt(first.value)} on ${formatUkDate(first.date)} (single time point)`
        : `${instrument} ${points.map((p) => fmt(p.value)).join(" → ")} (${better})`;

    const listed = points
      .map((p) => `${formatUkDate(p.date)}: ${fmt(p.value)}${p.noteId ? ` (${p.noteId})` : ""}`)
      .join("; ");
    const parts = [`${listed}.`];
    if (points.length > 1) {
      const diff = roundScore(last.value - first.value);
      if (diff === 0) {
        parts.push(`No change from the first to the latest score (${fmt(first.value)}).`);
      } else {
        const improved = m.higherIsWorse ? diff < 0 : diff > 0;
        parts.push(
          `Change from first to latest: ${formatNumber(Math.abs(diff))} ${Math.abs(diff) === 1 ? "point" : "points"} ${diff < 0 ? "lower" : "higher"} (${fmt(first.value)} to ${fmt(last.value)}), ${improved ? "an improvement" : "a deterioration"} (${better} on the ${instrument}).`,
        );
      }
    } else {
      parts.push("Recorded at one time point only, so no change can be calculated.");
    }

    return {
      id: `FACT-outcomes-${instrument}` as const,
      label: `${instrument} – ${OUTCOME_INSTRUMENT_NAMES[instrument]}`,
      value,
      detail: parts.join(" "),
    };
  });
}

/* ------------------------------------------------------------------------------------------------
 * Helpers
 * ----------------------------------------------------------------------------------------------*/

function sortedAppointments(appts: Appointment[]): Appointment[] {
  return appts.slice().sort((a, b) => compareIsoDateTime(a, b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function sortedNotes(notes: Note[]): Note[] {
  return notes.slice().sort((a, b) => compareIsoDateTime(a, b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Note authors in order of first note, de-duplicated by HCPC number (or name). */
export function notesByAuthor(notes: Note[]): Array<{ name: string; hcpc: string; noteIds: string[] }> {
  const out: Array<{ key: string; name: string; hcpc: string; noteIds: string[] }> = [];
  for (const n of notes) {
    const key = authorKey(n.author);
    const existing = out.find((a) => a.key === key);
    if (existing) existing.noteIds.push(n.id);
    else out.push({ key, name: n.author.name, hcpc: n.author.hcpc, noteIds: [n.id] });
  }
  return out.map(({ name, hcpc, noteIds }) => ({ name, hcpc, noteIds }));
}

/** Stable identity of a clinician: HCPC number when present, otherwise the name. */
export function authorKey(c: { name: string; hcpc: string }): string {
  const hcpc = c.hcpc.trim().toUpperCase();
  return hcpc && hcpc !== "NOT RECORDED" ? `hcpc:${hcpc}` : `name:${c.name.trim().toLowerCase()}`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function weeksAndDays(days: number): string {
  const weeks = Math.floor(days / 7);
  const rest = days % 7;
  if (weeks === 0) return plural(rest, "day");
  return rest === 0 ? plural(weeks, "week") : `${plural(weeks, "week")} ${plural(rest, "day")}`;
}

function roundScore(v: number): number {
  return Math.round(v * 10) / 10;
}

function formatNumber(v: number): string {
  const r = roundScore(v);
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/** 42 + "%" → "42%"; 7 + "/10" → "7/10"; 12 + "points" → "12 points"; "" → "12". */
export function formatScore(value: number, unit: string): string {
  const n = formatNumber(value);
  const u = unit.trim();
  if (!u) return n;
  if (u === "%" || u.startsWith("/")) return `${n}${u}`;
  return `${n} ${u}`;
}
