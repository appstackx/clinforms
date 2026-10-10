/**
 * The demonstration clinic: a clearly fictional clinic in any environment (local, preview or – with the owner's go –
 * production) holding the RED Physiotherapy demonstration as a clinic would hold it, for a live-site backup of the
 * local demo. Run by scripts/admin/seed-demo-clinic.ts (`npm run admin:seed-demo-clinic`); runbook docs/auth.md §5.
 *
 * What it does, idempotently (a second run changes nothing; dry run = reads only):
 *   1. the clinic "Riverside Physiotherapy (fictional)" / riverside-demo with a fictional profile (Milton Keynes,
 *      Ofcom drama-range phone, example.com email), 30-day retention and drafting from the notes ON; an EXISTING
 *      account becomes its owner directly – no invitation, never a new account (refused when the account is missing);
 *   2. its forms library: each prepared map (RecordedFormAnalysis, as in MEDREPORT_DEMO_ASSETS_DIR/maps) with its form
 *      file (matched by SHA-256; stored encrypted in chunks under a neutral file name) and the portal question set
 *      (no file) – confirmed by "ClinForms set-up (demonstration)" and attested in-process exactly as POST
 *      /forms/confirm does, with THIS environment's MEDREPORT_SIGNING_SECRET; the demonstration footer kept;
 *   3. the fictional patient's record built the way a clinic import is (the documented JSON import format through the
 *      file-import parser, stamped with the clinic and its profile as the bundle response is), and one DRAFT report
 *      per form with recorded answers, made by the Studio's own generate path (createFormReport → the recorded answer
 *      groups through assembleDraft → applyDraftResult → validation) with no author named, so a clinician's review
 *      offers "Write in my own voice" – stored through the tenant report repository (rev 1).
 * Every change is audited under the clinic (as the app would write it) and under the platform pseudo-tenant, by the
 * platform's own user – ids and counts only, never patient data or file names.
 *
 * Fictional data only: the clinic, its people and the patient are invented; the insurer forms are public forms used
 * for demonstration (their maps carry the footer saying so). Insurer files and maps never come from git.
 */
import { createHash } from "node:crypto";
import type { Kysely } from "kysely";
import { assembleDraft } from "../../modules/medreport/ai/assemble";
import { DemoDraftFileSchema, type DemoDraftFile } from "../../modules/medreport/ai/demo-format";
import { recordedDraftOutput } from "../../modules/medreport/ai/draft-demo";
import { DraftGenerationError } from "../../modules/medreport/ai/types";
import { RecordedFormAnalysisSchema, type RecordedFormAnalysis } from "../../modules/medreport/ai/recorded-forms";
import type { BundleResponse, DraftsRequest, DraftsResponse, ValidateResponse } from "../../modules/medreport/api/contract";
import { normaliseStoredForm } from "../../modules/medreport/api/handlers/store-forms";
import { storedFormFileName } from "../../modules/medreport/api/store-contract";
import { formMapSha256, verifyFormConfirmation, withAttestedConfirmation } from "../../modules/medreport/auth/attestations";
import { parseImport } from "../../modules/medreport/connectors/file-import/parser";
import { clinicDetailsFromProfile } from "../../modules/medreport/core/clinic";
import { computeFacts } from "../../modules/medreport/core/computed-facts";
import { checkFormDefinition, formToTemplate } from "../../modules/medreport/core/forms";
import { createId } from "../../modules/medreport/core/ids";
import { isQuestionSet, withQuestionSetFile } from "../../modules/medreport/core/question-set";
import { FormDefinitionSchema, ReportSchema } from "../../modules/medreport/core/schemas";
import type { EpisodeBundle, FormAnalysis, FormDefinition, Report } from "../../modules/medreport/core/types";
import { validateReport } from "../../modules/medreport/core/validation";
import { demoFormNotice, publicEngineName } from "../../modules/medreport/core/wording";
import { generateReport } from "../../modules/medreport/ui/components/new/generate";
import { PLATFORM_USER_ID } from "../auth/create-auth";
import { loadClinicProfile } from "../auth/medreport-actor";
import { findUserByEmail } from "../auth/membership";
import { addExistingOwner, createClinicForExistingOwner, ensurePlatformUser, normaliseEmail, type ClinicProfileDetails } from "../auth/platform";
import type { DataCipher } from "../crypto/envelope";
import type { Database } from "../db/schema";
import { appendAudit } from "../repos/audit";
import { getClinicProfile, upsertClinicProfile } from "../repos/clinic-profile";
import { RepoInputError, type RepoContext } from "../repos/context";
import { hasFormFile, putFormFile } from "../repos/form-files";
import { createForm, getForm, listFormMeta, updateForm } from "../repos/forms";
import { createReport, deleteReport, getReport, listReports } from "../repos/reports";
import { PLATFORM_AUDIT_TENANT } from "./platform-console";

