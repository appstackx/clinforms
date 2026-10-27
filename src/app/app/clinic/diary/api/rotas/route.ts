/**
 * GET /app/clinic/diary/api/rotas?site=…&practitioner=…&ended=1 – rota entries (RotaRow[]) at the member's sites.
 * Changing them needs diary.manage (rotas/actions.ts). JSON, never cached.
 */
import { readResponse } from "@/server/pms/diary/actions-support";
import { diaryCallerOf } from "@/server/pms/diary/caller";
import { loadRotas } from "@/server/pms/diary/reads";
import { clinicRoute } from "@/server/pms/http";

export const dynamic = "force-dynamic";

export const GET = clinicRoute({ permission: "diary.view" }, async (req, actor) => {
  const url = new URL(req.url).searchParams;
  return readResponse(await loadRotas(await diaryCallerOf(actor), { siteId: url.get("site") ?? undefined, practitionerId: url.get("practitioner") ?? undefined, includeEnded: url.get("ended") === "1" }));
});
