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
import { appendAudit } from "../repos/audit";
import { RepoInputError, type RepoContext } from "../repos/context";
import { putFormFile } from "../repos/form-files";
import { createForm, listFormMeta } from "../repos/forms";

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
  /** Referrer for maps made by the reading (default: "To be confirmed", other). */
  defaultReferrer?: ReferrerInfo;
  now?: Date;
}

export interface LoadFormsFileResult {
  file: string;
  status: "ready" | "loaded" | "skipped" | "refused";
  reason?: string;
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

export async function loadClinicForms(ctx: RepoContext, input: LoadFormsInput): Promise<LoadFormsResult> {
  const tenantId = String(input.tenantId ?? "").trim();
  await requireOpenClinic(ctx.db, tenantId);
  const dir = path.resolve(input.dir);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new RepoInputError(`No folder at ${dir}.`);
  const now = input.now ?? new Date();
  const at = now.toISOString();
  const existing = new Set((await listFormMeta(ctx, tenantId)).map((m) => m.fileSha256));
  const names = fs.readdirSync(dir).filter((n) => !n.startsWith(".")).sort();
  const results: LoadFormsFileResult[] = [];
  const unknownMaps = Object.keys(input.maps).filter((k) => !names.includes(k));
  if (unknownMaps.length) throw new RepoInputError(`The maps file names files that are not in the folder: ${unknownMaps.slice(0, 5).join(", ")}.`);

  for (const name of names) {
    const full = path.join(dir, name);
    if (!fs.statSync(full).isFile()) continue;
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
    if (existing.has(file.sha256)) {
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
    if (!input.confirm) {
      results.push(ready);
      continue;
    }

    const stored = await putFormFile(ctx, tenantId, { bytes: file.bytes, fileName: storedFormFileName(file.mimeType), mimeType: file.mimeType, expectedSha256: file.sha256 });
    const saved = await createForm(ctx, tenantId, {
      id: form.id,
      fileSha256: file.sha256,
      status: "proposed",
      title: form.title.slice(0, 300),
      referrer: form.referrer.name.slice(0, 300),
      kind: form.kind,
      sampleId: null,
      payload: form,
    });
    if (!saved.ok) throw new Error(`The map for ${name} could not be stored (${saved.reason}).`);
    existing.add(file.sha256);
    if (stored.written) {
      await appendAudit(ctx, tenantId, {
        userId: PLATFORM_USER_ID,
        action: "file.upload",
        targetType: "form_file",
        targetId: file.sha256,
        detail: { via: "onboarding", sizeBytes: stored.sizeBytes, chunks: stored.chunkCount, mime: file.mimeType },
      });
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
  if (input.confirm && loaded.length > 0) {
    await appendAudit(ctx, tenantId, {
      userId: PLATFORM_USER_ID,
      action: "clinic.forms_loaded",
      targetType: "clinic",
      targetId: tenantId,
      detail: { forms: loaded.length, refused: results.filter((r) => r.status === "refused").length, skipped: results.filter((r) => r.status === "skipped").length },
    });
  }
  return { tenantId, dryRun: !input.confirm, files: results };
}
