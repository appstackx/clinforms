/**
 * POST /app/clinic/diary/api/patients {"q": "…"} – the diary's quick patient search (booking form, quick search,
 * waiting list): up to 10 active patients with their next appointment at the member's sites. Name, number, date of
 * birth and postcode only; nothing decrypted. POST so a name typed into the search never sits in an address
 * (logs, history). Same-origin only; never cached.
 */
import { readResponse } from "@/server/pms/diary/actions-support";
import { diaryCallerOf } from "@/server/pms/diary/caller";
import { searchDiaryPatients } from "@/server/pms/diary/reads";
import { clinicRoute } from "@/server/pms/http";

export const dynamic = "force-dynamic";

export const POST = clinicRoute({ permission: "patients.view" }, async (req, actor) => {
  const body = (await req.json().catch(() => null)) as { q?: unknown } | null;
  return readResponse(await searchDiaryPatients(await diaryCallerOf(actor), body?.q));
});
