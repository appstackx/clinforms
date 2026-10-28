import type { Metadata } from "next";
import Link from "next/link";
import { FileText } from "lucide-react";
import { NoteRow } from "@/components/pms/records/note-row";
import { whenLabel } from "@/components/pms/records/format";
import { Card, ComingSoon } from "@/components/pms/records/ui";
import { StatusPill } from "@/components/pms/ui";
import { formatUkDate } from "@/modules/pms/core/text";
import { PAYER_TYPE_LABELS } from "@/modules/pms/records/copy";
import { requireClinicActor } from "@/server/pms/actor";
import { getCaseDetails } from "@/server/pms/records/cases-service";
import { loadRecordHeader } from "@/server/pms/records/record-header";
import { patientPath } from "@/server/pms/records/record";
import { getReferrer } from "@/server/repos/pms/referrers";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Patient record", robots: { index: false, follow: false } };

const linkClass = "text-sm font-medium text-primary-strong hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary rounded";

/**
 * The record's Overview tab (design round 2): open case with its authorised sessions and "Complete referrer form",
 * upcoming appointments, latest notes (clinicians, owners, administrators only), account and forms.
 *
 * TODO(billing): the Account card (patient and insurer balance, saved card) – billing module.
 * TODO(portal): the Forms card (intake and consent forms) – portal module.
 * TODO(integration): "Complete referrer form" opens the ClinForms flow pre-filled from the case once the native
 *   connector (feat/cs-integration) is merged; until then it goes to the case's "Referrer and insurer forms" panel.
 */
export default async function PatientOverviewPage({ params }: { params: { patientId: string } }) {
  const actor = await requireClinicActor({ permission: "patients.view" });
  const h = await loadRecordHeader(actor, params.patientId);
  const p = h.patient;
  const open = h.cases.find((c) => c.status === "open") ?? null;
  const details = open ? await getCaseDetails(actor, p.id, open.id) : null;
  const auth = details && details.ok ? (details.value.authorisations.find((a) => a.view.state === "active") ?? details.value.authorisations[0] ?? null) : null;
  const payer = open?.payerReferrerId ? await getReferrer(actor.repo(), actor.tenantId, open.payerReferrerId) : null;
  const upcoming = h.appointments ? [...h.appointments.past.filter((r) => r.startsOn === h.today && r.status !== "cancelled").reverse(), ...h.appointments.upcoming.filter((r) => r.status !== "cancelled")].slice(0, 3) : null;
  const latest = h.notes ? h.notes.slice(0, 2) : null;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-4">
        <Card title="Open case" action={<Link href={patientPath(p.id, "cases")} className={linkClass}>All cases</Link>}>
          {open ? (
            <>
              <div className="flex flex-col gap-0.5">
                <strong className="text-[15px] font-semibold">{open.title}</strong>
                <span className="text-sm text-[#334155]">
                  {["Opened " + formatUkDate(open.openedOn), payer?.name ?? (open.payerType !== "self_pay" ? PAYER_TYPE_LABELS[open.payerType] : "Self-pay"), auth ? `Auth ${auth.code}` : null].filter(Boolean).join(" · ")}
                </span>
              </div>
              {auth && auth.sessionsAuthorised !== null ? (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span>Authorised sessions</span>
                    <strong className="font-semibold tabular-nums">
                      {auth.sessionsUsed} used of {auth.sessionsAuthorised} · {auth.view.sessionsLeft ?? 0} left
                    </strong>
                  </div>
                  <div role="progressbar" aria-label="Authorised sessions used" aria-valuemin={0} aria-valuemax={auth.sessionsAuthorised} aria-valuenow={auth.sessionsUsed} className="h-2 overflow-hidden rounded-full bg-[#E2E8F0]">
                    <div className="h-full rounded-full bg-primary-strong" style={{ width: `${Math.min(100, Math.round((auth.sessionsUsed / Math.max(1, auth.sessionsAuthorised)) * 100))}%` }} />
                  </div>
                </div>
              ) : null}
              <div>
                <Link
                  href={patientPath(p.id, `cases/${open.id}#referrer-forms`)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-[#1842B4] bg-white px-3.5 text-sm font-medium text-[#1842B4] hover:bg-[#EFF4FF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  <FileText className="h-4 w-4" aria-hidden />
                  Complete referrer form
                </Link>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No open case. Open one from the Cases tab when the patient starts a new course of treatment.</p>
          )}
        </Card>
        {upcoming ? (
          <Card title="Upcoming appointments">
            {upcoming.length ? (
              <ul className="flex flex-col">
                {upcoming.map((u) => (
                  <li key={u.id} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 border-t border-border py-2.5 text-sm first:border-t-0">
                    <span className="font-medium tabular-nums">{whenLabel(u.startsAt, h.today)}</span>
                    <span className="truncate text-[#334155]">{u.serviceName ?? "Appointment"}</span>
                    <StatusPill kind="appointment" status={u.status} size="sm" />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Nothing booked.</p>
            )}
          </Card>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        {latest ? (
          <Card title="Latest notes" action={<Link href={patientPath(p.id, "notes")} className={linkClass}>All notes</Link>}>
            {latest.length ? (
              <div className="flex flex-col gap-2">
                {latest.map((n) => (
                  <NoteRow key={n.id} note={n} href={patientPath(p.id, `notes/${n.id}`)} today={h.today} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No notes yet.</p>
            )}
          </Card>
        ) : null}
        <Card title="Account">
          {/* TODO(billing): patient balance, insurer balance and saved card from the billing module. */}
          <ComingSoon title="Coming with billing">The patient&apos;s and the insurer&apos;s balance will show here.</ComingSoon>
        </Card>
        <Card title="Forms">
          {/* TODO(portal): intake and consent forms from the portal module. */}
          <ComingSoon title="Coming with the patient portal">Intake and consent forms the patient has signed will show here.</ComingSoon>
        </Card>
      </div>
    </div>
  );
}
