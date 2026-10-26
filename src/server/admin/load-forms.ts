/**
 * Onboarding (10/2026): load a clinic's OWN referrer form templates into its forms library – the files encrypted and
 * stored for that clinic only (form_files + form_file_chunks), each with a PROPOSED map (status "proposed", never
 * confirmed here) so the clinic's own staff check and confirm every map once in their Studio. Used by
 * `npm run admin:load-forms` (scripts/admin/load-forms.ts); preview-only unless confirmed.
 *
 * Per file in the folder (sorted by name; .rtf, .docx, .pdf):
 * 1. Read and checked exactly as an upload is (forms/file.ts decodeFormFile with RTF conversion: type from the bytes,
 *    zip/PDF limits, the RTF size rules – 12 MB with at most 2.5 MB besides pictures); an old .doc is refused with
 *    what to do instead.
 * 2. The map: from the maps JSON (by file name), checked against THIS file – the file's SHA-256 when the map names one
 *    (a map made from another version or another conversion is refused), every Word anchor's place and placeholder
 *    in the document, every PDF field name, and checkFormDefinition(); or, with `readMissing`, the layout-rules reading
 *    (no drafting service, ai/analyse-form.ts) including the clinic-system merge codes. Every map gets the file's
 *    mail-merge fields recorded (analysis.mergeFields – approval stays blocked while one is left), the RTF conversion
 *    notes, and a line saying ClinForms prepared it.
 * 3. With `confirm`: file stored (encrypted, AAD per tenant/chunk; an identical file already stored is reused) and the
 *    map created as a new proposal; a file whose exact bytes are already in the clinic's library is skipped. Audited:
 *    "file.upload" and "form.create" per form, "clinic.forms_loaded" once, all by ClinForms (PLATFORM_USER_ID).
 *
 * `replaceProposed` (10/2026: corrected maps and conversions for forms loaded earlier) – per file, the clinic's forms
 * for the SAME template: the same stored bytes, or the same original file name (case and Unicode form aside) for the
 * same referrer. None → loaded as above. Otherwise they are replaced – the new file stored, the new map created as a
 * fresh proposal, the old forms deleted and their files with them once no other form uses them, in one atomic batch
 * (repos/forms.ts replaceForms) – only when EVERY one of them:
 *  - is still a proposal (never confirmed: status, payload and activity log) and unchanged since it was loaded
 *    (revision 1, no Studio activity on it);
 *  - was loaded by ClinForms (its "form.create"/"form.replace" by PLATFORM_USER_ID via onboarding);
 *  - has never been used by a report: no stored report (draft or approved) completes it, and no activity row names it
 *    (an approval, drafting call or final document names its form – those rows outlive a deleted report);
 *  - is not linked to a referrer in the clinic's settings.
 * Else the file is refused with the reason and nothing is changed. A form of the same file name for ANOTHER referrer
 * is refused too (never a second form per template); a form that already has exactly this file and this map is
 * skipped (a re-run changes nothing). Audited: "form.replace" per form (ids and counts), "clinic.forms_replaced" once.
 * Only the clinic's forms library is touched – never the clinic, its members, invitations, trial or plan.
 *
 * The clinic must exist and be open. Nothing is sent to any service; no patient data is involved (templates only).
 */
import fs from "node:fs";
import path from "node:path";
import type { Kysely } from "kysely";
import { analyseFormFile, parseFormFile } from "../../modules/medreport/ai/analyse-form";
import { storedFormFileName } from "../../modules/medreport/api/store-contract";
import { checkFormDefinition, docxAnchorBlockIds, parseBlockId } from "../../modules/medreport/core/forms";
import { createId } from "../../modules/medreport/core/ids";
import { FormFieldSchema, ReferrerInfoSchema } from "../../modules/medreport/core/schemas";
import type { FormDefinition, FormField, ReferrerInfo } from "../../modules/medreport/core/types";
import { MAX_RTF_FILE_BYTES } from "../../modules/medreport/config.public";
import { HttpError } from "../../modules/medreport/api/http";
import { decodeFormFile, type DecodedFormFile } from "../../modules/medreport/forms/file";
import { findFormMergeFields } from "../../modules/medreport/forms/merge-scan";
import { PLATFORM_USER_ID } from "../auth/create-auth";
import type { Database } from "../db/schema";
import { appendAudit, listAuditAbout } from "../repos/audit";
import { RepoInputError, type RepoContext } from "../repos/context";
import { deleteFormFile, putFormFile } from "../repos/form-files";
import { createForm, getForm, listFormMeta, replaceForms, type FormMeta } from "../repos/forms";
import { countReportsUsingForm } from "../repos/reports";
import { getTenantSettings } from "../repos/tenant-settings";

