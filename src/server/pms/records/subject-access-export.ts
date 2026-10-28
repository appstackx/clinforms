/**
 * The subject-access copy of ONE patient's record (UK GDPR Article 15, K2-PAT-009 / K2-NFR-012): everything the
 * clinic system holds about the patient, as a PDF for the patient and as JSON (machine-readable, the same content).
 *
 * Built from collectSubjectAccess() (src/server/repos/pms/records/subject-access.ts – the shared record and the
 * records module) plus the record's history; other modules add their own sections (appointments, invoices,
 * messages, forms) through `extraSections` when they are wired in at integration. Nothing about any other patient
 * is read: every collection is by this patient's id within this clinic.
 *
 * PDF: A4, built-in Helvetica (pdf-lib, already a dependency), "Page x of y", the clinic's name, the demonstration
 * notice on every page for a demonstration clinic. Characters the built-in font cannot draw are replaced (the JSON
 * keeps the exact text).
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { formatPence, formatUkDate } from "../../../modules/pms/core/text";
import { PMS_AUDIT_LABELS } from "../../../modules/pms/audit";
import { describeMarker } from "../../../modules/pms/records/body-chart";
import { AMENDMENT_KIND_LABELS, noteStatusLabel, shortFingerprint } from "../../../modules/pms/records/notes";
import { MEASURES, formatScore } from "../../../modules/pms/records/outcomes";
import { NOTE_TYPE_LABELS } from "../../../modules/pms/records/templates";
import { CASE_STATUS_LABELS, PAYER_TYPE_LABELS } from "../../../modules/pms/records/copy";
import { formatBytes } from "../../../modules/pms/records/attachments";
import type { AuditEntry } from "../../repos/audit";
import type { SubjectAccessData } from "../../repos/pms/records/subject-access";

/** One line of the copy: "Label: text" or a paragraph. */
export interface ExportLine {
  label?: string;
  text: string;
}

export interface ExportEntry {
  heading?: string;
  lines: ExportLine[];
}

export interface ExportSection {
  /** Stable id ("patient", "cases", … or another module's id). */
  id: string;
  heading: string;
  entries: ExportEntry[];
  /** Shown when there are no entries. */
  empty?: string;
}

export interface ExportMeta {
  clinicName: string;
  generatedAt: string;
  demo: boolean;
}

const yesNo = (v: boolean) => (v ? "Yes" : "No");
const d = (iso: string | null | undefined) => (iso ? formatUkDate(iso.slice(0, 10)) : "");
const dt = (iso: string | null | undefined) => (iso ? `${formatUkDate(iso.slice(0, 10))} ${iso.slice(11, 16)} UTC` : "");

function line(label: string, value: string | number | null | undefined): ExportLine[] {
  if (value === null || value === undefined || value === "") return [];
  return [{ label, text: String(value) }];
}

function para(text: string | null | undefined, label?: string): ExportLine[] {
  if (!text) return [];
  return [{ label, text }];
}

