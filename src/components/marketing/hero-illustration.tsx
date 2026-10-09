/**
 * Decorative product illustration for the landing page hero: a referrer's form with answers that cite
 * their source notes, one gap left for the clinician, and the approval stamp. Pure markup (no images),
 * hidden from assistive technology – the surrounding text says the same thing.
 */
export function HeroIllustration() {
  return (
    <div aria-hidden className="relative mx-auto w-full max-w-md select-none lg:max-w-none">
      <div className="absolute -inset-4 -z-10 rounded-[2rem] bg-gradient-to-br from-teal-100 via-white to-sky-100 blur-2xl" />
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xl shadow-slate-900/5 sm:p-6">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Referrer&rsquo;s own form</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">Treating physiotherapist report</p>
          </div>
          <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-600">Original layout</span>
        </div>

        <dl className="mt-4 space-y-4 text-[13px]">
          <Row q="1. Date of first assessment" a="02/09/2026" source="Registration" />
          <Row q="2. Presenting symptoms" lines={["w-full", "w-11/12", "w-2/3"]} source="N-001 · N-003" />
          <Row
            q="3. Treatment provided to date"
            lines={["w-full", "w-4/5"]}
            source="N-004 · N-007 · N-011"
            note={{ title: "Source: N-007", detail: "Treatment note, 23/09/2026" }}
          />
          <div>
            <dt className="font-medium text-slate-800">4. Expected return to full duties</dt>
            <dd className="mt-1.5 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2 text-[12px] text-amber-900">
              <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-amber-500" />
              Not recorded in the notes – for the clinician to complete
            </dd>
          </div>
        </dl>

        <div className="mt-5 flex items-center justify-between gap-3 rounded-xl bg-teal-50 px-3.5 py-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-teal-700 text-white">
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 10.5l3.2 3.2L15 7" />
              </svg>
            </span>
            <div>
              <p className="text-[12px] font-semibold text-teal-900">Reviewed and approved</p>
              <p className="text-[11px] text-teal-800">Treating physiotherapist</p>
            </div>
          </div>
          <span className="rounded-md bg-white px-2 py-1 text-[11px] font-medium text-slate-700 shadow-sm">Word · PDF</span>
        </div>
      </div>

    </div>
  );
}

function Row({ q, a, lines, source, note }: { q: string; a?: string; lines?: string[]; source: string; note?: { title: string; detail: string } }) {
  return (
    <div>
      <dt className="font-medium text-slate-800">{q}</dt>
      <dd className="relative mt-1.5 flex items-start justify-between gap-3">
        {note ? (
          // The cited note, opened from this answer's source tag (anchored to the row, so it never covers another answer's source).
          <span className="absolute -right-3 top-7 z-10 hidden rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] shadow-lg sm:block lg:-right-8">
            <span className="block font-semibold text-slate-900">{note.title}</span>
            <span className="block text-slate-600">{note.detail}</span>
          </span>
        ) : null}
        {a ? (
          <span className="text-slate-700">{a}</span>
        ) : (
          <span className="flex flex-1 flex-col gap-1.5 pt-1">
            {(lines ?? []).map((w, i) => (
              <span key={i} className={`block h-2 rounded-full bg-slate-200 ${w}`} />
            ))}
          </span>
        )}
        <span className="shrink-0 rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-800">{source}</span>
      </dd>
    </div>
  );
}