/** One map in the maps JSON: the fields that matter (anything else – id, status, confirmation – is ignored). */
export interface ProposedMapInput {
  title?: string;
  versionLabel?: string;
  referrer: ReferrerInfo;
  fields: unknown[];
  file?: { sha256?: string; fileName?: string };
  /** Notes for staff (shown with the map). */
  warnings?: string[];
}

export type MapsJson = Record<string, ProposedMapInput>;

export interface LoadFormsInput {
  tenantId: string;
  dir: string;
  /** Maps by file name (parseMapsJson). */
  maps: MapsJson;
  /** Files without a map: propose one with the layout-rules reading (else they are skipped). */
  readMissing?: boolean;
  /** Store (else preview only). */
  confirm?: boolean;
  /** Replace the clinic's unconfirmed, unused forms of the same templates (see the header) instead of skipping them. */
  replaceProposed?: boolean;
  /** Referrer for maps made by the reading (default: "To be confirmed", other). */
  defaultReferrer?: ReferrerInfo;
  now?: Date;
}

export interface LoadFormsFileResult {
  file: string;
  /** "replace" (preview) / "replaced": only with replaceProposed. */
  status: "ready" | "loaded" | "replace" | "replaced" | "skipped" | "refused";
  reason?: string;
  /** replace / replaced: the ids of the forms it replaces. */
  replaces?: string[];
  mapFrom?: "json" | "reading";
  convertedFromRtf?: boolean;
  rtfBytes?: number;
  sizeBytes?: number;
  sha256?: string;
  kind?: FormDefinition["kind"];
  questions?: number;
  fromRecords?: number;
  forStaff?: number;
  mergeFields?: number;
  formId?: string;
}

export interface LoadFormsResult {
  tenantId: string;
  dryRun: boolean;
  replaceProposed: boolean;
  files: LoadFormsFileResult[];
}

const FORM_EXTENSIONS = /\.(rtf|docx|pdf)$/i;
const PREPARED_NOTE = "Prepared by ClinForms when your account was set up – check each question against your form and confirm the mapping once.";

/** The maps file: {"<file name>": map}, {"maps": {…}} or an array of maps naming their file (file.fileName). */
export function parseMapsJson(text: string): MapsJson {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new RepoInputError("The maps file is not valid JSON.");
  }
  const out: MapsJson = {};
  const add = (name: string, value: unknown) => {
    if (!value || typeof value !== "object") throw new RepoInputError(`The map for "${name}" is not an object.`);
    const v = value as Record<string, unknown>;
    const referrer = ReferrerInfoSchema.safeParse(v.referrer);
    if (!referrer.success) throw new RepoInputError(`The map for "${name}" needs a referrer {name, type}.`);
    if (!Array.isArray(v.fields)) throw new RepoInputError(`The map for "${name}" needs a list of fields.`);
    const file = v.file && typeof v.file === "object" ? (v.file as { sha256?: unknown; fileName?: unknown }) : undefined;
    out[name] = {
      ...(typeof v.title === "string" ? { title: v.title } : {}),
      ...(typeof v.versionLabel === "string" ? { versionLabel: v.versionLabel } : {}),
      referrer: referrer.data,
      fields: v.fields,
      ...(file ? { file: { ...(typeof file.sha256 === "string" ? { sha256: file.sha256 } : {}), ...(typeof file.fileName === "string" ? { fileName: file.fileName } : {}) } } : {}),
      ...(Array.isArray(v.warnings) ? { warnings: v.warnings.filter((w): w is string => typeof w === "string").slice(0, 50) } : {}),
    };
  };
  const container = raw && typeof raw === "object" && !Array.isArray(raw) && "maps" in raw ? (raw as { maps: unknown }).maps : raw;
  if (Array.isArray(container)) {
    for (const m of container) {
      const name = (m as { file?: { fileName?: unknown } })?.file?.fileName;
      if (typeof name !== "string" || !name) throw new RepoInputError("Every map in the list must name its file (file.fileName).");
      add(path.basename(name), m);
    }
  } else if (container && typeof container === "object") {
    for (const [name, m] of Object.entries(container as Record<string, unknown>)) add(path.basename(name), m);
  } else {
    throw new RepoInputError("The maps file must hold an object keyed by file name, or a list of maps.");
  }
  return out;
}

