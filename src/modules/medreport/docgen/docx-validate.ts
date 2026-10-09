import "server-only";

/**
 * Validates an uploaded tagged .docx: parses it with docxtemplater, collects tags, translates
 * TemplateErrors (unclosed tags, tags split across paragraphs/cells, tracked changes…) into plain
 * English, then does a validation render with empty data.
 *
 * Tags: every {tag}, {#loop}, {^inverted} and {/close} in the body, headers and footers (visible text,
 * runs joined per paragraph). Unknown tags (not in templates/tag-reference.ts) are errors – they would
 * print "[MISSING]"; required tags ({#sections}, {#isDraft}, {#signed}) must be present.
 *
 * Owner: forms-engine agent (formerly docgen).
 */
import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import { ZipLimitError, openZipSafely } from "../forms/zip-guard";
import type { TemplateError, TemplatesValidateResponse } from "../api/contract";
import { REQUIRED_TEMPLATE_TAGS, TEMPLATE_TAG_REFERENCE } from "../templates/tag-reference";
import { docxtemplaterOptions, templatedXmlFiles } from "./docx";

const KNOWN = new Set(TEMPLATE_TAG_REFERENCE.map((t) => t.tag));
const TOP_LEVEL = TEMPLATE_TAG_REFERENCE.filter((t) => !t.insideLoop).map((t) => t.tag);

function partLabel(file: string | undefined): string | undefined {
  if (!file) return undefined;
  if (/document\.xml$/.test(file)) return "Main text";
  if (/header\d*\.xml$/.test(file)) return "Page header";
  if (/footer\d*\.xml$/.test(file)) return "Page footer";
  return file;
}

