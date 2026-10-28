/**
 * The records and diary modules' adapters for the integration ports (./ports.ts), wired in ./wiring.ts.
 *
 *   records – a case's SIGNED notes (drafts and notes entered in error are never given to ClinForms), with their
 *             amendments, and its outcome scores; which patients / cases have clinical records (an undo keeps them);
 *   diary   – a case's appointments (no booking notes); the import of appointments (bulk, in batches of 40 with one
 *             audit row each, clash rows isolated and skipped) and its undo (only appointments the import made and
 *             nothing has changed or used since: no note, invoice line, message or online booking points at them).
 *
 * Every function takes the tenant explicitly and reads that clinic's rows only. Billing's import of invoices is not
 * wired (BillingPort stays null): opening balances are entered in Billing; the import can still CHECK an invoices file.
 */
import "server-only";
import {
  formatLondonTime,
  londonToUtc,
  parseHhmm,
} from "../../../modules/pms/diary/time";
import type { AppointmentStatus } from "../../../modules/pms/diary/rules";
import type { ImportAppointmentStatus } from "../../../modules/pms/integration/rows";
import type { AppointmentPlan } from "../../../modules/pms/integration/resolve";
import type { OutcomeMeasureId } from "../../../modules/pms/records/outcomes";
import type { PmsActor } from "../../../modules/pms/core/types";
import { runBatch } from "../../db/batch";
import { RepoInputError, type RepoContext } from "../../repos/context";
import {
  bulkCreateDiaryItems,
  listPatientAppointments,
} from "../../repos/pms/diary/appointments";
import { listServices } from "../../repos/pms/directory";
import { getNote, listNotesForPatient } from "../../repos/pms/records/notes";
import { listOutcomesForPatient } from "../../repos/pms/records/outcomes";
import { assertTenantId, pmsAuditQuery } from "../../repos/pms/context";
import type {
  ClinicalRecordsPort,
  DiaryPort,
  ImportedRecord,
  NativeAppointment,
  NativeNote,
  NativeOutcomeSeries,
  UndoResult,
} from "./ports";

const SOAP = ["subjective", "objective", "assessment", "plan"] as const;

/** Discharge-summary sections → the SOAP shape ClinForms reads (nothing is dropped: the rest goes to free text). */
const DISCHARGE_MAP: Record<string, (typeof SOAP)[number]> = {
  reason: "assessment",
  summary: "objective",
  outcome: "assessment",
  advice: "plan",
  onward: "plan",
};

const NOTE_TYPE: Record<string, NativeNote["type"]> = {
  initial: "initial_assessment",
  follow_up: "follow_up",
  discharge: "discharge",
  general: "other",
};

const INSTRUMENT: Record<OutcomeMeasureId, NativeOutcomeSeries["instrument"]> =
  {
    ndi: "NDI",
    odi: "ODI",
    nprs: "NPRS",
    psfs: "PSFS",
    quickdash: "QuickDASH",
  };

