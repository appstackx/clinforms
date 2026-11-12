/**
 * Bulk email to groups of patients (tracker xt02) – the pure rules: the switch, the inputs, the merge fields, the
 * safe formatting, the audience date maths and the screens' words. Browser-safe (the editor previews with the same
 * code the server sends with).
 *
 * UK law (PECR regulation 22 + UK GDPR) decides most of this:
 *   - "marketing" (news, offers, events) goes ONLY to patients with a recorded marketing-email opt-in
 *     (pms_patients.marketing_email). The "soft opt-in" is NOT used: a clinic records consent instead.
 *     Patients known to be under 18 are never sent marketing.
 *   - "service" = a service announcement that is not marketing (a closure, a new address, a change to opening
 *     hours). It needs a reason in words (kept with the campaign) and goes to patients who have not stopped
 *     reminder emails. It must not promote anything – the screens say so.
 *   - every email carries a one-click unsubscribe (List-Unsubscribe + List-Unsubscribe-Post headers, RFC 8058, and a
 *     link in the footer) and the clinic's name and postal address in the footer.
 *   - never to deceased, archived, merged or anonymised records, or records without an email address; one copy per
 *     address.
 *
 * Switches: the platform's CLINFORMS_BULK_EMAIL=on (anything else = the feature does not exist: screens 404, no
 * links, the message run ignores campaigns) AND the clinic's own setting (off by default).
 */
import { z } from "zod";

type Env = Readonly<Record<string, string | undefined>>;

export const BULK_EMAIL_ENV = "CLINFORMS_BULK_EMAIL";

/** True only for CLINFORMS_BULK_EMAIL=on (case and spaces ignored). */
export function bulkEmailSwitchOn(env: Env): boolean {
  return (
    String(env[BULK_EMAIL_ENV] ?? "")
      .trim()
      .toLowerCase() === "on"
  );
}

export const CAMPAIGN_PURPOSES = ["marketing", "service"] as const;
export type CampaignPurpose = (typeof CAMPAIGN_PURPOSES)[number];
export const CAMPAIGN_STATUSES = ["draft", "scheduled", "sending", "sent", "cancelled"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];
export const RECIPIENT_STATUSES = ["pending", "processing", "sent", "outbox", "failed", "skipped"] as const;
export type RecipientStatus = (typeof RECIPIENT_STATUSES)[number];
export const UPCOMING_CHOICES = ["any", "yes", "no"] as const;
export type UpcomingChoice = (typeof UPCOMING_CHOICES)[number];

/** Default and highest per-clinic daily cap (campaign emails per UK day). */
export const DEFAULT_DAILY_CAP = 500;
export const MAX_DAILY_CAP = 5000;
/** At most this many campaign emails per clinic in one message run (the rate limit; the run repeats every 15 min). */
export const CAMPAIGN_EMAILS_PER_RUN = 200;
/** Marketing is never sent to patients known to be younger than this. */
export const MARKETING_MIN_AGE = 18;

/* ------------------------------------------------------------------------------------------------
 * Inputs
 * ----------------------------------------------------------------------------------------------*/

const idLike = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/, "Choose from the list");
const optionalInt = (min: number, max: number, label: string) =>
  z.union([z.null(), z.number().int(`${label}: a whole number`).min(min, `${label}: at least ${min}`).max(max, `${label}: at most ${max}`)]).optional();

export const AudienceSchema = z
  .object({
    /** Patients with any appointment at this site. */
    siteId: z.union([z.null(), idLike]).optional(),
    /** Seen (attended) within this many months. */
    lastSeenMonths: optionalInt(1, 120, "Last seen"),
    upcoming: z.enum(UPCOMING_CHOICES).optional(),
    minAge: optionalInt(0, 120, "Youngest age"),
    maxAge: optionalInt(0, 120, "Oldest age"),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.minAge != null && v.maxAge != null && v.minAge > v.maxAge)
      ctx.addIssue({
        code: "custom",
        path: ["maxAge"],
        message: "The oldest age must not be below the youngest",
      });
  });
