/**
 * Citable sources as text: what "REG", "N-###" and "FACT-*" contain. The AI prompt renders the same
 * texts (ai/prompts.ts), so the validators check a paragraph against exactly what the model saw.
 *
 * Data minimisation: REG never contains the patient's name, date of birth, address or contact details.
 *
 * Pure; browser and server.
 *
 * Owner: ai agent.
 */
import { formatUkDate } from "../dates";
import { INCIDENT_TYPE_LABELS, INSTRUCTING_PARTY_LABELS, NOTE_TYPE_LABELS } from "../labels";
import { REGISTRATION_SOURCE_ID } from "../schemas";
import type { ComputedFact, EpisodeBundle, InstructingParty, Note } from "../types";

const SEX_LABELS: Record<EpisodeBundle["registration"]["sex"], string> = {
  female: "Female",
  male: "Male",
  other: "Other",
  not_recorded: "Not recorded",
};

/** "Sarah Reid (PH-DEMO-01)". */
export function clinicianLabel(c: { name: string; hcpc: string }): string {
  return c.hcpc ? `${c.name} (${c.hcpc})` : c.name;
}

/** Labelled lines of a note's clinical content (only fields that are present and non-empty). */
export function noteFieldLines(note: Note): string[] {
  const fields: Array<[string, string | undefined]> = [
    ["Subjective", note.subjective],
    ["Objective", note.objective],
    ["Assessment", note.assessment],
    ["Plan", note.plan],
    ["Other", note.freeText],
    ["Past medical history", note.pastMedicalHistory],
    ["Social history", note.socialHistory],
  ];
  return fields.filter(([, v]) => v !== undefined && v.trim() !== "").map(([k, v]) => `${k}: ${(v ?? "").trim()}`);
}

/** Header line of a note: date, type and author (so "On 18/03/2026 Sarah Reid recorded…" is checkable). */
export function noteHeader(note: Note): string {
  const role = note.author.role ? `, ${note.author.role}` : "";
  return `${note.id} · ${formatUkDate(note.date)} · ${NOTE_TYPE_LABELS[note.type]} · ${clinicianLabel(note.author)}${role}`;
}

/** Full text of a note source. */
export function noteSourceText(note: Note): string {
  return [noteHeader(note), ...noteFieldLines(note)].join("\n");
}

/** Text of a computed fact source. */
export function factSourceText(fact: ComputedFact): string {
  return `${fact.id} · ${fact.label}: ${fact.value}. ${fact.detail}`;
}

/**
 * The registration / referral record ("REG") as the AI sees it: no name, date of birth, address or
 * contact details. Age comes from FACT-age when available.
 */
export function registrationLines(
  bundle: EpisodeBundle,
  computedFacts: ComputedFact[],
  instructingParty: InstructingParty = bundle.referral,
): string[] {
  const reg = bundle.registration;
  const age = computedFacts.find((f) => f.id === "FACT-age");
  const lines = [`Claimant: [CLAIMANT] (name withheld)`, `Sex: ${SEX_LABELS[reg.sex]}`];
  if (age) lines.push(`Age: ${age.value} (see FACT-age)`);
  if (reg.occupation) lines.push(`Occupation: ${reg.occupation}`);
  lines.push(
    `Instructing party: ${instructingParty.name} (${INSTRUCTING_PARTY_LABELS[instructingParty.type].toLowerCase()})`,
  );
  if (bundle.referral.referralDate) lines.push(`Referral received: ${formatUkDate(bundle.referral.referralDate)}`);
  if (bundle.referral.reason?.trim()) lines.push(`Referral reason: ${bundle.referral.reason.trim()}`);
  if (bundle.incident) {
    const date = bundle.incident.date ? formatUkDate(bundle.incident.date) : "date not recorded";
    lines.push(`Incident: ${date} – ${INCIDENT_TYPE_LABELS[bundle.incident.type]} – ${bundle.incident.mechanism.trim()}`);
  }
  lines.push(
    bundle.consent.disclosureConsentRecorded
      ? `Consent to disclosure: recorded${bundle.consent.date ? ` on ${formatUkDate(bundle.consent.date)}` : ""}`
      : "Consent to disclosure: not recorded",
  );
  lines.push(`Episode status: ${bundle.episodeStatus}`);
  return lines;
}

export function registrationSourceText(
  bundle: EpisodeBundle,
  computedFacts: ComputedFact[],
  instructingParty?: InstructingParty,
): string {
  return [REGISTRATION_SOURCE_ID, ...registrationLines(bundle, computedFacts, instructingParty)].join("\n");
}

/**
 * Map of every citable ID to its source text. Pass the SCOPED bundle (core/scope.ts) so fields the
 * template excludes are not counted as sources.
 */
export function buildSourceTexts(
  bundle: EpisodeBundle,
  computedFacts: ComputedFact[],
  instructingParty?: InstructingParty,
): Map<string, string> {
  const map = new Map<string, string>();
  map.set(REGISTRATION_SOURCE_ID, registrationSourceText(bundle, computedFacts, instructingParty));
  for (const note of bundle.notes) map.set(note.id, noteSourceText(note));
  for (const fact of computedFacts) map.set(fact.id, factSourceText(fact));
  return map;
}
