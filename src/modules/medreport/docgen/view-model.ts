import "server-only";

/**
 * ReportViewModel: the single data shape both the Word (.docx via docxtemplater) and PDF (@react-pdf)
 * renderers consume. Every field is present with an explicit value – strings may be "" and arrays may
 * be empty, but nothing is undefined – so docxtemplater's nullGetter never fires for supported tags
 * and `{#signed}` / `{#isDraft}` can never render by accident.
 *
 * Supported docx tags include: {patient.fullName} {instructingParty.name} {instructingParty.reference}
 * {#isDraft}DRAFT – NOT SIGNED{/isDraft} {#sections}{title}{#paragraphs}{text}{/paragraphs}{/sections}
 * {#attendance}…{/attendance} {#outcomes}…{/outcomes} {#recordsReviewed}…{/recordsReviewed}
 * {#signed}…{signature.name}{signature.hcpc}{signature.hashShort}{/signed}
 *
 * The full tag list for clinics is templates/tag-reference.ts.
 *
 * Note IDs (N-001…), fact IDs and "REG" are never printed. A review copy appends "[DD/MM/YYYY]" source
 * markers after each paragraph instead.
 *
 * Owner: forms-engine agent (formerly docgen). The TYPE is part of the contract (additive fields only).
 */
import { DEMO_CLINIC, PRODUCT } from "../config.public";
import { ageOn, compareIsoDateTime, formatUkDate, formatUkDateTime, todayIso } from "../core/dates";
import { shortFingerprint } from "../core/fingerprint";
import {
  APPOINTMENT_STATUS_LABELS,
  INCIDENT_TYPE_LABELS,
  INSTRUCTING_PARTY_LABELS,
  INSTRUMENT_LABELS,
  NOTE_TYPE_LABELS,
} from "../core/labels";
import type {
  EpisodeBundle,
  OutcomeMeasureSeries,
  Paragraph,
  Report,
  ReportSection,
  ReportTemplate,
  SectionKind,
  SignReceipt,
} from "../core/types";

export interface ViewParagraph {
  text: string;
}

export interface ReportViewSection {
  key: string;
  /** Section number as printed, e.g. "4" (additive). */
  number: string;
  /** Numbered heading, e.g. "4. History of the incident (as reported)" (additive). */
  heading: string;
  title: string;
  kind: SectionKind;
  /** True when a clinician_opinion section still holds only a placeholder (never true on a final copy). */
  isPlaceholder: boolean;
  paragraphs: ViewParagraph[];
  /** Render the attendance / outcomes / records-reviewed table inside this section (template `blocks`). */
  showAttendance: boolean;
  showOutcomes: boolean;
  showRecordsReviewed: boolean;
}

export interface AttendanceRow {
  /** DD/MM/YYYY */
  date: string;
  /** HH:mm */
  time: string;
  /** ATT | DNA | LCN | CNC | BOOKED */
  status: string;
  statusLabel: string;
  /** Recorded reason, or "" (or "No reason recorded" for DNA). */
  reason: string;
  clinician: string;
  /** True for DNA / LCN rows (highlighted in the PDF) (additive). */
  missed: boolean;
}

export interface OutcomeRow {
  instrument: string;
  /** e.g. "Neck Disability Index (NDI)" */
  label: string;
  unit: string;
  /** First and latest values with unit, e.g. "42%" / "12%". */
  first: string;
  latest: string;
  firstDate: string;
  latestDate: string;
  /** Signed change with unit, e.g. "−30%"; "" for a single time point. */
  change: string;
  direction: "improved" | "worsened" | "unchanged" | "single";
  /** e.g. "42% → 24% → 12%" (arrows need the Unicode font in PDF). */
  seriesText: string;
  /** e.g. "Lower scores are better." */
  scaleNote: string;
  points: { date: string; value: string }[];
}

export interface RecordsReviewedRow {
  /** DD/MM/YYYY */
  date: string;
  /** e.g. "Clinical note – Initial assessment", "Appointment history", "Outcome measures (NDI)". */
  description: string;
  /** "S. Reid (HCPC PH-DEMO-01)" or "" for system records. */
  author: string;
  /** Whether the report cites this record. */
  cited: boolean;
  /** "✓" when cited, else "". */
  citedMark: string;
  /** "[DD/MM/YYYY]" marker for review copies, else "". Note IDs are never printed. */
  reviewMarker: string;
}

