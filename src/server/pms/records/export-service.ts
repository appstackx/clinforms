/**
 * The subject-access copy of one patient's record as a download (PDF or JSON). Rules: ./access.ts.
 *
 *   reports.export AND clinical.view – owner / administrator by default (M10 H1: reports.export alone can be
 *   granted to reception, and the copy holds every note and outcome; a member who may not see clinical content
 *   cannot download it)
 *
 * The export itself is recorded in the patient's history (pms.patient.export, with the format – no content).
 */
import { ukToday } from "../../../modules/pms/core/text";
import { pmsAudit } from "../../repos/pms/context";
import { listPatientHistory } from "../../repos/pms/records/history";
import { collectSubjectAccess } from "../../repos/pms/records/subject-access";
import { getPmsSettings } from "../../repos/pms/settings";
import { nowIso } from "../../repos/context";
import { attempt, fail, guard, notFound, ok, patientInClinic, type RecordsActor, type Result } from "./access";
import { renderSubjectAccessPdf, subjectAccessJson, subjectAccessSections, type ExportSection } from "./subject-access-export";
import { pmsNow } from "../../../modules/pms/core/clock";

export type ExportFormat = "pdf" | "json";

export interface ExportFile {
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface ExportOptions {
  clinicName: string;
  /** Other modules' sections about this patient (appointments, invoices, messages, forms) – wired at integration. */
  extraSections?: readonly ExportSection[];
  /** Their machine-readable data, keyed by module (JSON copy). */
  extraJson?: Record<string, unknown>;
}

export async function subjectAccessExportFor(actor: RecordsActor, patientId: string, format: ExportFormat, options: ExportOptions): Promise<Result<ExportFile>> {
  const denied = guard(actor, "reports.export", "clinical.view");
  if (denied) return denied;
  if (format !== "pdf" && format !== "json") return fail("invalid", "Choose PDF or JSON.");
  return attempt("subject_access_export", async () => {
    const ctx = actor.repo();
    const patient = await patientInClinic(actor, patientId);
    if (!patient) return notFound();
    const [data, history, settings] = await Promise.all([
      collectSubjectAccess(ctx, actor.tenantId, patient.id),
      listPatientHistory(ctx, actor.tenantId, patient.id, { limit: 500 }),
      getPmsSettings(ctx, actor.tenantId),
    ]);
    if (!data) return notFound();
    const meta = { clinicName: options.clinicName, generatedAt: nowIso(ctx), demo: settings.isDemo };
    const day = ukToday(ctx.now ? ctx.now() : pmsNow());
    const base = `subject-access-${patient.patientNumber}-${day}`;
    let file: ExportFile;
    if (format === "json") {
      const json = subjectAccessJson(data, history, meta, options.extraJson ?? {});
      file = { fileName: `${base}.json`, mimeType: "application/json", bytes: new TextEncoder().encode(JSON.stringify(json, null, 2)) };
    } else {
      const sections = subjectAccessSections(data, history, options.extraSections ?? []);
      const label = `patient ${patient.patientNumber}`;
      file = { fileName: `${base}.pdf`, mimeType: "application/pdf", bytes: await renderSubjectAccessPdf(sections, { ...meta, patientLabel: label }) };
    }
    await pmsAudit(ctx, actor.tenantId, actor.actor, { action: "pms.patient.export", targetType: "pms_patient", targetId: patient.id, detail: { format, notes: data.notes.length, outcomes: data.outcomes.length, files: data.attachments.length } });
    return ok(file);
  });
}
