/**
 * Report factory: builds a new Report from a template + bundle, fills the "from records" sections in
 * code (never AI), plans the draft groups and merges /drafts results. Pure; used by the Studio
 * (new report, batch) and available to the server.
 *
 * Owner: ai agent (content of the from-records paragraphs may be refined). Signatures are final.
 * Baseline implementation by the foundation.
 */
import { MAX_FORM_FIELDS_PER_DRAFT, MAX_FORM_ROW_FIELDS_PER_DRAFT, MAX_SECTIONS_PER_DRAFT } from "../config.public";
import { bundleClinic } from "./clinic";
import { ageOn, compareIsoDateTime, formatUkDate, nowIso, todayIso } from "./dates";
import {
  answerKindFor,
  answerableFields,
  formRefOf,
  reportKindOf,
  formToTemplate,
  isFormReport,
  isSectionAnswered,
  referrerNamesMatch,
  resolveComputedFactValue,
  recordSourceOf,
  resolveRegistrationValue,
  sectionKindForFillSource,
  toFormAnswer,
  type ResolvedFormValue,
} from "./forms";
import { fixedValueGap, mayCopyReferralPartyReference, resolveFixedValue, withheldInsurerIdentifier } from "./form-record-rules";
import { conditionTextOf, notApplicable, sessionNotInRecord, sessionNumberOf } from "./conditions";
import { buildAppointmentsTableSection } from "./form-tables";
import { namedThing, possessive } from "./possessive";
import { createId } from "./ids";
import { WORDING } from "./wording";
import { APPOINTMENT_STATUS_LABELS, INSTRUCTING_PARTY_LABELS, INSTRUMENT_LABELS, staffEntryVerb, type RecordSource } from "./labels";

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
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
 *
 * Fix round 2 (B1-4): with `form` – a clinic's own form, not a bundled sample (whose recordings keep their groups) – the
 * numbered rows of one table ("Activity 1"… "Activity 2 – comments", up to MAX_FORM_ROW_FIELDS_PER_DRAFT short cells)
 * are drafted in one call, so each row takes a different item.
 */
