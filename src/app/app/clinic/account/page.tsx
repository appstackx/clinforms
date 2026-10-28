import type { Metadata } from "next";
import Link from "next/link";
import { SigningDetailsReadOnly } from "@/components/pms/access/signing-details";
import { PMS_ROLE_LABELS, isPmsRole } from "@/modules/pms/core/permissions";
import { requireClinicActor } from "@/server/pms/actor";
import { loadMySigning } from "@/server/pms/access-screens";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My account" };

/**
 * My account (the user menu's "My account and security"): who the member is in this clinic and their own signing
 * details – read only; owners and administrators change them on Member access (Set-up → Staff access → the member).
 * Password and two-step verification stay on ClinForms' own security page, linked from here. Every member.
 */
export default async function MyAccountPage() {
  const actor = await requireClinicActor();
  const signing = await loadMySigning(actor);
  const role = isPmsRole(actor.role) ? PMS_ROLE_LABELS[actor.role] : actor.role;
  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">My account</h1>
      <section aria-labelledby="me-h" className="flex flex-col gap-2 rounded-2xl border border-border bg-white px-5 py-4 text-sm">
        <h2 id="me-h" className="m-0 text-base font-semibold">
          {actor.name || actor.email}
        </h2>
        <p className="m-0 text-[#334155]">
          {actor.email} · Role: {role}
        </p>
        <p className="m-0">
          <Link href="/app/settings/security" className="font-medium text-primary-strong underline underline-offset-2">
            Password and two-step verification
          </Link>
        </p>
      </section>
      <section aria-labelledby="my-sign-h" className="flex flex-col gap-3 rounded-2xl border border-border bg-white px-5 py-4 text-sm">
        <h2 id="my-sign-h" className="m-0 text-base font-semibold">
          My signing details
        </h2>
        {actor.role === "staff" ? (
          <p className="m-0 text-[#475569]">Reception does not sign clinical notes.</p>
        ) : (
          <>
            <SigningDetailsReadOnly name={actor.name || actor.email} value={signing} />
            <p className="m-0 text-xs text-[#475569]">Only the clinic owner or an administrator can change these (Set-up → Staff access → your name).</p>
          </>
        )}
      </section>
    </div>
  );
}
