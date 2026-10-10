"use client";

/**
 * "Check the notes before they are used" (production wave 3), inside step 1 of "Complete a form" in both Studios.
 *
 * Shown when uploaded notes are not in the documented import layout and were read as ordinary clinic notes
 * (POST /connectors/file-import/read → NotesReview). Staff see and correct what was found – the patient's
 * registration details (editable), one row per dated note (date, time, clinician and type editable; untick to
 * leave out; the note's own text shown exactly as written), the outcome scores found – with live counts and
 * warnings ("3 entries without a clinician – choose one", "no date found for 1 block"). Confirming sends the
 * checked review to POST /connectors/file-import/confirm, which builds the record; nothing is drafted before.
 *
 * Owner: studio-a agent.
 */
import { useMemo, useState } from "react";
import { useHostHooks } from "../../host-hooks";
import { AlertTriangle, ArrowLeft, CheckCircle2, ChevronDown, FileText, ListChecks } from "lucide-react";
import {
  NOTES_REVIEW_COPY as COPY,
  NOTES_REVIEW_FIELD_LABELS as LABELS,
  NOTES_REVIEW_REQUIRED,
  type NotesReview,
  type NotesReviewEntry,
  type NotesReviewField,
  type NotesReviewRegistration,
} from "../../../connectors/file-import/review-contract";
import { formatUkDate } from "../../../core/dates";
import { APPOINTMENT_STATUS_LABELS, INSTRUCTING_PARTY_LABELS, NOTE_TYPE_LABELS } from "../../../core/labels";
import type { AppointmentStatus, InstructingPartyType, NoteType } from "../../../core/types";
import { Button, Input, cn } from "../../primitives";
import { FieldLabel, Notice, Select, Spinner } from "../shared/ui-bits";
import {
  applyClinician,
  attendanceNotice,
  clinicianKey,
  clinicianLabel,
  consentMissing,
  firstLines,
  markOthersAttended,
  reviewBlockers,
  reviewClinicians,
  reviewCounts,
  updateEntry,
  updateRegistration,
  withMemberNumbers,
  type ReviewClinician,
} from "./notes-review-model";

const GROUPS: Array<{ title: string; fields: NotesReviewField[] }> = [
  { title: "Patient", fields: ["title", "firstName", "lastName", "dob", "sex", "address", "postcode", "phone", "email", "occupation", "employer"] },
  { title: "Who the form is for", fields: ["instructingPartyName", "instructingPartyType", "reference"] },
  { title: "Insurance and referral", fields: ["insurerName", "membershipNumber", "authorisationNumber", "referredBy", "gpPractice"] },
  { title: "Accident and consent", fields: ["incidentDate", "incidentMechanism", "consent", "consentDate"] },
];

const DATE_FIELDS: NotesReviewField[] = ["dob", "incidentDate", "consentDate"];
const WIDE_FIELDS: NotesReviewField[] = ["address", "instructingPartyName", "incidentMechanism", "referredBy", "gpPractice", "insurerName"];
const OTHER = "__other__";
const NOT_RECORDED = "__not_recorded__";
/** Attendance statuses staff can set on an entry (fix wave 3). */
const ATTENDANCE_CHOICES: AppointmentStatus[] = ["ATT", "DNA", "LCN", "CNC"];

export interface NotesReviewStepProps {
  review: NotesReview;
  /** A clinic's Studio (no demo wording). */
  tenant: boolean;
  busy: boolean;
  /** The server refused the confirm (plain-English issues). */
  error: { message: string; issues: string[] } | null;
  onConfirm(review: NotesReview): void;
  onBack(): void;
}

