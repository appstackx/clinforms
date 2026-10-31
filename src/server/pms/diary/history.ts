/**
 * GET …/appointments/[id]/history: who changed a diary item and when (the drawer's "History of changes"). The rows
 * targeting the item, the rows naming it in their detail (the clinical note started from it) and, for a recurring
 * booking, the series' rows ("Rest of a recurring booking cancelled"). diary.view and the item's site in the
 * member's scope (else "not found", like the drawer itself); redacted for reception (history-rows.ts). Server only.
 */
import "server-only";
import { PMS_ID_PATTERN } from "../../../modules/pms/core/ids";
import { DIARY_COPY } from "../../../modules/pms/diary/copy";
import type { DiaryRead } from "../../../modules/pms/diary/types";
import { loadActivityLookups, type ActivityViewer } from "../../admin/activity";
import { listAuditAbout } from "../../repos/audit";
import { getAppointment } from "../../repos/pms/diary/appointments";
import { inScope, type DiaryCaller } from "./caller";
import { appointmentHistoryRows, type AppointmentHistoryRow } from "./history-rows";

export async function loadAppointmentHistory(caller: DiaryCaller, viewer: ActivityViewer, id: string): Promise<DiaryRead<AppointmentHistoryRow[]>> {
  if (!caller.can("diary.view")) return { ok: false, status: 403, error: DIARY_COPY.notAllowed };
  const notFound = { ok: false as const, status: 404 as const, error: DIARY_COPY.notFound };
  if (!PMS_ID_PATTERN.test(id)) return notFound;
  const { ctx, tenantId } = caller;
  const a = await getAppointment(ctx, tenantId, id);
  if (!a || !inScope(caller, a.siteId)) return notFound;
  const [own, series] = await Promise.all([listAuditAbout(ctx, tenantId, a.id, { limit: 200 }), a.seriesId ? listAuditAbout(ctx, tenantId, a.seriesId, { limit: 50 }) : Promise.resolve([])]);
  // Series rows: only those about the series itself (not the other appointments' own rows).
  const entries = [...own, ...series.filter((e) => e.targetId === a.seriesId)];
  const lookups = await loadActivityLookups(ctx.db, viewer, entries);
  return { ok: true, data: appointmentHistoryRows(entries, caller.can("clinical.view"), lookups).slice(0, 100) };
}
