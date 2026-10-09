import "server-only";

/**
 * @react-pdf document for a ReportViewModel: our house layout (not a pixel copy of the Word file).
 * Same content as the .docx: letterhead, details, numbered sections with the locked "from records"
 * tables, declaration, signature (or the unsigned notice), and the records-reviewed appendix.
 * Unsigned copies carry a DRAFT watermark on every page; the footer shows the fingerprint and
 * "Page x of y".
 *
 * @react-pdf/renderer is ESM-only, so docgen/pdf.ts loads it with a dynamic import() and passes it to
 * createReportPdf(); this file only imports its types. Call ensurePdfFonts() before rendering.
 *
 * Owner: forms-engine agent (formerly docgen).
 */
import React from "react";
import type * as ReactPdf from "@react-pdf/renderer";
import { PDF_FONT_FAMILY } from "./fonts";
import type { AttendanceRow, OutcomeRow, RecordsReviewedRow, ReportViewModel, ReportViewSection } from "../view-model";

const C = {
  primary: "#0F766E",
  accent: "#0D9488",
  text: "#1F2933",
  muted: "#52606D",
  rule: "#CBD5E1",
  ruleTeal: "#99D5CF",
  tint: "#F0FDFA",
  draft: "#B42318",
  draftTint: "#FEF3F2",
  bar: "#5EC7BC",
};

type Column<T> = { label: string; width: string; get: (row: T) => string; bold?: (row: T) => boolean; align?: "left" | "center" };

/** Scale maximum for a mini bar chart: percentages out of 100, "/10" scales out of 10. */
function scaleMax(row: OutcomeRow): number {
  const m = /^\/(\d+(?:\.\d+)?)$/.exec(row.unit);
  if (m) return Number(m[1]);
  if (row.unit === "%") return 100;
  return Math.max(...row.points.map((p) => parseFloat(p.value) || 0), 1);
}

export type ReportPdfComponent = (props: { vm: ReportViewModel }) => React.ReactElement;

