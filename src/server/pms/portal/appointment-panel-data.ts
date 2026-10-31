/** An appointment card as the patient's appointment panel needs it (shared by the portal and the manage link). */
import "server-only";
import type { AppointmentPanelData } from "../../../modules/pms/portal/flow-types";
import { changeRefusalMessage } from "../../../modules/pms/portal/policy";
import type { AppointmentCard } from "./portal-views";
import type { PublicClinic } from "./public-clinic";

export function panelData(clinic: PublicClinic, a: AppointmentCard): AppointmentPanelData {
  const cancel = a.rights.cancel;
  const move = a.rights.move;
  return {
    id: a.id,
    rev: a.rev,
    when: a.when,
    service: a.service,
    practitioner: a.practitioner,
    site: a.site,
    siteAddress: a.siteAddress,
    status: a.status,
    statusWords: a.statusWords,
    reference: a.reference,
    canCancel: cancel.ok,
    late: cancel.ok && cancel.late,
    canMove: move.ok,
    freeUntil: a.rights.freeUntil,
    lateFee: a.lateFee,
    noticeHours: clinic.settings.cancelNoticeHours,
    refusal: !cancel.ok && a.status === "booked" ? changeRefusalMessage(cancel.reason, clinic.settings.contactPhone) : null,
  };
}
