import "server-only";

/**
 * POST /api/reports/v1/store/reports/{id}/reuse (signed-in clinic member, two-step verified) – 25/10/2026
 *
 * "Complete another form for this patient": the record a stored report of the member's clinic was completed from
 * (the patient's notes as staff checked and confirmed them) for a NEW report on another referrer form, without
 * uploading the notes again. The record is read HERE from the clinic's own stored copy of the report – nothing the
 * browser sends is used but the report id in the path (the body is ignored; send {}).
 *
 * → 200 StoreReportReuseResponse {data: BundleResponse, source}: the record re-stamped with the clinic's current
 *   details from its profile, the figures and data checks worked out again today (as for an upload), and what the
 *   Studio shows about the earlier report (its form, status, version – no patient data beyond the report screen's).
 *   The patient's consent to share the earlier report is not carried over for a record from uploaded notes, however
 *   it was recorded – found in the notes, entered at the notes check, or "Record consent" on the report (core/reuse.ts
 *   recordForAnotherForm): `source.consentReset` – the new report needs it recorded before approval.
 *
 * Rules (as for a fresh upload of the same notes):
 *   401 / 403 TWO_FACTOR_REQUIRED / NO_CLINIC / ORIGIN_NOT_ALLOWED / 429   requireTenantActor (a write: same origin)
 *   403 TRIAL_ENDED               the clinic's trial has ended: no new report (auth/clinic-access.ts)
 *   404 NOT_FOUND                 the clinic holds no such report – deleted, removed by retention, or another
 *                                 clinic's (never told apart: nothing about another clinic is revealed)
 *   403 CONNECTOR_NOT_AVAILABLE   the record came from the public demo's simulated system
 *   403 SESSION_MISMATCH          a member opened from the clinic system for one episode asks for another
 *   415                           a body that is not JSON
 * Audit: "notes.reused" (target: the earlier report; counts only – never names or notes). Nothing is stored here:
 * the Studio creates the new report as usual (PUT /store/reports/{newId}: "report.create", usage "report_started"),
 * with a NEW id and no "amends" – so drafting it counts as a report of its own (src/server/repos/usage.ts).
 *
 * Owner: store slice.
 */
import { AUDIT_ACTIONS, assertActorEpisode } from "../../auth/actor";
import { assertClinicMayCreate } from "../../auth/clinic-access";
import { requireConnector } from "../../connectors/handler-support";
import { recordForAnotherForm, reuseSourceOf } from "../../core/reuse";
import { ReportSchema } from "../../core/schemas";
import type { TraceEntry } from "../../core/types";
import { WORDING } from "../../core/wording";
import { HttpError, json, logEvent, problem, type MedreportHandler } from "../http";
import { STORE_RECORD_ID_PATTERN, type StoreReportReuseResponse } from "../store-contract";
import { bundleResponseFor } from "./file-import-response";
import { assertContentType, auditStore, pathParam, reportReadable, requireTenantActor } from "./store-actor";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const handleStoreReportReuse: MedreportHandler = async (req, ctx, deps) => {
  const t = await requireTenantActor(req, deps, { write: true });
  assertContentType(req);
  const id = pathParam(ctx.params, "id", STORE_RECORD_ID_PATTERN);
  // 10/2026: a clinic whose trial has ended starts no new report – from new notes or from these.
  await assertClinicMayCreate(t.actor, deps, "report");

  const started = Date.now();
  const stored = await t.store.getReport(t.tenantId, id);
  const parsed = stored ? ReportSchema.safeParse(stored.payload) : null;
  if (parsed && !parsed.success) {
    logEvent("store_report_unreadable", { id });
    throw new HttpError(500, "The stored report could not be read", { code: "INTERNAL", detail: "Please try again, or contact support." });
  }
  const report = parsed?.data;
  // The store is the clinic's own (every read names the tenant); the tenant check is belt and braces.
  // M10 H2: a report the host keeps from this member reads as gone (MedreportDeps.mayReadReport).
  if (!report || report.tenantId !== t.tenantId || !(await reportReadable(t.actor, deps, report))) {
    logEvent("report_reuse_gone", {});
    return problem(404, WORDING.server.access.reuseGoneTitle, { code: "NOT_FOUND", detail: WORDING.server.access.reuseGoneDetail });
  }

  const { bundle: record, consentReset } = recordForAnotherForm(report);
  // The same connector and episode rules as fetching the record afresh: the public demo's simulated system is not
  // a clinic's, and a member opened from the clinic system for one episode stays on it.
  requireConnector(deps, record.source.connectorId, { tenantId: t.tenantId });
  assertActorEpisode(t.actor, { connectorId: record.source.connectorId, patientId: record.source.externalPatientId, episodeId: record.source.externalEpisodeId });

  const counts = {
    notes: record.notes.length,
    appointments: record.appointments.length,
    outcomeScores: record.outcomeMeasures.reduce((n, m) => n + m.points.length, 0),
  };
  const trace: TraceEntry[] = [
    {
      method: "READ",
      url: "store/report",
      status: 200,
      ms: Date.now() - started,
      transport: "in-process",
      note: ["notes already checked for an earlier report", plural(counts.notes, "note"), plural(counts.appointments, "appointment"), plural(counts.outcomeScores, "outcome score")].join(" · "),
    },
  ];
  const data = await bundleResponseFor(deps, t.actor, record, trace);
  await auditStore(t, {
    action: AUDIT_ACTIONS.notesReused,
    targetType: "report",
    targetId: id,
    detail: { ...counts, sourceStatus: report.status, sourceVersion: report.version ?? 1, consentReset },
  });
  logEvent("report_notes_reused", { ...counts, consentReset, ms: Date.now() - started });
  const body: StoreReportReuseResponse = { data, source: reuseSourceOf(report, consentReset) };
  return json(body);
};
