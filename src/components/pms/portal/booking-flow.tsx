"use client";

/**
 * The patient's booking flow (design round 2g "Online booking", 6 steps; round 2h Prototype B): where → what → who →
 * when → your details → check and confirm → booked. Also the portal's own booking (no details step) and moving an
 * appointment (who → when → confirm). Built for a phone (375 px): one column, a large button at the bottom.
 *
 * Distance ("0.8 miles") appears ONLY after the patient taps "Use my location" or types a postcode, and is worked out
 * here in the browser from the sites' map positions – the patient's position is never sent or stored.
 */
import { districtCentre, loadDistrictCentres, ONS_ATTRIBUTION, postcodeDistrict } from "@/modules/pms/portal/postcode-districts";
import * as React from "react";
import Link from "next/link";
import { Check, ChevronLeft, Clock, Crosshair, MapPin, Search } from "lucide-react";
import { PmsButton } from "@/components/pms/ui";
import { formatMiles, milesBetween, type LatLng } from "@/modules/pms/portal/distance";
import { formatDayDate, formatUkTime, formatWhen } from "@/modules/pms/portal/time";
import { BOOKING_DETAIL_FIELDS, bookingDetailsErrors } from "@/modules/pms/portal/schemas";
import type { BookResultView, FlowData, FlowDay, FlowSite, SlotsAnswer } from "@/modules/pms/portal/flow-types";

export type { BookResultView };

type Step = "site" | "service" | "prac" | "time" | "details" | "confirm" | "done";

type BookAnswer = BookResultView | { ok: false; error: string; fieldErrors?: Record<string, string>; slotGone?: boolean };

export interface BookingFlowProps {
  mode: "public" | "closed_to_new" | "portal" | "move";
  clinicId: string;
  data: FlowData;
  portalPath: string;
  loadSlots: (clinicId: string, input: { siteId: string; serviceId: string; practitionerId: string; fromDate: string }) => Promise<SlotsAnswer>;
  book: (clinicId: string, input: Record<string, unknown>) => Promise<BookAnswer>;
  /** Move mode: the appointment being moved (its site and type stay). */
  fixed?: { siteId: string; serviceId: string; label: string };
  /** Portal and move modes: where "Back" from the first step goes, and where to go when done. */
  homeHref?: string;
}

const STEP_NAMES: Record<Step, string> = { site: "Clinic", service: "Service", prac: "Practitioner", time: "Time", details: "Your details", confirm: "Confirm", done: "Booked" };

function stepsFor(mode: BookingFlowProps["mode"]): Step[] {
  if (mode === "move") return ["prac", "time", "confirm", "done"];
  if (mode === "portal") return ["site", "service", "prac", "time", "confirm", "done"];
  return ["site", "service", "prac", "time", "details", "confirm", "done"];
}

const cardBtn =
  "flex w-full items-center gap-3 rounded-[12px] border bg-white p-4 text-left transition-colors hover:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
}

function nextLabel(iso: string | null, today: string): string {
  if (!iso) return "No times in the next two weeks";
  const day = formatDayDate(iso);
  const isToday = day.endsWith(today.split("-").reverse().join("/"));
  return `Next: ${isToday ? "today" : day.slice(0, 3)} ${formatUkTime(iso)}`;
}

/** A calendar file for "Add to calendar" (made here; nothing is sent). */
function icsHref(r: BookResultView, clinicName: string): string {
  const stamp = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//clinic//booking//EN",
    "BEGIN:VEVENT",
    `UID:${r.reference}@clinic`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(r.startsAt)}`,
    `DTEND:${stamp(r.endsAt)}`,
    `SUMMARY:${r.service} – ${clinicName}`.replace(/[,;]/g, " "),
    `LOCATION:${r.site}`.replace(/[,;]/g, " "),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(lines.join("\r\n"))}`;
}

