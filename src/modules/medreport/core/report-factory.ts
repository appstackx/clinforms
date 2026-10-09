/**
 * Report factory: builds a new Report from a template + bundle, fills the "from records" sections in
 * code (never AI), plans the draft groups and merges /drafts results. Pure; used by the Studio
 * (new report, batch) and available to the server.
 *
 * Owner: ai agent (content of the from-records paragraphs may be refined). Signatures are final.
 * Baseline implementation by the foundation.
 */
import { DEMO_CLINIC, MAX_FORM_FIELDS_PER_DRAFT, MAX_SECTIONS_PER_DRAFT } from "../config.public";
import { ageOn, compareIsoDateTime, formatUkDate, nowIso, todayIso } from "./dates";
import {
  answerKindFor,
  answerableFields,
  asksForReferralPartyReference,
  formRefOf,
  formToTemplate,
  isFormReport,
  referrerNamesMatch,
  resolveComputedFactValue,
  resolveRegistrationValue,
  sectionKindForFillSource,
  toFormAnswer,
  type ResolvedFormValue,
} from "./forms";
import { createId } from "./ids";
import { WORDING } from "./wording";
import { APPOINTMENT_STATUS_LABELS, INSTRUCTING_PARTY_LABELS, INSTRUMENT_LABELS } from "./labels";
import type {
  ActivityEntry,
  Clinician,
  ComputedFact,
  EpisodeBundle,
  FactId,
  FormDefinition,
  FormField,
  Gap,
  GenerationMeta,
  InstructingParty,
  Paragraph,
  Report,
  ReportFlag,
  ReportSection,
  ReportTemplate,
  TemplateSection,
} from "./types";

/** Activity actions the Studio records. `ActivityEntry.action` is an open string; prefer these. */
export const KNOWN_ACTIVITY_ACTIONS = [
  "created",
  "drafted",
  "draft_failed",
  "edited",
  "paragraph_added",
  "gap_resolved",
  "gap_acknowledged",
  "flag_acknowledged",
  "validated",
  "signed",
  "rendered",
  "filed",
  "exported",
  // Referrer forms (Revision 2)
  "answer_set",
  "previewed",
  "approved",
  // Amendments after issue
  "amendment_started",
  "superseded",
] as const;
export type KnownActivityAction = (typeof KNOWN_ACTIVITY_ACTIONS)[number];

export interface CreateReportInput {
  template: ReportTemplate;
  /** The unscoped bundle; stored as `bundleSnapshot`. */
  bundle: EpisodeBundle;
  instructingParty: InstructingParty;
  computedFacts: ComputedFact[];
  /** Include optional sections (e.g. the CPR Part 35-style declaration). Default true. */
  includeOptionalSections?: boolean;
  id?: string;
  now?: Date;
  actor?: string;
}

/** Anything shaped like a POST /drafts response. */
export interface DraftResultLike {
  sections: ReportSection[];
  gaps: Gap[];
  flags: ReportFlag[];
  generation: GenerationMeta;
}

/** Sections the AI drafts (narrative) or attributes (recorded opinion). */
export function isDraftableKind(kind: TemplateSection["kind"]): boolean {
  return kind === "ai_narrative" || kind === "clinician_opinion";
}

/**
 * Create a new draft report. From-records and declaration sections are filled now; narrative and
 * opinion sections start "pending" and are filled by POST /drafts (see planDraftGroups).
 */
export function createReport(input: CreateReportInput): Report {
  const now = input.now ?? new Date();
  const at = nowIso(now);
  const includeOptional = input.includeOptionalSections ?? true;
  const { template, bundle } = input;
  const sections: ReportSection[] = template.sections
    .filter((s) => s.required || includeOptional)
    .map((s) => buildSection(s, input, now));

  return {
    id: input.id ?? createId("rpt"),
    tenantId: bundle.tenantId,
    templateId: template.id,
    templateVersion: template.version,
    patientLabel: bundle.registration.fullName,
    episodeRef: {
      connectorId: bundle.source.connectorId,
      patientId: bundle.source.externalPatientId,
      episodeId: bundle.source.externalEpisodeId,
    },
    instructingParty: input.instructingParty,
    bundleSnapshot: bundle,
    sections,
    gaps: [],
    flags: [],
    status: "draft",
    generation: [],
    activity: [
      {
        at,
        actor: input.actor ?? "System",
        action: "created",
        detail: `Report created from ${bundle.source.label ?? bundle.source.connectorId} using "${template.name}" v${template.version}.`,
      },
    ],
    createdAt: at,
    updatedAt: at,
  };
}

