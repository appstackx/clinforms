import "server-only";

/**
 * PDF invoices, credit notes and statements (@react-pdf/renderer 4.9.0, already a dependency; ESM-only, so it is
 * loaded with a dynamic import()). Built-in Helvetica (no font files: £, – and the other characters used here are in
 * its character set). A4, the clinic's letterhead from its profile, VAT details when the clinic is VAT-registered,
 * "Page x of y", and the demonstration notice on every page for a demonstration clinic.
 *
 * HMRC's invoice contents are covered: a unique sequential number, the date, the clinic's name and address (and VAT
 * number when registered), the customer's name and address, a description of each supply with its date, the net,
 * the VAT per rate and the total.
 */
import React from "react";
import type * as ReactPdf from "@react-pdf/renderer";

export interface PdfClinic {
  name: string;
  legalName: string | null;
  address: string[];
  postcode: string | null;
  phone: string | null;
  email: string | null;
  vatNumber: string | null;
}

export interface PdfParty {
  name: string;
  attention: string | null;
  address: string[];
  postcode: string | null;
  references: { label: string; value: string }[];
}

export interface PdfTableRow {
  cells: string[];
  strong?: boolean;
}

export interface DocumentPdfModel {
  /** "Invoice", "Credit note", "Statement". */
  title: string;
  clinic: PdfClinic;
  /** Number, dates – shown top right. */
  facts: { label: string; value: string }[];
  to: PdfParty;
  columns: { label: string; width: string; align?: "left" | "right" }[];
  rows: PdfTableRow[];
  /** VAT per rate (VAT-registered clinics). */
  vatSummary: { label: string; net: string; vat: string }[] | null;
  totals: { label: string; value: string; strong?: boolean }[];
  notes: string[];
  footerText: string | null;
  demo: boolean;
}

const C = { primary: "#0F766E", text: "#1F2933", muted: "#52606D", rule: "#CBD5E1", tint: "#F0FDFA", warn: "#92400E", warnTint: "#FEF3C7" };

