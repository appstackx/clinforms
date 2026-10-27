/**
 * `pms_note_templates` – the clinic's own note templates. The built-in templates (src/modules/pms/records/templates.ts)
 * have no row; listNoteTemplates() returns them first, then the clinic's. Templates are configuration (headings and
 * hints), stored plain. Never deleted: switch a template off instead (notes keep their own snapshot anyway).
 */
import type { Selectable } from "kysely";
import { RECORDS_ID_PREFIXES as P } from "../../../../modules/pms/records/ids";
import {
  BUILTIN_TEMPLATES,
  NoteTemplateInputSchema,
  NoteTemplatePatchSchema,
  builtinTemplate,
  isBuiltinTemplateId,
  type NoteTemplate,
  type NoteTemplateInput,
  type NoteTemplatePatch,
  type NoteType,
  type TemplateSection,
} from "../../../../modules/pms/records/templates";
import type { PmsActor, PmsSaveResult } from "../../../../modules/pms/core/types";
import type { PmsNoteTemplatesTable } from "../../../db/pms-schema/records";
import { RepoInputError, assertId, assertTenantId, b01, isOn, nowIso, num, parseInput, patchColumns, pmsAuditQuery, pmsId, writeWithAudit, type DbContext } from "../context";
import { updateWithAudit } from "./write";

const T = "pms_note_templates";
const MESSAGES = { unique: "A template with this name already exists." };

type Row = Selectable<PmsNoteTemplatesTable>;

function parseSections(json: string): TemplateSection[] {
  try {
    const raw = JSON.parse(json) as unknown;
    return Array.isArray(raw) ? (raw as TemplateSection[]) : [];
  } catch {
    return [];
  }
}

function toTemplate(r: Row): NoteTemplate {
  return {
    id: r.id,
    name: r.name,
    noteType: r.note_type as NoteType,
    sections: parseSections(r.sections_json),
    bodyChart: isOn(r.body_chart),
    builtin: false,
    active: isOn(r.active),
    sortOrder: num(r.sort_order),
    rev: num(r.rev),
    updatedAt: r.updated_at,
  };
}

export interface ListTemplatesOptions {
  includeInactive?: boolean;
}

/** The built-in templates, then the clinic's own (by sort order, then name). */
export async function listNoteTemplates(ctx: DbContext, tenantId: string, options: ListTemplatesOptions = {}): Promise<NoteTemplate[]> {
  assertTenantId(tenantId);
  let q = ctx.db.selectFrom(T).selectAll().where("tenant_id", "=", tenantId);
  if (!options.includeInactive) q = q.where("active", "=", 1);
  const rows = await q.orderBy("sort_order").orderBy("name").limit(200).execute();
  return [...BUILTIN_TEMPLATES, ...rows.map(toTemplate)];
}

/** A template by id: a built-in one, or the clinic's own. */
export async function getNoteTemplate(ctx: DbContext, tenantId: string, id: string): Promise<NoteTemplate | null> {
  assertTenantId(tenantId);
  if (isBuiltinTemplateId(id)) return builtinTemplate(id);
  const row = await ctx.db.selectFrom(T).selectAll().where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  return row ? toTemplate(row) : null;
}

export async function createNoteTemplate(ctx: DbContext, tenantId: string, input: NoteTemplateInput & { basedOn?: string | null }, actor: PmsActor): Promise<NoteTemplate> {
  assertTenantId(tenantId);
  const d = parseInput(NoteTemplateInputSchema, input, "Template");
  const basedOn = input.basedOn && builtinTemplate(input.basedOn) ? input.basedOn : null;
  const id = pmsId(P.noteTemplate, ctx);
  const at = nowIso(ctx);
  await writeWithAudit(
    ctx,
    [
      ctx.db.insertInto(T).values({
        tenant_id: tenantId,
        id,
        rev: 1,
        name: d.name,
        note_type: d.noteType,
        sections_json: JSON.stringify(d.sections),
        body_chart: b01(d.bodyChart),
        active: b01(d.active),
        sort_order: d.sortOrder,
        based_on: basedOn,
        created_by: actor.userId,
        created_at: at,
        updated_at: at,
      }),
      pmsAuditQuery(ctx, tenantId, actor, { action: "pms.note_template.create", targetType: "pms_note_template", targetId: id, detail: { sections: d.sections.length, basedOn } }),
    ],
    MESSAGES,
  );
  return (await getNoteTemplate(ctx, tenantId, id)) as NoteTemplate;
}

