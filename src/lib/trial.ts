/**
 * The self-serve free trial (13/11/2026, owner approved): what a clinic that signs itself up gets, and when the trial
 * emails go. Pure and browser-safe (no Next, no database) – the server (src/server/trial), the pages, the email
 * templates and the tests share it. Behind CLINFORMS_SELF_SIGNUP like the sign-up itself: nothing reads it while the
 * switch is off. Runbook: docs/clinic-system/trial.md.
 *
 *   length      CLINFORMS_TRIAL_DAYS (default 14, 1–366), starting at the owner's first sign-in. No card needed.
 *   reports     CLINFORMS_TRIAL_REPORTS free reports (default 10, 0–100) – drafting stops there ("buy the Reports
 *               add-on to continue"); a paid plan's own allowance replaces it.
 *   texts       CLINFORMS_TRIAL_TEXTS free text credits (default 10, 0–100), granted once at sign-up, labelled as trial
 *               credits in the ledger. Packs can be bought at any time, the trial included.
 *   after       the trial ends: nothing new can be created, every record stays readable; nothing is ever deleted
 *               automatically.
 *
 * Abuse brakes (a repeat trial gets the trial but no free reports or texts – the platform page shows why): the same
 * owner address (case, +tags and gmail dots ignored) had a trial before; or the network (an IPv4 address, an IPv6 /64 –
 * the sign-up limits' own rule, src/server/signup/client-ip.ts ipLimitSubject) started
 * TRIAL_LIMITS.perNetwork30Days trials in 30 days already; or the address's own (non-webmail) domain did
 * TRIAL_LIMITS.perDomain30Days.
 */

type Env = Readonly<Record<string, string | undefined>>;

export const TRIAL_DEFAULT_DAYS = 14;
export const TRIAL_MAX_DAYS = 366;
export const TRIAL_DEFAULT_REPORTS = 10;
export const TRIAL_DEFAULT_TEXTS = 10;
/** Upper bound for the free reports / texts settings (a typo cannot give away thousands). */
export const TRIAL_ALLOWANCE_MAX = 100;

export const TRIAL_ENV = { days: "CLINFORMS_TRIAL_DAYS", reports: "CLINFORMS_TRIAL_REPORTS", texts: "CLINFORMS_TRIAL_TEXTS" } as const;

function wholeIn(raw: string | undefined, min: number, max: number, fallback: number): number {
  const s = String(raw ?? "").trim();
  if (!/^\d{1,4}$/.test(s)) return fallback;
  const n = Number(s);
  return n >= min && n <= max ? n : fallback;
}

/** The trial's length in days (CLINFORMS_TRIAL_DAYS; anything outside 1–366 or not a whole number = 14). */
export function trialDays(env: Env = process.env): number {
  return wholeIn(env[TRIAL_ENV.days], 1, TRIAL_MAX_DAYS, TRIAL_DEFAULT_DAYS);
}

/** Free reports in the trial (CLINFORMS_TRIAL_REPORTS; 0–100, default 10). */
export function trialReports(env: Env = process.env): number {
  return wholeIn(env[TRIAL_ENV.reports], 0, TRIAL_ALLOWANCE_MAX, TRIAL_DEFAULT_REPORTS);
}

/** Free text credits granted once at sign-up (CLINFORMS_TRIAL_TEXTS; 0–100, default 10). */
export function trialTexts(env: Env = process.env): number {
  return wholeIn(env[TRIAL_ENV.texts], 0, TRIAL_ALLOWANCE_MAX, TRIAL_DEFAULT_TEXTS);
}

export const TRIAL_LIMITS = {
  /** Trials with a free allowance per network (an IPv4 address, an IPv6 /64) in 30 days; later ones get none. */
  perNetwork30Days: 2,
  /** Trials with a free allowance per owner's own email domain (not webmail) in 30 days. */
  perDomain30Days: 3,
  /** A trial clinic's drafting limits (live drafting calls): the backstop against endless re-drafting. */
  draftingPerMinute: 5,
  draftingPerDay: 60,
} as const;

/** Webmail domains: many unrelated clinics share them, so the per-domain brake never applies to them. */
export const WEBMAIL_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "hotmail.co.uk",
  "live.com",
  "live.co.uk",
  "msn.com",
  "yahoo.com",
  "yahoo.co.uk",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "btinternet.com",
  "sky.com",
  "virginmedia.com",
  "talktalk.net",
  "gmx.com",
  "gmx.co.uk",
  "zoho.com",
  "mail.com",
  "nhs.net",
]);

/**
 * The address as the abuse brake compares it: lower case, a "+tag" dropped from the local part, and for Gmail the dots
 * too (d.a.n.a+x@gmail.com = dana@gmail.com). Never stored as such – only its keyed hash.
 */
