"use client";

/**
 * Simulated clinic patient list: search (name, date of birth, postcode or patient ID), a table from
 * `md` and cards on phones, and the number of reports filed back in this browser.
 *
 * Owner: sandbox agent.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, FileCheck2, Search, UsersRound, X } from "lucide-react";
import type { SimReferralSourceType } from "../wire-types";
import { countDocumentsByPatient, subscribeDocuments } from "../client-store";
import { formatDate, REFERRAL_LABELS } from "./format";

export interface PatientListRow {
  id: string;
  title: string | null;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  age: number | null;
  postcode: string;
  town: string;
  /** Latest episode of care, if any. */
  episode: {
    title: string;
    status: "open" | "discharged";
    startDate: string;
    referralSource: SimReferralSourceType;
    organisation: string;
  } | null;
}

function matches(row: PatientListRow, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = [
    row.firstName,
    row.lastName,
    row.id,
    row.dateOfBirth,
    formatDate(row.dateOfBirth),
    row.postcode,
    row.postcode.replace(/\s+/g, ""),
  ]
    .join(" ")
    .toLowerCase();
  return words.every((w) => hay.includes(w));
}

function EpisodeStatus({ row }: { row: PatientListRow }) {
  if (!row.episode) {
    return <span className="text-sm text-slate-500">Registration only</span>;
  }
  const open = row.episode.status === "open";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
        open ? "bg-blue-50 text-blue-800 ring-blue-600/25" : "bg-slate-100 text-slate-700 ring-slate-500/25"
      }`}
    >
      {open ? "Open" : "Discharged"}
    </span>
  );
}

function FiledBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-800 ring-1 ring-inset ring-blue-600/25">
      <FileCheck2 className="h-3.5 w-3.5" aria-hidden />
      {count} filed
    </span>
  );
}

export function PatientList({ rows }: { rows: PatientListRow[] }) {
  const [query, setQuery] = useState("");
  const [filed, setFiled] = useState<Record<string, number>>({});

  useEffect(() => {
    const refresh = () => setFiled(countDocumentsByPatient());
    refresh();
    return subscribeDocuments(refresh);
  }, []);

  const visible = useMemo(() => rows.filter((r) => matches(r, query)), [rows, query]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Patients</h1>
          <p className="mt-1 text-sm text-slate-600">
            {rows.length} registered patients · fictional demo data
          </p>
        </div>
        <div className="w-full sm:max-w-sm">
          <label htmlFor="patient-search" className="mb-1 block text-xs font-medium text-slate-700">
            Search patients
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              id="patient-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name, date of birth, postcode or ID"
              autoComplete="off"
              className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-9 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/30"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            )}
          </div>
        </div>
      </div>

      <p className="sr-only" aria-live="polite">
        {visible.length === rows.length ? `${rows.length} patients` : `${visible.length} of ${rows.length} patients match`}
      </p>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {visible.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-14 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100">
              <UsersRound className="h-5 w-5 text-slate-500" aria-hidden />
            </span>
            <p className="mt-3 text-sm font-medium text-slate-900">No patients match “{query}”</p>
            <p className="mt-1 text-sm text-slate-600">Try a surname, a date of birth such as 22/11/1991, or a postcode.</p>
            <button
              type="button"
              onClick={() => setQuery("")}
              className="mt-4 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            >
              Clear search
            </button>
          </div>
        ) : (
          <>
            {/* Table (md and up) */}
            <table className="hidden w-full text-left text-sm md:table">
              <caption className="sr-only">Registered patients</caption>
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-600">
                <tr>
                  <th scope="col" className="px-4 py-3">Patient</th>
                  <th scope="col" className="px-4 py-3">Date of birth</th>
                  <th scope="col" className="px-4 py-3">Postcode</th>
                  <th scope="col" className="px-4 py-3">Episode of care</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                  <th scope="col" className="px-4 py-3"><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map((row) => (
                  <tr key={row.id} className="relative transition-colors focus-within:bg-blue-50/60 hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link
                        href={`/pms-sandbox/patients/${encodeURIComponent(row.id)}`}
                        className="font-medium text-slate-900 after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-blue-600"
                      >
                        {row.lastName}, {row.firstName}
                        {row.title ? <span className="font-normal text-slate-500"> ({row.title})</span> : null}
                      </Link>
                      <div className="mt-0.5 flex items-center gap-2 font-mono text-xs text-slate-500">
                        {row.id}
                        <FiledBadge count={filed[row.id] ?? 0} />
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                      {formatDate(row.dateOfBirth)}
                      {row.age !== null && <span className="text-slate-500"> ({row.age})</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-700">{row.postcode}</td>
                    <td className="px-4 py-3">
                      {row.episode ? (
                        <>
                          <div className="max-w-xs truncate text-slate-800">{row.episode.title}</div>
                          <div className="mt-0.5 text-xs text-slate-500">
                            {REFERRAL_LABELS[row.episode.referralSource]} · {row.episode.organisation}
                          </div>
                        </>
                      ) : (
                        <span className="text-slate-400">–</span>
                      )}
                    </td>
                    <td className="px-4 py-3"><EpisodeStatus row={row} /></td>
                    <td className="px-4 py-3 text-right">
                      <ChevronRight className="ml-auto h-4 w-4 text-slate-400" aria-hidden />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Cards (phones) */}
            <ul className="divide-y divide-slate-100 md:hidden">
              {visible.map((row) => (
                <li key={row.id}>
                  <Link
                    href={`/pms-sandbox/patients/${encodeURIComponent(row.id)}`}
                    className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50 focus-visible:bg-blue-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-slate-900">
                          {row.lastName}, {row.firstName}
                        </span>
                        <EpisodeStatus row={row} />
                        <FiledBadge count={filed[row.id] ?? 0} />
                      </div>
                      <div className="mt-0.5 text-xs text-slate-600">
                        DOB {formatDate(row.dateOfBirth)} · {row.postcode} · <span className="font-mono">{row.id}</span>
                      </div>
                      {row.episode && (
                        <div className="mt-1 truncate text-xs text-slate-500">
                          {REFERRAL_LABELS[row.episode.referralSource]} · {row.episode.title}
                        </div>
                      )}
                    </div>
                    <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