/** Updates a clinic template with the revision the editor saw. Built-in templates cannot be changed. */
export async function updateNoteTemplate(ctx: DbContext, tenantId: string, id: string, expectedRev: number, patch: NoteTemplatePatch, actor: PmsActor): Promise<PmsSaveResult> {
  assertTenantId(tenantId);
  if (isBuiltinTemplateId(id)) throw new RepoInputError("Built-in templates cannot be changed. Copy one to make your own.");
  assertId(id, "template id");
  if (!Number.isInteger(expectedRev) || expectedRev < 1) throw new RepoInputError("expectedRev must be a positive whole number.");
  const d = parseInput(NoteTemplatePatchSchema, patch, "Template");
  const set: Record<string, unknown> = {};
  const fields = patchColumns(
    d,
    {
      name: "name",
      noteType: "note_type",
      sections: ["sections_json", (v: TemplateSection[]) => JSON.stringify(v)],
      bodyChart: ["body_chart", b01],
      active: ["active", b01],
      sortOrder: "sort_order",
    },
    set,
  );
  const current = await ctx.db.selectFrom(T).select(["rev", "updated_at"]).where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  if (!current) return { ok: false, reason: "not_found" };
  if (num(current.rev) !== expectedRev) return { ok: false, reason: "conflict", currentRev: num(current.rev) };
  if (fields.length === 0) return { ok: true, rev: expectedRev, updatedAt: current.updated_at };
  const at = nowIso(ctx);
  const changed = await updateWithAudit(
    ctx,
    tenantId,
    actor,
    ctx.db
      .updateTable(T)
      .set({ ...set, rev: expectedRev + 1, updated_at: at })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", id)
      .where("rev", "=", expectedRev),
    { action: auditAction(d), targetType: "pms_note_template", targetId: id, detail: { fields, rev: expectedRev + 1 } },
    ctx.db.selectFrom(T).select("id").where("tenant_id", "=", tenantId).where("id", "=", id).where("rev", "=", expectedRev + 1).where("updated_at", "=", at),
    MESSAGES,
  );
  if (!changed) {
    const now = await ctx.db.selectFrom(T).select("rev").where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
    return now ? { ok: false, reason: "conflict", currentRev: num(now.rev) } : { ok: false, reason: "not_found" };
  }
  return { ok: true, rev: expectedRev + 1, updatedAt: at };
}

/** A change that only switches a template off or on is a retirement / restoration; anything else an update. */
function auditAction(d: NoteTemplatePatch): string {
  const keys = Object.keys(d).filter((k) => (d as Record<string, unknown>)[k] !== undefined);
  if (keys.length === 1 && keys[0] === "active") return d.active ? "pms.note_template.restore" : "pms.note_template.retire";
  return "pms.note_template.update";
}

/**
 * Retires a clinic template (no new notes can start from it; notes already written keep their own snapshot) or
 * brings it back. Revision-checked like any change.
 */
export async function setNoteTemplateActive(ctx: DbContext, tenantId: string, id: string, expectedRev: number, active: boolean, actor: PmsActor): Promise<PmsSaveResult> {
  return updateNoteTemplate(ctx, tenantId, id, expectedRev, { active }, actor);
}

/** A copy of a built-in or clinic template under a new name (the editor's "Make a copy"). */
export async function copyNoteTemplate(ctx: DbContext, tenantId: string, fromId: string, name: string, actor: PmsActor): Promise<NoteTemplate> {
  const from = await getNoteTemplate(ctx, tenantId, fromId);
  if (!from) throw new RepoInputError("The template to copy does not exist in this clinic.");
  return createNoteTemplate(
    ctx,
    tenantId,
    { name, noteType: from.noteType, sections: from.sections, bodyChart: from.bodyChart, active: true, sortOrder: from.builtin ? 100 : from.sortOrder, basedOn: from.builtin ? from.id : null },
    actor,
  );
}
