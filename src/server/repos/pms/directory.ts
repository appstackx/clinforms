/**
 * The clinic directory: sites, rooms, practitioners and services (appointment types). Never deleted – switched
 * inactive (history keeps pointing at them). Every write is audited.
 */
import { FOUNDATION_ID_PREFIXES as P } from "../../../modules/pms/core/ids";
import {
  PractitionerInputSchema,
  PractitionerPatchSchema,
  RoomInputSchema,
  RoomPatchSchema,
  ServiceInputSchema,
  ServicePatchSchema,
  SiteInputSchema,
  SitePatchSchema,
  type PractitionerInput,
  type PractitionerPatch,
  type RoomInput,
  type RoomPatch,
  type ServiceInput,
  type ServicePatch,
  type SiteInput,
  type SitePatch,
} from "../../../modules/pms/core/schemas";
import type { Practitioner, PmsActor, Profession, Room, Service, ServiceCategory, Site } from "../../../modules/pms/core/types";
import type { Selectable } from "kysely";
import type { PmsPractitionersTable, PmsRoomsTable, PmsServicesTable, PmsSitesTable } from "../../db/pms-schema/foundation";
import {
  assertId,
  assertTenantId,
  b01,
  guarded,
  isOn,
  jsonLines,
  nowIso,
  num,
  numOrNull,
  parseInput,
  parseLines,
  patchColumns,
  pmsAudit,
  pmsAuditQuery,
  pmsId,
  writeWithAudit,
  type DbContext,
} from "./context";

const linesOrNull = (v: string[] | null) => jsonLines(v);
const flag = (v: boolean) => b01(v);

/* ------------------------------------------------------------------------------------------------
 * Sites
 * ----------------------------------------------------------------------------------------------*/

