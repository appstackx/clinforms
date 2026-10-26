/**
 * GET /app/clinic/diary/api/slots?service=…&practitioner=…&site=…&from=YYYY-MM-DD – the next free slots inside
 * the rota (booking form: "Find a free time"). JSON, never cached.
 */
import { PMS_ID_PATTERN } from "@/modules/pms/core/ids";
import { isIsoDate, ukToday } from "@/modules/pms/core/text";
import { formatHhmm } from "@/modules/pms/diary/time";
import { findFreeSlots } from "@/server/repos/pms/diary/slots";
import { listPractitioners } from "@/server/repos/pms/directory";
import { clinicRoute } from "@/server/pms/http";

export const dynamic = "force-dynamic";

export const GET = clinicRoute({ permission: "diary.view" }, async (req, actor) => {
  const url = new URL(req.url).searchParams;
  const id = (k: string) => {
    const v = url.get(k);
    return v && PMS_ID_PATTERN.test(v) ? v : undefined;
  };
  const serviceId = id("service");
  if (!serviceId) return Response.json({ slots: [] });
  const from = url.get("from");
  const ctx = actor.repo();
  const practitionerId = id("practitioner");
  const slots = await findFreeSlots(ctx, actor.tenantId, {
    fromDate: from && isIsoDate(from) && from >= ukToday() ? from : ukToday(),
    days: 21,
    serviceId,
    siteId: id("site"),
    practitionerIds: practitionerId ? [practitionerId] : undefined,
    limit: 12,
  });
  const names = new Map((await listPractitioners(ctx, actor.tenantId, { bookableOnly: true })).map((p) => [p.id, p.displayName]));
  return Response.json({
    slots: slots.map((s) => ({ date: s.date, time: formatHhmm(s.startMinute), practitionerId: s.practitionerId, practitionerName: names.get(s.practitionerId) ?? null, siteId: s.siteId, roomId: s.roomId })),
  });
});
