/**
 * Support: a member's signing details (HCPC registration number, "may sign") set by ClinForms for a clinic
 * (16/11/2026 – a trial clinic whose clinicians could not approve until its owner entered each number).
 *
 * The same rules as the clinic's own Members page (src/app/app/(clinic)/settings/members/actions.ts saveMemberProfile):
 * - a registration number in the HCPC format only; a made-up PH-DEMO number only in a demo clinic (the clinic's plan);
 * - "may sign" needs a number, and never for a staff member;
 * - the member's job title is kept.
 * The member is named by their exact name as the clinic shows it; no match or more than one is refused. PREVIEW unless
 * `confirm`. Audited "member.profile_update" by ClinForms (PLATFORM_USER_ID, via support) – flags only, never the number.
 */
import type { Kysely } from "kysely";
import { isDemoHcpc } from "../../modules/medreport/core/demo-clinic";
import { signingNumberFor } from "../../lib/hcpc";
import { PLATFORM_USER_ID } from "../auth/create-auth";
import type { Database } from "../db/schema";
import { appendAudit } from "../repos/audit";
import { RepoInputError, type DbContext } from "../repos/context";
import { getMemberProfile, upsertMemberProfile } from "../repos/member-profile";
import { isDemoClinic } from "./clinic-plan";

export interface SetMemberSigningInput {
  tenantId: string;
  /** The member's name exactly as the clinic's Members page shows it (case and surrounding spaces aside). */
  memberName: string;
  hcpcNumber: string;
  maySign: boolean;
  confirm?: boolean;
}

export interface SetMemberSigningResult {
  tenantId: string;
  dryRun: boolean;
  member: string;
  role: string;
  /** What the member's details were / will be – flags only. */
  before: { hasHcpc: boolean; maySign: boolean };
  after: { hasHcpc: boolean; maySign: boolean };
  changed: boolean;
}

async function openClinic(db: Kysely<Database>, tenantId: string): Promise<{ id: string }> {
  const org = await db.selectFrom("organization").select(["id", "metadata"]).where("slug", "=", tenantId).executeTakeFirst();
  if (!org) throw new RepoInputError(`No clinic with the id "${tenantId}".`);
  if (org.metadata && /"offboardedAt"/.test(org.metadata)) throw new RepoInputError(`The clinic "${tenantId}" is closed.`);
  return { id: org.id };
}

export async function setMemberSigning(ctx: DbContext, input: SetMemberSigningInput): Promise<SetMemberSigningResult> {
  const tenantId = String(input.tenantId ?? "").trim();
  const org = await openClinic(ctx.db, tenantId);
  const wanted = String(input.memberName ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!wanted) throw new RepoInputError("Name the member (--member).");
  const members = await ctx.db
    .selectFrom("member")
    .innerJoin("user", "user.id", "member.userId")
    .select(["member.id as id", "member.userId as userId", "member.role as role", "user.name as name"])
    .where("member.organizationId", "=", org.id)
    .execute();
  const matches = members.filter((m) => m.name.replace(/\s+/g, " ").trim().toLowerCase() === wanted);
  if (matches.length === 0) throw new RepoInputError(`No member of "${tenantId}" has that name.`);
  if (matches.length > 1) throw new RepoInputError(`${matches.length} members of "${tenantId}" have that name – nothing changed.`);
  const member = matches[0];

  const demoClinic = await isDemoClinic(ctx.db, tenantId);
  const hcpcNumber = signingNumberFor(String(input.hcpcNumber ?? ""), { demoClinic });
  if (!hcpcNumber) throw new RepoInputError("That is not an HCPC registration number (two or three letters and 4–6 digits, e.g. PH123456).");
  if (input.maySign && member.role === "staff") throw new RepoInputError("A staff member cannot sign forms: change their role to clinician first.");

  const current = await getMemberProfile(ctx, org.id, member.userId);
  const before = { hasHcpc: Boolean(current?.hcpcNumber), maySign: current?.canSign === true };
  const after = { hasHcpc: true, maySign: input.maySign === true };
  const changed = current?.hcpcNumber !== hcpcNumber || before.maySign !== after.maySign;
  const result: SetMemberSigningResult = { tenantId, dryRun: !input.confirm, member: member.name, role: member.role, before, after, changed };
  if (!input.confirm || !changed) return result;

  await upsertMemberProfile(ctx, org.id, member.userId, { jobTitle: current?.jobTitle ?? null, hcpcNumber, canSign: after.maySign });
  await appendAudit(ctx, tenantId, {
    userId: PLATFORM_USER_ID,
    action: "member.profile_update",
    targetType: "member",
    targetId: member.id,
    detail: { via: "support", canSign: after.maySign, hasHcpc: true, hasJobTitle: Boolean(current?.jobTitle), ...(isDemoHcpc(hcpcNumber) ? { demoNumber: true } : {}) },
  });
  return result;
}
