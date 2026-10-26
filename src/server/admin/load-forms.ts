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
 * skipped (a re-run changes nothing), and so is a file without a map whose form was made from one (a layout reading
 * never replaces a map). One file per template: a second file in the folder with the same bytes or the same name
 * (case and Unicode form aside), or matching a form an earlier file already matched, is refused – in the preview
 * exactly as with --confirm. The run is refused as a whole when a form in the library cannot be read (the data
 * keys of this database): its template could not be recognised. The batch re-checks every rule (replaceForms), so
 * a form the clinic – or a second run at the same time – changed, used or removed meanwhile is refused, never
 * duplicated. Audited in that same batch: "form.replace" per form (ids and counts) and "file.upload" for a new
 * file; "clinic.forms_replaced" once per run. Only the clinic's forms library is touched – never the clinic, its
 * members, invitations, trial or plan.
 *
 * The clinic must exist and be open. Nothing is sent to any service; no patient data is involved (templates only).
 *
 * bh2 WE design 1 (D-1 … D-13, B3-9, B0-14):
 * - every map records where it came from: file.sourceSha256 (the SHA-256 of the file in the folder – an RTF template
 *   before conversion), analysis.convertedWith (the converter version, for a converted file) and analysis.printedLeads
 *   (the words printed before each "…" blank, read from the template) – at load and at replace;
 * - the map lint (core/form-map-lint.ts, L1–L12) runs before anything is written: a map from the maps file with a
 *   finding is refused, unless the field's lintAccepted names that rule with a reason (recorded in the audit row); a
 *   layout reading (--read-missing) is a proposal the clinic's staff check, so its findings are listed, never refused;
 * - a map pins its file by file.sourceSha256 (the file as supplied) or by the current conversion's file.sha256;
 * - a replace target's revision is what ClinForms' own loads account for (1 per "form.create"/"form.replace" of it):
 *   any other revision means a save that wrote no audit row, and the form is kept;
 * - with confirm, the clinic's own rows are read before and after (organization, members, invitations, profile, plan,
 *   package, usage, member profiles, settings, reports): `invariants` says whether any of them changed (the CLI exits
 *   non-zero), because the tool never touches them;
 * - `restore` (the rollback: the same command with the earlier maps, e.g. maps-v1): maps exactly as they were – their
 *   lint findings are listed, not refused, and a pin to an earlier converter's output is accepted when every anchor
 *   fits this conversion (the anchors are always checked). Only forms nobody has touched are replaced, as always.
 */
import fs from "node:fs";
import path from "node:path";
import type { Kysely } from "kysely";
import { analyseFormFile, parseFormFile } from "../../modules/medreport/ai/analyse-form";
import { storedFormFileName } from "../../modules/medreport/api/store-contract";
import { checkFormDefinition, docxAnchorBlockIds, parseBlockId } from "../../modules/medreport/core/forms";
import { BLANK_PLACEHOLDER, PREPARED_NOTE, lintErrors, lintFormMap, lintSummary, printedLeadIn, type LintIssue } from "../../modules/medreport/core/form-map-lint";
import { RTF_CONVERTER_VERSION } from "../../modules/medreport/core/rtf";
import { createHash } from "node:crypto";
import { createId } from "../../modules/medreport/core/ids";
import { FormFieldSchema, GUIDANCE_VERSION, ReferrerInfoSchema } from "../../modules/medreport/core/schemas";
import type { FormDefinition, FormField, ReferrerInfo } from "../../modules/medreport/core/types";
import { MAX_RTF_FILE_BYTES } from "../../modules/medreport/config.public";
import { HttpError } from "../../modules/medreport/api/http";
import { decodeFormFile, type DecodedFormFile } from "../../modules/medreport/forms/file";
import { findFormMergeFields } from "../../modules/medreport/forms/merge-scan";
import { PLATFORM_USER_ID } from "../auth/create-auth";
import type { Database } from "../db/schema";
import { appendAudit, listAuditAbout, type AuditEntryInput } from "../repos/audit";
import { RepoInputError, type RepoContext } from "../repos/context";
import { deleteFormFileIfUnused, putFormFile } from "../repos/form-files";
import { MAX_REPLACED_FORMS, createForm, getForm, listFormMeta, replaceForms, type FormMeta } from "../repos/forms";
import { countReportsUsingForm } from "../repos/reports";
import { getTenantSettings } from "../repos/tenant-settings";

