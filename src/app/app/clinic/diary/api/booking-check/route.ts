/**
 * GET /app/clinic/diary/api/booking-check?serviceId=…&practitionerId=…&siteId=…&roomId=…&patientId=…&date=…&startTime=…
 *   [&intervalWeeks=1&occurrences=6] – the booking dialog's live check: is the time free, what is in the way (with
 * names), the next free slot, which dates of a series are free. Reads only. JSON, never cached.
 */
import { readResponse } from "@/server/pms/diary/actions-support";
import { checkBookingFor } from "@/server/pms/diary/booking-check";
import { diaryCallerOf } from "@/server/pms/diary/caller";
import { clinicRoute } from "@/server/pms/http";

export const dynamic = "force-dynamic";

export const GET = clinicRoute({ permission: "diary.book" }, async (req, actor) => {
  const u = new URL(req.url).searchParams;
  const n = (k: string) => (u.get(k) ? Number(u.get(k)) : undefined);
  const occurrences = n("occurrences");
  const input = {
    patientId: u.get("patientId") || null,
    serviceId: u.get("serviceId") ?? "",
    practitionerId: u.get("practitionerId") ?? "",
    siteId: u.get("siteId") ?? "",
    roomId: u.get("roomId") || null,
    date: u.get("date") ?? "",
    startTime: u.get("startTime") ?? "",
    durationMinutes: n("durationMinutes"),
    repeat: occurrences && occurrences > 1 ? { intervalWeeks: n("intervalWeeks") ?? 1, occurrences } : null,
  };
  return readResponse(await checkBookingFor(await diaryCallerOf(actor), input));
});
