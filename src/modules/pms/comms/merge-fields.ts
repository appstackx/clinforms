/**
 * Merge fields: "{{patient.first_name}}" in a message or letter template is replaced by the patient's first name
 * when the message is written. Pure – the template editor previews with the same code the server sends with.
 *
 * Rules
 * - The fields a template may use depend on what it is for (MergeContext): appointment messages may name the
 *   appointment, general and marketing messages may not; letters have their own, wider set (GP, case, author).
 * - Appointment messages carry NO clinical detail (PECR and confidentiality, contract §11): no case title,
 *   condition, notes or payer – those fields exist only for letters.
 * - An unknown field, or one the context does not allow, is an error when the template is saved, so a template
 *   that passed the check always renders.
 * - Rendering: a value that is missing becomes "" (messages) or a visible marker "[not recorded: GP name]"
 *   (letters, so the author fills it in; a letter cannot be finalised while a marker remains).
 */
import type { MessageChannel, TemplateKind } from "./types";

export type MergeContext = "appointment" | "general" | "marketing" | "letter";

export interface MergeField {
  key: string;
  label: string;
  group: "Patient" | "Appointment" | "Site" | "Clinic" | "Replies and links" | "GP" | "Case" | "Author" | "Recipient" | "Letter";
  contexts: readonly MergeContext[];
  /** Only for this channel (messages); undefined = any. */
  channel?: MessageChannel;
  /** Shown in the editor's preview. Fictional. */
  example: string;
}

const MSG: readonly MergeContext[] = ["appointment", "general", "marketing"];
const APPT: readonly MergeContext[] = ["appointment"];
const SERVICE: readonly MergeContext[] = ["appointment", "general"];
const ALL: readonly MergeContext[] = ["appointment", "general", "marketing", "letter"];
const LETTER: readonly MergeContext[] = ["letter"];

