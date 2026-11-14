/**
 * The self-serve free trial's emails (13/11/2026, docs/clinic-system/trial.md) – branded HTML (./layout.ts) with a
 * plain-text twin. Brand-aware: ClinDesk (the clinic brand – the clinic system with the Reports add-on and texts) or
 * ClinForms (reports only). UK English, UK dates (Europe/London). Neutral wording: what the product does, never the
 * technology; nothing promised that is not built.
 *
 *   welcome    day 0     the trial has started: what is included, how to start           (tips-type: "stop" link)
 *   tips       day 3     three things to try                                              (tips-type: "stop" link)
 *   four_days  day 10    4 days left – choose a plan to carry on
 *   last_day   day 13    the trial ends tomorrow (or today)
 *   ended      day 14/15 the trial has ended – your data is safe and kept for 90 days, how to continue
 *   paid       on paying you're on a paid plan – everything is kept
 *   deletion_warning  14 days before an unpaid trial clinic is deleted (90 days after the end): the date, how to keep
 *              it (choose a plan) and how to keep a copy (download / export) – src/server/trial/retention.ts
 *
 * 14/11/2026 (owner decision): no "made-up patient details only" line in self-serve trial emails any more.
 */
import { REPORTS_ADDON_NAME, type BrandId } from "../../lib/brand";
import { COMPANY_NAME } from "../../lib/account-copy";
import { TRIAL_KEEP_DAYS, addUkDays, trialDeletionDay, ukDayStart, type TrialEmailKind } from "../../lib/trial";
import { EMAIL_THEMES, brandedEmail, escapeHtml } from "./layout";
import type { EmailMessage, EmailRecipient } from "./types";

const UK_DAY = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "long", day: "numeric", month: "long", year: "numeric" });
const UK_TIME = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });

/** "Friday 27 November 2026" */
export function ukLongDate(iso: string): string {
  return UK_DAY.format(new Date(iso)).replace(",", "");
}

/** "Friday 27 November 2026 at 14:05 (UK time)" */
function ukDateAndTime(iso: string): string {
  return `${ukLongDate(iso)} at ${UK_TIME.format(new Date(iso))} (UK time)`;
}

export interface TrialEmailInput {
  kind: TrialEmailKind;
  to: EmailRecipient;
  brand: BrandId;
  clinicName: string;
  /** The brand host's origin (links). */
  origin: string;
  /** The trial's length and end (not needed for "paid"). */
  days: number;
  endsAt: string | null;
  /** Free reports and how many have counted; free texts given. */
  reportsIncluded: number;
  reportsUsed: number;
  textsGranted: number;
  /** "Stop these tips" link (welcome / tips). */
  stopTipsUrl?: string | null;
  /** For "paid": the plan's name ("ClinDesk Small, monthly"), when known. */
  planName?: string | null;
  /** Calendar days from today to the end (UK) – "ends tomorrow" / "ends today". */
  daysToEnd?: number;
  /** For "deletion_warning": the UK day ("YYYY-MM-DD") the clinic will be deleted (the one the sweep acts on). */
  deletionDay?: string | null;
}

/** "Friday 26 February 2027" for a UK day "YYYY-MM-DD". */
function ukDayLong(day: string): string {
  return ukLongDate(ukDayStart(day).toISOString());
}

const PLAN_PATH = "/app/settings/billing";
const START_PATH = "/app/start";

function hello(to: EmailRecipient): string {
  return to.name ? `Hello ${to.name},` : "Hello,";
}

function reportsLine(i: TrialEmailInput): string {
  const left = Math.max(0, i.reportsIncluded - i.reportsUsed);
  return `So far: ${i.reportsUsed} of ${i.reportsIncluded} free ${i.reportsIncluded === 1 ? "report" : "reports"} used${left === 0 ? "" : ` (${left} left)`}.`;
}

interface Body {
  subject: string;
  preheader: string;
  heading: string;
  paragraphs: string[];
  list?: string[];
  after?: string[];
  action: { label: string; href: string };
  footnote?: string;
}

