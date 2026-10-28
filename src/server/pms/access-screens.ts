/**
 * Server layer of the two access screens (foundation): Set-up → Roles and permissions, and Staff access → member
 * access. Every function checks "Manage members and permissions" (settings.members) itself, reads the clinic's
 * members from ClinForms' own member/user tables (read only – roles still change through Better Auth, in the
 * actions), and writes through src/server/repos/pms/access.ts (audited, locks refused and audited).
 *
 * Guard rails beyond the permission:
 *   - nobody changes their OWN access here (an admin cannot widen their own rights) – another manager does;
 *   - the owner's access is locked (everything, every site) and nobody but the owner can make or change an owner;
 *   - the owner and one's own account cannot be deactivated.
 */
import "server-only";
import { visibleSiteIds, type AccessChange, type AccessChangeItem, type MemberAccess, type MemberAccessInput, type RoleOverride, type RolePermissionChange } from "../../modules/pms/core/access";
import { isPmsRole, type PmsRole } from "../../modules/pms/core/permissions";
import type { Site } from "../../modules/pms/core/types";
import { parseMemberRole } from "../auth/roles";
import { getDb } from "../db";
import { RepoInputError } from "../repos/context";
import { getMemberAccess, listAccessChanges, listMemberAccess, listRoleOverrides, saveMemberAccess, saveRolePermissions, setMemberActive, type AccessSaveResult } from "../repos/pms/access";
import { findPractitionerByUser, listSites, setPractitionerSigning } from "../repos/pms/directory";
import { getPmsSettings } from "../repos/pms/settings";
import { isDemoClinic } from "../admin/clinic-plan";
import { checkSigning, isRegistrationBody, type RegistrationBody, type SigningInput } from "../../modules/pms/core/signing";
import type { ClinicActor } from "./actor";

export interface ClinicMember {
  memberId: string;
  userId: string;
  name: string;
  email: string;
  role: PmsRole;
  twoStep: boolean;
}

export type ScreenResult<T> = { ok: true; value: T } | { ok: false; code: "forbidden" | "not_found" | "invalid" | "conflict" | "locked"; error: string; fieldErrors?: Record<string, string> };

const FORBIDDEN = { ok: false as const, code: "forbidden" as const, error: "You do not have permission to do that." };
const NOT_FOUND = { ok: false as const, code: "not_found" as const, error: "This person is not a member of this clinic." };

type ScreenActor = Pick<ClinicActor, "tenantId" | "organizationId" | "userId" | "role" | "can" | "actor" | "repo">;

/** The clinic's members (ClinForms membership), by name. Members with a role the clinic system does not know are left out. */
export async function listClinicMembers(actor: Pick<ClinicActor, "organizationId">): Promise<ClinicMember[]> {
  const rows = await getDb()
    .selectFrom("member")
    .innerJoin("user", "user.id", "member.userId")
    .select(["member.id as memberId", "member.userId as userId", "member.role as role", "user.name as name", "user.email as email", "user.twoFactorEnabled as twoFactorEnabled"])
    .where("member.organizationId", "=", actor.organizationId)
    .orderBy("user.name")
    .limit(500)
    .execute();
  const out: ClinicMember[] = [];
  for (const r of rows) {
    const role = parseMemberRole(r.role);
    if (!role || !isPmsRole(role)) continue;
    out.push({ memberId: r.memberId, userId: r.userId, name: r.name || r.email, email: r.email, role, twoStep: r.twoFactorEnabled === true || r.twoFactorEnabled === 1 || (r.twoFactorEnabled as unknown) === "1" });
  }
  return out;
}

/** Names for the history ("System" for rows written by a script). */
export function nameResolver(members: readonly ClinicMember[]): (userId: string | null) => string {
  const byId = new Map(members.map((m) => [m.userId, m.name]));
  return (userId) => (userId ? (byId.get(userId) ?? "A former member") : "System");
}

/* ------------------------------------------------------------------------------------------------
 * Roles and permissions
 * ----------------------------------------------------------------------------------------------*/

