/**
 * GET /app/clinic/diary/api/patients/[patientId] – what the booking form offers for a patient: their open cases
 * and the active treatment authorisations with the sessions left. JSON, never cached.
 */
import { PMS_ID_PATTERN } from "@/modules/pms/core/ids";
import { listAuthorisations, listCasesForPatient } from "@/server/repos/pms/cases";
import { clinicRoute } from "@/server/pms/http";

export const dynamic = "force-dynamic";

export const GET = clinicRoute({ permission: "patients.view" }, async (_req, actor, params: { patientId: string }) => {
  if (!PMS_ID_PATTERN.test(params.patientId)) return Response.json({ cases: [], authorisations: [] });
  const ctx = actor.repo();
  const [cases, auths] = await Promise.all([listCasesForPatient(ctx, actor.tenantId, params.patientId), listAuthorisations(ctx, actor.tenantId, { patientId: params.patientId })]);
  return Response.json({
    cases: cases.filter((c) => c.status !== "closed").map((c) => ({ id: c.id, title: c.title, payerType: c.payerType, practitionerId: c.practitionerId, siteId: c.siteId })),
    authorisations: auths
      .filter((a) => a.status === "active")
      .map((a) => ({ id: a.id, caseId: a.caseId, code: a.code, sessionsLeft: a.sessionsAuthorised === null ? null : Math.max(0, a.sessionsAuthorised - a.sessionsUsed), expiresOn: a.expiresOn })),
  });
});