async function requireOpenClinic(db: Kysely<Database>, tenantId: string): Promise<void> {
  const org = await db.selectFrom("organization").select(["id", "metadata"]).where("slug", "=", tenantId).executeTakeFirst();
  if (!org) throw new RepoInputError(`No clinic with the id "${tenantId}".`);
  if (org.metadata && /"offboardedAt"/.test(org.metadata)) throw new RepoInputError(`The clinic "${tenantId}" is closed.`);
}

/** Every anchor of the map points at a real place in THIS file (Word block + placeholder text, PDF field). */
async function anchorProblems(file: DecodedFormFile, fields: FormField[]): Promise<string[]> {
  const parsed = await parseFormFile(file);
  const problems: string[] = [];
  if (parsed.kind === "docx") {
    const blocks = new Map(parsed.blocks.map((b) => [b.id, b] as const));
    const blockOf = (id: string) => blocks.get(id) ?? blocks.get(id.replace(/\.p\d+$/, ""));
    for (const f of fields) {
      if (f.anchor.kind !== "docx") continue;
      const ids = docxAnchorBlockIds(f.anchor);
      for (const id of Array.from(new Set([...ids, f.anchor.blockId]))) {
        const block = parseBlockId(id) ? blockOf(id) : undefined;
        if (!block) problems.push(`${f.id} (“${f.label}”): the place ${id} is not in this file.`);
        else if ((f.anchor.target === "replace_placeholder" || f.anchor.target === "delete_options") && f.anchor.placeholderText && block.text.indexOf(f.anchor.placeholderText) < 0) {
          problems.push(`${f.id} (“${f.label}”): “${f.anchor.placeholderText}” is not printed at ${id}.`);
        }
      }
      // 10/2026: every option line of a "delete as necessary" list is printed where the map says.
      if (f.anchor.target === "delete_options" && !f.anchor.placeholderText) {
        for (const o of f.anchor.optionTexts ?? []) {
          const block = parseBlockId(o.blockId) ? blockOf(o.blockId) : undefined;
          if (block && block.text.indexOf(o.text) < 0) problems.push(`${f.id} (“${f.label}”): “${o.text}” is not printed at ${o.blockId}.`);
        }
      }
    }
  } else {
    const names = new Set(parsed.pdf.fields.map((x) => x.name));
    for (const f of fields) {
      const wanted =
        f.anchor.kind === "pdf_field"
          ? [f.anchor.fieldName, ...(f.anchor.optionFields ?? []).map((o) => o.fieldName)]
          : f.anchor.kind === "pdf_char_fields"
            ? f.anchor.fieldNames
            : f.anchor.kind === "pdf_table"
              ? f.anchor.rows.flatMap((r) => Object.values(r))
              : [];
      for (const n of wanted) if (!names.has(n)) problems.push(`${f.id} (“${f.label}”): the field “${n}” is not in this PDF.`);
    }
  }
  return problems;
}

function countSources(form: FormDefinition): { fromRecords: number; forStaff: number } {
  let fromRecords = 0;
  let forStaff = 0;
  for (const f of form.fields) {
    if (f.fillSource.kind !== "registration") continue;
    if (f.fillSource.path === "staff.entry") forStaff += 1;
    else fromRecords += 1;
  }
  return { fromRecords, forStaff };
}

/** A form in the clinic's library, its map decrypted (null when it cannot be read: such a form is never replaced). */
interface LibraryForm {
  meta: FormMeta;
  form: FormDefinition | null;
}

async function readLibrary(ctx: RepoContext, tenantId: string): Promise<LibraryForm[]> {
  const out: LibraryForm[] = [];
  for (const meta of await listFormMeta(ctx, tenantId)) {
    let form: FormDefinition | null = null;
    try {
      const record = await getForm<FormDefinition>(ctx, tenantId, meta.id);
      form = record?.payload && typeof record.payload === "object" && record.payload.file && record.payload.referrer ? record.payload : null;
    } catch {
      form = null;
    }
    out.push({ meta, form });
  }
  return out;
}

