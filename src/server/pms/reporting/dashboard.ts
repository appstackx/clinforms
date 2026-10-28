/**
 * "Today" – the clinic system's start page per role (design round 3, dashboard per role + 375 px). Builds the view
 * model of src/modules/pms/reporting/dashboard.ts from the modules' own read functions (diary, records, billing,
 * messages) – never another module's tables directly – within the member's site scope (actor.siteIds) and
 * permissions: a tile is only there for who may see its data. Each tile is read on its own; one that fails says
 * "Couldn't load" and the rest of the page still shows (logged without data).
 *
 *   owners / administrators: appointments today, utilisation today by site vs the target, taken today by method,
 *     overdue invoices (Send reminder / Payment link), failed messages (Retry), authorisations ending soon
 *     (Request extension = a letter to the insurer).
 *   clinicians: my appointments today and my next patients, unsigned notes, outcome measures due, open cases.
 *   reception: appointments today at the chosen site and the arrivals (Arrived), waiting list, invoices to raise,
 *     replies to answer.
 */
import "server-only";
import { pmsNow } from "../../../modules/pms/core/clock";
import { ukToday } from "../../../modules/pms/core/text";
import { statusAllowedAt } from "../../../modules/pms/diary/rules";
import { addDays, formatLondonTime, londonDayRange } from "../../../modules/pms/diary/time";
import {
  dashboardRoleOf,
  percentText,
  pounds,
  type DashboardCard,
  type DashboardKpi,
  type DashboardListItem,
  type DashboardPill,
  type DashboardRole,
  type DashboardView,
} from "../../../modules/pms/reporting/dashboard";
import { logAuthEvent } from "../../email/log";
import { listPractitioners, listServices, listSites } from "../../repos/pms/directory";
import { listDiary } from "../../repos/pms/diary/appointments";
import { billingFigures, listInvoicesPage } from "../../repos/pms/billing/invoices";
import { getPatientSummaries } from "../../repos/pms/patients";
import { listReferrers } from "../../repos/pms/referrers";
import { getReportingSettings } from "../../repos/pms/reporting/settings";
import { utilisationTodayBySite } from "./today";
import { authorisationsAtRisk, caseOutcomeFigures, openCasesOf } from "../../repos/pms/reporting/dashboard-figures";
import type { ClinicActor } from "../actor";
import { currentPractitionerId } from "../actor";
import { failedMessagesSummaryFor, repliesFor } from "../comms/views";
import { uninvoicedVisitsFor } from "../billing/views";
import { diaryCallerOf } from "../diary/caller";
import { loadWaitingList } from "../diary/reads";
import { unsignedNotesFor } from "../records/notes-service";

const BASE = "/app/clinic";
const PATIENT = (id: string) => `${BASE}/patients/${id}`;

/** Seen today (as the Attendance report: arrived and in treatment count as attended; "Completed" = attended). */
const DONE = new Set(["arrived", "in_treatment", "attended"]);

class TileFailed extends Error {}

async function tile<T>(what: string, work: () => Promise<T>): Promise<T | TileFailed> {
  try {
    return await work();
  } catch (err) {
    logAuthEvent("pms.dashboard.tile_failed", { tile: what, error: err instanceof Error ? err.name : "unknown" });
    return new TileFailed(what);
  }
}

function nameOf(p: { firstName: string; lastName: string; preferredName: string | null } | undefined): string {
  if (!p) return "Patient";
  return `${p.preferredName || p.firstName} ${p.lastName}`;
}

function dayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return `${dt.toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" })} ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

const STATUS_PILL: Readonly<Record<string, DashboardPill>> = {
  booked: { tone: "blue", label: "Booked", icon: "calendar" },
  arrived: { tone: "amber", label: "Arrived", icon: "user-check" },
  in_treatment: { tone: "teal", label: "In treatment", icon: "activity" },
  attended: { tone: "green", label: "Completed", icon: "user-check" },
  dna: { tone: "red", label: "Did not attend", icon: "x" },
};

export interface DashboardOptions {
  /** The shell's chosen site (reception's "Arrivals at …"); null/"all" = every site in scope. */
  siteChoice?: string | null;
}

/** Today for the signed-in member. */
export async function dashboardFor(actor: ClinicActor, options: DashboardOptions = {}): Promise<DashboardView> {
  const role: DashboardRole = dashboardRoleOf(actor.role);
  const ctx = actor.repo();
  const now = pmsNow();
  const today = ukToday(now);
  const allSites = await listSites(ctx, actor.tenantId);
  const sites = actor.siteIds === null ? allSites : allSites.filter((s) => actor.siteIds?.has(s.id));
  const chosen = options.siteChoice && sites.some((s) => s.id === options.siteChoice) ? options.siteChoice : null;
  const siteName = new Map(allSites.map((s) => [s.id, s.name]));
  const scopeIds = sites.map((s) => s.id);
  const sitesText = sites.length === allSites.length ? (allSites.length === 1 ? "1 site" : `all ${allSites.length} sites`) : `my ${sites.length} site${sites.length === 1 ? "" : "s"}`;
  const range = londonDayRange(today);

  const kpis: DashboardKpi[] = [];
  const cards: DashboardCard[] = [];
  let partial = false;
  const failedKpi = (k: Omit<DashboardKpi, "value" | "sub">): DashboardKpi => {
    partial = true;
    return { ...k, value: null, sub: "" };
  };
  const failedCard = (c: Omit<DashboardCard, "failed" | "items" | "bars" | "count">): DashboardCard => {
    partial = true;
    return { ...c, failed: true, items: [], bars: [], count: null };
  };

  // Today's diary within scope (read once, used by several tiles).
  const diaryToday = await tile("diary_today", async () => {
    if (!actor.can("diary.view") || scopeIds.length === 0) return [];
    const out: Awaited<ReturnType<typeof listDiary>>["items"] = [];
    for (let i = 0; i < scopeIds.length; i += 90) {
      const r = await listDiary(ctx, actor.tenantId, { ...range, siteIds: scopeIds.slice(i, i + 90), appointmentsOnly: true, limit: 500 });
      out.push(...r.items);
    }
    return out.filter((a) => a.startsOn === today);
  });

  if (role === "manager") {
    // Appointments today.
    if (actor.can("diary.view")) {
      if (diaryToday instanceof TileFailed) kpis.push(failedKpi({ id: "appointments", label: "Appointments today", icon: "calendar", href: `${BASE}/diary` }));
      else {
        const done = diaryToday.filter((a) => DONE.has(a.status)).length;
        const dna = diaryToday.filter((a) => a.status === "dna").length;
        const withAppointments = new Set(diaryToday.map((a) => a.siteId)).size;
        kpis.push({
          id: "appointments",
          label: "Appointments today",
          icon: "calendar",
          value: diaryToday.length.toLocaleString("en-GB"),
          sub: `${done} done · ${dna} DNA · ${withAppointments} site${withAppointments === 1 ? "" : "s"}`,
          href: `${BASE}/diary`,
        });
      }
    }
    // Utilisation today, overall and by site.
    const util = await tile("utilisation_today", async () => {
      // The Utilisation report's own figures for today (booked minutes against rota time clipped to opening hours).
      const [settings, r] = await Promise.all([getReportingSettings(ctx, actor.tenantId), utilisationTodayBySite(actor, { now })]);
      if (!r.ok) throw new Error(r.error);
      const rows = r.value
        .filter((x) => x.availableMinutes !== null && x.availableMinutes > 0)
        .map((x) => ({ siteId: x.siteId, name: x.siteName, booked: x.bookedMinutes, available: x.availableMinutes ?? 0, value: x.utilisation ?? 0 }))
        .sort((x, y) => x.name.localeCompare(y.name));
      const totalAvail = rows.reduce((t, x) => t + x.available, 0);
      const totalBooked = rows.reduce((t, x) => t + x.booked, 0);
      return { target: settings.utilisationTargetPercent, rows, overall: totalAvail > 0 ? totalBooked / totalAvail : null };
    });
    if (actor.can("reports.all")) {
      if (util instanceof TileFailed) kpis.push(failedKpi({ id: "utilisation", label: "Utilisation today", icon: "chart", href: `${BASE}/reports/utilisation` }));
      else {
        const lowest = util.rows.slice().sort((a, b) => a.value - b.value)[0];
        kpis.push({
          id: "utilisation",
          label: "Utilisation today",
          icon: "chart",
          value: percentText(util.overall),
          sub: `Target ${util.target}%${lowest ? ` · lowest ${lowest.name} ${Math.round(lowest.value * 100)}%` : ""}`,
          href: actor.can("reports.all") || actor.can("reports.own") ? `${BASE}/reports/utilisation` : null,
        });
      }
    }
    // Taken today (by method) and overdue invoices: billing's own figures, as on Billing.
    if (actor.can("billing.view")) {
      const overdue = await tile("billing_today", async () => {
        const [figures, page] = await Promise.all([
          billingFigures(ctx, actor.tenantId, { siteIds: actor.siteIds }),
          listInvoicesPage(ctx, actor.tenantId, { state: "overdue", siteIds: actor.siteIds, limit: 200 }),
        ]);
        const rows = page.rows.slice().sort((a, b) => (a.dueOn ?? "").localeCompare(b.dueOn ?? "")).slice(0, 4);
        const patients = await getPatientSummaries(ctx, actor.tenantId, rows.map((r) => r.patientId));
        const payers = new Map((await listReferrers(ctx, actor.tenantId, { includeInactive: true, limit: 500 })).map((r) => [r.id, r.name]));
        const over30 = page.rows.filter((r) => r.dueOn && r.dueOn <= addDays(today, -30)).length;
        return { figures, total: page.total, over30, rows, patients, payers };
      });
      if (overdue instanceof TileFailed) kpis.push(failedKpi({ id: "taken", label: "Taken today", icon: "pound", href: `${BASE}/billing` }));
      else {
        const by = overdue.figures.takenTodayByMethod;
        const label = (m: string) => (m === "bank_transfer" ? "bank" : m === "online" ? "online" : m);
        const parts = Object.entries(by)
          .filter(([, p]) => p > 0)
          .sort((x, y) => y[1] - x[1])
          .map(([m, p]) => `${label(m)} ${pounds(p)}`);
        kpis.push({ id: "taken", label: "Taken today", icon: "pound", value: pounds(overdue.figures.takenTodayPence), sub: parts.length ? cap(parts.join(" · ")) : "Nothing taken yet", href: `${BASE}/billing` });
      }
      if (overdue instanceof TileFailed) {
        kpis.push(failedKpi({ id: "overdue", label: "Overdue invoices", icon: "alert", href: `${BASE}/billing?state=overdue`, warn: true }));
        cards.push(failedCard({ id: "overdue", title: "Overdue invoices", link: { href: `${BASE}/billing?tab=aged`, text: "Aged debt" }, kind: "list", empty: EMPTY.overdue }));
      } else {
        const overduePence = overdue.figures.overduePence;
        kpis.push({
          id: "overdue",
          label: "Overdue invoices",
          icon: "alert",
          value: pounds(overduePence),
          sub: `${overdue.total} invoice${overdue.total === 1 ? "" : "s"} overdue · ${overdue.over30} over 30 days`,
          href: `${BASE}/billing?state=overdue`,
          warn: overduePence > 0,
        });
        const items: DashboardListItem[] = overdue.rows.map((inv) => {
          const days = inv.dueOn ? Math.max(1, daysBetween(inv.dueOn, today)) : 0;
          const who = inv.billTo === "payer" && inv.payerReferrerId ? (overdue.payers.get(inv.payerReferrerId) ?? "Payer account") : nameOf(overdue.patients.get(inv.patientId));
          const canMail = actor.can("messages.send");
          const action =
            inv.billTo === "patient" && canMail && actor.can("billing.pay")
              ? ({ kind: "payment-link", invoiceId: inv.id, label: "Payment link" } as const)
              : canMail
                ? ({ kind: "send-reminder", invoiceId: inv.id, label: "Send reminder" } as const)
                : null;
          return {
            id: inv.id,
            primary: who,
            href: `${BASE}/billing/invoices/${inv.id}`,
            secondary: `${inv.number ?? "Draft"} · ${pounds(inv.balancePence)} · ${days} day${days === 1 ? "" : "s"} overdue`,
            pill: { tone: "red", label: days > 30 ? "Over 30 days" : "Overdue", icon: "alert" },
            action,
          };
        });
        cards.push({ id: "overdue", title: "Overdue invoices", count: overdue.total, warn: overdue.total > 0, link: { href: `${BASE}/billing?tab=aged`, text: "Aged debt" }, kind: "list", items, bars: [], empty: EMPTY.overdue });
      }
    }
    // Today by site (bars).
    if (actor.can("reports.all")) {
      if (util instanceof TileFailed) cards.unshift(failedCard({ id: "by-site", title: "Today by site", link: { href: `${BASE}/diary`, text: "Diary" }, kind: "bars", empty: EMPTY.bySite }));
      else {
        cards.unshift({
          id: "by-site",
          title: "Today by site",
          count: null,
          countLabel: `${util.rows.length} of ${allSites.length} site${allSites.length === 1 ? "" : "s"}`,
          link: { href: `${BASE}/diary`, text: "Diary" },
          kind: "bars",
          items: [],
          bars: util.rows.map((r) => ({ id: r.siteId, label: r.name, percent: Math.round(r.value * 100), onTarget: r.value * 100 >= util.target })),
          target: util.target,
          empty: EMPTY.bySite,
        });
      }
    }
    // Failed messages with Retry.
    if (actor.can("messages.send")) {
      const failed = await tile("failed_messages", () => failedMessagesSummaryFor(actor));
      if (failed instanceof TileFailed) cards.splice(1, 0, failedCard({ id: "failed", title: "Failed messages", link: { href: `${BASE}/messages?filter=failed`, text: "Outbox" }, kind: "list", empty: EMPTY.failed }));
      else
        cards.splice(1, 0, {
          id: "failed",
          title: "Failed messages",
          count: failed.count,
          warn: failed.count > 0,
          link: { href: `${BASE}/messages?filter=failed`, text: "Outbox" },
          kind: "list",
          items: failed.rows.slice(0, 4).map((m) => ({
            id: m.id,
            primary: m.patientName ?? m.address ?? "Message",
            href: m.patientId ? PATIENT(m.patientId) : null,
            secondary: [m.summary, m.why].filter(Boolean).join(" · "),
            pill: { tone: "red", label: "Failed", icon: "x" },
            action: m.canRetry && m.messageId ? { kind: "retry", messageId: m.messageId, label: "Retry" } : null,
          })),
          bars: [],
          empty: EMPTY.failed,
        });
    }
    // Authorisations ending soon.
    if (actor.can("patients.view")) {
      const auths = await tile("authorisations", () => authorisationsEndingSoon(actor, today, scopeIds, siteName));
      const card = { id: "authorisations", title: "Authorisations ending soon", link: actor.can("reports.all") ? { href: `${BASE}/reports/authorisations`, text: "Report" } : null, kind: "list" as const, empty: EMPTY.authorisations };
      if (auths instanceof TileFailed) cards.push(failedCard(card));
      else cards.splice(Math.min(2, cards.length), 0, { ...card, count: auths.total, items: auths.items, bars: [] });
    }
  } else if (role === "clinician") {
    const practitionerId = await currentPractitionerId(actor);
    const mine = diaryToday instanceof TileFailed ? diaryToday : diaryToday.filter((a) => practitionerId !== null && a.practitionerId === practitionerId).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    if (mine instanceof TileFailed) kpis.push(failedKpi({ id: "mine", label: "My appointments today", icon: "calendar", href: `${BASE}/diary` }));
    else {
      const done = mine.filter((a) => DONE.has(a.status)).length;
      const inTreatment = mine.filter((a) => a.status === "in_treatment").length;
      kpis.push({ id: "mine", label: "My appointments today", icon: "calendar", value: String(mine.length), sub: `${done} done${inTreatment ? ` · ${inTreatment} in treatment` : ""}`, href: `${BASE}/diary` });
    }
    // Unsigned notes.
    if (actor.can("clinical.view")) {
      const unsigned = await tile("unsigned_notes", async () => {
        const r = await unsignedNotesFor(actor, { scope: "mine", limit: 20 });
        if (!r.ok) throw new Error(r.error);
        return r.value;
      });
      if (unsigned instanceof TileFailed) {
        kpis.push(failedKpi({ id: "unsigned", label: "Unsigned notes", icon: "file", href: `${BASE}/patients/unsigned-notes`, warn: true }));
        cards.push(failedCard({ id: "unsigned", title: "Unsigned notes", link: { href: `${BASE}/patients/unsigned-notes`, text: "All" }, kind: "list", empty: EMPTY.unsigned }));
      } else {
        const notes = unsigned.notes;
        const oldest = notes.reduce<string | null>((o, n) => (o === null || n.seenOn < o ? n.seenOn : o), null);
        kpis.push({ id: "unsigned", label: "Unsigned notes", icon: "file", value: String(notes.length), sub: oldest ? `Oldest from ${shortDay(oldest, today)}` : "All signed", href: `${BASE}/patients/unsigned-notes`, warn: notes.length > 0 });
        cards.push({
          id: "unsigned",
          title: "Unsigned notes",
          count: notes.length,
          warn: notes.length > 0,
          link: { href: `${BASE}/patients/unsigned-notes`, text: "All" },
          kind: "list",
          items: notes.slice(0, 4).map((n) => ({
            id: n.id,
            primary: n.patient ? `${n.patient.preferredName || n.patient.firstName} ${n.patient.lastName}` : "Patient",
            href: n.patient ? `${PATIENT(n.patient.id)}/notes/${n.id}` : null,
            secondary: `${n.templateName ?? "Note"} · ${shortDay(n.seenOn, today)}`,
            pill: n.overdue ? { tone: "red", label: "Overdue", icon: "alert" } : { tone: "amber", label: "Unsigned", icon: "clock" },
            action: n.patient ? { kind: "link", href: `${PATIENT(n.patient.id)}/notes/${n.id}`, label: "Open", primary: n.overdue } : null,
          })),
          bars: [],
          empty: EMPTY.unsigned,
        });
      }
    }
    // Outcome measures due (first visit of a case, every 4th session) and open cases.
    const figures = await tile("clinician_figures", async () => {
      if (mine instanceof TileFailed) throw new Error("diary");
      const caseIds = Array.from(new Set(mine.map((a) => a.caseId).filter((c): c is string => c !== null)));
      const [outcomes, open] = await Promise.all([caseOutcomeFigures(ctx, actor.tenantId, caseIds, range.from), practitionerId ? openCasesOf(ctx, actor.tenantId, practitionerId, actor.siteIds) : Promise.resolve({ cases: 0, sites: 0 })]);
      return { outcomes, open };
    });
    if (mine instanceof TileFailed || figures instanceof TileFailed) {
      kpis.push(failedKpi({ id: "measures", label: "Outcome measures due", icon: "chart", href: null }));
      kpis.push(failedKpi({ id: "cases", label: "Open cases", icon: "users", href: `${BASE}/patients` }));
      cards.unshift(failedCard({ id: "next", title: "My next patients", link: { href: `${BASE}/diary`, text: "My diary" }, kind: "list", empty: EMPTY.next }));
    } else {
      const patients = await getPatientSummaries(ctx, actor.tenantId, mine.map((a) => a.patientId).filter((p): p is string => p !== null));
      const services = new Map((await listServices(ctx, actor.tenantId, { includeInactive: true })).map((s) => [s.id, s.name]));
      const due = mine.filter((a) => a.caseId && a.status !== "dna" && measureDue(figures.outcomes.get(a.caseId)));
      const showClinical = actor.can("clinical.view");
      if (showClinical) {
        kpis.push({ id: "measures", label: "Outcome measures due", icon: "chart", value: String(due.length), sub: "First visit or every 4th session", href: null });
      }
      kpis.push({ id: "cases", label: "Open cases", icon: "users", value: String(figures.open.cases), sub: `Across ${figures.open.sites} site${figures.open.sites === 1 ? "" : "s"}`, href: `${BASE}/patients` });
      const upcoming = mine.filter((a) => a.status !== "attended" && a.status !== "dna" && Date.parse(a.endsAt) > now.getTime());
      cards.unshift({
        id: "next",
        title: "My next patients",
        count: null,
        link: { href: `${BASE}/diary`, text: "My diary" },
        kind: "list",
        items: upcoming.slice(0, 5).map((a) => {
          const p = a.patientId ? patients.get(a.patientId) : undefined;
          return {
            id: a.id,
            lead: formatLondonTime(a.startsAt),
            primary: nameOf(p),
            href: a.patientId ? PATIENT(a.patientId) : null,
            secondary: [a.serviceId ? services.get(a.serviceId) : null, siteName.get(a.siteId)].filter(Boolean).join(" · "),
            alert: p?.hasAlerts ?? false,
            pill: STATUS_PILL[a.status] ?? null,
          };
        }),
        bars: [],
        empty: EMPTY.next,
      });
      if (showClinical) {
        cards.push({
          id: "measures",
          title: "Outcome measures due",
          count: due.length,
          link: null,
          kind: "list",
          items: due.slice(0, 5).map((a) => {
            const p = a.patientId ? patients.get(a.patientId) : undefined;
            const f = a.caseId ? figures.outcomes.get(a.caseId) : undefined;
            return {
              id: `m-${a.id}`,
              lead: formatLondonTime(a.startsAt),
              primary: nameOf(p),
              href: a.patientId ? `${PATIENT(a.patientId)}/outcomes` : null,
              secondary: f && f.measures === 0 ? "First visit – no score on this case yet" : `Session ${(f?.attendedBefore ?? 0) + 1}`,
              pill: { tone: "blue", label: "Due today", icon: "chart" },
            };
          }),
          bars: [],
          empty: EMPTY.measures,
        });
      }
    }
  } else {
    // Reception: the chosen site (the shell's switcher), else every site in scope.
    const atSite = diaryToday instanceof TileFailed ? diaryToday : diaryToday.filter((a) => !chosen || a.siteId === chosen).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    const where = chosen ? (siteName.get(chosen) ?? "your site") : sites.length === 1 ? sites[0].name : "your sites";
    if (atSite instanceof TileFailed) {
      kpis.push(failedKpi({ id: "appointments", label: "Appointments today", icon: "calendar", href: `${BASE}/diary` }));
      kpis.push(failedKpi({ id: "to-arrive", label: "Still to arrive", icon: "user-check", href: `${BASE}/diary` }));
      cards.push(failedCard({ id: "arrivals", title: `Arrivals at ${where}`, link: { href: `${BASE}/diary`, text: "Diary" }, kind: "list", empty: EMPTY.arrivals }));
    } else {
      const done = atSite.filter((a) => DONE.has(a.status)).length;
      const dna = atSite.filter((a) => a.status === "dna").length;
      const toArrive = atSite.filter((a) => a.status === "booked" && Date.parse(a.endsAt) > now.getTime());
      const patients = await getPatientSummaries(ctx, actor.tenantId, atSite.map((a) => a.patientId).filter((p): p is string => p !== null));
      const practitioners = new Map((await listPractitioners(ctx, actor.tenantId, { includeInactive: true })).map((p) => [p.id, p.displayName]));
      const services = new Map((await listServices(ctx, actor.tenantId, { includeInactive: true })).map((s) => [s.id, s.name]));
      kpis.push({ id: "appointments", label: "Appointments today", icon: "calendar", value: String(atSite.length), sub: `${where} · ${done} done · ${dna} DNA`, href: `${BASE}/diary` });
      const next = toArrive[0];
      kpis.push({
        id: "to-arrive",
        label: "Still to arrive",
        icon: "user-check",
        value: String(toArrive.length),
        sub: next ? `Next: ${formatLondonTime(next.startsAt)} ${nameOf(next.patientId ? patients.get(next.patientId) : undefined)}` : "Everyone is in",
        href: `${BASE}/diary`,
      });
      const canMark = actor.can("diary.book");
      const visible = atSite.filter((a) => Date.parse(a.endsAt) > now.getTime() - 30 * 60_000 && a.status !== "attended" && a.status !== "dna").slice(0, 6);
      cards.push({
        id: "arrivals",
        title: `Arrivals at ${where}`,
        count: null,
        link: { href: `${BASE}/diary`, text: "Diary" },
        kind: "list",
        items: visible.map((a) => {
          const p = a.patientId ? patients.get(a.patientId) : undefined;
          const arrivedAllowed = a.status === "booked" && canMark && statusAllowedAt("arrived", a.startsAt, now);
          return {
            id: a.id,
            lead: formatLondonTime(a.startsAt),
            primary: nameOf(p),
            href: a.patientId ? PATIENT(a.patientId) : null,
            secondary: [a.serviceId ? services.get(a.serviceId) : null, a.practitionerId ? practitioners.get(a.practitionerId) : null].filter(Boolean).join(" · "),
            alert: p?.hasAlerts ?? false,
            pill: STATUS_PILL[a.status] ?? null,
            action: arrivedAllowed ? { kind: "arrived", appointmentId: a.id, rev: a.rev, label: "Arrived" } : null,
          };
        }),
        bars: [],
        empty: EMPTY.arrivals,
      });
    }
    // Waiting list.
    if (actor.can("diary.view")) {
      const waiting = await tile("waiting_list", async () => {
        const r = await loadWaitingList(await diaryCallerOf(actor), { status: "open", siteId: chosen ?? undefined });
        if (!r.ok) throw new Error("waiting");
        return r.data;
      });
      const card = { id: "waiting", title: "Waiting list", link: { href: `${BASE}/diary/waiting-list`, text: "All" }, kind: "list" as const, empty: EMPTY.waiting };
      if (waiting instanceof TileFailed) cards.push(failedCard(card));
      else {
        const rows: WaitingRowLike[] = waiting;
        cards.push({
          ...card,
          count: rows.length,
          items: rows.slice(0, 4).map((w) => ({
            id: w.id,
            primary: w.patientName ?? "Patient",
            href: PATIENT(w.patientId),
            secondary: [w.serviceName, w.practitionerName ?? "anyone", w.preferenceLabel].filter(Boolean).join(" · "),
            pill: w.openOffers > 0 ? { tone: "green", label: "Offered", icon: "send" } : { tone: "blue", label: `${w.waitingDays} day${w.waitingDays === 1 ? "" : "s"}`, icon: "clock" },
            action: actor.can("diary.book") ? { kind: "link", href: `${BASE}/diary?book=${w.id}`, label: "Book" } : null,
          })),
          bars: [],
        });
      }
    }
    // Invoices to raise.
    if (actor.can("billing.edit")) {
      const visits = await tile("invoices_to_raise", async () => {
        const r = await uninvoicedVisitsFor(actor);
        if (!r.ok) throw new Error("visits");
        return r.value.visits;
      });
      if (visits instanceof TileFailed) {
        kpis.push(failedKpi({ id: "to-invoice", label: "Invoices to raise", icon: "pound", href: `${BASE}/billing/invoice-visits` }));
        cards.push(failedCard({ id: "to-invoice", title: "Invoices to raise", link: { href: `${BASE}/billing/invoice-visits`, text: "Invoice visits" }, kind: "list", empty: EMPTY.toInvoice }));
      } else {
        kpis.push({ id: "to-invoice", label: "Invoices to raise", icon: "pound", value: String(visits.length), sub: "Attended visits not invoiced", href: `${BASE}/billing/invoice-visits` });
        cards.push({
          id: "to-invoice",
          title: "Invoices to raise",
          count: visits.length,
          link: { href: `${BASE}/billing/invoice-visits`, text: "Invoice visits" },
          kind: "list",
          items: visits.slice(0, 4).map((v) => ({
            id: v.appointmentId,
            primary: v.patientName,
            href: PATIENT(v.patientId),
            secondary: [v.serviceName, shortDay(v.date, today), v.payerLabel, v.chargePence !== null ? pounds(v.chargePence) : null].filter(Boolean).join(" · "),
          })),
          bars: [],
          empty: EMPTY.toInvoice,
        });
      }
    }
    // Replies to answer.
    if (actor.can("messages.send")) {
      const replies = await tile("replies", async () => {
        const r = await repliesFor(actor);
        if (!r.ok) throw new Error("replies");
        return r.value.filter((x) => x.toAction);
      });
      if (replies instanceof TileFailed) {
        kpis.push(failedKpi({ id: "replies", label: "Replies to answer", icon: "message", href: `${BASE}/messages?tab=replies` }));
        cards.push(failedCard({ id: "replies", title: "Replies to answer", link: { href: `${BASE}/messages?tab=replies`, text: "Messages" }, kind: "list", empty: EMPTY.replies }));
      } else {
        const oldest = replies.reduce<string | null>((o, r) => (o === null || r.at < o ? r.at : o), null);
        kpis.push({ id: "replies", label: "Replies to answer", icon: "message", value: String(replies.length), sub: oldest ? `Oldest ${formatLondonTime(oldest)}` : "None waiting", href: `${BASE}/messages?tab=replies` });
        cards.push({
          id: "replies",
          title: "Replies to answer",
          count: replies.length,
          link: { href: `${BASE}/messages?tab=replies`, text: "Messages" },
          kind: "list",
          items: replies.slice(0, 4).map((r) => ({
            id: r.id,
            lead: formatLondonTime(r.at),
            primary: r.patientName ?? r.from ?? "Unknown number",
            href: r.patientId ? PATIENT(r.patientId) : null,
            secondary: r.intent === "cancel" ? "Asks to cancel" : r.intent === "confirm" ? "Confirms" : "A question or comment",
            pill: { tone: "blue", label: "New", icon: "message" },
          })),
          bars: [],
          empty: EMPTY.replies,
        });
      }
    }
  }

  return {
    role,
    subtitle: `${dayLabel(today)} · ${role === "reception" && chosen ? (siteName.get(chosen) ?? sitesText) : sitesText}`,
    updatedAt: `Updated ${formatLondonTime(now)}`,
    kpis,
    cards,
    partial,
    noSites: allSites.length === 0,
  };
}

interface WaitingRowLike {
  id: string;
  patientId: string;
  patientName: string | null;
  serviceName: string | null;
  practitionerName: string | null;
  preferenceLabel: string;
  waitingDays: number;
  openOffers: number;
}

const EMPTY = {
  bySite: { title: "No working time today", body: "No practitioner has rota time at your sites today." },
  failed: { title: "No failed messages", body: "Every reminder and confirmation went out." },
  authorisations: { title: "Nothing ending soon", body: "No authorisations with 1 session left or ending in 14 days." },
  overdue: { title: "No overdue invoices", body: "Everything issued has been paid within terms." },
  next: { title: "No more patients today", body: "Nothing else in your diary today." },
  unsigned: { title: "All notes signed", body: "Nothing waiting for your signature." },
  measures: { title: "No measures due today", body: "Scores are asked for at the first visit and every 4th session." },
  arrivals: { title: "Everyone has arrived", body: "No more arrivals expected today." },
  waiting: { title: "No one waiting", body: "Add patients who want an earlier slot from the diary." },
  toInvoice: { title: "All visits invoiced", body: "Nothing attended is waiting for an invoice." },
  replies: { title: "No replies waiting", body: "All patient replies have been answered." },
} as const;

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

/** "today", "yesterday", "Mon 26/10". */
function shortDay(date: string, today: string): string {
  if (date === today) return "today";
  if (date === addDays(today, -1)) return "yesterday";
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return `${dt.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" })} ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
}