export interface RolesScreen {
  overrides: RoleOverride[];
  /** People per role (active members of the clinic). */
  counts: Record<PmsRole, number>;
  history: { at: string; who: string; items: AccessChangeItem[] }[];
}

export async function loadRolesScreen(actor: ScreenActor): Promise<ScreenResult<RolesScreen>> {
  if (!actor.can("settings.members")) return FORBIDDEN;
  const ctx = actor.repo();
  const [overrides, members, changes] = await Promise.all([listRoleOverrides(ctx, actor.tenantId), listClinicMembers(actor), listAccessChanges(ctx, actor.tenantId, { kind: "role", limit: 50 })]);
  const counts: Record<PmsRole, number> = { owner: 0, admin: 0, clinician: 0, staff: 0 };
  for (const m of members) counts[m.role] += 1;
  const nameOf = nameResolver(members);
  return { ok: true, value: { overrides, counts, history: changes.map((c) => ({ at: c.at, who: nameOf(c.byUserId), items: c.items })) } };
}

export async function saveRolesFor(actor: ScreenActor, changes: RolePermissionChange[]): Promise<ScreenResult<{ changed: number }>> {
  if (!actor.can("settings.members")) return FORBIDDEN;
  try {
    const r = await saveRolePermissions(actor.repo(), actor.tenantId, changes, actor.actor);
    if (!r.ok) return lockedOrConflict(r);
    return { ok: true, value: { changed: r.changed } };
  } catch (err) {
    if (err instanceof RepoInputError) return { ok: false, code: "invalid", error: "Some of the changes could not be read. Reload the page and try again." };
    throw err;
  }
}

/** Every change (role grid and member access), for Export log. */
export async function accessHistoryFor(actor: ScreenActor): Promise<ScreenResult<{ changes: AccessChange[]; members: ClinicMember[] }>> {
  if (!actor.can("settings.members")) return FORBIDDEN;
  const [changes, members] = await Promise.all([listAccessChanges(actor.repo(), actor.tenantId, { limit: 500 }), listClinicMembers(actor)]);
  return { ok: true, value: { changes, members } };
}

function lockedOrConflict(r: Exclude<AccessSaveResult, { ok: true }>): ScreenResult<never> {
  if (r.reason === "locked") return { ok: false, code: "locked", error: "That permission is locked and cannot be changed. Nothing was saved." };
  return { ok: false, code: "conflict", error: "Someone else changed this person's access while you were editing. Reload the page to see their changes, then make yours again." };
}

/* ------------------------------------------------------------------------------------------------
 * Staff access
 * ----------------------------------------------------------------------------------------------*/

export interface StaffRow extends ClinicMember {
  access: MemberAccess | null;
  /** Names of the sites they can see; null = every site. */
  sites: string[] | null;
}

export async function loadStaffList(actor: ScreenActor): Promise<ScreenResult<{ members: StaffRow[]; sites: Site[] }>> {
  if (!actor.can("settings.members")) return FORBIDDEN;
  const ctx = actor.repo();
  const [members, sites] = await Promise.all([listClinicMembers(actor), listSites(ctx, actor.tenantId)]);
  const access = await listMemberAccess(ctx, actor.tenantId, members.map((m) => m.userId));
  const byUser = new Map(access.map((a) => [a.userId, a]));
  const siteName = new Map(sites.map((s) => [s.id, s.name]));
  return {
    ok: true,
    value: {
      sites,
      members: members.map((m) => {
        const a = byUser.get(m.userId) ?? null;
        const scope = visibleSiteIds(m.role, a);
        return { ...m, access: a, sites: scope === null ? null : Array.from(scope).map((id) => siteName.get(id) ?? "").filter(Boolean) };
      }),
    },
  };
}

export interface MemberScreen {
  member: ClinicMember;
  access: MemberAccess;
  overrides: RoleOverride[];
  sites: Site[];
  registrationNumber: string | null;
  professionTitle: string | null;
  /** Signing details on the member's practitioner record (null: no record yet – saving creates one). */
  signing: SigningView;
  /** Owners and administrators (settings.members) change signing details – never for reception, who never sign. */
  canEditSigning: boolean;
  lastChange: { at: string; who: string; items: AccessChangeItem[] } | null;
  /** Why the form is read-only, or null when it can be changed. */
  readOnly: string | null;
  /** The roles this manager may switch the member to (never "owner": ownership is transferred elsewhere). */
  assignable: PmsRole[];
}

