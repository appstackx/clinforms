import "server-only";

/**
 * A home exercise programme as a printable PDF (A4, ex04) – the same document for the clinician (record → Exercises →
 * the programme → "Print (PDF)") and the patient (portal → the programme → "Download as PDF"). @react-pdf/renderer
 * with the bundled DejaVu Sans, as the letters (src/server/pms/comms/letter-output.tsx). Nothing is fetched: picture
 * and video links are printed as addresses, never loaded.
 */
import React from "react";
import type * as ReactPdf from "@react-pdf/renderer";
import { PDF_FONT_FAMILY, ensurePdfFonts } from "../../../modules/medreport/docgen/pdf/fonts";
import { formatUkDate } from "../../../modules/pms/core/text";
import { doseLine, type ProgrammeItem } from "../../../modules/pms/records/exercises";

export interface ProgrammeDocument {
  clinic: { name: string; phone: string | null };
  patientName: string;
  title: string;
  notes: string | null;
  items: ProgrammeItem[];
  /** ISO timestamp, or null for a draft. */
  sharedAt: string | null;
  prescribedBy: string | null;
  status: "draft" | "shared" | "ended";
}

function mark(d: ProgrammeDocument): string | null {
  return d.status === "draft" ? "Draft – not shared with the patient" : d.status === "ended" ? "Ended – no longer current" : null;
}

function createProgrammePdf(rp: typeof ReactPdf) {
  const { Document, Page, StyleSheet, Text, View } = rp;
  const s = StyleSheet.create({
    page: { fontFamily: PDF_FONT_FAMILY, fontSize: 10.5, lineHeight: 1.45, color: "#0F172A", paddingTop: 48, paddingBottom: 60, paddingHorizontal: 50 },
    head: { flexDirection: "row", justifyContent: "space-between", marginBottom: 18 },
    clinic: { fontWeight: 700, fontSize: 12 },
    small: { fontSize: 9, color: "#334155" },
    mark: { position: "absolute", top: 20, right: 50, fontSize: 8.5, fontWeight: 700, color: "#64748B", borderWidth: 0.75, borderColor: "#CBD5E1", paddingHorizontal: 4, paddingVertical: 1 },
    title: { fontSize: 16, fontWeight: 700, marginBottom: 2 },
    for: { fontSize: 10, color: "#334155", marginBottom: 12 },
    note: { borderWidth: 0.75, borderColor: "#E2E8F0", backgroundColor: "#F8FAFC", padding: 8, marginBottom: 12 },
    item: { borderTopWidth: 0.75, borderTopColor: "#E2E8F0", paddingTop: 8, marginTop: 8 },
    name: { fontSize: 12, fontWeight: 700 },
    dose: { fontSize: 10.5, fontWeight: 700, color: "#0F766E", marginTop: 1 },
    label: { fontWeight: 700 },
    p: { marginTop: 3 },
    link: { fontSize: 8.5, color: "#334155", marginTop: 2 },
    tick: { flexDirection: "row", marginTop: 6 },
    box: { width: 14, height: 14, borderWidth: 0.75, borderColor: "#94A3B8", marginRight: 4 },
    footer: { position: "absolute", bottom: 26, left: 50, right: 50, fontSize: 7.5, color: "#64748B", flexDirection: "row", justifyContent: "space-between" },
  });
  return function ProgrammePdf({ d }: { d: ProgrammeDocument }) {
    const m = mark(d);
    return (
      <Document title={d.title} language="en-GB">
        <Page size="A4" style={s.page}>
          {m ? (
            <Text style={s.mark} fixed>
              {m.toUpperCase()}
            </Text>
          ) : null}
          <View style={s.head}>
            <View>
              <Text style={s.clinic}>{d.clinic.name}</Text>
              {d.clinic.phone ? <Text style={s.small}>{d.clinic.phone}</Text> : null}
            </View>
            <Text style={s.small}>{d.sharedAt ? `Given ${formatUkDate(d.sharedAt.slice(0, 10))}` : "Not shared yet"}</Text>
          </View>
          <Text style={s.title}>{d.title}</Text>
          <Text style={s.for}>
            Home exercise programme for {d.patientName}
            {d.prescribedBy ? ` · from ${d.prescribedBy}` : ""}
          </Text>
          {d.notes ? (
            <View style={s.note}>
              <Text>{d.notes}</Text>
            </View>
          ) : null}
          {d.items.map((it, i) => {
            const dose = doseLine(it);
            return (
              <View key={i} style={s.item} wrap={false}>
                <Text style={s.name}>
                  {i + 1}. {it.name}
                </Text>
                {dose ? <Text style={s.dose}>{dose}</Text> : null}
                {it.instructions ? <Text style={s.p}>{it.instructions}</Text> : null}
                {it.cautions ? (
                  <Text style={s.p}>
                    <Text style={s.label}>Take care: </Text>
                    {it.cautions}
                  </Text>
                ) : null}
                {it.notes ? (
                  <Text style={s.p}>
                    <Text style={s.label}>Note: </Text>
                    {it.notes}
                  </Text>
                ) : null}
                {it.videoUrl ? <Text style={s.link}>Video: {it.videoUrl}</Text> : null}
                {it.imageUrl ? <Text style={s.link}>Picture: {it.imageUrl}</Text> : null}
                <View style={s.tick}>
                  {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
                    <View key={day} style={{ flexDirection: "row", alignItems: "center", marginRight: 8 }}>
                      <View style={s.box} />
                      <Text style={s.small}>{day}</Text>
                    </View>
                  ))}
                </View>
              </View>
            );
          })}
          <View style={s.footer} fixed>
            <Text>Stop and contact the clinic if an exercise causes sharp or worsening pain.</Text>
            <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
          </View>
        </Page>
      </Document>
    );
  };
}

/** The programme as a PDF (A4). */
export async function renderProgrammePdf(d: ProgrammeDocument): Promise<Uint8Array> {
  const rp = await import("@react-pdf/renderer");
  ensurePdfFonts(rp.Font);
  const ProgrammePdf = createProgrammePdf(rp);
  const element = React.createElement(ProgrammePdf, { d }) as unknown as Parameters<typeof rp.renderToBuffer>[0];
  const buffer = await rp.renderToBuffer(element);
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

/** "home-exercises-2026-11-12.pdf" – never the patient's name or the programme's title in the file name. */
export function programmePdfFileName(sharedAt: string | null, today: string): string {
  return `home-exercises-${(sharedAt ?? today).slice(0, 10)}.pdf`;
}
