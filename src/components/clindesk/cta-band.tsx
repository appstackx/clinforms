import type { ReactNode } from "react";
import { CLINIC_SYSTEM_NAME } from "@/lib/brand";
import { CONTACT_EMAIL } from "@/lib/clindesk/site";
import { AppointmentCard, type AppointmentRows } from "./appointment-card";
import { Fill } from "./fill";

/** The default price line under the closing call to action ("From … · Reports is an add-on · See pricing"). */
export function FromPriceLine() {
  return (
    <p className="cta-price">
      From <Fill k="pricing.fromPrice" /> · Reports is an add-on ·{" "}
      <a className="link" href="/pricing">
        See pricing <span className="arr" aria-hidden="true">→</span>
      </a>
    </p>
  );
}

/**
 * The closing call to action on the coral band: a title, one line (long and phone versions), the "Questions first?"
 * line, page-specific extra lines (default: the from-price line) and the appointment card with its button.
 * A free trial link goes in `extra` only once a free trial is confirmed (design: TrialLink slot).
 */
export function CtaBand({
  title,
  line,
  lineShort,
  extra = <FromPriceLine />,
  rows,
  button = "Book a demo",
}: {
  title: string;
  line: ReactNode;
  lineShort?: ReactNode;
  extra?: ReactNode;
  rows?: AppointmentRows;
  button?: string;
}) {
  return (
    <section className="cta g-coral" aria-labelledby="cta-title">
      <div className="wrap grid12 cta-inner">
        <div className="cta-text">
          <h2 className="display-xl" id="cta-title">
            {title}
          </h2>
          <p className="cta-line">
            {lineShort ? (
              <>
                <span className="t-long">{line}</span>
                <span className="t-short">{lineShort}</span>
              </>
            ) : (
              line
            )}
          </p>
          <p className="cta-q">
            Questions first? Email{" "}
            <a className="link" href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>{" "}
            – a real person reads every one.
          </p>
          {extra}
        </div>
        <div className="cta-card">
          <AppointmentCard rows={rows}>
            <a className="btn btn-pine appt-btn" href="/demo">
              {button} <span className="arr" aria-hidden="true">→</span>
            </a>
          </AppointmentCard>
        </div>
      </div>
    </section>
  );
}

/** The design's default closing call to action (Home, Features). */
export function DefaultCtaBand() {
  return (
    <CtaBand
      title="Bring us your busiest Tuesday"
      line={<>We’ll show you {CLINIC_SYSTEM_NAME} running your sites, your rooms and the report form you dread. Online, at a time that suits you.</>}
      lineShort={<>We’ll show you {CLINIC_SYSTEM_NAME} running your sites and the report form you dread.</>}
    />
  );
}