/** One map in the maps JSON: the fields that matter (anything else – id, status, confirmation – is ignored). */
export interface ProposedMapInput {
  title?: string;
  versionLabel?: string;
  referrer: ReferrerInfo;
  fields: unknown[];
  /** The pin: the source file's SHA-256 (sourceSha256), or the conversion's (sha256). */
  file?: { sha256?: string; sourceSha256?: string; fileName?: string };
  /** Notes for staff (shown with the map). */
  warnings?: string[];
  /** The map's guidance is written in this release's wording (analysis.guidanceVersion; v2 maps say 2). */
  guidanceVersion?: number;
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
  /** Restore maps exactly as they were (the rollback; see the header): lint findings listed, an earlier converter's pin accepted. */
  restore?: boolean;
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
  /** The map lint's findings: rule@field ids only (never the form's wording). Errors refuse a map from the maps file. */
  lint?: { errors: string[]; accepted: string[] };
}

export interface LoadFormsResult {
  tenantId: string;
  dryRun: boolean;
  replaceProposed: boolean;
  restore?: boolean;
  files: LoadFormsFileResult[];
  /** With confirm: the clinic's own rows before and after (they never change; `changed` names the tables that did). */
  invariants?: { ok: boolean; changed: string[] };
}

const FORM_EXTENSIONS = /\.(rtf|docx|pdf)$/i;

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
    const file = v.file && typeof v.file === "object" ? (v.file as { sha256?: unknown; sourceSha256?: unknown; fileName?: unknown }) : undefined;
    out[name] = {
      ...(typeof v.title === "string" ? { title: v.title } : {}),
      ...(typeof v.versionLabel === "string" ? { versionLabel: v.versionLabel } : {}),
      referrer: referrer.data,
      fields: v.fields,
      ...(file
        ? {
            file: {
              ...(typeof file.sha256 === "string" ? { sha256: file.sha256 } : {}),
              ...(typeof file.sourceSha256 === "string" ? { sourceSha256: file.sourceSha256 } : {}),
              ...(typeof file.fileName === "string" ? { fileName: file.fileName } : {}),
            },
          }
        : {}),
      ...(Array.isArray(v.warnings) ? { warnings: v.warnings.filter((w): w is string => typeof w === "string").slice(0, 50) } : {}),
      ...(typeof v.guidanceVersion === "number" && Number.isInteger(v.guidanceVersion) && v.guidanceVersion >= 1 ? { guidanceVersion: v.guidanceVersion } : {}),
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
async function anchorProblems(parsed: Awaited<ReturnType<typeof parseFormFile>>, fields: FormField[]): Promise<string[]> {
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

/** The template's printed text per Word block (the map lint's L8, and the printed leads). Null for a PDF. */
function blockTextOf(parsed: Awaited<ReturnType<typeof parseFormFile>>): ((id: string) => string | null) | undefined {
  if (parsed.kind !== "docx") return undefined;
  const blocks = new Map(parsed.blocks.map((b) => [b.id, b.text] as const));
  return (id: string) => blocks.get(id) ?? blocks.get(id.replace(/\.p\d+$/, "")) ?? null;
}

/**
 * The words printed before each "…" blank the map fills (analysis.printedLeads, WE design 1): read from the template,
 * keyed by field id, for the drafting checks (an answer never repeats the printed verb – D-11, D-A10).
 */
export function printedLeadsOf(fields: readonly FormField[], blockText: ((id: string) => string | null) | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!blockText) return out;
  // Two blanks in one block (“To return to … in … sessions”): each question's lead is read before its own blank, in
  // the order the questions fill them (as the fill does).
  const seen = new Map<string, number>();
  for (const f of fields) {
    if (f.anchor.kind !== "docx" || f.anchor.target !== "replace_placeholder" || f.anchor.writeAfter || !f.anchor.placeholderText) continue;
    if (!BLANK_PLACEHOLDER.test(f.anchor.placeholderText)) continue;
    const key = `${f.anchor.blockId}\u0000${f.anchor.placeholderText}`;
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    const text = blockText(f.anchor.blockId);
    const lead = text ? printedLeadIn(text, f.anchor.placeholderText, occurrence) : null;
    if (lead) out[f.id] = lead.slice(0, 200);
  }
  return out;
}

/** The clinic's own rows, which the tool never changes (WE design 1: read before and after a confirmed run). */
const INVARIANT_TABLES = ["organization", "member", "invitation", "clinic_profile", "clinic_plan", "clinic_package", "clinic_usage", "usage_report", "usage_event", "member_profile", "tenant_settings", "reports"] as const;

/** A digest per invariant table of the clinic's rows (sorted, so the order a database returns them in does not matter). */
export async function clinicFingerprint(db: Kysely<Database>, tenantId: string): Promise<Record<(typeof INVARIANT_TABLES)[number], string>> {
  const digest = (rows: unknown[]) =>
    createHash("sha256")
      .update(JSON.stringify(rows.map((r) => JSON.stringify(r, (_k, v: unknown) => (v instanceof Date ? v.toISOString() : typeof v === "bigint" ? v.toString() : v))).sort()))
      .digest("hex");
  const org = await db.selectFrom("organization").selectAll().where("slug", "=", tenantId).execute();
  const orgIds = org.map((o) => o.id);
  const byOrg = async (table: "member" | "invitation") => (orgIds.length ? await db.selectFrom(table).selectAll().where("organizationId", "in", orgIds).execute() : []);
  const byTenant = async (table: "clinic_profile" | "clinic_plan" | "clinic_package" | "clinic_usage" | "usage_report" | "usage_event" | "tenant_settings") =>
    db.selectFrom(table).selectAll().where("tenant_id", "=", tenantId).execute();
  return {
    organization: digest(org),
    member: digest(await byOrg("member")),
    invitation: digest(await byOrg("invitation")),
    clinic_profile: digest(await byTenant("clinic_profile")),
    clinic_plan: digest(await byTenant("clinic_plan")),
    clinic_package: digest(await byTenant("clinic_package")),
    clinic_usage: digest(await byTenant("clinic_usage")),
    usage_report: digest(await byTenant("usage_report")),
    usage_event: digest(await byTenant("usage_event")),
    member_profile: digest(orgIds.length ? await db.selectFrom("member_profile").selectAll().where("organization_id", "in", orgIds).execute() : []),
    tenant_settings: digest(await byTenant("tenant_settings")),
    reports: digest(await db.selectFrom("reports").select(["id", "rev", "status", "form_id", "template_id", "created_at", "updated_at"]).where("tenant_id", "=", tenantId).execute()),
  };
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

/** A form in the clinic's library with its map decrypted. */
interface LibraryForm {
  meta: FormMeta;
  form: FormDefinition;
}

/** The clinic's forms with their maps; the ids of any whose map cannot be read (decrypted and parsed). */
async function readLibrary(ctx: RepoContext, tenantId: string): Promise<{ forms: LibraryForm[]; unreadable: string[] }> {
  const forms: LibraryForm[] = [];
  const unreadable: string[] = [];
  for (const meta of await listFormMeta(ctx, tenantId)) {
    let form: FormDefinition | null = null;
    try {
      const record = await getForm<FormDefinition>(ctx, tenantId, meta.id);
      form = record?.payload && typeof record.payload === "object" && record.payload.file && record.payload.referrer ? record.payload : null;
    } catch {
      form = null;
    }
    if (form) forms.push({ meta, form });
    else unreadable.push(meta.id);
  }
  return { forms, unreadable };
}

/** File names: the same apart from case and Unicode form (macOS keeps names decomposed; its disks ignore case). */
const fileNameKey = (name: string) => name.normalize("NFC").toLowerCase();
const sameFileName = (a: string, b: string) => fileNameKey(a) === fileNameKey(b);
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
    convertedWith: form.analysis.convertedWith,
    printedLeads: form.analysis.printedLeads ?? {},
    guidanceVersion: form.analysis.guidanceVersion,
  });
}