export interface SignatureBlock {
  /** All fields are "" while unsigned (the block is hidden by {#signed}). */
  name: string;
  /** Signer's role, e.g. "Senior Physiotherapist, MCSP" (additive). */
  role: string;
  hcpc: string;
  /** DD/MM/YYYY HH:mm (Europe/London) */
  signedAt: string;
  signedAtIso: string;
  statement: string;
  /** Full content SHA-256 (hex). */
  hash: string;
  /** e.g. "3F9C 2A7B 1D4E" */
  hashShort: string;
  attestations: ViewParagraph[];
}

export interface ReportViewModel {
  isDraft: boolean;
  signed: boolean;
  /** "DRAFT – NOT SIGNED" when isDraft, else "". */
  draftLabel: string;
  reviewCopy: boolean;
  product: { name: string; version: string };
  clinic: { name: string; addressLines: string[]; addressText: string; phone: string; email: string };
  report: {
    id: string;
    title: string;
    templateId: string;
    templateName: string;
    templateVersion: string;
    /** Report date DD/MM/YYYY (signing date when signed, else today). */
    date: string;
    dateIso: string;
  };
  patient: {
    fullName: string;
    firstName: string;
    lastName: string;
    dob: string;
    age: string;
    sex: string;
    occupation: string;
    employer: string;
    addressSummary: string;
  };
  instructingParty: {
    type: string;
    typeLabel: string;
    name: string;
    reference: string;
    contactName: string;
    address: string;
    hasReference: boolean;
  };
  incident: { present: boolean; date: string; mechanism: string; typeLabel: string };
  episode: {
    title: string;
    status: string;
    statusLabel: string;
    firstAppointment: string;
    lastAppointment: string;
    noteCount: number;
    clinicianNames: string;
  };
  clinicians: { name: string; hcpc: string }[];
  sections: ReportViewSection[];
  hasAttendance: boolean;
  attendance: AttendanceRow[];
  /** e.g. "10 of 11 appointments attended; 1 did not attend (15/04/2026, no reason recorded)." */
  attendanceSummary: string;
  hasOutcomes: boolean;
  outcomes: OutcomeRow[];
  recordsReviewed: RecordsReviewedRow[];
  hasDeclaration: boolean;
  /** Numbered heading of the declaration, e.g. "12. Declaration and statement of truth" (additive). */
  declarationHeading: string;
  declarationParagraphs: ViewParagraph[];
  signature: SignatureBlock;
  footer: {
    /** e.g. "Riverside Physiotherapy (fictional) · Treating Physiotherapist Report" */
    left: string;
    /** "DRAFT – NOT SIGNED" or "Fingerprint 3F9C 2A7B 1D4E" */
    right: string;
  };
  /** Where the records came from, e.g. "Simulated TM3 sandbox – demo data, not affiliated with TM3 · fetched …" (additive). */
  provenance: string;
  /** Suggested download name, e.g. "Hart_M_Treating-Physio-Report_2026-10-06_SIGNED" (no extension). */
  fileBaseName: string;
}

export interface BuildViewModelOptions {
  /** Pass ONLY a receipt that verifyReceipt() accepted for this report; its presence makes the copy final. */
  receipt?: SignReceipt;
  reviewCopy?: boolean;
  now?: Date;
}


/* ------------------------------------------------------------------------------------------------
 * Implementation
 * ----------------------------------------------------------------------------------------------*/

/** Shown in a section that has no content yet (drafts only: signing is blocked while it is empty). */
export const SECTION_PLACEHOLDER_TEXT = "[To be completed by the treating physiotherapist before signing.]";

export const DRAFT_LABEL = "DRAFT – NOT SIGNED";

/** Label that must accompany anything from the simulated clinic system. */
export const SIMULATED_SOURCE_LABEL = "Simulated TM3 sandbox – demo data, not affiliated with TM3";

/** File-name slug per built-in report type (fallback: slug of the document title). */
const REPORT_TYPE_SLUGS: Record<string, string> = {
  "solicitor-rta-treating-physio": "Treating-Physio-Report",
  "employer-fitness-for-work": "Fitness-for-Work-Report",
};

const SEX_LABELS: Record<string, string> = {
  female: "Female",
  male: "Male",
  other: "Other",
  not_recorded: "Not recorded",
};

/**
 * Citation references a drafted paragraph may carry inline, e.g. "(N-003)", "[N-001, N-004]",
 * "(FACT-attendance)". Removed from printed text: the document never shows internal IDs.
 */
