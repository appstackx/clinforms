"use client";

/**
 * The "Book a demo" form card (design: Site-Demo, .d-form-card) on the server action bookDemoAction. Without
 * JavaScript it is an ordinary form post: the server answers with /demo/thanks, or with this page and the messages.
 * With JavaScript the same action runs in place. Every field is checked again on the server
 * (src/server/site/demo-request.ts); the browser's own required/type checks are only a first hint.
 *
 * Errors: a summary at the top (focused, links to each field) and a message under each field (aria-describedby,
 * aria-invalid). Fields keep what was typed. Added to the design: "Number of practitioners" (optional) and the
 * hidden honeypot field.
 */
import { useEffect, useRef } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { bookDemoAction } from "@/app/clindesk-site/demo/actions";
import { INITIAL_DEMO_FORM_STATE, type DemoFormState } from "@/app/clindesk-site/demo/form-state";
import { DEMO_INTERESTS, DEMO_SITE_BANDS } from "@/lib/clindesk/demo-options";

const FIELD_IDS: Record<string, string> = {
  name: "f-name",
  clinic: "f-clinic",
  email: "f-email",
  phone: "f-phone",
  sites: "f-sites",
  practitioners: "f-practitioners",
  current_system: "f-system",
  see: "f-see-diary",
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="btn btn-coral d-submit" type="submit" aria-disabled={pending || undefined}>
      {pending ? "Sending…" : "Book my demo"} <span className="arr" aria-hidden="true">→</span>
    </button>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <span className="d-field-error" id={`${id}-error`}>
      {message}
    </span>
  );
}

/** aria props for a field: its hint (if any) and its error message. */
function describe(id: string, error: string | undefined, hint?: string) {
  const ids = [hint, error ? `${id}-error` : null].filter(Boolean).join(" ");
  return { "aria-describedby": ids || undefined, "aria-invalid": error ? (true as const) : undefined };
}

export function DemoForm() {
  const [state, action] = useFormState<DemoFormState, FormData>(bookDemoAction, INITIAL_DEMO_FORM_STATE);
  const summaryRef = useRef<HTMLDivElement>(null);
  const e = state.fieldErrors;
  const v = state.values;
  const seen = new Set((v.see ?? "").split(",").filter(Boolean));

  useEffect(() => {
    if (state.status !== "idle") summaryRef.current?.focus();
  }, [state]);

  const errorEntries = Object.entries(e).filter(([k]) => k !== "website");

  return (
    <div className="d-form-card">
      <h2 className="display-m" id="form-title">
        Tell us about your clinic
      </h2>
      <p className="small d-form-note">Fields marked (required) need an answer.</p>
      <form className="d-form" action={action} aria-labelledby="form-title">
        {state.status !== "idle" ? (
          <div className="d-error-summary" ref={summaryRef} tabIndex={-1} role="alert" aria-labelledby="form-errors-title">
            <p className="d-error-title" id="form-errors-title">
              {state.message}
            </p>
            {errorEntries.length ? (
              <ul>
                {errorEntries.map(([field, message]) => (
                  <li key={field}>
                    {FIELD_IDS[field] ? (
                      <a className="link" href={`#${FIELD_IDS[field]}`}>
                        {message}
                      </a>
                    ) : (
                      message
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        <div className="d-fields" key={state.attempt}>
          <div className="d-row">
            <div className="d-field">
              <label htmlFor="f-name">
                Your name <span className="req">(required)</span>
              </label>
              <input id="f-name" name="name" type="text" autoComplete="name" required maxLength={200} defaultValue={v.name} {...describe("f-name", e.name)} />
              <FieldError id="f-name" message={e.name} />
            </div>
            <div className="d-field">
              <label htmlFor="f-clinic">
                Clinic or group name <span className="req">(required)</span>
              </label>
              <input id="f-clinic" name="clinic" type="text" autoComplete="organization" required maxLength={200} defaultValue={v.clinic} {...describe("f-clinic", e.clinic)} />
              <FieldError id="f-clinic" message={e.clinic} />
            </div>
          </div>
          <div className="d-row">
            <div className="d-field">
              <label htmlFor="f-email">
                Work email <span className="req">(required)</span>
              </label>
              <input id="f-email" name="email" type="email" autoComplete="email" required maxLength={254} defaultValue={v.email} {...describe("f-email", e.email)} />
              <FieldError id="f-email" message={e.email} />
            </div>
            <div className="d-field">
              <label htmlFor="f-phone">
                Phone <span className="opt">(optional)</span>
              </label>
              <input id="f-phone" name="phone" type="tel" autoComplete="tel" maxLength={40} defaultValue={v.phone} {...describe("f-phone", e.phone)} />
              <FieldError id="f-phone" message={e.phone} />
            </div>
          </div>
          <div className="d-row">
            <div className="d-field d-field--sites">
              <label htmlFor="f-sites">
                Number of sites <span className="req">(required)</span>
              </label>
              <span className="d-select">
                <select id="f-sites" name="sites" required defaultValue={v.sites ?? ""} {...describe("f-sites", e.sites)}>
                  <option value="">Choose</option>
                  {DEMO_SITE_BANDS.map((band) => (
                    <option key={band} value={band}>
                      {band}
                    </option>
                  ))}
                </select>
              </span>
              <FieldError id="f-sites" message={e.sites} />
            </div>
            <div className="d-field">
              <label htmlFor="f-practitioners">
                Number of practitioners <span className="opt">(optional)</span>
              </label>
              <input
                id="f-practitioners"
                name="practitioners"
                type="number"
                inputMode="numeric"
                min={1}
                max={999}
                step={1}
                defaultValue={v.practitioners}
                {...describe("f-practitioners", e.practitioners)}
              />
              <FieldError id="f-practitioners" message={e.practitioners} />
            </div>
          </div>
          <div className="d-field">
            <label htmlFor="f-system">
              Your current system <span className="opt">(optional)</span>
            </label>
            <input id="f-system" name="current_system" type="text" maxLength={120} defaultValue={v.current_system} {...describe("f-system", e.current_system, "f-system-hint")} />
            <span className="d-hint" id="f-system-hint">
              The practice system you use now, if any.
            </span>
            <FieldError id="f-system" message={e.current_system} />
          </div>
          <fieldset className="d-checks" aria-describedby={e.see ? "f-see-error" : undefined}>
            <legend>
              What would you like to see? <span className="opt">(optional)</span>
            </legend>
            <div className="d-check-grid">
              {Object.entries(DEMO_INTERESTS).map(([id, label]) => (
                <label className="d-check" key={id}>
                  <input id={`f-see-${id}`} type="checkbox" name="see" value={id} defaultChecked={seen.has(id)} />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            <FieldError id="f-see" message={e.see} />
          </fieldset>
          <div className="d-hp" aria-hidden="true">
            <label htmlFor="f-website">Website (leave this empty)</label>
            <input id="f-website" name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
          </div>
        </div>
        <p className="small d-consent">
          We’ll only use these details to arrange your demo. See our{" "}
          <a className="link" href="/privacy">
            privacy notice
          </a>
          .
        </p>
        <SubmitButton />
      </form>
    </div>
  );
}
