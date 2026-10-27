/**
 * GET /app/clinic/diary/api/slots?service=…&practitioner=…&site=…&from=YYYY-MM-DD&days=21 – the next free slots of
 * an appointment type inside the rota, at the member's sites (booking form: "Find a free time"). JSON, never cached.
 */
import { readResponse } from "@/server/pms/diary/actions-support";
import { diaryCallerOf } from "@/server/pms/diary/caller";
import { loadFreeSlots } from "@/server/pms/diary/reads";
import { clinicRoute } from "@/server/pms/http";

export const dynamic = "force-dynamic";

export const GET = clinicRoute({ permission: "diary.view" }, async (req, actor) => {
  const url = new URL(req.url).searchParams;
  const serviceId = url.get("service");
  if (!serviceId) return Response.json({ data: [] });
  const days = Number(url.get("days") ?? "");
  return readResponse(
    await loadFreeSlots(await diaryCallerOf(actor), {
      serviceId,
      siteId: url.get("site") ?? undefined,
      practitionerId: url.get("practitioner") ?? undefined,
      fromDate: url.get("from") ?? undefined,
      days: Number.isInteger(days) && days > 0 ? days : undefined,
    }),
  );
});
