/**
 * The note-template editor's back end and the clinic's note settings. Rules: ./access.ts.
 *
 *   settings.manage – list every template (incl. retired), create, copy, change (each change is a new revision;
 *                     notes keep the snapshot – and version – of the template they were started from), retire and
 *                     bring back; change the unsigned-notes threshold
 *   clinical.view   – read the note settings (the unsigned-notes list uses them)
 *
 * Built-in templates (initial SOAP, follow-up SOAP, discharge) cannot be changed or retired – copy one.
 */
import { fieldErrors } from "../../../modules/pms/core/schemas";
import { RecordsSettingsInputSchema, type RecordsSettings, type RecordsSettingsInput } from "../../../modules/pms/records/settings";
import {
  NoteTemplateInputSchema,
  NoteTemplatePatchSchema,
  isBuiltinTemplateId,
  sectionKeyFor,
  type NoteTemplate,
  type NoteType,
  type SectionKind,
} from "../../../modules/pms/records/templates";
import { getRecordsSettings, saveRecordsSettings } from "../../repos/pms/records/settings";
import { copyNoteTemplate, createNoteTemplate, getNoteTemplate, listNoteTemplates, setNoteTemplateActive, updateNoteTemplate } from "../../repos/pms/records/templates";
import { attempt, fail, guard, notFound, ok, saveFailure, type RecordsActor, type Result } from "./access";

/** A section as the editor sends it: the key may be missing for a new section (made from the heading). */
export interface EditorSection {
  key?: string | null;
  label: string;
  hint?: string | null;
  kind?: SectionKind;
}

/** Gives new sections a stable key made from their heading (existing keys never change: notes store text under them). */
export function withSectionKeys(sections: readonly EditorSection[]): { key: string; label: string; hint: string | null; kind: SectionKind }[] {
  const taken = sections.map((s) => s.key).filter((k): k is string => typeof k === "string" && k !== "");
  return sections.map((s) => {
    let key = typeof s.key === "string" && s.key !== "" ? s.key : "";
    if (!key) {
      key = sectionKeyFor(String(s.label ?? ""), taken);
      taken.push(key);
    }
    return { key, label: String(s.label ?? ""), hint: s.hint ?? null, kind: s.kind ?? "text" };
  });
}

export interface TemplateEditorInput {
  name: string;
  noteType: NoteType;
  sections: EditorSection[];
  bodyChart?: boolean;
  sortOrder?: number;
}

export async function listTemplatesFor(actor: RecordsActor, options: { includeRetired?: boolean } = {}): Promise<Result<NoteTemplate[]>> {
  const denied = guard(actor, "settings.manage");
  if (denied) return denied;
  return attempt("list_templates", async () => ok(await listNoteTemplates(actor.repo(), actor.tenantId, { includeInactive: options.includeRetired !== false })));
}

export async function getTemplateFor(actor: RecordsActor, templateId: string): Promise<Result<NoteTemplate>> {
  const denied = guard(actor, "settings.manage");
  if (denied) return denied;
  return attempt("get_template", async () => {
    const t = typeof templateId === "string" && templateId ? await getNoteTemplate(actor.repo(), actor.tenantId, templateId) : null;
    return t ? ok(t) : notFound();
  });
}

export async function createTemplateFor(actor: RecordsActor, input: TemplateEditorInput): Promise<Result<NoteTemplate>> {
  const denied = guard(actor, "settings.manage");
  if (denied) return denied;
  const full = { name: input.name, noteType: input.noteType, sections: withSectionKeys(input.sections ?? []), bodyChart: input.bodyChart ?? false, active: true, sortOrder: input.sortOrder ?? 100 };
  const parsed = NoteTemplateInputSchema.safeParse(full);
  if (!parsed.success) return fail("invalid", "Some details need checking.", { fieldErrors: fieldErrors(parsed.error) });
  return attempt("create_template", async () => ok(await createNoteTemplate(actor.repo(), actor.tenantId, full, actor.actor)));
}

export async function copyTemplateFor(actor: RecordsActor, fromTemplateId: string, name: string): Promise<Result<NoteTemplate>> {
  const denied = guard(actor, "settings.manage");
  if (denied) return denied;
  const trimmed = String(name ?? "").trim();
  if (!trimmed || trimmed.length > 80) return fail("invalid", "Give the copy a name (at most 80 characters).", { fieldErrors: { name: "Give the copy a name." } });
  return attempt("copy_template", async () => {
    if (!(await getNoteTemplate(actor.repo(), actor.tenantId, fromTemplateId))) return notFound();
    return ok(await copyNoteTemplate(actor.repo(), actor.tenantId, fromTemplateId, trimmed, actor.actor));
  });
}

export async function updateTemplateFor(actor: RecordsActor, templateId: string, expectedRev: number, patch: Partial<TemplateEditorInput>): Promise<Result<{ rev: number }>> {
  const denied = guard(actor, "settings.manage");
  if (denied) return denied;
  if (isBuiltinTemplateId(String(templateId ?? ""))) return fail("invalid", "Built-in templates cannot be changed. Make a copy to change it.");
  const full = { ...patch, sections: patch.sections ? withSectionKeys(patch.sections) : undefined };
  const parsed = NoteTemplatePatchSchema.safeParse(full);
  if (!parsed.success) return fail("invalid", "Some details need checking.", { fieldErrors: fieldErrors(parsed.error) });
  return attempt("update_template", async () => {
    const saved = await updateNoteTemplate(actor.repo(), actor.tenantId, templateId, expectedRev, full, actor.actor);
    return saved.ok ? ok({ rev: saved.rev }) : saveFailure(saved);
  });
}

/** Retires a clinic template (no new notes from it) or brings it back. */
export async function setTemplateRetiredFor(actor: RecordsActor, templateId: string, expectedRev: number, retired: boolean): Promise<Result<{ rev: number }>> {
  const denied = guard(actor, "settings.manage");
  if (denied) return denied;
  if (isBuiltinTemplateId(String(templateId ?? ""))) return fail("invalid", "Built-in templates cannot be retired.");
  return attempt("retire_template", async () => {
    const saved = await setNoteTemplateActive(actor.repo(), actor.tenantId, templateId, expectedRev, !retired, actor.actor);
    return saved.ok ? ok({ rev: saved.rev }) : saveFailure(saved);
  });
}

export async function recordsSettingsFor(actor: RecordsActor): Promise<Result<RecordsSettings>> {
  if (!actor.can("clinical.view") && !actor.can("settings.manage")) return guard(actor, "settings.manage")!;
  return attempt("records_settings", async () => ok(await getRecordsSettings(actor.repo(), actor.tenantId)));
}

export async function saveRecordsSettingsFor(actor: RecordsActor, expectedRev: number, input: RecordsSettingsInput): Promise<Result<{ rev: number }>> {
  const denied = guard(actor, "settings.manage");
  if (denied) return denied;
  const parsed = RecordsSettingsInputSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", "Some details need checking.", { fieldErrors: fieldErrors(parsed.error) });
  return attempt("save_records_settings", async () => {
    const saved = await saveRecordsSettings(actor.repo(), actor.tenantId, expectedRev, parsed.data, actor.actor);
    return saved.ok ? ok({ rev: saved.rev }) : saveFailure(saved);
  });
}
