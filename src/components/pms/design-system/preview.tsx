"use client";
/**
 * The design-system preview (/app/clinic/design-system): every kit component with the design's fictional examples
 * (the round 2 brief's Part A components follow in ./part-a),
 * laid out like docs/clinic-system/design/design-system-v1.pdf so the two can be compared side by side. Fixed
 * example data only – no clinic data is read.
 */
import * as React from "react";
import { Activity, AlertTriangle, BellOff, Calendar, Clock, Globe, Moon, MoreHorizontal, Plus, Search, Shield } from "lucide-react";
import {
  Checkbox,
  ClearFilters,
  ConfirmDialog,
  DataCard,
  DataTable,
  DIARY_SHORTCUTS,
  DiaryBlock,
  EmptyState,
  ErrorState,
  FilterAddButton,
  FilterBar,
  FilterChip,
  FilterSearch,
  FlagPill,
  FormField,
  GLOBAL_SHORTCUTS,
  IconInput,
  KeyboardHint,
  PmsAvatar,
  PmsButton,
  PmsNotice,
  Radio,
  SelectInput,
  ShortcutsSheet,
  SideDrawer,
  SiteSwitcher,
  SkeletonRows,
  StatusPill,
  Switch,
  TextArea,
  TextInput,
  ToastCard,
  UnderlineTabs,
  UnderlineTabsContent,
  UnderlineTabsList,
  UnderlineTabsTrigger,
  useToast,
  type DataTableColumn,
  type DiaryBlockStatus,
  type SortState,
} from "../ui";
import { PartAShowcase } from "./part-a";

const COLOURS = [
  { name: "background", hsl: "210 40% 98%", hex: "#F8FAFC", swatch: "bg-background", on: "text-foreground", sample: "Aa", use: "App canvas" },
  { name: "foreground", hsl: "222 47% 11%", hex: "#0F172A", swatch: "bg-foreground", on: "text-white", sample: "Aa 17.9:1", use: "Body text, headings" },
  { name: "card", hsl: "0 0% 100%", hex: "#FFFFFF", swatch: "bg-card", on: "text-foreground", sample: "Aa", use: "Cards, tables, dialogs" },
  {
    name: "primary",
    hsl: "175 83% 32%",
    hex: "#0E958A",
    swatch: "bg-primary",
    on: "text-white",
    sample: "Aa 3.7:1 – large/UI only",
    use: "Focus ring, icons, selected borders, charts",
  },
  {
    name: "primary-strong ✱",
    hsl: "175 83% 26%",
    hex: "#0B7970",
    swatch: "bg-primary-strong",
    on: "text-white",
    sample: "Aa 5.3:1",
    use: "Filled buttons, links, small teal text",
  },
  { name: "secondary", hsl: "224 76% 40%", hex: "#1842B4", swatch: "bg-secondary", on: "text-white", sample: "Aa 7.6:1", use: "Booked status, info, insurer" },
  { name: "accent", hsl: "38 92% 50%", hex: "#F59F0A", swatch: "bg-accent", on: "text-foreground", sample: "Aa dark text only", use: "Warnings, alerts (fill)" },
  { name: "accent-text ✱", hsl: "32 81% 29%", hex: "#864E0E", swatch: "bg-accent-text", on: "text-white", sample: "Aa 7.0:1", use: "Warning text and icons" },
  { name: "destructive", hsl: "0 84% 60%", hex: "#EF4444", swatch: "bg-destructive", on: "text-white", sample: "Aa 3.8:1 – icons only", use: "Error borders, chart series" },
  { name: "destructive-strong ✱", hsl: "0 74% 42%", hex: "#BA1C1C", swatch: "bg-destructive-strong", on: "text-white", sample: "Aa 6.4:1", use: "Destructive buttons, error text" },
  {
    name: "border",
    hsl: "214 32% 91%",
    hex: "#E2E8F0",
    swatch: "bg-border",
    on: "text-foreground",
    sample: "Aa",
    use: "Card and table rules (inputs use input-strong #CBD5E1 for 3:1)",
  },
  { name: "muted-foreground", hsl: "215 16% 47%", hex: "#64748B", swatch: "bg-muted-foreground", on: "text-white", sample: "Aa 4.8:1", use: "Secondary text, captions" },
] as const;

