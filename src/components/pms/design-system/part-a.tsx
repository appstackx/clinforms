"use client";
/**
 * The design-system preview's second half: the components the round 2 brief listed as missing (Part A) – date and time
 * pickers, patient combobox, dropdown menu, context menu (placeholder until its component is merged), tooltip,
 * popover, step indicator, file upload, chart styles, breadcrumb and back link, segmented control, and the unsaved
 * changes and locked banners. Fixed fictional examples only; nothing is saved.
 */
import * as React from "react";
import { ChevronDown, CreditCard, FileText, Info, Printer, UserCheck, UserX, XCircle, Activity, RotateCcw } from "lucide-react";
import {
  addDays,
  BackLink,
  Breadcrumb,
  DatePicker,
  DiaryBlock,
  DropdownMenu,
  FileUpload,
  FormField,
  LockedBanner,
  PatientCombobox,
  PmsButton,
  PmsChart,
  PmsPopover,
  PmsTooltip,
  SegmentedControl,
  StepIndicator,
  TimePicker,
  TruncatedText,
  UnsavedChangesBanner,
  useToast,
  type PatientHit,
  type UploadItem,
} from "../ui";

const PATIENTS: readonly PatientHit[] = [
  { id: "p1", name: "Margaret Ellis", dateOfBirth: "14/03/1958", phone: "07700 900412", nextAppointment: "Tue 03/11 09:00", alerts: ["Latex allergy"] },
  { id: "p2", name: "Margaret Elliot", dateOfBirth: "02/07/1971", phone: "07700 900233" },
  { id: "p3", name: "Mark Ellison", dateOfBirth: "21/11/1990", phone: "07700 900871", nextAppointment: "Thu 05/11 16:30" },
  { id: "p4", name: "Ellie Marsh", dateOfBirth: "09/01/2004", phone: "07700 900150" },
];

const BOOKING_STEPS = ["Clinic", "Service", "Practitioner", "Time", "Your details", "Confirm"] as const;
const IMPORT_STEPS = ["Upload file", "Match columns", "Check", "Import"] as const;

const WEEKS = ["w/c 05/10", "w/c 12/10", "w/c 19/10", "w/c 26/10", "w/c 02/11", "w/c 09/11"];
const MONTHS = ["Jun", "Jul", "Aug", "Sep", "Oct"];
const pounds = (v: number) => `£${v.toLocaleString("en-GB")}`;