/**
 * Section keys to draft, in template order, grouped into /drafts calls of 1–MAX_SECTIONS_PER_DRAFT
 * sections (built-in templates; groups as even as possible, so parallel calls finish together).
 *
 * Form reports: up to MAX_FORM_FIELDS_PER_DRAFT answerable fields per call, in the form's own order
 * (neighbouring questions of one form section are drafted together), where a long narrative answer
 * drafted from the notes counts double – it is most of a call's output, and two of them already take
 * ~20 s – so every call stays well inside the route's time limit.
 */
export function planDraftGroups(report: Report, template: ReportTemplate): string[][] {
  const present = new Set(report.sections.map((s) => s.key));
  const specs = template.sections.filter((s) => isDraftableKind(s.kind) && present.has(s.key));
  const keys = specs.map((s) => s.key);
  if (isFormReport(report)) {
    const weight = (s: TemplateSection) => (s.kind === "ai_narrative" && s.answerType === "long_text" ? 2 : 1);
    const groups: string[][] = [];
    let current: string[] = [];
    let load = 0;
    for (const spec of specs) {
      const w = weight(spec);
      if (current.length > 0 && load + w > MAX_FORM_FIELDS_PER_DRAFT) {
        groups.push(current);
        current = [];
        load = 0;
      }
      current.push(spec.key);
      load += w;
    }
    if (current.length > 0) groups.push(current);
    return groups;
  }
  const size = MAX_SECTIONS_PER_DRAFT;
  const count = Math.ceil(keys.length / size);
  const groups: string[][] = [];
  let start = 0;
  for (let g = 0; g < count; g += 1) {
    const take = Math.ceil((keys.length - start) / (count - g));
    groups.push(keys.slice(start, start + take));
    start += take;
  }
  return groups;
}

/**
 * Merge one /drafts result into the report (immutable). Replaces the drafted sections, replaces their
 * unresolved gaps (resolved ones are kept), replaces their flags, appends the generation meta and an
 * activity entry.
 */
export function applyDraftResult(report: Report, draft: DraftResultLike, opts: { now?: Date } = {}): Report {
  const at = nowIso(opts.now);
  const draftedKeys = new Set(draft.sections.map((s) => s.key));
  const sections = report.sections.map((s) => {
    const drafted = draft.sections.find((d) => d.key === s.key);
    if (!drafted) return s;
    const merged: ReportSection = { ...drafted, title: s.title, kind: s.kind };
    if (s.fieldId) merged.fieldId = s.fieldId;
    const answer = drafted.answer ?? s.answer;
    if (answer) merged.answer = answer;
    return merged;
  });
  const gaps = [...report.gaps.filter((g) => !draftedKeys.has(g.sectionKey) || g.resolution), ...draft.gaps];
  const flags = [
    ...report.flags.filter((f) => !f.sectionKey || !draftedKeys.has(f.sectionKey)),
    ...draft.flags,
  ];
  return appendActivity(
    { ...report, sections, gaps, flags, generation: [...report.generation, draft.generation], updatedAt: at },
    {
      action: "drafted",
      detail: WORDING.drafting.activityDrafted(Array.from(draftedKeys), draft.generation.mode, draft.generation.model),
      actor: "System",
    },
    opts.now,
  );
}

/** Append an activity entry and bump `updatedAt` (immutable). */
export function appendActivity(
  report: Report,
  entry: Omit<ActivityEntry, "at"> & { at?: string },
  now?: Date,
): Report {
  const at = entry.at ?? nowIso(now);
  return { ...report, activity: [...report.activity, { ...entry, at }], updatedAt: at };
}

/* ------------------------------------------------------------------------------------------------
 * Referrer forms (Revision 2)
 * ----------------------------------------------------------------------------------------------*/

