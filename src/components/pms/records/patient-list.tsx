"use client";
/**
 * Patients (design round 2: "Patients – list, states, new patient" and "Patients – 375 px"): search, filters, the
 * table (cards on a phone), pagination, loading / empty / error states, Export CSV and New patient.
 *
 * The data comes from the server page (src/app/app/clinic/patients/page.tsx → patient-list-service); every filter
 * lives in the URL, so a filtered list can be shared, reloaded and exported as it is.
 *
 * Billing (M5): the "Balance" column and the "+ Owes money" filter for members with billing.view.
 * Differences from the design: the subtitle names no site.
 */
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, ChevronUp, Download, Plus, Search, SearchX } from "lucide-react";
import { formatPence, formatUkDate } from "@/modules/pms/core/text";
import { PAYER_TYPES } from "@/modules/pms/core/schemas";
import { PAYER_TYPE_LABELS } from "@/modules/pms/records/copy";
import { DEFAULT_PATIENT_FILTERS, hasNarrowingFilters, paramsFromFilters, type PatientListFilters } from "@/modules/pms/records/patient-list";
import { cn } from "@/lib/utils";
import { ClearFilters, EmptyState, ErrorState, FilterAddButton, FilterChip, Pagination, PmsAvatar, PmsButton, SkeletonBar, pmsButtonVariants } from "@/components/pms/ui";
import type { RecordsAction } from "./form";
import { whenLabel } from "./format";
import { NewPatientDrawer } from "./new-patient-drawer";

export interface PatientListRowView {
  id: string;
  patientNumber: number;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  dateOfBirth: string | null;
  age: number | null;
  phoneMobile: string | null;
  status: string;
  hasAlerts: boolean;
  next: { startsAt: string; practitionerName: string | null } | null;
  openCase: { title: string; payerName: string | null } | null;
  /** What the patient owes (null: no billing.view). */
  balancePence: number | null;
}

export interface PatientListProps {
  rows: PatientListRowView[];
  total: number;
  page: number;
  pageSize: number;
  today: string;
  filters: PatientListFilters;
  practitioners: { id: string; name: string }[];
  myPractitionerId: string | null;
  canCreate: boolean;
  canExport: boolean;
  canSeeUnsigned: boolean;
  /** billing.view: the Balance column and the "Owes money" filter. */
  canSeeBalance?: boolean;
  /** The list could not be read (the error state). */
  failed: boolean;
  registerAction: RecordsAction;
}

const STATUS_LABELS: Record<string, string> = { active: "Active", archived: "Archived", deceased: "Deceased", any: "All" };

function nameOf(r: { firstName: string; lastName: string; preferredName: string | null }) {
  return `${r.preferredName || r.firstName} ${r.lastName}`;
}

