"use client";
/**
 * "Today" – the clinic system's start page per role (design round 3: Dashboard.dc.html at 1440 px,
 * DashboardMobile.dc.html at 375 px). Draws the server's view model (src/modules/pms/reporting/dashboard.ts);
 * the buttons run the modules' own server actions (Retry a failed message, mark a patient Arrived, send an
 * invoice reminder or a payment link) and the page refreshes every minute.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import {
  Activity,
  AlertCircle,
  BarChart3,
  Calendar,
  Check,
  Clock,
  FileText,
  Home,
  MessageSquare,
  PoundSterling,
  Send,
  ShieldCheck,
  TriangleAlert,
  UserCheck,
  Users,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { setAppointmentStatusAction } from "@/app/app/clinic/diary/actions";
import { emailInvoiceAction, retryMessageAction, sendPaymentLinkAction } from "@/app/app/clinic/messages/actions";
import { cn } from "@/lib/utils";
import type { DashboardAction, DashboardCard, DashboardIcon, DashboardKpi, DashboardListItem, DashboardPill, DashboardView, PillTone } from "@/modules/pms/reporting/dashboard";
import { PmsButton, PmsNotice, useToast } from "@/components/pms/ui";

const ICONS: Readonly<Record<DashboardIcon | "activity" | "x" | "send", LucideIcon>> = {
  calendar: Calendar,
  chart: BarChart3,
  pound: PoundSterling,
  alert: AlertCircle,
  file: FileText,
  users: Users,
  "user-check": UserCheck,
  message: MessageSquare,
  clock: Clock,
  shield: ShieldCheck,
  activity: Activity,
  x: XCircle,
  send: Send,
};

const PILL: Readonly<Record<PillTone, string>> = {
  blue: "bg-[#E8EEFB] text-[#1842B4]",
  amber: "bg-[#FEF3C7] text-[#864E0E]",
  teal: "bg-[#D5F5F0] text-[#0B5F58]",
  red: "bg-[#FEE2E2] text-[#991B1B]",
  green: "bg-[#DCFCE7] text-[#166534]",
};

const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

export function Dashboard({ view, demo = false }: { view: DashboardView; demo?: boolean }) {
  const router = useRouter();
  // Refreshes every minute (design: "refreshes every minute").
  React.useEffect(() => {
    const t = window.setInterval(() => router.refresh(), 60_000);
    return () => window.clearInterval(t);
  }, [router]);

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[1200px] flex-col gap-4 pb-20 md:pb-0" data-testid="dashboard" data-role={view.role}>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold leading-7 text-foreground md:text-2xl">Today</h1>
          <p className="text-sm text-[#475569]">{view.subtitle}</p>
        </div>
        <p className="text-xs text-[#475569]">{view.updatedAt} · refreshes every minute</p>
      </div>
      {demo ? <PmsNotice tone="warning" title="Demonstration clinic">Every patient, practitioner and organisation here is fictional.</PmsNotice> : null}
      {view.noSites ? (
        <PmsNotice tone="info" title="No sites yet.">
          The diary, online booking and these figures start once the clinic has a site.{" "}
          <Link href="/app/clinic/setup/sites" className="font-medium underline underline-offset-2">
            Add a site in Set-up
          </Link>
          .
        </PmsNotice>
      ) : null}
      {view.partial ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-2.5 text-sm text-[#991B1B]">
          <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
          <span className="flex-1">Some figures couldn&apos;t load. The rest of the page is up to date.</span>
          <PmsButton size="sm" variant="secondary" onClick={() => router.refresh()}>
            Try again
          </PmsButton>
        </div>
      ) : null}
      <section aria-label="Today in figures">
        <ul className="grid grid-cols-2 gap-2 md:gap-3 xl:grid-cols-4">
          {view.kpis.map((k) => (
            <li key={k.id} className="min-w-0">
              <Kpi k={k} />
            </li>
          ))}
        </ul>
      </section>
      <div className="grid gap-3 lg:grid-cols-2 lg:gap-4">
        {view.cards.map((c) => (
          <Card key={c.id} card={c} />
        ))}
      </div>
      <MobileTabs />
    </div>
  );
}

function Kpi({ k }: { k: DashboardKpi }) {
  const Icon = ICONS[k.icon];
  const body = (
    <>
      <span className="flex items-center gap-1.5 text-[13px] text-[#334155]">
        <Icon className={cn("h-3.5 w-3.5 shrink-0", k.warn ? "text-[#BA1C1C]" : "text-[#0B7970]")} aria-hidden />
        {k.label}
      </span>
      {k.value === null ? (
        <span className="mt-2 text-sm text-[#991B1B]">Couldn&apos;t load</span>
      ) : (
        <>
          <strong className={cn("mt-1 block text-[22px] font-bold tabular-nums leading-8 md:text-[26px]", k.warn ? "text-[#BA1C1C]" : "text-foreground")} data-testid={`kpi-${k.id}`}>
            {k.value}
          </strong>
          <span className="mt-0.5 block text-xs text-[#475569]">{k.sub}</span>
        </>
      )}
    </>
  );
  const box = "flex h-full min-h-[96px] flex-col rounded-[14px] border border-border bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] md:p-4";
  return k.href ? (
    <Link href={k.href} className={cn(box, "hover:border-[#CBD5E1]", focusRing)}>
      {body}
    </Link>
  ) : (
    <div className={box}>{body}</div>
  );
}

function Card({ card }: { card: DashboardCard }) {
  const headingId = `dash-${card.id}`;
  const empty = !card.failed && (card.kind === "list" ? card.items.length === 0 : card.bars.length === 0);
  return (
    <section aria-labelledby={headingId} className="min-w-0 rounded-[14px] border border-border bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]" data-testid={`card-${card.id}`}>
      <div className="flex items-center gap-2 border-b border-[#F1F5F9] px-4 py-3 md:px-5">
        <h2 id={headingId} className="min-w-0 flex-1 truncate text-base font-semibold text-foreground">
          {card.title}
        </h2>
        {card.countLabel ? (
          <span className="rounded-full bg-[#F1F5F9] px-2 text-xs font-semibold leading-5 text-[#334155]">{card.countLabel}</span>
        ) : card.count !== null && card.count > 0 ? (
          <span className={cn("rounded-full px-2 text-xs font-semibold leading-5", card.warn ? "bg-[#FEE2E2] text-[#991B1B]" : "bg-[#F1F5F9] text-[#334155]")} data-testid={`count-${card.id}`}>
            {card.count}
          </span>
        ) : null}
        {card.link ? (
          <Link href={card.link.href} className={cn("text-sm font-medium text-[#0B7970] underline underline-offset-2 hover:text-[#095E57]", focusRing)}>
            {card.link.text}
            <span className="sr-only"> – {card.title}</span>
          </Link>
        ) : null}
      </div>
      {card.failed ? (
        <div role="alert" className="flex items-center gap-2 px-5 py-4 text-sm text-[#991B1B]">
          <AlertCircle className="h-[18px] w-[18px] shrink-0" aria-hidden />
          <span>Couldn&apos;t load this card.</span>
        </div>
      ) : empty ? (
        <div className="flex flex-col items-center gap-1 px-5 py-6 text-center text-sm">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#DCFCE7] text-[#166534]">
            <Check className="h-5 w-5" aria-hidden />
          </span>
          <strong className="text-foreground">{card.empty.title}</strong>
          <span className="text-[#475569]">{card.empty.body}</span>
        </div>
      ) : card.kind === "bars" ? (
        <Bars card={card} />
      ) : (
        <ul className="divide-y divide-[#F1F5F9]">
          {card.items.map((i) => (
            <Row key={i.id} item={i} />
          ))}
        </ul>
      )}
    </section>
  );
}

function Bars({ card }: { card: DashboardCard }) {
  const target = card.target ?? 80;
  return (
    <div className="flex flex-col gap-2.5 px-4 py-3 md:px-5">
      <ul className="flex flex-col gap-2.5">
        {card.bars.map((b) => (
          <li key={b.id} className="grid grid-cols-[minmax(0,8.5rem)_1fr_3rem] items-center gap-3 text-sm">
            <span className="truncate text-foreground">{b.label}</span>
            <span role="img" aria-label={`${b.label}: ${b.percent} percent booked, target ${target} percent`} className="relative h-3 rounded-full bg-[#F1F5F9]">
              <span className={cn("absolute inset-y-0 left-0 rounded-full", b.onTarget ? "bg-[#0B5F58]" : "bg-[#5EC4B9]")} style={{ width: `${Math.min(100, b.percent)}%` }} />
              <span className="absolute -bottom-0.5 -top-0.5 border-l-2 border-dashed border-[#334155]" style={{ left: `${target}%` }} aria-hidden />
            </span>
            <span className="text-right font-semibold tabular-nums text-foreground">{b.percent}%</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-[#475569]">Dashed line = {target}% target. Darker bars are at or above target.</p>
    </div>
  );
}

function Pill({ pill }: { pill: DashboardPill }) {
  const Icon = ICONS[pill.icon];
  return (
    <span className={cn("inline-flex h-[22px] shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 text-xs font-medium", PILL[pill.tone])}>
      <Icon className="h-3 w-3" aria-hidden />
      {pill.label}
    </span>
  );
}

function Row({ item }: { item: DashboardListItem }) {
  return (
    <li className="flex items-center gap-3 px-4 py-3 md:px-5" data-testid="dash-row">
      {item.lead ? <span className="w-11 shrink-0 text-sm font-semibold tabular-nums text-foreground">{item.lead}</span> : null}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-1.5">
          {item.href ? (
            <Link href={item.href} className={cn("truncate font-semibold text-foreground hover:underline", focusRing)}>
              {item.primary}
            </Link>
          ) : (
            <span className="truncate font-semibold text-foreground">{item.primary}</span>
          )}
          {item.alert ? <TriangleAlert role="img" aria-label="Has alert" className="h-3.5 w-3.5 shrink-0 text-[#864E0E]" /> : null}
        </span>
        <span className="text-[13px] text-[#475569]">{item.secondary}</span>
      </span>
      {item.pill ? <Pill pill={item.pill} /> : null}
      {item.action ? <RowAction action={item.action} name={item.primary} /> : null}
    </li>
  );
}

function RowAction({ action, name }: { action: DashboardAction; name: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState<string | null>(null);
  if (action.kind === "link") {
    return (
      <Link
        href={action.href}
        className={cn(
          "inline-flex h-8 shrink-0 items-center rounded-[8px] px-3 text-sm font-medium",
          action.primary ? "bg-primary-strong text-white hover:opacity-90" : "border border-border bg-white text-foreground hover:bg-[#F8FAFC]",
          focusRing,
        )}
      >
        {action.label}
        <span className="sr-only"> – {name}</span>
      </Link>
    );
  }
  if (done) return <span className="shrink-0 text-xs font-medium text-[#166534]">{done}</span>;
  const run = async () => {
    setBusy(true);
    let r: { ok: boolean; error?: string };
    let ok = "Done.";
    if (action.kind === "retry") {
      r = await retryMessageAction(action.messageId);
      ok = "Sent again.";
    } else if (action.kind === "arrived") {
      r = await setAppointmentStatusAction({ id: action.appointmentId, expectedRev: action.rev, status: "arrived" });
      ok = `${name} has arrived.`;
    } else if (action.kind === "send-reminder") {
      r = await emailInvoiceAction(action.invoiceId);
      ok = "Reminder sent.";
    } else {
      r = await sendPaymentLinkAction(action.invoiceId, "sms");
      ok = "Payment link sent.";
    }
    setBusy(false);
    if (!r.ok) {
      toast.error(r.error ?? "That did not work. Try again.");
      return;
    }
    toast.success(ok);
    setDone(action.kind === "arrived" ? "Arrived" : "Sent");
    router.refresh();
  };
  return (
    <PmsButton size="sm" variant={action.kind === "arrived" ? "primary" : "secondary"} loading={busy} onClick={() => void run()} data-testid={`dash-action-${action.kind}`}>
      {action.label}
      <span className="sr-only"> – {name}</span>
    </PmsButton>
  );
}

/** 375 px: the design's bottom tabs (Today, Diary, Patients, Messages). */
function MobileTabs() {
  const tabs: { href: string; label: string; Icon: LucideIcon; current?: boolean }[] = [
    { href: "/app/clinic", label: "Today", Icon: Home, current: true },
    { href: "/app/clinic/diary", label: "Diary", Icon: Calendar },
    { href: "/app/clinic/patients", label: "Patients", Icon: Users },
    { href: "/app/clinic/messages", label: "Messages", Icon: MessageSquare },
  ];
  return (
    <nav aria-label="Quick links" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-border bg-white md:hidden">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.current ? "page" : undefined}
          className={cn("flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium", t.current ? "text-[#0B5F58]" : "text-[#475569]", focusRing)}
        >
          <t.Icon className="h-5 w-5" aria-hidden />
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