/** File names: the same apart from case and Unicode form (macOS keeps names decomposed; its disks ignore case). */
const sameFileName = (a: string, b: string) => a.normalize("NFC").toLowerCase() === b.normalize("NFC").toLowerCase();
/** Referrer names: the same apart from case, Unicode form and spacing. */
const sameReferrer = (a: string, b: string) => {
  const norm = (t: string) => t.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
  return norm(a) === norm(b);
};

/** JSON with sorted keys (and no undefined values): two maps compare equal whatever order their keys were built in. */
function stableJson(value: unknown): string {
  const norm = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(norm)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v as Record<string, unknown>)
              .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
              .sort()
              .map((k) => [k, norm((v as Record<string, unknown>)[k])]),
          )
        : v;
  return JSON.stringify(norm(value));
}

/** What a re-run would change: the file, the map and its notes (not ids, timestamps or the analysis time). */
function mapContent(form: FormDefinition): string {
  return stableJson({
    title: form.title,
    versionLabel: form.versionLabel,
    referrer: form.referrer,
    kind: form.kind,
    file: form.file,
    fields: form.fields,
    mode: form.analysis.mode,
    promptVersion: form.analysis.promptVersion,
    warnings: form.analysis.warnings,
    mergeFields: form.analysis.mergeFields ?? [],
  });
}

const CONFIRM_ACTIONS = new Set(["form.confirm", "form.store_confirmed"]);

/** Why this form must be kept as it is (never replaced), or null when it may be replaced. */
async function keepReason(ctx: RepoContext, tenantId: string, entry: LibraryForm, linked: ReadonlySet<string>): Promise<string | null> {
  const id = entry.meta.id;
  const kept = "it is kept as it is";
  if (!entry.form) return `The form ${id} in the library could not be read: ${kept}.`;
  if (entry.meta.status !== "proposed" || entry.form.status !== "proposed" || entry.form.confirmed) {
    return `The form ${id} in the library has been confirmed by the clinic: ${kept} (any change is made in the Studio).`;
  }
  if (entry.meta.rev !== 1) return `The form ${id} in the library was changed in the clinic's Studio after it was loaded (revision ${entry.meta.rev}): ${kept}.`;
  const reports = await countReportsUsingForm(ctx, tenantId, id);
  if (reports > 0) return `The form ${id} in the library is used by ${reports} ${reports === 1 ? "report" : "reports"} (draft or approved): ${kept}.`;
  const trail = await listAuditAbout(ctx, tenantId, id, { limit: 200 });
  const own = trail.filter(
    (e) => e.targetId === id && (e.action === "form.create" || e.action === "form.replace") && e.userId === PLATFORM_USER_ID && e.detail?.via === "onboarding",
  );
  if (own.length === 0) return `The form ${id} in the library was added in the clinic's Studio, not loaded by ClinForms: ${kept}.`;
  const other = trail.filter((e) => !own.includes(e));
  if (other.some((e) => CONFIRM_ACTIONS.has(e.action))) return `The form ${id} in the library was confirmed once (activity log): ${kept}.`;
  if (other.some((e) => e.action.startsWith("report."))) return `The form ${id} in the library has been used for a report (activity log): ${kept}.`;
  if (other.length > 0) return `The form ${id} in the library was changed in the clinic's Studio after it was loaded (activity log): ${kept}.`;
  if (linked.has(id)) return `The form ${id} in the library is linked to a referrer in the clinic's settings: ${kept}.`;
  return null;
}

type ReplacePlan = { action: "load" } | { action: "replace"; targets: LibraryForm[] } | { action: "skip" | "refuse"; reason: string };