export interface CreateFormReportInput {
  /** The referrer's form map (normally status "confirmed"). */
  form: FormDefinition;
  /** The unscoped bundle; stored as `bundleSnapshot`. */
  bundle: EpisodeBundle;
  /** Normally the episode's referral (who instructed the work); may differ from form.referrer. */
  instructingParty: InstructingParty;
  computedFacts: ComputedFact[];
  /** Treating clinician for clinician.* fields (default: the clinician who wrote most notes). */
  clinician?: Clinician;
  id?: string;
  now?: Date;
  actor?: string;
}

/**
 * Create a draft report that completes a referrer's own form: one section per answerable field
 * (key = field ID). Registration and computed-fact fields are filled now by CODE (origin
 * "from_records", sourceIds "REG"/"FACT-…"); a value the record does not hold is left blank with a
 * system gap (never guessed). Narrative and opinion fields start "pending" for POST /drafts; sign-off
 * fields are filled from the approval receipt at render time.
 */
export function createFormReport(input: CreateFormReportInput): Report {
  const now = input.now ?? new Date();
  const at = nowIso(now);
  const { form, bundle } = input;
  const template = formToTemplate(form);
  const ctx = {
    bundle,
    instructingParty: input.instructingParty,
    computedFacts: input.computedFacts,
    clinician: input.clinician,
    reportDate: todayIso(now),
  };

  const sections: ReportSection[] = [];
  const gaps: Gap[] = [];
  for (const field of answerableFields(form)) {
    const kind = sectionKindForFillSource(field.fillSource);
    if (!kind) continue;
    const base: Pick<ReportSection, "key" | "title" | "kind" | "fieldId"> = {
      key: field.id,
      title: field.label,
      kind,
      fieldId: field.id,
    };
    const structured = answerKindFor(field.answerType) !== "text";
    const src = field.fillSource;

    if (src.kind === "registration" || src.kind === "computed_fact") {
      const resolved: ResolvedFormValue | null =
        src.kind === "registration"
          ? resolveRegistrationValue(src.path, ctx, field.answerType)
          : resolveComputedFactValue(src.factId, src.format, ctx, field.answerType);
      const answer = structured ? toFormAnswer(field, resolved) : undefined;
      const usable = resolved !== null && (!answer || answer.value !== null);

      // A referral's reference or name belongs to the organisation that referred. On a form from a
      // different organisation it is copied in only when the question asks for the referral party's
      // reference; otherwise it is left blank for staff to enter the issuer's own number (a wrong claim
      // number on an insurer's form is worse than a blank one).
      const referralValue = src.kind === "registration" && (src.path === "referral.reference" || src.path === "referral.referrerName");
      const otherOrganisation = referralValue && !referrerNamesMatch(form.referrer.name, input.instructingParty.name);
      if (otherOrganisation && !asksForReferralPartyReference(field, input.instructingParty, form.referrer.name)) {
        sections.push({ ...base, status: field.required ? "needs_input" : "complete", paragraphs: [], ...(answer && { answer: { kind: answer.kind, value: null } }) });
        if (field.required) gaps.push(otherReferrerGap(field, resolved?.text ?? null, input.instructingParty.name, form.referrer.name));
        continue;
      }
      if (usable && resolved) {
        sections.push({
          ...base,
          status: "complete",
          paragraphs: [recordParagraph(field.id, 0, answer ? answerText(field, resolved) : resolved.text, resolved.sourceIds)],
          ...(answer && { answer }),
        });
      } else {
        sections.push({ ...base, status: "needs_input", paragraphs: [], ...(answer && { answer }) });
        gaps.push(missingValueGap(field, src.kind === "registration" ? src.path : src.factId, resolved?.text));
      }
      continue;
    }

    if (src.kind === "signoff") {
      // Filled from the server-signed receipt on approval; blank on a DRAFT.
      sections.push({ ...base, status: "complete", paragraphs: [] });
      continue;
    }

    // notes_narrative / clinician_opinion → drafted by POST /drafts.
    sections.push({
      ...base,
      status: "pending",
      paragraphs: [],
      ...(structured && { answer: { kind: answerKindFor(field.answerType), value: null } }),
    });
  }

  return {
    id: input.id ?? createId("rpt"),
    tenantId: bundle.tenantId,
    templateId: template.id,
    templateVersion: template.version,
    patientLabel: bundle.registration.fullName,
    episodeRef: {
      connectorId: bundle.source.connectorId,
      patientId: bundle.source.externalPatientId,
      episodeId: bundle.source.externalEpisodeId,
    },
    instructingParty: input.instructingParty,
    bundleSnapshot: bundle,
    sections,
    gaps,
    flags: [],
    status: "draft",
    generation: [],
    activity: [
      {
        at,
        actor: input.actor ?? "System",
        action: "created",
        detail: `Started completing ${form.referrer.name}'s form "${form.title}" from ${bundle.source.label ?? bundle.source.connectorId}.`,
      },
    ],
    createdAt: at,
    updatedAt: at,
    form: formRefOf(form),
    ...(input.clinician ? { author: input.clinician } : {}),
  };
}