export type Audience = z.infer<typeof AudienceSchema>;

/** The audience with every field present (what is stored). */
export interface AudienceFilters {
  siteId: string | null;
  lastSeenMonths: number | null;
  upcoming: UpcomingChoice;
  minAge: number | null;
  maxAge: number | null;
}

export function normaliseAudience(a: Audience | null | undefined): AudienceFilters {
  return {
    siteId: a?.siteId ?? null,
    lastSeenMonths: a?.lastSeenMonths ?? null,
    upcoming: a?.upcoming ?? "any",
    minAge: a?.minAge ?? null,
    maxAge: a?.maxAge ?? null,
  };
}

/** The stored audience, read back (anything unexpected = no filter, never an error). */
export function parseAudienceJson(json: string | null): AudienceFilters {
  try {
    const r = AudienceSchema.safeParse(JSON.parse(json ?? "{}"));
    return normaliseAudience(r.success ? r.data : {});
  } catch {
    return normaliseAudience({});
  }
}

export const CampaignInputSchema = z
  .object({
    name: z.string().trim().min(1, "Give the email a name (only staff see it)").max(120, "At most 120 characters"),
    subject: z.string().trim().min(1, "Write a subject line").max(150, "At most 150 characters"),
    body: z.string().trim().min(1, "Write the message").max(10_000, "At most 10,000 characters"),
    purpose: z.enum(CAMPAIGN_PURPOSES, {
      message: "Choose what kind of email this is",
    }),
    /** Why a service announcement is not marketing (required for "service"). */
    serviceReason: z.union([z.null(), z.string().trim().max(300, "At most 300 characters")]).optional(),
    audience: AudienceSchema.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.purpose === "service" && !(v.serviceReason ?? "").trim())
      ctx.addIssue({
        code: "custom",
        path: ["serviceReason"],
        message: "Say why this is a service announcement and not marketing",
      });
    for (const [key, text] of [
      ["subject", v.subject],
      ["body", v.body],
    ] as const) {
      const problem = campaignTextProblem(text);
      if (problem) ctx.addIssue({ code: "custom", path: [key], message: problem });
    }
  });
export type CampaignInput = z.input<typeof CampaignInputSchema>;

export const BulkEmailSettingsInputSchema = z
  .object({
    enabled: z.boolean(),
    dailyCap: z.number().int("A whole number").min(1, "At least 1").max(MAX_DAILY_CAP, `At most ${MAX_DAILY_CAP}`),
  })
  .strict();
export type BulkEmailSettingsInput = z.infer<typeof BulkEmailSettingsInputSchema>;

/* ------------------------------------------------------------------------------------------------
 * Merge fields and safe formatting
 * ----------------------------------------------------------------------------------------------*/

export const CAMPAIGN_FIELDS = [
  {
    key: "first_name",
    label: "Patient's first name (or preferred name)",
    example: "Megan",
  },
  {
    key: "clinic_name",
    label: "Clinic name",
    example: "Riverside Physiotherapy (fictional)",
  },
  {
    key: "clinic_address",
    label: "Clinic postal address (one line)",
    example: "2 Station Parade (fictional), Bletchley, MK2 9ZZ",
  },
  { key: "clinic_phone", label: "Clinic phone", example: "01632 960100" },
] as const;
export type CampaignField = (typeof CAMPAIGN_FIELDS)[number]["key"];
const FIELD_KEYS: ReadonlySet<string> = new Set(CAMPAIGN_FIELDS.map((f) => f.key));

export type CampaignValues = Readonly<Partial<Record<CampaignField, string | null>>>;

