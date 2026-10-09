"use client";

/**
 * Sources tab: every record the answers can cite – the clinical notes (SOAP, with date and author),
 * the facts computed by code (FACT-*) and the registration details (REG). A citation chip click
 * highlights and scrolls to its source; a search box filters the notes.
 *
 * Owner: studio-b agent.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Calculator, Contact, Search, ShieldCheck, StickyNote } from "lucide-react";
import { NOTICES } from "../../../config.public";
import { compareIsoDateTime, formatUkDate } from "../../../core/dates";
import { INSTRUCTING_PARTY_LABELS, NOTE_TYPE_LABELS } from "../../../core/labels";
import type { ComputedFact, EpisodeBundle, Note, ReportTemplate } from "../../../core/types";
import { cn } from "../../primitives";
import { WORDING } from "../../wording";
import { Highlight } from "./review-ui";

const SOAP: Array<{ key: keyof Note; label: string }> = [
  { key: "subjective", label: "Subjective" },
  { key: "objective", label: "Objective" },
  { key: "assessment", label: "Assessment" },
  { key: "plan", label: "Plan" },
  { key: "freeText", label: "Notes" },
  { key: "pastMedicalHistory", label: "Past medical history" },
  { key: "socialHistory", label: "Social history" },
];

const SCOPED_KEYS: Record<string, keyof Note> = {
  "note.pastMedicalHistory": "pastMedicalHistory",
  "note.socialHistory": "socialHistory",
};

function noteText(note: Note): string {
  return SOAP.map((s) => (typeof note[s.key] === "string" ? (note[s.key] as string) : "")).join(" ");
}

/** Scroll the nearest scrolling ancestor (the panel) to `el`, without scrolling the page. */
function scrollWithinPanel(el: HTMLElement): void {
  let box: HTMLElement | null = el.parentElement;
  while (box) {
    const style = window.getComputedStyle(box);
    if (/(auto|scroll)/.test(style.overflowY) && box.scrollHeight > box.clientHeight) break;
    box = box.parentElement;
  }
  if (!box) return;
  const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - 8;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  box.scrollTo({ top, behavior: reduce ? "auto" : "smooth" });
}