const CONFIRM_ACTIONS = new Set(["form.confirm", "form.store_confirmed"]);

/** What the replace rule found for one form of the library. */
type TargetCheck =
  | { keep: string }
  | {
      keep: null;
      /** Every "form.create"/"form.replace" that made it says it was made by the layout reading (no map). */
      madeByReading: boolean;
      /** The audit rows targeting or naming it (the batch replaces it only while there are exactly these). */
      trailIds: string[];
    };

/** Why this form must be kept as it is (never replaced) – or what replacing it has to know. */
async function checkTarget(ctx: RepoContext, tenantId: string, entry: LibraryForm, linksText: string): Promise<TargetCheck> {
  const id = entry.meta.id;
  const kept = "it is kept as it is";
  const keep = (reason: string): TargetCheck => ({ keep: `The form ${id} in the library ${reason}: ${kept}.` });
  if (entry.meta.status !== "proposed" || entry.form.status !== "proposed" || entry.form.confirmed) {
    return { keep: `The form ${id} in the library has been confirmed by the clinic: ${kept} (any change is made in the Studio).` };
  }
  if (entry.meta.rev !== 1) return keep(`was changed in the clinic's Studio after it was loaded (revision ${entry.meta.rev})`);
  const reports = await countReportsUsingForm(ctx, tenantId, id);
  if (reports > 0) return keep(`is used by ${reports} ${reports === 1 ? "report" : "reports"} (draft or approved)`);
  const trail = await listAuditAbout(ctx, tenantId, id, { limit: 200 });
  // Another run replaced it after this run read the library (two runs at the same time): say so, not "changed".
  const replacedBy = trail.find((e) => e.action === "form.replace" && e.targetId !== id && Array.isArray(e.detail?.replaces) && e.detail.replaces.includes(id));
  if (replacedBy) {
    return { keep: `The form ${id} in the library was replaced meanwhile by ${replacedBy.targetId} (another run): nothing is done for this file. Run the preview again.` };
  }
  const own = trail.filter(
    (e) => e.targetId === id && (e.action === "form.create" || e.action === "form.replace") && e.userId === PLATFORM_USER_ID && e.detail?.via === "onboarding",
  );
  if (own.length === 0) return keep("was added in the clinic's Studio, not loaded by ClinForms");
  // WE design 1: its revision is what ClinForms' own loads account for (one per load of this form id) – any other
  // revision is a save that wrote no audit row.
  if (entry.meta.rev !== own.length) return keep(`has revision ${entry.meta.rev}, but ClinForms loaded it ${own.length === 1 ? "once" : `${own.length} times`} (a change without an activity row)`);
  const other = trail.filter((e) => !own.includes(e));
  if (other.some((e) => CONFIRM_ACTIONS.has(e.action))) return keep("was confirmed once (activity log)");
  if (other.some((e) => e.action.startsWith("report."))) return keep("has been used for a report (activity log)");
  if (other.length > 0) return keep("was changed in the clinic's Studio after it was loaded (activity log)");
  // The same test as the batch's (the stored links' JSON names the id; ASCII case aside, as SQLite's LIKE).
  if (linksText.includes(JSON.stringify(id).toLowerCase())) return keep("is linked to a referrer in the clinic's settings");
  return { keep: null, madeByReading: own.every((e) => e.detail?.mapFrom === "reading"), trailIds: trail.map((e) => e.id) };
}

