/**
 * Onboarding: add a PORTAL QUESTION SET to a clinic's forms library (16/11/2026 – Blue Heart's Speed OPM reports are
 * typed into the provider's online portal, so there is no file to load with admin:load-forms).
 *
 * The questions are given as the Studio's "Add portal questions" box takes them (core/question-set.ts
 * parsePortalQuestions: one question per line, "# Heading", [date] / [yes/no] / [number] / [long] / [short] /
 * [choice: A | B] and [optional]) and stored exactly as the Studio would store them – a PROPOSED form map
 * (FormKind "questions", no file) that the clinic's staff check and confirm once – encrypted for that clinic.
 *
 * Rules (as src/server/admin/load-forms.ts):
 * - the clinic must exist and be open; PREVIEW unless `confirm`;
 * - questions that do not parse (an error from the parser) are refused – nothing is stored;
 * - the same question set already in the clinic's library (the same canonical question list) is skipped;
 * - audited "form.create" (via onboarding) and "clinic.forms_loaded", by ClinForms (PLATFORM_USER_ID);
 * - with `confirm` the clinic's own rows (members, invitations, plan, package, usage, settings, reports) are compared
 *   before and after: any change is reported.
 * Returns counts and plain notes only.
 */
import { PREPARED_NOTE } from "../../modules/medreport/core/form-map-lint";
import { createQuestionSet, parsePortalQuestions } from "../../modules/medreport/core/question-set";
import { FormDefinitionSchema } from "../../modules/medreport/core/schemas";
import type { ReferrerInfo } from "../../modules/medreport/core/types";
import { PLATFORM_USER_ID } from "../auth/create-auth";
import { appendAudit } from "../repos/audit";
import { RepoInputError, type RepoContext } from "../repos/context";
import { createForm, listFormMeta } from "../repos/forms";
import { clinicFingerprint, requireOpenClinic } from "./load-forms";

export interface AddQuestionSetInput {
  tenantId: string;
  /** Whose portal it is (shown with the form), e.g. { name: "Speed Medical (OPM)", type: "case_manager" }. */
  referrer: ReferrerInfo;
  /** Default: "<referrer> – portal questions". */
  title?: string;
  /** The portal's questions, one per line (parsePortalQuestions). */
  questionsText: string;
  /** Notes for the clinic's staff, shown with the map ("Notes from the analysis"). */
  notes?: readonly string[];
  /** Store (else preview only). */
  confirm?: boolean;
  now?: Date;
}

export interface AddQuestionSetResult {
  tenantId: string;
  dryRun: boolean;
  status: "ready" | "loaded" | "skipped" | "refused";
  reason?: string;
  formId?: string;
  title: string;
  questions: number;
  headings: number;
  /** Questions answered from the clinic record by code / left for staff or the clinician (as the map proposes). */
  fromRecords: number;
  forStaff: number;
  /** The parser's notes and problems, in plain words (line numbers, never the clinic's data). */
  warnings: string[];
  errors: string[];
  /** With confirm: the clinic's own rows are as they were. */
  invariants?: { ok: boolean; changed: string[] };
}

export async function addClinicQuestionSet(ctx: RepoContext, input: AddQuestionSetInput): Promise<AddQuestionSetResult> {
  const tenantId = String(input.tenantId ?? "").trim();
  await requireOpenClinic(ctx.db, tenantId);
  const referrerName = String(input.referrer?.name ?? "").replace(/\s+/g, " ").trim();
  if (!referrerName) throw new RepoInputError("Name the portal's owner (--referrer).");
  const parsed = parsePortalQuestions(String(input.questionsText ?? ""));
  const base = { tenantId, dryRun: !input.confirm, title: "", questions: parsed.questions.length, headings: new Set(parsed.questions.map((q) => q.section ?? "")).size, fromRecords: 0, forStaff: 0, warnings: parsed.warnings, errors: parsed.errors };
  if (parsed.errors.length > 0) return { ...base, status: "refused", reason: "The questions could not be read." };

  const now = input.now ?? ctx.now?.() ?? new Date();
  const form = await createQuestionSet({
    referrer: { name: referrerName, type: input.referrer.type },
    ...(input.title ? { title: input.title } : {}),
    questions: parsed.questions,
    warnings: [PREPARED_NOTE, ...(input.notes ?? []), ...parsed.warnings],
    tenantId,
    now,
  });
  const checked = FormDefinitionSchema.safeParse(form);
  if (!checked.success) {
    return { ...base, title: form.title, status: "refused", reason: `The question set is not a valid form map (${checked.error.issues[0]?.path.join(".")}: ${checked.error.issues[0]?.message}).` };
  }
  let fromRecords = 0;
  let forStaff = 0;
  for (const f of form.fields) {
    if (f.fillSource.kind !== "registration") continue;
    if (f.fillSource.path === "staff.entry") forStaff += 1;
    else fromRecords += 1;
  }
  const ready: AddQuestionSetResult = { ...base, title: form.title, fromRecords, forStaff, status: "ready" };

  // The same questions already in the library (the canonical question list stands in for the file's SHA-256).
  const library = await listFormMeta(ctx, tenantId);
  if (library.some((m) => m.fileSha256 === form.file.sha256)) return { ...ready, status: "skipped", reason: "This question set is already in the clinic's library." };
  if (!input.confirm) return ready;

  const before = await clinicFingerprint(ctx.db, tenantId);
  const saved = await createForm(ctx, tenantId, {
    id: form.id,
    fileSha256: form.file.sha256,
    status: "proposed",
    title: form.title.slice(0, 300),
    referrer: form.referrer.name.slice(0, 300),
    kind: form.kind,
    sampleId: null,
    payload: form,
  });
  if (!saved.ok) throw new Error(`The question set could not be stored (${saved.reason}).`);
  await appendAudit(ctx, tenantId, {
    userId: PLATFORM_USER_ID,
    action: "form.create",
    targetType: "form",
    targetId: form.id,
    detail: { via: "onboarding", status: "proposed", fields: form.fields.length, kind: form.kind, mapFrom: "questions" },
  });
  await appendAudit(ctx, tenantId, { userId: PLATFORM_USER_ID, action: "clinic.forms_loaded", targetType: "clinic", targetId: tenantId, detail: { forms: 1, refused: 0, skipped: 0 } });
  const after = await clinicFingerprint(ctx.db, tenantId);
  const changed = (Object.keys(before) as Array<keyof typeof before>).filter((k) => before[k] !== after[k]);
  return { ...ready, status: "loaded", formId: form.id, invariants: { ok: changed.length === 0, changed } };
}