const INLINE_ID_REF = /\s*[([](?:\s*(?:N-\d{3,}|FACT-[A-Za-z0-9-]+|REG)\s*[,;]?)+\s*[)\]]/g;

/** Remove inline source-ID references and tidy the spacing they leave behind. */
export function stripSourceIds(text: string): string {
  return text
    .replace(INLINE_ID_REF, "")
    .replace(/[ \t]+([.,;:])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function asciiSlug(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** e.g. ("Megan", "Hart", solicitor template, "2026-10-06", signed) → "Hart_M_Treating-Physio-Report_2026-10-06_SIGNED". */
export function buildFileBaseName(input: {
  firstName: string;
  lastName: string;
  template: Pick<ReportTemplate, "id" | "documentTitle">;
  dateIso: string;
  signed: boolean;
  reviewCopy?: boolean;
}): string {
  const last = asciiSlug(input.lastName) || "Patient";
  const initial = (asciiSlug(input.firstName).charAt(0) || "X").toUpperCase();
  const type = REPORT_TYPE_SLUGS[input.template.id] ?? (asciiSlug(input.template.documentTitle) || "Report");
  const parts = [last, initial, type, input.dateIso, input.signed ? "SIGNED" : "DRAFT"];
  if (input.reviewCopy) parts.push("REVIEW-COPY");
  return parts.join("_");
}

function formatScore(value: number, unit: string): string {
  const v = Number.isInteger(value) ? String(value) : value.toFixed(1);
  if (!unit) return v;
  return unit === "%" ? `${v}%` : unit.startsWith("/") ? `${v}${unit}` : `${v} ${unit}`;
}

function formatChange(delta: number, unit: string): string {
  if (delta === 0) return "No change";
  const abs = Number.isInteger(delta) ? String(Math.abs(delta)) : Math.abs(delta).toFixed(1);
  const sign = delta < 0 ? "−" : "+";
  return unit === "%" ? `${sign}${abs} points` : `${sign}${abs}`;
}

function sortedPoints(series: OutcomeMeasureSeries) {
  return series.points.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

function outcomeRows(bundle: EpisodeBundle): OutcomeRow[] {
  return bundle.outcomeMeasures
    .filter((s) => s.points.length > 0)
    .map((series) => {
      const pts = sortedPoints(series);
      const first = pts[0];
      const latest = pts[pts.length - 1];
      const single = pts.length === 1;
      const delta = latest.value - first.value;
      const direction: OutcomeRow["direction"] = single
        ? "single"
        : delta === 0
          ? "unchanged"
          : delta < 0 === series.higherIsWorse
            ? "improved"
            : "worsened";
      return {
        instrument: series.instrument,
        label: INSTRUMENT_LABELS[series.instrument] ?? series.instrument,
        unit: series.unit,
        first: formatScore(first.value, series.unit),
        latest: formatScore(latest.value, series.unit),
        firstDate: formatUkDate(first.date),
        latestDate: formatUkDate(latest.date),
        change: single ? "" : formatChange(delta, series.unit),
        direction,
        seriesText: pts.map((p) => formatScore(p.value, series.unit)).join(" → "),
        scaleNote: series.higherIsWorse ? "Lower scores are better." : "Higher scores are better.",
        points: pts.map((p) => ({ date: formatUkDate(p.date), value: formatScore(p.value, series.unit) })),
      };
    });
}

function attendanceRows(bundle: EpisodeBundle): AttendanceRow[] {
  return bundle.appointments
    .slice()
    .sort(compareIsoDateTime)
    .map((a) => ({
      date: formatUkDate(a.date),
      time: a.time,
      status: a.status,
      statusLabel: APPOINTMENT_STATUS_LABELS[a.status] ?? a.status,
      reason: a.reason?.trim() ? a.reason.trim() : a.status === "DNA" ? "No reason recorded" : "",
      clinician: a.clinician?.name ?? "",
      missed: a.status === "DNA" || a.status === "LCN",
    }));
}

function lowerFirst(text: string): string {
  return text ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

function attendanceSummaryText(rows: AttendanceRow[]): string {
  if (rows.length === 0) return "No appointments are recorded for this episode.";
  const att = rows.filter((r) => r.status === "ATT").length;
  const counted = rows.filter((r) => r.status === "ATT" || r.status === "DNA" || r.status === "LCN").length;
  const parts = [`${att} of ${counted} appointment${counted === 1 ? "" : "s"} attended`];
  const dna = rows.filter((r) => r.status === "DNA");
  const lcn = rows.filter((r) => r.status === "LCN");
  const cnc = rows.filter((r) => r.status === "CNC").length;
  const booked = rows.filter((r) => r.status === "BOOKED").length;
  const describe = (list: AttendanceRow[]) =>
    list.map((r) => `${r.date}, ${r.reason ? lowerFirst(r.reason) : "no reason recorded"}`).join("; ");
  if (dna.length) parts.push(`${dna.length} did not attend (${describe(dna)})`);
  if (lcn.length) parts.push(`${lcn.length} late cancellation${lcn.length === 1 ? "" : "s"} (${describe(lcn)})`);
  if (cnc) parts.push(`${cnc} cancelled with notice`);
  if (booked) parts.push(`${booked} booked for a later date`);
  return `${parts.join("; ")}.`;
}

/** Every citable ID cited anywhere in the report's paragraphs. */
function citedIds(report: Report): Set<string> {
  const ids = new Set<string>();
  for (const section of report.sections) {
    for (const p of section.paragraphs) for (const id of p.sourceIds) ids.add(id);
  }
  return ids;
}

type BlockName = "attendance" | "outcomes" | "records_reviewed";

function hasBlock(template: ReportTemplate, sectionKey: string, block: BlockName): boolean {
  const spec = template.sections.find((s) => s.key === sectionKey);
  return Boolean(spec?.blocks?.includes(block));
}

function provenanceText(bundle: EpisodeBundle): string {
  const fetched = formatUkDateTime(bundle.source.fetchedAt);
  let source: string;
  if (bundle.source.connectorId === "file-import") {
    source = `Uploaded clinic-system export${bundle.source.label ? ` (${bundle.source.label})` : ""}`;
  } else if (bundle.source.connectorId === "tm3-sim" || bundle.source.simulated) {
    source = SIMULATED_SOURCE_LABEL;
  } else {
    source = bundle.source.label ?? "Clinic system";
  }
  return fetched ? `${source} · records retrieved ${fetched}` : source;
}

/** "[18/03/2026; appointment history]" – review copies only. */
function reviewMarker(paragraph: Paragraph, noteDates: Map<string, string>): string {
  const labels: string[] = [];
  const push = (label: string) => {
    if (label && labels.indexOf(label) < 0) labels.push(label);
  };
  for (const id of paragraph.sourceIds) {
    const date = noteDates.get(id);
    if (date) push(date);
    else if (id === "REG" || id === "FACT-age") push("registration");
    else if (id === "FACT-attendance") push("appointment history");
    else if (id === "FACT-episode") push("episode summary");
    else if (id.startsWith("FACT-outcomes-")) push(`${id.slice("FACT-outcomes-".length)} scores`);
  }
  return labels.length ? `[${labels.join("; ")}]` : "";
}

function viewParagraphs(section: ReportSection, noteDates: Map<string, string>, reviewCopy: boolean): ViewParagraph[] {
  const out: ViewParagraph[] = [];
  for (const p of section.paragraphs) {
    const text = stripSourceIds(p.text);
    if (!text) continue;
    const marker = reviewCopy ? reviewMarker(p, noteDates) : "";
    out.push({ text: marker ? `${text} ${marker}` : text });
  }
  return out;
}

function recordsReviewedRows(
  report: Report,
  bundle: EpisodeBundle,
  template: ReportTemplate,
  reviewCopy: boolean,
): RecordsReviewedRow[] {
  const cited = citedIds(report);
  const keys = report.sections.map((s) => s.key);
  const showsBlock = (block: BlockName) => keys.some((k) => hasBlock(template, k, block));
  const row = (date: string, description: string, author: string, isCited: boolean): RecordsReviewedRow => ({
    date,
    description,
    author,
    cited: isCited,
    citedMark: isCited ? "✓" : "",
    reviewMarker: reviewCopy && date ? `[${date}]` : "",
  });

  const rows: RecordsReviewedRow[] = bundle.notes
    .slice()
    .sort(compareIsoDateTime)
    .map((n) =>
      row(
        formatUkDate(n.date),
        `Clinical note – ${NOTE_TYPE_LABELS[n.type] ?? n.type}`,
        `${n.author.name} (HCPC ${n.author.hcpc})`,
        cited.has(n.id),
      ),
    );

  const appts = bundle.appointments.slice().sort(compareIsoDateTime);
  if (appts.length) {
    const first = formatUkDate(appts[0].date);
    const last = formatUkDate(appts[appts.length - 1].date);
    rows.push(
      row(
        first,
        `Appointment history (${appts.length} appointment${appts.length === 1 ? "" : "s"}, ${first} to ${last})`,
        "Clinic system record",
        cited.has("FACT-attendance") || cited.has("FACT-episode") || showsBlock("attendance"),
      ),
    );
  }
  for (const series of bundle.outcomeMeasures) {
    const pts = sortedPoints(series);
    if (!pts.length) continue;
    rows.push(
      row(
        formatUkDate(pts[0].date),
        `Outcome measure – ${INSTRUMENT_LABELS[series.instrument] ?? series.instrument} (${pts.length} score${pts.length === 1 ? "" : "s"})`,
        "Recorded in clinical notes",
        cited.has(`FACT-outcomes-${series.instrument}`) || showsBlock("outcomes"),
      ),
    );
  }
  rows.push(row("", "Patient registration details", "Clinic system record", cited.has("REG") || cited.has("FACT-age")));
  return rows;
}

function signatureStatement(template: ReportTemplate, hasDeclaration: boolean): string {
  if (!hasDeclaration) return "I confirm that this report is accurate and complete to the best of my knowledge and belief.";
  const what = template.audience === "solicitor" ? "declaration and statement of truth" : "declaration";
  return `I confirm that I have read and accept the ${what} above, and that this report is accurate and complete to the best of my knowledge and belief.`;
}

/**
 * Build the view model. `bundle` is normally `report.bundleSnapshot`. `signed`/`isDraft` derive solely
 * from `opts.receipt`: pass ONLY a receipt that verifyReceipt() accepted for this report.
 */
export function buildViewModel(
  report: Report,
  bundle: EpisodeBundle,
  template: ReportTemplate,
  opts: BuildViewModelOptions = {},
): ReportViewModel {
  const receipt = opts.receipt;
  const signed = Boolean(receipt);
  const isDraft = !signed;
  const reviewCopy = Boolean(opts.reviewCopy);
  const now = opts.now ?? new Date();
  const dateIso = receipt ? todayIso(new Date(receipt.signedAt)) : todayIso(now);
  const reg = bundle.registration;
  const party = report.instructingParty;
  const noteDates = new Map(bundle.notes.map((n) => [n.id, formatUkDate(n.date)]));

  // Body sections in report order; the declaration is rendered separately, just before the signature.
  const bodySections = report.sections.filter((s) => s.kind !== "declaration");
  const sections: ReportViewSection[] = bodySections.map((section, i) => {
    const paragraphs = viewParagraphs(section, noteDates, reviewCopy);
    const number = String(i + 1);
    return {
      key: section.key,
      number,
      heading: `${number}. ${section.title}`,
      title: section.title,
      kind: section.kind,
      isPlaceholder: paragraphs.length === 0,
      paragraphs: paragraphs.length ? paragraphs : [{ text: SECTION_PLACEHOLDER_TEXT }],
      showAttendance: hasBlock(template, section.key, "attendance"),
      showOutcomes: hasBlock(template, section.key, "outcomes"),
      showRecordsReviewed: hasBlock(template, section.key, "records_reviewed"),
    };
  });

  const declaration = report.sections.find((s) => s.kind === "declaration");
  const declarationParagraphs: ViewParagraph[] = [];
  for (const p of declaration?.paragraphs ?? []) {
    for (const part of p.text.split(/\n\s*\n/)) {
      const text = part.trim();
      if (text) declarationParagraphs.push({ text });
    }
  }
  const hasDeclaration = declarationParagraphs.length > 0;
  const declarationHeading = declaration ? `${sections.length + 1}. ${declaration.title}` : "";

  const attendance = attendanceRows(bundle);
  const outcomes = outcomeRows(bundle);

  const notes = bundle.notes.slice().sort(compareIsoDateTime);
  const attended = bundle.appointments.filter((a) => a.status === "ATT");
  const contactDates = attended
    .map((a) => a.date)
    .concat(notes.map((n) => n.date))
    .sort();
  const authors: { name: string; hcpc: string }[] = [];
  for (const n of notes) {
    if (!authors.some((a) => a.name === n.author.name && a.hcpc === n.author.hcpc)) {
      authors.push({ name: n.author.name, hcpc: n.author.hcpc });
    }
  }
  const clinicians = authors.length ? authors : bundle.clinicians.map((c) => ({ name: c.name, hcpc: c.hcpc }));

  const hash = receipt?.contentSha256 ?? "";
  const hashShort = hash ? shortFingerprint(hash) : "";
  const createdDate = report.createdAt.slice(0, 10);
  const age = reg.dob && reg.dob <= createdDate ? String(ageOn(reg.dob, createdDate)) : "";
  const discharged = bundle.episodeStatus === "discharged";

  return {
    isDraft,
    signed,
    draftLabel: isDraft ? DRAFT_LABEL : "",
    reviewCopy,
    product: { name: PRODUCT.name, version: PRODUCT.version },
    clinic: {
      name: DEMO_CLINIC.name,
      addressLines: Array.from(DEMO_CLINIC.addressLines),
      addressText: DEMO_CLINIC.addressLines.join(", "),
      phone: DEMO_CLINIC.phone,
      email: DEMO_CLINIC.email,
    },
    report: {
      id: report.id,
      title: template.documentTitle,
      templateId: template.id,
      templateName: template.name,
      templateVersion: report.templateVersion,
      date: formatUkDate(dateIso),
      dateIso,
    },
    patient: {
      fullName: reg.fullName,
      firstName: reg.firstName,
      lastName: reg.lastName,
      dob: formatUkDate(reg.dob),
      age,
      sex: SEX_LABELS[reg.sex] ?? "Not recorded",
      occupation: reg.occupation?.trim() || "Not recorded",
      employer: reg.employer?.trim() || "Not recorded",
      addressSummary: reg.addressSummary,
    },
    instructingParty: {
      type: party.type,
      typeLabel: INSTRUCTING_PARTY_LABELS[party.type] ?? party.type,
      name: party.name,
      reference: party.reference,
      contactName: party.contactName,
      address: party.address,
      hasReference: party.reference.trim() !== "",
    },
    incident: {
      present: Boolean(bundle.incident?.date),
      date: formatUkDate(bundle.incident?.date),
      mechanism: bundle.incident?.mechanism ?? "",
      typeLabel: bundle.incident ? (INCIDENT_TYPE_LABELS[bundle.incident.type] ?? "") : "",
    },
    episode: {
      title: bundle.episodeTitle ?? "",
      status: bundle.episodeStatus,
      statusLabel: discharged ? "discharged" : "ongoing",
      firstAppointment: formatUkDate(contactDates[0]) || "Not recorded",
      lastAppointment: discharged ? formatUkDate(contactDates[contactDates.length - 1]) || "Not recorded" : "date",
      noteCount: notes.length,
      clinicianNames: clinicians.map((c) => `${c.name} (HCPC ${c.hcpc})`).join(", ") || "Not recorded",
    },
    clinicians,
    sections,
    hasAttendance: attendance.length > 0,
    attendance,
    attendanceSummary: attendanceSummaryText(attendance),
    hasOutcomes: outcomes.length > 0,
    outcomes,
    recordsReviewed: recordsReviewedRows(report, bundle, template, reviewCopy),
    hasDeclaration,
    declarationHeading,
    declarationParagraphs,
    signature: {
      name: receipt?.signer.name ?? "",
      role: receipt?.signer.role ?? "",
      hcpc: receipt?.signer.hcpc ?? "",
      signedAt: receipt ? formatUkDateTime(receipt.signedAt) : "",
      signedAtIso: receipt?.signedAt ?? "",
      statement: receipt ? signatureStatement(template, hasDeclaration) : "",
      hash,
      hashShort,
      attestations: (receipt?.attestations ?? []).map((text) => ({ text })),
    },
    footer: {
      left: `${DEMO_CLINIC.name} · ${template.documentTitle} · ${reg.fullName}`,
      right: receipt
        ? `Signed by ${receipt.signer.name} (HCPC ${receipt.signer.hcpc}) on ${formatUkDate(dateIso)} · Fingerprint ${hashShort}`
        : `${DRAFT_LABEL} · not for disclosure`,
    },
    provenance: provenanceText(bundle),
    fileBaseName: buildFileBaseName({
      firstName: reg.firstName,
      lastName: reg.lastName,
      template,
      dateIso,
      signed,
      reviewCopy,
    }),
  };
}