export async function loadMemberScreen(actor: ScreenActor, userId: string): Promise<ScreenResult<MemberScreen>> {
  if (!actor.can("settings.members")) return FORBIDDEN;
  const members = await listClinicMembers(actor);
  const member = members.find((m) => m.userId === userId);
  if (!member) return NOT_FOUND;
  const ctx = actor.repo();
  const [access, overrides, sites, practitioner, changes] = await Promise.all([
    getMemberAccess(ctx, actor.tenantId, member.userId),
    listRoleOverrides(ctx, actor.tenantId),
    listSites(ctx, actor.tenantId),
    findPractitionerByUser(ctx, actor.tenantId, member.userId),
    listAccessChanges(ctx, actor.tenantId, { kind: "member", subjectUserId: member.userId, limit: 1 }),
  ]);
  const nameOf = nameResolver(members);
  return {
    ok: true,
    value: {
      member,
      access,
      overrides,
      sites,
      registrationNumber: practitioner?.registrationNumber ?? null,
      professionTitle: practitioner ? professionTitle(practitioner.profession) : null,
      signing: signingView(practitioner),
      canEditSigning: member.role !== "staff",
      lastChange: changes[0] ? { at: changes[0].at, who: nameOf(changes[0].byUserId), items: changes[0].items } : null,
      readOnly: readOnlyReason(actor, member),
      assignable: actor.role === "owner" || actor.role === "admin" ? (["admin", "clinician", "staff"] as PmsRole[]) : [],
    },
  };
}

