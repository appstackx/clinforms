/**
 * Safety corpus (W0.2): the case format. One JSON object per line in cases/*.jsonl, parsed and checked here.
 *
 * A case pins one safety behaviour in ClinForms' own fictional wording. It names the bug(s) it pins (`source`), the
 * workstream that owns the behaviour (`owner`), the paths it runs through (`paths`), its input and what must always
 * happen (`expect`, plus `ack` and `check`). Workstream and fix agents may only ADD cases; the lock
 * (safety-corpus.lock.json) holds sha256(id, input, expectation) for every case and the guard
 * (scripts/medreport/corpus-guard.mjs) refuses any change or removal. Cases still allowed to fail are listed in
 * pending.json with their owner; only the integrator edits it.
 *
 * Browser-safe and pure (no node:* imports): the test files and scripts read the files and pass the text in.
 */
import { z } from "zod";

export const EXPECTS = ["BLOCK", "FLAG", "PASS", "NOT_OFFERED", "REFUSED_403", "REFUSED_409", "IDENTICAL"] as const;
export type Expect = (typeof EXPECTS)[number];

/** Owning workstream (plan bh-quality-plan). W0 = the foundation itself (tokenizer, shared types) before bh2-base. */
export const OWNERS = ["W0", "WA1", "WA2", "WB", "WC", "WD", "WE", "WF"] as const;
export type Owner = (typeof OWNERS)[number];

export const GROUPS = [
  "OPN",
  "NEG",
  "COM",
  "ATT",
  "ROLE",
  "ISSUE",
  "COND",
  "TEXT",
  "EDIT",
  "REP",
  "META",
  "BAND",
  "SCALE",
  "ASAT",
  "SCOPE",
  "FILL",
  "LINT",
] as const;
export type Group = (typeof GROUPS)[number];

/**
 * validate  – validateReport with an explicit voice owner (the approver), then canSign / canAcknowledge per actor.
 * sign      – the in-process POST /sign handler (tenant mode: a signed-in member of the fictional clinic; demo mode).
 * render    – sign, then the in-process POST /render FINAL (and the receipt-mutation property).
 * store     – the in-process PUT /store/reports (tenant mode, memory store).
 * reducer   – review-reducer action sequences by a named actor, then validation; one-click fixes applied and re-checked.
 * fill      – the docx fill of a fictional form (FINAL semantics unless the case says draft).
 * lint      – the form-map lint (core/form-map-lint.ts, WE).
 * assemble  – drafting assembly with a hand-written DraftOutput (ai/assemble.ts).
 * split     – the shared sentence tokenizer (core/text/sentences.ts, W0.5).
 * scope     – scope minimisation of note text (core/scope.ts).
 * probe     – a named pure function of the product (conditions, own-voice rewrite, value-only, map notes).
 */
export const PATHS = ["validate", "sign", "render", "store", "reducer", "fill", "lint", "assemble", "split", "scope", "probe"] as const;
export type CasePath = (typeof PATHS)[number];

export const ACK_POLICIES = ["never", "approver", "member"] as const;
export type AckPolicy = (typeof ACK_POLICIES)[number];

export const PERSON_KEYS = ["sarah", "tom", "priya", "pat", "chris"] as const;
export type PersonKey = (typeof PERSON_KEYS)[number];

/** The four actor kinds of the role matrix. */
export const ACTOR_KINDS = ["staff", "other", "approver", "admin"] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

const PersonKeySchema = z.enum(PERSON_KEYS);

export const NoteOverrideSchema = z.object({
  id: z.string().regex(/^N-\d{3,}$/),
  author: PersonKeySchema,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  type: z.enum(["initial_assessment", "follow_up", "discharge", "telephone", "other"]).optional(),
  subjective: z.string().optional(),
  objective: z.string().optional(),
  assessment: z.string().optional(),
  plan: z.string().optional(),
  /** Add an attended appointment for a new note (default true for a note the bundle does not have). */
  attended: z.boolean().optional(),
});
export type NoteOverride = z.infer<typeof NoteOverrideSchema>;

