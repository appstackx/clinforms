/**
 * GET /app/clinic/diary/api/waiting-list/[entryId] – one waiting-list entry (WaitingListEntryView): notes
 * decrypted, its offers, and free slots that suit it (to offer one). JSON, never cached.
 */
import { readResponse } from "@/server/pms/diary/actions-support";
import { diaryCallerOf } from "@/server/pms/diary/caller";
import { loadWaitingListEntry } from "@/server/pms/diary/reads";
import { clinicRoute } from "@/server/pms/http";

export const dynamic = "force-dynamic";

export const GET = clinicRoute({ permission: "diary.view" }, async (_req, actor, params: { entryId: string }) =>
  readResponse(await loadWaitingListEntry(await diaryCallerOf(actor), params.entryId)),
);
