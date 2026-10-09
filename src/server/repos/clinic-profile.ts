/** `clinic_profile` – the clinic (tenant) written into referrer forms; replaces DEMO_CLINIC in tenant mode. */
import {
  RepoInputError,
  assertId,
  assertTenantId,
  assertText,
  flag,
  jsonOrNull,
  nowIso,
  optionalText,
  parseJson,
  toBool,
  toInt,
  type DbContext,
} from "./context";

export interface ClinicProfile {
  tenantId: string;
  organizationId: string;
  displayName: string;
  legalName: string | null;
  /** Postal address lines (stored as JSON). */
  address: string[] | null;
  postcode: string | null;
  phone: string | null;
  email: string | null;
  retentionDays: number;
  draftingEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ClinicProfileInput {
  organizationId: string;
  displayName: string;
  legalName?: string | null;
  address?: string[] | null;
  postcode?: string | null;
  phone?: string | null;
  email?: string | null;
  /** Default 365. */
  retentionDays?: number;
  /** Default false. */
  draftingEnabled?: boolean;
}

function toProfile(row: {
  tenant_id: string;
  organization_id: string;
  display_name: string;
  legal_name: string | null;
  address_json: string | null;
  postcode: string | null;
  phone: string | null;
  email: string | null;
  retention_days: number;
  drafting_enabled: number;
  created_at: string;
  updated_at: string;
}): ClinicProfile {
  return {
    tenantId: row.tenant_id,
    organizationId: row.organization_id,
    displayName: row.display_name,
    legalName: row.legal_name,
    address: parseJson<string[]>(row.address_json),
    postcode: row.postcode,
    phone: row.phone,
    email: row.email,
    retentionDays: toInt(row.retention_days),
    draftingEnabled: toBool(row.drafting_enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getClinicProfile(ctx: DbContext, tenantId: string): Promise<ClinicProfile | null> {
  assertTenantId(tenantId);
  const row = await ctx.db.selectFrom("clinic_profile").selectAll().where("tenant_id", "=", tenantId).executeTakeFirst();
  return row ? toProfile(row) : null;
}

/** Creates or replaces the tenant's profile (created_at is kept on update). */
export async function upsertClinicProfile(ctx: DbContext, tenantId: string, input: ClinicProfileInput): Promise<ClinicProfile> {
  assertTenantId(tenantId);
  const retentionDays = input.retentionDays ?? 365;
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 36500) {
    throw new RepoInputError("retentionDays must be 1–36500.");
  }
  if (input.address && (!Array.isArray(input.address) || input.address.some((l) => typeof l !== "string" || l.length > 200))) {
    throw new RepoInputError("address must be a list of lines (≤ 200 characters each).");
  }
  const values = {
    organization_id: assertId(input.organizationId, "organizationId"),
    display_name: assertText(input.displayName, "displayName", 200),
    legal_name: optionalText(input.legalName, "legalName", 200),
    address_json: jsonOrNull(input.address ?? null, "address", 4096),
    postcode: optionalText(input.postcode, "postcode", 16),
    phone: optionalText(input.phone, "phone", 40),
    email: optionalText(input.email, "email", 254),
    retention_days: retentionDays,
    drafting_enabled: flag(input.draftingEnabled ?? false),
  };
  const at = nowIso(ctx);
  await ctx.db
    .insertInto("clinic_profile")
    .values({ tenant_id: tenantId, ...values, created_at: at, updated_at: at })
    .onConflict((oc) => oc.column("tenant_id").doUpdateSet({ ...values, updated_at: at }))
    .execute();
  const saved = await getClinicProfile(ctx, tenantId);
  if (!saved) throw new Error("clinic_profile upsert did not persist.");
  return saved;
}

export async function deleteClinicProfile(ctx: DbContext, tenantId: string): Promise<boolean> {
  assertTenantId(tenantId);
  const result = await ctx.db.deleteFrom("clinic_profile").where("tenant_id", "=", tenantId).executeTakeFirst();
  return Number(result.numDeletedRows) > 0;
}