/** Text shown for a structured from-records answer (the value as written on the form). */
function answerText(field: FormField, resolved: ResolvedFormValue): string {
  const answer = toFormAnswer(field, resolved);
  if (answer.kind === "date" && typeof answer.value === "string") return formatUkDate(answer.value);
  if (answer.kind === "choice" && typeof answer.value === "string") return answer.value;
  return resolved.text;
}

function otherReferrerGap(field: FormField, value: string | null, referralFrom: string, formFrom: string): Gap {
  return {
    id: `gap-${field.id}-referrer`,
    sectionKey: field.id,
    issue: value
      ? `${formFrom} uses its own reference for “${field.label}”. The referral from ${referralFrom} gives “${value}”, which is ${referralFrom}'s reference, so it has not been copied in.`
      : `${formFrom} uses its own reference for “${field.label}”, and the clinic record does not hold it.`,
    suggestedQuestion: `What is ${formFrom}'s own reference for this case? It is usually on their instruction letter.${value ? ` If they asked for the referral's reference, use “${value}”.` : ""}`,
    relatedNoteIds: [],
    raisedBy: "system",
  };
}

function missingValueGap(field: FormField, what: string, unmatched?: string): Gap {
  return {
    id: `gap-${field.id}-record`,
    sectionKey: field.id,
    issue: unmatched
      ? `The record's value for “${field.label}” (“${unmatched}”) does not fit the form's answer options, so it has been left blank.`
      : `The record does not hold a value for “${field.label}” (${what}), so it has been left blank.`,
    suggestedQuestion: `What should be entered for “${field.label}”? Check the patient's registration details in the clinic system.`,
    relatedNoteIds: [],
    raisedBy: "system",
  };
}

/* ------------------------------------------------------------------------------------------------
 * From-records content (code only, never AI)
 * ----------------------------------------------------------------------------------------------*/

function buildSection(spec: TemplateSection, input: CreateReportInput, now: Date): ReportSection {
  const base = { key: spec.key, title: spec.title, kind: spec.kind };
  if (spec.kind === "declaration") {
    return {
      ...base,
      status: "complete",
      paragraphs: [recordParagraph(spec.key, 0, input.template.declarationText, [])],
    };
  }
  if (spec.kind === "from_records") {
    const texts = fromRecordsTexts(spec.key, input, now);
    return {
      ...base,
      status: texts.length > 0 ? "complete" : "pending",
      paragraphs: texts.map((t, i) => recordParagraph(spec.key, i, t.text, t.sourceIds)),
    };
  }
  return { ...base, status: "pending", paragraphs: [] };
}

function recordParagraph(sectionKey: string, index: number, text: string, sourceIds: string[]): Paragraph {
  return { id: `${sectionKey}-r${index + 1}`, text, sourceIds, origin: "from_records", basis: "record" };
}

type Line = { text: string; sourceIds: string[] };

function factIds(facts: ComputedFact[], ...ids: FactId[]): string[] {
  const have = new Set<string>(facts.map((f) => f.id));
  return ids.filter((id) => have.has(id));
}

