import { Fill } from "./fill";
import { START_TRIAL_HREF, START_TRIAL_LABEL, clindeskTrialOffered, clindeskTrialSummary } from "@/lib/clindesk/trial-cta";

/** "Start free trial" – only while self sign-up is on for ClinDesk (src/lib/clindesk/trial-cta.ts); otherwise nothing. */
export function StartTrialButton({ className = "btn btn-outline", arrow = true }: { className?: string; arrow?: boolean }) {
  if (!clindeskTrialOffered()) return null;
  return (
    <>
      {" "}
      <a className={className} href={START_TRIAL_HREF} data-cta="start_trial">
        {START_TRIAL_LABEL}
        {arrow ? (
          <>
            {" "}
            <span className="arr" aria-hidden="true">
              →
            </span>
          </>
        ) : null}
      </a>
    </>
  );
}

/** The pricing page's trial sentence: "14-day free trial, no card needed" while the trial is offered, else the content file's. */
export function TrialSummary() {
  if (!clindeskTrialOffered()) return <Fill k="pricing.trialSummary" />;
  return <>{clindeskTrialSummary().text}</>;
}
