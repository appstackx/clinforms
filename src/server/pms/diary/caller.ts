/**
 * Who is asking the diary for something, as the diary's server code needs it: the clinic (tenant), the audit
 * actor, the role's permissions, the repositories' context and the SITE SCOPE – the sites the member may see and
 * book at. Server actions and route handlers build it from the checked actor (`diaryCallerOf`); tests build it
 * directly. Every function in src/server/pms/diary checks `can(…)` and the scope again itself, so a wrong
 * permission in an action file cannot widen what a role may do.
 *
 * Site scope (K2-SITE-004): the foundation's shared read (src/server/pms/access.ts) – the sites the member works at
 * ∪ the sites they can see; every site by default, with "can see all sites", and always for the owner. The actor
 * carries it (`actor.siteIds`); the diary applies it to every read and write (proved by the service suite).
 */
import "server-only";
import type { PmsPermission } from "../../../modules/pms/core/permissions";
import type { PmsActor } from "../../../modules/pms/core/types";
import type { RepoContext } from "../../repos/context";
import type { ClinicActor } from "../actor";

export interface DiaryCaller {
  tenantId: string;
  actor: PmsActor;
  can: (permission: PmsPermission) => boolean;
  ctx: RepoContext;
  /** The sites the member may see and book at; null = every site of the clinic. */
  siteIds: ReadonlySet<string> | null;
  /** The member's name and email (a clinical note's author, when the diary starts one). Absent in some tests. */
  member?: { name: string; email: string };
}

/** The member's site limit (null = every site). See the note at the top of this file. */
export async function resolveDiarySiteScope(actor: Pick<ClinicActor, "siteIds">): Promise<ReadonlySet<string> | null> {
  return actor.siteIds;
}

export async function diaryCallerOf(actor: ClinicActor): Promise<DiaryCaller> {
  return { tenantId: actor.tenantId, actor: actor.actor, can: actor.can, ctx: actor.repo(), siteIds: await resolveDiarySiteScope(actor), member: { name: actor.name, email: actor.email } };
}

/** Whether the caller may see / book at a site. */
export function inScope(caller: DiaryCaller, siteId: string | null | undefined): boolean {
  if (caller.siteIds === null) return true;
  return typeof siteId === "string" && caller.siteIds.has(siteId);
}

/** The scope as a list for the repositories' `siteIds` filters (undefined = no filter). */
export function scopeList(caller: DiaryCaller): string[] | undefined {
  return caller.siteIds === null ? undefined : Array.from(caller.siteIds);
}
