/**
 * Self-serve sign-up ("Start free trial", tracker l01, 12/11/2026) – the switch, the versions of what is accepted, and
 * the input rules. Pure (no Next, no database): used by the pages, the server logic (src/server/signup) and tests.
 * Runbook: docs/auth.md §1b.
 *
 * The switch: CLINFORMS_SELF_SIGNUP lists the brands whose hosts offer it, comma-separated – "clinic" (ClinDesk's
 * host), "forms" (ClinForms' host), or "clinic,forms". Unset, empty or anything else = OFF: the sign-up pages and the
 * draft data processing agreement page answer 404 and nothing on any page links to them. Better Auth's own HTTP
 * sign-up endpoint stays switched off either way – accounts are only ever created by the server.
 */
import type { BrandId } from "./brand";
import { CLINDESK_LEGAL_LAST_UPDATED } from "./clindesk/site";
import { LEGAL_LAST_UPDATED } from "./site";
import { DPA_VERSION } from "./legal/dpa";

export const SELF_SIGNUP_ENV = "CLINFORMS_SELF_SIGNUP";

type Env = Readonly<Record<string, string | undefined>>;

/** Words accepted in CLINFORMS_SELF_SIGNUP for each brand. */
const SWITCH_WORDS: Readonly<Record<string, BrandId>> = { clinic: "clinic", clindesk: "clinic", forms: "clinforms", clinforms: "clinforms" };

/** The brands the switch turns on (empty = off everywhere). Unknown words are ignored, never "on". */
export function selfSignupBrands(env: Env = process.env): ReadonlySet<BrandId> {
  const out = new Set<BrandId>();
  for (const word of String(env[SELF_SIGNUP_ENV] ?? "").split(",")) {
    const brand = SWITCH_WORDS[word.trim().toLowerCase()];
    if (brand) out.add(brand);
  }
  return out;
}

export function selfSignupEnabled(brand: BrandId | null | undefined, env: Env = process.env): boolean {
  return Boolean(brand) && selfSignupBrands(env).has(brand as BrandId);
}

/* ------------------------------------------------------------------ paths */

export const SIGNUP_PATH = "/start-trial";
export const SIGNUP_CONFIRM_PATH = "/start-trial/confirm";
export const DPA_PATH = "/data-processing-agreement";

/* ------------------------------------------------------------------ versions of what is accepted */

/**
 * The terms' version for a brand: its terms page's "last updated" date (src/lib/site.ts / src/lib/clindesk/site.ts) –
 * a change to the terms changes the date, so a new acceptance records the new version.
 */
export function termsVersion(brand: BrandId): string {
  return brand === "clinic" ? `clindesk-terms-${CLINDESK_LEGAL_LAST_UPDATED}` : `clinforms-terms-${LEGAL_LAST_UPDATED}`;
}

export function dpaVersion(): string {
  return DPA_VERSION;
}

/* ------------------------------------------------------------------ limits */

export const SIGNUP_LIMITS = {
  /** Sign-ups (forms that passed every check) per IP address per day. */
  perIpPerDay: 3,
  /** Emails (link or "you already have an account") per address per day. */
  perEmailPerDay: 3,
  /** Every attempt (valid or not) per IP address per hour. */
  attemptsPerIpPerHour: 20,
  /**
   * Sign-ups site-wide per day above which an ALERT is raised (log line `signup.global_cap` each time, one platform
   * audit row "platform.signup_global_cap" per day) – it never blocks: a flood from many networks would otherwise lock
   * out real clinics. The per-IP (IPv6: per /64), per-address and per-hour limits stay the brakes.
   */
  allPerDayAlert: 200,
  /** A person cannot fill the form in less (bots do). */
  minFillMs: 3000,
  /** The form's time stamp is good for this long (then the page is reloaded). */
  maxFormAgeMs: 2 * 3600_000,
  /** The email link works once, for this long. */
  linkTtlMs: 24 * 3600_000,
  /** Wrong passwords on one link before it waits (15 minutes). */
  confirmAttemptsPerLink: 5,
} as const;

