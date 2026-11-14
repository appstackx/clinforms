import "server-only";

/**
 * A home exercise programme as a printable PDF (A4, ex04) – the same document for the clinician (record → Exercises →
 * the programme → "Print (PDF)") and the patient (portal → the programme → "Download as PDF"). @react-pdf/renderer
 * with the bundled DejaVu Sans, as the letters (src/server/pms/comms/letter-output.tsx). Plain .ts with
 * React.createElement (no JSX), so the gateway's test typecheck can import the records service. Nothing is fetched: picture
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
  const h = React.createElement;
  return function ProgrammePdf({ d }: { d: ProgrammeDocument }) {
    const m = mark(d);
    const items = d.items.map((it, i) => {
      const dose = doseLine(it);
      return h(
        View,
        { key: i, style: s.item, wrap: false },
        h(Text, { style: s.name }, `${i + 1}. ${it.name}`),
        dose ? h(Text, { style: s.dose }, dose) : null,
        it.instructions ? h(Text, { style: s.p }, it.instructions) : null,
        it.cautions ? h(Text, { style: s.p }, h(Text, { style: s.label }, "Take care: "), it.cautions) : null,
        it.notes ? h(Text, { style: s.p }, h(Text, { style: s.label }, "Note: "), it.notes) : null,
        it.videoUrl ? h(Text, { style: s.link }, `Video: ${it.videoUrl}`) : null,
        it.imageUrl ? h(Text, { style: s.link }, `Picture: ${it.imageUrl}`) : null,
        h(
          View,
          { style: s.tick },
          ...["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) =>
            h(View, { key: day, style: { flexDirection: "row", alignItems: "center", marginRight: 8 } }, h(View, { style: s.box }), h(Text, { style: s.small }, day)),
          ),
        ),
      );
    });
    return h(
      Document,
      { title: d.title, language: "en-GB" },
      h(
        Page,
        { size: "A4", style: s.page },
        m ? h(Text, { style: s.mark, fixed: true }, m.toUpperCase()) : null,
        h(
          View,
          { style: s.head },
          h(View, null, h(Text, { style: s.clinic }, d.clinic.name), d.clinic.phone ? h(Text, { style: s.small }, d.clinic.phone) : null),
          h(Text, { style: s.small }, d.sharedAt ? `Given ${formatUkDate(d.sharedAt.slice(0, 10))}` : "Not shared yet"),
        ),
        h(Text, { style: s.title }, d.title),
        h(Text, { style: s.for }, `Home exercise programme for ${d.patientName}${d.prescribedBy ? ` · from ${d.prescribedBy}` : ""}`),
        d.notes ? h(View, { style: s.note }, h(Text, null, d.notes)) : null,
        ...items,
        h(
          View,
          { style: s.footer, fixed: true },
          h(Text, null, "Stop and contact the clinic if an exercise causes sharp or worsening pain."),
          h(Text, { render: ({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) => `Page ${pageNumber} of ${totalPages}` }),
        ),
      ),
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