export const recordsAdapter: ClinicalRecordsPort = {
  async caseNotes(ctx, tenantId, patientId, caseId) {
    assertTenantId(tenantId);
    const summaries = (
      await listNotesForPatient(ctx, tenantId, patientId, {
        caseId,
        limit: 500,
      })
    ).filter((n) => n.status === "signed" && !n.enteredInError);
    const out: NativeNote[] = [];
    for (const s of summaries) {
      const n = await getNote(ctx, tenantId, s.id);
      if (
        !n ||
        n.status !== "signed" ||
        n.enteredInError ||
        n.patientId !== patientId ||
        n.caseId !== caseId
      )
        continue;
      const soap: Record<(typeof SOAP)[number], string[]> = {
        subjective: [],
        objective: [],
        assessment: [],
        plan: [],
      };
      const extra: string[] = [];
      for (const section of n.template.sections) {
        const text = (n.sections[section.key] ?? "").trim();
        if (!text) continue;
        const target = (SOAP as readonly string[]).includes(section.key)
          ? (section.key as (typeof SOAP)[number])
          : n.noteType === "discharge"
            ? DISCHARGE_MAP[section.key]
            : undefined;
        if (target)
          soap[target].push(
            target === section.key ? text : `${section.label}: ${text}`,
          );
        else extra.push(`${section.label}: ${text}`);
      }
      for (const a of n.amendments)
        if (a.text)
          extra.push(`Amendment (${a.createdAt.slice(0, 10)}): ${a.text}`);
      out.push({
        id: n.id,
        date: n.seenOn,
        time: null,
        type: NOTE_TYPE[n.noteType] ?? "other",
        practitionerId: n.practitionerId,
        subjective: soap.subjective.join("\n"),
        objective: soap.objective.join("\n"),
        assessment: soap.assessment.join("\n"),
        plan: soap.plan.join("\n"),
        ...(extra.length ? { freeText: extra.join("\n") } : {}),
      });
    }
    return out.sort(
      (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
    );
  },

  async caseOutcomes(ctx, tenantId, patientId, caseId) {
    assertTenantId(tenantId);
    const rows = (
      await listOutcomesForPatient(ctx, tenantId, patientId)
    ).filter((o) => o.caseId === caseId && o.status === "recorded");
    const byMeasure = new Map<OutcomeMeasureId, NativeOutcomeSeries>();
    for (const o of rows) {
      const series = byMeasure.get(o.measure) ?? {
        id: `OM-${o.measure}`,
        instrument: INSTRUMENT[o.measure],
        points: [],
      };
      series.points.push({
        date: o.takenOn,
        value: o.scoreTenths / 10,
        noteId: o.noteId,
      });
      byMeasure.set(o.measure, series);
    }
    return Array.from(byMeasure.values());
  },

  async patientsWithRecords(ctx, tenantId, patientIds) {
    return idsWith(ctx, tenantId, "patient_id", patientIds);
  },
  async casesWithRecords(ctx, tenantId, caseIds) {
    return idsWith(ctx, tenantId, "case_id", caseIds);
  },
};

/** Which of `ids` have a clinical note, an outcome measure or an attachment (an undo keeps them). */
async function idsWith(
  ctx: RepoContext,
  tenantId: string,
  column: "patient_id" | "case_id",
  ids: readonly string[],
): Promise<Set<string>> {
  assertTenantId(tenantId);
  const out = new Set<string>();
  const unique = Array.from(new Set(ids));
  for (let i = 0; i < unique.length; i += 90) {
    const part = unique.slice(i, i + 90);
    const [notes, outcomes, files] = await Promise.all([
      ctx.db
        .selectFrom("pms_clinical_notes")
        .select(column)
        .where("tenant_id", "=", tenantId)
        .where(column, "in", part)
        .execute(),
      ctx.db
        .selectFrom("pms_outcome_measures")
        .select(column)
        .where("tenant_id", "=", tenantId)
        .where(column, "in", part)
        .execute(),
      column === "patient_id"
        ? ctx.db
            .selectFrom("pms_attachments")
            .select("patient_id")
            .where("tenant_id", "=", tenantId)
            .where("patient_id", "in", part)
            .execute()
        : Promise.resolve([]),
    ]);
    for (const r of [...notes, ...outcomes, ...files] as Record<
      string,
      string | null
    >[]) {
      const v = r[column];
      if (v) out.add(v);
    }
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * Diary
 * ----------------------------------------------------------------------------------------------*/

const FROM_DIARY: Record<AppointmentStatus, ImportAppointmentStatus> = {
  booked: "booked",
  arrived: "booked",
  in_treatment: "booked",
  attended: "attended",
  dna: "did_not_attend",
  late_cancelled: "late_cancellation",
  cancelled: "cancelled",
};

const TO_DIARY: Record<ImportAppointmentStatus, AppointmentStatus> = {
  attended: "attended",
  did_not_attend: "dna",
  late_cancellation: "late_cancelled",
  cancelled: "cancelled",
  booked: "booked",
};

/** Appointments are written in chunks of this many (one audit row each – the diary's bulk load). */
const DIARY_CHUNK = 40;

async function existingRefs(
  ctx: RepoContext,
  tenantId: string,
  refs: readonly string[],
): Promise<Set<string>> {
  assertTenantId(tenantId);
  const out = new Set<string>();
  const unique = Array.from(new Set(refs.filter(Boolean)));
  for (let i = 0; i < unique.length; i += 90) {
    const rows = await ctx.db
      .selectFrom("pms_appointments")
      .select("import_ref")
      .where("tenant_id", "=", tenantId)
      .where("import_ref", "in", unique.slice(i, i + 90))
      .execute();
    for (const r of rows) if (r.import_ref) out.add(r.import_ref);
  }
  return out;
}

async function idsWithAppointments(
  ctx: RepoContext,
  tenantId: string,
  column: "patient_id" | "case_id",
  ids: readonly string[],
): Promise<Set<string>> {
  assertTenantId(tenantId);
  const out = new Set<string>();
  const unique = Array.from(new Set(ids));
  for (let i = 0; i < unique.length; i += 90) {
    const rows = await ctx.db
      .selectFrom("pms_appointments")
      .select(column)
      .where("tenant_id", "=", tenantId)
      .where(column, "in", unique.slice(i, i + 90))
      .execute();
    for (const r of rows as Record<string, string | null>[])
      if (r[column]) out.add(r[column] as string);
  }
  return out;
}

/** One plan as the diary's bulk item (the instant from the UK date and time; the fallback type when none matched). */
function diaryItemOf(plan: AppointmentPlan, fallbackServiceId: string | null) {
  const minute = parseHhmm(plan.record.startTime);
  if (minute === null) return null;
  const start = londonToUtc(plan.record.date, minute);
  if (!start.ok) return null;
  const startsAt = start.iso;
  const endsAt = new Date(
    Date.parse(startsAt) + plan.durationMinutes * 60_000,
  ).toISOString();
  const serviceId = plan.serviceId ?? fallbackServiceId;
  if (!plan.siteId || !serviceId) return null;
  const notes =
    [
      plan.record.notes,
      plan.record.cancellationReason
        ? `Reason: ${plan.record.cancellationReason}`
        : null,
    ]
      .filter(Boolean)
      .join("\n") || null;
  return {
    kind: "appointment" as const,
    siteId: plan.siteId,
    practitionerId: plan.practitionerId,
    roomId: plan.roomId,
    patientId: plan.patientId,
    caseId: plan.caseId,
    serviceId,
    startsAt,
    endsAt,
    status: TO_DIARY[plan.status],
    notes: notes ? notes.slice(0, 2000) : null,
    source: "import" as const,
    feeDue: false,
    cancelReason:
      plan.status === "cancelled" || plan.status === "late_cancellation"
        ? ("patient" as const)
        : null,
    importRef: plan.record.ref,
  };
}

export const diaryAdapter: DiaryPort = {
  async caseAppointments(ctx, tenantId, patientId, caseId) {
    const items = await listPatientAppointments(ctx, tenantId, patientId, {
      limit: 200,
    });
    return items
      .filter((a) => a.kind === "appointment" && a.caseId === caseId)
      .map((a): NativeAppointment => ({
        id: a.id,
        date: a.startsOn,
        time: formatLondonTime(a.startsAt),
        durationMinutes: Math.round(
          (Date.parse(a.endsAt) - Date.parse(a.startsAt)) / 60_000,
        ),
        status: FROM_DIARY[a.status],
        practitionerId: a.practitionerId,
        siteId: a.siteId,
      }));
  },

  existingAppointmentRefs: existingRefs,

  async importAppointments(ctx, tenantId, plans, actor: PmsActor, detail) {
    assertTenantId(tenantId);
    const services = await listServices(ctx, tenantId, {
      includeInactive: false,
    });
    const written: ImportedRecord[] = [];
    const items = plans
      .map((p) => {
        const fallback =
          services.find((s) => s.durationMinutes === p.durationMinutes)?.id ??
          services[0]?.id ??
          null;
        const item = diaryItemOf(p, fallback);
        return item ? { ref: p.record.ref, item } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    for (let i = 0; i < items.length; i += DIARY_CHUNK) {
      const chunk = items.slice(i, i + DIARY_CHUNK);
      try {
        const ids = await bulkCreateDiaryItems(
          ctx,
          tenantId,
          chunk.map((c) => c.item),
          actor,
          { source: "import", batchId: detail.batchId },
        );
        chunk.forEach((c, k) =>
          written.push({ ref: c.ref, id: ids[k], rev: 1 }),
        );
      } catch (err) {
        if (!(err instanceof RepoInputError)) throw err;
        // A clash in the chunk refuses it whole: write the rows one by one, so only the clashing ones are left out.
        for (const c of chunk) {
          try {
            const [id] = await bulkCreateDiaryItems(
              ctx,
              tenantId,
              [c.item],
              actor,
              { source: "import", batchId: detail.batchId },
            );
            written.push({ ref: c.ref, id, rev: 1 });
          } catch (one) {
            if (!(one instanceof RepoInputError)) throw one;
          }
        }
      }
    }
    return written;
  },

  async undoImportedAppointments(ctx, tenantId, items, actor) {
    assertTenantId(tenantId);
    const result: UndoResult = { undone: [], kept: [] };
    const byId = new Map(items.map((i) => [i.id, i.rev]));
    const ids = Array.from(byId.keys());
    for (let i = 0; i < ids.length; i += 40) {
      const part = ids.slice(i, i + 40);
      // Still exactly as imported, and nothing points at it (a note, an invoice line, a message, an online booking).
      const rows = await ctx.db
        .selectFrom("pms_appointments as a")
        .select(["a.id", "a.rev"])
        .where("a.tenant_id", "=", tenantId)
        .where("a.id", "in", part)
        .where("a.source", "=", "import")
        .where((eb) =>
          eb.and([
            eb.not(
              eb.exists(
                eb
                  .selectFrom("pms_clinical_notes as n")
                  .select("n.id")
                  .whereRef("n.tenant_id", "=", "a.tenant_id")
                  .whereRef("n.appointment_id", "=", "a.id"),
              ),
            ),
            eb.not(
              eb.exists(
                eb
                  .selectFrom("pms_invoice_lines as l")
                  .select("l.id")
                  .whereRef("l.tenant_id", "=", "a.tenant_id")
                  .whereRef("l.appointment_id", "=", "a.id"),
              ),
            ),
            eb.not(
              eb.exists(
                eb
                  .selectFrom("pms_messages as m")
                  .select("m.id")
                  .whereRef("m.tenant_id", "=", "a.tenant_id")
                  .whereRef("m.appointment_id", "=", "a.id"),
              ),
            ),
            eb.not(
              eb.exists(
                eb
                  .selectFrom("pms_online_bookings as o")
                  .select("o.appointment_id")
                  .whereRef("o.tenant_id", "=", "a.tenant_id")
                  .whereRef("o.appointment_id", "=", "a.id"),
              ),
            ),
          ]),
        )
        .execute();
      const removable = rows
        .filter((r) => Number(r.rev) === byId.get(r.id))
        .map((r) => r.id);
      if (removable.length) {
        await runBatch(ctx.db, [
          ...removable.map((id) =>
            ctx.db
              .deleteFrom("pms_appointments")
              .where("tenant_id", "=", tenantId)
              .where("id", "=", id)
              .where("source", "=", "import")
              .where("rev", "=", byId.get(id) as number),
          ),
          pmsAuditQuery(ctx, tenantId, actor, {
            action: "pms.appointment.import_undo",
            targetType: "pms_appointment",
            targetId: removable[0],
            detail: { count: removable.length },
          }),
        ]);
      }
      const gone = new Set(removable);
      for (const id of part)
        (gone.has(id) ? result.undone : result.kept).push(id);
    }
    return result;
  },

  patientsWithAppointments: (ctx, tenantId, ids) =>
    idsWithAppointments(ctx, tenantId, "patient_id", ids),
  casesWithAppointments: (ctx, tenantId, ids) =>
    idsWithAppointments(ctx, tenantId, "case_id", ids),
};