/* ------------------------------------------------------------------ input rules */

export const CLINIC_NAME_MIN = 2;
export const CLINIC_NAME_MAX = 100;
export const OWNER_NAME_MAX = 100;

/** Letters (any script), digits, spaces and & ' ’ ( ) , . - / + only. */
// Built with RegExp: the project's compile target predates the u flag in literals; every runtime it runs on has it.
const CLINIC_NAME_CHARS = new RegExp("^[\\p{L}\\p{M}\\p{N} &'’(),.\\-/+]+$", "u");
const LETTER = new RegExp("\\p{L}", "gu");
const OWNER_NAME_CHARS = new RegExp("^[\\p{L}\\p{M} '’.\\-]+$", "u");

/** Collapses runs of white space and trims. */
export function tidyName(value: unknown): string {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim();
}

/** Why a clinic name is refused (null = fine). Messages are shown as they are. */
export function clinicNameProblem(name: string): string | null {
  if (name.length < CLINIC_NAME_MIN) return "Enter your clinic's name.";
  if (name.length > CLINIC_NAME_MAX) return `Use at most ${CLINIC_NAME_MAX} characters for the clinic's name.`;
  if (!CLINIC_NAME_CHARS.test(name)) return "Use letters, numbers, spaces and & ' ( ) , . - / + only in the clinic's name.";
  if ((name.match(LETTER) ?? []).length < 2) return "The clinic's name needs at least two letters.";
  if (/(?:https?|www)\s*[.:/]|\.(?:com|net|org|io|xyz|ru|top)\b/i.test(name)) return "Leave web addresses out of the clinic's name.";
  return null;
}

export function ownerNameProblem(name: string): string | null {
  if (name.length < 2) return "Enter your full name.";
  if (name.length > OWNER_NAME_MAX) return `Use at most ${OWNER_NAME_MAX} characters for your name.`;
  if (!OWNER_NAME_CHARS.test(name)) return "Use letters, spaces, apostrophes, full stops and hyphens only in your name.";
  return null;
}

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,63}$/;

/**
 * Invisible or formatting characters an address must never contain: control and format characters (zero-width
 * space / joiners, word joiner, bidi marks, soft hyphen, BOM, tags), private use, unusual spaces, Hangul fillers and
 * variation selectors. They make one address look like another (and slip past the disposable-domain list).
 */
// Built with RegExp (see CLINIC_NAME_CHARS).
const INVISIBLE = new RegExp(
  "[\\p{Cc}\\p{Cf}\\p{Co}\\p{Cs}\\p{Zl}\\p{Zp}\\u00A0\\u034F\\u115F\\u1160\\u17B4\\u17B5\\u180B-\\u180F\\u2000-\\u200A\\u202F\\u205F\\u3000\\u3164\\uFE00-\\uFE0F\\uFFA0\\u{E0100}-\\u{E01EF}]",
  "u",
);
const INVISIBLE_ALL = new RegExp(INVISIBLE.source, "gu");

/** Whether a value contains an invisible or formatting character (INVISIBLE). */
export function hasInvisibleChars(value: string): boolean {
  return INVISIBLE.test(value);
}

/**
 * Lower-cased, trimmed address, or null when it is not a plausible email address. Refused: invisible or formatting
 * characters anywhere (after trimming the ends), an empty label in the domain ("a..b"). The domain's trailing dot(s)
 * (the DNS root, "clinic.example.") are dropped, so "x@clinic.example." and "x@clinic.example" are one address.
 */
export function normaliseSignupEmail(value: unknown): string | null {
  const trimmed = String(value ?? "").trim().toLowerCase();
  if (hasInvisibleChars(trimmed)) return null;
  const email = trimmed.replace(/\.+$/, "");
  const domain = email.slice(email.lastIndexOf("@") + 1);
  if (domain.startsWith(".") || domain.includes("..")) return null;
  return email.length <= 254 && EMAIL.test(email) ? email : null;
}

