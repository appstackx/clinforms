/**
 * ClinDesk website fill-ins: every value Khuram must confirm (prices, plans, hosting region, certifications, contract
 * and support details, timelines, company number, registered office, response times, the legal pages' open points …) comes from ONE file,
 * content/clindesk-site.json, read when the site is built (the pages are static). How to edit it and the list of
 * keys: docs/clinic-system/CLINDESK-SITE-CONTENT.md.
 *
 * - The file is validated here with zod when this module loads: an unknown or missing key, an empty value or a value
 *   that is only partly in brackets throws, so `next build` (and test:site) fails – nothing half-filled ships.
 * - A value still in [square brackets] is NOT filled in. Drafts (next dev, Vercel previews, CLINDESK_SITE_DRAFT=1)
 *   show it as written, so the gap is easy to find; production shows the neutral marker "[to confirm]". Either way it
 *   stays visible on the page (src/components/clindesk/fill.tsx) – nothing is invented.
 *
 * Browser-safe (no Node APIs); the pages are server components.
 */
import { z } from "zod";
import raw from "../../../content/clindesk-site.json";

/** Every key of content/clindesk-site.json (the pages use <Fill k=…/> with one of these). */
export const CLINDESK_CONTENT_KEYS = [
  "company.number",
  "company.registeredOffice",
  "contact.responseTime",
  "pricing.fromPrice",
  "pricing.vat",
  "pricing.trialSummary",
  "pricing.essentialsPrice",
  "pricing.completePrice",
  "pricing.groupPlan",
  "pricing.switchingFeeSummary",
  "pricing.contractLength",
  "pricing.noticePeriod",
  "pricing.dataExport",
  "pricing.switchingFee",
  "pricing.trialTerms",
  "reports.price",
  "reports.aboveAllowance",
  "reports.supportedForms",
  "reports.newFormProcess",
  "support.summary",
  "support.hours",
  "support.channels",
  "hosting.summary",
  "features.reminderChannels",
  "switching.typicalMove",
  "switching.timelineNote",
  "switching.whenDiscovery",
  "switching.whenTrialImport",
  "switching.whenTraining",
  "switching.whenGoLive",
  "switching.whenSettlingIn",
  "switching.whatMoves",
  "switching.oldSystemAccess",
  "switching.trainingFormat",
  "security.region",
  "security.hostingDetails",
  "security.icoRegistration",
  "security.certifications",
  "security.encryptionInTransit",
  "security.encryptionAtRest",
  "security.backupFrequency",
  "security.backupRetention",
  "security.retentionGuidance",
  "security.deletionProcess",
  "security.auditRetention",
  "security.overviewDocument",
  "security.subProcessorsDocument",
  "security.issueResponseTime",
  "demo.callLength",
  "legal.termsEffectiveFrom",
  "legal.accountRetention",
  "legal.demoRequestRetention",
  "legal.providerLocations",
  "legal.humanCheckStorage",
  "legal.medicalDeviceStatus",
  "legal.liabilityCap",
  "legal.paymentProviderTerms",
] as const;

export type ClindeskContentKey = (typeof CLINDESK_CONTENT_KEYS)[number];

/** The neutral marker production shows for a value that is not filled in yet. */
export const TO_CONFIRM = "[to confirm]";

/** "[£X]" – a value still in square brackets (the design's placeholder, or any other bracketed note). */
export function isPlaceholderValue(value: string): boolean {
  return /^\[[^[\]]+\]$/.test(value.trim());
}

const ValueSchema = z
  .string({ error: "value must be text." })
  .trim()
  .min(1, "value must not be empty – put the placeholder back in [square brackets] if it is not known yet.")
  .max(600, "value must be at most 600 characters.")
  .refine((v) => isPlaceholderValue(v) || !/[[\]]/.test(v), {
    message: "value is partly in [brackets]: either fill it in completely (no [ or ]) or leave the whole value in brackets.",
  })
  .refine((v) => !/[<>]/.test(v), { message: "value must be plain text (no < or >)." });

const EntrySchema = z
  .object({
    value: ValueSchema,
    description: z.string({ error: "description must be text." }).trim().min(10, "description is too short.").max(400),
  })
  .strict();

export const ClindeskContentSchema = z
  .object({
    _about: z.string().optional(),
    values: z
      .object(Object.fromEntries(CLINDESK_CONTENT_KEYS.map((k) => [k, EntrySchema])) as Record<ClindeskContentKey, typeof EntrySchema>)
      .strict(),
  })
  .strict();

export type ClindeskContent = z.infer<typeof ClindeskContentSchema>;

export class ClindeskContentError extends Error {
  constructor(readonly issues: string[]) {
    super(`content/clindesk-site.json is not valid (docs/clinic-system/CLINDESK-SITE-CONTENT.md):\n- ${issues.join("\n- ")}`);
    this.name = "ClindeskContentError";
  }
}

/** Validates the parsed JSON; throws ClindeskContentError listing every problem by key. */
export function parseClindeskContent(input: unknown): ClindeskContent {
  const parsed = ClindeskContentSchema.safeParse(input);
  if (parsed.success) return parsed.data;
  throw new ClindeskContentError(
    parsed.error.issues.map((issue) => {
      const where = issue.path.length ? issue.path.map(String).join(" › ") : "(file)";
      if (issue.code === "unrecognized_keys") return `${where}: unknown key(s) ${issue.keys.join(", ")}`;
      return `${where}: ${issue.message}`;
    }),
  );
}

/** The site's content – validated once, when the module loads (a bad file fails the build). */
export const CLINDESK_CONTENT: ClindeskContent = parseClindeskContent(raw);

/** Draft builds show unfilled values as written; production shows TO_CONFIRM. */
export function isDraftBuild(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env.NODE_ENV === "development" || env.VERCEL_ENV === "preview" || env.CLINDESK_SITE_DRAFT === "1";
}

export interface ContentText {
  key: ClindeskContentKey;
  filled: boolean;
  /** What the page shows: the value, or (unfilled) the placeholder in drafts / TO_CONFIRM in production. */
  text: string;
}

export function contentText(key: ClindeskContentKey, options: { content?: ClindeskContent; draft?: boolean } = {}): ContentText {
  const value = (options.content ?? CLINDESK_CONTENT).values[key].value.trim();
  if (!isPlaceholderValue(value)) return { key, filled: true, text: value };
  return { key, filled: false, text: (options.draft ?? isDraftBuild()) ? value : TO_CONFIRM };
}

/** Keys still to fill in (for the docs and the go-live check). */
export function unfilledKeys(content: ClindeskContent = CLINDESK_CONTENT): ClindeskContentKey[] {
  return CLINDESK_CONTENT_KEYS.filter((k) => isPlaceholderValue(content.values[k].value));
}