export const MERGE_FIELDS: readonly MergeField[] = [
  { key: "patient.first_name", label: "First name (or preferred name)", group: "Patient", contexts: ALL, example: "Megan" },
  { key: "patient.last_name", label: "Last name", group: "Patient", contexts: [...SERVICE, "letter"], example: "Hart" },
  { key: "patient.title", label: "Title", group: "Patient", contexts: [...SERVICE, "letter"], example: "Ms" },
  { key: "patient.full_name", label: "Full name", group: "Patient", contexts: LETTER, example: "Ms Megan Hart" },
  { key: "patient.date_of_birth", label: "Date of birth", group: "Patient", contexts: LETTER, example: "22/11/1991" },
  { key: "patient.number", label: "Patient number", group: "Patient", contexts: LETTER, example: "1" },
  { key: "patient.address", label: "Address", group: "Patient", contexts: LETTER, example: "4 Example Close (fictional)\nBletchley\nMK3 9ZZ" },

  { key: "appointment.date", label: "Date (Tuesday 27 October)", group: "Appointment", contexts: APPT, example: "Tuesday 27 October" },
  { key: "appointment.date_short", label: "Date (27/10/2026)", group: "Appointment", contexts: APPT, example: "27/10/2026" },
  { key: "appointment.time", label: "Start time", group: "Appointment", contexts: APPT, example: "14:30" },
  { key: "appointment.end_time", label: "End time", group: "Appointment", contexts: APPT, example: "15:00" },
  { key: "appointment.duration", label: "Length", group: "Appointment", contexts: APPT, example: "30 minutes" },
  { key: "appointment.with", label: "Practitioner", group: "Appointment", contexts: APPT, example: "Sarah Reid" },
  { key: "appointment.type", label: "Appointment type", group: "Appointment", contexts: APPT, example: "Follow-up" },

  { key: "site.name", label: "Site name", group: "Site", contexts: [...APPT, "letter"], example: "Bletchley (fictional)" },
  { key: "site.address", label: "Site address (one line)", group: "Site", contexts: APPT, example: "2 Station Parade (fictional), Bletchley, MK2 9ZZ" },
  { key: "site.phone", label: "Site phone", group: "Site", contexts: APPT, example: "01632 960101" },

  { key: "clinic.name", label: "Clinic name", group: "Clinic", contexts: ALL, example: "Riverside Physiotherapy (fictional)" },
  { key: "clinic.phone", label: "Clinic phone", group: "Clinic", contexts: ALL, example: "01632 960100" },
  { key: "clinic.email", label: "Clinic email", group: "Clinic", contexts: ALL, example: "hello@riverside-demo.example.com" },
  { key: "clinic.address", label: "Clinic address", group: "Clinic", contexts: LETTER, example: "2 Station Parade (fictional)\nBletchley\nMK2 9ZZ" },

  { key: "reply.instructions", label: "Reply YES / NO instructions", group: "Replies and links", contexts: APPT, channel: "sms", example: "Reply YES to confirm or NO to cancel." },
  { key: "optout.sms", label: "Reply STOP instructions", group: "Replies and links", contexts: ["marketing"], channel: "sms", example: "Reply STOP to opt out." },
  { key: "unsubscribe.link", label: "Stop-emails link", group: "Replies and links", contexts: MSG, channel: "email", example: "https://clinic.example.com/stop/…" },

  { key: "today", label: "Today's date", group: "Letter", contexts: LETTER, example: "24 October 2026" },
  { key: "gp.name", label: "GP's name", group: "GP", contexts: LETTER, example: "Dr Ellen Ward (fictional)" },
  { key: "gp.surgery", label: "GP surgery", group: "GP", contexts: LETTER, example: "Bletchley Medical Centre (fictional)" },
  { key: "gp.address", label: "GP surgery address", group: "GP", contexts: LETTER, example: "1 Queensway (fictional)\nBletchley\nMK2 9ZZ" },
  { key: "case.title", label: "Case (condition)", group: "Case", contexts: LETTER, example: "Neck pain after a road traffic accident" },
  { key: "case.opened_on", label: "Case opened", group: "Case", contexts: LETTER, example: "18/03/2026" },
  { key: "case.injury_on", label: "Date of injury", group: "Case", contexts: LETTER, example: "12/03/2026" },
  { key: "case.claim_reference", label: "Claim or instruction reference", group: "Case", contexts: LETTER, example: "MMR/2291" },
  { key: "case.membership_number", label: "Membership or policy number", group: "Case", contexts: LETTER, example: "NW-000123" },
  { key: "case.payer", label: "Who pays (insurer, solicitor…)", group: "Case", contexts: LETTER, example: "Harrow & Pike Solicitors (fictional)" },
  { key: "author.name", label: "Author's name", group: "Author", contexts: LETTER, example: "Sarah Reid" },
  { key: "author.profession", label: "Author's profession", group: "Author", contexts: LETTER, example: "Physiotherapist" },
  { key: "author.registration", label: "Author's registration number", group: "Author", contexts: LETTER, example: "PH-DEMO-01" },
  { key: "recipient.name", label: "Recipient's name", group: "Recipient", contexts: LETTER, example: "Dr Ellen Ward (fictional)" },
  { key: "recipient.address", label: "Recipient's address", group: "Recipient", contexts: LETTER, example: "1 Queensway (fictional)\nBletchley\nMK2 9ZZ" },
];

const BY_KEY = new Map(MERGE_FIELDS.map((f) => [f.key, f]));

export function mergeField(key: string): MergeField | undefined {
  return BY_KEY.get(key);
}

/** The fields an editor offers for a context and channel (letters: channel null). */
export function fieldsFor(context: MergeContext, channel: MessageChannel | null): MergeField[] {
  return MERGE_FIELDS.filter((f) => f.contexts.includes(context) && (!f.channel || f.channel === channel));
}

/** Appointment kinds share one context; general and marketing have their own. */
export function contextForKind(kind: TemplateKind): MergeContext {
  if (kind === "general") return "general";
  if (kind === "marketing") return "marketing";
  return "appointment";
}

