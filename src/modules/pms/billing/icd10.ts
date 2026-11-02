/**
 * ICD-10 diagnosis codes on cases and insurer invoices (HC10, docs/clinic-system/healthcode.md). Pure.
 *
 * Format: a letter and two digits, optionally followed by a full stop and one or two characters ("M54", "M54.5",
 * "S93.40"). Typed without the full stop ("M545") it is read as "M54.5". Lower case is accepted and stored upper case.
 * Only the format is checked – not whether the code exists – so every valid ICD-10 code a clinic uses is accepted.
 *
 * COMMON_MSK_ICD10 is a short picker list of well-known musculoskeletal codes (WHO ICD-10). It is a convenience, not
 * a schedule: any code in the right format can be typed.
 */
import { z } from "zod";

const ICD10 = /^([A-Z])(\d{2})(?:\.?([0-9A-Z]{1,2}))?$/;

/** "m545" → "M54.5", " S93.4 " → "S93.4"; null when it is not in ICD-10 format. */
export function normaliseIcd10(value: string): string | null {
  const m = ICD10.exec(value.trim().toUpperCase());
  if (!m) return null;
  return `${m[1]}${m[2]}${m[3] ? `.${m[3]}` : ""}`;
}

export function isValidIcd10(value: string | null | undefined): boolean {
  return typeof value === "string" && normaliseIcd10(value) !== null;
}

export const ICD10_FORMAT_MESSAGE = "Enter an ICD-10 code: a letter and two numbers, then optionally a full stop and one or two more (for example M54.5)";

/** An optional ICD-10 code: "" / null = none; else normalised, or refused with a plain message. */
export const OptionalIcd10Schema = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v, ctx) => {
    if (v === undefined || v === null) return v;
    if (v.trim() === "") return null;
    const code = normaliseIcd10(v);
    if (!code) {
      ctx.addIssue({ code: "custom", message: ICD10_FORMAT_MESSAGE });
      return z.NEVER;
    }
    return code;
  });

export interface Icd10Option {
  code: string;
  label: string;
}

/** Well-known musculoskeletal ICD-10 codes for the picker (WHO ICD-10 titles, shortened for the screen). */
export const COMMON_MSK_ICD10: readonly Icd10Option[] = [
  { code: "M54.5", label: "Low back pain" },
  { code: "M54.4", label: "Lumbago with sciatica" },
  { code: "M54.3", label: "Sciatica" },
  { code: "M54.2", label: "Cervicalgia (neck pain)" },
  { code: "M51.1", label: "Lumbar disc disorder with radiculopathy" },
  { code: "S13.4", label: "Sprain and strain of cervical spine (whiplash)" },
  { code: "S33.5", label: "Sprain and strain of lumbar spine" },
  { code: "M75.0", label: "Adhesive capsulitis of shoulder (frozen shoulder)" },
  { code: "M75.1", label: "Rotator cuff syndrome" },
  { code: "M75.4", label: "Impingement syndrome of shoulder" },
  { code: "M77.0", label: "Medial epicondylitis (golfer's elbow)" },
  { code: "M77.1", label: "Lateral epicondylitis (tennis elbow)" },
  { code: "G56.0", label: "Carpal tunnel syndrome" },
  { code: "M65.3", label: "Trigger finger" },
  { code: "M16.1", label: "Primary osteoarthritis of hip" },
  { code: "M70.6", label: "Trochanteric bursitis" },
  { code: "M17.1", label: "Primary osteoarthritis of knee" },
  { code: "M22.2", label: "Patellofemoral disorders" },
  { code: "S83.5", label: "Sprain of cruciate ligament of knee" },
  { code: "S93.4", label: "Sprain and strain of ankle" },
  { code: "M76.6", label: "Achilles tendinitis" },
  { code: "M72.2", label: "Plantar fasciitis" },
  { code: "M79.1", label: "Myalgia" },
];

/** Picker search: by code prefix or words of the label; empty = the whole list. At most `limit`. */
export function searchIcd10(query: string, limit = 8): Icd10Option[] {
  const q = query.trim().toLowerCase();
  if (!q) return COMMON_MSK_ICD10.slice(0, limit);
  const compact = q.replace(/\./g, "");
  const words = q.split(/\s+/).filter(Boolean);
  return COMMON_MSK_ICD10.filter((o) => o.code.toLowerCase().replace(/\./g, "").startsWith(compact) || words.every((w) => o.label.toLowerCase().includes(w))).slice(0, limit);
}

/** The picker's label of a code (null when it is not in the short list). */
export function icd10Label(code: string | null | undefined): string | null {
  if (!code) return null;
  return COMMON_MSK_ICD10.find((o) => o.code === code)?.label ?? null;
}
