import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, Panel } from "@/components/account/shell";
import { ROLE_DESCRIPTIONS, roleLabel } from "@/lib/account-copy";
import { countMembers, listPendingInvitations } from "@/server/auth/membership";
import { isManager } from "@/server/auth/roles";
import { requireAppContext } from "@/server/auth/session";
import { getDb } from "@/server/db";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Overview" };

export default async function ClinicOverviewPage() {
  const { session, membership } = await requireAppContext();
  const db = getDb();
  const [members, invitations] = await Promise.all([countMembers(db, membership.organizationId), listPendingInvitations(db, membership.organizationId)]);
  const manager = isManager(membership.role);
  const links = [
    { href: "/app/settings/clinic", label: "Clinic details", text: manager ? "Name, address and how long reports are kept." : "Your clinic's details." },
    { href: "/app/settings/members", label: "Members", text: manager ? "Invite people, set roles and signing details." : "Who is in your clinic." },
    { href: "/app/settings/security", label: "Security", text: "Backup codes and where you are signed in." },
    ...(manager ? [{ href: "/app/settings/api-keys", label: "API keys", text: "Keys for connecting your practice-management system." }] : []),
  ];
  return (
    <>
      <PageHeader title={membership.clinicName} description={`Signed in as ${session.user.name} (${session.user.email}).`} />
      <div className="grid gap-4 md:grid-cols-3">
        <Panel>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Your role</p>
          <p className="mt-1 text-lg font-semibold">{roleLabel(membership.role)}</p>
          <p className="mt-1 text-sm text-slate-600">{ROLE_DESCRIPTIONS[membership.role]}</p>
        </Panel>
        <Panel>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Members</p>
          <p className="mt-1 text-lg font-semibold">{members}</p>
          <p className="mt-1 text-sm text-slate-600">
            {invitations.length === 0 ? "No open invitations." : `${invitations.length} open invitation${invitations.length === 1 ? "" : "s"}.`}
          </p>
        </Panel>
        <Panel>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Two-step verification</p>
          <p className="mt-1 text-lg font-semibold">On</p>
          <p className="mt-1 text-sm text-slate-600">Required for every member of the clinic.</p>
        </Panel>
      </div>

      <Panel title="Settings" className="mt-6">
        <ul className="grid gap-3 sm:grid-cols-2">
          {links.map((l) => (
            <li key={l.href}>
              <Link href={l.href} className="block rounded-xl border border-slate-200 p-4 hover:border-teal-300 hover:bg-teal-50/40">
                <span className="font-medium text-slate-900">{l.label}</span>
                <span className="mt-1 block text-sm text-slate-600">{l.text}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Completing forms" className="mt-6">
        <p className="text-sm text-slate-700">
          Completing referrer forms for your clinic&apos;s own patients is not switched on in this account yet. Until it is, you can try the
          whole workflow in the demo studio, which uses fictional patients and keeps its work in your browser only.
        </p>
        <Link
          href="/reports"
          className="mt-4 inline-flex h-10 items-center rounded-lg bg-teal-600 px-4 text-sm font-semibold text-white hover:bg-teal-700"
        >
          Open the demo studio
        </Link>
      </Panel>
    </>
  );
}