/** The words of each email (plain text; escaped when the HTML is built). */
function bodyFor(i: TrialEmailInput): Body {
  const desk = i.brand === "clinic";
  const name = EMAIL_THEMES[i.brand].name;
  const plan = { label: "Choose a plan", href: `${i.origin}${PLAN_PATH}` };
  const open = { label: `Open ${name}`, href: `${i.origin}${START_PATH}` };
  const ends = i.endsAt ? ukDateAndTime(i.endsAt) : null;
  const included = desk
    ? [
        "The diary, patient records, clinical notes, invoicing and messages – everything in ClinDesk",
        ...(i.reportsIncluded > 0 ? [`${i.reportsIncluded} free reports with the ${REPORTS_ADDON_NAME} add-on: your referrers' own forms completed from your notes`] : []),
        ...(i.textsGranted > 0 ? [`${i.textsGranted} free test texts to try appointment reminders (more can be bought at any time)`] : []),
        "A sample clinic with made-up patients, if you would like to look around first – offered when you sign in",
      ]
    : [
        ...(i.reportsIncluded > 0 ? [`${i.reportsIncluded} free reports: your referrers' own forms, completed from your notes in their original layout`] : []),
        "Your own forms library: upload a referrer's form once, confirm how it is filled, and reuse it",
        "Review, edit and approve every answer before anything is downloaded",
      ];
  switch (i.kind) {
    case "welcome":
      return {
        subject: `Welcome to ${name} – your ${i.days}-day free trial has started`,
        preheader: `Your free trial of ${name} runs until ${ends ?? "the end of your trial"}. No card needed.`,
        heading: "Your free trial has started",
        paragraphs: [
          hello(i.to),
          `Thank you for trying ${name} with ${i.clinicName}. Your free trial runs for ${i.days} days, until ${ends ?? "the end of your trial"}. No card is needed.`,
          "Your trial includes:",
        ],
        list: included,
        after: ["When you are ready to carry on, choose a plan – everything you set up during the trial is kept."],
        action: open,
      };
    case "tips":
      return {
        subject: `Three things to try in ${name} this week`,
        preheader: `Get the most from your ${name} trial – ${i.clinicName}.`,
        heading: "Three things to try this week",
        paragraphs: [hello(i.to), `Here are three quick ways to see what ${name} can do for ${i.clinicName}:`],
        list: desk
          ? [
              "Add your sites, rooms, practitioners and appointment types under Set-up – it takes a few minutes.",
              "Book a few appointments and send yourself a test reminder text.",
              "Write and sign a clinical note, then raise an invoice for the visit.",
            ]
          : [
              "Upload one of your referrers' forms and confirm how each question is filled.",
              "Import a patient's notes – any layout – and check what was read.",
              "Draft the answers, review and edit them, then approve and download the completed form.",
            ],
        after: i.reportsIncluded > 0 ? [reportsLine(i)] : [],
        action: open,
      };
    case "four_days":
      return {
        subject: `4 days left in your ${name} free trial`,
        preheader: `Your trial ends on ${ends ?? "soon"}. Choose a plan to carry on.`,
        heading: "4 days left in your free trial",
        paragraphs: [
          hello(i.to),
          `${i.clinicName}'s free trial of ${name} ends on ${ends ?? "soon"}.`,
          "To keep working without a break, choose a plan before then. Everything you have set up and recorded stays exactly as it is.",
          ...(i.reportsIncluded > 0 ? [reportsLine(i)] : []),
        ],
        action: plan,
      };
    case "last_day": {
      const when = i.daysToEnd === 0 ? "today" : "tomorrow";
      return {
        subject: `Your ${name} free trial ends ${when}`,
        preheader: `Choose a plan to carry on – your data is kept either way.`,
        heading: `Your free trial ends ${when}`,
        paragraphs: [
          hello(i.to),
          `${i.clinicName}'s free trial of ${name} ends ${when}, ${ends ?? ""}.`.replace(/, \.$/, "."),
          `Choose a plan to carry on without a break. If you do not, nothing is lost straight away: for ${TRIAL_KEEP_DAYS} days after the trial you can still sign in, open and download everything, but nothing new can be added until a plan is chosen.`,
        ],
        action: plan,
      };
    }
    case "ended": {
      // The last day kept (the deletion runs early the next morning).
      const kept = i.endsAt ? ukDayLong(addUkDays(trialDeletionDay(i.endsAt), -1)) : null;
      return {
        subject: `Your ${name} free trial has ended – your data is safe`,
        preheader: `Nothing has been deleted. Your data is kept for ${TRIAL_KEEP_DAYS} days – choose a plan to carry on where you left off.`,
        heading: "Your free trial has ended – your data is safe",
        paragraphs: [
          hello(i.to),
          `${i.clinicName}'s free trial of ${name} ended on ${ends ?? "its last day"}.`,
          `Nothing has been deleted. Your clinic's data is kept for ${TRIAL_KEEP_DAYS} days${kept ? `, until ${kept}` : ""}: you can still sign in, open and download everything your clinic recorded during the trial. Adding or changing anything is paused until a plan is chosen.`,
          "To carry on, choose a plan – everything continues exactly where you left off.",
        ],
        action: plan,
        footnote: `If no plan is chosen, the clinic and its data are deleted after those ${TRIAL_KEEP_DAYS} days. We will email you two weeks before that happens.`,
      };
    }
    case "paid":
      return {
        subject: `You're on a paid ${name} plan`,
        preheader: `Thank you – ${i.clinicName} is now on a paid plan. Everything from your trial is kept.`,
        heading: "Thank you – you're on a paid plan",
        paragraphs: [
          hello(i.to),
          `${i.clinicName} is now on ${i.planName ? `the ${i.planName} plan` : `a paid ${name} plan`}. Your free trial has ended and everything you set up and recorded during it is kept.`,
          "Your plan's allowances apply from today. Invoices, payment details and changes to your plan are under Plan and billing.",
        ],
        action: { label: "Open plan and billing", href: `${i.origin}${PLAN_PATH}` },
      };
    case "deletion_warning": {
      const on = i.deletionDay ? ukDayLong(i.deletionDay) : "in 14 days";
      const when = i.deletionDay ? `on ${on}` : on;
      const by = i.deletionDay ? `by ${ukDayLong(addUkDays(i.deletionDay, -1))}` : "before then";
      return {
        subject: `Your ${name} trial clinic will be deleted ${when}`,
        preheader: `Choose a plan ${by} to keep ${i.clinicName}'s data.`,
        heading: `Your trial clinic will be deleted ${when}`,
        paragraphs: [
          hello(i.to),
          `${i.clinicName}'s free trial of ${name} ended on ${ends ?? "its last day"} and no plan has been chosen. We have kept the clinic and its data, read-only, since then.`,
          `${i.clinicName} and all of its records and files will be deleted permanently ${when}. Once they are deleted they cannot be restored.`,
        ],
        list: [
          `To keep it: choose a plan ${by} under Plan and billing. Everything continues exactly where you left off, and nothing is deleted.`,
          desk
            ? "To keep a copy instead: sign in and use Export CSV on the Patients and Billing pages, and download the letters, files and reports you want to keep."
            : "To keep a copy instead: sign in and download the completed forms and reports you want to keep.",
        ],
        after: ["If you need help keeping a copy of your data, reply to this email."],
        action: plan,
      };
    }
  }
}