function fromRecordsTexts(key: string, input: CreateReportInput, now: Date): Line[] {
  const { bundle, instructingParty: party, computedFacts: facts } = input;
  const reg = bundle.registration;
  const ref = party.reference ? `, reference ${party.reference}` : "";
  const notes = [...bundle.notes].sort(compareIsoDateTime);
  const firstNote = notes[0];
  const lastNote = notes[notes.length - 1];
  const authors = Array.from(new Set(notes.map((n) => `${n.author.name} (HCPC ${n.author.hcpc})`)));

  switch (key) {
    case "introduction":
      return [
        {
          text:
            `This report has been prepared at the request of ${party.name} (${INSTRUCTING_PARTY_LABELS[party.type].toLowerCase()})${ref}. ` +
            `It concerns ${reg.fullName}, who received physiotherapy at ${DEMO_CLINIC.name}` +
            (bundle.incident?.date ? ` following an incident on ${formatUkDate(bundle.incident.date)}` : "") +
            ". It is based solely on the clinic's records of that episode of care, which are listed under Records reviewed.",
          sourceIds: ["REG", ...factIds(facts, "FACT-episode")],
        },
      ];

    case "claimant_details":
    case "employee_details": {
      const lines: Line[] = [
        { text: `Name: ${reg.fullName}`, sourceIds: ["REG"] },
        { text: `Date of birth: ${formatUkDate(reg.dob)}`, sourceIds: ["REG"] },
        {
          text: `Age at the date of this report: ${ageOn(reg.dob, todayIso(now))} years`,
          sourceIds: ["REG", ...factIds(facts, "FACT-age")],
        },
      ];
      if (reg.occupation) lines.push({ text: `Occupation: ${reg.occupation}`, sourceIds: ["REG"] });
      if (reg.employer) lines.push({ text: `Employer: ${reg.employer}`, sourceIds: ["REG"] });
      return lines;
    }

    case "records_reviewed":
      if (!firstNote || !lastNote) return [{ text: "No clinical notes were available for review.", sourceIds: [] }];
      return [
        {
          text:
            `The clinic's records for this episode were reviewed: ${notes.length} clinical note${notes.length === 1 ? "" : "s"} ` +
            `dated ${formatUkDate(firstNote.date)} to ${formatUkDate(lastNote.date)} (notes by ${authors.join(" and ")}), ` +
            `the appointment history (${bundle.appointments.length} appointment${bundle.appointments.length === 1 ? "" : "s"}) ` +
            `and ${bundle.outcomeMeasures.length} outcome measure series. Every record is listed in the appendix.`,
          sourceIds: factIds(facts, "FACT-episode"),
        },
      ];

    case "attendance": {
      const fact = facts.find((f) => f.id === "FACT-attendance");
      if (fact) return [{ text: `${fact.value}. ${fact.detail}`, sourceIds: [fact.id] }];
      const counts = new Map<string, number>();
      for (const a of bundle.appointments) counts.set(a.status, (counts.get(a.status) ?? 0) + 1);
      const parts = Array.from(counts.entries()).map(
        ([status, n]) => `${APPOINTMENT_STATUS_LABELS[status as keyof typeof APPOINTMENT_STATUS_LABELS]}: ${n}`,
      );
      return [{ text: `Appointments: ${bundle.appointments.length}. ${parts.join("; ")}.`, sourceIds: [] }];
    }

    case "outcome_measures":
      if (bundle.outcomeMeasures.length === 0) {
        return [{ text: "No outcome measures were recorded during this episode.", sourceIds: [] }];
      }
      return bundle.outcomeMeasures.map((series) => {
        const factId = `FACT-outcomes-${series.instrument}` as FactId;
        const fact = facts.find((f) => f.id === factId);
        const pts = [...series.points].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
        const text =
          fact?.detail ??
          `${INSTRUMENT_LABELS[series.instrument]}: ` +
            pts.map((p) => `${p.value}${series.unit} (${formatUkDate(p.date)})`).join(" → ") +
            (series.higherIsWorse ? "; lower scores are better." : "; higher scores are better.");
        return { text, sourceIds: fact ? [fact.id] : [] };
      });

    case "purpose_consent":
      return [
        {
          text: `This report was requested by ${party.name}${ref} to inform decisions about ${reg.fullName}'s fitness for work.`,
          sourceIds: ["REG"],
        },
        {
          text: bundle.consent.disclosureConsentRecorded
            ? `Consent to disclose this report to the employer was recorded${bundle.consent.date ? ` on ${formatUkDate(bundle.consent.date)}` : ""}.`
            : "Consent to disclose this report to the employer is not recorded in the clinical record.",
          sourceIds: ["REG"],
        },
      ];

    default:
      return [];
  }
}
