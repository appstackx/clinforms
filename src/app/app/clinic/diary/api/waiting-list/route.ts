/**
 * GET /app/clinic/diary/api/waiting-list?status=open|waiting|offered|booked|removed&site=…&practitioner=…&patient=…
 * – the waiting list (WaitingListRow[]), most urgent first, for the member's sites and entries for any site.
 * Nothing decrypted. JSON, never cached.
 */
import { readResponse } from "@/server/pms/diary/actions-support";
import { diaryCallerOf } from "@/server/pms/diary/caller";
import { loadWaitingList } from "@/server/pms/diary/reads";
import { clinicRoute } from "@/server/pms/http";

export const dynamic = "force-dynamic";

const STATUSES = ["open", "waiting", "offered", "booked", "removed"] as const;

export const GET = clinicRoute({ permission: "diary.view" }, async (req, actor) => {
  const url = new URL(req.url).searchParams;
  const status = STATUSES.find((s) => s === url.get("status")) ?? "open";
  return readResponse(
    await loadWaitingList(await diaryCallerOf(actor), { status, siteId: url.get("site") ?? undefined, practitionerId: url.get("practitioner") ?? undefined, patientId: url.get("patient") ?? undefined }),
  );
});
