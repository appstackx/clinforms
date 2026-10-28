import Link from "next/link";
import { AlertTriangle, Ban, CalendarPlus, CreditCard, Pencil, Phone, Send, ShieldCheck } from "lucide-react";
import { MoreActionsMenu, RecordTabs, type MenuItem, type RecordTabLink } from "@/components/pms/records/record-menus";
import { NewNoteButton } from "@/components/pms/records/new-note-button";
import { personName, whenLabel } from "@/components/pms/records/format";
import { FlagPill, PmsAvatar, StatusPill, pmsButtonVariants } from "@/components/pms/ui";
import { cn } from "@/lib/utils";
import { CLINIC_BASE_PATH } from "@/modules/pms/core/modules";
import { formatUkDate } from "@/modules/pms/core/text";
import { ageOn } from "@/modules/pms/records/form-values";
import { titleLine } from "@/modules/pms/records/flags";
import { recordTabItems } from "@/modules/pms/records/record-tab-model";
import { PMS_RECORD_TABS } from "@/modules/pms/record-tabs";
import { requireClinicActor } from "@/server/pms/actor";
import { loadRecordHeader } from "@/server/pms/records/record-header";
import { PATIENTS_PATH, patientPath } from "@/server/pms/records/record";
import { newNote } from "../actions";

export const dynamic = "force-dynamic";

/** "Latex allergy; asthma" / one per line → separate pills. */
function alertsOf(text: string | null): string[] {
  return (text ?? "")
    .split(/\n|;/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 6);
}

const lowerFirst = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/**
 * A patient's record (design round 2, "Patient record – tabs by role"): breadcrumb, the summary card (name, title and
 * pronouns, date of birth and age, mobile, email, patient number, alert / clinical-flag / consent / marketing pills,
 * the next appointment, the actions) and the tabs in the design's order.
 *
 * By role: reception (staff) gets no clinical tab, no clinical flag and no "New note" – left out, not disabled. Each
 * tab's page checks its own permission again.
 *
 * Differences from the design: "Take payment" needs billing.edit (reception, owner, administrator – not the
 * clinician as drawn) and opens the Invoices tab until billing is merged; "Send message" opens the Messages tab until
 * comms is merged; "Book" opens the diary (TODO(diary): the booking dialog from feat/cs-diary).
 */
