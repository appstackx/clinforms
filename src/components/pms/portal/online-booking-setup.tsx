"use client";

/**
 * Set-up → Online booking (no design of its own – built in the set-up style of round 2c): the switches and rules,
 * the sites offered online with their map position (for the patient's browser-side distance only), the appointment
 * types and practitioners offered, the public links, and the latest online bookings to check.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { ExternalLink, Globe } from "lucide-react";
import { reviewOnlineBookingAction, saveBookingSettingsAction, saveBookingSiteAction, setOnlineBookableAction } from "@/app/app/clinic/online-booking/actions";
import { FlagPill, PmsButton, PmsNotice, Switch, TextArea, TextInput, useToast } from "@/components/pms/ui";
import type { BookingSettings, BookingSite } from "@/modules/pms/portal/types";
import type { Practitioner, Service, Site } from "@/modules/pms/core/types";

export interface RecentOnlineBookingRow {
  appointmentId: string;
  patientId: string;
  patientName: string;
  reference: string;
  when: string;
  madeAt: string;
  where: string;
  withWhom: string;
  what: string;
  status: string;
  newPatient: boolean;
  channel: string;
  reviewed: boolean;
}

interface Setup {
  settings: BookingSettings;
  sites: { site: Site; booking: BookingSite | null }[];
  services: Service[];
  practitioners: Practitioner[];
  bookingPath: string;
  portalPath: string;
}

const section = "rounded-[12px] border border-border bg-white p-5";
const label = "block text-sm font-medium text-foreground";

function NumberField({ id, text, value, onChange, hint, min, max, error }: { id: string; text: string; value: number; onChange: (n: number) => void; hint?: string; min: number; max: number; error?: string }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className={label}>
        {text}
      </label>
      <TextInput id={id} type="number" min={min} max={max} value={Number.isFinite(value) ? value : ""} onChange={(e) => onChange(Number(e.target.value))} className="w-32" aria-describedby={hint ? `${id}-hint` : undefined} aria-invalid={error ? true : undefined} />
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-[#475569]">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-destructive-strong">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function OnlineBookingSetup({ setup, recent, canReview }: { setup: Setup; recent: RecentOnlineBookingRow[]; canReview: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const s0 = setup.settings;
  const [rev, setRev] = React.useState(s0.rev);
  const [form, setForm] = React.useState({
    onlineBooking: s0.onlineBooking,
    portal: s0.portal,
    newPatients: s0.newPatients,
    patientCancel: s0.patientCancel,
    minNoticeHours: s0.minNoticeHours,
    maxDaysAhead: s0.maxDaysAhead,
    slotStepMinutes: s0.slotStepMinutes,
    cancelNoticeHours: s0.cancelNoticeHours,
    introText: s0.introText ?? "",
    cancellationPolicy: s0.cancellationPolicy ?? "",
    contactPhone: s0.contactPhone ?? "",
    contactEmail: s0.contactEmail ?? "",
  });
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [sites, setSites] = React.useState(() =>
    setup.sites.map(({ site, booking }) => ({ site, rev: booking?.rev ?? 0, online: booking?.online ?? true, lat: booking?.latitude?.toString() ?? "", lng: booking?.longitude?.toString() ?? "" })),
  );
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function saveSettings() {
    setBusy("settings");
    setError(null);
    setErrors({});
    const r = await saveBookingSettingsAction(rev, {
      ...form,
      introText: form.introText.trim() || null,
      cancellationPolicy: form.cancellationPolicy.trim() || null,
      contactPhone: form.contactPhone.trim() || null,
      contactEmail: form.contactEmail.trim() || null,
    });
    setBusy(null);
    if (!r.ok) {
      setError(r.error);
      setErrors(r.fieldErrors ?? {});
      return;
    }
    if (r.rev) setRev(r.rev);
    toast.success(r.message ?? "Saved.");
    router.refresh();
  }

  async function saveSite(i: number) {
    const row = sites[i];
    setBusy(`site-${row.site.id}`);
    setError(null);
    const lat = row.lat.trim() === "" ? null : Number(row.lat);
    const lng = row.lng.trim() === "" ? null : Number(row.lng);
    const r = await saveBookingSiteAction(row.rev, { siteId: row.site.id, online: row.online, latitude: lat, longitude: lng });
    setBusy(null);
    if (!r.ok) {
      setError(`${row.site.name}: ${r.fieldErrors ? Object.values(r.fieldErrors)[0] : r.error}`);
      return;
    }
    setSites((all) => all.map((x, j) => (j === i ? { ...x, rev: r.rev ?? x.rev } : x)));
    toast.success(`${row.site.name}: saved.`);
  }

  async function toggle(kind: "service" | "practitioner", id: string, on: boolean, name: string) {
    setBusy(`${kind}-${id}`);
    const r = await setOnlineBookableAction(kind, id, on);
    setBusy(null);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    toast.success(`${name}: ${on ? "offered online" : "not offered online"}`);
    router.refresh();
  }

  async function review(id: string) {
    setBusy(`review-${id}`);
    const r = await reviewOnlineBookingAction(id);
    setBusy(null);
    if (!r.ok) setError(r.error);
    else router.refresh();
  }

  const unchecked = recent.filter((r) => !r.reviewed).length;

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[980px] flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-[#475569]">Set-up</p>
          <h1 className="text-2xl font-semibold text-foreground">Online booking</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={setup.bookingPath} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-border bg-white px-3 text-sm font-medium text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
            <Globe className="h-4 w-4" aria-hidden="true" /> Booking page <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="sr-only">(opens in a new tab)</span>
          </Link>
          <Link href={setup.portalPath} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-border bg-white px-3 text-sm font-medium text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
            Patient portal <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="sr-only">(opens in a new tab)</span>
          </Link>
        </div>
      </div>
      {error ? (
        <p role="alert" className="rounded-[8px] border border-[#FECACA] bg-[#FEF2F2] p-3 text-sm text-destructive-strong">
          {error}
        </p>
      ) : null}

      <section aria-labelledby="ob-recent" className={section}>
        <div className="flex items-center justify-between gap-2">
          <h2 id="ob-recent" className="text-lg font-semibold text-foreground">
            Latest online bookings
          </h2>
          {unchecked > 0 ? <FlagPill>{unchecked} to check</FlagPill> : null}
        </div>
        <p className="mt-1 text-sm text-[#475569]">Each one is already in the diary, marked &ldquo;Booked online&rdquo;. A new patient&apos;s record was made from what they typed – check it is not someone you already know.</p>
        {recent.length === 0 ? (
          <p className="mt-3 text-sm text-[#475569]">No online bookings yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <caption className="sr-only">Latest online bookings</caption>
              <thead className="bg-[#F8FAFC] text-[#475569]">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">Patient</th>
                  <th scope="col" className="px-3 py-2 font-medium">Appointment</th>
                  <th scope="col" className="px-3 py-2 font-medium">Booked</th>
                  <th scope="col" className="px-3 py-2 font-medium">Status</th>
                  <th scope="col" className="px-3 py-2 font-medium"><span className="sr-only">Check</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {recent.map((r) => (
                  <tr key={r.appointmentId}>
                    <td className="px-3 py-2">
                      <Link href={`/app/clinic/patients/${r.patientId}`} className="font-medium text-primary-strong underline underline-offset-2">
                        {r.patientName}
                      </Link>
                      {r.newPatient ? <span className="ml-2"><FlagPill>New patient</FlagPill></span> : null}
                    </td>
                    <td className="px-3 py-2">
                      {r.when}
                      <span className="block text-xs text-[#475569]">
                        {[r.what, r.withWhom, r.where].filter(Boolean).join(" · ")} · Ref {r.reference}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[#475569]">
                      {r.madeAt}
                      <span className="block text-xs">{r.channel === "portal" ? "Patient portal" : "Booking page"}</span>
                    </td>
                    <td className="px-3 py-2">{r.status === "booked" ? "Booked" : r.status === "late_cancelled" ? "Late cancellation" : r.status === "cancelled" ? "Cancelled" : r.status}</td>
                    <td className="px-3 py-2 text-right">
                      {r.reviewed ? (
                        <span className="text-xs text-[#166534]">Checked</span>
                      ) : canReview ? (
                        <PmsButton size="sm" variant="secondary" loading={busy === `review-${r.appointmentId}`} onClick={() => void review(r.appointmentId)}>
                          Mark checked
                        </PmsButton>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="ob-settings" className={section}>
        <h2 id="ob-settings" className="text-lg font-semibold text-foreground">
          Booking page and patient portal
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Switch id="ob-on" checked={form.onlineBooking} onCheckedChange={(v) => set("onlineBooking", v)} label="Online booking page on" />
          <Switch id="ob-portal" checked={form.portal} onCheckedChange={(v) => set("portal", v)} label="Patient portal on" />
          <Switch id="ob-new" checked={form.newPatients} onCheckedChange={(v) => set("newPatients", v)} label="New patients may book online" />
          <Switch id="ob-change" checked={form.patientCancel} onCheckedChange={(v) => set("patientCancel", v)} label="Patients may cancel or move online" />
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-4">
          <NumberField id="ob-notice" text="Minimum notice (hours)" value={form.minNoticeHours} onChange={(n) => set("minNoticeHours", n)} min={0} max={336} hint="No booking sooner than this." error={errors.minNoticeHours} />
          <NumberField id="ob-ahead" text="Book up to (days ahead)" value={form.maxDaysAhead} onChange={(n) => set("maxDaysAhead", n)} min={1} max={365} error={errors.maxDaysAhead} />
          <NumberField id="ob-step" text="Times every (minutes)" value={form.slotStepMinutes} onChange={(n) => set("slotStepMinutes", n)} min={5} max={60} hint="5, 10, 15, 20, 30 or 60." error={errors.slotStepMinutes} />
          <NumberField id="ob-cancel" text="Free changes until (hours before)" value={form.cancelNoticeHours} onChange={(n) => set("cancelNoticeHours", n)} min={0} max={336} hint="Later = late cancellation (fee flagged)." error={errors.cancelNoticeHours} />
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="ob-intro" className={label}>
              Words at the top of the booking page
            </label>
            <TextArea id="ob-intro" rows={3} maxLength={600} value={form.introText} onChange={(e) => set("introText", e.target.value)} />
          </div>
          <div className="space-y-1">
            <label htmlFor="ob-policy" className={label}>
              Cancellation policy (shown before confirming)
            </label>
            <TextArea id="ob-policy" rows={3} maxLength={1000} value={form.cancellationPolicy} onChange={(e) => set("cancellationPolicy", e.target.value)} />
          </div>
          <div className="space-y-1">
            <label htmlFor="ob-phone" className={label}>
              Phone for patients
            </label>
            <TextInput id="ob-phone" type="tel" value={form.contactPhone} onChange={(e) => set("contactPhone", e.target.value)} aria-invalid={errors.contactPhone ? true : undefined} />
          </div>
          <div className="space-y-1">
            <label htmlFor="ob-email" className={label}>
              Email for patients
            </label>
            <TextInput id="ob-email" type="email" value={form.contactEmail} onChange={(e) => set("contactEmail", e.target.value)} aria-invalid={errors.contactEmail ? true : undefined} />
          </div>
        </div>
        <PmsNotice tone="info" title="One diary" className="mt-4">
          Times come from the diary: a practitioner&apos;s rota hours marked &ldquo;online&rdquo;, minus everything booked or blocked. A time shown online can be booked by reception at the same moment, and the other way round – the diary refuses whichever comes second.
        </PmsNotice>
        <div className="mt-4 flex justify-end">
          <PmsButton loading={busy === "settings"} loadingText="Saving…" onClick={() => void saveSettings()}>
            Save settings
          </PmsButton>
        </div>
      </section>

      <section aria-labelledby="ob-sites" className={section}>
        <h2 id="ob-sites" className="text-lg font-semibold text-foreground">
          Sites
        </h2>
        <p className="mt-1 text-sm text-[#475569]">
          The map position lets a patient who taps &ldquo;Use my location&rdquo; (or types a postcode) see how far each site is. It is worked out in their browser – nothing about the patient is sent or stored.
        </p>
        <ul className="mt-3 divide-y divide-border">
          {sites.map((row, i) => (
            <li key={row.site.id} className="flex flex-wrap items-end gap-3 py-3">
              <div className="min-w-[180px] flex-1">
                <strong className="block text-sm text-foreground">{row.site.name}</strong>
                <span className="text-xs text-[#475569]">{[...(row.site.address ?? []), row.site.postcode].filter(Boolean).join(", ")}</span>
              </div>
              <Switch id={`site-on-${row.site.id}`} checked={row.online} onCheckedChange={(v) => setSites((all) => all.map((x, j) => (j === i ? { ...x, online: v } : x)))} label="Offered online" />
              <div className="space-y-1">
                <label htmlFor={`site-lat-${row.site.id}`} className="block text-xs font-medium text-foreground">
                  Latitude
                </label>
                <TextInput id={`site-lat-${row.site.id}`} inputMode="decimal" className="w-28" value={row.lat} onChange={(e) => setSites((all) => all.map((x, j) => (j === i ? { ...x, lat: e.target.value } : x)))} />
              </div>
              <div className="space-y-1">
                <label htmlFor={`site-lng-${row.site.id}`} className="block text-xs font-medium text-foreground">
                  Longitude
                </label>
                <TextInput id={`site-lng-${row.site.id}`} inputMode="decimal" className="w-28" value={row.lng} onChange={(e) => setSites((all) => all.map((x, j) => (j === i ? { ...x, lng: e.target.value } : x)))} />
              </div>
              <PmsButton size="sm" variant="secondary" loading={busy === `site-${row.site.id}`} onClick={() => void saveSite(i)}>
                Save {row.site.name}
              </PmsButton>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="ob-offer" className={section}>
        <h2 id="ob-offer" className="text-lg font-semibold text-foreground">
          What patients can book
        </h2>
        <div className="mt-3 grid gap-6 sm:grid-cols-2">
          <fieldset>
            <legend className="text-sm font-semibold text-foreground">Appointment types</legend>
            <ul className="mt-2 space-y-2">
              {setup.services.map((s) => (
                <li key={s.id}>
                  <Switch id={`svc-${s.id}`} checked={s.onlineBookable} disabled={busy === `service-${s.id}`} onCheckedChange={(v) => void toggle("service", s.id, v, s.name)} label={`${s.name} (${s.durationMinutes} min)`} />
                </li>
              ))}
            </ul>
          </fieldset>
          <fieldset>
            <legend className="text-sm font-semibold text-foreground">Practitioners</legend>
            <ul className="mt-2 space-y-2">
              {setup.practitioners.map((p) => (
                <li key={p.id}>
                  <Switch id={`prac-${p.id}`} checked={p.onlineBookable} disabled={busy === `practitioner-${p.id}`} onCheckedChange={(v) => void toggle("practitioner", p.id, v, p.displayName)} label={p.displayName} />
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-[#475569]">Which of their rota hours are online is set on the diary&apos;s rota.</p>
          </fieldset>
        </div>
      </section>
    </div>
  );
}