/** A measure is due at the first visit of a case (no score yet) and every 4th session. */
function measureDue(f: { measures: number; attendedBefore: number } | undefined): boolean {
  if (!f) return false;
  return f.measures === 0 || (f.attendedBefore + 1) % 4 === 0;
}

/** Active authorisations (patient's case at a site in scope) with ≤ 1 session left or ending within 14 days. */
async function authorisationsEndingSoon(actor: ClinicActor, today: string, scopeIds: readonly string[], siteName: ReadonlyMap<string, string>): Promise<{ total: number; items: DashboardListItem[] }> {
  const ctx = actor.repo();
  const rows = await authorisationsAtRisk(ctx, actor.tenantId, { today, until: addDays(today, 14), siteIds: actor.siteIds === null ? null : scopeIds, limit: 200 });
  const patients = await getPatientSummaries(ctx, actor.tenantId, rows.slice(0, 4).map((r) => r.patientId));
  const payers = new Map((await listReferrers(ctx, actor.tenantId, { includeInactive: true, limit: 500 })).map((r) => [r.id, r.name]));
  const canLetter = actor.can("messages.letters");
  const items: DashboardListItem[] = rows.slice(0, 4).map((a) => {
    const left = a.sessionsAuthorised !== null ? Math.max(0, a.sessionsAuthorised - a.sessionsUsed) : null;
    const pill: DashboardPill =
      left === 0 ? { tone: "red", label: "0 left", icon: "alert" } : left === 1 ? { tone: "amber", label: "1 left", icon: "alert" } : { tone: "amber", label: "Expires soon", icon: "clock" };
    const parts = [
      a.referrerId ? (payers.get(a.referrerId) ?? "Insurer") : "Authorisation",
      a.sessionsAuthorised !== null ? `${a.sessionsUsed} of ${a.sessionsAuthorised} used` : null,
      a.expiresOn && (left === null || left > 1) ? `expires ${a.expiresOn.split("-").reverse().join("/")}` : null,
      a.siteId ? siteName.get(a.siteId) : null,
    ].filter(Boolean);
    return {
      id: a.id,
      primary: nameOf(patients.get(a.patientId)),
      href: `${PATIENT(a.patientId)}/cases/${a.caseId}`,
      secondary: parts.join(" · "),
      pill,
      action: left === 0 && canLetter ? { kind: "link", href: `${BASE}/letters/new?patient=${a.patientId}`, label: "Request extension" } : null,
    };
  });
  return { total: rows.length, items };
}