export function NotesReviewStep({ review: initial, tenant, busy, error, onConfirm, onBack }: NotesReviewStepProps) {
  // A clinic's Studio offers its own clinicians (names and HCPC numbers from their profiles) – fix wave 3.
  const memberList = useHostHooks().clinic?.clinicians;
  const members = useMemo<ReviewClinician[]>(() => (memberList ?? []).map((m) => ({ name: m.name, hcpc: m.hcpc ?? "" })), [memberList]);
  const [review, setReview] = useState<NotesReview>(() => withMemberNumbers(initial, members));
  const clinicians = useMemo(() => reviewClinicians(withMemberNumbers(initial, members), members), [initial, members]);
  const counts = reviewCounts(review);
  const blockers = reviewBlockers(review);
  const attendanceTodo = attendanceNotice(review);
  const detected = new Set(review.detected);
  const serverWarnings = review.warnings.filter((w) => w.code !== "NO_CLINICIAN" && w.code !== "NO_DATE");
  const adminKeys = new Set(review.warnings.filter((w) => w.code === "ADMIN_LEFT_OUT").flatMap((w) => w.entryKeys ?? []));
  const scoresShown = review.outcomes.filter((o) => review.entries.some((e) => e.key === o.entryKey && e.include && e.date));

  return (
    <div className="space-y-4" data-testid="notes-review">
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900">
              <ListChecks className="h-4 w-4 text-teal-700" aria-hidden />
              {COPY.title}
            </h3>
            <p className="max-w-3xl text-sm text-slate-600">{COPY.intro}</p>
          </div>
          <p className="text-sm font-medium text-slate-800" data-testid="notes-review-summary">
            {COPY.summary(counts.included, counts.clinicians, counts.scores)}
          </p>
        </div>
        <p className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
          <FileText className="h-3.5 w-3.5" aria-hidden />
          <span>{review.fileName ?? (review.format === "text" ? "Pasted notes" : "Uploaded notes")}</span>
          {review.pages ? <span>· {review.pages} {review.pages === 1 ? "page" : "pages"}</span> : null}
          <span>· {review.attendance ? COPY.attendanceOn : COPY.attendanceOff}</span>
          {!tenant ? <span>· Fictional data only.</span> : null}
        </p>
      </div>

      {blockers.length ? (
        <Notice tone="warning" title={COPY.blockedPrefix}>
          <ul className="list-disc space-y-0.5 pl-4" data-testid="notes-review-blockers">
            {blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
          {counts.noClinician.length ? (
            <BulkClinician clinicians={clinicians} onApply={(c) => setReview((r) => applyClinician(r, reviewCounts(r).noClinician, c))} />
          ) : null}
        </Notice>
      ) : (
        <Notice tone="success" title="Ready to use">
          {counts.undated.length ? COPY.noDate(counts.undated.length) : "Every included note has a date and a clinician."}
        </Notice>
      )}

      {attendanceTodo ? (
        <Notice tone="info" title={COPY.attendanceLabel}>
          <p data-testid="notes-review-attendance">{attendanceTodo.text}</p>
          {attendanceTodo.canMarkOthers ? (
            <Button size="sm" variant="outline" className="mt-2 bg-white" onClick={() => setReview((r) => markOthersAttended(r))}>
              {COPY.markOthersAttended}
            </Button>
          ) : null}
        </Notice>
      ) : null}

      {serverWarnings.length ? (
        <Notice tone="info" title="Also check">
          <ul className="list-disc space-y-0.5 pl-4" data-testid="notes-review-warnings">
            {serverWarnings.map((w) => (
              <li key={w.message}>{w.message}</li>
            ))}
          </ul>
        </Notice>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-white p-4" aria-labelledby="notes-review-patient">
        <h3 id="notes-review-patient" className="text-sm font-semibold text-slate-900">
          {COPY.patientHeading}
        </h3>
        <p className="mt-0.5 text-xs text-slate-500">{COPY.patientHint}</p>
        <div className="mt-3 space-y-4">
          {GROUPS.map((group) => (
            <fieldset key={group.title} className="space-y-2">
              <legend className="text-xs font-semibold uppercase tracking-wide text-slate-500">{group.title}</legend>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {group.fields.map((field) => (
                  <RegistrationField
                    key={field}
                    field={field}
                    value={review.registration[field]}
                    found={detected.has(field)}
                    note={review.fieldNotes?.[field] ?? (field === "consent" && consentMissing(review) ? COPY.consentHint : undefined)}
                    onChange={(value) => setReview((r) => updateRegistration(r, field, value as NotesReviewRegistration[typeof field]))}
                  />
                ))}
              </div>
            </fieldset>
          ))}
        </div>
        {review.otherDetails?.length ? (
          <div className="mt-4 rounded-lg bg-slate-50 p-3" data-testid="notes-review-other-details">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{COPY.otherDetailsHeading}</p>
            <p className="mt-0.5 text-xs text-slate-500">{COPY.otherDetailsHint}</p>
            <ul className="mt-1.5 space-y-0.5 text-[13px] text-slate-700">
              {review.otherDetails.map((line, i) => (
                <li key={`${i}-${line}`} className="break-words">
                  {line}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4" aria-labelledby="notes-review-entries">
        <h3 id="notes-review-entries" className="text-sm font-semibold text-slate-900">
          {COPY.entriesHeading} <span className="font-normal text-slate-500">({counts.included} of {counts.entries} included)</span>
        </h3>
        <p className="mt-0.5 text-xs text-slate-500">{COPY.entriesHint}</p>
        <ol className="mt-3 space-y-2">
          {review.entries.map((entry) => (
            <EntryRow
              key={entry.key}
              entry={entry}
              clinicians={clinicians}
              letterDate={review.letterDate}
              admin={adminKeys.has(entry.key)}
              onChange={(patch) => setReview((r) => updateEntry(r, entry.key, patch))}
            />
          ))}
        </ol>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4" aria-labelledby="notes-review-scores">
        <h3 id="notes-review-scores" className="text-sm font-semibold text-slate-900">
          {COPY.scoresHeading}
        </h3>
        {scoresShown.length ? (
          <ul className="mt-2 flex flex-wrap gap-1.5" data-testid="notes-review-scores">
            {scoresShown.map((o) => {
              const entry = review.entries.find((e) => e.key === o.entryKey);
              return (
                <li key={`${o.instrument}-${o.entryKey}-${o.date}`} className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs text-indigo-900">
                  {o.instrument} {o.value} · {formatUkDate(o.date || entry?.date || "")}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-slate-500">{COPY.scoresNone}</p>
        )}
      </section>

      {error ? (
        <Notice tone="error" title="The notes could not be used yet">
          <p>{error.message}</p>
          {error.issues.length ? (
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {error.issues.slice(0, 10).map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          ) : null}
        </Notice>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="outline" onClick={onBack} disabled={busy}>
          <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden />
          {COPY.back}
        </Button>
        <div className="flex items-center gap-3">
          {busy ? <Spinner label={COPY.confirming} /> : null}
          <Button onClick={() => onConfirm(review)} disabled={busy || blockers.length > 0} data-testid="notes-review-confirm">
            <CheckCircle2 className="mr-1.5 h-4 w-4" aria-hidden />
            {COPY.confirm}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------ */

function BulkClinician({ clinicians, onApply }: { clinicians: ReviewClinician[]; onApply(c: ReviewClinician): void }) {
  const [choice, setChoice] = useState(clinicians.length ? clinicianKey(clinicians[0]) : OTHER);
  const [name, setName] = useState("");
  const [hcpc, setHcpc] = useState("");
  const chosen = choice === NOT_RECORDED ? { name: COPY.clinicianNotRecorded, hcpc: "" } : choice === OTHER ? { name: name.trim(), hcpc: hcpc.trim() } : clinicians.find((c) => clinicianKey(c) === choice);
  return (
    <div className="mt-2 flex flex-wrap items-end gap-2" data-testid="notes-review-bulk-clinician">
      <div className="min-w-[14rem]">
        <FieldLabel htmlFor="bulk-clinician">{COPY.bulkClinicianLabel}</FieldLabel>
        <Select id="bulk-clinician" value={choice} onChange={(e) => setChoice(e.target.value)} className="h-9 bg-white">
          {clinicians.map((c) => (
            <option key={clinicianKey(c)} value={clinicianKey(c)}>
              {clinicianLabel(c)}
            </option>
          ))}
          <option value={OTHER}>{COPY.clinicianOther}</option>
          <option value={NOT_RECORDED}>{COPY.clinicianNotRecorded}</option>
        </Select>
      </div>
      {choice === OTHER ? (
        <>
          <div>
            <FieldLabel htmlFor="bulk-clinician-name">{COPY.clinicianNameLabel}</FieldLabel>
            <Input id="bulk-clinician-name" className="h-9 bg-white" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <FieldLabel htmlFor="bulk-clinician-hcpc">{COPY.clinicianHcpcLabel}</FieldLabel>
            <Input id="bulk-clinician-hcpc" className="h-9 w-36 bg-white" value={hcpc} onChange={(e) => setHcpc(e.target.value)} />
          </div>
        </>
      ) : null}
      <Button size="sm" variant="outline" className="bg-white" disabled={!chosen || !chosen.name} onClick={() => chosen && chosen.name && onApply(chosen)}>
        {COPY.bulkApply}
      </Button>
    </div>
  );
}

function RegistrationField({
  field,
  value,
  found,
  note,
  onChange,
}: {
  field: NotesReviewField;
  value: string;
  found: boolean;
  note?: string;
  onChange(value: string): void;
}) {
  const id = `notes-reg-${field}`;
  const required = NOTES_REVIEW_REQUIRED.indexOf(field) >= 0;
  const missing = required && !value.trim();
  // Consent is not needed to build the record, but the report cannot be approved without it (fix wave 3).
  const consentNeeded = field === "consent" && value !== "yes";
  const tag = consentNeeded ? COPY.consentTag : found ? COPY.foundTag : missing ? COPY.requiredTag : value ? null : COPY.notFoundTag;
  const control =
    field === "sex" ? (
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Not stated</option>
        <option value="female">Female</option>
        <option value="male">Male</option>
        <option value="other">Other</option>
      </Select>
    ) : field === "instructingPartyType" ? (
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={missing || undefined}>
        <option value="">Choose…</option>
        {(Object.keys(INSTRUCTING_PARTY_LABELS) as InstructingPartyType[]).map((t) => (
          <option key={t} value={t}>
            {INSTRUCTING_PARTY_LABELS[t]}
          </option>
        ))}
      </Select>
    ) : field === "consent" ? (
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Not recorded</option>
        <option value="yes">Recorded</option>
        <option value="no">Not given</option>
      </Select>
    ) : (
      <Input
        id={id}
        type={DATE_FIELDS.indexOf(field) >= 0 ? "date" : field === "email" ? "email" : "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={missing || undefined}
        className={cn(missing && "border-amber-400")}
      />
    );
  return (
    <div className={cn(WIDE_FIELDS.indexOf(field) >= 0 && "sm:col-span-2")} data-field={field}>
      <FieldLabel
        htmlFor={id}
        hint={
          tag ? (
            <span className={cn("rounded px-1 py-0.5 text-[10px] font-medium", consentNeeded || missing ? "bg-amber-100 text-amber-900" : found ? "bg-teal-50 text-teal-800" : "bg-slate-100 text-slate-600")}>{tag}</span>
          ) : undefined
        }
      >
        {LABELS[field]}
      </FieldLabel>
      {control}
      {note ? <p className="mt-1 text-xs text-amber-800">{note}</p> : null}
    </div>
  );
}

function EntryRow({
  entry,
  clinicians,
  letterDate,
  admin,
  onChange,
}: {
  entry: NotesReviewEntry;
  clinicians: ReviewClinician[];
  /** A letter's own date, offered for its paragraphs without a date (fix wave 3). */
  letterDate?: string;
  /** An admin or message entry left out by default (fix wave 3). */
  admin: boolean;
  onChange(patch: Partial<NotesReviewEntry>): void;
}) {
  const [open, setOpen] = useState(false);
  const known = clinicians.find((c) => c.name === entry.clinicianName && c.hcpc === entry.clinicianHcpc);
  const notRecorded = entry.clinicianName === COPY.clinicianNotRecorded;
  const [other, setOther] = useState(Boolean(entry.clinicianName) && !known && !notRecorded);
  const selectValue = known ? clinicianKey(known) : notRecorded ? NOT_RECORDED : other ? OTHER : "";
  const label = entry.date ? formatUkDate(entry.date) : "no date";
  const text = entry.body.trim() ? entry.body : entry.heading;
  const needs = entry.include && (!entry.date || !entry.clinicianName.trim());
  return (
    <li
      className={cn("rounded-xl border p-3", !entry.include ? "border-dashed border-slate-200 bg-slate-50/60" : needs ? "border-amber-300 bg-amber-50/40" : "border-slate-200")}
      data-entry-key={entry.key}
    >
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex h-10 items-center gap-2 pr-1 text-sm text-slate-700">
          <input type="checkbox" className="h-4 w-4 accent-teal-600" checked={entry.include} onChange={(e) => onChange({ include: e.target.checked })} />
          {COPY.include}
        </label>
        <div>
          <FieldLabel htmlFor={`${entry.key}-date`}>Date</FieldLabel>
          <Input id={`${entry.key}-date`} type="date" className="h-10 w-40" value={entry.date} onChange={(e) => onChange({ date: e.target.value as NotesReviewEntry["date"] })} aria-invalid={(entry.include && !entry.date) || undefined} />
        </div>
        <div>
          <FieldLabel htmlFor={`${entry.key}-time`}>Time</FieldLabel>
          <Input id={`${entry.key}-time`} type="time" className="h-10 w-28" value={entry.time} onChange={(e) => onChange({ time: e.target.value as NotesReviewEntry["time"] })} />
        </div>
        <div className="min-w-[13rem] flex-1 sm:flex-none">
          <FieldLabel htmlFor={`${entry.key}-clinician`}>Clinician</FieldLabel>
          <Select
            id={`${entry.key}-clinician`}
            value={selectValue}
            aria-invalid={(entry.include && !entry.clinicianName) || undefined}
            onChange={(e) => {
              const v = e.target.value;
              if (v === OTHER) {
                setOther(true);
                onChange({ clinicianName: "", clinicianHcpc: "" });
              } else if (v === NOT_RECORDED) {
                setOther(false);
                onChange({ clinicianName: COPY.clinicianNotRecorded, clinicianHcpc: "" });
              } else {
                setOther(false);
                const c = clinicians.find((x) => clinicianKey(x) === v);
                onChange({ clinicianName: c?.name ?? "", clinicianHcpc: c?.hcpc ?? "" });
              }
            }}
          >
            <option value="">{COPY.clinicianNone}</option>
            {clinicians.map((c) => (
              <option key={clinicianKey(c)} value={clinicianKey(c)}>
                {clinicianLabel(c)}
              </option>
            ))}
            <option value={OTHER}>{COPY.clinicianOther}</option>
            <option value={NOT_RECORDED}>{COPY.clinicianNotRecorded}</option>
          </Select>
        </div>
        {other ? (
          <>
            <div>
              <FieldLabel htmlFor={`${entry.key}-cname`}>{COPY.clinicianNameLabel}</FieldLabel>
              <Input id={`${entry.key}-cname`} className="h-10 w-44" value={entry.clinicianName} onChange={(e) => onChange({ clinicianName: e.target.value })} />
            </div>
            <div>
              <FieldLabel htmlFor={`${entry.key}-chcpc`}>{COPY.clinicianHcpcLabel}</FieldLabel>
              <Input id={`${entry.key}-chcpc`} className="h-10 w-32" value={entry.clinicianHcpc} onChange={(e) => onChange({ clinicianHcpc: e.target.value })} />
            </div>
          </>
        ) : null}
        <div>
          <FieldLabel htmlFor={`${entry.key}-type`}>Type</FieldLabel>
          <Select id={`${entry.key}-type`} className="h-10 w-56" value={entry.type} onChange={(e) => onChange({ type: e.target.value as NoteType })}>
            {(Object.keys(NOTE_TYPE_LABELS) as NoteType[]).map((t) => (
              <option key={t} value={t}>
                {NOTE_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <FieldLabel htmlFor={`${entry.key}-status`}>{COPY.attendanceLabel}</FieldLabel>
          <Select
            id={`${entry.key}-status`}
            className="h-10 w-44"
            value={entry.status}
            onChange={(e) => onChange({ status: e.target.value as NotesReviewEntry["status"] })}
            aria-invalid={(entry.include && Boolean(entry.status) && !entry.time) || undefined}
          >
            <option value="">{COPY.attendanceNone}</option>
            {ATTENDANCE_CHOICES.concat(entry.status && ATTENDANCE_CHOICES.indexOf(entry.status) < 0 ? [entry.status] : []).map((s) => (
              <option key={s} value={s}>
                {APPOINTMENT_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </div>
        <span className="mb-2 ml-auto text-[11px] text-slate-400">{entry.where}</span>
      </div>
      {needs ? (
        <p className="mt-1.5 flex items-center gap-1 text-xs text-amber-900">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
          {!entry.date ? "Give this entry a date, or untick it to leave it out." : "Choose the clinician who wrote this note."}
        </p>
      ) : null}
      {!entry.date && letterDate ? (
        <Button size="sm" variant="outline" className="mt-1.5 h-8" onClick={() => onChange({ date: letterDate as NotesReviewEntry["date"] })}>
          {COPY.letterDateButton(formatUkDate(letterDate))}
        </Button>
      ) : null}
      {admin && !entry.include ? <p className="mt-1.5 text-xs text-slate-500">{COPY.adminHint}</p> : null}
      <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-slate-700" aria-label={`Note of ${label}, first lines`}>
        {firstLines(text) || COPY.noText}
      </p>
      <button
        type="button"
        className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} aria-hidden />
        {open ? COPY.hideText : COPY.showText}
      </button>
      {open ? (
        <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 font-sans text-[13px] leading-relaxed text-slate-800">
          {entry.heading ? <span className="block font-medium text-slate-900">{entry.heading}</span> : null}
          {entry.body || COPY.noText}
        </pre>
      ) : null}
    </li>
  );
}
