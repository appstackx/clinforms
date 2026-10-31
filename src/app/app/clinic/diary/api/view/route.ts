/**
 * GET /app/clinic/diary/api/view?date=YYYY-MM-DD&view=day|week&by=practitioner|room&site=…&resource=…&cancelled=1&slot=30
 * – the diary grid's data (DiaryViewData) for a client that refreshes itself (polling, after a drag). The same
 * parameters as the diary page's address (parseDiaryParams). JSON, never cached.
 */
import { ukToday } from "@/modules/pms/core/text";
import { parseDiaryParams } from "@/modules/pms/diary/view";
import { currentPractitionerId } from "@/server/pms/actor";
import { readResponse } from "@/server/pms/diary/actions-support";
import { diaryCallerOf } from "@/server/pms/diary/caller";
import { loadDiaryView } from "@/server/pms/diary/view";
import { clinicRoute } from "@/server/pms/http";

export const dynamic = "force-dynamic";

export const GET = clinicRoute({ permission: "diary.view" }, async (req, actor) => {
  const url = new URL(req.url).searchParams;
  const today = ukToday();
  const params = parseDiaryParams(Object.fromEntries(url.entries()), today);
  const slot = Number(url.get("slot") ?? "");
  return readResponse(await loadDiaryView(await diaryCallerOf(actor), params, today, { practitionerId: await currentPractitionerId(actor), slotMinutes: Number.isInteger(slot) ? slot : undefined }));
});