/** The copy's content as sections (the PDF draws these; tests read them). */
export function subjectAccessSections(data: SubjectAccessData, history: readonly AuditEntry[], extraSections: readonly ExportSection[] = []): ExportSection[] {
  const p = data.patient;
  const n = data.names;
  const practitioner = (id: string | null) => (id ? (n.practitioners[id] ?? "") : "");
  const referrer = (id: string | null) => (id ? (n.referrers[id] ?? "") : "");
  const site = (id: string | null) => (id ? (n.sites[id] ?? "") : "");

  const patient: ExportSection = {
    id: "patient",
    heading: "Patient details",
    entries: [
      {
        lines: [
          ...line("Patient number", p.patientNumber),
          ...line("Name", [p.title, p.firstName, p.lastName].filter(Boolean).join(" ")),
          ...line("Preferred name", p.preferredName),
          ...line("Pronouns", data.pronouns),
          ...line("Date of birth", d(p.dateOfBirth)),
          ...line("Sex", p.sex),
          ...line("Status", p.status),
          ...line("Email", p.email),
          ...line("Mobile", p.phoneMobile),
          ...line("Home phone", p.phoneHome),
          ...line("Work phone", p.phoneWork),
          ...line("Address", (p.address ?? []).join(", ")),
          ...line("Postcode", p.postcode),
          ...line("Occupation", p.occupation),
          ...line("Employer", p.employer),
          ...line("Emergency contact", [p.emergencyName, p.emergencyRelationship, p.emergencyPhone].filter(Boolean).join(", ")),
          ...line("GP", [p.gpName, p.gpPractice, p.gpPhone, (p.gpAddress ?? []).join(", "), p.gpPostcode].filter(Boolean).join(", ")),
          { label: "Consent to treatment", text: p.consentTreatment ? `Yes${p.consentTreatmentAt ? ` (${d(p.consentTreatmentAt)})` : ""}` : "No" },
          { label: "Consent to share with the GP", text: yesNo(p.consentShareGp) },
          { label: "Appointment reminders", text: `Text: ${yesNo(p.reminderSms)}, email: ${yesNo(p.reminderEmail)}` },
          { label: "Marketing", text: `Email: ${yesNo(p.marketingEmail)}, text: ${yesNo(p.marketingSms)}${p.marketingConsentAt ? ` (recorded ${d(p.marketingConsentAt)})` : ""}` },
          ...para(p.alerts, "Alerts"),
          ...data.clinicalFlags.map((f) => ({ label: "Clinical flag", text: `${f.text ?? "(anonymised)"} – ${f.status === "ended" ? `ended ${d(f.endedAt)}` : `since ${d(f.createdAt)}`}` })),
          ...para(p.notes, "Notes"),
          ...line("Last seen", d(p.lastSeenOn)),
          ...line("Record on hold", p.legalHold ? "Yes" : null),
          ...line("Registered", d(p.createdAt)),
        ],
      },
    ],
  };

  const cases: ExportSection = {
    id: "cases",
    heading: "Cases",
    empty: "No cases.",
    entries: data.cases.map((c) => ({
      heading: `${c.title} (opened ${d(c.openedOn)})`,
      lines: [
        { label: "Status", text: CASE_STATUS_LABELS[c.status] ?? c.status },
        ...line("Closed", d(c.closedOn)),
        ...line("Practitioner", practitioner(c.practitionerId)),
        ...line("Site", site(c.siteId)),
        { label: "Payer", text: PAYER_TYPE_LABELS[c.payerType] ?? c.payerType },
        ...line("Payer account", referrer(c.payerReferrerId)),
        ...line("Membership or policy number", c.membershipNumber),
        ...line("Claim reference", c.claimReference),
        ...line("Excess", c.excessPence === null ? null : formatPence(c.excessPence)),
        ...line("Referred by", referrer(c.referrerId)),
        ...line("Referral received", d(c.referralReceivedOn)),
        ...line("Date of injury", d(c.injuryOn)),
        ...para(c.referralReason, "Reason for referral"),
        ...para(c.notes, "Case notes"),
      ],
    })),
  };

  const auths: ExportSection = {
    id: "authorisations",
    heading: "Treatment authorisations",
    empty: "No authorisations.",
    entries: data.authorisations.map((a) => ({
      heading: `Authorisation ${a.code}`,
      lines: [
        ...line("Case", data.cases.find((c) => c.id === a.caseId)?.title ?? ""),
        ...line("Issued by", referrer(a.referrerId)),
        ...line("Sessions", a.sessionsAuthorised === null ? null : `${a.sessionsUsed} of ${a.sessionsAuthorised} used`),
        ...line("Value", a.valueAuthorisedPence === null ? null : `${formatPence(a.valueUsedPence)} of ${formatPence(a.valueAuthorisedPence)} used`),
        ...line("Valid from", d(a.validFrom)),
        ...line("Expires", d(a.expiresOn)),
        { label: "Status", text: a.status },
        ...para(a.notes, "Notes"),
      ],
    })),
  };

  const notes: ExportSection = {
    id: "notes",
    heading: "Clinical notes",
    empty: "No clinical notes.",
    entries: data.notes.map((note) => {
      const labels = new Map(note.template.sections.map((s) => [s.key, s.label]));
      const keys = [...note.template.sections.map((s) => s.key), ...Object.keys(note.sections).filter((k) => !labels.has(k))];
      return {
        heading: `${d(note.seenOn)} – ${note.templateName} (${NOTE_TYPE_LABELS[note.noteType] ?? note.noteType})`,
        lines: [
          { label: "Status", text: noteStatusLabel(note) },
          ...line("Written by", note.authorName),
          ...line("Case", data.cases.find((c) => c.id === note.caseId)?.title ?? ""),
          ...line("Signed", note.signedAt ? `${dt(note.signedAt)} by ${note.signedByName ?? ""}${note.signedRegistration ? ` (${note.signedRegistration})` : ""}` : null),
          ...line("Content fingerprint", note.contentHash ? `${shortFingerprint(note.contentHash)} (${note.contentHash})` : null),
          ...keys.flatMap((k) => para(note.sections[k], labels.get(k) ?? k)),
          ...(note.bodyChart?.markers ?? []).map((m, i) => ({ label: i === 0 ? "Body chart" : undefined, text: describeMarker(m, i) })),
          ...note.amendments.flatMap((a) => [
            {
              label: `${AMENDMENT_KIND_LABELS[a.kind]} (${dt(a.createdAt)}, ${a.authorName ?? ""}${a.authorRegistration ? ` ${a.authorRegistration}` : ""})`,
              text: [a.sectionKey ? `Section: ${labels.get(a.sectionKey) ?? a.sectionKey}.` : "", a.text ?? "", a.reason ? `Reason: ${a.reason}` : ""].filter(Boolean).join(" "),
            },
          ]),
        ],
      };
    }),
  };

  const outcomes: ExportSection = {
    id: "outcomes",
    heading: "Outcome measures",
    empty: "No outcome measures.",
    entries: data.outcomes.map((o) => {
      const def = MEASURES[o.measure];
      const items = def.items
        .map((item) => {
          const v = o.answers?.items?.[item.key];
          const activity = o.answers?.activities?.[item.key];
          if ((v === null || v === undefined) && !activity) return null;
          return `${activity ? `${activity}` : item.label}: ${v ?? "not answered"}`;
        })
        .filter((x): x is string => x !== null);
      return {
        heading: `${d(o.takenOn)} – ${def.short}`,
        lines: [
          { label: "Score", text: `${formatScore(o.measure, o.scoreTenths)}${o.band ? ` (${o.band})` : ""}` },
          ...(items.length ? [{ label: "Answers", text: items.join("; ") }] : []),
          ...line("Status", o.status === "entered_in_error" ? `Marked as entered in error${o.errorReason ? `: ${o.errorReason}` : ""}` : null),
        ],
      };
    }),
  };

  const files: ExportSection = {
    id: "attachments",
    heading: "Attached files",
    empty: "No attached files.",
    entries: data.attachments.map((f) => ({
      heading: f.fileName,
      lines: [
        { label: "Type", text: `${f.type.toUpperCase()}, ${formatBytes(f.sizeBytes)}` },
        { label: "Added", text: dt(f.createdAt) },
        ...line("Description", f.description),
        ...line("Status", f.status === "withdrawn" ? `Withdrawn ${d(f.withdrawnAt)}${f.withdrawnReason ? `: ${f.withdrawnReason}` : ""}` : null),
        { label: "SHA-256", text: f.sha256 },
      ],
    })),
  };

  const log: ExportSection = {
    id: "history",
    heading: "Record history (who accessed or changed the record)",
    empty: "No history.",
    entries: [{ lines: history.map((h) => ({ label: dt(h.at), text: PMS_AUDIT_LABELS[h.action] ?? h.action })) }].filter((e) => e.lines.length > 0),
  };

  return [patient, cases, auths, notes, outcomes, files, ...extraSections, log];
}