export function SourcesPanel({
  bundle,
  facts,
  template,
  activeSourceId,
  requestSeq,
  citedBy,
  onJump,
  questionLabel,
}: {
  bundle: EpisodeBundle;
  facts: ComputedFact[];
  template: ReportTemplate | null;
  activeSourceId: string | null;
  /** Bumped on every chip click, so a source already highlighted is scrolled to again. */
  requestSeq: number;
  /** Source ID → question keys citing it. */
  citedBy: Map<string, string[]>;
  onJump(key: string): void;
  questionLabel(key: string): string;
}) {
  const [query, setQuery] = useState("");
  const notes = useMemo(() => [...bundle.notes].sort(compareIsoDateTime), [bundle.notes]);
  const excluded = useMemo(
    () => new Set((template?.scope.excludeFields ?? []).map((f) => SCOPED_KEYS[f]).filter(Boolean)),
    [template],
  );
  const q = query.trim().toLowerCase();
  const shown = q.length >= 2 ? notes.filter((n) => `${n.id} ${n.author.name} ${noteText(n)}`.toLowerCase().includes(q)) : notes;
  const listRef = useRef<HTMLDivElement | null>(null);

  // Scroll the highlighted source into view.
  useEffect(() => {
    if (!activeSourceId) return;
    if (q && !shown.some((n) => n.id === activeSourceId)) setQuery("");
    const el = listRef.current?.querySelector<HTMLElement>(`[data-source-id="${CSS.escape(activeSourceId)}"]`);
    if (el) {
      scrollWithinPanel(el);
      el.focus({ preventScroll: true });
    }
    // Only when a source is requested.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSourceId, requestSeq]);

  const citedByList = (id: string) => {
    const keys = citedBy.get(id) ?? [];
    if (keys.length === 0) return <p className="text-[11px] text-slate-500">Not cited by any answer.</p>;
    return (
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-[11px] text-slate-500">Cited by:</span>
        {keys.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => onJump(k)}
            title={questionLabel(k)}
            className="rounded px-1 font-mono text-[11px] text-teal-800 underline-offset-2 hover:bg-teal-50 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D9488]"
          >
            {k}
          </button>
        ))}
      </div>
    );
  };

  const cardClass = (id: string) =>
    cn(
      "scroll-mt-2 rounded-xl border bg-white p-3 outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-[#0D9488]",
      activeSourceId === id ? "border-[#0D9488] ring-2 ring-teal-500/30" : "border-slate-200",
    );

  const reg = bundle.registration;
  return (
    <div ref={listRef} className="space-y-4">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
        <label htmlFor="source-search" className="sr-only">
          Search the notes
        </label>
        <input
          id="source-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the notes, e.g. headache"
          className="h-9 w-full rounded-lg border border-slate-300 bg-white pl-8 pr-3 text-sm placeholder:text-slate-400 focus:border-[#0D9488] focus:outline-none focus:ring-2 focus:ring-teal-600/20"
        />
      </div>

      <section aria-labelledby="src-notes" className="space-y-2">
        <h3 id="src-notes" className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <StickyNote className="h-3.5 w-3.5" aria-hidden /> Clinical notes ({shown.length}
          {q.length >= 2 ? ` of ${notes.length}` : ""})
        </h3>
        {shown.length === 0 && <p className="rounded-lg bg-slate-50 px-3 py-2 text-[13px] text-slate-600">No note mentions “{query.trim()}”.</p>}
        {shown.map((note) => (
          <article key={note.id} data-source-id={note.id} tabIndex={-1} aria-label={`Note ${note.id}, ${formatUkDate(note.date)}`} className={cardClass(note.id)}>
            <header className="flex flex-wrap items-baseline justify-between gap-x-2">
              <p className="text-[13px] font-semibold text-slate-900">
                <span className="font-mono text-[12px] text-teal-800">{note.id}</span> · {formatUkDate(note.date)}
                {note.time ? ` ${note.time}` : ""}
              </p>
              <p className="text-[11px] text-slate-500">{NOTE_TYPE_LABELS[note.type]}</p>
            </header>
            <p className="text-[12px] text-slate-600">
              {note.author.name}
              {note.author.role ? `, ${note.author.role}` : ""} · HCPC {note.author.hcpc}
            </p>
            <dl className="mt-2 space-y-1.5 text-[13px] leading-relaxed">
              {SOAP.map((s) => {
                const value = note[s.key];
                if (typeof value !== "string" || !value.trim()) return null;
                const out = excluded.has(s.key);
                return (
                  <div key={s.key} className={cn(out && "rounded-md bg-slate-50 px-2 py-1 text-slate-500")}>
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      {s.label}
                      {out && <span className="ml-1 font-normal normal-case tracking-normal">{WORDING.byCode.outOfScope}</span>}
                    </dt>
                    <dd className="text-slate-800">
                      <Highlight text={value} query={query} />
                    </dd>
                  </div>
                );
              })}
            </dl>
            <div className="mt-2">
              {citedByList(note.id)}
            </div>
          </article>
        ))}
      </section>

      {facts.length > 0 && (
        <section aria-labelledby="src-facts" className="space-y-2">
          <h3 id="src-facts" className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <Calculator className="h-3.5 w-3.5" aria-hidden /> {WORDING.byCode.computedHeading}
          </h3>
          {facts.map((f) => (
            <article key={f.id} data-source-id={f.id} tabIndex={-1} aria-label={`${f.id}: ${f.label}`} className={cardClass(f.id)}>
              <p className="font-mono text-[12px] text-teal-800">{f.id}</p>
              <p className="text-[13px] font-medium text-slate-900">
                {f.label}: {f.value}
              </p>
              {f.detail && <p className="mt-0.5 text-[12px] leading-relaxed text-slate-600">{f.detail}</p>}
              <div className="mt-1.5">
                {citedByList(f.id)}
              </div>
            </article>
          ))}
        </section>
      )}

      <section aria-labelledby="src-reg" className="space-y-2">
        <h3 id="src-reg" className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <Contact className="h-3.5 w-3.5" aria-hidden /> Registration and referral
        </h3>
        <article data-source-id="REG" tabIndex={-1} aria-label="REG: registration details" className={cardClass("REG")}>
          <p className="font-mono text-[12px] text-teal-800">REG</p>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[13px]">
            <dt className="text-slate-500">Name</dt>
            <dd className="text-slate-900">{reg.fullName}</dd>
            <dt className="text-slate-500">Date of birth</dt>
            <dd className="text-slate-900">{formatUkDate(reg.dob)}</dd>
            {reg.occupation && (
              <>
                <dt className="text-slate-500">Occupation</dt>
                <dd className="text-slate-900">{reg.occupation}</dd>
              </>
            )}
            {reg.employer && (
              <>
                <dt className="text-slate-500">Employer</dt>
                <dd className="text-slate-900">{reg.employer}</dd>
              </>
            )}
            <dt className="text-slate-500">Referrer</dt>
            <dd className="text-slate-900">
              {bundle.referral.name} ({INSTRUCTING_PARTY_LABELS[bundle.referral.type].toLowerCase()})
              {bundle.referral.reference ? `, ref. ${bundle.referral.reference}` : ""}
            </dd>
            {bundle.incident?.date && (
              <>
                <dt className="text-slate-500">Incident</dt>
                <dd className="text-slate-900">{formatUkDate(bundle.incident.date)}</dd>
              </>
            )}
          </dl>
          <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-500">
            <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0 text-teal-700" aria-hidden />
            {WORDING.byCode.identifiersNotice}
          </p>
          <div className="mt-1.5">
            {citedByList("REG")}
          </div>
        </article>
      </section>

      <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-500">{NOTICES.dataMinimisation}</p>
    </div>
  );
}