const TYPE = [
  { spec: "30/36 · 700", cls: "text-[30px] leading-9 font-bold", sample: "Page title" },
  { spec: "24/32 · 600", cls: "text-2xl font-semibold", sample: "Patient name in record header" },
  { spec: "20/28 · 600", cls: "text-xl font-semibold", sample: "Section heading" },
  { spec: "16/24 · 600", cls: "text-base font-semibold", sample: "Card and dialog title" },
  { spec: "14/20 · 400", cls: "text-sm", sample: "Body – base size, tables, forms" },
  { spec: "13/18 · 500", cls: "text-[13px] leading-[18px] font-medium", sample: "Diary block patient name, compact controls" },
  { spec: "12/16 · 500", cls: "text-xs font-medium", sample: "Pills, captions, table headers" },
] as const;

const SPACING = [
  { label: "1 · 4px", w: "w-1", use: "Icon to label" },
  { label: "2 · 8px", w: "w-2", use: "Button groups, pills" },
  { label: "3 · 12px", w: "w-3", use: "Field stacks" },
  { label: "4 · 16px", w: "w-4", use: "Card padding (dense), mobile gutter" },
  { label: "5 · 20px", w: "w-5", use: "Dialog padding" },
  { label: "6 · 24px", w: "w-6", use: "Card padding, page gutter" },
  { label: "8 · 32px", w: "w-8", use: "Section gap" },
  { label: "12 · 48px", w: "w-12", use: "Page top" },
] as const;

const BLOCKS: ReadonlyArray<{ caption: string; status: DiaryBlockStatus; start: string; end: string; title: string; detail: string; initial?: boolean; selected?: boolean }> = [
  { caption: "Booked · initial", status: "booked", start: "09:00", end: "09:45", title: "Margaret Ellis", detail: "Initial assessment", initial: true },
  { caption: "Arrived · follow-up", status: "arrived", start: "10:30", end: "11:00", title: "James Okafor", detail: "Follow-up" },
  { caption: "In treatment", status: "in_treatment", start: "11:00", end: "11:30", title: "Chloe Bennett", detail: "Follow-up" },
  { caption: "Completed", status: "completed", start: "08:00", end: "08:30", title: "Ravi Patel", detail: "Follow-up" },
  { caption: "Did not attend", status: "dna", start: "08:30", end: "09:00", title: "Owen Price", detail: "Follow-up" },
  { caption: "Late cancellation (hatched)", status: "late_cancelled", start: "12:00", end: "12:30", title: "Hannah Wright", detail: "Follow-up" },
  { caption: "Cancelled (hatched)", status: "cancelled", start: "13:00", end: "13:30", title: "George Lewis", detail: "Follow-up" },
  { caption: "Block / unavailable", status: "blocked", start: "12:30", end: "13:30", title: "Lunch", detail: "Not bookable" },
  { caption: "Selected / moving (keyboard)", status: "booked", start: "14:15", end: "14:45", title: "Fatima Begum", detail: "Follow-up", selected: true },
  { caption: "15 minutes – one line", status: "arrived", start: "15:00", end: "15:15", title: "Tom Hughes", detail: "Review" },
];

interface InvoiceRow {
  no: string;
  patient: string;
  date: string;
  sortDate: string;
  status: string;
  amount: string;
  pence: number;
}

const INVOICES: readonly InvoiceRow[] = [
  { no: "INV-04833", patient: "Margaret Ellis", date: "27/10/2026", sortDate: "2026-10-27", status: "issued", amount: "£70.00", pence: 7000 },
  { no: "INV-04830", patient: "Bluewell Health (fictional) – re Liam O’Connor", date: "26/10/2026", sortDate: "2026-10-26", status: "part_paid", amount: "£165.00", pence: 16500 },
  { no: "INV-04821", patient: "Owen Price", date: "02/09/2026", sortDate: "2026-09-02", status: "overdue", amount: "£65.00", pence: 6500 },
];

const SITES = [
  { id: "harbour", name: "Harbour Road", note: "Default" },
  { id: "kingsmead", name: "Kingsmead" },
  { id: "elm", name: "Elm Park" },
  { id: "castle", name: "Castle Street" },
  { id: "mill", name: "Mill Lane" },
];