export const ParagraphInputSchema = z.object({
  text: z.string(),
  cites: z.array(z.string()).default([]),
  origin: z.enum(["ai", "edited", "clinician", "from_records", "staff"]).default("ai"),
  basis: z.enum(["patient_reported", "clinician_observed", "clinician_opinion_recorded", "record"]).optional(),
  originalText: z.string().optional(),
  /** Who wrote it (stamped on the paragraph as `by` for the release schema; ignored by older readers). */
  by: PersonKeySchema.optional(),
  /** "These are my own words" recorded by this person (release schema `ownWords`). */
  ownWords: PersonKeySchema.optional(),
  ackReason: z.string().optional(),
});
export type ParagraphInput = z.infer<typeof ParagraphInputSchema>;

/** One reducer step. `by` is the actor (default: the case's actor). Unknown kinds fail the case (not supported). */
export const StepSchema = z.object({
  do: z.enum([
    "edit",
    "add",
    "remove",
    "setAnswer",
    "ackFlag",
    "resolveGap",
    "ackGap",
    "leaveBlank",
    "leaveBlankBulk",
    "markNotApplicable",
    "appliesAnyway",
    "adopt",
    "ownWords",
    "acceptNoteWords",
    "tickSuggested",
    "applyFix",
    "takeOver",
    "writeInOwnVoice",
  ]),
  by: PersonKeySchema.optional(),
  box: z.string().optional(),
  /** edit/remove: which paragraph of the box (0-based; default 0). */
  paragraph: z.number().int().nonnegative().optional(),
  text: z.string().optional(),
  value: z.union([z.string(), z.boolean(), z.null()]).optional(),
  reason: z.string().optional(),
  /** ackFlag: which flag (by code, optional evidence substring) on the box. */
  code: z.string().optional(),
  evidence: z.string().optional(),
  /** applyFix: which offered fix (by kind). */
  fix: z.string().optional(),
});
export type Step = z.infer<typeof StepSchema>;

