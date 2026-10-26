/**
 * Staff of the clinic for the set-up screens: the clinic's members (ClinForms' own member list – one list for
 * the whole product) with their clinic-system site access and diary link.
 */
import "server-only";
import { listClinicMembers, type ClinicMemberView } from "../../auth/membership";
import type { Practitioner } from "../../../modules/pms/core/types";
import { listPractitioners } from "../../repos/pms/directory";
import { defaultStaffAccess, listStaffAccess, type StaffAccess } from "../../repos/pms/reporting/staff-access";
import type { ClinicActor } from "../actor";

export interface StaffMember {
  member: ClinicMemberView;
  access: StaffAccess;
  practitioner: Practitioner | null;
}

export async function listStaff(actor: Pick<ClinicActor, "repo" | "tenantId" | "organizationId">): Promise<{ staff: StaffMember[]; practitioners: Practitioner[] }> {
  const ctx = actor.repo();
  const [members, access, practitioners] = await Promise.all([listClinicMembers(ctx.db, actor.organizationId), listStaffAccess(ctx, actor.tenantId), listPractitioners(ctx, actor.tenantId, { includeInactive: true })]);
  return {
    staff: members.map((m) => ({
      member: m,
      access: access.get(m.userId) ?? defaultStaffAccess(actor.tenantId, m.userId),
      practitioner: practitioners.find((p) => p.userId === m.userId) ?? null,
    })),
    practitioners,
  };
}

/** The member of THIS clinic with that account, or null (never trust an id from a form for another clinic). */
export async function clinicMember(actor: Pick<ClinicActor, "repo" | "organizationId">, userId: string): Promise<ClinicMemberView | null> {
  const members = await listClinicMembers(actor.repo().db, actor.organizationId);
  return members.find((m) => m.userId === userId) ?? null;
}

export async function isClinicMember(actor: Pick<ClinicActor, "repo" | "organizationId">, userId: string): Promise<boolean> {
  return (await clinicMember(actor, userId)) !== null;
}
