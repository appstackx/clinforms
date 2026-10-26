/**
 * POST /app/clinic/diary/api/patients {"q": "…"} – the diary's patient search (booking form, quick search, waiting
 * list): up to 10 active patients with their next appointment. Name, number, date of birth and postcode only.
 * POST so a name typed into the search never sits in an address (logs, history). Same-origin only; never cached.
 */
import { formatUkDate } from "@/modules/pms/core/text";
import { formatLondonTime } from "@/modules/pms/diary/time";
import { nowIso } from "@/server/repos/context";
import { nextAppointmentsFor } from "@/server/repos/pms/diary/appointments";
import { searchPatients } from "@/server/repos/pms/patients";
import { clinicRoute } from "@/server/pms/http";

export const dynamic = "force-dynamic";

export const POST = clinicRoute({ permission: "patients.view" }, async (req, actor) => {
  const body = (await req.json().catch(() => null)) as { q?: unknown } | null;
  const q = (typeof body?.q === "string" ? body.q : "").trim().slice(0, 80);
  if (q.length < 2) return Response.json({ patients: [] });
  const ctx = actor.repo();
  const found = await searchPatients(ctx, actor.tenantId, { q, limit: 10 });
  const next = actor.can("diary.view") ? await nextAppointmentsFor(ctx, actor.tenantId, found.map((p) => p.id), nowIso(ctx)) : new Map();
  return Response.json({
    patients: found.map((p) => {
      const n = next.get(p.id);
      return {
        id: p.id,
        name: `${p.preferredName || p.firstName} ${p.lastName}`,
        number: p.patientNumber,
        dateOfBirth: p.dateOfBirth ? formatUkDate(p.dateOfBirth) : null,
        postcode: p.postcode,
        hasAlerts: p.hasAlerts,
        next: n ? { id: n.id, date: n.startsOn, time: formatLondonTime(n.startsAt), siteId: n.siteId, practitionerId: n.practitionerId } : null,
      };
    }),
  });
});
