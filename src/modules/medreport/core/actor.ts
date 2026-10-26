/**
 * Who does something to a report (W0.6 shared types, bh2): the person behind every review action (ui/components/review
 * use-review-state.ts ReviewAction.actor), and – once WC stamps it – the `by` on paragraphs, answers, decisions and
 * acknowledgements.
 *
 *   Actor {memberId, name, role, canSign, hcpc?}   the plan's shape (W0.3 stores it as core/schemas.ts ActorSchema)
 *   memberActor(member, fallbackName)            the signed-in member of a clinic's Studio
 *   demoActor(name, hcpc?)                       the public demo's one fictional user
 *   namedActor(name, role?, opts?)               code and tests that know a name only
 *   isStaffActor(actor) / isApproverActor(actor, approver)
 *   SYSTEM_ACTOR_NAME                            what the activity log says for code (drafting); code is never an Actor
 *
 * Not the server's caller (auth/actor.ts `Actor` says how a request authenticated); this is the person as the report
 * records them. The interface is the same shape as W0.3's ActorSchema (memberId and name non-empty, role one of the
 * member roles, canSign, optional hcpc), so either is assignable to the other; when both are on one branch the
 * integrator re-exports the inferred type from core/types.ts here. Pure; browser and server.
 *
 * Owner: W0 (shared; changes through the integrator) – docs/bh2-ownership.json.
 */

/** A clinic member's role (the same members as api/deps.ts MemberRole and W0.3's ActorRoleSchema). */
export type ActorRole = "owner" | "admin" | "clinician" | "staff";

export interface Actor {
  /** The clinic member's account id; "demo" for the public demo's one user; "unknown" when the Studio has no member id. */
  memberId: string;
  /** The name the activity log shows ("Sarah Reid"). */
  name: string;
  role: ActorRole;
  /** The member may approve (sign): a role other than staff, the clinic allows it, and signing details are on file. */
  canSign: boolean;
  /** The member's registration number from their profile, when they have one. */
  hcpc?: string;
}

/** The activity log's name for code acting on its own (the drafting step) – never an Actor, never stamped as `by`. */
export const SYSTEM_ACTOR_NAME = "System";

/** Member id used when the Studio knows no account id for the member (it always does once signed in). */
export const UNKNOWN_MEMBER_ID = "unknown";

/** The signed-in member of a clinic's Studio (ui/host-hooks.tsx StudioMember), or – without one – `fallbackName`. */
export function memberActor(
  member: { userId?: string; name: string; role?: ActorRole; canSign?: boolean; hcpc?: string } | null | undefined,
  fallbackName: string,
): Actor {
  // No member (a clinic's Studio always has one – it needs a sign-in): an actor who may not sign and – as the NEW-1
  // stop-gap treated it – is not staff.
  if (!member) return { memberId: UNKNOWN_MEMBER_ID, name: fallbackName, role: "clinician", canSign: false };
  const role = member.role ?? "clinician";
  const hcpc = member.hcpc?.trim() || undefined;
  return {
    memberId: member.userId?.trim() || UNKNOWN_MEMBER_ID,
    name: member.name,
    role,
    canSign: role !== "staff" && member.canSign !== false && Boolean(hcpc),
    ...(hcpc ? { hcpc } : {}),
  };
}

/** The public demo's one fictional user: a clinician who may approve (the demo signs as its fictional signer). */
export function demoActor(name: string, hcpc?: string | null): Actor {
  const number = hcpc?.trim();
  return { memberId: "demo", name, role: "clinician", canSign: true, ...(number ? { hcpc: number } : {}) };
}

/** An actor known by name only (code paths and tests). */
export function namedActor(name: string, role: ActorRole = "clinician", opts: { memberId?: string; canSign?: boolean; hcpc?: string } = {}): Actor {
  return {
    memberId: opts.memberId ?? UNKNOWN_MEMBER_ID,
    name,
    role,
    canSign: opts.canSign ?? (role !== "staff" && Boolean(opts.hcpc)),
    ...(opts.hcpc ? { hcpc: opts.hcpc } : {}),
  };
}

/** A staff member: prepares reports, never approves, never settles a clinician's decision (NEW-1). */
export function isStaffActor(actor: Pick<Actor, "role">): boolean {
  return actor.role === "staff";
}

/**
 * The report's approving clinician (W0.3 Report.approver {memberId, name, hcpc}; WC: decisions on clinician boxes are
 * theirs). Matched by member id only – never by name – and never for an unknown member.
 */
export function isApproverActor(actor: Pick<Actor, "memberId">, approver: { memberId: string } | null | undefined): boolean {
  return Boolean(approver && actor.memberId && actor.memberId !== UNKNOWN_MEMBER_ID && actor.memberId === approver.memberId);
}