/** Known tag that starts the swallowed text of an unclosed tag ("instructingParty.referenceDate:" → "instructingParty.reference"). */
function knownPrefix(xtag: string): string {
  const raw = xtag.replace(/^[#^/]/, "").trim();
  const match = Array.from(KNOWN)
    .filter((t) => raw.startsWith(t))
    .sort((a, b) => b.length - a.length)[0];
  return match ?? raw.split(/[\s:,;]/)[0];
}

interface DtError {
  properties?: { id?: string; xtag?: string; file?: string; explanation?: string; errors?: DtError[] };
  message?: string;
}

function translate(err: DtError): TemplateError {
  const p = err.properties ?? {};
  const xtag = p.xtag ?? "";
  const tag = xtag ? knownPrefix(xtag) : undefined;
  const location = partLabel(p.file);
  const base = { ...(tag && { tag }), ...(location && { location }) };
  switch (p.id) {
    case "unclosed_tag":
      return { code: "unclosed_tag", message: `The tag "{${tag}" is never closed: add "}" at the end of it.`, ...base };
    case "unopened_tag":
      return { code: "unopened_tag", message: `There is a "}" after "${xtag}" with no matching "{". Delete it or add the opening "{".`, ...base };
    case "unclosed_loop":
      return { code: "unclosed_loop", message: `The section "{#${tag}}" is opened but never closed: add "{/${tag}}" where it should end.`, ...base };
    case "unopened_loop":
      return { code: "unopened_loop", message: `"{/${tag}}" closes a section that was never opened: add "{#${tag}}" before it, or delete it.`, ...base };
    case "closing_tag_does_not_match_opening_tag":
      return { code: "mismatched_loop", message: `A section is closed with the wrong name near "${xtag}". Each "{#name}" needs a matching "{/name}".`, ...base };
    case "duplicate_open_tag":
      return { code: "duplicate_open_tag", message: `"{{" was found near "${xtag}". Tags use single braces, e.g. {patient.fullName}.`, ...base };
    case "duplicate_close_tag":
      return { code: "duplicate_close_tag", message: `"}}" was found near "${xtag}". Tags use single braces, e.g. {patient.fullName}.`, ...base };
    case "loop_position_invalid":
      return {
        code: "tag_split_across_paragraphs",
        message: `The section "{#${tag}}" starts and ends in different table cells or paragraphs. Put "{#${tag}}" and "{/${tag}}" in the same cell, or in paragraphs of their own.`,
        ...base,
      };
    default:
      return { code: p.id ?? "template_error", message: p.explanation ?? err.message ?? "The template could not be read.", ...base };
  }
}

/** Visible text of every templated part, one paragraph per line (runs joined, so split tags are found). */
function partTexts(zip: PizZip): { file: string; text: string }[] {
  return templatedXmlFiles(zip).map((file) => ({
    file,
    text: (zip.file(file)?.asText() ?? "")
      .replace(/<w:del\b[\s\S]*?<\/w:del>/g, "")
      .replace(/<w:instrText[^>]*>[\s\S]*?<\/w:instrText>/g, "")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, "&"),
  }));
}

export function validateDocxTemplate(bytes: Uint8Array): TemplatesValidateResponse {
  let zip: PizZip;
  try {
    zip = openZipSafely(bytes);
  } catch (err) {
    if (err instanceof ZipLimitError) {
      return {
        ok: false,
        tags: [],
        errors: [{ code: "not_docx", message: `${err.message} Save the template from Word as an ordinary “Word Document (.docx)” and upload it again.` }],
        unusedTags: [],
        unknownTags: [],
      };
    }
    return {
      ok: false,
      tags: [],
      errors: [{ code: "not_docx", message: "This file is not a Word document (.docx). Save it from Word as “Word Document (.docx)” and upload it again." }],
      unusedTags: [],
      unknownTags: [],
    };
  }
  if (!zip.file("word/document.xml")) {
    return { ok: false, tags: [], errors: [{ code: "not_docx", message: "This file has no Word document body. Upload a .docx template." }], unusedTags: [], unknownTags: [] };
  }

  const errors: TemplateError[] = [];
  const xml = templatedXmlFiles(zip).map((f) => zip.file(f)?.asText() ?? "").join("");
  if (/<w:(ins|del)\b/.test(xml)) {
    errors.push({
      code: "tracked_changes",
      message: "The template contains tracked changes. In Word, choose Review → Accept All Changes, turn Track Changes off, save and upload again.",
    });
  }

  let compiled = false;
  try {
    const doc = new Docxtemplater(zip, docxtemplaterOptions());
    compiled = true;
    try {
      doc.render({});
    } catch (err) {
      const e = err as DtError;
      for (const sub of e.properties?.errors ?? [e]) errors.push(translate(sub));
    }
  } catch (err) {
    const e = err as DtError;
    for (const sub of e.properties?.errors ?? [e]) errors.push(translate(sub));
  }

  // Tags as written (open/close markers kept), from the original file.
  const tags: string[] = [];
  for (const { text } of partTexts(openZipSafely(bytes))) {
    for (const m of Array.from(text.matchAll(/\{([#^/]?)([^{}\n]{1,80})\}/g))) {
      const t = `${m[1]}${m[2].trim()}`;
      if (!tags.includes(t)) tags.push(t);
    }
  }
  const names = Array.from(new Set(tags.map((t) => t.replace(/^[#^/]/, ""))));
  const unknownTags = compiled ? names.filter((n) => n !== "." && !KNOWN.has(n)) : [];
  for (const tag of unknownTags) {
    errors.push({ code: "unknown_tag", tag, message: `"{${tag}}" is not a tag this product provides, so “[MISSING]” would be printed. Check the spelling against the tag list.` });
  }
  if (compiled) {
    for (const req of REQUIRED_TEMPLATE_TAGS) {
      if (!names.includes(req.tag)) errors.push({ code: "missing_required_tag", tag: req.tag, message: `Without {#${req.tag}} ${req.why}. ${req.fix}` });
    }
  }
  const unusedTags = TOP_LEVEL.filter((t) => !names.includes(t));
  return { ok: errors.length === 0, tags, errors, unusedTags, unknownTags };
}
