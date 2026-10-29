/**
 * GET /app/clinic/import/template/[kind] – our CSV template for an import kind (the header line only; its column
 * names always match in the mapping step). settings.import. No patient data.
 */
import { clinicRoute } from "@/server/pms/http";
import { importTemplateCsv } from "@/server/pms/integration/import-service";

export const dynamic = "force-dynamic";

export const GET = clinicRoute<{ kind: string }>({ permission: "settings.import" }, async (_req, _actor, params) => {
  const csv = importTemplateCsv(params.kind);
  if (!csv) return Response.json({ error: { code: "NOT_FOUND", message: "There is no such template." } }, { status: 404 });
  return new Response(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="import-template-${params.kind}.csv"`,
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
    },
  });
});
