/**
 * The contact details and message preferences a message needs, read from the shared patient record
 * (pms_patients, owned by the foundation). READ ONLY and plain columns only – nothing encrypted is read, so the
 * reminder run never decrypts medical alerts or notes it does not need. Changes to the flags go through the
 * foundation's updatePatient() (./consent.ts).
 *
 * Integration note: the foundation's getPatientSummaries() has no preference flags; this narrow read is the
 * comms module's own until the foundation offers one (proposed: getPatientContactPreferences(ids)).
 */
import type { MessagingContact } from "../../../../modules/pms/comms/types";
import { phoneDigits } from "../../../../modules/pms/core/text";
import { assertTenantId, isOn, type DbContext } from "../context";

const COLUMNS = [
  "id",
  "title",
  "first_name",
  "preferred_name",
  "last_name",
  "phone_mobile",
  "email",
  "status",
  "reminder_sms",
  "reminder_email",
  "marketing_sms",
  "marketing_email",
] as const;

/** Contacts by patient id, in groups of 90 (D1's parameter limit). Patients of other clinics are never returned. */
export async function getMessagingContacts(ctx: DbContext, tenantId: string, ids: readonly string[]): Promise<Map<string, MessagingContact>> {
  assertTenantId(tenantId);
  const out = new Map<string, MessagingContact>();
  const unique = Array.from(new Set(ids));
  for (let i = 0; i < unique.length; i += 90) {
    const rows = await ctx.db
      .selectFrom("pms_patients")
      .select(COLUMNS)
      .where("tenant_id", "=", tenantId)
      .where("id", "in", unique.slice(i, i + 90))
      .execute();
    for (const r of rows) {
      out.set(r.id, {
        id: r.id,
        title: r.title,
        firstName: r.first_name,
        preferredName: r.preferred_name,
        lastName: r.last_name,
        phoneMobile: r.phone_mobile,
        email: r.email,
        status: (r.status as MessagingContact["status"]) ?? "active",
        reminderSms: isOn(r.reminder_sms),
        reminderEmail: isOn(r.reminder_email),
        marketingSms: isOn(r.marketing_sms),
        marketingEmail: isOn(r.marketing_email),
      });
    }
  }
  return out;
}

export async function getMessagingContact(ctx: DbContext, tenantId: string, id: string): Promise<MessagingContact | null> {
  return (await getMessagingContacts(ctx, tenantId, [id])).get(id) ?? null;
}

/**
 * Active patients whose mobile number matches a reply's number (phone digits, "07700900123"), at most 3 – the
 * caller only uses the match when there is exactly one.
 */
export async function findPatientsByMobile(ctx: DbContext, tenantId: string, digits: string): Promise<string[]> {
  assertTenantId(tenantId);
  if (!/^\d{8,15}$/.test(digits)) return [];
  const rows = await ctx.db
    .selectFrom("pms_patients")
    .select(["id", "phone_mobile"])
    .where("tenant_id", "=", tenantId)
    .where("status", "!=", "deceased")
    .where("search_phone", "like", `%${digits}%`)
    .limit(5)
    .execute();
  // search_phone holds every number of the record: keep the patients whose MOBILE is this number.
  return rows.filter((r) => phoneDigits(r.phone_mobile) === digits).map((r) => r.id).slice(0, 3);
}