export function planDraftGroups(report: Report, template: ReportTemplate, opts: { form?: Pick<FormDefinition, "fields" | "builtIn" | "sampleId"> | null } = {}): string[][] {
  // Fix round 2 (B1-11): a numbered session the record does not have is not drafted (no gap, nothing printed).
  // Fix round 3 (B2-19): nor a question filled by code at creation (the attended session dates).
  const present = new Set(report.sections.filter((s) => !isFormReport(report) || (!notApplicable(report, s.key) && s.kind !== "from_records")).map((s) => s.key));
  const specs = template.sections.filter((s) => isDraftableKind(s.kind) && present.has(s.key));
  const keys = specs.map((s) => s.key);
  if (isFormReport(report)) {
    const weight = (s: TemplateSection) => (s.kind === "ai_narrative" && s.answerType === "long_text" ? 2 : 1);
    const runs = opts.form && !opts.form.builtIn && !opts.form.sampleId ? numberedRowRuns(specs, opts.form.fields) : new Map<string, string[]>();
    const groups: string[][] = [];
    let current: string[] = [];
    let load = 0;
    for (let i = 0; i < specs.length; i += 1) {
      const spec = specs[i];
      const run = runs.get(spec.key);
      if (run) {
        if (current.length > 0) groups.push(current);
        groups.push(run);
        current = [];
        load = 0;
        i += run.length - 1;
        continue;
      }
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

/** The table a Word anchor writes into ("t4.r2.c0" → "t4", "t0.r25.c0.t0.r2.c1" → "t0.r25.c0.t0"), or null. */
function tableOfAnchor(field: Pick<FormField, "anchor"> | undefined): string | null {
  if (!field || field.anchor.kind !== "docx") return null;
  return /^(.*t\d+)\.r\d+\.c\d+(?:\.p\d+)?$/.exec(field.anchor.blockId)?.[1] ?? null;
}

/**
 * Runs of draftable questions, consecutive in the form, that are the numbered rows of one table ("Activity 1",
 * "Activity 1 – frequency", "Activity 2"…): at least two row numbers, short answers, at most
 * MAX_FORM_ROW_FIELDS_PER_DRAFT questions. Keyed by the run's first question.
 */
function numberedRowRuns(specs: readonly TemplateSection[], fields: readonly FormField[]): Map<string, string[]> {
  const byId = new Map(fields.map((f) => [f.id, f]));
  const rowOf = (spec: TemplateSection) => {
    const field = byId.get(spec.key);
    const n = /^.*?\b(\d{1,2})\b\D*$/.exec(spec.title.trim())?.[1];
    const table = tableOfAnchor(field);
    return n && table && field?.answerType === "short_text" ? { table, n: Number(n) } : null;
  };
  const out = new Map<string, string[]>();
  let i = 0;
  while (i < specs.length) {
    const first = rowOf(specs[i]);
    let j = i + 1;
    if (first) while (j < specs.length && rowOf(specs[j])?.table === first.table) j += 1;
    const run = specs.slice(i, j);
    const numbers = new Set(run.map((s) => rowOf(s)?.n));
    if (first && numbers.size >= 2 && run.length <= MAX_FORM_ROW_FIELDS_PER_DRAFT) out.set(run[0].key, run.map((s) => s.key));
    i = j;
  }
  return out;
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
    // Fix round 3 (B2-4): the condition it carries in its heading or guidance, and a person's "not applicable" mark, stay
    // with the question when it is drafted (they were dropped, so "Only when the lifting restriction is kept" never held).
    if (s.condition) merged.condition = s.condition;
    if (s.markedNotApplicable) merged.markedNotApplicable = s.markedNotApplicable;
    const answer = drafted.answer ?? s.answer;
    if (answer) merged.answer = answer;
    return merged;
  });
  const gaps = [...report.gaps.filter((g) => !draftedKeys.has(g.sectionKey) || g.resolution), ...draft.gaps];
  const flags = [
    ...report.flags.filter((f) => !f.sectionKey || !draftedKeys.has(f.sectionKey)),
    ...draft.flags,
  ];
  // Fix round 2 (B1-19): the activity log names the questions that received an answer, and those left for the clinician.
  const answered = draft.sections.filter((d) => isSectionAnswered(d)).map((d) => d.key);
  const left = draft.sections.map((d) => d.key).filter((k) => answered.indexOf(k) < 0);
  return appendActivity(
    { ...report, sections, gaps, flags, generation: [...report.generation, draft.generation], updatedAt: at },
    {
      action: "drafted",
      detail: WORDING.drafting.activityDrafted(answered, draft.generation.mode, draft.generation.model, left),
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
  /**
   * Fix wave 2: the clinician who will sign – drafts speak in their first person about their own notes and name
   * everyone else (report.author). Default: `clinician`. null = nobody named: drafts in the third person.
   */
  author?: Clinician | null;
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
  // Fix round 3 (B2-24): numbered sessions the record does not have, by why – one activity entry says so.
  const noSessions = new Map<string, string[]>();
  for (const field of answerableFields(form)) {
    const kind = sectionKindForFillSource(field.fillSource);
    if (!kind) continue;
    // Fix round 2 (B1-9): the printed condition it carries outside its label (its heading or guidance).
    const condition = conditionTextOf(field, form.fields);
    const base: Pick<ReportSection, "key" | "title" | "kind" | "fieldId" | "condition"> = {
      key: field.id,
      title: field.label,
      kind,
      fieldId: field.id,
      ...(condition ? { condition } : {}),
    };
    // Fix round 2 (B1-11): a numbered session the record does not have ("Session date 7" after 5 attended) – nothing to
    // ask anyone (no gap), nothing printed; not drafted (planDraftGroups).
    const noSuchSession = notApplicable({ sections: [{ ...base }], bundleSnapshot: bundle }, field.id) !== null;
    if (noSuchSession) {
      const why = sessionNotInRecord(base, bundle) ?? "";
      noSessions.set(why, [...(noSessions.get(why) ?? []), field.id]);
    }
    const structured = answerKindFor(field.answerType) !== "text";
    const src = field.fillSource;

    if (src.kind === "appointments_table") {
      // A table filled by code from the attended appointments (core/form-tables.ts).
      const table = buildAppointmentsTableSection(field, src.columns, ctx, base);
      sections.push(table.section);
      if (table.gap) gaps.push(table.gap);
      continue;
    }

    if (src.kind === "registration" || src.kind === "computed_fact" || src.kind === "fixed") {
      const resolved: ResolvedFormValue | null =
        src.kind === "registration"
          ? resolveRegistrationValue(src.path, ctx, field.answerType, src.part)
          : src.kind === "computed_fact"
            ? resolveComputedFactValue(src.factId, src.format, ctx, field.answerType)
            : resolveFixedValue(field, src.value);
      const answer = structured ? toFormAnswer(field, resolved) : undefined;
      const usable = resolved !== null && (!answer || answer.value !== null);

      // A referral's reference or name belongs to the organisation that referred. On a form from a
      // different organisation it is copied in only when the question asks for the referral party's
      // reference (by name or "instructing …" when both are the same kind of organisation – see
      // core/form-record-rules.ts); otherwise it is left blank for staff to enter the issuer's own number
      // (a wrong claim number on an insurer's form is worse than a blank one).
      const referralValue = src.kind === "registration" && (src.path === "referral.reference" || src.path === "referral.referrerName");
      const otherOrganisation = referralValue && !referrerNamesMatch(form.referrer.name, input.instructingParty.name);
      if (otherOrganisation && !mayCopyReferralPartyReference(field, input.instructingParty, form.referrer)) {
        sections.push({ ...base, status: field.required ? "needs_input" : "complete", paragraphs: [], ...(answer && { answer: { kind: answer.kind, value: null } }) });
        if (field.required) gaps.push(otherReferrerGap(field, resolved?.text ?? null, input.instructingParty.name, form.referrer.name));
        continue;
      }
      // An insurer's membership or authorisation number goes only onto that insurer's own form.
      const withheld =
        src.kind === "registration" ? withheldInsurerIdentifier({ form, field, path: src.path, bundle }) : null;
      if (withheld) {
        sections.push({ ...base, status: field.required ? "needs_input" : "complete", paragraphs: [], ...(answer && { answer: { kind: answer.kind, value: null } }) });
        if (field.required) gaps.push(withheld.gap);
        continue;
      }
      if (resolved?.blank) {
        // 10/2026: an address line the record does not have – answered as nothing (the merge code is removed).
        sections.push({ ...base, status: "complete", paragraphs: [], blankFromRecords: true });
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
        sections.push({ ...base, status: noSuchSession ? "complete" : "needs_input", paragraphs: [], ...(answer && { answer }) });
        if (!noSuchSession) {
          gaps.push(
            src.kind === "fixed"
              ? fixedValueGap(field, src.value)
              : missingValueGap(field, src.kind === "registration" ? src.path : src.factId, resolved?.text),
          );
        }
      }
      continue;
    }

    if (src.kind === "signoff") {
      // Filled from the server-signed receipt on approval; blank on a DRAFT.
      sections.push({ ...base, status: "complete", paragraphs: [] });
      continue;
    }

    // Fix round 3 (B2-19): the attended session dates the record holds ("Session date 4", "Dates of the treatment
    // sessions") are filled by code from the appointments, in date order – never drafted (one was left out, a list was
    // out of order). Not on an initial assessment form (the record is as at that assessment).
    const byCode = !noSuchSession && src.kind === "notes_narrative" && reportKindOf(form.title) !== "initial" ? sessionDatesByCode(field, bundle, input.computedFacts, condition) : null;
    if (byCode) {
      sections.push({ ...base, kind: "from_records", status: "complete", paragraphs: [recordParagraph(field.id, 0, byCode.text, byCode.sourceIds)], ...(byCode.answer && { answer: byCode.answer }) });
      continue;
    }

    // notes_narrative / clinician_opinion → drafted by POST /drafts (a session the record does not have: never).
    sections.push({
      ...base,
      status: noSuchSession ? "complete" : "pending",
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
        detail: `Started completing ${namedThing(form.referrer.name, `form "${form.title}"`)} from ${bundle.source.label ?? bundle.source.connectorId}.`,
      },
      ...Array.from(noSessions.entries()).map(([why, keys]) => ({
        at,
        actor: "System",
        action: "edited",
        detail: `Not applicable: ${keys.join(", ")}${why ? ` – ${why}` : ""}, so nothing is printed there.`,
      })),
    ],
    createdAt: at,
    updatedAt: at,
    form: formRefOf(form),
    ...(authorOf(input) ? { author: authorOf(input) as Clinician } : {}),
  };
}

/**
 * Fix round 3 (B2-19): a session-date question the record answers – the Nth attended session's date ("Session date 4",
 * "Treatment date 2", "Session 3 – date"; counted after the assessment when its guidance says so) or every attended
 * session's date in order ("Dates of the treatment sessions", "Treatment session dates") – or null (not such a
 * question, or the record has no such session).
 */
export function sessionDatesByCode(
  field: Pick<FormField, "label" | "guidance" | "answerType">,
  bundle: Pick<EpisodeBundle, "appointments">,
  facts: readonly ComputedFact[],
  condition: string | null = null,
): { text: string; sourceIds: string[]; answer?: ReportSection["answer"] } | null {
  const attended = bundle.appointments.filter((a) => a.status === "ATT").sort(compareIsoDateTime);
  if (attended.length === 0) return null;
  const after = /\bafter the (?:initial )?assessment\b/i.test(`${field.guidance ?? ""} ${condition ?? ""}`);
  const sessions = after ? attended.slice(1) : attended;
  const cite = (list: typeof attended) => {
    const notes = Array.from(new Set(list.map((a) => a.noteId).filter((id): id is string => Boolean(id))));
    return notes.length > 0 ? notes : facts.some((f) => f.id === "FACT-attendance") ? ["FACT-attendance"] : [];
  };
  const n = sessionNumberOf(field.label);
  if (n !== null && field.answerType === "date" && /\bdate\b/i.test(field.label)) {
    const appt = sessions[n - 1];
    return appt ? { text: formatUkDate(appt.date), sourceIds: cite([appt]), answer: { kind: "date", value: appt.date } } : null;
  }
  const list = /^(?:(?:the )?dates? of (?:the |all |every )?(?:attended )?(?:treatment )?(?:sessions?|treatments?)|(?:attended )?treatment session dates?)\b/i.test(field.label.trim());
  if (!list || (field.answerType !== "long_text" && field.answerType !== "short_text") || sessions.length === 0) return null;
  return { text: sessions.map((a) => formatUkDate(a.date)).join(", "), sourceIds: cite(sessions) };
}

function authorOf(input: Pick<CreateFormReportInput, "clinician" | "author">): Clinician | undefined {
  return input.author === undefined ? input.clinician : (input.author ?? undefined);
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
      ? `${formFrom} uses its own reference for “${field.label}”. The referral from ${referralFrom} gives “${value}”, which is ${namedThing(referralFrom, "reference", "of")}, so it has not been copied in.`
      : `${formFrom} uses its own reference for “${field.label}”, and the clinic record does not hold it.`,
    suggestedQuestion: `What is ${/\)$/.test(formFrom.trim()) ? `the reference ${formFrom} uses` : `${possessive(formFrom)} own reference`} for this case? It is usually on their instruction letter.${value ? ` If they asked for the referral's reference, use “${value}”.` : ""}`,
    relatedNoteIds: [],
    raisedBy: "system",
  };
}

function missingValueGap(field: FormField, what: string, unmatched?: string): Gap {
  // Fix round 1 (B0-19): a detail staff type on each report, a physiotherapist's choice or the clinic's own details is
  // said as such – never "the record does not hold it (the patient's registration details)".
  const source = recordSourceOf(field);
  if (source && !unmatched) return recordSourceGap(field, source);
  // Fix wave 2: no internal source code ("FACT-attendance", "patient.postcode") in text a clinician reads – the
  // registration record or the appointment figures, in words.
  const where = what.startsWith("FACT-") ? "the appointment figures" : "the patient's registration details";
  // Fix round 2 (B1-15): a value from the appointments is said as such ("the notes have no discharge").
  if (what.startsWith("episode.") && !unmatched) {
    const discharge = what === "episode.dischargeDate";
    return {
      id: `gap-${field.id}-record`,
      sectionKey: field.id,
      issue: discharge ? `The notes have no discharge, so “${field.label}” has been left blank.` : `The appointments in the notes do not give “${field.label}”, so it has been left blank.`,
      // Fix round 3 (B2-26): a required box cannot be left blank – "N/A" is the answer while treatment goes on.
      suggestedQuestion: discharge ? "Type the date treatment was completed, or N/A if treatment is still going on." : `What should be entered for “${field.label}”? Check the appointments in the notes.`,
      relatedNoteIds: [],
      raisedBy: "system",
    };
  }
  return {
    id: `gap-${field.id}-record`,
    sectionKey: field.id,
    issue: unmatched
      ? `The record's value for “${field.label}” (“${unmatched}”) does not fit the form's answer options, so it has been left blank.`
      : `The record does not hold a value for “${field.label}” (${where}), so it has been left blank.`,
    // Fix wave 3: the appointment figures are counted from the appointments, not looked up in registration details.
    suggestedQuestion: what.startsWith("FACT-")
      ? `What should be entered for “${field.label}”? Count the attended and missed appointments in the notes.`
      : `What should be entered for “${field.label}”? Check the patient's registration details in the clinic system.`,
    relatedNoteIds: [],
    raisedBy: "system",
  };
}

function recordSourceGap(field: FormField, source: RecordSource): Gap {
  const label = field.label;
  const words: Record<RecordSource, { issue: string; ask: string }> = {
    // Fix round 2 (B1-15): tick it / choose it / type it, by the answer type.
    staff_entry: { issue: `“${label}” is entered by staff on each report.`, ask: `What should be entered for “${label}”? ${capitalise(staffEntryVerb(field.answerType))} from your records.` },
    physio_choice: { issue: `“${label}” is chosen by the physiotherapist on each report.`, ask: `Which answer to “${label}” applies to this patient?` },
    clinic: { issue: `Your Clinic details do not hold “${label}” yet.`, ask: `Add it in Clinic settings, or type it here for this patient's site.` },
  };
  const suffix: Record<RecordSource, string> = { staff_entry: "staff", physio_choice: "physio", clinic: "clinic" };
  return { id: `gap-${field.id}-${suffix[source]}`, sectionKey: field.id, issue: words[source].issue, suggestedQuestion: words[source].ask, relatedNoteIds: [], raisedBy: "system" };
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
  const clinicName = bundleClinic(bundle)?.name ?? "";

  switch (key) {
    case "introduction":
      return [
        {
          text:
            `This report has been prepared at the request of ${party.name} (${INSTRUCTING_PARTY_LABELS[party.type].toLowerCase()})${ref}. ` +
            `It concerns ${reg.fullName}, who received physiotherapy ${clinicName ? `at ${clinicName}` : "at this clinic"}` +
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