function toSite(r: Selectable<PmsSitesTable>): Site {
  return {
    tenantId: r.tenant_id,
    id: r.id,
    name: r.name,
    code: r.code,
    address: parseLines(r.address_json),
    postcode: r.postcode,
    phone: r.phone,
    email: r.email,
    active: isOn(r.active),
    sortOrder: num(r.sort_order),
    importRef: r.import_ref,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const SITE_MESSAGES = { unique: "A site with this name (or import reference) already exists." };

export async function createSite(ctx: DbContext, tenantId: string, input: SiteInput, actor: PmsActor): Promise<Site> {
  assertTenantId(tenantId);
  const d = parseInput(SiteInputSchema, input, "Site");
  const id = pmsId(P.site, ctx);
  const at = nowIso(ctx);
  await writeWithAudit(
    ctx,
    [
      ctx.db.insertInto("pms_sites").values({
        tenant_id: tenantId,
        id,
        name: d.name,
        code: d.code ?? null,
        address_json: jsonLines(d.address),
        postcode: d.postcode ?? null,
        phone: d.phone ?? null,
        email: d.email ?? null,
        active: b01(d.active ?? true),
        sort_order: d.sortOrder ?? 0,
        import_ref: d.importRef ?? null,
        created_at: at,
        updated_at: at,
      }),
      pmsAuditQuery(ctx, tenantId, actor, { action: "pms.site.create", targetType: "pms_site", targetId: id }),
    ],
    SITE_MESSAGES,
  );
  return (await getSite(ctx, tenantId, id)) as Site;
}

export async function updateSite(ctx: DbContext, tenantId: string, id: string, patch: SitePatch, actor: PmsActor): Promise<Site | null> {
  assertTenantId(tenantId);
  assertId(id, "site id");
  const d = parseInput(SitePatchSchema, patch, "Site");
  const set: Record<string, unknown> = {};
  const fields = patchColumns(
    d,
    {
      name: "name",
      code: "code",
      address: ["address_json", linesOrNull],
      postcode: "postcode",
      phone: "phone",
      email: "email",
      active: ["active", flag],
      sortOrder: "sort_order",
      importRef: "import_ref",
    },
    set,
  );
  if (fields.length === 0) return getSite(ctx, tenantId, id);
  const result = await guarded(
    () => ctx.db.updateTable("pms_sites").set({ ...set, updated_at: nowIso(ctx) }).where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst(),
    SITE_MESSAGES,
  );
  if (Number(result.numUpdatedRows) === 0) return null;
  await pmsAudit(ctx, tenantId, actor, { action: "pms.site.update", targetType: "pms_site", targetId: id, detail: { fields } });
  return getSite(ctx, tenantId, id);
}

export async function getSite(ctx: DbContext, tenantId: string, id: string): Promise<Site | null> {
  assertTenantId(tenantId);
  const row = await ctx.db.selectFrom("pms_sites").selectAll().where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  return row ? toSite(row) : null;
}

export async function listSites(ctx: DbContext, tenantId: string, options: { includeInactive?: boolean } = {}): Promise<Site[]> {
  assertTenantId(tenantId);
  let q = ctx.db.selectFrom("pms_sites").selectAll().where("tenant_id", "=", tenantId);
  if (!options.includeInactive) q = q.where("active", "=", 1);
  const rows = await q.orderBy("sort_order").orderBy("name").limit(500).execute();
  return rows.map(toSite);
}

/* ------------------------------------------------------------------------------------------------
 * Rooms
 * ----------------------------------------------------------------------------------------------*/

function toRoom(r: Selectable<PmsRoomsTable>): Room {
  return {
    tenantId: r.tenant_id,
    id: r.id,
    siteId: r.site_id,
    name: r.name,
    active: isOn(r.active),
    sortOrder: num(r.sort_order),
    importRef: r.import_ref,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const ROOM_MESSAGES = { unique: "This site already has a room with this name.", foreignKey: "That site does not exist in this clinic." };

export async function createRoom(ctx: DbContext, tenantId: string, input: RoomInput, actor: PmsActor): Promise<Room> {
  assertTenantId(tenantId);
  const d = parseInput(RoomInputSchema, input, "Room");
  const id = pmsId(P.room, ctx);
  const at = nowIso(ctx);
  await writeWithAudit(
    ctx,
    [
      ctx.db.insertInto("pms_rooms").values({
        tenant_id: tenantId,
        id,
        site_id: d.siteId,
        name: d.name,
        active: b01(d.active ?? true),
        sort_order: d.sortOrder ?? 0,
        import_ref: d.importRef ?? null,
        created_at: at,
        updated_at: at,
      }),
      pmsAuditQuery(ctx, tenantId, actor, { action: "pms.room.create", targetType: "pms_room", targetId: id, detail: { siteId: d.siteId } }),
    ],
    ROOM_MESSAGES,
  );
  return (await getRoom(ctx, tenantId, id)) as Room;
}

export async function updateRoom(ctx: DbContext, tenantId: string, id: string, patch: RoomPatch, actor: PmsActor): Promise<Room | null> {
  assertTenantId(tenantId);
  assertId(id, "room id");
  const d = parseInput(RoomPatchSchema, patch, "Room");
  const set: Record<string, unknown> = {};
  const fields = patchColumns(d, { name: "name", active: ["active", flag], sortOrder: "sort_order", importRef: "import_ref" }, set);
  if (fields.length === 0) return getRoom(ctx, tenantId, id);
  const result = await guarded(
    () => ctx.db.updateTable("pms_rooms").set({ ...set, updated_at: nowIso(ctx) }).where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst(),
    ROOM_MESSAGES,
  );
  if (Number(result.numUpdatedRows) === 0) return null;
  await pmsAudit(ctx, tenantId, actor, { action: "pms.room.update", targetType: "pms_room", targetId: id, detail: { fields } });
  return getRoom(ctx, tenantId, id);
}

export async function getRoom(ctx: DbContext, tenantId: string, id: string): Promise<Room | null> {
  assertTenantId(tenantId);
  const row = await ctx.db.selectFrom("pms_rooms").selectAll().where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  return row ? toRoom(row) : null;
}

export async function listRooms(ctx: DbContext, tenantId: string, options: { siteId?: string; includeInactive?: boolean } = {}): Promise<Room[]> {
  assertTenantId(tenantId);
  let q = ctx.db.selectFrom("pms_rooms").selectAll().where("tenant_id", "=", tenantId);
  if (options.siteId) q = q.where("site_id", "=", options.siteId);
  if (!options.includeInactive) q = q.where("active", "=", 1);
  const rows = await q.orderBy("site_id").orderBy("sort_order").orderBy("name").limit(1000).execute();
  return rows.map(toRoom);
}

/* ------------------------------------------------------------------------------------------------
 * Practitioners
 * ----------------------------------------------------------------------------------------------*/

function toPractitioner(r: Selectable<PmsPractitionersTable>): Practitioner {
  return {
    tenantId: r.tenant_id,
    id: r.id,
    userId: r.user_id,
    displayName: r.display_name,
    profession: r.profession as Profession,
    registrationNumber: r.registration_number,
    email: r.email,
    phone: r.phone,
    colour: r.colour,
    defaultSiteId: r.default_site_id,
    bookable: isOn(r.bookable),
    onlineBookable: isOn(r.online_bookable),
    active: isOn(r.active),
    sortOrder: num(r.sort_order),
    importRef: r.import_ref,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const PRACTITIONER_MESSAGES = {
  unique: "This member (or import reference) is already linked to a practitioner.",
  foreignKey: "That site does not exist in this clinic.",
};

export async function createPractitioner(ctx: DbContext, tenantId: string, input: PractitionerInput, actor: PmsActor): Promise<Practitioner> {
  assertTenantId(tenantId);
  const d = parseInput(PractitionerInputSchema, input, "Practitioner");
  const id = pmsId(P.practitioner, ctx);
  const at = nowIso(ctx);
  await writeWithAudit(
    ctx,
    [
      ctx.db.insertInto("pms_practitioners").values({
        tenant_id: tenantId,
        id,
        user_id: d.userId ?? null,
        display_name: d.displayName,
        profession: d.profession ?? "physiotherapist",
        registration_number: d.registrationNumber ?? null,
        email: d.email ?? null,
        phone: d.phone ?? null,
        colour: d.colour ?? null,
        default_site_id: d.defaultSiteId ?? null,
        bookable: b01(d.bookable ?? true),
        online_bookable: b01(d.onlineBookable ?? false),
        active: b01(d.active ?? true),
        sort_order: d.sortOrder ?? 0,
        import_ref: d.importRef ?? null,
        created_at: at,
        updated_at: at,
      }),
      pmsAuditQuery(ctx, tenantId, actor, { action: "pms.practitioner.create", targetType: "pms_practitioner", targetId: id }),
    ],
    PRACTITIONER_MESSAGES,
  );
  return (await getPractitioner(ctx, tenantId, id)) as Practitioner;
}

export async function updatePractitioner(ctx: DbContext, tenantId: string, id: string, patch: PractitionerPatch, actor: PmsActor): Promise<Practitioner | null> {
  assertTenantId(tenantId);
  assertId(id, "practitioner id");
  const d = parseInput(PractitionerPatchSchema, patch, "Practitioner");
  const set: Record<string, unknown> = {};
  const fields = patchColumns(
    d,
    {
      userId: "user_id",
      displayName: "display_name",
      profession: "profession",
      registrationNumber: "registration_number",
      email: "email",
      phone: "phone",
      colour: "colour",
      defaultSiteId: "default_site_id",
      bookable: ["bookable", flag],
      onlineBookable: ["online_bookable", flag],
      active: ["active", flag],
      sortOrder: "sort_order",
      importRef: "import_ref",
    },
    set,
  );
  if (fields.length === 0) return getPractitioner(ctx, tenantId, id);
  const result = await guarded(
    () => ctx.db.updateTable("pms_practitioners").set({ ...set, updated_at: nowIso(ctx) }).where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst(),
    PRACTITIONER_MESSAGES,
  );
  if (Number(result.numUpdatedRows) === 0) return null;
  await pmsAudit(ctx, tenantId, actor, { action: "pms.practitioner.update", targetType: "pms_practitioner", targetId: id, detail: { fields } });
  return getPractitioner(ctx, tenantId, id);
}

export async function getPractitioner(ctx: DbContext, tenantId: string, id: string): Promise<Practitioner | null> {
  assertTenantId(tenantId);
  const row = await ctx.db.selectFrom("pms_practitioners").selectAll().where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  return row ? toPractitioner(row) : null;
}

/** The practitioner row linked to a member's account, if any. */
export async function findPractitionerByUser(ctx: DbContext, tenantId: string, userId: string): Promise<Practitioner | null> {
  assertTenantId(tenantId);
  const row = await ctx.db.selectFrom("pms_practitioners").selectAll().where("tenant_id", "=", tenantId).where("user_id", "=", userId).executeTakeFirst();
  return row ? toPractitioner(row) : null;
}

export async function listPractitioners(ctx: DbContext, tenantId: string, options: { includeInactive?: boolean; bookableOnly?: boolean; siteId?: string } = {}): Promise<Practitioner[]> {
  assertTenantId(tenantId);
  let q = ctx.db.selectFrom("pms_practitioners").selectAll().where("tenant_id", "=", tenantId);
  if (!options.includeInactive) q = q.where("active", "=", 1);
  if (options.bookableOnly) q = q.where("bookable", "=", 1);
  if (options.siteId) q = q.where("default_site_id", "=", options.siteId);
  const rows = await q.orderBy("sort_order").orderBy("display_name").limit(1000).execute();
  return rows.map(toPractitioner);
}

/* ------------------------------------------------------------------------------------------------
 * Services (appointment types)
 * ----------------------------------------------------------------------------------------------*/

function toService(r: Selectable<PmsServicesTable>): Service {
  return {
    tenantId: r.tenant_id,
    id: r.id,
    name: r.name,
    code: r.code,
    category: r.category as ServiceCategory,
    durationMinutes: num(r.duration_minutes),
    bufferMinutes: num(r.buffer_minutes),
    defaultPricePence: numOrNull(r.default_price_pence),
    colour: r.colour,
    onlineBookable: isOn(r.online_bookable),
    active: isOn(r.active),
    sortOrder: num(r.sort_order),
    importRef: r.import_ref,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const SERVICE_MESSAGES = { unique: "An appointment type with this name (or import reference) already exists." };

export async function createService(ctx: DbContext, tenantId: string, input: ServiceInput, actor: PmsActor): Promise<Service> {
  assertTenantId(tenantId);
  const d = parseInput(ServiceInputSchema, input, "Appointment type");
  const id = pmsId(P.service, ctx);
  const at = nowIso(ctx);
  await writeWithAudit(
    ctx,
    [
      ctx.db.insertInto("pms_services").values({
        tenant_id: tenantId,
        id,
        name: d.name,
        code: d.code ?? null,
        category: d.category ?? "treatment",
        duration_minutes: d.durationMinutes,
        buffer_minutes: d.bufferMinutes ?? 0,
        default_price_pence: d.defaultPricePence ?? null,
        colour: d.colour ?? null,
        online_bookable: b01(d.onlineBookable ?? false),
        active: b01(d.active ?? true),
        sort_order: d.sortOrder ?? 0,
        import_ref: d.importRef ?? null,
        created_at: at,
        updated_at: at,
      }),
      pmsAuditQuery(ctx, tenantId, actor, { action: "pms.service.create", targetType: "pms_service", targetId: id }),
    ],
    SERVICE_MESSAGES,
  );
  return (await getService(ctx, tenantId, id)) as Service;
}

export async function updateService(ctx: DbContext, tenantId: string, id: string, patch: ServicePatch, actor: PmsActor): Promise<Service | null> {
  assertTenantId(tenantId);
  assertId(id, "service id");
  const d = parseInput(ServicePatchSchema, patch, "Appointment type");
  const set: Record<string, unknown> = {};
  const fields = patchColumns(
    d,
    {
      name: "name",
      code: "code",
      category: "category",
      durationMinutes: "duration_minutes",
      bufferMinutes: "buffer_minutes",
      defaultPricePence: "default_price_pence",
      colour: "colour",
      onlineBookable: ["online_bookable", flag],
      active: ["active", flag],
      sortOrder: "sort_order",
      importRef: "import_ref",
    },
    set,
  );
  if (fields.length === 0) return getService(ctx, tenantId, id);
  const result = await guarded(
    () => ctx.db.updateTable("pms_services").set({ ...set, updated_at: nowIso(ctx) }).where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst(),
    SERVICE_MESSAGES,
  );
  if (Number(result.numUpdatedRows) === 0) return null;
  await pmsAudit(ctx, tenantId, actor, { action: "pms.service.update", targetType: "pms_service", targetId: id, detail: { fields } });
  return getService(ctx, tenantId, id);
}

export async function getService(ctx: DbContext, tenantId: string, id: string): Promise<Service | null> {
  assertTenantId(tenantId);
  const row = await ctx.db.selectFrom("pms_services").selectAll().where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  return row ? toService(row) : null;
}

export async function listServices(ctx: DbContext, tenantId: string, options: { includeInactive?: boolean; onlineOnly?: boolean } = {}): Promise<Service[]> {
  assertTenantId(tenantId);
  let q = ctx.db.selectFrom("pms_services").selectAll().where("tenant_id", "=", tenantId);
  if (!options.includeInactive) q = q.where("active", "=", 1);
  if (options.onlineOnly) q = q.where("online_bookable", "=", 1);
  const rows = await q.orderBy("sort_order").orderBy("name").limit(500).execute();
  return rows.map(toService);
}