function createDocumentPdf(rp: typeof ReactPdf) {
  const { Document, Page, StyleSheet, Text, View } = rp;
  const s = StyleSheet.create({
    page: { fontFamily: "Helvetica", fontSize: 9.5, lineHeight: 1.4, color: C.text, paddingTop: 40, paddingBottom: 60, paddingHorizontal: 44 },
    head: { flexDirection: "row", justifyContent: "space-between", marginBottom: 18 },
    clinicName: { fontFamily: "Helvetica-Bold", fontSize: 14, color: C.primary },
    small: { fontSize: 8.5, color: C.muted },
    title: { fontFamily: "Helvetica-Bold", fontSize: 18, textAlign: "right", color: C.text },
    factRow: { flexDirection: "row", justifyContent: "flex-end", fontSize: 9 },
    factLabel: { color: C.muted, marginRight: 6 },
    to: { marginBottom: 14, padding: 10, backgroundColor: C.tint, borderRadius: 3 },
    toLabel: { fontSize: 8, color: C.muted, textTransform: "uppercase", marginBottom: 2 },
    bold: { fontFamily: "Helvetica-Bold" },
    th: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: C.primary, paddingBottom: 3, marginTop: 4, fontFamily: "Helvetica-Bold", fontSize: 8.5 },
    tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: C.rule, paddingVertical: 4 },
    totals: { marginTop: 10, alignSelf: "flex-end", width: "48%" },
    totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
    vat: { marginTop: 12, width: "60%" },
    note: { marginTop: 12, fontSize: 9 },
    demo: { position: "absolute", top: 14, left: 44, right: 44, fontSize: 8, color: C.warn, backgroundColor: C.warnTint, padding: 3, textAlign: "center" },
    footer: { position: "absolute", bottom: 24, left: 44, right: 44, flexDirection: "row", justifyContent: "space-between", fontSize: 7.5, color: C.muted },
  });
  const cell = (text: string, width: string, align: "left" | "right" = "left", bold = false, key?: string | number) => (
    <Text key={key} style={{ width, textAlign: align, paddingRight: align === "left" ? 4 : 0, fontFamily: bold ? "Helvetica-Bold" : "Helvetica" }}>
      {text}
    </Text>
  );
  return function DocumentPdf({ m }: { m: DocumentPdfModel }) {
    const clinicLines = [m.clinic.legalName && m.clinic.legalName !== m.clinic.name ? m.clinic.legalName : null, ...m.clinic.address, m.clinic.postcode, [m.clinic.phone, m.clinic.email].filter(Boolean).join(" · ") || null, m.clinic.vatNumber ? `VAT number ${m.clinic.vatNumber}` : null].filter(
      (l): l is string => typeof l === "string" && l.length > 0,
    );
    return (
      <Document title={`${m.title} ${m.facts[0]?.value ?? ""}`.trim()} author={m.clinic.name} creator={m.clinic.name} producer={m.clinic.name}>
        <Page size="A4" style={s.page}>
          {m.demo ? (
            <Text style={s.demo} fixed>
              Demonstration clinic – fictional patient and document. Not a real invoice: do not pay.
            </Text>
          ) : null}
          <View style={s.head}>
            <View style={{ width: "55%" }}>
              <Text style={s.clinicName}>{m.clinic.name}</Text>
              {clinicLines.map((l, i) => (
                <Text key={i} style={s.small}>
                  {l}
                </Text>
              ))}
            </View>
            <View style={{ width: "42%" }}>
              <Text style={s.title}>{m.title}</Text>
              {m.facts.map((f, i) => (
                <View key={i} style={s.factRow}>
                  <Text style={s.factLabel}>{f.label}</Text>
                  <Text style={s.bold}>{f.value}</Text>
                </View>
              ))}
            </View>
          </View>
          <View style={s.to}>
            <Text style={s.toLabel}>To</Text>
            <Text style={s.bold}>{m.to.name}</Text>
            {m.to.attention ? <Text>For the attention of {m.to.attention}</Text> : null}
            {[...m.to.address, m.to.postcode].filter((l): l is string => Boolean(l)).map((l, i) => (
              <Text key={i}>{l}</Text>
            ))}
            {m.to.references.map((r, i) => (
              <Text key={`r${i}`} style={s.small}>
                {r.label}: {r.value}
              </Text>
            ))}
          </View>
          <View style={s.th} fixed>
            {m.columns.map((c, i) => cell(c.label, c.width, c.align, true, i))}
          </View>
          {m.rows.map((r, ri) => (
            <View key={ri} style={s.tr} wrap={false}>
              {r.cells.map((text, ci) => cell(text, m.columns[ci]?.width ?? "10%", m.columns[ci]?.align, r.strong, ci))}
            </View>
          ))}
          {m.vatSummary && m.vatSummary.length > 0 ? (
            <View style={s.vat} wrap={false}>
              <View style={s.th}>
                {cell("VAT rate", "40%", "left", true)}
                {cell("Net", "30%", "right", true)}
                {cell("VAT", "30%", "right", true)}
              </View>
              {m.vatSummary.map((v, i) => (
                <View key={i} style={s.tr}>
                  {cell(v.label, "40%")}
                  {cell(v.net, "30%", "right")}
                  {cell(v.vat, "30%", "right")}
                </View>
              ))}
            </View>
          ) : null}
          <View style={s.totals} wrap={false}>
            {m.totals.map((t, i) => (
              <View key={i} style={s.totalRow}>
                <Text style={t.strong ? s.bold : undefined}>{t.label}</Text>
                <Text style={t.strong ? s.bold : undefined}>{t.value}</Text>
              </View>
            ))}
          </View>
          {m.notes.map((n, i) => (
            <Text key={i} style={s.note}>
              {n}
            </Text>
          ))}
          <View style={s.footer} fixed>
            <Text>{m.footerText ?? m.clinic.name}</Text>
            <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
          </View>
        </Page>
      </Document>
    );
  };
}

/** Renders a document model to PDF bytes. */
export async function renderDocumentPdf(model: DocumentPdfModel): Promise<Uint8Array> {
  const rp = await import("@react-pdf/renderer");
  const DocumentPdf = createDocumentPdf(rp);
  const element = React.createElement(DocumentPdf, { m: model }) as unknown as Parameters<typeof rp.renderToBuffer>[0];
  const buffer = await rp.renderToBuffer(element);
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}
