/**
 * Text credit warnings by email to the clinic's owner and admins (the account email service – ClinDesk's own
 * sender when it is configured; nothing to patients). Server only. No patient data, no payment details.
 */
import "server-only";
import { deliverEmail, textCreditNoticeEmail } from "../../../email";
import type { DbContext } from "../../../repos/pms/context";
import { commsLinkOrigin } from "../links";
import type { CreditNotice, CreditNotifier } from "./service";

export const CREDITS_PAGE_PATH = "/app/clinic/messages/credits";

/** The clinic's owners and admins (name, email) – members of THIS clinic only. */
export async function clinicManagers(ctx: DbContext, tenantId: string): Promise<{ name: string; email: string; clinicName: string }[]> {
  const rows = await ctx.db
    .selectFrom("member")
    .innerJoin("user", "user.id", "member.userId")
    .innerJoin("organization", "organization.id", "member.organizationId")
    .select(["user.name as name", "user.email as email", "organization.name as clinicName"])
    .where("organization.slug", "=", tenantId)
    .where("member.role", "in", ["owner", "admin"])
    .limit(20)
    .execute();
  return rows.map((r) => ({ name: r.name, email: r.email, clinicName: r.clinicName }));
}

export function emailCreditNotifier(env: Readonly<Record<string, string | undefined>> = process.env): CreditNotifier {
  return async (ctx: DbContext, tenantId: string, notice: CreditNotice) => {
    const managers = await clinicManagers(ctx, tenantId);
    const creditsUrl = `${commsLinkOrigin(env)}${CREDITS_PAGE_PATH}`;
    for (const m of managers) {
      await deliverEmail(textCreditNoticeEmail({ to: { email: m.email, name: m.name }, brand: "clinic", clinicName: m.clinicName, notice, creditsUrl }));
    }
  };
}