const FIELD = /\{([^{}]*)\}/g;
/** Something that looks like an HTML tag or entity, or a script/style link – free HTML is not allowed. */
const HTML_LIKE = /<\s*\/?\s*[a-z!][^>]*>|&[a-z#0-9]+;|javascript:|data:text/i;

/** Why the text cannot be used (an unknown merge field, HTML), or null. */
export function campaignTextProblem(text: string): string | null {
  if (HTML_LIKE.test(text)) return 'HTML is not allowed – write plain text (blank lines make paragraphs, lines starting "- " make a list).';
  if (/\{\{|\}\}/.test(text)) return "Merge fields use single braces, e.g. {first_name}.";
  for (const m of Array.from(text.matchAll(FIELD))) {
    if (!FIELD_KEYS.has(m[1].trim())) return `Unknown merge field {${m[1]}}. You can use ${CAMPAIGN_FIELDS.map((f) => `{${f.key}}`).join(", ")}.`;
  }
  return null;
}

/** Replaces the merge fields (a missing value becomes ""; for {first_name}, "there" – "Hello there"). */
export function renderCampaignText(text: string, values: CampaignValues): string {
  return text.replace(FIELD, (whole, key: string) => {
    const k = key.trim() as CampaignField;
    if (!FIELD_KEYS.has(k)) return whole;
    const v = (values[k] ?? "").trim();
    return v || (k === "first_name" ? "there" : "");
  });
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const URL_RE = /\bhttps:\/\/[^\s<>"']+[^\s<>"'.,;:!?)]/g;

/** Escaped text with https links made clickable (only https; nothing else becomes markup). */
function inline(text: string): string {
  let out = "";
  let last = 0;
  for (const m of Array.from(text.matchAll(URL_RE))) {
    out += escapeHtml(text.slice(last, m.index));
    out += `<a href="${escapeHtml(m[0])}">${escapeHtml(m[0])}</a>`;
    last = (m.index ?? 0) + m[0].length;
  }
  return out + escapeHtml(text.slice(last));
}

/**
 * The email's HTML from the (already merged) plain text: blank lines make paragraphs, lines starting "- " a list,
 * https links are clickable, everything else is escaped. The footer (clinic name, postal address, why, unsubscribe)
 * in small print.
 */
export function campaignHtml(clinicName: string, body: string, footer: readonly string[]): string {
  const blocks: string[] = [];
  for (const para of body.replace(/\r\n?/g, "\n").split(/\n\s*\n/)) {
    const lines = para
      .split("\n")
      .map((l) => l.trimEnd())
      .filter((l) => l.trim() !== "");
    if (!lines.length) continue;
    if (lines.every((l) => /^\s*[-•]\s+/.test(l))) {
      blocks.push(`<ul style="margin:0 0 12px;padding-left:20px">${lines.map((l) => `<li>${inline(l.replace(/^\s*[-•]\s+/, ""))}</li>`).join("")}</ul>`);
    } else {
      blocks.push(`<p style="margin:0 0 12px">${lines.map(inline).join("<br>")}</p>`);
    }
  }
  const foot = footer.map(inline).join("<br>");
  return `<!doctype html><html lang="en-GB"><body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#0f172a"><p style="font-weight:700;margin:0 0 12px">${escapeHtml(clinicName)}</p>${blocks.join("")}<hr style="border:0;border-top:1px solid #cbd5e1;margin:24px 0 12px"><p style="font-size:13px;color:#334155">${foot}</p></body></html>`;
}

/** Why the patient gets the email (the footer). */
export function campaignWhyLine(purpose: CampaignPurpose): string {
  return purpose === "marketing"
    ? "You're getting this because you agreed to receive news and offers from us by email."
    : "You're getting this service announcement because you are a patient of the clinic.";
}

export function campaignStopWords(purpose: CampaignPurpose): string {
  return purpose === "marketing" ? "Unsubscribe from news and offers" : "Stop reminder and announcement emails (booking confirmations will still be sent)";
}

/** The footer lines: name, postal address, phone, why, the unsubscribe link (when it can be signed). */
export function campaignFooter(input: { clinicName: string; postalAddress: string; phone: string | null; purpose: CampaignPurpose; stopUrl: string | null }): string[] {
  return [
    input.clinicName,
    input.postalAddress,
    ...(input.phone ? [input.phone] : []),
    campaignWhyLine(input.purpose),
    ...(input.stopUrl ? [`${campaignStopWords(input.purpose)}: ${input.stopUrl}`] : []),
  ];
}

export interface RenderedCampaign {
  subject: string;
  text: string;
  html: string;
  headers: Record<string, string>;
}

/** The finished email for one recipient (or the preview / test copy). */
export function renderCampaign(input: {
  subject: string;
  body: string;
  values: CampaignValues;
  clinicName: string;
  postalAddress: string;
  phone: string | null;
  purpose: CampaignPurpose;
  stopUrl: string | null;
  subjectPrefix?: string;
}): RenderedCampaign {
  const subject = `${input.subjectPrefix ?? ""}${renderCampaignText(input.subject, input.values).replace(/\s+/g, " ").trim()}`.slice(0, 200);
  const body = renderCampaignText(input.body, input.values).trim();
  const footer = campaignFooter(input);
  return {
    subject,
    text: `${body}\n\n--\n${footer.join("\n")}`,
    html: campaignHtml(input.clinicName, body, footer),
    headers: input.stopUrl
      ? {
          "List-Unsubscribe": `<${input.stopUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        }
      : {},
  };
}

/* ------------------------------------------------------------------------------------------------
 * Audience dates
 * ----------------------------------------------------------------------------------------------*/

function shift(date: string, years: number, months: number, days = 0): string {
  const [y, m, d] = date.split("-").map(Number);
  const total = y * 12 + (m - 1) + years * 12 + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  const base = Date.UTC(ny, nm - 1, Math.min(d, last)) + days * 86_400_000;
  return new Date(base).toISOString().slice(0, 10);
}

export interface AudienceBounds {
  /** last_seen_on >= this */
  lastSeenFrom: string | null;
  /** date_of_birth <= this (at least the youngest age) */
  bornOnOrBefore: string | null;
  /** date_of_birth >= this (at most the oldest age) */
  bornOnOrAfter: string | null;
  /** Marketing: date_of_birth IS NULL OR <= this (adults only). */
  adultBornOnOrBefore: string | null;
}

/** The date bounds of an audience on a UK day ("YYYY-MM-DD"). */
export function audienceBounds(today: string, a: AudienceFilters, purpose: CampaignPurpose): AudienceBounds {
  return {
    lastSeenFrom: a.lastSeenMonths ? shift(today, 0, -a.lastSeenMonths) : null,
    bornOnOrBefore: a.minAge != null && a.minAge > 0 ? shift(today, -a.minAge, 0) : null,
    // age <= maxAge ⇔ born after (today − (maxAge + 1) years)
    bornOnOrAfter: a.maxAge != null ? shift(today, -(a.maxAge + 1), 0, 1) : null,
    adultBornOnOrBefore: purpose === "marketing" ? shift(today, -MARKETING_MIN_AGE, 0) : null,
  };
}

/* ------------------------------------------------------------------------------------------------
 * Words for the screens
 * ----------------------------------------------------------------------------------------------*/

export const CAMPAIGN_PURPOSE_LABELS: Readonly<Record<CampaignPurpose, string>> = {
  marketing: "Marketing (news, offers, events)",
  service: "Service announcement (not marketing)",
};
export const CAMPAIGN_STATUS_LABELS: Readonly<Record<CampaignStatus, string>> = {
  draft: "Draft",
  scheduled: "Scheduled",
  sending: "Sending",
  sent: "Sent",
  cancelled: "Cancelled",
};
export const UPCOMING_LABELS: Readonly<Record<UpcomingChoice, string>> = {
  any: "Either",
  yes: "Has an upcoming appointment",
  no: "Has no upcoming appointment",
};

export const CAMPAIGN_COPY = {
  title: "Bulk email",
  marketingRule: "Marketing goes only to patients who agreed to news and offers by email (and never to patients under 18).",
  serviceRule:
    "A service announcement tells patients about the clinic's service – a closure, a new address, new opening hours. It must not promote anything. It goes to patients who have not stopped reminder emails.",
  noAddress: "Add the clinic's postal address (Settings → Clinic) or a site address first: every email must show it.",
  off: "Bulk email is switched off for this clinic.",
  dailyCapReached: "Today's limit for bulk emails has been reached – the rest go tomorrow.",
} as const;
