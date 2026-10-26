"use client";
/**
 * Find a patient by name, number, date of birth or phone (the diary's booking form, quick search and the
 * waiting list). Results are plain buttons in a list – keyboard and screen-reader friendly – and the count is
 * announced. The search term is sent in a POST body, never in an address.
 */
import { useEffect, useRef, useState } from "react";
import { formatUkDate } from "@/modules/pms/core/text";
import { cn } from "@/lib/utils";

export interface PatientHit {
  id: string;
  name: string;
  number: number;
  dateOfBirth: string | null;
  postcode: string | null;
  hasAlerts: boolean;
  next: { id: string; date: string; time: string; siteId: string; practitionerId: string | null } | null;
}

export const PATIENT_SEARCH_URL = "/app/clinic/diary/api/patients";

export function PatientSearch({
  id,
  label,
  onPick,
  autoFocus,
  showNext = false,
  pickLabel,
  hint = "Name, patient number, date of birth (DD/MM/YYYY) or phone number.",
}: {
  id: string;
  label: string;
  onPick: (hit: PatientHit) => void;
  autoFocus?: boolean;
  showNext?: boolean;
  /** Visible text of each result's button (default: the patient's name). */
  pickLabel?: (hit: PatientHit) => string;
  hint?: string;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<PatientHit[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const term = q.trim();
    if (term.length < 2) {
      setHits([]);
      setState("idle");
      return;
    }
    const controller = new AbortController();
    timer.current = setTimeout(async () => {
      setState("loading");
      try {
        const res = await fetch(PATIENT_SEARCH_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ q: term }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { patients: PatientHit[] };
        setHits(body.patients);
        setState("done");
      } catch (err) {
        if ((err as { name?: string }).name !== "AbortError") setState("error");
      }
    }, 250);
    return () => {
      controller.abort();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q]);

  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium text-slate-800">
        {label}
      </label>
      <input
        id={id}
        type="search"
        autoComplete="off"
        autoFocus={autoFocus}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && hits.length > 0) {
            e.preventDefault();
            onPick(hits[0]);
          }
        }}
        aria-describedby={`${id}-hint ${id}-status`}
        className="block h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/30"
      />
      <p id={`${id}-hint`} className="text-xs text-slate-600">
        {hint}
      </p>
      <p id={`${id}-status`} role="status" className="text-xs text-slate-700">
        {state === "loading" ? "Searching…" : state === "error" ? "The search did not work. Try again." : state === "done" ? (hits.length === 0 ? "No patients match." : `${hits.length} ${hits.length === 1 ? "patient" : "patients"} found.`) : ""}
      </p>
      {hits.length > 0 ? (
        <ul aria-label="Matching patients" className="max-h-60 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 bg-white">
          {hits.map((h) => (
            <li key={h.id}>
              <button
                type="button"
                onClick={() => onPick(h)}
                className={cn("flex w-full flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-3 py-2 text-left text-sm hover:bg-teal-50 focus-visible:bg-teal-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-700")}
              >
                <span className="font-medium text-slate-900">
                  {pickLabel ? pickLabel(h) : h.name}
                  {h.hasAlerts ? <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-800">Alert</span> : null}
                </span>
                <span className="text-xs text-slate-700">
                  No. {h.number}
                  {h.dateOfBirth ? ` · born ${h.dateOfBirth}` : ""}
                  {h.postcode ? ` · ${h.postcode}` : ""}
                  {showNext ? (h.next ? ` · next: ${formatUkDate(h.next.date)} ${h.next.time}` : " · no appointment booked") : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
