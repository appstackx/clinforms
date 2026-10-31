/**
 * The diary's adapter for the portal's diary port (src/server/pms/portal/diary-port.ts) – wired at M7, like
 * billing's visit source (./billing-visits.ts) and the comms hook (./message-sync.ts). Online bookings are diary
 * appointments: booked, cancelled and moved by the diary's own repository functions, so the diary's clash rule and
 * its database triggers cover them, and comms plans their messages through the same hook as reception's bookings.
 *
 * Never overrides: no practitioner double-booking, no patient overlap, no booking outside a window marked for online
 * booking (the slot is re-checked against findFreeSlots by the portal before it books).
 */
import "server-only";
import type { PmsActor } from "../../../modules/pms/core/types";
import type { DiaryItem } from "../../../modules/pms/diary/types";
import { formatHhmm } from "../../../modules/pms/diary/time";
import type { BatchQuery } from "../../db/batch";
import type { RepoContext } from "../../repos/context";
import { bookAppointment, getDiaryItem, listPatientAppointments, moveAppointment, setAppointmentStatus } from "../../repos/pms/diary/appointments";
import { findFreeSlots } from "../../repos/pms/diary/slots";
import { listAvailability } from "../../repos/pms/diary/availability";
import type { PortalAppointment, PortalDiaryPort, PortalWriteResult } from "../portal/diary-port";
import { syncDiaryMessages } from "./message-sync";

function view(i: DiaryItem): PortalAppointment {
  return {
    id: i.id,
    rev: i.rev,
    patientId: i.patientId as string,
    siteId: i.siteId,
    practitionerId: i.practitionerId,
    serviceId: i.serviceId,
    startsAt: i.startsAt,
    endsAt: i.endsAt,
    status: i.status,
    source: i.source,
    feeDue: i.feeDue,
  };
}

function saveAnswer(r: { ok: true; item: DiaryItem } | { ok: false; reason: string }): PortalWriteResult {
  if (r.ok) return { ok: true, appointment: view(r.item) };
  return { ok: false, reason: r.reason === "clash" ? "clash" : r.reason === "not_found" ? "not_found" : "conflict" };
}

export const diaryPortalAdapter: PortalDiaryPort = {
  async onlineRota(ctx, tenantId, today) {
    const rules = await listAvailability(ctx, tenantId, { today });
    const seen = new Set<string>();
    const out: { practitionerId: string; siteId: string }[] = [];
    for (const r of rules) {
      if (!r.onlineBookable) continue;
      const key = `${r.practitionerId}|${r.siteId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ practitionerId: r.practitionerId, siteId: r.siteId });
    }
    return out;
  },

  async freeSlots(ctx, tenantId, q) {
    if (q.practitionerIds.length === 0) return [];
    const slots = await findFreeSlots(ctx, tenantId, {
      fromDate: q.fromDate,
      days: q.days,
      siteId: q.siteId,
      practitionerIds: q.practitionerIds,
      serviceId: q.serviceId,
      onlineOnly: true,
      stepMinutes: q.stepMinutes,
      notBefore: q.notBefore,
      limit: Math.min(200, Math.max(1, q.limit)),
      patientId: q.patientId ?? undefined,
    });
    return slots.filter((s) => s.startsAt < q.notAfter).map((s) => ({ ...s }));
  },

  async book(ctx, tenantId, input, actor, alsoWrite: (appointmentId: string) => BatchQuery[]) {
    const r = await bookAppointment(
      ctx,
      tenantId,
      {
        patientId: input.patientId,
        serviceId: input.serviceId,
        practitionerId: input.practitionerId,
        siteId: input.siteId,
        roomId: input.roomId,
        date: input.date,
        startTime: formatHhmm(input.startMinute),
        notes: input.notes,
        source: "online",
        sendConfirmation: true,
      },
      actor,
      { alsoWrite },
    );
    if (!r.ok) return { ok: false, reason: "clash" };
    const item = r.items[0];
    await syncDiaryMessages(ctx, tenantId, [item.id], actor, "booked");
    return { ok: true, appointment: view(item) };
  },

  async cancel(ctx, tenantId, appointmentId, expectedRev, change, actor: PmsActor) {
    const r = await setAppointmentStatus(
      ctx,
      tenantId,
      appointmentId,
      { expectedRev, status: change.late ? "late_cancelled" : "cancelled", cancelReason: "patient", feeDue: change.late },
      actor,
    );
    if (r.ok) await syncDiaryMessages(ctx, tenantId, [appointmentId], actor, "cancelled");
    return saveAnswer(r);
  },

  async move(ctx, tenantId, appointmentId, expectedRev, to, actor) {
    const before = await getDiaryItem(ctx, tenantId, appointmentId);
    if (!before) return { ok: false, reason: "not_found" };
    const r = await moveAppointment(ctx, tenantId, appointmentId, { expectedRev, date: to.date, startTime: formatHhmm(to.startMinute), practitionerId: to.practitionerId, roomId: to.roomId }, actor);
    if (r.ok) await syncDiaryMessages(ctx, tenantId, [appointmentId], actor, "moved", new Map([[appointmentId, before.startsAt]]));
    return saveAnswer(r);
  },

  async appointment(ctx: RepoContext, tenantId, id) {
    const item = await getDiaryItem(ctx, tenantId, id);
    return item && item.kind === "appointment" && item.patientId ? view(item) : null;
  },

  async patientAppointments(ctx, tenantId, patientId, options) {
    const items = await listPatientAppointments(ctx, tenantId, patientId, { limit: options.limit ?? 100 });
    return items.filter((i) => i.kind === "appointment" && (!options.fromIso || i.endsAt > options.fromIso)).map(view).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  },
};