export const CaseInputSchema = z
  .object({
    /** "template:solicitor_rta" | "template:employer_ffw" | "form:<fictional form id>". */
    report: z.string().default("template:solicitor_rta"),
    bundle: z.enum(["owen", "gemma"]).default("owen"),
    notes: z.array(NoteOverrideSchema).optional(),
    /** Remove these notes from the bundle (and their appointments). */
    dropNotes: z.array(z.string()).optional(),
    /** report.author (the clinician drafts are written for). Default: the approver. null = none (staff-prepared). */
    author: PersonKeySchema.nullable().optional(),
    /** report.approver – the voice owner. Default "sarah". null = none chosen (strict mode). */
    approver: PersonKeySchema.nullable().optional(),
    /** Who approves at /sign (default: the approver, else sarah). */
    signer: PersonKeySchema.optional(),
    /** Who acts (reducer steps, store PUT) and views (default: the approver, else sarah). */
    actor: PersonKeySchema.optional(),
    /** The subject box (section key or form field id). */
    box: z.string().optional(),
    /** The subject paragraph (replaces the box's paragraphs). */
    paragraph: ParagraphInputSchema.optional(),
    /** Other content: box → paragraphs (replacing that box's paragraphs). */
    boxes: z.record(z.string(), z.array(ParagraphInputSchema)).optional(),
    /** Structured answers: box → value (yes/no true/false, a choice's option, a text, null). */
    answers: z.record(z.string(), z.union([z.string(), z.boolean(), z.null()])).optional(),
    /** Who set each structured answer (release schema `answerBy`; default the actor). */
    answersBy: z.record(z.string(), PersonKeySchema).optional(),
    /** Gaps to add: box → issue text (and an optional suggested answer). */
    gaps: z
      .array(z.object({ box: z.string(), issue: z.string(), suggestedAnswer: z.string().optional(), id: z.string().optional() }))
      .optional(),
    /** Reducer steps (path "reducer"). */
    steps: z.array(StepSchema).optional(),
    /** Decisions stored on sections before validation (release schema; older readers ignore them). */
    dispositions: z
      .record(z.string(), z.object({ kind: z.enum(["not_applicable", "applies_anyway", "left_blank"]), by: PersonKeySchema, reason: z.string().optional() }))
      .optional(),
    /** Sign mode (path sign/render): tenant (signed-in member, default) or demo (public demo session). */
    signMode: z.enum(["tenant", "demo"]).optional(),
    /** Extra path-specific input (fill answers, lint map, assembly output, probe arguments …). */
    fill: z.record(z.string(), z.unknown()).optional(),
    lint: z.record(z.string(), z.unknown()).optional(),
    assemble: z.record(z.string(), z.unknown()).optional(),
    split: z.record(z.string(), z.unknown()).optional(),
    scope: z.record(z.string(), z.unknown()).optional(),
    probe: z.record(z.string(), z.unknown()).optional(),
    store: z.record(z.string(), z.unknown()).optional(),
    render: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type CaseInput = z.infer<typeof CaseInputSchema>;

export const MutateSchema = z
  .object({
    /** anti-strip carriers over this BLOCK case (default on for a BLOCK case with a subject paragraph). */
    strip: z.boolean().optional(),
    /** anti-deny-list: insert each modal at `find` (replaced by `replace`, where {m} is the modal). PASS cases only. */
    denyList: z.object({ find: z.string(), replace: z.string() }).optional(),
    /** origin variants of the subject paragraph (default on for OPN/ATT BLOCK cases with an "ai" paragraph). */
    origin: z.boolean().optional(),
    /** actor variants: the expected result for each actor kind (ROLE cases). */
    actors: z.partialRecord(z.enum(ACTOR_KINDS), z.enum(EXPECTS)).optional(),
    /** one-click: apply each offered fix and re-check (default on for validate cases). */
    oneClick: z.boolean().optional(),
  })
  .strict();
export type Mutate = z.infer<typeof MutateSchema>;

export const CaseSchema = z
  .object({
    id: z.string().regex(/^[A-Z]+-[a-z0-9][a-z0-9-]*$/, "ids look like OPN-carrier-01"),
    group: z.enum(GROUPS),
    title: z.string().min(1),
    /** Bug ids and seed references this case pins (R-*, B*, N-*, C-*, D-*, F*, seed ids). */
    source: z.array(z.string().min(1)).min(1),
    owner: z.enum(OWNERS),
    tags: z.array(z.string()).default([]),
    paths: z.array(z.enum(PATHS)).min(1),
    input: CaseInputSchema,
    expect: z.enum(EXPECTS),
    /** The acknowledgement policy the blocking flags must have (BLOCK cases). */
    ack: z.enum(ACK_POLICIES).optional(),
    /** "Incidental" codes (citations, figures, gaps, merge codes …) that may count for this BLOCK (default: none). */
    blockBy: z.array(z.string()).optional(),
    /** Path-specific checks (see harness/evaluate.ts). */
    check: z.record(z.string(), z.unknown()).optional(),
    /** Every PASS case names a BLOCK case that differs only in what makes it unsafe. */
    negativeTwin: z.string().optional(),
    mutate: MutateSchema.optional(),
    note: z.string().optional(),
  })
  .strict();
export type CorpusCase = z.infer<typeof CaseSchema>;

/** A case as run: a hand-written case or a mutation generated from one. */
export interface RunCase extends CorpusCase {
  /** The hand-written case a mutation came from. */
  parent?: string;
  /** anti-strip | anti-deny | origin | actor | one-click */
  mutation?: string;
  /**
   * anti-strip: the carrier's own words. A flag whose evidence lies only in them does not count for the BLOCK (the
   * carrier "No restrictions were recorded; …" is an opinion by itself on some trees), so a mutation blocks only when
   * the original unsafe text still does.
   */
  carrierText?: string;
  /** anti-strip: the case's own text before the carrier was added. */
  parentText?: string;
}

/**
 * What locks a case, taken from the line AS WRITTEN (before defaults): its id, input and expectation (expect, ack,
 * blockBy, check, paths, negativeTwin, mutate). Title, source, owner, tags and note are metadata.
 */
export function lockedPartOf(raw: Record<string, unknown>): unknown {
  return {
    id: raw.id,
    input: raw.input,
    expect: {
      expect: raw.expect,
      ack: raw.ack,
      blockBy: raw.blockBy,
      check: raw.check,
      paths: raw.paths,
      negativeTwin: raw.negativeTwin,
      mutate: raw.mutate,
    },
  };
}

export interface PendingEntry {
  owner: Owner;
  reason: string;
}
export type PendingFile = { _about?: string; cases: Record<string, PendingEntry> };