/** One trial email as an EmailMessage (HTML + plain text), for the brand's sender. */
export function trialEmail(i: TrialEmailInput): EmailMessage {
  const b = bodyFor(i);
  const theme = EMAIL_THEMES[i.brand];
  const stop = i.stopTipsUrl && (i.kind === "welcome" || i.kind === "tips") ? { label: "Stop these tips emails", href: i.stopTipsUrl } : undefined;
  const html = brandedEmail({
    theme,
    title: b.subject,
    preheader: b.preheader,
    heading: b.heading,
    paragraphs: [...b.paragraphs.map(escapeHtml)],
    list: b.list?.map(escapeHtml),
    closing: (b.after ?? []).map(escapeHtml),
    action: b.action,
    footnote: b.footnote ? escapeHtml(b.footnote) : undefined,
    unsubscribe: stop,
    contact: true,
  });
  const text = [
    b.heading,
    "",
    ...b.paragraphs.flatMap((p) => [p, ""]),
    ...(b.list ? [...b.list.map((l) => `- ${l}`), ""] : []),
    ...(b.after ? b.after.flatMap((p) => [p, ""]) : []),
    `${b.action.label}: ${b.action.href}`,
    "",
    ...(b.footnote ? [b.footnote, ""] : []),
    `Questions? Reply to this email or write to ${theme.contactEmail}.`,
    ...(stop ? [`${stop.label}: ${stop.href}`] : []),
    "",
    `${theme.name} · ${COMPANY_NAME} · ${theme.siteUrl.replace(/^https:\/\//, "")}`,
  ].join("\n");
  return { kind: "trial", to: i.to, subject: b.subject, text, html, ...(i.brand !== "clinforms" ? { brand: i.brand } : {}) };
}