/**
 * Disposable ("throwaway") email domains – a small built-in list of the common ones, refused at sign-up (a subdomain of
 * one is refused too). Not complete on purpose: it stops the casual case; the per-IP and per-address limits do the rest.
 */
export const DISPOSABLE_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  "10minutemail.com",
  "10minutemail.net",
  "20minutemail.com",
  "33mail.com",
  "burnermail.io",
  "discard.email",
  "dispostable.com",
  "emailondeck.com",
  "fakeinbox.com",
  "getairmail.com",
  "getnada.com",
  "guerrillamail.biz",
  "guerrillamail.com",
  "guerrillamail.de",
  "guerrillamail.net",
  "guerrillamail.org",
  "guerrillamailblock.com",
  "grr.la",
  "inboxkitten.com",
  "mailcatch.com",
  "maildrop.cc",
  "mailinator.com",
  "mailinator.net",
  "mailnesia.com",
  "mailpoof.com",
  "mintemail.com",
  "mohmal.com",
  "moakt.com",
  "mytemp.email",
  "nada.email",
  "pokemail.net",
  "sharklasers.com",
  "spam4.me",
  "spamgourmet.com",
  "tempail.com",
  "temp-mail.io",
  "temp-mail.org",
  "tempmail.com",
  "tempmail.net",
  "tempmailo.com",
  "tempr.email",
  "throwawaymail.com",
  "tmail.ws",
  "tmpmail.net",
  "tmpmail.org",
  "trashmail.com",
  "trashmail.de",
  "trashmail.net",
  "yopmail.com",
  "yopmail.fr",
  "yopmail.net",
]);

/**
 * The domain as the list compares it: compatibility-normalised (full-width letters), invisible characters removed,
 * the other dots of IDNA (。．｡) read as ".", lower case, no trailing dot(s).
 */
export function comparableEmailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return email
    .slice(at + 1)
    .normalize("NFKC")
    .replace(INVISIBLE_ALL, "")
    .replace(/[\u3002\uFF0E\uFF61]/g, ".")
    .toLowerCase()
    .trim()
    .replace(/\.+$/, "");
}

export function isDisposableEmail(email: string): boolean {
  const domain = comparableEmailDomain(email);
  if (!domain) return false;
  const parts = domain.split(".");
  for (let i = 0; i < parts.length - 1; i++) if (DISPOSABLE_EMAIL_DOMAINS.has(parts.slice(i).join("."))) return true;
  return false;
}

/**
 * The clinic id (tenant slug, immutable) proposed for a clinic name: lower-case ASCII letters and digits joined by
 * single hyphens, at most 40 characters ("Larkfield Physio & Sports (Leeds)" → "larkfield-physio-sports-leeds"). The
 * server adds a short suffix when it is taken, reserved or too short (src/server/signup/self-signup.ts).
 */
export function slugBaseFromClinicName(name: string): string {
  const ascii = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return ascii.slice(0, 40).replace(/-+$/g, "");
}

/* ------------------------------------------------------------------ wording (one place, neutral) */

export const SIGNUP_COPY = {
  title: "Start your free trial",
  checkEmailTitle: "Check your email",
  checkEmail:
    "If the details can be used, we have sent a link to that address. Open it within 24 hours to confirm your email and create your clinic. If nothing arrives in a few minutes, check your spam folder.",
  tooManyFromNetwork: "Too many sign-ups from this network today. Please try again tomorrow, or contact us.",
  tooManyAttempts: "Too many attempts. Please wait a few minutes and try again.",
  disposable: "Please use your work email address – throwaway addresses cannot be used.",
  mustAccept: "Tick the box to accept the terms and the data processing agreement.",
  formExpired: "This form has expired. Please reload the page and try again.",
  linkInvalid: "This link is not valid, has expired, or has already been used. You can start again.",
  linkBusy: "This link is being used right now. Wait a moment and reload the page.",
  wrongPassword: "That password does not match the one you chose when you signed up.",
  alreadyHaveAccount: "An account already exists for this email address. Sign in instead.",
  hostNotServed: "Sign-up is not available on this website yet. Please contact us to start a trial.",
} as const;