const TOKEN = /\{\{\s*([^{}]*?)\s*\}\}/g;
const KEY = /^[a-z][a-z_]*(\.[a-z][a-z_]*)*$/;

export interface TemplateCheck {
  /** The fields used, in order of first use. */
  fields: string[];
  errors: string[];
}

/** Checks a template's merge fields for a context (and channel for messages). */
export function checkTemplate(text: string, context: MergeContext, channel: MessageChannel | null): TemplateCheck {
  const fields: string[] = [];
  const errors: string[] = [];
  const add = (e: string) => {
    if (!errors.includes(e)) errors.push(e);
  };
  for (const m of Array.from(text.matchAll(TOKEN))) {
    const key = m[1];
    if (!KEY.test(key)) {
      add(`"{{${key}}}" is not a merge field`);
      continue;
    }
    const field = BY_KEY.get(key);
    if (!field) {
      add(`"{{${key}}}" is not a merge field`);
      continue;
    }
    if (!field.contexts.includes(context)) add(`"{{${key}}}" cannot be used in ${CONTEXT_WORDS[context]}`);
    else if (field.channel && channel && field.channel !== channel) add(`"{{${key}}}" can only be used in ${field.channel === "sms" ? "texts" : "emails"}`);
    if (!fields.includes(key)) fields.push(key);
  }
  // Left-over braces: "{{patient.first_name}" or "{{ " never closed.
  const stripped = text.replace(TOKEN, "");
  if (/\{\{|\}\}/.test(stripped)) add("Check the braces: every merge field looks like {{patient.first_name}}");
  return { fields, errors };
}

const CONTEXT_WORDS: Readonly<Record<MergeContext, string>> = {
  appointment: "an appointment message",
  general: "a general message",
  marketing: "a marketing message",
  letter: "a letter",
};

export type MergeValues = Readonly<Record<string, string | null | undefined>>;

export interface RenderOptions {
  /** "empty": a missing value becomes "" (messages); "marker": "[not recorded: <label>]" (letters). */
  missing: "empty" | "marker";
}

export interface Rendered {
  text: string;
  /** Fields that had no value. */
  missing: string[];
}

export const MISSING_MARKER_PREFIX = "[not recorded: ";

/** Replaces every merge field (unknown fields are left as typed – checkTemplate refuses them on save). */
export function renderTemplate(text: string, values: MergeValues, options: RenderOptions): Rendered {
  const missing: string[] = [];
  const out = text.replace(TOKEN, (whole, key: string) => {
    const field = BY_KEY.get(key);
    if (!field) return whole;
    const value = values[key];
    if (typeof value === "string" && value.trim() !== "") return value;
    if (!missing.includes(key)) missing.push(key);
    return options.missing === "marker" ? `${MISSING_MARKER_PREFIX}${field.label}]` : "";
  });
  if (options.missing === "marker") return { text: out, missing };
  // Messages: tidy the gaps an empty value leaves ("at  (Site)." → "at (Site).", "()" removed).
  const tidy = out
    .replace(/\(\s*\)/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([.,!?;:])/g, "$1")
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .trim();
  return { text: tidy, missing };
}

/** Example values for the editor's preview. */
export function exampleValues(): Record<string, string> {
  return Object.fromEntries(MERGE_FIELDS.map((f) => [f.key, f.example]));
}

/** Text the author still has to write: "[[Summarise the findings]]" in the standard letters. */
export const TO_WRITE_PATTERN = /\[\[[^\]]*\]\]/;

/** True when a letter still holds a merge field, a "[not recorded: …]" marker or a "[[…]]" gap to write. */
export function hasUnfilledFields(text: string): boolean {
  return text.includes(MISSING_MARKER_PREFIX) || /\{\{[^{}]*\}\}/.test(text) || TO_WRITE_PATTERN.test(text);
}