/** replaceProposed: the clinic's forms for the same template as this file (and its new map), and what to do. */
async function planReplace(ctx: RepoContext, tenantId: string, library: LibraryForm[], linked: ReadonlySet<string>, name: string, form: FormDefinition): Promise<ReplacePlan> {
  const sameName = (e: LibraryForm) => e.form !== null && sameFileName(e.form.file.fileName, name);
  const targets = library.filter((e) => e.meta.fileSha256 === form.file.sha256 || (sameName(e) && sameReferrer(e.form?.referrer.name ?? "", form.referrer.name)));
  const otherReferrer = library.find((e) => !targets.includes(e) && sameName(e));
  if (otherReferrer) {
    return {
      action: "refuse",
      reason: `The library holds ${otherReferrer.meta.id}, loaded from a file of this name for another referrer: nothing is replaced (rename the file, or remove that form in the Studio first).`,
    };
  }
  if (targets.length === 0) return { action: "load" };
  if (targets.length > 20) return { action: "refuse", reason: `${targets.length} forms in the library match this file: nothing is replaced.` };
  for (const target of targets) {
    const why = await keepReason(ctx, tenantId, target, linked);
    if (why) return { action: "refuse", reason: why };
  }
  if (targets.length === 1 && targets[0].form && mapContent(targets[0].form) === mapContent(form)) {
    return { action: "skip", reason: `The form ${targets[0].meta.id} in the library already has this file and this map.` };
  }
  return { action: "replace", targets };
}