function AlertPill() {
  return (
    <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded-[6px] bg-[#FEF3C7] px-1.5 text-[11px] font-semibold text-[#864E0E]">
      <AlertTriangle className="h-3 w-3" aria-hidden />
      Alert
    </span>
  );
}

/** An inline filter picker: "+ Practitioner" opens a labelled select; choosing applies it. */
function AddFilter({ label, options, onPick }: { label: string; options: { value: string; label: string }[]; onPick: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    if (open) ref.current?.focus();
  }, [open]);
  if (!open)
    return (
      <FilterAddButton onClick={() => setOpen(true)} expanded={false}>
        {label}
      </FilterAddButton>
    );
  const id = `filter-${label.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <span className="inline-flex items-center">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <select
        id={id}
        ref={ref}
        defaultValue=""
        onChange={(e) => {
          if (e.target.value) onPick(e.target.value);
          setOpen(false);
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        className="h-8 rounded-[8px] border border-primary bg-white px-2 text-[13px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <option value="">{label}…</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </span>
  );
}

export function PatientList(props: PatientListProps) {
  const { rows, total, page, pageSize, today, filters, practitioners, myPractitionerId, canCreate, canExport, canSeeUnsigned, canSeeBalance = false, failed, registerAction } = props;
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(filters.q);
  const [drawer, setDrawer] = useState(false);
  const [prefill, setPrefill] = useState<string | undefined>(undefined);
  const lastPushed = useRef(filters.q);

  const go = (next: Partial<PatientListFilters>, options: { resetPage?: boolean } = { resetPage: true }) => {
    const merged: PatientListFilters = { ...filters, ...next, ...(options.resetPage ? { page: next.page ?? 1 } : {}) };
    const qs = paramsFromFilters(merged).toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };

  // Search as you type (after a short pause); Enter searches at once.
  useEffect(() => {
    if (query === lastPushed.current) return;
    const t = setTimeout(() => {
      lastPushed.current = query;
      go({ q: query.trim() });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);
  useEffect(() => {
    setQuery(filters.q);
    lastPushed.current = filters.q;
  }, [filters.q]);

  const pracName = useMemo(() => new Map(practitioners.map((p) => [p.id, p.name])), [practitioners]);
  const exportHref = `/app/clinic/patients/export?${paramsFromFilters({ ...filters, page: 1 }).toString()}`;
  const statusWord = filters.status === "active" ? "active" : filters.status === "any" ? "" : filters.status;
  const subtitle = failed ? "All sites" : pending ? "Loading…" : `${total.toLocaleString("en-GB")}${statusWord ? ` ${statusWord}` : " patients"} · all sites`;
  const openNew = (name?: string) => {
    setPrefill(name);
    setDrawer(true);
  };

  const sortToggle = () => go({ sort: filters.sort === "asc" ? "desc" : "asc" });
  const narrowed = hasNarrowingFilters(filters);

  const filterBar = (
    <div className="flex flex-col gap-3 border-b border-border px-4 py-3 md:flex-row md:flex-wrap md:items-center">
      <div className="flex h-9 min-w-0 items-center gap-2 rounded-[8px] border border-input-strong bg-white px-2.5 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary md:max-w-[360px] md:flex-[1_1_300px]">
        <Search className="h-4 w-4 shrink-0 text-[#64748B]" aria-hidden />
        <label htmlFor="patients-filter" className="sr-only">
          Filter patients
        </label>
        <input
          id="patients-filter"
          type="search"
          value={query}
          placeholder="Name, DOB, phone or email"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              lastPushed.current = query;
              go({ q: query.trim() });
            }
          }}
          className="h-full min-w-0 flex-1 bg-transparent text-sm placeholder:text-[#64748B] focus:outline-none"
        />
      </div>
      {/* Phone (design 375 px): quick chips instead of the filter row. */}
      <div className="flex flex-wrap gap-2 md:hidden" aria-label="Quick filters" role="group">
        {myPractitionerId ? (
          <QuickChip pressed={filters.practitionerId === myPractitionerId} onClick={() => go({ practitionerId: filters.practitionerId === myPractitionerId ? null : myPractitionerId })}>
            My patients
          </QuickChip>
        ) : null}
        <QuickChip pressed={filters.seenToday} onClick={() => go({ seenToday: !filters.seenToday })}>
          Seen today
        </QuickChip>
        {canSeeUnsigned ? (
          <Link href="/app/clinic/patients/unsigned-notes" className="inline-flex h-8 items-center rounded-full border border-border bg-white px-3 text-[13px] text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
            Unsigned notes
          </Link>
        ) : null}
      </div>
      <div className="hidden flex-wrap items-center gap-2 md:flex">
        <span className="relative inline-flex">
          <label htmlFor="patients-status" className="sr-only">
            Status
          </label>
          <select
            id="patients-status"
            value={filters.status}
            onChange={(e) => go({ status: e.target.value as PatientListFilters["status"] })}
            className="h-8 appearance-none rounded-[8px] border border-primary bg-[#F0FDFA] pl-2.5 pr-7 text-[13px] font-medium text-[#0B5F58] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {Object.entries(STATUS_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                Status: {l}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#0B5F58]" aria-hidden />
        </span>
        {filters.practitionerId ? (
          <FilterChip onRemove={() => go({ practitionerId: null })}>Practitioner: {pracName.get(filters.practitionerId) ?? "chosen"}</FilterChip>
        ) : (
          <AddFilter label="Practitioner" options={practitioners.map((p) => ({ value: p.id, label: p.name }))} onPick={(v) => go({ practitionerId: v })} />
        )}
        {filters.payer ? (
          <FilterChip onRemove={() => go({ payer: null })}>Payer: {PAYER_TYPE_LABELS[filters.payer]}</FilterChip>
        ) : (
          <AddFilter label="Payer" options={PAYER_TYPES.map((p) => ({ value: p, label: PAYER_TYPE_LABELS[p] }))} onPick={(v) => go({ payer: v as PatientListFilters["payer"] })} />
        )}
        {filters.noFuture ? (
          <FilterChip onRemove={() => go({ noFuture: false })}>No future appointment</FilterChip>
        ) : (
          <FilterAddButton onClick={() => go({ noFuture: true })}>No future appointment</FilterAddButton>
        )}
        {filters.seenToday ? <FilterChip onRemove={() => go({ seenToday: false })}>Seen today</FilterChip> : null}
        {canSeeBalance ? (
          filters.owesMoney ? (
            <FilterChip onRemove={() => go({ owesMoney: false })}>Owes money</FilterChip>
          ) : (
            <FilterAddButton onClick={() => go({ owesMoney: true })}>Owes money</FilterAddButton>
          )
        ) : null}
        {narrowed ? <ClearFilters onClick={() => go({ ...DEFAULT_PATIENT_FILTERS })} /> : null}
      </div>
    </div>
  );

  let body: React.ReactNode;
  if (failed) {
    body = (
      <div className="p-4 [&>*]:border-0">
        <ErrorState
          title="Couldn't load patients"
          action={
            <PmsButton onClick={() => startTransition(() => router.refresh())} loading={pending}>
              Try again
            </PmsButton>
          }
        >
          The connection dropped while loading. Your filters are kept. Try again – if it keeps happening, contact your practice admin.
        </ErrorState>
      </div>
    );
  } else if (pending) {
    body = (
      <div role="status" aria-label="Loading patients" className="flex flex-col gap-4 p-4">
        {[180, 140, 200, 160, 120, 190, 150, 170].map((w, i) => (
          <div key={i} className="flex items-center gap-4">
            <SkeletonBar className="h-8 w-8 rounded-full" />
            <SkeletonBar style={{ width: w }} />
            <SkeletonBar className="hidden w-24 md:block" />
            <SkeletonBar className="hidden w-28 md:block" />
            <SkeletonBar className="hidden flex-1 md:block" />
          </div>
        ))}
      </div>
    );
  } else if (rows.length === 0) {
    body = (
      <div className="p-4 [&>*]:border-0">
        <EmptyState
          icon={<SearchX />}
          title={filters.q ? `No patients match "${filters.q}"` : narrowed ? "No patients match these filters" : "No patients yet"}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {filters.status !== "any" && (filters.q || narrowed) ? (
                <PmsButton variant="secondary" onClick={() => go({ status: "any" })}>
                  Include archived
                </PmsButton>
              ) : null}
              {canCreate ? <PmsButton onClick={() => openNew(filters.q || undefined)}>{filters.q ? `Create "${filters.q}" as new patient` : "New patient"}</PmsButton> : null}
            </div>
          }
        >
          {filters.q ? "Check the spelling, search by date of birth or mobile instead, or include discharged and archived patients." : narrowed ? "Change or clear the filters to see more patients." : "Patients you register appear here."}
        </EmptyState>
      </div>
    );
  } else {
    body = (
      <>
        <div className="relative hidden overflow-x-auto md:block">
          <table className="w-full min-w-[860px] border-collapse text-sm">
            <caption className="sr-only">Patients</caption>
            <thead>
              <tr className="bg-[#F8FAFC] text-left text-xs text-[#475569]">
                <th scope="col" aria-sort={filters.sort === "asc" ? "ascending" : "descending"} className="px-4 py-2.5 font-semibold">
                  <button type="button" onClick={sortToggle} aria-label={`Name, sorted ${filters.sort === "asc" ? "A to Z" : "Z to A"}`} className="inline-flex items-center gap-1 rounded font-semibold hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                    Name
                    {filters.sort === "asc" ? <ChevronDown className="h-3 w-3" aria-hidden /> : <ChevronUp className="h-3 w-3" aria-hidden />}
                  </button>
                </th>
                <th scope="col" className="px-4 py-2.5 font-semibold">
                  Date of birth
                </th>
                <th scope="col" className="px-4 py-2.5 font-semibold">
                  Mobile
                </th>
                <th scope="col" className="px-4 py-2.5 font-semibold">
                  Next appointment
                </th>
                <th scope="col" className="px-4 py-2.5 font-semibold">
                  Open case
                </th>
                {canSeeBalance ? (
                  <th scope="col" className="px-4 py-2.5 text-right font-semibold">
                    Balance
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border hover:bg-[#F8FAFC]">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <PmsAvatar name={nameOf(r)} size={32} />
                      <Link href={`/app/clinic/patients/${encodeURIComponent(r.id)}`} className="truncate font-medium text-foreground underline underline-offset-2 hover:text-primary-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                        {nameOf(r)}
                      </Link>
                      {r.hasAlerts ? <AlertPill /> : null}
                      {r.status !== "active" ? <span className="rounded-[6px] bg-[#F1F5F9] px-1.5 text-[11px] font-medium text-[#334155]">{STATUS_LABELS[r.status] ?? r.status}</span> : null}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">
                    {r.dateOfBirth ? formatUkDate(r.dateOfBirth) : "–"} {r.age !== null ? <span className="text-[#475569]">({r.age})</span> : null}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">{r.phoneMobile ?? "–"}</td>
                  <td className="whitespace-nowrap px-4 py-2.5">
                    {r.next ? (
                      <>
                        <span className="tabular-nums">{whenLabel(r.next.startsAt, today)}</span>
                        {r.next.practitionerName ? <span className="text-[#475569]"> {r.next.practitionerName}</span> : null}
                      </>
                    ) : (
                      "–"
                    )}
                  </td>
                  <td className="max-w-[240px] px-4 py-2.5">
                    <span className="block truncate" title={r.openCase ? `${r.openCase.title}${r.openCase.payerName ? ` – ${r.openCase.payerName}` : ""}` : undefined}>
                      {r.openCase ? `${r.openCase.title}${r.openCase.payerName ? ` – ${r.openCase.payerName}` : ""}` : "–"}
                    </span>
                  </td>
                  {canSeeBalance ? (
                    <td className={cn("whitespace-nowrap px-4 py-2.5 text-right tabular-nums", (r.balancePence ?? 0) > 0 ? "font-semibold text-destructive-strong" : "text-[#475569]")} data-testid="patient-balance">
                      {formatPence(r.balancePence ?? 0)}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="flex flex-col gap-2 p-4 md:hidden" aria-label="Patients">
          {rows.map((r) => (
            <li key={r.id}>
              <Link
                href={`/app/clinic/patients/${encodeURIComponent(r.id)}`}
                className="flex min-h-[64px] items-center gap-3 rounded-xl border border-border bg-white px-3 py-2.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <PmsAvatar name={nameOf(r)} size={40} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-1.5 font-semibold text-foreground">
                    <span className="truncate">{nameOf(r)}</span>
                    {r.hasAlerts ? (
                      <>
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-[#864E0E]" aria-hidden />
                        <span className="sr-only">(has an alert)</span>
                      </>
                    ) : null}
                  </span>
                  <span className="truncate text-[13px] text-[#334155]">
                    {r.dateOfBirth ? formatUkDate(r.dateOfBirth) : "No date of birth"} · Next: {r.next ? whenLabel(r.next.startsAt, today).replace(/ \d{2}\/\d{2}/, "") : "none"}
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-[#64748B]" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
        <Pagination label="Patients" page={page} pageSize={pageSize} total={total} onPageChange={(p) => go({ page: p }, { resetPage: false })} />
      </>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="text-xl font-semibold text-foreground">Patients</h1>
          <span className="hidden text-sm text-[#475569] md:block" aria-live="polite">
            {subtitle}
          </span>
        </div>
        {canExport ? (
          <a href={exportHref} className={cn(pmsButtonVariants({ variant: "secondary" }), "hidden md:inline-flex")} download>
            <Download aria-hidden />
            Export CSV
          </a>
        ) : null}
        {canCreate ? (
          <>
            <PmsButton onClick={() => openNew()} className="hidden md:inline-flex">
              <Plus aria-hidden />
              New patient
            </PmsButton>
            <PmsButton onClick={() => openNew()} size="lg" className="h-11 w-11 px-0 md:hidden" aria-label="New patient">
              <Plus aria-hidden />
            </PmsButton>
          </>
        ) : null}
      </div>
      <section aria-label="Patients" aria-busy={pending || undefined} className="overflow-hidden rounded-2xl border border-border bg-white">
        {filterBar}
        {body}
      </section>
      {canCreate ? <NewPatientDrawer key={prefill ?? ""} open={drawer} onOpenChange={setDrawer} action={registerAction} initialName={prefill} /> : null}
    </div>
  );
}

function QuickChip({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center rounded-full border px-3 text-[13px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        pressed ? "border-primary bg-[#F0FDFA] font-medium text-[#0B5F58]" : "border-border bg-white text-foreground",
      )}
    >
      {children}
    </button>
  );
}
