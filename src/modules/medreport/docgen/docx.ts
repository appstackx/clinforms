import "server-only";

/**
 * Word output: docxtemplater@3.71.0 + pizzip@3.3.0 with
 * { paragraphLoop: true, linebreaks: true, nullGetter: (part) => part.module ? "" : "[MISSING]" }.
 * Any "[MISSING]" in the output is reported in `missingTags` (the caller raises it as a flag / header).
 *
 * Tags may use dotted paths ({patient.fullName}); the parser below resolves them without evaluating
 * expressions, and an unresolved name inside a loop falls back to the enclosing scopes as usual.
 *
 * Owner: forms-engine agent (formerly docgen).
 */
import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import { openZipSafely } from "../forms/zip-guard";
import { CLINIC_STYLE_V1_BROKEN_DOCX_BASE64 } from "../templates/generated/clinic-style-v1-broken.docx.b64";
import { CLINIC_STYLE_V1_DOCX_BASE64 } from "../templates/generated/clinic-style-v1.docx.b64";
import { RIVERSIDE_EMPLOYER_V1_DOCX_BASE64 } from "../templates/generated/riverside-employer-v1.docx.b64";
import { RIVERSIDE_SOLICITOR_V1_DOCX_BASE64 } from "../templates/generated/riverside-solicitor-v1.docx.b64";
import type { ReportViewModel } from "./view-model";

/** Text written for a tag the data does not provide. */
export const MISSING_MARKER = "[MISSING]";

const BUILTIN_DOCX_BASE64: Record<string, string> = {
  "riverside-solicitor-v1": RIVERSIDE_SOLICITOR_V1_DOCX_BASE64,
  "riverside-employer-v1": RIVERSIDE_EMPLOYER_V1_DOCX_BASE64,
  "clinic-style-v1": CLINIC_STYLE_V1_DOCX_BASE64,
  "clinic-style-v1-broken": CLINIC_STYLE_V1_BROKEN_DOCX_BASE64,
};

/** Tagged .docx bytes for a built-in template (templates/generated), or null if unknown. */
export function getBuiltinTemplateDocx(docxTemplateId: string): Uint8Array | null {
  const b64 = Object.prototype.hasOwnProperty.call(BUILTIN_DOCX_BASE64, docxTemplateId)
    ? BUILTIN_DOCX_BASE64[docxTemplateId]
    : undefined;
  return b64 ? new Uint8Array(Buffer.from(b64, "base64")) : null;
}

export interface DocxRenderResult {
  bytes: Uint8Array;
  /** Unresolved tags found in the output (rendered as "[MISSING]"). */
  missingTags: string[];
}

type Part = { value?: string; module?: string };

/** Dotted-path lookup only ("a.b.c" or "."); never evaluates expressions. */
export function dottedPathParser(tag: string) {
  const trimmed = tag.trim();
  const path = trimmed === "." || trimmed === "" ? [] : trimmed.split(".").map((p) => p.trim());
  return {
    get(scope: unknown): unknown {
      let value: unknown = scope;
      for (const key of path) {
        if (value === null || value === undefined || typeof value !== "object") return undefined;
        if (!Object.prototype.hasOwnProperty.call(value, key)) return undefined;
        value = (value as Record<string, unknown>)[key];
      }
      return value;
    },
  };
}

/**
 * The options used for every render (and the validation render). `onMissing` receives each tag that
 * resolved to null/undefined.
 */
export function docxtemplaterOptions(onMissing?: (tag: string) => void) {
  return {
    paragraphLoop: true,
    linebreaks: true,
    errorLogging: false,
    parser: dottedPathParser,
    nullGetter(part: Part): string {
      if (part.module) return "";
      if (onMissing && part.value) onMissing(part.value);
      return MISSING_MARKER;
    },
  };
}

/** XML parts docxtemplater fills: the body, headers and footers. */
export function templatedXmlFiles(zip: PizZip): string[] {
  return Object.keys(zip.files).filter((name) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(name));
}

/** Count "[MISSING]" in the visible text of the rendered parts. */
function countMissing(zip: PizZip): number {
  let count = 0;
  for (const name of templatedXmlFiles(zip)) {
    const xml = zip.file(name)?.asText() ?? "";
    const text = xml.replace(/<[^>]+>/g, "");
    count += text.split(MISSING_MARKER).length - 1;
  }
  return count;
}

/** Fill a tagged template. Throws docxtemplater's TemplateError for a malformed template. */
export async function renderDocx(vm: ReportViewModel, templateBytes: Uint8Array): Promise<DocxRenderResult> {
  const missing: string[] = [];
  // Throws ZipLimitError for a zip bomb (callers report the template as invalid).
  const zip = openZipSafely(templateBytes);
  const doc = new Docxtemplater(
    zip,
    docxtemplaterOptions((tag) => {
      if (missing.indexOf(tag) < 0) missing.push(tag);
    }),
  );
  doc.render(vm);
  const out = doc.getZip();
  if (missing.length === 0 && countMissing(out) > 0) missing.push("(unknown)");
  const buffer = out.generate({ type: "uint8array", compression: "DEFLATE" });
  return { bytes: buffer, missingTags: missing };
}

/** Visible text of a rendered .docx (body, headers, footers), one line per paragraph – for tests and checks. */
export function docxPlainText(bytes: Uint8Array): string {
  const zip = openZipSafely(bytes);
  return templatedXmlFiles(zip)
    .map((name) =>
      (zip.file(name)?.asText() ?? "")
        .replace(/<w:tab\/>/g, "\t")
        .replace(/<w:br\/>/g, "\n")
        .replace(/<\/w:p>/g, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, "&"),
    )
    .join("\n");
}