function londonToday(): string {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}`;
}

function Section({ id, title, aside, intro, children }: { id: string; title: string; aside?: string; intro?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-4" data-testid={id}>
      <div className="flex flex-col gap-1">
        <h2 id={id} className="text-xl font-semibold">
          {title}
          {aside ? <span className="text-sm font-normal text-[#475569]"> · {aside}</span> : null}
        </h2>
        {intro ? <p className="text-[#475569]">{intro}</p> : null}
      </div>
      {children}
    </section>
  );
}

const card = "rounded-2xl border border-border bg-white";
const caption = "text-xs text-[#475569]";

export function PartAShowcase() {
  const toast = useToast();
  const [today] = React.useState(londonToday);
  const [apptDate, setApptDate] = React.useState(() => addDays(londonToday(), 3));
  const [dob, setDob] = React.useState("1958-03-14");
  const [time, setTime] = React.useState("09:15");
  const [exactTime, setExactTime] = React.useState("14:05");

  const [query, setQuery] = React.useState("");
  const [chosen, setChosen] = React.useState<PatientHit | null>(null);
  const [showDuplicate, setShowDuplicate] = React.useState(false);
  const results = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return PATIENTS.filter((p) => p.name.toLowerCase().includes(q) || (p.dateOfBirth ?? "").includes(q) || (p.phone ?? "").replace(/\s/g, "").includes(q.replace(/\s/g, "")));
  }, [query]);

  const [popOpen, setPopOpen] = React.useState(false);
  const [bookingStep, setBookingStep] = React.useState(1);

  const [uploads, setUploads] = React.useState<UploadItem[]>([
    { id: "u1", name: "referral-letter-margaret-ellis.pdf", size: 248_000, progress: 100, done: true },
    { id: "u2", name: "mri-report.pdf", size: 1_900_000, progress: 64 },
    { id: "u3", name: "knee-photo.heic", size: 3_100_000, progress: null, error: "knee-photo.heic isn’t a file type we accept. Use PDF, JPG or PNG." },
  ]);
  const timers = React.useRef<number[]>([]);
  React.useEffect(() => () => timers.current.forEach((t) => window.clearInterval(t)), []);
  const startUpload = (file: File) => {
    const id = `f-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setUploads((u) => [...u, { id, name: file.name, size: file.size, progress: 0 }]);
    const t = window.setInterval(() => {
      setUploads((list) =>
        list.map((f) => {
          if (f.id !== id || f.done) return f;
          const p = Math.min(100, (f.progress ?? 0) + 25);
          if (p >= 100) window.clearInterval(t);
          return { ...f, progress: p, done: p >= 100 };
        }),
      );
    }, 300);
    timers.current.push(t);
  };

  const [view, setView] = React.useState<"day" | "week">("day");
  const [by, setBy] = React.useState<"practitioner" | "room">("practitioner");
  const [dirtyCount, setDirtyCount] = React.useState(3);
  const [saving, setSaving] = React.useState(false);

  const example = (what: string) => () => toast.success(`${what} (example – nothing was changed)`);

  return (
    <>
      <Section id="s-date" title="Date and time pickers" aside="DatePicker, TimePicker" intro="Type a date as DD/MM/YYYY or pick it from the calendar. In the calendar: arrows move a day or a week, Page Up/Down a month, Enter picks, Esc closes. Times are 24-hour, in 15- or 5-minute steps.">
        <div className={`${card} grid gap-5 p-6 [grid-template-columns:repeat(auto-fit,minmax(min(240px,100%),1fr))]`}>
          <FormField id="ds-pick-date" label="Appointment date" hint="From today, up to 90 days ahead">
            {(aria) => <DatePicker {...aria} value={apptDate} onChange={setApptDate} today={today} min={today} max={addDays(today, 90)} />}
          </FormField>
          <FormField id="ds-pick-dob" label="Date of birth">
            {(aria) => <DatePicker {...aria} value={dob} onChange={setDob} today={today} max={today} />}
          </FormField>
          <FormField id="ds-pick-time" label="Time" hint="15-minute steps (the diary grid)">
            {(aria) => <TimePicker {...aria} value={time} onChange={setTime} step={15} from="08:00" to="20:00" />}
          </FormField>
          <FormField id="ds-pick-time5" label="Exact time" hint="5-minute steps">
            {(aria) => <TimePicker {...aria} value={exactTime} onChange={setExactTime} step={5} from="08:00" to="20:00" />}
          </FormField>
        </div>
      </Section>

      <Section id="s-combobox" title="Patient search" aside="PatientCombobox" intro="Each match shows name, date of birth, phone, next appointment and alerts in words. ↓/↑ move, Enter picks, Esc closes. “Create new patient” is always last.">
        <div className={`${card} grid items-start gap-5 p-6 [grid-template-columns:repeat(auto-fit,minmax(min(320px,100%),1fr))]`}>
          <PatientCombobox
            id="ds-patient"
            label="Patient"
            hint="Try “ell” or “0770090041”"
            query={query}
            onQueryChange={(q) => {
              setQuery(q);
              setChosen(null);
            }}
            results={results}
            onSelect={(h) => {
              setChosen(h);
              setQuery(h.name);
            }}
            onCreate={() => setShowDuplicate(true)}
            duplicateWarning={
              showDuplicate ? (
                <>
                  <strong className="font-semibold">These patients look similar</strong>
                  <span className="block text-[#334155]">Margaret Ellis, DOB 14/03/1958, 07700 900412. Open that record, or continue if this is a different person.</span>
                  <span className="mt-2 flex flex-wrap gap-2">
                    <PmsButton size="sm" variant="secondary" className="max-sm:h-11" onClick={() => setShowDuplicate(false)}>
                      Open Margaret Ellis
                    </PmsButton>
                    <PmsButton size="sm" variant="ghost" className="max-sm:h-11" onClick={() => setShowDuplicate(false)}>
                      Continue – different person
                    </PmsButton>
                  </span>
                </>
              ) : undefined
            }
          />
          <div className="flex flex-col gap-2 text-sm">
            <span className={caption}>Chosen patient</span>
            <p role="status" data-testid="ds-patient-chosen">
              {chosen ? (
                <>
                  <strong>{chosen.name}</strong> · DOB {chosen.dateOfBirth}
                </>
              ) : (
                "None yet"
              )}
            </p>
            <PmsButton size="sm" variant="secondary" className="self-start max-sm:h-11" onClick={() => setShowDuplicate((v) => !v)} aria-pressed={showDuplicate}>
              {showDuplicate ? "Hide" : "Show"} the possible-duplicate state
            </PmsButton>
          </div>
        </div>
      </Section>

      <Section id="s-menu" title="Dropdown menu" aside="DropdownMenu" intro="Enter, Space or ↓ opens it; ↓/↑ move, a letter jumps, Enter runs the action, Esc closes and returns to the button.">
        <div className={`${card} flex flex-wrap items-center gap-4 p-6`}>
          <DropdownMenu
            label="Appointment actions"
            align="start"
            trigger={(t) => (
              <PmsButton {...t} variant="secondary" className="max-sm:h-11">
                Appointment actions <ChevronDown aria-hidden />
              </PmsButton>
            )}
            items={[
              { type: "label", label: "James Okafor · 10:30" },
              { label: "Mark as arrived", icon: <UserCheck />, shortcut: "A", onSelect: example("Marked as arrived") },
              { label: "Start treatment", icon: <Activity />, onSelect: example("Treatment started") },
              { label: "Rebook", icon: <RotateCcw />, onSelect: example("Rebook opened") },
              { label: "Take payment", icon: <CreditCard />, onSelect: example("Take payment opened") },
              { label: "Open record", icon: <FileText />, href: "#s-menu" },
              { label: "Write note (clinicians only)", icon: <FileText />, disabled: true },
              { type: "separator" },
              { label: "Did not attend (DNA)…", icon: <UserX />, onSelect: example("Marked as did not attend") },
              { label: "Cancel appointment…", icon: <XCircle />, destructive: true, onSelect: example("Appointment cancelled") },
            ]}
          />
          <span className={caption}>Disabled items stay visible and say why; destructive ones end with “…” and ask first.</span>
        </div>
      </Section>

      {/* CONTEXT MENU STUB – src/components/pms/ui/context-menu.tsx is built on a separate branch; the lead wires it in
          here after merging (right-click / Shift+F10 / the Menu key on the block below opens the block's actions). */}
      <Section id="s-context-menu" title="Context menu" aside="ContextMenu" intro="Right-click a diary block (or focus it and press Shift+F10) for the same actions as its drawer.">
        <div className={`${card} flex flex-wrap items-start gap-4 p-6`} data-testid="context-menu-stub">
          <div className="w-[240px] max-w-full">
            <DiaryBlock status="booked" start="14:15" end="14:45" title="Fatima Begum" detail="Follow-up" />
          </div>
          <p className={`${caption} max-w-[360px]`}>Right-click a diary block – the context menu component is added to this example when it lands.</p>
        </div>
      </Section>

      <Section id="s-tooltip" title="Tooltip and popover" aside="PmsTooltip, PmsPopover" intro="Tooltips open on hover and keyboard focus and only repeat what is on screen. A popover holds a little extra detail; Esc closes it and focus returns to its button.">
        <div className={`${card} flex flex-wrap items-center gap-4 p-6`}>
          <PmsTooltip content="Print day sheet">
            <PmsButton size="icon" variant="secondary" aria-label="Print day sheet" className="max-sm:h-11 max-sm:w-11">
              <Printer aria-hidden />
            </PmsButton>
          </PmsTooltip>
          <div className="w-[200px] max-w-full text-sm">
            <span className={caption}>Truncated name (focus or hover it)</span>
            <TruncatedText>Bluewell Health (fictional) – re Liam O’Connor, claim BW-55021</TruncatedText>
          </div>
          <PmsPopover
            open={popOpen}
            onOpenChange={setPopOpen}
            label="Authorisation BW-55021"
            trigger={(t) => (
              <PmsButton {...t} variant="secondary" className="max-sm:h-11">
                <Info aria-hidden /> Authorisation details
              </PmsButton>
            )}
          >
            <div className="flex w-[260px] max-w-full flex-col gap-2">
              <strong className="font-semibold">Authorisation BW-55021</strong>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
                <dt className="text-[#475569]">Insurer</dt>
                <dd>Bluewell Health (fictional)</dd>
                <dt className="text-[#475569]">Sessions</dt>
                <dd>5 of 6 used</dd>
                <dt className="text-[#475569]">Ends</dt>
                <dd>30/11/2026</dd>
              </dl>
              <PmsButton size="sm" variant="secondary" className="self-start max-sm:h-11" onClick={() => setPopOpen(false)}>
                Close
              </PmsButton>
            </div>
          </PmsPopover>
        </div>
      </Section>

      <Section id="s-steps" title="Step indicator" aside="StepIndicator" intro="Online booking and import. Done steps have a tick, the current one is teal and named for screen readers. On a phone it becomes “Step 2 of 6” with a bar.">
        <div className={`${card} flex flex-col gap-5 p-6`}>
          <StepIndicator label="Booking steps" steps={BOOKING_STEPS} current={bookingStep} />
          <div className="flex flex-wrap gap-2">
            <PmsButton size="sm" variant="secondary" className="max-sm:h-11" disabled={bookingStep === 0} onClick={() => setBookingStep((s) => Math.max(0, s - 1))}>
              Back
            </PmsButton>
            <PmsButton size="sm" className="max-sm:h-11" disabled={bookingStep === BOOKING_STEPS.length - 1} onClick={() => setBookingStep((s) => Math.min(BOOKING_STEPS.length - 1, s + 1))}>
              Next step
            </PmsButton>
          </div>
          <StepIndicator label="Import steps" steps={IMPORT_STEPS} current={2} />
        </div>
      </Section>

      <Section id="s-upload" title="File upload" aside="FileUpload" intro="Drag files on, or choose them. Allowed types and the size limit are spelt out; a refused file says why.">
        <div className={`${card} p-6`}>
          <FileUpload
            id="ds-upload"
            label="Attachments"
            accept={[".pdf", ".jpg", ".png"]}
            maxBytes={10 * 1024 * 1024}
            items={uploads}
            onRemove={(id) => setUploads((u) => u.filter((f) => f.id !== id))}
            onFiles={(ok, bad) => {
              ok.forEach(startUpload);
              setUploads((u) => [...u, ...bad.map(({ file, reason }) => ({ id: `e-${file.name}-${Date.now()}`, name: file.name, size: file.size, progress: null, error: reason }))]);
            }}
          />
        </div>
      </Section>

      <Section id="s-charts" title="Chart styles" aside="PmsChart" intro="Line, bar and stacked bar in the colour tokens. Series differ by colour and marker and are named in the legend; every chart has the same figures as a table.">
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(420px,100%),1fr))]">
          <PmsChart
            kind="line"
            title="Attended appointments per week"
            summary="Attended appointments per week at Harbour Road rose from 142 to 171; at Kingsmead from 96 to 118."
            categoryLabel="Week"
            categories={WEEKS}
            series={[
              { name: "Harbour Road", values: [142, 150, 147, 158, 166, 171] },
              { name: "Kingsmead", values: [96, 101, 108, 104, 112, 118] },
            ]}
          />
          <PmsChart
            kind="bar"
            title="New patients by month"
            summary="New patients by month: 38 in June, 44 in July, 31 in August, 52 in September and 47 in October."
            categoryLabel="Month"
            categories={MONTHS}
            series={[{ name: "New patients", values: [38, 44, 31, 52, 47] }]}
          />
          <PmsChart
            kind="stacked"
            title="Income by payer"
            summary="Income by payer per month; October's total was £20,950, of which insurers paid £11,400."
            categoryLabel="Month"
            categories={MONTHS}
            format={pounds}
            series={[
              { name: "Self-pay", values: [6200, 6900, 5400, 7100, 6800] },
              { name: "Insurer", values: [9800, 10400, 8700, 11900, 11400] },
              { name: "Solicitor", values: [2100, 1800, 2600, 2400, 2750] },
            ]}
          />
        </div>
      </Section>

      <Section id="s-breadcrumb" title="Breadcrumb and back link" aside="Breadcrumb, BackLink" intro="Where the page sits; the current page is last and not a link. On a phone the trail becomes one “Back to …” link.">
        <div className={`${card} flex flex-col gap-4 p-6`}>
          <Breadcrumb
            items={[
              { label: "Patients", href: "#s-breadcrumb" },
              { label: "Margaret Ellis", href: "#s-breadcrumb" },
              { label: "Clinical note 27/10/2026" },
            ]}
          />
          <BackLink href="#s-breadcrumb">Back to the diary</BackLink>
        </div>
      </Section>

      <Section id="s-segmented" title="Segmented control" aside="SegmentedControl" intro="One Tab stop; ←/→ move and choose. For a view that is in the address (the diary), use links with aria-current instead.">
        <div className={`${card} flex flex-wrap items-center gap-5 p-6`}>
          <SegmentedControl
            label="Diary view"
            value={view}
            onChange={setView}
            options={[
              { value: "day", label: "Day" },
              { value: "week", label: "Week" },
            ]}
          />
          <SegmentedControl
            label="Columns"
            showLabel
            value={by}
            onChange={setBy}
            options={[
              { value: "practitioner", label: "By practitioner" },
              { value: "room", label: "By room" },
            ]}
          />
          <span className={caption} data-testid="ds-segmented-value">
            Showing: {view === "day" ? "Day" : "Week"}, {by === "practitioner" ? "by practitioner" : "by room"}
          </span>
        </div>
      </Section>

      <Section id="s-banners" title="Unsaved changes and locked banners" aside="UnsavedChangesBanner, LockedBanner">
        <div className="flex flex-col gap-3">
          {dirtyCount > 0 ? (
            <UnsavedChangesBanner
              count={dirtyCount}
              saving={saving}
              onDiscard={() => setDirtyCount(0)}
              onSave={() => {
                setSaving(true);
                window.setTimeout(() => {
                  setSaving(false);
                  setDirtyCount(0);
                  toast.success("Changes saved (example – nothing was changed)");
                }, 700);
              }}
            >
              nothing changes for staff until you save.
            </UnsavedChangesBanner>
          ) : (
            <PmsButton size="sm" variant="secondary" className="self-start max-sm:h-11" onClick={() => setDirtyCount(3)}>
              Show the unsaved-changes banner again
            </PmsButton>
          )}
          <LockedBanner title="Signed and locked." action={<PmsButton variant="secondary" size="sm" className="max-sm:h-11" onClick={example("Amendment started")}>Add amendment</PmsButton>}>
            Signed by Priya Shah (PH-DEMO-01) on 27/10/2026 at 11:42. Changes are added as amendments below the original.
          </LockedBanner>
          <LockedBanner variant="read-only" title="Read only.">
            You can see this rota, but only an owner or administrator can change it.
          </LockedBanner>
        </div>
      </Section>
    </>
  );
}