function Section({ id, title, aside, intro, children }: { id: string; title: string; aside?: string; intro?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
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
// #475569, not muted-foreground: these captions sit on the #F8FAFC canvas, where #64748B is 4.48:1.
const caption = "text-xs text-[#475569]";

export function DesignSystemPreview({ productName }: { productName: string }) {
  const toast = useToast();
  const [mobileOn, setMobileOn] = React.useState(true);
  const [tab, setTab] = React.useState("invoices");
  const [filter, setFilter] = React.useState("");
  const [payerChip, setPayerChip] = React.useState(true);
  const [sort, setSort] = React.useState<SortState | null>({ columnId: "no", direction: "desc" });
  const [page, setPage] = React.useState(1);
  const [tableState, setTableState] = React.useState<"rows" | "loading" | "empty" | "error">("rows");
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [confirmPending, setConfirmPending] = React.useState(false);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [site, setSite] = React.useState("harbour");
  const [sheetOpen, setSheetOpen] = React.useState(false);

  const rows = React.useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = INVOICES.filter((r) => !q || r.no.toLowerCase().includes(q) || r.patient.toLowerCase().includes(q));
    if (!sort) return list;
    const key = (r: InvoiceRow) => (sort.columnId === "no" ? r.no : sort.columnId === "issued" ? r.sortDate : sort.columnId === "amount" ? r.pence : r.patient);
    return [...list].sort((a, b) => {
      const x = key(a);
      const y = key(b);
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return sort.direction === "asc" ? c : -c;
    });
  }, [filter, sort]);

  const columns: DataTableColumn<InvoiceRow>[] = [
    {
      id: "no",
      header: "Invoice",
      sortable: true,
      numeric: true,
      cell: (r) => (
        <a href="#s-data" className="font-medium text-primary-strong underline underline-offset-2">
          {r.no}
        </a>
      ),
    },
    { id: "patient", header: "Patient", sortable: true, truncateAt: 260, cell: (r) => r.patient },
    { id: "issued", header: "Issued", sortable: true, numeric: true, cell: (r) => r.date },
    { id: "status", header: "Status", cell: (r) => <StatusPill kind="invoice" status={r.status} size="sm" /> },
    { id: "amount", header: "Amount", sortable: true, align: "right", numeric: true, cell: (r) => r.amount },
  ];

  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-14 pb-24 pt-4">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-primary-strong">
          <Activity className="h-4 w-4" aria-hidden />
          <span>{productName} · Design system v1</span>
        </div>
        <h1 className="text-[30px] font-bold leading-9 tracking-[-0.01em]">Foundations and components</h1>
        <p className="max-w-[720px] text-[15px] leading-6 text-[#475569]">
          The clinic system&apos;s component kit, built on the existing colour tokens. Dense but calm. Status is always shown as colour, icon and word together. 14 px base, 8–16 px
          radius. Every example below is fictional.
        </p>
      </header>

      <Section id="s-colour" title="Colour tokens" intro="Colour variables already in the app. Strong steps (marked ✱) were added where white text failed AA.">
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(170px,100%),1fr))]">
          {COLOURS.map((c) => (
            <div key={c.name} className={`${card} flex flex-col overflow-hidden`}>
              <div
                className={`flex h-16 items-end border-b border-border px-2.5 py-2 text-xs font-semibold ${c.swatch} ${c.on}`}
                data-contrast-demo={/large\/UI only|icons only/.test(c.sample) ? "fails-aa-on-purpose" : undefined}
              >
                {c.sample}
              </div>
              <div className="flex flex-col gap-0.5 px-3 py-2.5">
                <div className="text-[13px] font-semibold">{c.name}</div>
                <code className="font-mono text-xs text-[#475569]">
                  {c.hsl} · {c.hex}
                </code>
                <div className="text-xs leading-4 text-muted-foreground">{c.use}</div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <div className="grid gap-6 [grid-template-columns:repeat(auto-fit,minmax(min(380px,100%),1fr))]">
        <Section id="s-type" title="Type scale">
          <div className={`${card} px-5 py-2`}>
            {TYPE.map((t) => (
              <div key={t.spec} className="flex items-baseline gap-4 border-b border-[#F1F5F9] py-3 last:border-b-0">
                <code className="w-[120px] shrink-0 font-mono text-xs text-muted-foreground">{t.spec}</code>
                <div className={`min-w-0 truncate ${t.cls}`}>{t.sample}</div>
              </div>
            ))}
          </div>
        </Section>
        <Section id="s-spacing" title="Spacing, radius, elevation">
          <div className={`${card} flex flex-col gap-5 p-5`}>
            <div className="flex flex-col gap-2">
              {SPACING.map((sp) => (
                <div key={sp.label} className="flex items-center gap-3">
                  <code className="w-[72px] font-mono text-xs text-muted-foreground">{sp.label}</code>
                  <div className={`h-3 rounded-[3px] bg-primary ${sp.w}`} aria-hidden />
                  <span className={caption}>{sp.use}</span>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-4">
              {[
                { cls: "rounded-[8px] border-input-strong bg-background", label: "8 px · inputs, buttons" },
                { cls: "rounded-xl border-input-strong bg-background", label: "12 px · dialogs" },
                { cls: "rounded-2xl border-input-strong bg-background", label: "16 px · cards" },
                { cls: "rounded-2xl border-border bg-white shadow-[0_1px_2px_rgba(15,23,42,0.06)]", label: "shadow-sm · cards" },
                { cls: "rounded-xl border-border bg-white shadow-[0_12px_32px_rgba(15,23,42,0.14)]", label: "shadow-lg · overlays" },
              ].map((r) => (
                <div key={r.label} className="flex flex-col items-center gap-1.5">
                  <div className={`h-12 w-[72px] border ${r.cls}`} aria-hidden />
                  <span className={caption}>{r.label}</span>
                </div>
              ))}
            </div>
          </div>
        </Section>
      </div>

      <Section id="s-btn" title="Buttons" aside="PmsButton">
        <div className={`${card} flex flex-col gap-5 p-6`}>
          <div className="flex flex-wrap items-center gap-3">
            <span className={`w-[88px] ${caption}`}>Default 36</span>
            <PmsButton>
              <Plus aria-hidden /> Book appointment
            </PmsButton>
            <PmsButton variant="secondary">Secondary</PmsButton>
            <PmsButton variant="blue">Blue (secondary token)</PmsButton>
            <PmsButton variant="ghost">Ghost</PmsButton>
            <PmsButton variant="destructive">Void invoice</PmsButton>
            <PmsButton variant="link">Link</PmsButton>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className={`w-[88px] ${caption}`}>Sizes</span>
            <PmsButton size="sm">Small 28</PmsButton>
            <PmsButton>Default 36</PmsButton>
            <PmsButton size="lg">Large 44 · mobile</PmsButton>
            <PmsButton size="icon" variant="secondary" aria-label="More actions">
              <MoreHorizontal aria-hidden />
            </PmsButton>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className={`w-[88px] ${caption}`}>States</span>
            <PmsButton className="bg-[#095E57]">Hover</PmsButton>
            <PmsButton className="outline outline-2 outline-offset-2 outline-primary">Focus</PmsButton>
            <PmsButton loading>Saving…</PmsButton>
            <PmsButton disabled>Disabled</PmsButton>
          </div>
        </div>
      </Section>

      <Section id="s-input" title="Inputs" aside="FormField, inputs, checkbox, radio, switch">
        <div className={`${card} grid gap-5 p-6 [grid-template-columns:repeat(auto-fit,minmax(min(260px,100%),1fr))]`}>
          <FormField id="ds-name" label="First name" hint="As it should appear on letters">
            <TextInput defaultValue="Margaret" />
          </FormField>
          <FormField id="ds-sel" label="Service">
            <SelectInput defaultValue="initial">
              <option value="initial">Initial assessment – 45 min</option>
              <option value="follow">Follow-up – 30 min</option>
            </SelectInput>
          </FormField>
          <div className="flex gap-3">
            <FormField id="ds-date" label="Date" className="flex-1">
              <IconInput icon={<Calendar />} defaultValue="27/10/2026" placeholder="DD/MM/YYYY" />
            </FormField>
            <FormField id="ds-time" label="Time" className="w-[104px]">
              <IconInput icon={<Clock />} defaultValue="09:15" />
            </FormField>
          </div>
          <FormField id="ds-search" label="Search">
            <IconInput icon={<Search />} type="search" placeholder="Name, DOB or phone" kbd="/" />
          </FormField>
          <FormField id="ds-err" label="Mobile" error="Enter a UK mobile, e.g. 07700 900123">
            <TextInput type="tel" defaultValue="07700 9001" />
          </FormField>
          <FormField id="ds-ta" label="Reason for cancelling">
            <TextArea defaultValue="Patient unwell – will rebook next week." />
          </FormField>
          <fieldset className="flex flex-col gap-2.5">
            <legend className="mb-2.5 font-medium">Consent</legend>
            <Checkbox label="Appointment reminders by text" defaultChecked />
            <Checkbox label="Marketing emails" />
          </fieldset>
          <fieldset className="flex flex-col gap-2.5">
            <legend className="mb-2.5 font-medium">Repeat</legend>
            <Radio name="ds-r" label="Does not repeat" />
            <Radio name="ds-r" label="Weekly" defaultChecked />
            <Radio name="ds-r" label="Fortnightly" />
          </fieldset>
          <div className="flex flex-col gap-3">
            <span className="font-medium">Switch</span>
            <Switch checked={mobileOn} onCheckedChange={setMobileOn} label="Show cancelled appointments" />
            <Switch checked={false} onCheckedChange={() => undefined} label="Off" />
          </div>
        </div>
      </Section>

      <Section id="s-status" title="Status pills" aside="white-space: nowrap" intro="Every state has its own icon and word. Colour is never the only signal.">
        <div className={`${card} flex flex-col gap-5 p-6`}>
          {(
            [
              ["Appointment", "appointment", ["booked", "arrived", "in_treatment", "completed", "dna", "late_cancelled", "cancelled"]],
              ["Invoice", "invoice", ["draft", "issued", "part_paid", "paid", "overdue", "void"]],
              ["Clinical note", "note", ["draft", "unsigned", "signed", "amended"]],
            ] as const
          ).map(([label, kind, statuses]) => (
            <div key={label} className="flex flex-wrap items-center gap-2">
              <span className="w-[140px] text-xs font-semibold uppercase tracking-[0.04em] text-[#475569]">{label}</span>
              {statuses.map((st) => (
                <StatusPill key={st} kind={kind} status={st} />
              ))}
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-[140px] text-xs font-semibold uppercase tracking-[0.04em] text-[#475569]">Alerts &amp; flags</span>
            <FlagPill variant="alert" icon={<AlertTriangle />}>
              Alert: latex allergy
            </FlagPill>
            <FlagPill icon={<Plus />}>Initial</FlagPill>
            <FlagPill icon={<Shield />}>Insured</FlagPill>
            <FlagPill icon={<Moon />}>Quiet hours</FlagPill>
            <FlagPill icon={<BellOff />}>Opted out of texts</FlagPill>
            <FlagPill icon={<Globe />}>Booked online</FlagPill>
          </div>
        </div>
      </Section>

      <Section
        id="s-diary"
        title="Diary appointment blocks"
        intro="Each block shows time, patient, service, a type marker and status (icon and word). Blocks of 15 minutes or less collapse to one line. Cancelled blocks are hatched so the slot reads as free."
      >
        <div className={`${card} grid gap-4 p-6 [grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr))]`}>
          {BLOCKS.map((b) => (
            <div key={b.caption} className="flex flex-col gap-1.5">
              <span className={caption}>{b.caption}</span>
              <DiaryBlock status={b.status} start={b.start} end={b.end} title={b.title} detail={b.detail} initial={b.initial} selected={b.selected} />
            </div>
          ))}
        </div>
      </Section>

      <Section id="s-data" title="Tables, filters, pagination, tabs" aside="DataTable">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-[#475569]">Show the table as:</span>
          {(["rows", "loading", "empty", "error"] as const).map((st) => (
            <PmsButton key={st} size="sm" variant={tableState === st ? "primary" : "secondary"} aria-pressed={tableState === st} onClick={() => setTableState(st)}>
              {st === "rows" ? "Rows" : st === "loading" ? "Loading" : st === "empty" ? "Empty" : "Error"}
            </PmsButton>
          ))}
        </div>
        <UnderlineTabs value={tab} onValueChange={setTab} className={`${card} overflow-hidden`}>
          <UnderlineTabsList aria-label="Billing">
            {["Invoices", "Aged debt", "Remittances", "Statements"].map((t) => (
              <UnderlineTabsTrigger key={t} value={t.toLowerCase().replace(/\s+/g, "-")}>
                {t}
              </UnderlineTabsTrigger>
            ))}
          </UnderlineTabsList>
          <UnderlineTabsContent value="invoices" className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary">
            <DataTable
              className="rounded-none border-0"
              label="Invoices"
              columns={columns}
              rows={tableState === "empty" ? [] : rows}
              rowKey={(r) => r.no}
              loading={tableState === "loading"}
              error={
                tableState === "error" ? (
                  <ErrorState title="Couldn't load invoices" action={<PmsButton onClick={() => setTableState("rows")}>Try again</PmsButton>}>
                    Check your connection and try again. If it keeps happening, contact your clinic&apos;s administrator.
                  </ErrorState>
                ) : undefined
              }
              empty={<EmptyState title="No invoices match">Clear the filters to see every invoice.</EmptyState>}
              sort={sort}
              onSortChange={setSort}
              filters={
                <FilterBar>
                  <FilterSearch id="ds-f" label="Filter invoices" placeholder="Invoice no. or patient" value={filter} onChange={setFilter} />
                  <FilterAddButton>Status</FilterAddButton>
                  {payerChip ? <FilterChip onRemove={() => setPayerChip(false)}>Payer: Insurer</FilterChip> : null}
                  <ClearFilters
                    onClick={() => {
                      setFilter("");
                      setPayerChip(false);
                    }}
                  />
                </FilterBar>
              }
              pagination={{ page, pageSize: 25, total: 312, onPageChange: setPage }}
              renderCard={(r) => (
                <DataCard
                  title={
                    <a href="#s-data" className="text-primary-strong underline underline-offset-2">
                      {r.no}
                    </a>
                  }
                  status={<StatusPill kind="invoice" status={r.status} size="sm" />}
                  meta={`${r.patient} · issued ${r.date}`}
                  figure={r.amount}
                />
              )}
            />
          </UnderlineTabsContent>
          {["aged-debt", "remittances", "statements"].map((v) => (
            <UnderlineTabsContent key={v} value={v} className="p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary">
              <EmptyState title="Example only" className="border-0">
                The design shows this tab&apos;s name only; its screen comes with billing.
              </EmptyState>
            </UnderlineTabsContent>
          ))}
        </UnderlineTabs>
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(340px,100%),1fr))]">
          <div className="flex flex-col gap-2">
            <span className={caption}>Table → cards at 375 px</span>
            <DataCard
              className="max-w-[343px]"
              title={
                <a href="#s-data" className="text-primary-strong underline underline-offset-2">
                  INV-04821
                </a>
              }
              status={<StatusPill kind="invoice" status="overdue" size="sm" />}
              meta="Owen Price · issued 02/09/2026"
              figure="£65.00"
            />
          </div>
          <div className="flex flex-col gap-2">
            <span className={caption}>Loading skeleton</span>
            <SkeletonRows label="Loading invoices" />
          </div>
        </div>
      </Section>

      <Section id="s-feedback" title="Notices, toasts, empty and error states" aside="PmsNotice, useToast">
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(260px,100%),1fr))]">
          <PmsNotice tone="info" title="Quiet hours are on">
            Texts sent between 20:00 and 08:00 are held and go out at 08:00.
          </PmsNotice>
          <PmsNotice tone="warning" title="1 authorised session left">
            Bluewell Health (fictional) authorisation BW-55021 – ask for an extension.
          </PmsNotice>
          <PmsNotice tone="error" title="This slot clashes" role="note">
            Priya Shah already has Chloe Bennett at 11:00–11:30.
          </PmsNotice>
          <PmsNotice tone="success" title="Note signed" role="note">
            Signed by Priya Shah (PH-DEMO-01) at 11:42. The note is now locked.
          </PmsNotice>
        </div>
        <div className="grid items-start gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr))]">
          <div className="flex flex-col gap-2">
            <span className={caption}>Toasts – bottom right, 5 s, pause on hover</span>
            <ToastCard item={{ id: 1, tone: "success", message: "Margaret Ellis marked as arrived", action: { label: "Undo", onClick: () => undefined } }} />
            <ToastCard item={{ id: 2, tone: "error", message: "Reminder to 07700 900412 failed to send", action: { label: "Retry", onClick: () => undefined } }} />
            <div className="mt-1 flex flex-wrap gap-2">
              <PmsButton
                size="sm"
                variant="secondary"
                onClick={() => toast.success("Margaret Ellis marked as arrived", { action: { label: "Undo", onClick: () => toast.success("Arrival undone") } })}
              >
                Show a toast
              </PmsButton>
              <PmsButton
                size="sm"
                variant="secondary"
                onClick={() => toast.error("Reminder to 07700 900412 failed to send", { action: { label: "Retry", onClick: () => undefined } })}
              >
                Show an error toast
              </PmsButton>
            </div>
          </div>
          <EmptyState title="No one on the waiting list" action={<PmsButton variant="secondary">Add to waiting list</PmsButton>}>
            When a patient wants an earlier slot, add them here and you&apos;ll be prompted when one frees up.
          </EmptyState>
          <ErrorState title="Couldn't load invoices" action={<PmsButton>Try again</PmsButton>}>
            Check your connection and try again. If it keeps happening, contact your clinic&apos;s administrator.
          </ErrorState>
        </div>
      </Section>

      <Section id="s-overlay" title="Dialogs and side drawers" aside="ConfirmDialog, SideDrawer">
        <div className={`${card} flex flex-wrap items-center gap-3 p-6`}>
          <PmsButton variant="destructive" onClick={() => setConfirmOpen(true)}>
            Cancel appointment…
          </PmsButton>
          <PmsButton variant="secondary" onClick={() => setDrawerOpen(true)}>
            Open appointment details
          </PmsButton>
          <span className={caption}>Esc closes both; focus returns to the button.</span>
        </div>
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title="Cancel appointment?"
          description={
            <>
              Tue 27/10/2026, 14:00 with Priya Shah. This is within 24 hours, so it will be recorded as a <strong>Late cancellation</strong>.
            </>
          }
          confirmLabel="Cancel appointment"
          cancelLabel="Keep appointment"
          destructive
          pending={confirmPending}
          onConfirm={() => {
            setConfirmPending(true);
            window.setTimeout(() => {
              setConfirmPending(false);
              setConfirmOpen(false);
              toast.success("Appointment cancelled (example – nothing was changed)");
            }, 900);
          }}
        >
          <FormField id="dlg-r" label="Reason">
            <SelectInput defaultValue="unwell">
              <option value="unwell">Patient unwell</option>
              <option value="work">Work commitments</option>
            </SelectInput>
          </FormField>
          <Checkbox className="mt-2" label="Charge late cancellation fee (£55.00)" defaultChecked />
        </ConfirmDialog>
        <SideDrawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          eyebrow="Appointment"
          title="James Okafor"
          meta={<StatusPill kind="appointment" status="arrived" label="Arrived 10:27" size="sm" />}
          footer={
            <>
              <PmsButton>Start treatment</PmsButton>
              <PmsButton variant="secondary">Open record</PmsButton>
            </>
          }
        >
          <div>Follow-up · 30 min · £55.00</div>
          <div>Tom Hughes · Room 2 · Harbour Road</div>
        </SideDrawer>
      </Section>

      <Section id="s-nav" title="Site switcher, avatars, keyboard hints">
        <div className="grid items-start gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr))]">
          <div className={`${card} flex min-h-[380px] flex-col gap-2 p-4`}>
            <SiteSwitcher sites={SITES} value={site} onChange={setSite} totalSites={11} allNote="Reports only" defaultOpen />
          </div>
          <div className={`${card} flex flex-col gap-3.5 p-4`}>
            <span className={caption}>Avatar – initials, colour picked from name, 24/32/40</span>
            <div className="flex items-center gap-3">
              <PmsAvatar name="Priya Shah" size={40} />
              <PmsAvatar name="Tom Hughes" size={32} />
              <PmsAvatar name="Amira Rahman" size={32} />
              <PmsAvatar name="Dan Morgan" size={24} />
              <span className="flex flex-col">
                <strong className="font-semibold">Priya Shah</strong>
                <span className={caption}>Physiotherapist · PH-DEMO-01</span>
              </span>
            </div>
          </div>
          <div className={`${card} flex flex-col gap-2 p-4`}>
            <span className={caption}>Keyboard hints – shown in menus and the ? sheet</span>
            {[GLOBAL_SHORTCUTS[0], ...DIARY_SHORTCUTS, GLOBAL_SHORTCUTS[1]].map((s) => (
              <KeyboardHint key={s.label} shortcut={s} />
            ))}
            <PmsButton size="sm" variant="secondary" className="mt-2 self-start" onClick={() => setSheetOpen(true)}>
              Open the shortcuts sheet
            </PmsButton>
          </div>
        </div>
        <ShortcutsSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          groups={[
            { title: "Everywhere", shortcuts: GLOBAL_SHORTCUTS },
            { title: "Diary (when its screens land)", shortcuts: DIARY_SHORTCUTS },
          ]}
        />
      </Section>

      <PartAShowcase />
    </div>
  );
}
