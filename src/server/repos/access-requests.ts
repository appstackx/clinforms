/**
 * `access_requests` – the landing page's "Request access" submissions (not tenant data: a clinic asks to
 * become a tenant). Listed only by platform admins.
 */
import { RepoInputError, assertId, assertText, nowIso, optionalText, randomId, type DbContext } from "./context";

export interface AccessRequestInput {
  clinicName: string;
  contactName: string;
  email: string;
  phone?: string | null;
  message?: string | null;
}

export interface AccessRequest {
  id: string;
  clinicName: string;
  contactName: string;
  email: string;
  phone: string | null;
  message: string | null;
  createdAt: string;
}

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,63}$/;

export async function createAccessRequest(ctx: DbContext, input: AccessRequestInput): Promise<AccessRequest> {
  const email = assertText(input.email?.trim(), "Email", 254);
  if (!EMAIL.test(email)) throw new RepoInputError("Email is not valid.");
  const request: AccessRequest = {
    id: randomId("ar"),
    clinicName: assertText(input.clinicName?.trim(), "Clinic name", 200),
    contactName: assertText(input.contactName?.trim(), "Contact name", 200),
    email,
    phone: optionalText(input.phone?.trim(), "Phone", 40),
    message: optionalText(input.message?.trim(), "Message", 4000),
    createdAt: nowIso(ctx),
  };
  await ctx.db
    .insertInto("access_requests")
    .values({
      id: request.id,
      clinic_name: request.clinicName,
      contact_name: request.contactName,
      email: request.email,
      phone: request.phone,
      message: request.message,
      created_at: request.createdAt,
    })
    .execute();
  return request;
}

export async function listAccessRequests(ctx: DbContext, options: { limit?: number } = {}): Promise<AccessRequest[]> {
  const limit = Math.min(Math.max(1, Math.floor(options.limit ?? 100)), 500);
  const rows = await ctx.db.selectFrom("access_requests").selectAll().orderBy("created_at", "desc").orderBy("id").limit(limit).execute();
  return rows.map((r) => ({
    id: r.id,
    clinicName: r.clinic_name,
    contactName: r.contact_name,
    email: r.email,
    phone: r.phone,
    message: r.message,
    createdAt: r.created_at,
  }));
}

export async function deleteAccessRequest(ctx: DbContext, id: string): Promise<boolean> {
  assertId(id, "Access request id");
  const result = await ctx.db.deleteFrom("access_requests").where("id", "=", id).executeTakeFirst();
  return Number(result.numDeletedRows) > 0;
}