type ReplacePlan =
  | { action: "load" }
  | { action: "replace"; targets: LibraryForm[]; auditRowsAbout: number }
  | { action: "skip"; reason: string; targets: LibraryForm[] }
  | { action: "refuse"; reason: string };

/** replaceProposed: the clinic's forms for the same template as this file (and its new map), and what to do. */
async function planReplace(
  ctx: RepoContext,
  tenantId: string,
  library: LibraryForm[],
  linksText: string,
  claimed: ReadonlyMap<string, string>,
  name: string,
  form: FormDefinition,
  mapFrom: "json" | "reading",
): Promise<ReplacePlan> {
  const sameName = (e: LibraryForm) => sameFileName(e.form.file.fileName, name);
  const targets = library.filter((e) => e.meta.fileSha256 === form.file.sha256 || (sameName(e) && sameReferrer(e.form.referrer.name, form.referrer.name)));
  const otherReferrer = library.find((e) => !targets.includes(e) && sameName(e));
  if (otherReferrer) {
    return {
      action: "refuse",
      reason: `The library holds ${otherReferrer.meta.id}, loaded from a file of this name for another referrer: nothing is replaced (rename the file, or remove that form in the Studio first).`,
    };
  }
  if (targets.length === 0) return { action: "load" };
  const taken = targets.find((t) => claimed.has(t.meta.id));
  if (taken) {
    return {
      action: "refuse",
      reason: `The form ${taken.meta.id} in the library is already matched by ${claimed.get(taken.meta.id)} in this folder: one file per template, nothing is done for this file.`,
    };
  }
  if (targets.length > MAX_REPLACED_FORMS) return { action: "refuse", reason: `${targets.length} forms in the library match this file (at most ${MAX_REPLACED_FORMS} are replaced at once): nothing is replaced.` };
  const trail = new Set<string>();
  let madeByReading = true;
  for (const target of targets) {
    const check = await checkTarget(ctx, tenantId, target, linksText);
    if (check.keep !== null) return { action: "refuse", reason: check.keep };
    madeByReading &&= check.madeByReading;
    for (const id of check.trailIds) trail.add(id);
  }
  // Review fix (10/2026): a layout reading (--read-missing, no map for this file) never replaces a map made by hand.
  if (mapFrom === "reading" && !madeByReading) {
    return {
      action: "skip",
      targets,
      reason: `No map for this file in the maps file: the form ${targets.map((t) => t.meta.id).join(", ")} in the library was made from a map, which a layout reading never replaces (add this file's map to the maps file).`,
    };
  }
  if (targets.length === 1 && mapContent(targets[0].form) === mapContent(form)) {
    return { action: "skip", targets, reason: `The form ${targets[0].meta.id} in the library already has this file and this map.` };
  }
  return { action: "replace", targets, auditRowsAbout: trail.size };
}

