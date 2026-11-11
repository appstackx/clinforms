"use client";
/**
 * A patient's courses (PK02) on the record's Invoices tab: each course with "3 of 6 used · expires 12/03/2027", the
 * visits used from it (put one back with Reverse), Cancel course (credits the unused sessions on the sale invoice –
 * pro rata, editable) and, for owners and administrators, Change expiry. "Sell a course" makes a draft invoice with the
 * course's line (or issues it at once – the course starts when its invoice is issued). The server checks every action
 * again.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { cancelCourseAction, reverseCourseUseAction, sellCourseAction, setCourseExpiryAction } from "@/app/app/clinic/billing/actions";
import type { PatientCourseView, PatientCoursesView } from "@/modules/pms/billing/courses";
import { cn } from "@/lib/utils";
import { DatePicker, FormField, PmsButton, PmsNotice, SelectInput, TextInput, useToast } from "@/components/pms/ui";
import { BILLING_PATH, date, focusRing, money, parsePounds, poundsText } from "./format";

const STATE_TONE: Record<PatientCourseView["state"], string> = {
  active: "bg-[#E6F7F5] text-[#0B5F58]",
  used_up: "bg-[#F1F5F9] text-[#334155]",
  expired: "bg-[#FEF3C7] text-[#92400E]",
  cancelled: "bg-[#F1F5F9] text-[#475569]",
};

export function PatientCourses({ patientId, view }: { patientId: string; view: PatientCoursesView }) {
  const [selling, setSelling] = React.useState(false);
  const active = view.courses.filter((c) => c.state === "active");
  return (
    <section aria-labelledby="courses-heading" className="flex flex-col gap-3" data-testid="patient-courses">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="courses-heading" className="text-lg font-semibold text-foreground">
            Courses
          </h2>
          <p className="text-sm text-[#475569]">
            {view.courses.length === 0 ? "No courses yet." : `${active.length} active course${active.length === 1 ? "" : "s"}.`} Visits a course covers can be used from it when they are invoiced.
          </p>
        </div>
        {view.canSell && view.types.length > 0 && !selling ? (
          <PmsButton variant="secondary" onClick={() => setSelling(true)} data-testid="sell-course">
            Sell a course
          </PmsButton>
        ) : null}
      </div>
      {view.canSell && view.types.length === 0 ? <p className="text-sm text-[#475569]">Set up the courses the clinic sells under Set-up → Courses.</p> : null}
      {selling ? <SellCourseForm patientId={patientId} view={view} onClose={() => setSelling(false)} /> : null}
      {view.pending.length > 0 ? (
        <ul className="flex flex-col gap-1" data-testid="course-pending">
          {view.pending.map((p) => (
            <li key={p.invoiceId} className="text-sm text-[#334155]">
              <strong className="text-foreground">{p.name}</strong> ({money(p.totalPence)}) is on a{" "}
              <Link href={`${BILLING_PATH}/invoices/${p.invoiceId}`} className={cn("text-primary-strong underline underline-offset-2", focusRing)}>
                draft invoice
              </Link>
              . The course starts when the invoice is issued.
            </li>
          ))}
        </ul>
      ) : null}
      {view.courses.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {view.courses.map((c) => (
            <CourseCard key={c.id} patientId={patientId} course={c} view={view} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function SellCourseForm({ patientId, view, onClose }: { patientId: string; view: PatientCoursesView; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [typeId, setTypeId] = React.useState(view.types[0]?.id ?? "");
  const [caseId, setCaseId] = React.useState("");
  const [siteId, setSiteId] = React.useState(view.siteRequired && view.sites.length === 1 ? view.sites[0].id : "");
  const [busy, setBusy] = React.useState<"draft" | "issue" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const type = view.types.find((t) => t.id === typeId);

  async function sell(issue: boolean) {
    setBusy(issue ? "issue" : "draft");
    setError(null);
    const r = await sellCourseAction(patientId, { courseTypeId: typeId, caseId: caseId || null, siteId: siteId || null, issue });
    setBusy(null);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    toast.success(r.issued ? `Invoice ${r.number ?? ""} issued – the course has started`.replace("  ", " ") : "Draft invoice made – issue it to start the course");
    onClose();
    if (!r.issued) router.push(`${BILLING_PATH}/invoices/${r.invoiceId}`);
    else router.refresh();
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-white p-4" data-testid="sell-course-form">
      <h3 className="text-base font-semibold">Sell a course</h3>
      <div className="grid gap-3 md:grid-cols-3">
        <FormField id="sell-course-type" label="Course" hint={type?.summary}>
          <SelectInput value={typeId} onChange={(e) => setTypeId(e.target.value)} data-testid="sell-course-type">
            {view.types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} – {money(t.pricePence)}
              </option>
            ))}
          </SelectInput>
        </FormField>
        <FormField id="sell-course-case" label="Case (optional)" hint="A course for a case covers that case's visits only.">
          <SelectInput value={caseId} onChange={(e) => setCaseId(e.target.value)}>
            <option value="">Any of the patient&apos;s visits</option>
            {view.cases.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </SelectInput>
        </FormField>
        {view.sites.length > 0 ? (
          <FormField id="sell-course-site" label={view.siteRequired ? "Site" : "Site (optional)"} required={view.siteRequired}>
            <SelectInput value={siteId} onChange={(e) => setSiteId(e.target.value)}>
              {!view.siteRequired || view.sites.length > 1 ? <option value="">{view.siteRequired ? "Choose a site" : "No particular site"}</option> : null}
              {view.sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </SelectInput>
          </FormField>
        ) : null}
      </div>
      <p className="text-sm text-[#475569]">The invoice goes to the patient. The course starts when it is issued; the patient can use sessions before paying, and the balance shows as owed.</p>
      {error ? (
        <p role="alert" className="text-sm text-destructive-strong">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <PmsButton variant="secondary" onClick={onClose} disabled={busy !== null}>
          Cancel
        </PmsButton>
        <PmsButton variant="secondary" loading={busy === "draft"} disabled={!typeId} onClick={() => void sell(false)} data-testid="sell-course-draft">
          Create draft invoice
        </PmsButton>
        <PmsButton loading={busy === "issue"} disabled={!typeId} onClick={() => void sell(true)} data-testid="sell-course-issue">
          Sell and issue invoice
        </PmsButton>
      </div>
    </div>
  );
}

function CourseCard({ patientId, course: c, view }: { patientId: string; course: PatientCourseView; view: PatientCoursesView }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = React.useState<"cancel" | "expiry" | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [credit, setCredit] = React.useState(poundsText(c.cancelQuote?.defaultPence ?? 0));
  const [reason, setReason] = React.useState("");
  const [expiry, setExpiry] = React.useState(c.expiresOn ?? "");
  const used = c.uses.filter((u) => !u.reversed);

  async function reverse(useId: string) {
    setBusy(`reverse-${useId}`);
    setError(null);
    const r = await reverseCourseUseAction(patientId, c.id, useId);
    setBusy(null);
    if (!r.ok) setError(r.error);
    else {
      toast.success(c.state === "cancelled" ? "Visit taken off the cancelled course – it can be invoiced now" : "Visit put back on the course – it can be invoiced now");
      router.refresh();
    }
  }

  async function cancel() {
    const pence = parsePounds(credit);
    if (pence === null) {
      setError("Enter the amount to credit, e.g. 90.00 (0.00 for none).");
      return;
    }
    setBusy("cancel");
    setError(null);
    const r = await cancelCourseAction(patientId, c.id, pence, reason);
    setBusy(null);
    if (!r.ok) setError(r.error);
    else {
      toast.success(r.creditNumber ? `Course cancelled – credit note ${r.creditNumber} for ${money(r.creditPence)}` : "Course cancelled");
      setOpen(null);
      router.refresh();
    }
  }

  async function saveExpiry() {
    setBusy("expiry");
    setError(null);
    const r = await setCourseExpiryAction(patientId, c.id, c.rev, expiry || null);
    setBusy(null);
    if (!r.ok) setError(r.error);
    else {
      toast.success(expiry ? `Course now expires on ${date(expiry)}` : "The course no longer expires");
      setOpen(null);
      router.refresh();
    }
  }

  return (
    <li className="flex flex-col gap-3 rounded-xl border border-border bg-white p-4" data-testid="course-card" data-course={c.id}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-foreground">{c.name}</span>
        <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", STATE_TONE[c.state])}>{c.stateLabel}</span>
        <span className="text-sm tabular-nums text-[#334155]" data-testid="course-progress">
          {c.progress}
        </span>
      </div>
      <p className="text-sm text-[#475569]">
        Sold on {date(c.soldOn)} on{" "}
        <Link href={`${BILLING_PATH}/invoices/${c.saleInvoiceId}`} className={cn("text-primary-strong underline underline-offset-2", focusRing)}>
          {c.saleInvoiceNumber ?? "its invoice"}
        </Link>
        {c.caseTitle ? ` · for the case ${c.caseTitle}` : ""}
      </p>
      {c.state === "cancelled" && c.saleCreditedInFull && used.length > 0 && view.canSell ? (
        <p className="text-sm text-[#475569]" data-testid="course-cancelled-uses">
          This course&apos;s sale was voided or credited in full, so the visits used from it are no longer paid for. Use Reverse to invoice to bill each one on its own.
        </p>
      ) : null}
      {c.uses.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border text-sm" aria-label={`Visits used from ${c.name}`}>
          {c.uses.map((u) => (
            <li key={u.id} className="flex items-center gap-2 px-3 py-1.5">
              <span className={cn("tabular-nums", u.reversed && "text-[#64748B] line-through")}>Visit on {date(u.usedOn)}</span>
              {u.reversed ? <span className="text-xs text-[#475569]">put back</span> : null}
              {!u.reversed && view.canSell ? (
                <PmsButton
                  size="sm"
                  variant="secondary"
                  className="ml-auto"
                  loading={busy === `reverse-${u.id}`}
                  onClick={() => void reverse(u.id)}
                  aria-label={c.state === "cancelled" && c.saleCreditedInFull ? `Reverse to invoice – the visit on ${date(u.usedOn)}` : `Reverse – put back the visit on ${date(u.usedOn)}`}
                >
                  {c.state === "cancelled" && c.saleCreditedInFull ? "Reverse to invoice" : "Reverse"}
                </PmsButton>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-[#475569]">No visits used yet.</p>
      )}
      {error ? (
        <p role="alert" className="text-sm text-destructive-strong">
          {error}
        </p>
      ) : null}
      {c.state !== "cancelled" && (view.canCancel || view.canExtend) && open === null ? (
        <div className="flex flex-wrap gap-2">
          {view.canExtend ? (
            <PmsButton size="sm" variant="secondary" onClick={() => setOpen("expiry")}>
              Change expiry
            </PmsButton>
          ) : null}
          {view.canCancel ? (
            <PmsButton size="sm" variant="secondary" onClick={() => setOpen("cancel")} data-testid="cancel-course">
              Cancel course
            </PmsButton>
          ) : null}
        </div>
      ) : null}
      {open === "expiry" ? (
        <div className="flex flex-wrap items-end gap-3">
          <FormField id={`expiry-${c.id}`} label="Expires on" hint="Leave empty for no expiry.">
            <DatePicker id={`expiry-${c.id}`} value={expiry} onChange={setExpiry} min={c.soldOn} today={view.today} />
          </FormField>
          <PmsButton size="sm" variant="secondary" onClick={() => setOpen(null)}>
            Back
          </PmsButton>
          <PmsButton size="sm" loading={busy === "expiry"} onClick={() => void saveExpiry()}>
            Save expiry
          </PmsButton>
        </div>
      ) : null}
      {open === "cancel" ? (
        <div className="flex flex-col gap-3" data-testid="cancel-course-form">
          <PmsNotice tone="info" title="Cancelling a course">
            The course closes and a credit note goes on its invoice. By default it credits the {c.sessionsTotal - used.length} unused session{c.sessionsTotal - used.length === 1 ? "" : "s"} ({money(c.cancelQuote?.defaultPence ?? 0)}); you can change the amount, up to {money(c.cancelQuote?.maxPence ?? 0)}. If the patient has paid, record the refund on the invoice.
          </PmsNotice>
          <div className="grid gap-3 md:grid-cols-2">
            <FormField id={`credit-${c.id}`} label="Amount to credit (£)">
              <TextInput inputMode="decimal" value={credit} onChange={(e) => setCredit(e.target.value)} data-testid="cancel-course-credit" />
            </FormField>
            <FormField id={`reason-${c.id}`} label="Reason" required>
              <TextInput value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} data-testid="cancel-course-reason" />
            </FormField>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <PmsButton size="sm" variant="secondary" onClick={() => setOpen(null)}>
              Keep the course
            </PmsButton>
            <PmsButton size="sm" loading={busy === "cancel"} onClick={() => void cancel()} data-testid="cancel-course-confirm">
              Cancel course
            </PmsButton>
          </div>
        </div>
      ) : null}
    </li>
  );
}