export async function loadClinicForms(ctx: RepoContext, input: LoadFormsInput): Promise<LoadFormsResult> {
  const tenantId = String(input.tenantId ?? "").trim();
  await requireOpenClinic(ctx.db, tenantId);
  const dir = path.resolve(input.dir);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new RepoInputError(`No folder at ${dir}.`);
  const now = input.now ?? new Date();
  const at = now.toISOString();
  const replace = input.replaceProposed === true;
  const existing = new Set((await listFormMeta(ctx, tenantId)).map((m) => m.fileSha256));
  // replaceProposed: the library with its maps, and the forms the clinic's referrer links point at.
  const library = replace ? await readLibrary(ctx, tenantId) : [];
  const links = replace ? ((await getTenantSettings<Record<string, unknown>>(ctx, tenantId))?.referrerLinks ?? {}) : {};
  const linked = new Set(Object.values(links && typeof links === "object" ? links : {}).filter((v): v is string => typeof v === "string"));
  const names = fs.readdirSync(dir).filter((n) => !n.startsWith(".")).sort();
  const results: LoadFormsFileResult[] = [];
  const unknownMaps = Object.keys(input.maps).filter((k) => !names.includes(k));
  if (unknownMaps.length) throw new RepoInputError(`The maps file names files that are not in the folder: ${unknownMaps.slice(0, 5).join(", ")}.`);

  for (const name of names) {
    const full = path.join(dir, name);
    const entry = fs.lstatSync(full);
    if (entry.isSymbolicLink()) {
      // Security fix 24/10/2026: a link is never followed (it could point anywhere on the operator's machine).
      results.push({ file: name, status: "skipped", reason: "A symbolic link: not followed. Copy the file itself into the folder." });
      continue;
    }
    if (!entry.isFile()) continue;
    if (/\.doc$/i.test(name)) {
      results.push({ file: name, status: "refused", reason: "An older Word .doc file: open it in Word (or Pages) and save it as a Word Document (.docx) or Rich Text Format (.rtf) first." });
      continue;
    }
    if (!FORM_EXTENSIONS.test(name)) {
      results.push({ file: name, status: "skipped", reason: "Not a form file (.rtf, .docx or .pdf)." });
      continue;
    }
    const size = fs.statSync(full).size;
    if (size > MAX_RTF_FILE_BYTES) {
      results.push({ file: name, status: "refused", reason: `The file is ${(size / 1048576).toFixed(1)} MB; the largest accepted is 12 MB (RTF with pictures) or 2.5 MB (Word, PDF).` });
      continue;
    }
    let file: DecodedFormFile;
    try {
      file = decodeFormFile(fs.readFileSync(full).toString("base64"), { convertRtf: true });
    } catch (err) {
      const detail = err instanceof HttpError ? `${err.message}: ${err.init.detail ?? ""}`.replace(/: $/, "") : err instanceof Error ? err.message : String(err);
      results.push({ file: name, status: "refused", reason: detail });
      continue;
    }
    const base: LoadFormsFileResult = {
      file: name,
      status: "ready",
      sha256: file.sha256,
      sizeBytes: file.sizeBytes,
      ...(file.convertedFrom ? { convertedFromRtf: true, rtfBytes: file.convertedFrom.sizeBytes } : {}),
    };
    if (!replace && existing.has(file.sha256)) {
      results.push({ ...base, status: "skipped", reason: "This exact file is already in the clinic's forms library." });
      continue;
    }

    // The proposed map.
    let form: FormDefinition;
    const mapped = input.maps[name];
    if (mapped) {
      if (mapped.file?.sha256 && mapped.file.sha256 !== file.sha256) {
        results.push({ ...base, status: "refused", mapFrom: "json", reason: "The map was made from another version of this file (or another conversion of it): make the map again from this file." });
        continue;
      }
      const fields: FormField[] = [];
      const problems: string[] = [];
      mapped.fields.forEach((raw, i) => {
        const parsed = FormFieldSchema.safeParse(raw);
        if (parsed.success) fields.push(parsed.data);
        else problems.push(`Field ${i + 1}: ${parsed.error.issues[0]?.path.join(".") ?? ""} ${parsed.error.issues[0]?.message ?? "is not valid"}`.trim());
      });
      const kind = (await parseFormFile(file)).kind;
      form = {
        id: createId("frm"),
        tenantId,
        referrer: mapped.referrer,
        title: (mapped.title ?? name.replace(FORM_EXTENSIONS, "")).slice(0, 200) || "Referrer form",
        ...(mapped.versionLabel ? { versionLabel: mapped.versionLabel.slice(0, 60) } : {}),
        file: { fileName: name, mimeType: file.mimeType, sha256: file.sha256, sizeBytes: file.sizeBytes },
        kind,
        fields,
        status: "proposed",
        analysis: { mode: "demo_prewritten", promptVersion: "onboarding-1", at, warnings: [PREPARED_NOTE, ...(mapped.warnings ?? [])] },
        createdAt: at,
        updatedAt: at,
      };
      problems.push(...checkFormDefinition(form), ...(problems.length ? [] : await anchorProblems(file, fields)));
      if (problems.length) {
        results.push({ ...base, status: "refused", mapFrom: "json", reason: `The map does not fit this file: ${problems.slice(0, 5).join(" ")}${problems.length > 5 ? ` (and ${problems.length - 5} more)` : ""}` });
        continue;
      }
    } else if (input.readMissing) {
      const read = await analyseFormFile({
        file,
        fileName: name,
        mode: "demo",
        rulesOnly: true,
        tenantId,
        referrer: input.defaultReferrer,
        now,
      });
      form = { ...read.form, analysis: { ...read.form.analysis, warnings: [PREPARED_NOTE, ...read.form.analysis.warnings] } };
    } else {
      results.push({ ...base, status: "skipped", reason: "No map for this file in the maps file (add one, or use --read-missing)." });
      continue;
    }
    // Verify fix (10/2026): a map without a single question is never loaded – staff could not confirm it, and the file
    // is usually a form kept in drawn text boxes (left out when an RTF file is converted), i.e. it came out empty.
    if (form.fields.length === 0) {
      results.push({
        ...base,
        status: "refused",
        mapFrom: mapped ? "json" : "reading",
        reason: "No questions were found in this file (a form kept in drawn text boxes is left out when an RTF file is converted): keep it in the clinic system, or use a version without text boxes.",
      });
      continue;
    }
    // Every map: the file's mail-merge fields (approval stays blocked while one is left) and the RTF notes.
    const mergeFields = await findFormMergeFields(file);
    const notes = file.convertedFrom?.notes ?? [];
    form = {
      ...form,
      analysis: {
        ...form.analysis,
        warnings: [...notes, ...form.analysis.warnings.filter((w) => !notes.includes(w))],
        ...(mergeFields.length ? { mergeFields } : {}),
      },
    };
    const counts = countSources(form);
    const ready: LoadFormsFileResult = {
      ...base,
      mapFrom: mapped ? "json" : "reading",
      kind: form.kind,
      questions: form.fields.length,
      ...counts,
      mergeFields: mergeFields.length,
    };
    const plan: ReplacePlan = replace ? await planReplace(ctx, tenantId, library, linked, name, form) : { action: "load" };
    if (plan.action === "skip" || plan.action === "refuse") {
      results.push({ ...ready, status: plan.action === "skip" ? "skipped" : "refused", reason: plan.reason });
      continue;
    }
    const replaces = plan.action === "replace" ? plan.targets.map((t) => t.meta.id) : undefined;
    if (!input.confirm) {
      results.push(replaces ? { ...ready, status: "replace", replaces } : ready);
      continue;
    }

    const stored = await putFormFile(ctx, tenantId, { bytes: file.bytes, fileName: storedFormFileName(file.mimeType), mimeType: file.mimeType, expectedSha256: file.sha256 });
    const row = {
      id: form.id,
      fileSha256: file.sha256,
      status: "proposed",
      title: form.title.slice(0, 300),
      referrer: form.referrer.name.slice(0, 300),
      kind: form.kind,
      sampleId: null,
      payload: form,
    };
    let filesDeleted = 0;
    if (plan.action === "replace") {
      const swapped = await replaceForms(ctx, tenantId, {
        replace: plan.targets.map((t) => ({ id: t.meta.id, rev: t.meta.rev, status: t.meta.status })),
        form: row,
        dropUnusedFiles: plan.targets.map((t) => t.meta.fileSha256),
      });
      if (!swapped.ok) {
        // Changed by the clinic while this ran: nothing was replaced. A file stored just now for it goes again.
        if (stored.written && !(await listFormMeta(ctx, tenantId)).some((m) => m.fileSha256 === file.sha256)) await deleteFormFile(ctx, tenantId, file.sha256);
        results.push({ ...ready, status: "refused", replaces, reason: "The clinic's form changed while it was being replaced: nothing was replaced. Run the preview again." });
        continue;
      }
      filesDeleted = swapped.filesDeleted;
      for (const t of plan.targets) library.splice(library.indexOf(t), 1);
    } else {
      const saved = await createForm(ctx, tenantId, row);
      if (!saved.ok) throw new Error(`The map for ${name} could not be stored (${saved.reason}).`);
    }
    existing.add(file.sha256);
    if (replace) {
      library.push({
        meta: { tenantId, id: form.id, rev: 1, fileSha256: file.sha256, status: "proposed", title: row.title, referrer: row.referrer, kind: form.kind, sampleId: null, createdAt: at, updatedAt: at },
        form,
      });
    }
    if (stored.written) {
      await appendAudit(ctx, tenantId, {
        userId: PLATFORM_USER_ID,
        action: "file.upload",
        targetType: "form_file",
        targetId: file.sha256,
        detail: { via: "onboarding", sizeBytes: stored.sizeBytes, chunks: stored.chunkCount, mime: file.mimeType },
      });
    }
    if (replaces) {
      await appendAudit(ctx, tenantId, {
        userId: PLATFORM_USER_ID,
        action: "form.replace",
        targetType: "form",
        targetId: form.id,
        detail: { via: "onboarding", status: "proposed", replaces, fields: form.fields.length, kind: form.kind, mapFrom: mapped ? "json" : "reading", filesDeleted },
      });
      results.push({ ...ready, status: "replaced", replaces, formId: form.id });
      continue;
    }
    await appendAudit(ctx, tenantId, {
      userId: PLATFORM_USER_ID,
      action: "form.create",
      targetType: "form",
      targetId: form.id,
      detail: { via: "onboarding", status: "proposed", fields: form.fields.length, kind: form.kind, mapFrom: mapped ? "json" : "reading" },
    });
    results.push({ ...ready, status: "loaded", formId: form.id });
  }

  const loaded = results.filter((r) => r.status === "loaded");
  const replacedCount = results.filter((r) => r.status === "replaced").length;
  if (input.confirm && replace) {
    if (loaded.length + replacedCount > 0) {
      await appendAudit(ctx, tenantId, {
        userId: PLATFORM_USER_ID,
        action: "clinic.forms_replaced",
        targetType: "clinic",
        targetId: tenantId,
        detail: {
          replaced: replacedCount,
          forms: loaded.length,
          refused: results.filter((r) => r.status === "refused").length,
          skipped: results.filter((r) => r.status === "skipped").length,
        },
      });
    }
  } else if (input.confirm && loaded.length > 0) {
    await appendAudit(ctx, tenantId, {
      userId: PLATFORM_USER_ID,
      action: "clinic.forms_loaded",
      targetType: "clinic",
      targetId: tenantId,
      detail: { forms: loaded.length, refused: results.filter((r) => r.status === "refused").length, skipped: results.filter((r) => r.status === "skipped").length },
    });
  }
  return { tenantId, dryRun: !input.confirm, replaceProposed: replace, files: results };
}