export function BookingFlow({ mode, clinicId, data, portalPath, loadSlots, book, fixed, homeHref }: BookingFlowProps) {
  const steps = stepsFor(mode);
  const [step, setStep] = React.useState<Step>(steps[0]);
  const [siteId, setSiteId] = React.useState<string | null>(fixed?.siteId ?? null);
  const [serviceId, setServiceId] = React.useState<string | null>(fixed?.serviceId ?? null);
  const [pracId, setPracId] = React.useState<string | null>(null);
  const [slot, setSlot] = React.useState<{ startsAt: string; practitionerId: string } | null>(null);
  const [fromDate, setFromDate] = React.useState(data.today);
  const [week, setWeek] = React.useState<{ days: FlowDay[]; nextFrom: string | null } | null>(null);
  const [day, setDay] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [details, setDetails] = React.useState({ firstName: "", lastName: "", dateOfBirth: "", phoneMobile: "", email: "", paying: "self", reminders: true, website: "" });
  const [done, setDone] = React.useState<BookResultView | null>(null);
  const [origin, setOrigin] = React.useState<LatLng | null>(null);
  const [locating, setLocating] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [placeNote, setPlaceNote] = React.useState<string | null>(null);
  const headingRef = React.useRef<HTMLHeadingElement>(null);

  const site = data.sites.find((s) => s.id === siteId) ?? null;
  const service = data.services.find((s) => s.id === serviceId) ?? null;
  const pracs = siteId ? (data.practitioners[siteId] ?? []) : [];
  const chosenPrac = pracs.find((p) => p.id === (slot?.practitionerId ?? pracId)) ?? null;
  const stepIndex = steps.indexOf(step);
  const counted = steps.filter((s) => s !== "done");

  React.useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  const go = (s: Step) => {
    setError(null);
    setStep(s);
  };
  const back = () => {
    if (stepIndex > 0 && step !== "done") go(steps[stepIndex - 1]);
  };

  const fetchWeek = React.useCallback(
    async (from: string, prac: string) => {
      if (!siteId || !serviceId) return;
      setLoading(true);
      setError(null);
      const r = await loadSlots(clinicId, { siteId, serviceId, practitionerId: prac, fromDate: from });
      setLoading(false);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setFromDate(r.fromDate);
      setWeek({ days: r.days, nextFrom: r.nextFrom });
      setDay(r.days[0]?.date ?? null);
    },
    [clinicId, loadSlots, serviceId, siteId],
  );

  const choosePrac = (id: string) => {
    setPracId(id);
    setSlot(null);
    setWeek(null);
    go("time");
    void fetchWeek(data.today, id);
  };

  // "Use my location": the browser's own position, used here only.
  const useLocation = () => {
    if (!("geolocation" in navigator)) {
      setPlaceNote("This browser cannot share its location. Type your postcode instead.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setOrigin({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        setPlaceNote("Distances are worked out on this device. Your location is not sent or stored.");
      },
      () => {
        setLocating(false);
        setPlaceNote("We could not get your location. Type your postcode instead.");
      },
      { maximumAge: 300_000, timeout: 10_000 },
    );
  };

  // A typed postcode: placed at its postcode district's centre from the bundled ONS list (Khuram, 28/10/2026 – a
  // small static file loaded from this site on first use; the postcode itself is never sent anywhere or stored).
  const placePostcode = (text: string) => {
    const outward = postcodeDistrict(text);
    if (!outward) return;
    void loadDistrictCentres().then((centres) => {
      const at = centres ? districtCentre(centres, outward) : null;
      const near = at ?? data.sites.find((s) => s.outward === outward && s.position)?.position ?? null;
      if (near) {
        setOrigin(near);
        setPlaceNote("Distances are worked out on this device from the middle of your postcode district. Nothing is sent or stored.");
      } else {
        setPlaceNote("We cannot place that postcode. Tap “Use my location” to see distances.");
      }
    });
  };

  const shownSites: (FlowSite & { miles: number | null })[] = data.sites
    .filter((s) => !query.trim() || /\d/.test(query) || `${s.name} ${s.address}`.toLowerCase().includes(query.trim().toLowerCase()))
    .map((s) => ({ ...s, miles: origin && s.position ? milesBetween(origin, s.position) : null }))
    .sort((a, b) => (a.miles === null || b.miles === null ? 0 : a.miles - b.miles));

  const submit = async () => {
    if (!slot || !siteId || !serviceId) return;
    setLoading(true);
    setError(null);
    setFieldErrors({});
    const practitionerId = pracId === "any" ? "any" : slot.practitionerId;
    const r = await book(clinicId, mode === "public" ? { siteId, serviceId, practitionerId, startsAt: slot.startsAt, ...details } : { siteId, serviceId, practitionerId, startsAt: slot.startsAt });
    setLoading(false);
    if (r.ok) {
      setDone(r);
      go("done");
      return;
    }
    setError(r.error);
    if (r.fieldErrors) {
      setFieldErrors(r.fieldErrors);
      go("details");
      const first = BOOKING_DETAIL_FIELDS.find((f) => r.fieldErrors?.[f]);
      if (first) window.setTimeout(() => document.getElementById(`bk-${first}`)?.focus(), 0);
    } else if (r.slotGone) {
      setSlot(null);
      go("time");
      if (pracId) void fetchWeek(fromDate, pracId);
    }
  };

  // Continue stays enabled: it says what is missing next to each field and moves focus to the first one (M10).
  const continueFromDetails = () => {
    const errs = bookingDetailsErrors(details, data.today);
    const first = BOOKING_DETAIL_FIELDS.find((f) => errs[f]);
    setFieldErrors(errs as Record<string, string>);
    if (!first) {
      setError(null);
      go("confirm");
      return;
    }
    window.setTimeout(() => document.getElementById(`bk-${first}`)?.focus(), 0);
  };
  const cta: Partial<Record<Step, { label: string; disabled: boolean; onClick: () => void }>> = {
    time: { label: "Continue", disabled: !slot, onClick: () => go(mode === "public" ? "details" : "confirm") },
    details: { label: "Continue", disabled: false, onClick: continueFromDetails },
    confirm: { label: mode === "move" ? "Move my appointment" : "Confirm booking", disabled: loading || !slot, onClick: () => void submit() },
  };
  const action = cta[step];

  if (mode === "closed_to_new") {
    return (
      <main className="px-4 pt-5">
        <h1 className="text-[22px] font-bold text-foreground">Book online</h1>
        <p className="mt-2 text-[15px] text-[#334155]">Online booking is for patients of the clinic. Sign in to your patient portal to book.</p>
        <Link href={portalPath} className="mt-4 inline-flex h-11 items-center rounded-[10px] bg-primary-strong px-4 text-[15px] font-semibold text-white">
          Go to the patient portal
        </Link>
      </main>
    );
  }

  const field = (name: keyof typeof details, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => {
    const id = `bk-${name}`;
    const err = fieldErrors[name];
    return (
      <div className="space-y-1.5">
        <label htmlFor={id} className="block text-[14px] font-medium text-foreground">
          {label}
        </label>
        <input
          id={id}
          name={name}
          value={String(details[name])}
          onChange={(e) => {
            const value = e.target.value;
            setDetails((d) => ({ ...d, [name]: value }));
            if (err) setFieldErrors(({ [name]: _gone, ...rest }) => rest);
          }}
          aria-invalid={err ? true : undefined}
          aria-describedby={err ? `${id}-err` : undefined}
          className="h-12 w-full rounded-[10px] border border-[#CBD5E1] bg-white px-3 text-[16px] text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
          {...props}
        />
        {err ? (
          <p id={`${id}-err`} className="text-[13px] text-destructive-strong">
            {err}
          </p>
        ) : null}
      </div>
    );
  };

  return (
    <>
      <div className="border-b border-border bg-white px-4 pb-3 pt-2">
        <div className="flex h-11 items-center">
          {stepIndex > 0 && step !== "done" ? (
            <button type="button" onClick={back} aria-label="Back" className="-ml-3 flex h-11 w-11 items-center justify-center rounded-[8px] text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
              <ChevronLeft className="h-[22px] w-[22px]" aria-hidden="true" />
            </button>
          ) : homeHref ? (
            <Link href={homeHref} aria-label="Back to my appointments" className="-ml-3 flex h-11 w-11 items-center justify-center rounded-[8px] text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
              <ChevronLeft className="h-[22px] w-[22px]" aria-hidden="true" />
            </Link>
          ) : null}
          {mode === "move" && fixed ? <span className="ml-1 truncate text-[13px] text-[#475569]">Moving: {fixed.label}</span> : null}
        </div>
        {step !== "done" ? (
          <div>
            <div className="flex justify-between text-[13px] text-[#334155]">
              <span>
                Step {stepIndex + 1} of {counted.length}
              </span>
              <span>{STEP_NAMES[step]}</span>
            </div>
            <div className="mt-1.5 h-1 rounded-full bg-[#E2E8F0]" role="progressbar" aria-label="Booking progress" aria-valuemin={1} aria-valuemax={counted.length} aria-valuenow={stepIndex + 1}>
              <div className="h-1 rounded-full bg-primary" style={{ width: `${((stepIndex + 1) / counted.length) * 100}%` }} />
            </div>
          </div>
        ) : null}
      </div>

      <main className="px-4 pb-32 pt-5">
        {error ? (
          <div role="alert" className="mb-4 rounded-[10px] border border-[#FECACA] bg-[#FEF2F2] p-3 text-[14px] text-destructive-strong">
            {error}
          </div>
        ) : null}

        {step === "site" ? (
          <section aria-labelledby="bk-h">
            <h1 id="bk-h" ref={headingRef} tabIndex={-1} className="text-[22px] font-bold leading-tight text-foreground outline-none">
              Where would you like to be seen?
            </h1>
            {data.intro ? <p className="mt-2 text-[14px] text-[#334155]">{data.intro}</p> : null}
            <div className="mt-4 flex gap-2">
              <label htmlFor="bk-place" className="sr-only">
                Town or postcode
              </label>
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-3.5 h-[18px] w-[18px] text-[#64748B]" aria-hidden="true" />
                <input
                  id="bk-place"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onBlur={(e) => placePostcode(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") placePostcode(query);
                  }}
                  placeholder="Town or postcode"
                  autoComplete="postal-code"
                  className="h-12 w-full rounded-[12px] border border-[#CBD5E1] bg-white pl-10 pr-3 text-[16px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                />
              </div>
            </div>
            <PmsButton type="button" variant="link" className="mt-2 px-0" onClick={useLocation} loading={locating} loadingText="Finding you…">
              <Crosshair aria-hidden="true" /> Use my location
            </PmsButton>
            {placeNote ? (
              <p role="status" className="mt-1 text-[13px] text-[#475569]">
                {placeNote}
              </p>
            ) : null}
            <ul className="mt-3 space-y-3">
              {shownSites.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className={`${cardBtn} border-border`}
                    onClick={() => {
                      setSiteId(s.id);
                      setPracId(null);
                      setSlot(null);
                      go("service");
                    }}
                  >
                    <MapPin className="h-5 w-5 shrink-0 text-primary-strong" aria-hidden="true" />
                    <span className="min-w-0">
                      <strong className="block text-[16px] text-foreground">{s.name}</strong>
                      <span className="block text-[13px] text-[#334155]">
                        {s.address}
                        {s.miles !== null ? ` · ${formatMiles(s.miles)}` : ""}
                      </span>
                      <span className="block text-[13px] font-medium text-[#166534]">{nextLabel(s.next, data.today)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {shownSites.length === 0 ? <p className="mt-4 text-[14px] text-[#475569]">No clinic matches that. Clear the search to see them all.</p> : null}
            <p className="mt-4 text-[11px] leading-4 text-[#64748B]" data-testid="ons-attribution">
              Postcode districts: {ONS_ATTRIBUTION.join(" ")}
            </p>
          </section>
        ) : null}

        {step === "service" ? (
          <section>
            <h1 ref={headingRef} tabIndex={-1} className="text-[22px] font-bold text-foreground outline-none">
              What do you need?
            </h1>
            <ul className="mt-4 space-y-3">
              {data.services.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className={`${cardBtn} flex-col items-stretch border-border`}
                    onClick={() => {
                      setServiceId(s.id);
                      setSlot(null);
                      go("prac");
                    }}
                  >
                    <span className="flex justify-between gap-2">
                      <strong className="text-[16px] text-foreground">{s.name}</strong>
                      {s.price ? <strong className="text-[15px] text-foreground">{s.price}</strong> : null}
                    </span>
                    <span className="text-[13px] text-[#334155]">{s.description}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {step === "prac" ? (
          <section>
            <h1 ref={headingRef} tabIndex={-1} className="text-[22px] font-bold text-foreground outline-none">
              Who would you like to see?
            </h1>
            <ul className="mt-4 space-y-3">
              <li>
                <button type="button" className={`${cardBtn} border-border`} onClick={() => choosePrac("any")}>
                  <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#F1F5F9] text-[13px] font-semibold text-[#334155]">
                    Any
                  </span>
                  <span>
                    <strong className="block text-[16px] text-foreground">Anyone available</strong>
                    <span className="text-[13px] text-[#334155]">Earliest time with anyone</span>
                  </span>
                </button>
              </li>
              {pracs.map((p) => (
                <li key={p.id}>
                  <button type="button" className={`${cardBtn} border-border`} onClick={() => choosePrac(p.id)}>
                    <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#CCFBF1] text-[13px] font-semibold text-[#0B5F58]">
                      {initials(p.name)}
                    </span>
                    <span>
                      <strong className="block text-[16px] text-foreground">{p.name}</strong>
                      <span className="text-[13px] text-[#334155]">{p.subtitle}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {step === "time" ? (
          <section>
            <h1 ref={headingRef} tabIndex={-1} className="text-[22px] font-bold text-foreground outline-none">
              Pick a time
            </h1>
            <p className="mt-1 text-[14px] text-[#334155]">
              {[service ? `${service.name} · ${service.minutes} min` : null, site?.name, pracId === "any" ? "Anyone available" : chosenPrac?.name].filter(Boolean).join(" · ")}
            </p>
            {loading && !week ? <p className="mt-4 text-[14px] text-[#475569]">Finding free times…</p> : null}
            {week ? (
              <>
                <div role="group" aria-label="Days" className="mt-4 grid grid-cols-4 gap-2">
                  {week.days.map((d) => {
                    const on = d.date === day;
                    const label = formatDayDate(d.date);
                    return (
                      <button
                        key={d.date}
                        type="button"
                        aria-pressed={on}
                        onClick={() => {
                          setDay(d.date);
                          setSlot(null);
                        }}
                        className={`flex flex-col items-center rounded-[10px] border py-2 text-[13px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${on ? "border-primary-strong bg-primary-strong text-white" : "border-border bg-white text-foreground"}`}
                      >
                        <span>{label.slice(0, 3)}</span>
                        <strong className="text-[16px]">{label.slice(4, 6)}</strong>
                      </button>
                    );
                  })}
                </div>
                {week.days.length === 0 ? <p className="mt-4 text-[14px] text-[#334155]">No free times this week.</p> : null}
                <div role="group" aria-label="Available times" className="mt-4 grid grid-cols-3 gap-2">
                  {(week.days.find((d) => d.date === day)?.slots ?? []).map((t) => {
                    const on = slot?.startsAt === t.startsAt;
                    return (
                      <button
                        key={`${t.startsAt}-${t.practitionerId}`}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setSlot({ startsAt: t.startsAt, practitionerId: t.practitionerId })}
                        className={`h-11 rounded-[10px] border text-[15px] font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${on ? "border-primary-strong bg-primary-strong text-white" : "border-[#CBD5E1] bg-white text-foreground"}`}
                      >
                        {t.time}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-4 flex justify-between">
                  <PmsButton type="button" variant="secondary" size="sm" className="h-11 px-4" disabled={fromDate <= data.today || loading} onClick={() => pracId && void fetchWeek(addDaysIso(fromDate, -7, data.today), pracId)}>
                    Earlier
                  </PmsButton>
                  <PmsButton type="button" variant="secondary" size="sm" className="h-11 px-4" disabled={!week.nextFrom || loading} onClick={() => pracId && week.nextFrom && void fetchWeek(week.nextFrom, pracId)}>
                    Later dates
                  </PmsButton>
                </div>
              </>
            ) : null}
            <p className="mt-4 flex items-center gap-1.5 text-[13px] text-[#475569]">
              <Clock className="h-4 w-4" aria-hidden="true" /> Times shown in UK time.
            </p>
          </section>
        ) : null}

        {step === "details" ? (
          <section>
            <h1 ref={headingRef} tabIndex={-1} className="text-[22px] font-bold text-foreground outline-none">
              Your details
            </h1>
            {slot ? <p className="mt-1 text-[14px] text-[#334155]">{formatWhen(slot.startsAt)}</p> : null}
            <form
              className="mt-4 space-y-4"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                continueFromDetails();
              }}
            >
              {field("firstName", "First name", { autoComplete: "given-name", required: true })}
              {field("lastName", "Last name", { autoComplete: "family-name", required: true })}
              {field("dateOfBirth", "Date of birth", { type: "date", autoComplete: "bday", required: true, max: data.today })}
              {field("phoneMobile", "Mobile", { type: "tel", autoComplete: "tel", inputMode: "tel", required: true })}
              {field("email", "Email", { type: "email", autoComplete: "email", required: true })}
              <fieldset className="space-y-2">
                <legend className="text-[14px] font-medium text-foreground">How are you paying?</legend>
                {[
                  ["self", "Paying myself"],
                  ["insured", "Health insurance – I'll bring my authorisation"],
                ].map(([value, label]) => (
                  <label key={value} className="flex min-h-11 items-center gap-3 rounded-[10px] border border-border bg-white px-3 text-[15px]">
                    <input type="radio" name="paying" value={value} checked={details.paying === value} onChange={() => setDetails((d) => ({ ...d, paying: value }))} className="h-5 w-5 accent-[#0B7970]" />
                    {label}
                  </label>
                ))}
              </fieldset>
              <label className="flex min-h-11 items-center gap-3 text-[15px]">
                <input type="checkbox" checked={details.reminders} onChange={(e) => setDetails((d) => ({ ...d, reminders: e.target.checked }))} className="h-5 w-5 accent-[#0B7970]" />
                Send me reminders by text and email
              </label>
              <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
                <label htmlFor="bk-website">Leave this empty</label>
                <input id="bk-website" tabIndex={-1} autoComplete="off" value={details.website} onChange={(e) => setDetails((d) => ({ ...d, website: e.target.value }))} />
              </div>
              <p className="text-[13px] text-[#475569]">Health questions come in a separate questionnaire that only your practitioner reads.</p>
              <button type="submit" tabIndex={-1} aria-hidden="true" className="sr-only">
                Continue
              </button>
            </form>
          </section>
        ) : null}

        {step === "confirm" && slot ? (
          <section>
            <h1 ref={headingRef} tabIndex={-1} className="text-[22px] font-bold text-foreground outline-none">
              Check and confirm
            </h1>
            <dl className="mt-4 divide-y divide-border rounded-[12px] border border-border bg-white">
              {[
                ["When", formatWhen(slot.startsAt)],
                ["What", [service?.name ?? fixed?.label, service ? `${service.minutes} min` : null, service?.price].filter(Boolean).join(" · ")],
                ["With", chosenPrac?.name ?? "Anyone available"],
                ["Where", [site?.name, site?.address].filter(Boolean).join(" – ")],
                ...(mode === "public" ? [["You", `${details.firstName} ${details.lastName} · ${details.phoneMobile}`]] : []),
              ].map(([k, v]) => (
                <div key={k} className="flex gap-3 px-4 py-3">
                  <dt className="w-16 shrink-0 text-[13px] text-[#475569]">{k}</dt>
                  <dd className="text-[14px] font-semibold text-foreground">{v}</dd>
                </div>
              ))}
            </dl>
            <div role="note" className="mt-4 flex gap-2 rounded-[10px] border border-[#FBD38D] bg-[#FFFBEB] p-3 text-[14px] text-[#864E0E]">
              <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                <strong>Cancellation policy:</strong> {data.policy}
              </span>
            </div>
            {mode !== "move" ? <p className="mt-3 text-[14px] text-[#334155]">Pay at the clinic. No card needed now.</p> : null}
          </section>
        ) : null}

        {step === "done" && done ? (
          <section>
            <div role="status" className="rounded-[12px] border border-[#BBF7D0] bg-[#F0FDF4] p-4">
              <span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-full bg-[#166534] text-white">
                <Check className="h-7 w-7" />
              </span>
              <h1 ref={headingRef} tabIndex={-1} className="mt-3 text-[22px] font-bold text-foreground outline-none">
                {mode === "move" ? "Your appointment has moved" : "You're booked"}
              </h1>
              <p className="mt-1 text-[15px] text-foreground">
                {done.when} with {done.practitioner}, {done.site}.
              </p>
              <p className="mt-1 text-[14px] text-[#334155]">We&apos;ve sent you a confirmation by text and email. Ref {done.reference}</p>
            </div>
            {done.formPath ? (
              <div className="mt-4 rounded-[12px] border border-border bg-white p-4">
                <strong className="text-[15px] text-foreground">Before your visit</strong>
                <p className="mt-1 text-[14px] text-[#334155]">Please fill in your forms – it takes about 5 minutes.</p>
                <Link href={done.formPath} className="mt-3 inline-flex h-11 items-center rounded-[10px] bg-primary-strong px-4 text-[15px] font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                  Fill in {done.forms > 1 ? "your forms" : "the questionnaire"}
                </Link>
              </div>
            ) : null}
            <div className="mt-4 grid grid-cols-2 gap-2">
              <a href={icsHref(done, "the clinic")} download="appointment.ics" className="inline-flex h-11 items-center justify-center rounded-[10px] border border-border bg-white text-[15px] font-medium text-foreground">
                Add to calendar
              </a>
              {done.managePath ? (
                <Link href={done.managePath} className="inline-flex h-11 items-center justify-center rounded-[10px] border border-border bg-white text-[15px] font-medium text-foreground">
                  Manage booking
                </Link>
              ) : homeHref ? (
                <Link href={homeHref} className="inline-flex h-11 items-center justify-center rounded-[10px] border border-border bg-white text-[15px] font-medium text-foreground">
                  My appointments
                </Link>
              ) : null}
            </div>
          </section>
        ) : null}
      </main>

      {action ? (
        <footer className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-white px-4 py-3">
          <div className="mx-auto max-w-[448px]">
            <PmsButton type="button" size="lg" className="h-12 w-full text-[16px]" disabled={action.disabled} loading={loading && step === "confirm"} loadingText="Booking…" onClick={action.onClick}>
              {action.label}
            </PmsButton>
          </div>
        </footer>
      ) : null}
    </>
  );
}

function addDaysIso(date: string, days: number, floor: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  const out = d.toISOString().slice(0, 10);
  return out < floor ? floor : out;
}