/** The machine-readable copy (same content, exact text; internal tenant ids left out). */
export function subjectAccessJson(data: SubjectAccessData, history: readonly AuditEntry[], meta: ExportMeta, extra: Record<string, unknown> = {}) {
  const strip = <T extends object>(o: T): Omit<T, "tenantId"> => {
    const { tenantId: _t, ...rest } = o as T & { tenantId?: string };
    void _t;
    return rest;
  };
  return {
    format: "clinic-system-subject-access",
    version: 1,
    generatedAt: meta.generatedAt,
    clinic: { name: meta.clinicName, demonstration: meta.demo },
    patient: { ...strip(data.patient), pronouns: data.pronouns },
    clinicalFlags: data.clinicalFlags.map(strip),
    cases: data.cases.map(strip),
    authorisations: data.authorisations.map(strip),
    clinicalNotes: data.notes.map((note) => ({
      ...strip(note),
      amendments: note.amendments.map(strip),
      sectionsLabelled: note.template.sections.filter((s) => note.sections[s.key]).map((s) => ({ key: s.key, label: s.label, text: note.sections[s.key] })),
    })),
    outcomeMeasures: data.outcomes.map(strip),
    attachedFiles: data.attachments.map(strip),
    names: data.names,
    history: history.map((h) => ({ at: h.at, action: h.action, label: PMS_AUDIT_LABELS[h.action] ?? h.action, recordType: h.targetType })),
    ...extra,
  };
}