export default async function PatientRecordLayout({ children, params }: { children: React.ReactNode; params: { patientId: string } }) {
  const actor = await requireClinicActor({ permission: "patients.view" });
  const h = await loadRecordHeader(actor, params.patientId);
  const p = h.patient;
  const name = personName(p);
  const age = ageOn(p.dateOfBirth, h.today);
  const sub = titleLine(p.title, h.pronouns);
  const tabs: RecordTabLink[] = recordTabItems(PMS_RECORD_TABS, actor.can).map((t) => ({
    href: patientPath(p.id, t.segment),
    label: t.label,
    exact: t.segment === "",
    count:
      t.key === "appointments" && h.appointments
        ? Object.entries(h.appointments.counts).reduce((n, [s, c]) => (s === "cancelled" ? n : n + c), 0)
        : t.key === "cases"
          ? h.cases.length
          : t.key === "notes"
            ? (h.notes?.length ?? null)
            : t.key === "attachments"
              ? h.attachmentCount
              : null,
  }));
  const openCase = h.cases.find((c) => c.status === "open") ?? null;
  const canNote = actor.can("clinical.write") && !h.anonymised && p.status === "active";
  const canBook = actor.can("diary.book") && p.status === "active" && !h.anonymised;
  const canMessage = actor.can("messages.send");
  const canPay = actor.can("billing.edit");
  const reminders = p.reminderSms || p.reminderEmail;
  const marketing = p.marketingEmail || p.marketingSms;
  const bookHref = `${CLINIC_BASE_PATH}/diary?patient=${encodeURIComponent(p.id)}`;
  const nextAppt = h.next;
  const appointmentToday = nextAppt && nextAppt.startsOn === h.today ? nextAppt : null;
  const endTime = nextAppt?.timeLabel.includes("–") ? nextAppt.timeLabel.split("–")[1] : null;

  const menu: MenuItem[] = [
    { label: "Patient details", href: patientPath(p.id, "details") },
    ...(actor.can("patients.edit") && !h.anonymised ? [{ label: "Edit details", href: patientPath(p.id, "edit") }] : []),
    ...(actor.can("clinical.write") && !h.anonymised ? [{ label: "Clinical flags", href: patientPath(p.id, "details#clinical-flags") }] : []),
    ...(canMessage ? [{ label: "Send message", href: patientPath(p.id, "tab/messages"), phoneOnly: true }] : []),
    ...(canPay ? [{ label: "Take payment", href: patientPath(p.id, "tab/invoices"), phoneOnly: true }] : []),
    ...(actor.can("reports.export")
      ? [
          { label: "Subject access copy (PDF)", href: patientPath(p.id, "export?format=pdf"), download: true },
          { label: "Subject access data (JSON)", href: patientPath(p.id, "export?format=json"), download: true },
        ]
      : []),
  ];

  const action = (variant: "primary" | "secondary") => pmsButtonVariants({ variant });

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[1180px] flex-col gap-4">
      <nav aria-label="Breadcrumb" className="text-sm text-[#475569]">
        <Link href={PATIENTS_PATH} className="text-primary-strong underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
          Patients
        </Link>
        <span aria-hidden> / </span>
        <span>{name}</span>
      </nav>

      <section aria-label="Patient summary" className="flex flex-col gap-4 rounded-2xl border border-border bg-white p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <div className="flex min-w-0 flex-1 gap-4">
            <PmsAvatar name={name} size={40} className="h-12 w-12 text-base sm:h-14 sm:w-14 sm:text-lg" />
            <div className="flex min-w-0 flex-col gap-2">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h1 className="text-xl font-semibold text-foreground sm:text-2xl">{name}</h1>
                {sub ? <span className="text-sm text-[#475569]">{sub}</span> : null}
                {p.status !== "active" ? <FlagPill>{p.status === "archived" ? "Archived" : "Deceased"}</FlagPill> : null}
                {p.legalHold ? <FlagPill>On hold</FlagPill> : null}
                {h.anonymised ? <FlagPill>Anonymised</FlagPill> : null}
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-foreground">
                {p.dateOfBirth ? (
                  <span className="tabular-nums">
                    DOB {formatUkDate(p.dateOfBirth)}
                    {age !== null ? ` (${age})` : ""}
                  </span>
                ) : null}
                {p.phoneMobile ? <span className="tabular-nums">{p.phoneMobile}</span> : null}
                {p.email ? <span className="break-all">{p.email}</span> : null}
                <span className="tabular-nums">Patient no. {p.patientNumber}</span>
              </div>
              <ul className="flex flex-wrap gap-1.5" aria-label="Alerts and consent">
                {alertsOf(p.alerts).map((a) => (
                  <li key={`a-${a}`}>
                    <FlagPill variant="alert" icon={<AlertTriangle />} className="h-auto min-h-6 whitespace-normal py-0.5">
                      Alert: {lowerFirst(a)}
                    </FlagPill>
                  </li>
                ))}
                {(h.flags ?? []).map((f) => (
                  <li key={f.id}>
                    <FlagPill variant="alert" icon={<AlertTriangle />} className="h-auto min-h-6 whitespace-normal py-0.5">
                      Clinical: {lowerFirst(f.text ?? "")}
                    </FlagPill>
                  </li>
                ))}
                <li>
                  <span className="inline-flex min-h-6 items-center gap-[5px] rounded-[6px] bg-[#DCFCE7] py-0.5 pl-[7px] pr-[9px] text-xs font-medium text-[#166534]">
                    <ShieldCheck className="h-3 w-3" aria-hidden />
                    <span aria-hidden>
                      Consent: reminders {reminders ? "✓" : "✗"} · treatment {p.consentTreatment ? "✓" : "✗"}
                    </span>
                    <span className="sr-only">
                      Consent: reminders {reminders ? "yes" : "no"}, treatment {p.consentTreatment ? "recorded" : "not recorded"}
                    </span>
                  </span>
                </li>
                {!marketing ? (
                  <li>
                    <FlagPill icon={<Ban />}>No marketing</FlagPill>
                  </li>
                ) : null}
              </ul>
            </div>
          </div>
          {h.appointments ? (
            <div role="group" aria-label="Next appointment" className="flex flex-col gap-1 rounded-xl border border-border px-4 py-3.5 lg:min-w-[280px]">
              <span className="text-xs font-semibold uppercase tracking-[0.04em] text-[#475569]">Next appointment</span>
              {nextAppt ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-[15px] font-semibold tabular-nums">
                      {whenLabel(nextAppt.startsAt, h.today)}
                      {endTime ? `–${endTime}` : ""}
                    </strong>
                    <StatusPill kind="appointment" status={nextAppt.status} size="sm" />
                  </div>
                  <span className="text-sm text-[#334155]">{[nextAppt.serviceName, nextAppt.practitionerName, nextAppt.roomName].filter(Boolean).join(" · ")}</span>
                </>
              ) : (
                <span className="text-sm text-[#334155]">None booked</span>
              )}
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {p.phoneMobile ? (
            <a href={`tel:${p.phoneMobile.replace(/\s+/g, "")}`} className={cn(action("secondary"), "h-11 flex-1 md:hidden")}>
              <Phone aria-hidden />
              Call
            </a>
          ) : null}
          {canBook ? (
            // TODO(diary): open feat/cs-diary's booking dialog for this patient once the diary screens are merged.
            <Link href={bookHref} className={cn(action("primary"), "h-11 flex-1 md:h-9 md:flex-none")}>
              <CalendarPlus aria-hidden />
              Book
            </Link>
          ) : null}
          {canNote ? (
            <NewNoteButton action={newNote} patientId={p.id} caseId={openCase?.id ?? null} appointmentId={appointmentToday?.id ?? null} className={cn(action("secondary"), "h-11 flex-1 md:h-9 md:flex-none")}>
              <Pencil aria-hidden />
              <span className="md:hidden">Note</span>
              <span className="hidden md:inline">New note</span>
            </NewNoteButton>
          ) : null}
          {canMessage ? (
            <Link href={patientPath(p.id, "tab/messages")} className={cn(action("secondary"), "hidden md:inline-flex")}>
              <Send aria-hidden />
              Send message
            </Link>
          ) : null}
          {canPay ? (
            <Link href={patientPath(p.id, "tab/invoices")} className={cn(action("secondary"), "hidden md:inline-flex")}>
              <CreditCard aria-hidden />
              Take payment
            </Link>
          ) : null}
          <MoreActionsMenu items={menu} />
        </div>
      </section>

      <RecordTabs tabs={tabs} />
      <div className="pt-1">{children}</div>
    </div>
  );
}