function professionTitle(profession: string): string {
  const t = profession.replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function readOnlyReason(actor: Pick<ScreenActor, "userId" | "role">, member: ClinicMember): string | null {
  if (member.role === "owner") return "The owner always has full access at every site. Ownership is transferred in ClinForms settings.";
  if (member.userId === actor.userId) return "You cannot change your own access. Ask another administrator or the owner.";
  return null;
}

/** Saves a member's access; `roleChange` is a role change the action already made through Better Auth. */
export async function saveMemberAccessFor(
  actor: ScreenActor,
  userId: string,
  input: MemberAccessInput,
  expectedRev: number,
  roleChange: { from: PmsRole; to: PmsRole } | null = null,
): Promise<ScreenResult<{ rev: number; changed: number }>> {
  if (!actor.can("settings.members")) return FORBIDDEN;
  const member = (await listClinicMembers(actor)).find((m) => m.userId === userId);
  if (!member) return NOT_FOUND;
  if (readOnlyReason(actor, member)) return FORBIDDEN;
  try {
    const r = await saveMemberAccess(actor.repo(), actor.tenantId, member.userId, member.role, input, expectedRev, actor.actor, roleChange ? [{ type: "role", from: roleChange.from, to: roleChange.to }] : []);
    if (!r.ok) return lockedOrConflict(r);
    return { ok: true, value: { rev: r.rev, changed: r.changed } };
  } catch (err) {
    if (err instanceof RepoInputError) {
      const sites = /site/i.test(err.message);
      return { ok: false, code: "invalid", error: sites ? "Choose at least one site they can see, or switch on “Can see all sites”." : "Some details need checking.", ...(sites ? { fieldErrors: { sites: "Choose at least one site." } } : {}) };
    }
    throw err;
  }
}

/** Whether this manager may change the member's role to `to` (checked before the action calls Better Auth). */
export async function roleChangeAllowed(actor: ScreenActor, userId: string, to: PmsRole): Promise<ScreenResult<ClinicMember>> {
  if (!actor.can("settings.members")) return FORBIDDEN;
  const member = (await listClinicMembers(actor)).find((m) => m.userId === userId);
  if (!member) return NOT_FOUND;
  if (readOnlyReason(actor, member) || to === "owner") return FORBIDDEN;
  if (!(actor.role === "owner" || actor.role === "admin")) return FORBIDDEN;
  return { ok: true, value: member };
}

export async function setMemberActiveFor(actor: ScreenActor, userId: string, active: boolean): Promise<ScreenResult<{ changed: boolean }>> {
  if (!actor.can("settings.members")) return FORBIDDEN;
  const member = (await listClinicMembers(actor)).find((m) => m.userId === userId);
  if (!member) return NOT_FOUND;
  if (readOnlyReason(actor, member)) return FORBIDDEN;
  return { ok: true, value: await setMemberActive(actor.repo(), actor.tenantId, member.userId, member.role, active, actor.actor) };
}

/* ------------------------------------------------------------------------------------------------
 * Signing details (Member access → "Signing details"; My account shows the member's own, read only)
 * ----------------------------------------------------------------------------------------------*/

export interface SigningView {
  /** The member has a practitioner record. */
  linked: boolean;
  registrationBody: RegistrationBody;
  registrationNumber: string | null;
  maySign: boolean;
  /** "Physiotherapist" (the record's profession), or null without a record. */
  title: string | null;
}

function signingView(p: { registrationBody: string | null; registrationNumber: string | null; maySign: boolean; profession: string } | null): SigningView {
  return {
    linked: p !== null,
    registrationBody: p && isRegistrationBody(p.registrationBody) ? p.registrationBody : "HCPC",
    registrationNumber: p?.registrationNumber ?? null,
    maySign: p ? p.maySign : false,
    title: p ? professionTitle(p.profession) : null,
  };
}

/**
 * A demo clinic accepts the made-up PH-DEMO-NN numbers: main's clinic plan flag (set by ClinForms platform staff)
 * or the clinic system's own demo flag (set by `pms:seed-demo`). Read on the server, never from the form.
 */
async function demoClinicOf(actor: Pick<ScreenActor, "tenantId" | "repo">): Promise<boolean> {
  const ctx = actor.repo();
  const [plan, settings] = await Promise.all([isDemoClinic(ctx.db, actor.tenantId), getPmsSettings(ctx, actor.tenantId).catch(() => null)]);
  return plan || settings?.isDemo === true;
}

/**
 * Saves a member's signing details (settings.members): register, registration number (HCPC: PH + digits; PH-DEMO-NN
 * in a demo clinic only) and "may sign" – on their practitioner record, created when they have none. Audited
 * ("pms.practitioner.signing_update", field names only). Reception never signs, so their details cannot be set.
 */
export async function saveSigningDetailsFor(actor: ScreenActor, userId: string, input: SigningInput): Promise<ScreenResult<SigningView>> {
  if (!actor.can("settings.members")) return FORBIDDEN;
  const member = (await listClinicMembers(actor)).find((m) => m.userId === userId);
  if (!member) return NOT_FOUND;
  if (member.role === "staff") return { ok: false, code: "invalid", error: "Reception never signs clinical notes. Change their role to Clinician first." };
  const checked = checkSigning(
    { registrationBody: String(input.registrationBody ?? ""), registrationNumber: String(input.registrationNumber ?? ""), maySign: input.maySign === true },
    { demoClinic: await demoClinicOf(actor) },
  );
  if (!checked.ok) return { ok: false, code: "invalid", error: "Check the signing details.", fieldErrors: checked.fieldErrors as Record<string, string> };
  try {
    const r = await setPractitionerSigning(actor.repo(), actor.tenantId, { userId: member.userId, name: member.name, email: member.email }, checked.value, actor.actor);
    return { ok: true, value: signingView(r.practitioner) };
  } catch (err) {
    if (err instanceof RepoInputError) return { ok: false, code: "invalid", error: err.message };
    throw err;
  }
}

/** My account: the member's own signing details, read only (any member of the clinic). */
export async function loadMySigning(actor: Pick<ScreenActor, "tenantId" | "userId" | "repo">): Promise<SigningView> {
  return signingView(await findPractitionerByUser(actor.repo(), actor.tenantId, actor.userId));
}
