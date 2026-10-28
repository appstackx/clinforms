/**
 * GET /app/clinic/patients/export?<the list's filters> – the patient list as CSV (patients.export: owners and
 * administrators), checked in clinicRoute and again in the records service; recorded in the clinic's audit log with
 * the count and the names of the filters used. Formula-looking cells are defused (K2-NFR-005). Never cached.
 */
import { filtersFromParams } from "@/modules/pms/records/patient-list";
import { ukToday } from "@/modules/pms/core/text";
import { clinicRoute } from "@/server/pms/http";
import { failureStatus } from "@/server/pms/records/http-status";
import { patientCsvFor } from "@/server/pms/records/patient-list-service";

export const dynamic = "force-dynamic";

export const GET = clinicRoute({ permission: "patients.export" }, async (req, actor) => {
  const result = await patientCsvFor(actor, filtersFromParams(new URL(req.url).searchParams));
  if (!result.ok) return Response.json({ error: { code: result.code.toUpperCase(), message: result.error } }, { status: failureStatus(result.code) });
  const body = new TextEncoder().encode(`﻿${result.value.csv}`);
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-length": String(body.byteLength),
      "content-disposition": `attachment; filename="patients-${ukToday()}.csv"`,
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
    },
  });
});