export function canonicalTrialEmail(email: string): string {
  const e = String(email ?? "").trim().toLowerCase().replace(/\.$/, "");
  const at = e.lastIndexOf("@");
  if (at < 1) return e;
  let local = e.slice(0, at);
  let domain = e.slice(at + 1);
  if (domain === "googlemail.com") domain = "gmail.com";
  const plus = local.indexOf("+");
  if (plus > 0) local = local.slice(0, plus);
  if (domain === "gmail.com") local = local.replace(/\./g, "");
  return `${local}@${domain}`;
}

/** The address's domain when it is the clinic's own (not webmail), else null. */
export function ownEmailDomain(email: string): string | null {
  const c = canonicalTrialEmail(email);
  const domain = c.slice(c.lastIndexOf("@") + 1);
  if (!domain || !domain.includes(".")) return null;
  return WEBMAIL_DOMAINS.has(domain) ? null : domain;
}

/* ------------------------------------------------------------------ the emails' schedule */

export const TRIAL_EMAIL_KINDS = ["welcome", "tips", "four_days", "last_day", "ended", "paid"] as const;
export type TrialEmailKind = (typeof TRIAL_EMAIL_KINDS)[number];

/** Tips-type emails (not about the account itself): they carry the "stop these emails" link. */
export const TRIAL_TIPS_KINDS: ReadonlySet<TrialEmailKind> = new Set<TrialEmailKind>(["welcome", "tips"]);

export function isTrialEmailKind(value: unknown): value is TrialEmailKind {
  return typeof value === "string" && (TRIAL_EMAIL_KINDS as readonly string[]).includes(value);
}

const LONDON_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" });

/** "YYYY-MM-DD" of a moment in UK time. */
export function londonDay(at: Date | string): string {
  return LONDON_DAY.format(typeof at === "string" ? new Date(at) : at);
}

/** Whole UK calendar days from `from` to `to` (both moments; 0 = the same UK day). */
export function londonDaysBetween(from: Date | string, to: Date | string): number {
  const a = Date.parse(`${londonDay(from)}T00:00:00Z`);
  const b = Date.parse(`${londonDay(to)}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** What the schedule needs to know about one trial clinic. */
export interface TrialEmailFacts {
  /** The trial started (the owner's first sign-in); null = waiting for it. */
  startedAt: string | null;
  endsAt: string | null;
  /** The clinic's plan is "paid" (the trial was converted). */
  paid: boolean;
  /** When it was converted (self_trial.converted_at or the plan's end), for the "paid" email's window. */
  convertedAt: string | null;
  tipsOff: boolean;
  /** The email kinds already claimed (sent, failed for good, or skipped). */
  done: ReadonlySet<TrialEmailKind>;
}

/** How late an email may still go: older than this and it is skipped (e.g. the sweep was off for a while). */
export const TRIAL_EMAIL_GRACE_DAYS = 2;

export type TrialEmailDecision = { kind: TrialEmailKind; action: "send" | "skip" };

/**
 * The trial emails due for a clinic now (UK calendar days, Europe/London). Each kind at most once; one whose moment has
 * passed by more than its window is SKIPPED (claimed as skipped, never sent late):
 *
 *   welcome    the day the trial starts (sent at once by the first sign-in; the sweep is the catch-up) – up to day 2
 *   tips       day 3 – until "4 days left" is due
 *   four_days  4 UK days before the end (day 10 of 14) – until "last day" is due
 *   last_day   the UK day before the end (day 13 of 14) or the end day itself
 *   ended      once the end has passed (day 14/15) – within 7 days
 *   paid       once the trial was converted – within 7 days
 *
 * A converted trial gets "paid" only; tips-type emails are skipped once the owner stopped them.
 */
export function dueTrialEmails(f: TrialEmailFacts, now: Date): TrialEmailDecision[] {
  const out: TrialEmailDecision[] = [];
  const add = (kind: TrialEmailKind, action: "send" | "skip") => {
    if (!f.done.has(kind)) out.push({ kind, action });
  };
  if (f.paid) {
    const since = f.convertedAt ? londonDaysBetween(f.convertedAt, now) : 0;
    add("paid", since <= 7 ? "send" : "skip");
    for (const k of ["welcome", "tips", "four_days", "last_day", "ended"] as const) if (!f.done.has(k)) out.push({ kind: k, action: "skip" });
    return out;
  }
  if (!f.startedAt || !f.endsAt) return out;
  const day = londonDaysBetween(f.startedAt, now);
  const left = londonDaysBetween(now, f.endsAt);
  const ended = Date.parse(f.endsAt) <= now.getTime();
  const tips = (k: TrialEmailKind, due: boolean, late: boolean) => {
    if (!due) return;
    add(k, f.tipsOff || late ? "skip" : "send");
  };
  tips("welcome", day >= 0, day > TRIAL_EMAIL_GRACE_DAYS || ended);
  tips("tips", day >= 3, left <= 4 || ended);
  if (left <= 4) add("four_days", left <= 1 || ended ? "skip" : "send");
  if (left <= 1) add("last_day", ended ? "skip" : "send");
  if (ended) add("ended", londonDaysBetween(f.endsAt, now) <= 7 ? "send" : "skip");
  return out;
}
