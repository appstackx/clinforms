import "server-only";

/**
 * A letter as a file (K2-LTR-005, LTR-002): Word (.docx) and PDF, in the same A4 layout as the letter page
 * (src/components/pms/comms/letter-sheet.tsx): the clinic's name and address, the date, the recipient's address
 * block, the subject line, the body (blank lines = paragraphs, "- " lines = bullets) and the signature line once
 * signed. A draft is marked "Draft – not signed", a withdrawn letter "Withdrawn".
 *
 * The repo's own document libraries: Word is written as WordprocessingML and zipped with pizzip (the library under
 * the ClinForms Word engine, src/modules/medreport/docgen/docx.ts); PDF with @react-pdf/renderer and the bundled
 * DejaVu Sans (src/modules/medreport/docgen/pdf/fonts.ts – it draws "→", "–" and "£"). Nothing is fetched.
 */
import PizZip from "pizzip";
import React from "react";
import type * as ReactPdf from "@react-pdf/renderer";
import { PDF_FONT_FAMILY, ensurePdfFonts } from "../../../modules/medreport/docgen/pdf/fonts";
import { formatUkDate } from "../../../modules/pms/core/text";

export type LetterBlock = { kind: "p"; text: string } | { kind: "ul"; items: string[] };

export interface LetterDocument {
  clinic: { name: string; lines: string[]; phone: string | null };
  /** "YYYY-MM-DD" */
  letterOn: string;
  recipient: { name: string | null; address: string[] | null; postcode: string | null };
  subject: string;
  body: string;
  signature: string | null;
  draft: boolean;
  withdrawn: boolean;
}

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** The body as paragraphs and bullet lists (the letter page's rules). */
export function letterBlocks(body: string): LetterBlock[] {
  const out: LetterBlock[] = [];
  for (const block of body.replace(/\r\n?/g, "\n").split(/\n{2,}/)) {
    if (!block.trim()) continue;
    const lines = block.split("\n");
    if (lines.every((l) => /^\s*[-•]\s+/.test(l))) out.push({ kind: "ul", items: lines.map((l) => l.replace(/^\s*[-•]\s+/, "")) });
    else out.push({ kind: "p", text: block });
  }
  return out;
}

function recipientLines(d: LetterDocument): string[] {
  return [d.recipient.name, ...(d.recipient.address ?? []), d.recipient.postcode].filter((x): x is string => Boolean(x && x.trim()));
}

function mark(d: LetterDocument): string | null {
  return d.withdrawn ? "Withdrawn" : d.draft ? "Draft – not signed" : null;
}

/* ------------------------------------------------------------------------------------------------
 * Word
 * ----------------------------------------------------------------------------------------------*/

function esc(text: string): string {
  // XML 1.0 forbids most control characters; drop them rather than write a file Word refuses.
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** A run; line breaks inside become <w:br/>. */
function run(text: string, opts: { bold?: boolean; size?: number; color?: string } = {}): string {
  const rpr = [opts.bold ? "<w:b/>" : "", opts.color ? `<w:color w:val="${opts.color}"/>` : "", opts.size ? `<w:sz w:val="${opts.size}"/><w:szCs w:val="${opts.size}"/>` : ""].join("");
  const parts = text.split("\n").map((t) => `<w:t xml:space="preserve">${esc(t)}</w:t>`);
  return `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ""}${parts.join("<w:br/>")}</w:r>`;
}

function para(runs: string, opts: { after?: number; before?: number; align?: "right"; bullet?: boolean; keep?: boolean } = {}): string {
  const ppr = [
    opts.bullet ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' : "",
    `<w:spacing w:before="${opts.before ?? 0}" w:after="${opts.after ?? 120}"/>`,
    opts.align ? `<w:jc w:val="${opts.align}"/>` : "",
  ].join("");
  return `<w:p><w:pPr>${ppr}</w:pPr>${runs}</w:p>`;
}

const NUMBERING_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:eastAsia="Arial"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`;

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;

const ROOT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;

const DOC_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>`;

function coreXml(title: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${esc(title)}</dc:title></cp:coreProperties>`;
}

/** The letter as a Word file (A4, 2 cm margins). */
export function renderLetterDocx(d: LetterDocument): Uint8Array {
  const body: string[] = [];
  const m = mark(d);
  if (m) body.push(para(run(m.toUpperCase(), { bold: true, size: 18, color: "64748B" }), { align: "right" }));
  body.push(para(run(d.clinic.name, { bold: true, size: 24 }), { after: 0 }));
  for (const l of [...d.clinic.lines, ...(d.clinic.phone ? [d.clinic.phone] : [])]) body.push(para(run(l, { size: 19, color: "334155" }), { after: 0 }));
  body.push(para(run(formatUkDate(d.letterOn)), { align: "right", before: 240, after: 360 }));
  const to = recipientLines(d);
  to.forEach((l, i) => body.push(para(run(l), { after: i === to.length - 1 ? 360 : 0 })));
  body.push(para(run(d.subject, { bold: true }), { after: 200 }));
  for (const b of letterBlocks(d.body)) {
    if (b.kind === "ul") for (const item of b.items) body.push(para(run(item), { bullet: true, after: 60 }));
    else body.push(para(run(b.text)));
  }
  if (d.signature) {
    body.push(para(run(d.signature.split(",")[0], { size: 30 }), { before: 360, after: 0 }));
    body.push(para(run(d.signature, { size: 20, color: "334155" }), { after: 0 }));
    body.push(para(run("Signed electronically", { size: 17, color: "64748B" })));
  }
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const zip = new PizZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES_XML);
  zip.file("_rels/.rels", ROOT_RELS_XML);
  zip.file("word/_rels/document.xml.rels", DOC_RELS_XML);
  zip.file("word/document.xml", documentXml);
  zip.file("word/styles.xml", STYLES_XML);
  zip.file("word/numbering.xml", NUMBERING_XML);
  zip.file("docProps/core.xml", coreXml(d.subject));
  return zip.generate({ type: "uint8array", compression: "DEFLATE" });
}

/* ------------------------------------------------------------------------------------------------
 * PDF
 * ----------------------------------------------------------------------------------------------*/

function createLetterPdf(rp: typeof ReactPdf) {
  const { Document, Page, StyleSheet, Text, View } = rp;
  const s = StyleSheet.create({
    page: { fontFamily: PDF_FONT_FAMILY, fontSize: 10.5, lineHeight: 1.45, color: "#0F172A", paddingTop: 51, paddingBottom: 60, paddingHorizontal: 57 },
    head: { flexDirection: "row", justifyContent: "space-between", marginBottom: 34 },
    clinic: { fontWeight: 700, fontSize: 12 },
    small: { fontSize: 9, color: "#334155" },
    mark: { position: "absolute", top: 22, right: 57, fontSize: 8.5, fontWeight: 700, color: "#64748B", borderWidth: 0.75, borderColor: "#CBD5E1", paddingHorizontal: 4, paddingVertical: 1 },
    to: { marginBottom: 28 },
    subject: { fontWeight: 700, marginBottom: 6 },
    p: { marginVertical: 4 },
    li: { flexDirection: "row", marginVertical: 1, paddingLeft: 6 },
    dot: { width: 12 },
    sign: { marginTop: 18, paddingTop: 8, borderTopWidth: 0.75, borderTopColor: "#E2E8F0" },
    signName: { fontSize: 15 },
    footer: { position: "absolute", bottom: 26, left: 57, right: 57, fontSize: 7.5, color: "#64748B", textAlign: "right" },
  });
  return function LetterPdf({ d }: { d: LetterDocument }) {
    const m = mark(d);
    return (
      <Document title={d.subject} language="en-GB">
        <Page size="A4" style={s.page}>
          {m ? (
            <Text style={s.mark} fixed>
              {m.toUpperCase()}
            </Text>
          ) : null}
          <View style={s.head}>
            <View>
              <Text style={s.clinic}>{d.clinic.name}</Text>
              {d.clinic.lines.map((l, i) => (
                <Text key={i} style={s.small}>
                  {l}
                </Text>
              ))}
              {d.clinic.phone ? <Text style={s.small}>{d.clinic.phone}</Text> : null}
            </View>
            <Text>{formatUkDate(d.letterOn)}</Text>
          </View>
          <View style={s.to}>
            {recipientLines(d).map((l, i) => (
              <Text key={i}>{l}</Text>
            ))}
          </View>
          <Text style={s.subject}>{d.subject}</Text>
          {letterBlocks(d.body).map((b, i) =>
            b.kind === "ul" ? (
              <View key={i} style={s.p}>
                {b.items.map((item, j) => (
                  <View key={j} style={s.li} wrap={false}>
                    <Text style={s.dot}>•</Text>
                    <Text>{item}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text key={i} style={s.p}>
                {b.text}
              </Text>
            ),
          )}
          {d.signature ? (
            <View style={s.sign} wrap={false}>
              <Text style={s.signName}>{d.signature.split(",")[0]}</Text>
              <Text style={s.small}>{d.signature}</Text>
              <Text style={{ fontSize: 8, color: "#64748B" }}>Signed electronically</Text>
            </View>
          ) : null}
          <Text style={s.footer} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} fixed />
        </Page>
      </Document>
    );
  };
}

/** The letter as a PDF (A4). */
export async function renderLetterPdf(d: LetterDocument): Promise<Uint8Array> {
  const rp = await import("@react-pdf/renderer");
  ensurePdfFonts(rp.Font);
  const LetterPdf = createLetterPdf(rp);
  const element = React.createElement(LetterPdf, { d }) as unknown as Parameters<typeof rp.renderToBuffer>[0];
  const buffer = await rp.renderToBuffer(element);
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}