/** Build the <ReportPdf vm/> component from the dynamically imported @react-pdf/renderer module. */
export function createReportPdf(rp: typeof ReactPdf): ReportPdfComponent {
  const { Document, Page, StyleSheet, Text, View } = rp;

  const s = StyleSheet.create({
    page: {
      fontFamily: PDF_FONT_FAMILY,
      fontSize: 9.5,
      lineHeight: 1.45,
      color: C.text,
      paddingTop: 92,
      paddingBottom: 66,
      paddingHorizontal: 50,
    },
    header: {
      position: "absolute",
      top: 30,
      left: 50,
      right: 50,
      borderBottomWidth: 1.5,
      borderBottomColor: C.primary,
      paddingBottom: 6,
    },
    headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
    clinicName: { fontSize: 13, fontWeight: 700, color: C.primary, lineHeight: 1.2 },
    clinicSmall: { fontSize: 7.5, color: C.muted, lineHeight: 1.3 },
    headerRight: { alignItems: "flex-end" },
    draftTag: { fontSize: 8, fontWeight: 700, color: C.draft, lineHeight: 1.3 },
    footer: {
      position: "absolute",
      bottom: 26,
      left: 50,
      right: 50,
      borderTopWidth: 0.5,
      borderTopColor: C.rule,
      paddingTop: 5,
    },
    footerRow: { flexDirection: "row", justifyContent: "space-between" },
    footerText: { fontSize: 7, color: C.muted, lineHeight: 1.35 },
    watermark: {
      position: "absolute",
      top: 360,
      left: 0,
      right: 0,
      textAlign: "center",
      fontSize: 58,
      fontWeight: 700,
      color: C.draft,
      opacity: 0.08,
      transform: "rotate(-32deg)",
    },
    title: { fontSize: 20, fontWeight: 700, color: C.primary, lineHeight: 1.2, marginBottom: 3 },
    subtitle: { fontSize: 9.5, color: C.muted, marginBottom: 14 },
    banner: { backgroundColor: C.draftTint, borderLeftWidth: 3, borderLeftColor: C.draft, padding: 7, marginBottom: 12 },
    bannerText: { color: C.draft, fontSize: 8.5 },
    table: { borderTopWidth: 1.2, borderTopColor: C.primary, marginBottom: 6 },
    kvRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: C.ruleTeal },
    kvLabel: { width: "32%", backgroundColor: C.tint, paddingVertical: 4, paddingHorizontal: 7, fontWeight: 700, color: C.primary, fontSize: 8.8 },
    kvValue: { width: "68%", paddingVertical: 4, paddingHorizontal: 7 },
    intro: { fontSize: 8.5, color: C.muted, marginTop: 8, marginBottom: 4 },
    h1: {
      fontSize: 12,
      fontWeight: 700,
      color: C.primary,
      marginTop: 16,
      marginBottom: 6,
      paddingBottom: 2,
      borderBottomWidth: 0.5,
      borderBottomColor: C.ruleTeal,
    },
    para: { marginBottom: 6 },
    placeholder: { marginBottom: 6, color: C.draft },
    th: { flexDirection: "row", backgroundColor: C.primary },
    thCell: { color: "#FFFFFF", fontWeight: 700, fontSize: 8, paddingVertical: 4, paddingHorizontal: 5 },
    tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: C.ruleTeal },
    trMissed: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: C.ruleTeal, backgroundColor: C.draftTint },
    td: { fontSize: 8.3, paddingVertical: 3.5, paddingHorizontal: 5, lineHeight: 1.35 },
    note: { fontSize: 7.8, color: C.muted, marginTop: 3, marginBottom: 8 },
    chartBlock: { marginTop: 4, marginBottom: 10, padding: 8, borderWidth: 0.5, borderColor: C.ruleTeal, backgroundColor: "#FBFEFE" },
    chartTitle: { fontSize: 8.3, fontWeight: 700, color: C.primary, marginBottom: 4 },
    chartRow: { flexDirection: "row", alignItems: "center", marginBottom: 2.5 },
    chartDate: { width: 58, fontSize: 7.5, color: C.muted },
    chartTrack: { flexGrow: 1, height: 7, backgroundColor: "#E6F4F2", marginRight: 6 },
    chartValue: { width: 34, fontSize: 7.8, textAlign: "right" },
    sigBox: { borderWidth: 1.5, borderColor: C.primary, padding: 12, marginTop: 4 },
    sigName: { fontSize: 15, fontWeight: 700, color: C.primary, lineHeight: 1.25 },
    small: { fontSize: 8.2 },
    smallMuted: { fontSize: 8.2, color: C.muted },
    hash: { fontSize: 6.6, color: C.muted, marginTop: 1 },
    fingerprint: { fontSize: 11, fontWeight: 700, color: C.primary },
    draftBox: { borderWidth: 1.5, borderColor: C.draft, padding: 12, marginTop: 14 },
    draftTitle: { fontSize: 11, fontWeight: 700, color: C.draft, marginBottom: 3 },
    check: { color: C.accent, fontWeight: 700 },
  });

  function Header({ vm }: { vm: ReportViewModel }) {
    return (
      <View style={s.header} fixed>
        <View style={s.headerRow}>
          <View>
            <Text style={s.clinicName}>{vm.clinic.name}</Text>
            <Text style={s.clinicSmall}>
              {[vm.clinic.addressText, vm.clinic.phone, vm.clinic.email].filter(Boolean).join("  ·  ")}
            </Text>
          </View>
          <View style={s.headerRight}>
            {vm.isDraft ? <Text style={s.draftTag}>{vm.draftLabel}</Text> : null}
            <Text style={s.clinicSmall}>Private and confidential</Text>
          </View>
        </View>
      </View>
    );
  }

  function Footer({ vm }: { vm: ReportViewModel }) {
    return (
      <View style={s.footer} fixed>
        <View style={s.footerRow}>
          <Text style={s.footerText}>{vm.footer.left}</Text>
          <Text style={s.footerText} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
        <Text style={[s.footerText, vm.isDraft ? { color: C.draft } : {}]}>{vm.footer.right}</Text>
      </View>
    );
  }

  function DetailsTable({ vm }: { vm: ReportViewModel }) {
    const employer = vm.instructingParty.type === "employer";
    const rows: [string, string][] = [
      [employer ? "Employee" : "Claimant", vm.patient.fullName],
      ["Date of birth", vm.patient.age ? `${vm.patient.dob} (aged ${vm.patient.age})` : vm.patient.dob],
      [employer ? "Job role" : "Occupation", vm.patient.occupation],
      [employer ? "Employer" : "Instructing party", vm.instructingParty.name],
      [employer ? "Employer reference" : "Your reference", vm.instructingParty.reference || "Not provided"],
      [employer ? "Date of injury" : "Date of incident", vm.incident.present ? vm.incident.date : "Not recorded"],
      ["Treatment period", `${vm.episode.firstAppointment} to ${vm.episode.lastAppointment} (${vm.episode.statusLabel})`],
      ["Treating clinicians", vm.episode.clinicianNames],
      ["Date of report", vm.report.date],
    ];
    return (
      <View style={s.table}>
        {rows.map(([label, value]) => (
          <View key={label} style={s.kvRow} wrap={false}>
            <Text style={s.kvLabel}>{label}</Text>
            <Text style={[s.kvValue, label === "Claimant" || label === "Employee" ? { fontWeight: 700 } : {}]}>{value}</Text>
          </View>
        ))}
      </View>
    );
  }

  function DataTable<T>({ columns, rows, highlight }: { columns: Column<T>[]; rows: T[]; highlight?: (row: T) => boolean }) {
    return (
      <View style={{ marginBottom: 2 }}>
        <View style={s.th} fixed={false} wrap={false}>
          {columns.map((c) => (
            <Text key={c.label} style={[s.thCell, { width: c.width, textAlign: c.align ?? "left" }]}>
              {c.label}
            </Text>
          ))}
        </View>
        {rows.map((row, i) => (
          <View key={i} style={highlight?.(row) ? s.trMissed : s.tr} wrap={false}>
            {columns.map((c) => (
              <Text
                key={c.label}
                style={[s.td, { width: c.width, textAlign: c.align ?? "left" }, c.bold?.(row) ? { fontWeight: 700 } : {}]}
              >
                {c.get(row)}
              </Text>
            ))}
          </View>
        ))}
      </View>
    );
  }

  const ATTENDANCE_COLUMNS: Column<AttendanceRow>[] = [
    { label: "Date", width: "15%", get: (r) => r.date },
    { label: "Time", width: "9%", get: (r) => r.time },
    { label: "Status", width: "20%", get: (r) => r.statusLabel, bold: (r) => r.missed },
    { label: "Clinician", width: "17%", get: (r) => r.clinician },
    { label: "Reason recorded", width: "39%", get: (r) => r.reason },
  ];

  const OUTCOME_COLUMNS: Column<OutcomeRow>[] = [
    { label: "Measure", width: "30%", get: (r) => r.label, bold: () => true },
    { label: "First", width: "17%", get: (r) => `${r.first} (${r.firstDate})` },
    { label: "Latest", width: "17%", get: (r) => `${r.latest} (${r.latestDate})` },
    { label: "Change", width: "12%", get: (r) => r.change || "–" },
    { label: "Scores over time", width: "24%", get: (r) => r.seriesText },
  ];

  const RECORDS_COLUMNS: Column<RecordsReviewedRow>[] = [
    { label: "Date", width: "14%", get: (r) => r.date || "–" },
    { label: "Record", width: "42%", get: (r) => r.description },
    { label: "Author", width: "32%", get: (r) => r.author },
    { label: "Relied on", width: "12%", get: (r) => r.citedMark, align: "center", bold: () => true },
  ];

  function OutcomeChart({ row }: { row: OutcomeRow }) {
    const max = scaleMax(row);
    return (
      <View style={s.chartBlock} wrap={false}>
        <Text style={s.chartTitle}>
          {row.label} – {row.scaleNote}
        </Text>
        {row.points.map((p) => {
          const value = parseFloat(p.value) || 0;
          const pct = Math.max(1.5, Math.min(100, (value / max) * 100));
          return (
            <View key={p.date} style={s.chartRow}>
              <Text style={s.chartDate}>{p.date}</Text>
              <View style={s.chartTrack}>
                <View style={{ width: `${pct}%`, height: 7, backgroundColor: C.bar }} />
              </View>
              <Text style={s.chartValue}>{p.value}</Text>
            </View>
          );
        })}
      </View>
    );
  }

  function Section({ vm, section }: { vm: ReportViewModel; section: ReportViewSection }) {
    return (
      <View>
        <Text style={s.h1} minPresenceAhead={60}>
          {section.heading}
        </Text>
        {section.paragraphs.map((p, i) => (
          <Text key={i} style={section.isPlaceholder ? s.placeholder : s.para}>
            {p.text}
          </Text>
        ))}
        {section.showAttendance && vm.hasAttendance ? (
          <View>
            <DataTable columns={ATTENDANCE_COLUMNS} rows={vm.attendance} highlight={(r) => r.missed} />
            <Text style={s.note}>{vm.attendanceSummary}</Text>
          </View>
        ) : null}
        {section.showOutcomes && vm.hasOutcomes ? (
          <View>
            <DataTable columns={OUTCOME_COLUMNS} rows={vm.outcomes} />
            <Text style={s.note}>Scores as recorded in the clinical notes. {vm.outcomes.map((o) => `${o.instrument}: ${o.scaleNote}`).join(" ")}</Text>
            {vm.outcomes.map((o) => (
              <OutcomeChart key={o.instrument} row={o} />
            ))}
          </View>
        ) : null}
        {section.showRecordsReviewed ? <Text style={[s.para, { color: C.muted }]}>The full list of records reviewed is in Appendix A.</Text> : null}
      </View>
    );
  }

  function Signature({ vm }: { vm: ReportViewModel }) {
    if (!vm.signed) {
      return (
        <View style={s.draftBox} wrap={false}>
          <Text style={s.draftTitle}>{vm.draftLabel}</Text>
          <Text style={s.small}>
            This report has not been reviewed and signed by the treating physiotherapist. It must not be disclosed or relied on. The
            signature, HCPC number and document fingerprint appear here once it is signed.
          </Text>
        </View>
      );
    }
    const sig = vm.signature;
    return (
      <View wrap={false}>
        <Text style={s.h1}>Signature</Text>
        <View style={s.sigBox}>
          <Text style={s.smallMuted}>Signed electronically by</Text>
          <Text style={s.sigName}>{sig.name}</Text>
          {sig.role ? <Text>{sig.role}</Text> : null}
          <Text>
            <Text style={{ color: C.muted }}>HCPC registration number: </Text>
            <Text style={{ fontWeight: 700 }}>{sig.hcpc}</Text>
          </Text>
          <Text style={{ marginBottom: 6 }}>
            <Text style={{ color: C.muted }}>Date and time signed: </Text>
            {sig.signedAt} (UK time)
          </Text>
          <Text style={[s.small, { marginBottom: 5 }]}>{sig.statement}</Text>
          <Text style={[s.smallMuted, { marginBottom: 2 }]}>The signer confirmed that:</Text>
          {sig.attestations.map((a, i) => (
            <View key={i} style={{ flexDirection: "row", marginBottom: 2 }}>
              <Text style={[s.small, s.check, { width: 12 }]}>✓</Text>
              <Text style={[s.small, { flex: 1 }]}>{a.text}</Text>
            </View>
          ))}
          <View style={{ borderTopWidth: 0.5, borderTopColor: C.ruleTeal, marginTop: 7, paddingTop: 6 }}>
            <Text>
              <Text style={s.smallMuted}>Document fingerprint  </Text>
              <Text style={s.fingerprint}>{sig.hashShort}</Text>
            </Text>
            <Text style={s.hash}>SHA-256 {sig.hash}</Text>
            <Text style={[s.hash, { marginTop: 3 }]}>
              The fingerprint is a SHA-256 hash of the signed report content, sealed by a server-issued sign-off receipt. Any later change
              to the content produces a different fingerprint.
            </Text>
          </View>
        </View>
      </View>
    );
  }

  function ReportPdf({ vm }: { vm: ReportViewModel }) {
    const employer = vm.instructingParty.type === "employer";
    const subtitle = employer
      ? "Prepared for the employer with the employee's consent  ·  Fitness for work only"
      : "Factual report from the clinical record";
    return (
      <Document
        title={`${vm.report.title} – ${vm.patient.fullName}${vm.isDraft ? " (DRAFT)" : ""}`}
        author={vm.signed ? vm.signature.name : vm.clinic.name}
        subject={vm.report.templateName}
        creator={`${vm.product.name} ${vm.product.version}`}
        producer={vm.product.name}
        language="en-GB"
      >
        <Page size="A4" style={s.page} wrap>
          {vm.isDraft ? (
            <Text style={s.watermark} fixed>
              {vm.draftLabel}
            </Text>
          ) : null}
          <Header vm={vm} />
          <Footer vm={vm} />

          <Text style={s.title}>{vm.report.title}</Text>
          <Text style={s.subtitle}>{subtitle}</Text>
          {vm.reviewCopy ? (
            <View style={s.banner}>
              <Text style={s.bannerText}>
                Internal review copy. Dates in square brackets after each paragraph show the source records it relies on. Remove before
                disclosure: download a standard copy instead.
              </Text>
            </View>
          ) : null}
          <DetailsTable vm={vm} />
          <Text style={s.intro}>
            {employer
              ? "This report covers fitness for work only. In line with the employee's consent, it does not disclose unrelated health information. Statements are attributed to the employee (as reported) or to the clinician who recorded them."
              : "This is a factual report by the treating physiotherapist, prepared from the clinic's records of the episode of care. Statements are attributed to the patient (as reported) or to the clinician who recorded them."}
          </Text>

          {vm.sections.map((section) => (
            <Section key={section.key} vm={vm} section={section} />
          ))}

          {vm.hasDeclaration ? (
            <View>
              <Text style={s.h1} minPresenceAhead={60}>
                {vm.declarationHeading}
              </Text>
              {vm.declarationParagraphs.map((p, i) => (
                <Text key={i} style={s.para}>
                  {p.text}
                </Text>
              ))}
            </View>
          ) : null}

          <Signature vm={vm} />

          <View break>
            <Text style={[s.h1, { marginTop: 0 }]}>Appendix A – Records reviewed</Text>
            <Text style={s.para}>
              Every record held for this episode of care was reviewed in preparing this report. Records relied on in the report are marked ✓.
              Notes are listed by date with their author.
            </Text>
            <DataTable columns={RECORDS_COLUMNS} rows={vm.recordsReviewed} />
            <Text style={s.note}>
              <Text style={{ fontWeight: 700 }}>Source of records: </Text>
              {vm.provenance}
            </Text>
          </View>
        </Page>
      </Document>
    );
  }

  return ReportPdf;
}