export async function loadClinicForms(ctx: RepoContext, input: LoadFormsInput): Promise<LoadFormsResult> {
  const tenantId = String(input.tenantId ?? "").trim();
  await requireOpenClinic(ctx.db, tenantId);
  const dir = path.resolve(input.dir);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new RepoInputError(`No folder at ${dir}.`);
  const now = input.now ?? new Date();
  const at = now.toISOString();
  const replace = input.replaceProposed === true;
  const restore = input.restore === true;
  // WE design 1: the clinic's own rows, read before a confirmed run and compared after it.
  const invariantsBefore = input.confirm ? await clinicFingerprint(ctx.db, tenantId) : null;
  const existing = new Set((await listFormMeta(ctx, tenantId)).map((m) => m.fileSha256));
  // replaceProposed: the library with its maps (as it was when the run started, in the preview and with --confirm
  // alike), and the clinic's referrer links as stored (lower case: the batch's LIKE ignores ASCII case on SQLite).
  const { forms: library, unreadable } = replace ? await readLibrary(ctx, tenantId) : { forms: [], unreadable: [] };
  if (unreadable.length) {
    // Review fix (10/2026): an unreadable form could be this file's template – matched neither by name nor referrer, it
    // would get a second form next to it. Nothing is done until every form can be read.
    throw new RepoInputError(
      `${unreadable.length} ${unreadable.length === 1 ? "form" : "forms"} in the clinic's library cannot be read with this database's data keys (${unreadable.slice(0, 5).join(", ")}${unreadable.length > 5 ? ", …" : ""}): replace mode reads every form to find each template's form. Check the data keys for this database (CLINFORMS_DATA_KEYS); nothing was changed.`,
    );
  }
  const linksText = replace ? JSON.stringify((await getTenantSettings(ctx, tenantId))?.referrerLinks ?? {}).toLowerCase() : "";
  /** One file per template (replace mode): the first file of each SHA-256 and of each name, and the forms already matched. */
  const seenSha = new Map<string, string>();
  const seenName = new Map<string, string>();
  const claimed = new Map<string, string>();
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
    // WE design 1: the file as supplied (an RTF template before its conversion) – the pin a later conversion still matches.
    const sourceSha256 = file.convertedFrom?.sha256 ?? file.sha256;
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
    if (replace) {
      // Review fix (10/2026): two files for one template would replace each other's form (and the preview could not
      // show it). The first one in name order counts; the preview and --confirm agree.
      const twin = seenSha.get(file.sha256) ?? seenName.get(fileNameKey(name));
      if (!seenSha.has(file.sha256)) seenSha.set(file.sha256, name);
      if (!seenName.has(fileNameKey(name))) seenName.set(fileNameKey(name), name);
      if (twin) {
        results.push({
          ...base,
          status: "refused",
          reason: `${twin} in this folder has ${seenSha.get(file.sha256) === twin ? "the same bytes" : "the same name (case and accents aside)"}: one file per template, nothing is done for this file.`,
        });
        continue;
      }
    }

    // The proposed map.
    let form: FormDefinition;
    const mapped = input.maps[name];
    if (!mapped && !input.readMissing) {
      results.push({ ...base, status: "skipped", reason: "No map for this file in the maps file (add one, or use --read-missing)." });
      continue;
    }
    let parsedFile: Awaited<ReturnType<typeof parseFormFile>>;
    try {
      parsedFile = await parseFormFile(file);
    } catch (err) {
      const detail = err instanceof HttpError ? `${err.message}: ${err.init.detail ?? ""}`.replace(/: $/, "") : err instanceof Error ? err.message : String(err);
      results.push({ ...base, status: "refused", mapFrom: mapped ? "json" : "reading", reason: detail });
      continue;
    }
    const blockText = blockTextOf(parsedFile);
    if (mapped) {
      // WE design 1: a map pins its file as supplied (file.sourceSha256) – that pin survives a new converter – or the
      // current conversion (file.sha256). A pin to an earlier converter's output is refused, except when restoring the
      // earlier maps (the anchors are checked against this conversion either way).
      if (mapped.file?.sourceSha256 && mapped.file.sourceSha256 !== sourceSha256) {
        results.push({ ...base, status: "refused", mapFrom: "json", reason: "The map was made from another file (its source pin does not match this file): make the map again from this file." });
        continue;
      }
      if (!mapped.file?.sourceSha256 && mapped.file?.sha256 && mapped.file.sha256 !== file.sha256 && !restore) {
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
      const kind = parsedFile.kind;
      form = {
        id: createId("frm"),
        tenantId,
        referrer: mapped.referrer,
        title: (mapped.title ?? name.replace(FORM_EXTENSIONS, "")).slice(0, 200) || "Referrer form",
        ...(mapped.versionLabel ? { versionLabel: mapped.versionLabel.slice(0, 60) } : {}),
        file: { fileName: name, mimeType: file.mimeType, sha256: file.sha256, sizeBytes: file.sizeBytes, sourceSha256 },
        kind,
        fields,
        status: "proposed",
        analysis: {
          mode: "demo_prewritten",
          promptVersion: "onboarding-1",
          at,
          warnings: [PREPARED_NOTE, ...(mapped.warnings ?? [])],
          ...(mapped.guidanceVersion ? { guidanceVersion: mapped.guidanceVersion } : {}),
        },
        createdAt: at,
        updatedAt: at,
      };
      problems.push(...checkFormDefinition(form), ...(problems.length ? [] : await anchorProblems(parsedFile, fields)));
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
      // A reading is written in this release's wording (WE design 3): its guidance is shown as stored.
      form = {
        ...read.form,
        file: { ...read.form.file, sourceSha256 },
        analysis: { ...read.form.analysis, warnings: [PREPARED_NOTE, ...read.form.analysis.warnings], guidanceVersion: GUIDANCE_VERSION },
      };
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
    // WE design 1: the converter that made this file, and the words printed before each "…" blank (from the template).
    const printedLeads = printedLeadsOf(form.fields, blockText);
    form = {
      ...form,
      analysis: {
        ...form.analysis,
        warnings: [...notes, ...form.analysis.warnings.filter((w) => !notes.includes(w))],
        ...(mergeFields.length ? { mergeFields } : {}),
        ...(file.convertedFrom ? { convertedWith: RTF_CONVERTER_VERSION } : {}),
        ...(Object.keys(printedLeads).length ? { printedLeads } : {}),
      },
    };
    // WE design 2: the map lint, before anything is written. A map from the maps file with a finding is refused unless
    // its question accepts that rule with a reason; a reading's findings are listed (its staff check it); a restore lists them.
    const lint: LintIssue[] = lintFormMap(form, {
      convertedFromRtf: Boolean(file.convertedFrom),
      pin: mapped ? { ...(mapped.file?.sha256 ? { sha256: mapped.file.sha256 } : {}), ...(mapped.file?.sourceSha256 ? { sourceSha256: mapped.file.sourceSha256 } : {}) } : { sourceSha256 },
      conversionSha256: file.sha256,
      ...(blockText ? { blockText } : {}),
    });
    const lintErr = lintErrors(lint);
    const lintAccepted = lint.filter((i) => i.severity === "accepted");
    const lintResult = { errors: lintErr.map((i) => lintSummary([i])), accepted: lintAccepted.map((i) => lintSummary([i])) };
    if (mapped && !restore && lintErr.length > 0) {
      results.push({
        ...base,
        status: "refused",
        mapFrom: "json",
        lint: lintResult,
        reason: `The map does not pass the map lint (${lintSummary(lintErr.slice(0, 12))}${lintErr.length > 12 ? ` and ${lintErr.length - 12} more` : ""}): fix the map, or accept a finding for its question with lintAccepted and the reason.`,
      });
      continue;
    }
    /** Audit detail (ids and ClinForms' own reasons only): the accepted findings, and a restore. */
    const auditExtra = {
      ...(lintAccepted.length ? { lintAccepted: lintAccepted.map((i) => ({ rule: i.rule, fieldId: i.fieldId ?? null, reason: (i.acceptedReason ?? "").slice(0, 200) })) } : {}),
      ...(restore ? { restore: true } : {}),
    };
    const counts = countSources(form);
    const ready: LoadFormsFileResult = {
      ...base,
      mapFrom: mapped ? "json" : "reading",
      kind: form.kind,
      questions: form.fields.length,
      ...counts,
      mergeFields: mergeFields.length,
      ...(lint.length ? { lint: lintResult } : {}),
    };
    const mapFrom = mapped ? "json" : "reading";
    const plan: ReplacePlan = replace ? await planReplace(ctx, tenantId, library, linksText, claimed, name, form, mapFrom) : { action: "load" };
    if (plan.action === "replace" || plan.action === "skip") for (const t of plan.targets) claimed.set(t.meta.id, name);
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
    const uploaded: AuditEntryInput = {
      userId: PLATFORM_USER_ID,
      action: "file.upload",
      targetType: "form_file",
      targetId: file.sha256,
      detail: { via: "onboarding", sizeBytes: stored.sizeBytes, chunks: stored.chunkCount, mime: file.mimeType },
    };
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
    if (plan.action === "replace" && replaces) {
      // A file written just for this form goes again when the form is not stored (unless a form uses it meanwhile).
      const dropNewFile = async () => {
        if (stored.written) await deleteFormFileIfUnused(ctx, tenantId, file.sha256);
      };
      let swapped: Awaited<ReturnType<typeof replaceForms>>;
      try {
        swapped = await replaceForms(ctx, tenantId, {
          replace: plan.targets.map((t) => ({ id: t.meta.id, rev: t.meta.rev, status: t.meta.status })),
          auditRowsAbout: plan.auditRowsAbout,
          form: row,
          dropUnusedFiles: plan.targets.map((t) => t.meta.fileSha256),
          // In the same batch: the rows exist exactly when the forms were replaced.
          audit: [
            ...(stored.written ? [uploaded] : []),
            {
              userId: PLATFORM_USER_ID,
              action: "form.replace",
              targetType: "form",
              targetId: form.id,
              detail: { via: "onboarding", status: "proposed", replaces, fields: form.fields.length, kind: form.kind, mapFrom, ...auditExtra },
            },
          ],
        });
      } catch (err) {
        await dropNewFile().catch(() => undefined);
        throw err;
      }
      if (!swapped.ok) {
        // The clinic (or another run) changed, used or removed one of the forms after the preview: nothing was replaced.
        await dropNewFile();
        results.push({ ...ready, status: "refused", replaces, reason: "The clinic's form changed while it was being replaced: nothing was replaced. Run the preview again." });
        continue;
      }
      existing.add(file.sha256);
      results.push({ ...ready, status: "replaced", replaces, formId: form.id });
      continue;
    }
    const saved = await createForm(ctx, tenantId, row);
    if (!saved.ok) throw new Error(`The map for ${name} could not be stored (${saved.reason}).`);
    existing.add(file.sha256);
    if (stored.written) await appendAudit(ctx, tenantId, uploaded);
    await appendAudit(ctx, tenantId, {
      userId: PLATFORM_USER_ID,
      action: "form.create",
      targetType: "form",
      targetId: form.id,
      detail: { via: "onboarding", status: "proposed", fields: form.fields.length, kind: form.kind, mapFrom, ...auditExtra },
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
  // WE design 1: the clinic's own rows are as they were (the tool never writes them).
  let invariants: LoadFormsResult["invariants"];
  if (invariantsBefore) {
    const after = await clinicFingerprint(ctx.db, tenantId);
    const changed = (Object.keys(invariantsBefore) as Array<keyof typeof after>).filter((k) => invariantsBefore[k] !== after[k]);
    invariants = { ok: changed.length === 0, changed };
  }
  return { tenantId, dryRun: !input.confirm, replaceProposed: replace, ...(restore ? { restore: true } : {}), files: results, ...(invariants ? { invariants } : {}) };
}
