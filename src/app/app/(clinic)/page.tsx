import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, Panel } from "@/components/account/shell";
import { ROLE_DESCRIPTIONS, roleLabel } from "@/lib/account-copy";
import { loadSetupChecklist } from "@/server/admin/setup-checklist";
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
  const setup = await loadSetupChecklist(db, membership, { members, openInvitations: invitations.length });
  // Fix wave 2: a new clinic's first steps, for the owner and administrators (who can do them).
  const steps = [
    { done: setup.clinicDetails, href: "/app/settings/clinic", label: "Clinic details", text: "Name, address and postcode – they appear on completed forms." },
    {
      done: setup.draftingEnabled,
      href: "/app/settings/clinic",
      label: "Drafting from the notes",
      text: setup.draftingEnabled ? "Switched on." : "Switched off: answers from the notes are left for the clinician. Switch it on in Clinic details.",
    },
    { done: setup.team, href: "/app/settings/members", label: "Invite your clinicians", text: "Each member signs in with two-step verification." },
    { done: setup.signer, href: "/app/settings/members", label: "Signing details", text: "An HCPC number and “may sign” for each clinician who approves forms." },
    { done: setup.confirmedForm, href: "/app/studio/forms", label: "Your first referrer form", text: "Upload a referrer's blank form and confirm its mapping once." },
  ];
  const stepsLeft = steps.filter((s) => !s.done).length;
  const links = [
    { href: "/app/settings/clinic", label: "Clinic details", text: manager ? "Name, address and how long reports are kept." : "Your clinic's details." },
    { href: "/app/settings/members", label: "Members", text: manager ? "Invite people, set roles and signing details." : "Who is in your clinic." },
    { href: "/app/settings/security", label: "Security", text: "Backup codes and where you are signed in." },
    ...(manager ? [{ href: "/app/settings/api-keys", label: "API keys", text: "Keys for connecting your practice-management system." }] : []),
    {
      href: "/app/settings/activity",
      label: "Activity",
      text: manager ? "Who did what in the clinic, newest first." : "What you have done in the clinic, newest first.",
    },
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

      {manager && stepsLeft > 0 ? (
        <Panel title="Set up your clinic" className="mt-6">
          <p className="text-sm text-slate-600">
            {stepsLeft} of {steps.length} steps left before your first form.
          </p>
          <ol className="mt-3 space-y-2">
            {steps.map((step) => (
              <li key={step.label} className="flex items-start gap-3">
                <span
                  aria-hidden
                  className={
                    step.done
                      ? "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-teal-600 text-xs font-bold text-white"
                      : "mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 border-slate-300"
                  }
                >
                  {step.done ? "✓" : ""}
                </span>
                <span className="min-w-0 text-sm">
                  <Link href={step.href} className="font-medium text-slate-900 underline-offset-4 hover:text-teal-800 hover:underline">
                    {step.label}
                  </Link>
                  <span className="sr-only">{step.done ? " – done" : " – to do"}</span>
                  <span className="block text-slate-600">{step.text}</span>
                </span>
              </li>
            ))}
          </ol>
        </Panel>
      ) : null}

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
          The Studio is where your clinic completes referrers&apos; own forms: upload the patient&apos;s notes, choose the referrer&apos;s
          form, and the treating clinician reviews and approves every answer before the form is issued.
        </p>
        {setup.draftingEnabled ? null : (
          <p className="mt-2 text-sm text-amber-800">
            Drafting from the notes is switched off for your clinic, so answers from the notes are left for the clinician to write.
            {manager ? " You can switch it on in Clinic details." : " Your clinic's owner or an administrator can switch it on."}
          </p>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Link
            href="/app/studio"
            className="inline-flex h-10 items-center rounded-lg bg-teal-700 px-4 text-sm font-semibold text-white hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2"
          >
            Open the Studio
          </Link>
          <Link href="/reports" className="text-sm font-medium text-teal-700 underline-offset-4 hover:underline">
            Try the demo with fictional patients
          </Link>
        </div>
      </Panel>
    </>
  );
}
