"use client";

/**
 * The "Request access" form → POST /api/access-requests. Labels above every field, errors tied to
 * their fields (aria-describedby), a hidden honeypot field, and a thank-you state on success.
 */
import { useId, useRef, useState, type FormEvent } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { track } from "@/components/analytics/posthog";
import { btn } from "@/components/marketing/nav";
import type { AnalyticsProps } from "@/components/analytics/events";

const SITES = [
  { value: "1", label: "1 site" },
  { value: "2-5", label: "2–5 sites" },
  { value: "6-10", label: "6–10 sites" },
  { value: "11+", label: "11 or more sites" },
] as const;

type FieldName = "clinicName" | "contactName" | "email" | "phone" | "sites" | "message";
type Status = { kind: "idle" } | { kind: "sending" } | { kind: "sent" } | { kind: "error"; message: string };

/** Quick checks before sending (the server validates again and has the final say). */
function validate(body: Record<FieldName, string>): Partial<Record<FieldName, string>> {
  const errors: Partial<Record<FieldName, string>> = {};
  if (body.clinicName.trim().length < 2) errors.clinicName = "Clinic name is required.";
  if (body.contactName.trim().length < 2) errors.contactName = "Your name is required.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(body.email.trim())) errors.email = "Enter a valid work email address.";
  if (!/^[0-9+()\-.\s]*$/.test(body.phone)) errors.phone = "Phone may contain only digits, spaces and + ( ) - .";
  if (!SITES.some((s) => s.value === body.sites)) errors.sites = "Choose the number of sites.";
  if (body.message.length > 2000) errors.message = "Message must be at most 2,000 characters.";
  return errors;
}

const inputClass =
  "mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-[15px] text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/30 aria-[invalid=true]:border-red-500";

export function RequestAccessForm() {
  const baseId = useId();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const formRef = useRef<HTMLFormElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const id = (name: string) => `${baseId}-${name}`;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status.kind === "sending") return;
    const data = new FormData(event.currentTarget);
    const body = {
      clinicName: String(data.get("clinicName") ?? ""),
      contactName: String(data.get("contactName") ?? ""),
      email: String(data.get("email") ?? ""),
      phone: String(data.get("phone") ?? ""),
      sites: String(data.get("sites") ?? ""),
      message: String(data.get("message") ?? ""),
      website: String(data.get("website") ?? ""),
    };
    const local = validate(body);
    if (Object.keys(local).length > 0) {
      setErrors(local);
      setStatus({ kind: "error", message: "Please check the highlighted fields." });
      const first = Object.keys(local)[0];
      requestAnimationFrame(() => (formRef.current?.elements.namedItem(first) as HTMLElement | null)?.focus?.());
      return;
    }
    setStatus({ kind: "sending" });
    setErrors({});
    try {
      const res = await fetch("/api/access-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; fieldErrors?: Record<string, string> };
      if (res.ok && payload.ok) {
        track("request_access_submitted", { area: "marketing", sites: body.sites as AnalyticsProps["sites"] });
        setStatus({ kind: "sent" });
        requestAnimationFrame(() => statusRef.current?.focus());
        return;
      }
      if (res.status === 422 && payload.fieldErrors) {
        setErrors(payload.fieldErrors as Partial<Record<FieldName, string>>);
        setStatus({ kind: "error", message: payload.error ?? "Please check the highlighted fields." });
        const first = Object.keys(payload.fieldErrors)[0];
        requestAnimationFrame(() => (formRef.current?.elements.namedItem(first) as HTMLElement | null)?.focus?.());
        return;
      }
      setStatus({ kind: "error", message: payload.error ?? "Something went wrong. Please try again, or email us." });
    } catch {
      setStatus({ kind: "error", message: "We could not reach the server. Check your connection and try again." });
    }
  }

  if (status.kind === "sent") {
    return (
      <div
        ref={statusRef}
        tabIndex={-1}
        role="status"
        className="h-fit rounded-2xl border border-teal-200 bg-white p-8 text-center shadow-sm focus:outline-none"
      >
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-teal-50">
          <CheckCircle2 className="h-6 w-6 text-teal-700" aria-hidden />
        </span>
        <h2 className="mt-4 text-xl font-semibold text-slate-900">Thank you – we have your request</h2>
        <p className="mt-2 text-slate-600">We will reply by email to the address you gave us.</p>
      </div>
    );
  }

  const fieldProps = (name: FieldName) => ({
    id: id(name),
    name,
    "aria-invalid": errors[name] ? true : undefined,
    "aria-describedby": errors[name] ? id(`${name}-error`) : undefined,
  });
  const fieldError = (name: FieldName) =>
    errors[name] ? (
      <p id={id(`${name}-error`)} className="mt-1.5 text-sm text-red-700">
        {errors[name]}
      </p>
    ) : null;

  return (
    <form
      ref={formRef}
      onSubmit={onSubmit}
      noValidate
      aria-describedby={id("phi-note")}
      className="h-fit rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor={id("clinicName")} className="text-sm font-medium text-slate-900">
            Clinic name
          </label>
          <input {...fieldProps("clinicName")} type="text" autoComplete="organization" required maxLength={200} className={inputClass} />
          {fieldError("clinicName")}
        </div>
        <div>
          <label htmlFor={id("contactName")} className="text-sm font-medium text-slate-900">
            Your name
          </label>
          <input {...fieldProps("contactName")} type="text" autoComplete="name" required maxLength={200} className={inputClass} />
          {fieldError("contactName")}
        </div>
        <div>
          <label htmlFor={id("email")} className="text-sm font-medium text-slate-900">
            Work email
          </label>
          <input {...fieldProps("email")} type="email" autoComplete="email" required maxLength={254} className={inputClass} />
          {fieldError("email")}
        </div>
        <div>
          <label htmlFor={id("phone")} className="text-sm font-medium text-slate-900">
            Phone <span className="font-normal text-slate-500">(optional)</span>
          </label>
          <input {...fieldProps("phone")} type="tel" autoComplete="tel" maxLength={40} className={inputClass} />
          {fieldError("phone")}
        </div>
        <div>
          <label htmlFor={id("sites")} className="text-sm font-medium text-slate-900">
            Number of sites
          </label>
          <select {...fieldProps("sites")} required defaultValue="" className={inputClass}>
            <option value="" disabled>
              Choose…
            </option>
            {SITES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          {fieldError("sites")}
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={id("message")} className="text-sm font-medium text-slate-900">
            Message <span className="font-normal text-slate-500">(optional)</span>
          </label>
          <textarea
            {...fieldProps("message")}
            rows={4}
            maxLength={2000}
            placeholder="Which referrers send you forms most often? Anything else we should know?"
            className={inputClass}
          />
          {fieldError("message")}
        </div>
        {/* Honeypot: invisible to people and to assistive technology; automated submissions fill it in. */}
        <div aria-hidden className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden">
          <label htmlFor={id("website")}>Leave this field empty</label>
          <input id={id("website")} name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
        </div>
      </div>

      <p id={id("phi-note")} className="mt-5 rounded-lg bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900">
        Please do not include any patient information in this form.
      </p>

      {status.kind === "error" ? (
        <p role="alert" className="mt-4 text-sm font-medium text-red-700">
          {status.message}
        </p>
      ) : null}

      <button type="submit" disabled={status.kind === "sending"} className={`${btn.primary} mt-6 w-full disabled:cursor-wait disabled:opacity-70`}>
        {status.kind === "sending" ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Sending…
          </>
        ) : (
          "Request access"
        )}
      </button>
    </form>
  );
}