/** Who confirmed the demonstration maps (the attestation records it; shown on the map screen). */
export const DEMO_SETUP_BY = "ClinForms set-up (demonstration)";

/** The fictional demonstration clinic. Phone: Ofcom's drama range (never a real number); email: example.com. */
export const DEMO_CLINIC = {
  slug: "riverside-demo",
  name: "Riverside Physiotherapy (fictional)",
  retentionDays: 30,
  profile: {
    legalName: null,
    address: ["Unit 4, Riverside Court (fictional)", "Milton Keynes"],
    postcode: "MK9 0ZZ",
    phone: "01632 960 418",
    email: "clinic@example.com",
    draftingEnabled: true,
  } satisfies Required<ClinicProfileDetails>,
} as const;

/** The fictional demonstration patient (src/sandbox/tm3-sim/fixtures/rebecca-lane.ts). */
export const DEMO_PATIENT_ID = "sim-pat-006";

/** Detail added to every audit row this seed writes (no patient data). */
const VIA = { via: "seed-demo-clinic", demonstration: true } as const;

export type SeedStatus = "create" | "update" | "keep" | "delete" | "refuse";

export interface SeedStep {
  /** e.g. "clinic", "owner", "profile", "file", "form", "report". */
  kind: string;
  /** Non-identifying label: a form title, a sample id, the clinic id. */
  label: string;
  status: SeedStatus;
  detail?: string;
}

export interface SeededReportSummary {
  sampleId: string;
  formTitle: string;
  reportId: string;
  questions: number;
  answered: number;
  openGaps: number;
  blockingFlags: number;
}

export interface SeedResult {
  dryRun: boolean;
  tenantId: string;
  organizationId: string | null;
  steps: SeedStep[];
  reports: SeededReportSummary[];
}

export interface DemoClinicSeedInput {
  /** The existing account that becomes (or stays) the clinic's owner. */
  ownerEmail: string;
  /** Prepared maps (maps/<sampleId>.json): RecordedFormAnalysis JSON, validated here. */
  maps: ReadonlyArray<{ name: string; data: unknown }>;
  /** The form files found next to the maps (every .pdf / .docx of --pdf-dir), matched to a map by SHA-256. */
  files: ReadonlyArray<{ fileName: string; bytes: Uint8Array }>;
  /** Recorded answers (drafts/<patientId>__form-<sampleId>.json): DemoDraftFile JSON, validated here. */
  drafts: ReadonlyArray<{ name: string; data: unknown }>;
  /** The patient's notes in the documented JSON import format (what a clinic would upload). */
  notes: { fileName: string; content: string };
  /** false (default) = dry run: read and check only, write nothing. */
  confirm?: boolean;
  /** Delete this patient's DRAFT reports on the seeded forms and create them again (approved ones are kept). */
  refreshReports?: boolean;
  /** Overrides for tests: the clinic id and name. */
  clinic?: { slug?: string; name?: string };
  now?: () => Date;
}

/* ------------------------------------------------------------------------------------------------
 * Preparation (no database): maps, files, answers and the patient's record
 * ----------------------------------------------------------------------------------------------*/

export interface PreparedForm {
  sampleId: string;
  analysis: RecordedFormAnalysis;
  /** null for a portal question set (no file). */
  file: { fileName: string; bytes: Uint8Array; sha256: string; mimeType: string } | null;
  draft: DemoDraftFile | null;
}

