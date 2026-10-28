/**
 * GET /app/clinic/diary/api/day-sheet?site=…&date=YYYY-MM-DD&practitioner=…&cancelled=1 – the printable day sheet
 * (DaySheet: names, times, rooms, appointment types, statuses – never notes, dates of birth or contact details).
 * JSON, never cached; the print page renders the same data.
 */
import { readResponse } from "@/server/pms/diary/actions-support";
import { diaryCallerOf } from "@/server/pms/diary/caller";
import { loadDaySheet } from "@/server/pms/diary/reads";
import { clinicRoute } from "@/server/pms/http";

export const dynamic = "force-dynamic";

export const GET = clinicRoute({ permission: "diary.view" }, async (req, actor) => {
  const url = new URL(req.url).searchParams;
  return readResponse(
    await loadDaySheet(await diaryCallerOf(actor), { siteId: url.get("site") ?? "", date: url.get("date") ?? "", practitionerId: url.get("practitioner"), includeCancelled: url.get("cancelled") === "1" }),
  );
});
