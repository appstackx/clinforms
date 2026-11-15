/**
 * Decorative product scene for the landing page hero, in the site's product and paper-form layers (ClinDesk's design
 * system, styles/site.css: .product, .doc, .p-chip, .need, .frag, .ftag): a referrer's own form with
 * answers that cite their source notes, one gap left for the clinician, and the approval. Hidden from assistive
 * technology – the surrounding text says the same thing. Fictional sample data.
 */
export function HeroIllustration() {
  return (
    <div aria-hidden className="cf-scene">
      <span className="tape tape--teal cf-scene-tape" />
      <div className="product panel cf-form">
        <div className="doc cf-form-head">
          <p className="doc-org">Referrer&rsquo;s own form</p>
          <p className="doc-title">Treating physiotherapist report</p>
          <p className="doc-meta">Original layout · Word or PDF</p>
        </div>
        <dl className="cf-form-rows">
          <Row q="1. Date of first assessment" a="02/09/2026" source="Registration" />
          <Row q="2. Presenting symptoms" bars={[100, 92, 66]} source="N-001 · N-003" />
          <Row q="3. Treatment provided to date" bars={[100, 80]} source="N-004 · N-007 · N-011" />
          <div className="cf-form-row">
            <dt className="doc">4. Expected return to full duties</dt>
            <dd>
              <span className="need">Not recorded in the notes – for the clinician to complete</span>
            </dd>
          </div>
        </dl>
        <div className="cf-form-foot">
          <span className="lock">
            <svg viewBox="0 0 12 12">
              <path d="M2.5 6.5 L5 9 L9.5 3.5" />
            </svg>
            Reviewed and approved
          </span>
          <span className="p-muted">Treating physiotherapist</span>
        </div>
      </div>
      <div className="product frag cf-frag-source">
        <b>Source: N-007</b>
        <span className="p-muted">Treatment note, 23/09/2026</span>
      </div>
      <div className="product frag cf-frag-progress">
        <b>11 of 12 answers from the notes</b>
        <span className="p-muted">1 left for the clinician</span>
      </div>
      <span className="ftag cf-scene-tag">Sample data (fictional)</span>
    </div>
  );
}

function Row({ q, a, bars, source }: { q: string; a?: string; bars?: number[]; source: string }) {
  return (
    <div className="cf-form-row">
      <dt className="doc">{q}</dt>
      <dd>
        {a ? <span className="cf-answer">{a}</span> : null}
        <span className="p-chip">
          <svg viewBox="0 0 12 12">
            <path d="M4.5 7.5 L7.5 4.5 M5 3.2 L6 2.2 a2.1 2.1 0 0 1 3 3 L8 6.2 M7 8.8 L6 9.8 a2.1 2.1 0 0 1 -3 -3 L4 5.8" />
          </svg>
          {source}
        </span>
        {bars ? (
          <span className="cf-bars">
            {bars.map((w, i) => (
              <i key={i} style={{ width: `${w}%` }} />
            ))}
          </span>
        ) : null}
      </dd>
    </div>
  );
}