export interface PreparedSeed {
  tenantId: string;
  name: string;
  forms: PreparedForm[];
  /** The patient's record as the file-import connector builds it (tenant = the clinic). */
  bundle: EpisodeBundle;
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function mimeOf(fileName: string): string {
  return /\.docx$/i.test(fileName) ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "application/pdf";
}

/** Checks every input before anything is read from or written to the database. Throws RepoInputError with a plain reason. */
export function prepareDemoSeed(input: DemoClinicSeedInput): PreparedSeed {
  const tenantId = input.clinic?.slug ?? DEMO_CLINIC.slug;
  const name = input.clinic?.name ?? DEMO_CLINIC.name;
  const now = input.now?.() ?? new Date();
  if (!/\(fictional\)$/.test(name)) throw new RepoInputError('A demonstration clinic\'s name ends with "(fictional)".');

  const files = new Map<string, { fileName: string; bytes: Uint8Array }>();
  for (const f of input.files) files.set(sha256Hex(f.bytes), f);

  const drafts: DemoDraftFile[] = [];
  for (const d of input.drafts) {
    const parsed = DemoDraftFileSchema.safeParse(d.data);
    if (!parsed.success) throw new RepoInputError(`The answers file ${d.name} is not a recorded-answers file.`);
    drafts.push(parsed.data);
  }

  const forms: PreparedForm[] = [];
  const seen = new Set<string>();
  for (const m of input.maps) {
    const parsed = RecordedFormAnalysisSchema.safeParse(m.data);
    if (!parsed.success) throw new RepoInputError(`The map ${m.name} is not a prepared form map.`);
    const analysis = parsed.data;
    if (analysis.form.file.sha256 !== analysis.fileSha256) throw new RepoInputError(`The map ${m.name} is bound to another file.`);
    if (seen.has(analysis.sampleId)) throw new RepoInputError(`Two maps have the sample id ${analysis.sampleId}.`);
    seen.add(analysis.sampleId);
    let file: PreparedForm["file"] = null;
    if (!isQuestionSet(analysis.form)) {
      const found = files.get(analysis.fileSha256);
      if (!found) throw new RepoInputError(`No form file in the files folder matches the map ${m.name} (by SHA-256).`);
      file = { fileName: found.fileName, bytes: found.bytes, sha256: analysis.fileSha256, mimeType: analysis.form.file.mimeType ?? mimeOf(found.fileName) };
    }
    const draft = drafts.find((d) => d.formSha256 === analysis.fileSha256 && d.patientId === DEMO_PATIENT_ID) ?? null;
    forms.push({ sampleId: analysis.sampleId, analysis, file, draft });
  }
  if (!forms.length) throw new RepoInputError("No prepared form maps were given.");
  for (const d of drafts) {
    if (!forms.some((f) => f.draft === d)) throw new RepoInputError(`The answers file for ${d.sampleId ?? d.templateId} matches no map (by form SHA-256 and patient).`);
  }

  const imported = parseImport({ format: "json", content: input.notes.content, fileName: input.notes.fileName }, { tenantId, now });
  if (!imported.ok) throw new RepoInputError(`The notes file is not in the documented import format: ${imported.issues.map((i) => `${i.where}: ${i.message}`).join("; ").slice(0, 400)}`);
  if (imported.bundle.source.externalPatientId !== DEMO_PATIENT_ID) {
    throw new RepoInputError(`The notes file must be the fictional demonstration patient (${DEMO_PATIENT_ID}).`);
  }
  return { tenantId, name, forms, bundle: imported.bundle };
}

/**
 * The clinic's copy of a prepared map, confirmed and attested for `tenantId` exactly as POST /forms/confirm would:
 * a fresh proposal of the stored map (as an upload of that exact file gets it), the question set's file recomputed,
 * checked by checkFormDefinition, then withAttestedConfirmation with this environment's signing secret.
 */
export async function clinicFormFromMap(
  analysis: RecordedFormAnalysis,
  opts: { tenantId: string; id: string; fileName?: string; at: string },
): Promise<FormDefinition> {
  const { confirmed: _confirmed, builtIn: _builtIn, ...rest } = analysis.form;
  void _confirmed;
  void _builtIn;
  const record: FormAnalysis = {
    mode: analysis.mode,
    ...(analysis.model && { model: publicEngineName(analysis.model) }),
    promptVersion: analysis.promptVersion,
    ...(analysis.durationMs !== undefined && { durationMs: analysis.durationMs }),
    ...(analysis.usage && { usage: analysis.usage }),
    at: opts.at,
    warnings: analysis.form.analysis.warnings,
  };
  const proposal: FormDefinition = {
    ...rest,
    id: opts.id,
    tenantId: opts.tenantId,
    file: { ...analysis.form.file, ...(opts.fileName ? { fileName: opts.fileName } : {}) },
    status: "proposed",
    analysis: record,
    createdAt: opts.at,
    updatedAt: opts.at,
    sampleId: analysis.sampleId,
    // A demonstration form always carries its footer (ai/recorded-forms.ts applies the same rule).
    demoNotice: analysis.form.demoNotice?.trim() || demoFormNotice(analysis.form.referrer.name),
  };
  const form = await withQuestionSetFile(proposal);
  const problems = checkFormDefinition(form);
  if (problems.length) throw new RepoInputError(`The map ${analysis.sampleId} cannot be confirmed: ${problems[0]}`);
  const confirmed = withAttestedConfirmation({ ...form, updatedAt: opts.at }, DEMO_SETUP_BY, opts.at);
  return FormDefinitionSchema.parse(confirmed) as FormDefinition;
}

/** The bundle a clinic's Studio receives for an import: the clinic's id and, from its profile, its details. */
export async function clinicBundle(db: Kysely<Database>, bundle: EpisodeBundle, tenantId: string): Promise<EpisodeBundle> {
  const profile = await loadClinicProfile(db, tenantId);
  return profile ? { ...bundle, tenantId, clinic: clinicDetailsFromProfile(profile) } : { ...bundle, tenantId };
}

/**
 * One DRAFT report for `form`, made by the Studio's own generate path (ui/components/new/generate.ts) with an
 * in-process client: each drafting group is answered from the recorded answers exactly as POST /drafts answers in
 * demo mode (recordedDraftOutput → assembleDraft, engine named neutrally), and the final validation is POST
 * /validate's (validateReport). No author: drafts stay in the third person, as in a clinic's Studio when the member
 * starting the report cannot sign; a clinician who wrote the notes is offered "Write in my own voice".
 */
export async function draftReportFromRecordedAnswers(
  data: Pick<BundleResponse, "bundle" | "computedFacts">,
  form: FormDefinition,
  draft: DemoDraftFile,
  now: () => Date,
): Promise<{ report: Report; failedGroups: number }> {
  const template = formToTemplate(form);
  const client = {
    async drafts(body: DraftsRequest): Promise<DraftsResponse> {
      let result;
      try {
        result = recordedDraftOutput(draft, { form, sectionKeys: body.sectionKeys });
      } catch (err) {
        if (err instanceof DraftGenerationError) throw Object.assign(new Error(err.message), { code: err.code, status: 404 });
        throw err;
      }
      const response = assembleDraft({
        template,
        bundle: body.bundle,
        instructingParty: body.instructingParty,
        sectionKeys: body.sectionKeys,
        computedFacts: computeFacts(body.bundle),
        output: result.output,
        meta: result.meta,
        form,
      });
      return { ...response, generation: { ...response.generation, model: publicEngineName(response.generation.model) } };
    },
    async validate(body: { report: Report }): Promise<ValidateResponse> {
      const result = validateReport(body.report, template);
      return { flags: result.flags, canSign: result.canSign, blocking: result.blocking };
    },
  };
  const result = await generateReport({
    client,
    data,
    target: { kind: "form", form },
    author: null,
    livePossible: false,
    concurrency: 1,
    now,
  });
  return { report: ReportSchema.parse(result.report) as Report, failedGroups: result.failedGroups };
}

/** Counts for the run's summary (no patient data). */
export function reportSummary(report: Report, sampleId: string): SeededReportSummary {
  const answerable = report.sections.filter((s) => s.kind !== "declaration");
  return {
    sampleId,
    formTitle: report.form?.title ?? report.templateId,
    reportId: report.id,
    questions: answerable.length,
    answered: answerable.filter((s) => s.status !== "needs_input" && s.status !== "pending" && (s.paragraphs.length > 0 || (s.answer && s.answer.value !== null))).length,
    openGaps: report.gaps.filter((g) => !g.resolution).length,
    blockingFlags: report.flags.filter((f) => f.severity === "blocking").length,
  };
}

/* ------------------------------------------------------------------------------------------------
 * The seed
 * ----------------------------------------------------------------------------------------------*/

async function audit(ctx: Pick<RepoContext, "db" | "now">, tenantId: string, entry: { action: string; targetType?: string | null; targetId?: string | null; detail?: Record<string, unknown> }) {
  await appendAudit(ctx, tenantId, { userId: PLATFORM_USER_ID, sessionId: null, ...entry, detail: { ...VIA, ...(entry.detail ?? {}) } });
}

function profileDiff(current: Awaited<ReturnType<typeof getClinicProfile>>, name: string): string[] {
  if (!current) return ["profile"];
  const want = DEMO_CLINIC.profile;
  const changed: string[] = [];
  if (current.displayName !== name) changed.push("displayName");
  if ((current.legalName ?? null) !== want.legalName) changed.push("legalName");
  if (JSON.stringify(current.address ?? null) !== JSON.stringify(want.address)) changed.push("address");
  if ((current.postcode ?? null) !== want.postcode) changed.push("postcode");
  if ((current.phone ?? null) !== want.phone) changed.push("phone");
  if ((current.email ?? null) !== want.email) changed.push("email");
  if (current.retentionDays !== DEMO_CLINIC.retentionDays) changed.push("retentionDays");
  if (current.draftingEnabled !== want.draftingEnabled) changed.push("draftingEnabled");
  return changed;
}

/**
 * Seeds (or checks, in a dry run) the demonstration clinic. `cipher` is the environment's data cipher (forms, files
 * and reports are encrypted with it); the signing secret is MEDREPORT_SIGNING_SECRET of this process.
 */
export async function seedDemoClinic(db: Kysely<Database>, cipher: DataCipher, input: DemoClinicSeedInput): Promise<SeedResult> {
  const clock = input.now ?? (() => new Date());
  const ctx: RepoContext = { db, cipher, now: clock };
  const confirm = Boolean(input.confirm);
  const prepared = prepareDemoSeed(input);
  const { tenantId, name } = prepared;
  const steps: SeedStep[] = [];
  const reports: SeededReportSummary[] = [];

  // 1. The owner: an existing account, never created here.
  const email = normaliseEmail(input.ownerEmail);
  const owner = await findUserByEmail(db, email);
  if (!owner) throw new RepoInputError("No account with that email address: the owner must sign up first (this script never creates an account).");

  // 2. The clinic and its owner.
  let org = await db.selectFrom("organization").select(["id", "name", "metadata"]).where("slug", "=", tenantId).executeTakeFirst();
  if (org?.metadata && /offboardedAt/.test(org.metadata)) throw new RepoInputError(`The clinic ${tenantId} was offboarded: its id cannot be used again.`);
  if (org && org.name !== name) throw new RepoInputError(`A clinic with the id ${tenantId} exists under another name: refusing to change it.`);
  if (!org) {
    steps.push({ kind: "clinic", label: tenantId, status: "create", detail: `${name}, retention ${DEMO_CLINIC.retentionDays} days, drafting on` });
    steps.push({ kind: "owner", label: tenantId, status: "create", detail: "existing account added as owner (no invitation)" });
    if (confirm) {
      const created = await createClinicForExistingOwner(db, {
        name,
        slug: tenantId,
        ownerUserId: owner.id,
        retentionDays: DEMO_CLINIC.retentionDays,
        profile: DEMO_CLINIC.profile,
        auditDetail: { ...VIA },
        now: clock(),
      });
      await audit(ctx, PLATFORM_AUDIT_TENANT, { action: "platform.clinic_create", targetType: "organization", targetId: created.organizationId, detail: { tenantId } });
      await audit(ctx, PLATFORM_AUDIT_TENANT, { action: "platform.member_add", targetType: "user", targetId: owner.id, detail: { tenantId, role: "owner" } });
      org = await db.selectFrom("organization").select(["id", "name", "metadata"]).where("slug", "=", tenantId).executeTakeFirst();
    }
  } else {
    steps.push({ kind: "clinic", label: tenantId, status: "keep" });
    const membership = await db.selectFrom("member").select(["role"]).where("organizationId", "=", org.id).where("userId", "=", owner.id).executeTakeFirst();
    if (membership && membership.role !== "owner") {
      throw new RepoInputError(`This account is already a member of ${tenantId} (role ${membership.role}): change the role in the clinic's settings.`);
    }
    steps.push({ kind: "owner", label: tenantId, status: membership ? "keep" : "create", detail: membership ? undefined : "existing account added as owner (no invitation)" });
    if (!membership && confirm) {
      await addExistingOwner(db, { organizationId: org.id, tenantId, userId: owner.id, auditDetail: { ...VIA }, now: clock() });
      await audit(ctx, PLATFORM_AUDIT_TENANT, { action: "platform.member_add", targetType: "user", targetId: owner.id, detail: { tenantId, role: "owner" } });
    }
    const changed = profileDiff(await getClinicProfile(ctx, tenantId), name);
    steps.push({ kind: "profile", label: tenantId, status: changed.length ? "update" : "keep", detail: changed.length ? changed.join(", ") : undefined });
    if (changed.length && confirm) {
      await upsertClinicProfile(ctx, tenantId, {
        organizationId: org.id,
        displayName: name,
        legalName: DEMO_CLINIC.profile.legalName,
        address: [...DEMO_CLINIC.profile.address],
        postcode: DEMO_CLINIC.profile.postcode,
        phone: DEMO_CLINIC.profile.phone,
        email: DEMO_CLINIC.profile.email,
        retentionDays: DEMO_CLINIC.retentionDays,
        draftingEnabled: DEMO_CLINIC.profile.draftingEnabled,
      });
      await audit(ctx, tenantId, { action: "clinic.update", targetType: "organization", targetId: org.id, detail: { fields: changed } });
      await audit(ctx, PLATFORM_AUDIT_TENANT, { action: "platform.clinic_update", targetType: "organization", targetId: org.id, detail: { tenantId, fields: changed } });
    }
  }
  const exists = Boolean(org);
  if (confirm) await ensurePlatformUser(db);

  // 3. The forms library: files (encrypted, chunked) and confirmed, attested maps.
  const at = clock().toISOString();
  const metas = exists ? await listFormMeta(ctx, tenantId) : [];
  const formIds = new Map<string, FormDefinition>();
  const formCounts = { created: 0, updated: 0, kept: 0, files: 0 };
  for (const p of prepared.forms) {
    const title = p.analysis.form.title;
    if (p.file) {
      const held = exists && (await hasFormFile(ctx, tenantId, p.file.sha256));
      steps.push({ kind: "file", label: title, status: held ? "keep" : "create", detail: held ? undefined : `${Math.round(p.file.bytes.byteLength / 1024)} KB, encrypted` });
      if (!held && confirm) {
        const stored = await putFormFile(ctx, tenantId, {
          bytes: p.file.bytes,
          fileName: storedFormFileName(p.file.mimeType),
          mimeType: p.file.mimeType,
          expectedSha256: p.file.sha256,
        });
        formCounts.files += 1;
        await audit(ctx, tenantId, { action: "file.upload", targetType: "form_file", targetId: stored.sha256, detail: { sizeBytes: stored.sizeBytes, mimeType: p.file.mimeType } });
      }
    }
    const existing = metas.find((m) => m.sampleId === p.sampleId) ?? (p.file ? metas.find((m) => m.fileSha256 === p.file?.sha256 && m.kind === p.analysis.form.kind) : undefined);
    const wanted = await clinicFormFromMap(p.analysis, { tenantId, id: existing?.id ?? createId("frm"), fileName: p.file?.fileName, at });
    if (existing) {
      const stored = await getForm<unknown>(ctx, tenantId, existing.id);
      const parsed = stored ? FormDefinitionSchema.safeParse(stored.payload) : null;
      const current = parsed?.success ? (parsed.data as FormDefinition) : null;
      const same = Boolean(current && verifyFormConfirmation(current, { tenantId }).ok && formMapSha256(current) === formMapSha256(wanted));
      if (same && current) {
        steps.push({ kind: "form", label: title, status: "keep" });
        formIds.set(p.sampleId, current);
        formCounts.kept += 1;
        continue;
      }
      steps.push({ kind: "form", label: title, status: "update", detail: "map confirmed and attested again" });
      formIds.set(p.sampleId, wanted);
      if (confirm) {
        const saved = await updateForm(ctx, tenantId, formRow(wanted), existing.rev);
        if (!saved.ok) throw new RepoInputError(`The form ${p.sampleId} changed while it was being updated: run again.`);
        formCounts.updated += 1;
        await audit(ctx, tenantId, { action: "form.store_confirmed", targetType: "form", targetId: wanted.id, detail: { rev: saved.rev, status: "confirmed", kind: wanted.kind, downgraded: false } });
        await audit(ctx, tenantId, { action: "form.confirm", targetType: "form", targetId: wanted.id, detail: confirmDetail(wanted) });
      }
      continue;
    }
    steps.push({ kind: "form", label: title, status: "create", detail: `${wanted.fields.length} questions, confirmed by ${DEMO_SETUP_BY}` });
    formIds.set(p.sampleId, wanted);
    if (confirm) {
      // The store's own rule for a confirmed map: it must verify for this clinic, else it would be stored as a proposal.
      if (normaliseStoredForm(wanted, tenantId).downgraded) throw new Error(`The attestation of ${p.sampleId} does not verify for ${tenantId}.`);
      const saved = await createForm(ctx, tenantId, formRow(wanted));
      if (!saved.ok) throw new RepoInputError(`The form ${p.sampleId} could not be stored (${saved.reason}).`);
      formCounts.created += 1;
      await audit(ctx, tenantId, { action: "form.create", targetType: "form", targetId: wanted.id, detail: { rev: saved.rev, status: "confirmed", kind: wanted.kind, downgraded: false } });
      await audit(ctx, tenantId, { action: "form.confirm", targetType: "form", targetId: wanted.id, detail: confirmDetail(wanted) });
    }
  }
  if (confirm && (formCounts.created || formCounts.updated || formCounts.files)) {
    await audit(ctx, PLATFORM_AUDIT_TENANT, { action: "platform.demo_forms_seed", targetType: "organization", targetId: org?.id ?? null, detail: { tenantId, ...formCounts } });
  }

  // 4. The patient's DRAFT reports, one per form with recorded answers.
  const withAnswers = prepared.forms.filter((p) => p.draft);
  const existingReports = exists ? await listReports(ctx, tenantId, { withPayload: false, limit: 1000 }) : [];
  const reportCounts = { created: 0, deleted: 0, kept: 0 };
  let data: Pick<BundleResponse, "bundle" | "computedFacts"> | null = null;
  let importAudited = false;
  for (const p of withAnswers) {
    const form = formIds.get(p.sampleId);
    if (!form || !p.draft) continue;
    const title = form.title;
    const mine: Array<{ id: string; rev: number; status: string }> = [];
    for (const meta of existingReports.filter((r) => r.formId === form.id)) {
      const record = await getReport<Report>(ctx, tenantId, meta.id);
      if (record?.payload?.episodeRef?.patientId === DEMO_PATIENT_ID) mine.push({ id: meta.id, rev: meta.rev, status: meta.status });
    }
    const drafts = mine.filter((r) => r.status !== "signed");
    if (mine.length && !input.refreshReports) {
      steps.push({ kind: "report", label: title, status: "keep", detail: `${mine.length} report${mine.length === 1 ? "" : "s"} for the patient already` });
      reportCounts.kept += mine.length;
      continue;
    }
    for (const r of drafts) {
      steps.push({ kind: "report", label: title, status: "delete", detail: `draft ${r.id} (refresh)` });
      if (confirm && (await deleteReport(ctx, tenantId, r.id))) {
        reportCounts.deleted += 1;
        await audit(ctx, tenantId, { action: "report.delete", targetType: "report", targetId: r.id, detail: { rev: r.rev, status: r.status } });
      }
    }
    if (mine.length > drafts.length) steps.push({ kind: "report", label: title, status: "keep", detail: "approved report kept" });

    // The record exactly as the clinic's Studio receives it after "Upload the notes" (dry run: the profile to be).
    if (!data) {
      const bundle = exists ? await clinicBundle(db, prepared.bundle, tenantId) : { ...prepared.bundle, tenantId, clinic: clinicDetailsFromProfile({ displayName: name, addressLines: [...DEMO_CLINIC.profile.address], postcode: DEMO_CLINIC.profile.postcode, phone: DEMO_CLINIC.profile.phone, email: DEMO_CLINIC.profile.email }) };
      data = { bundle, computedFacts: computeFacts(bundle) };
    }
    const { report, failedGroups } = await draftReportFromRecordedAnswers(data, form, p.draft, clock);
    const summary = reportSummary(report, p.sampleId);
    steps.push({
      kind: "report",
      label: title,
      status: "create",
      detail: `draft: ${summary.answered} of ${summary.questions} answered, ${summary.openGaps} gap${summary.openGaps === 1 ? "" : "s"} for the clinician${failedGroups ? `, ${failedGroups} group(s) without recorded answers` : ""}`,
    });
    if (confirm) {
      if (!importAudited) {
        importAudited = true;
        // The import itself, as the clinic's activity would show it (counts only).
        await audit(ctx, tenantId, {
          action: "notes.imported",
          detail: {
            format: "json",
            layout: "documented",
            notes: data.bundle.notes.length,
            appointments: data.bundle.appointments.length,
            outcomeScores: data.bundle.outcomeMeasures.reduce((n, m) => n + m.points.length, 0),
            clinicians: data.bundle.clinicians.length,
          },
        });
      }
      const saved = await createReport(ctx, tenantId, { id: report.id, status: report.status, templateId: report.templateId, formId: report.form?.formId ?? null, payload: report });
      if (!saved.ok) throw new RepoInputError(`The report for ${p.sampleId} could not be stored (${saved.reason}).`);
      reportCounts.created += 1;
      await audit(ctx, tenantId, { action: "report.create", targetType: "report", targetId: report.id, detail: { rev: saved.rev, status: report.status, version: report.version ?? 1 } });
    }
    reports.push(summary);
  }
  if (confirm && (reportCounts.created || reportCounts.deleted)) {
    await audit(ctx, PLATFORM_AUDIT_TENANT, { action: "platform.demo_reports_seed", targetType: "organization", targetId: org?.id ?? null, detail: { tenantId, ...reportCounts } });
  }

  return { dryRun: !confirm, tenantId, organizationId: org?.id ?? null, steps, reports };
}

function formRow(form: FormDefinition) {
  return {
    id: form.id,
    fileSha256: form.file.sha256,
    status: form.status,
    title: form.title.slice(0, 300),
    referrer: form.referrer.name ? form.referrer.name.slice(0, 300) : null,
    kind: form.kind,
    sampleId: form.sampleId ?? null,
    payload: form,
  };
}

function confirmDetail(form: FormDefinition) {
  return { kind: form.kind, fields: form.fields.length, mapSha256: form.confirmed?.mapSha256?.slice(0, 16) ?? null };
}

/* ------------------------------------------------------------------------------------------------
 * The environment's signing secret against a running deployment
 * ----------------------------------------------------------------------------------------------*/

export type SigningCheck = { result: "match" } | { result: "mismatch" } | { result: "unknown"; reason: string };

/**
 * Whether this process's MEDREPORT_SIGNING_SECRET is the one the app at `baseUrl` signs with: the public
 * GET /api/reports/v1/forms/samples returns the bundled sample maps with the server's attestation (tenant "demo"),
 * which verifies here only with the same secret. A seeded map attested with another secret would open as unconfirmed.
 */
export async function checkSigningSecret(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<SigningCheck> {
  let url: URL;
  try {
    url = new URL("/api/reports/v1/forms/samples", baseUrl);
  } catch {
    return { result: "unknown", reason: "not a valid URL" };
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && /^(localhost|127\.0\.0\.1)$/.test(url.hostname))) {
    return { result: "unknown", reason: "https only (http for localhost)" };
  }
  let body: unknown;
  try {
    const res = await fetchImpl(url, { redirect: "manual", headers: { accept: "application/json" } });
    if (!res.ok) return { result: "unknown", reason: `HTTP ${res.status}` };
    body = await res.json();
  } catch (err) {
    return { result: "unknown", reason: err instanceof Error ? err.message.slice(0, 120) : "request failed" };
  }
  const samples = (body as { samples?: Array<{ form?: unknown }> } | null)?.samples ?? [];
  let checked = 0;
  for (const s of samples) {
    const parsed = FormDefinitionSchema.safeParse(s.form);
    if (!parsed.success || parsed.data.status !== "confirmed" || !parsed.data.confirmed?.mac) continue;
    checked += 1;
    const check = verifyFormConfirmation(parsed.data as FormDefinition);
    if (check.ok) return { result: "match" };
    if (check.reason === "BAD_MAC") return { result: "mismatch" };
  }
  return { result: "unknown", reason: checked ? "no attested sample could be checked" : "no attested sample maps in the response" };
}