/* ------------------------------------------------------------------------------------------------
 * PDF
 * ----------------------------------------------------------------------------------------------*/

const A4 = { w: 595.28, h: 841.89 };
const MARGIN = 50;
const TEAL = rgb(0.06, 0.46, 0.43);
const TEXT = rgb(0.12, 0.16, 0.2);
const MUTED = rgb(0.32, 0.38, 0.43);

/** Replaces characters the built-in font cannot draw (memoised per character). */
function drawable(font: PDFFont): (s: string) => string {
  const cache = new Map<string, string>();
  return (s) =>
    Array.from(s.replace(/\r\n?/g, "\n"))
      .map((ch) => {
        if (ch === "\n") return "\n";
        if (ch === "\t") return " ";
        let out = cache.get(ch);
        if (out === undefined) {
          try {
            font.encodeText(ch);
            out = ch;
          } catch {
            const plain = ch.normalize("NFKD").replace(/[̀-ͯ]/g, "");
            try {
              if (!plain) throw new Error("empty");
              font.encodeText(plain);
              out = plain;
            } catch {
              out = "?";
            }
          }
          cache.set(ch, out);
        }
        return out;
      })
      .join("");
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let current = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        current = candidate;
        continue;
      }
      if (current) out.push(current);
      let rest = word;
      while (font.widthOfTextAtSize(rest, size) > width) {
        let cut = rest.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > width) cut--;
        out.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      current = rest;
    }
    out.push(current);
  }
  return out;
}

export async function renderSubjectAccessPdf(sections: readonly ExportSection[], meta: ExportMeta & { patientLabel: string }): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Subject access copy – ${meta.patientLabel}`);
  pdf.setCreator(meta.clinicName);
  pdf.setProducer(meta.clinicName);
  pdf.setCreationDate(new Date(meta.generatedAt));
  pdf.setModificationDate(new Date(meta.generatedAt));
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const clean = drawable(regular);
  const width = A4.w - 2 * MARGIN;
  let page: PDFPage = pdf.addPage([A4.w, A4.h]);
  let y = A4.h - MARGIN;
  const pages: PDFPage[] = [page];
  const top = () => A4.h - MARGIN - (meta.demo ? 18 : 0);

  const newPage = () => {
    page = pdf.addPage([A4.w, A4.h]);
    pages.push(page);
    y = top();
  };
  const need = (h: number) => {
    if (y - h < MARGIN + 20) newPage();
  };
  const text = (s: string, font: PDFFont, size: number, color = TEXT, indent = 0) => {
    for (const l of wrap(clean(s), font, size, width - indent)) {
      need(size + 4);
      page.drawText(l, { x: MARGIN + indent, y: y - size, size, font, color });
      y -= size + 4;
    }
  };

  y = top();
  text(`Subject access copy – ${meta.patientLabel}`, bold, 16, TEAL);
  text(`${meta.clinicName}. Produced ${dt(meta.generatedAt)}. This copy holds everything the clinic system keeps about this patient.`, regular, 9, MUTED);
  y -= 8;
  for (const section of sections) {
    need(40);
    y -= 6;
    text(section.heading, bold, 13, TEAL);
    page.drawLine({ start: { x: MARGIN, y: y + 2 }, end: { x: A4.w - MARGIN, y: y + 2 }, thickness: 0.5, color: MUTED });
    y -= 4;
    if (section.entries.length === 0) text(section.empty ?? "None.", regular, 10, MUTED);
    for (const entry of section.entries) {
      if (entry.heading) {
        need(30);
        y -= 2;
        text(entry.heading, bold, 10.5);
      }
      for (const l of entry.lines) {
        if (l.label) text(`${l.label}:`, bold, 9, MUTED, 8);
        text(l.text, regular, 9.5, TEXT, l.label ? 16 : 8);
      }
      y -= 4;
    }
  }

  pages.forEach((pg, i) => {
    const footer = clean(`${meta.clinicName} – subject access copy – ${meta.patientLabel} – page ${i + 1} of ${pages.length}`);
    pg.drawText(footer, { x: MARGIN, y: MARGIN - 20, size: 8, font: regular, color: MUTED });
    if (meta.demo) pg.drawText("Demonstration clinic – fictional data only", { x: MARGIN, y: A4.h - MARGIN + 4, size: 9, font: bold, color: rgb(0.57, 0.25, 0.05) });
  });
  return pdf.save({ useObjectStreams: false });
}
