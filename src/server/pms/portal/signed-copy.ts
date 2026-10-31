/**
 * The sealed, signed copy of a patient's form as a PDF (record → Forms → signed copy → "Download PDF"): the same
 * content and the SAME visibility rules as the screen (src/server/pms/portal/staff.ts patientResponseFor) – health
 * answers only with clinical.view (reception gets "N health answers are only shown to clinicians"), an outcome
 * questionnaire only for clinicians. The typed signature, when and from where (incl. "Completed in the clinic,
 * verified by …"), the form version, the seal's full fingerprint and whether it still matches.
 *
 * Engine: pdf-lib (already a dependency – as the subject-access copy, src/server/pms/records/subject-access-export.ts):
 * A4, built-in Helvetica, "Page x of y", the clinic's name, the demonstration notice on every page of a demonstration
 * clinic. Characters the built-in font cannot draw are replaced. The download is recorded in the clinic's trail.
 */
import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { formatUkDate } from "../../../modules/pms/core/text";
import { answerText } from "../../../modules/pms/portal/forms";
import { formatWhen } from "../../../modules/pms/portal/time";
import { pmsAudit } from "../../repos/pms/context";
import { getPatient } from "../../repos/pms/patients";
import { getPmsSettings } from "../../repos/pms/settings";
import type { ClinicActor } from "../actor";
import { patientResponseFor, type ResponseView } from "./staff";
import { pmsNow } from "../../../modules/pms/core/clock";

/** "From" on the signed copy: the clinic device (with who verified it) or how the patient reached the form. */
export function signedVia(trust: "verified" | "unverified" | null, inClinicWords: string | null): string {
  if (inClinicWords) return inClinicWords;
  return trust === "verified" ? "Patient portal, signed in by email link" : "Booking link (not signed in) – check at the first visit";
}

export interface SignedCopyPdfModel {
  clinicName: string;
  demo: boolean;
  title: string;
  version: number;
  patient: { name: string; dateOfBirth: string | null };
  rows: { q: string; a: string; clinical: boolean }[];
  hiddenCount: number;
  signature: { name: string; at: string; via: string } | null;
  completedAt: string | null;
  inClinic: string | null;
  fingerprint: string | null;
  sealIntact: boolean;
  checkedAt: string | null;
  appliedAt: string | null;
  producedAt: string;
  producedBy: string;
}

/** The PDF's content from the screen's view (already filtered by the viewer's permissions). */
export function signedCopyModel(view: ResponseView, meta: { clinicName: string; demo: boolean; patientName: string; dateOfBirth: string | null; producedAt: string; producedBy: string }): SignedCopyPdfModel {
  const r = view.response;
  const rows = view.answers
    .filter((a) => a.field.type !== "heading" && a.value !== "hidden")
    .map((a) => ({ q: a.field.label, a: answerText(a.field, a.value === "hidden" ? null : a.value), clinical: Boolean(a.field.sensitive) }));
  return {
    clinicName: meta.clinicName,
    demo: meta.demo,
    title: r.name,
    version: r.templateVersion,
    patient: { name: meta.patientName, dateOfBirth: meta.dateOfBirth },
    rows,
    hiddenCount: view.hiddenCount,
    signature: r.signatureName && r.signedAt ? { name: r.signatureName, at: formatWhen(r.signedAt), via: signedVia(r.trust, view.inClinic?.words ?? null) } : null,
    completedAt: r.submittedAt ? formatWhen(r.submittedAt) : null,
    inClinic: view.inClinic?.words ?? null,
    fingerprint: r.contentSha256,
    sealIntact: view.sealIntact,
    checkedAt: r.reviewedAt ? formatWhen(r.reviewedAt) : null,
    appliedAt: r.appliedAt ? formatWhen(r.appliedAt) : null,
    producedAt: meta.producedAt,
    producedBy: meta.producedBy,
  };
}

/** The signed copy as PDF bytes for the member, or null (not found / not theirs to see / not completed). Audited. */
export async function signedCopyPdfFor(actor: ClinicActor, patientId: string, responseId: string): Promise<{ fileName: string; bytes: Uint8Array } | null> {
  const r = await patientResponseFor(actor, patientId, responseId);
  if (!r.ok || r.value.response.status !== "submitted") return null;
  const ctx = actor.repo();
  const [patient, settings] = await Promise.all([getPatient(ctx, actor.tenantId, patientId), getPmsSettings(ctx, actor.tenantId)]);
  if (!patient) return null;
  const model = signedCopyModel(r.value, {
    clinicName: actor.clinicName,
    demo: settings.isDemo,
    patientName: `${patient.firstName} ${patient.lastName}`,
    dateOfBirth: patient.dateOfBirth ?? null,
    producedAt: formatWhen(pmsNow().toISOString()),
    producedBy: actor.name,
  });
  const bytes = await renderSignedCopyPdf(model);
  await pmsAudit(ctx, actor.tenantId, actor.actor, { action: "pms.intake_response.pdf", targetType: "pms_intake_response", targetId: responseId, detail: { patientId, hiddenAnswers: r.value.hiddenCount } });
  const safeName = r.value.response.name.replace(/[^A-Za-z0-9 _-]+/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "form";
  return { fileName: `${safeName}-signed-copy.pdf`, bytes };
}

/* ------------------------------------------------------------------------------------------------
 * Rendering (A4, built-in Helvetica)
 * ----------------------------------------------------------------------------------------------*/

const A4 = { w: 595.28, h: 841.89 };
const MARGIN = 50;
const TEAL = rgb(0.06, 0.46, 0.43);
const TEXT = rgb(0.12, 0.16, 0.2);
const MUTED = rgb(0.32, 0.38, 0.43);
const AMBER = rgb(0.53, 0.31, 0.05);
const GREEN = rgb(0.09, 0.4, 0.2);

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

export async function renderSignedCopyPdf(m: SignedCopyPdfModel): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${m.title} – signed copy`);
  pdf.setCreator(m.clinicName);
  pdf.setProducer(m.clinicName);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdf.embedFont(StandardFonts.Courier);
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const clean = drawable(regular);
  const width = A4.w - 2 * MARGIN;
  const top = () => A4.h - MARGIN - (m.demo ? 18 : 0);
  let page: PDFPage = pdf.addPage([A4.w, A4.h]);
  const pages: PDFPage[] = [page];
  let y = top();
  const newPage = () => {
    page = pdf.addPage([A4.w, A4.h]);
    pages.push(page);
    y = top();
  };
  const need = (h: number) => {
    if (y - h < MARGIN + 24) newPage();
  };
  const text = (s: string, font: PDFFont, size: number, color = TEXT, indent = 0) => {
    for (const l of wrap(clean(s), font, size, width - indent)) {
      need(size + 4);
      page.drawText(l, { x: MARGIN + indent, y: y - size, size, font, color });
      y -= size + 4;
    }
  };
  const rule = () => {
    page.drawLine({ start: { x: MARGIN, y: y + 2 }, end: { x: A4.w - MARGIN, y: y + 2 }, thickness: 0.5, color: MUTED });
    y -= 6;
  };

  text(m.clinicName, bold, 13, TEAL);
  y -= 4;
  text(`${m.title} – signed copy`, bold, 17);
  text(`Patient: ${m.patient.name}${m.patient.dateOfBirth ? ` · date of birth ${formatUkDate(m.patient.dateOfBirth)}` : ""}`, regular, 10);
  text(`Form version ${m.version}${m.completedAt ? ` · completed ${m.completedAt}` : ""}`, regular, 9.5, MUTED);
  y -= 4;
  text(`${m.signature ? "Signed and sealed." : "Completed and sealed."} It can't be changed. To update the answers, the clinic sends a new form.`, bold, 9.5, GREEN);
  if (!m.sealIntact) text("The seal does not match the stored answers – report this to the clinic's administrator.", bold, 9.5, rgb(0.6, 0.1, 0.1));
  y -= 6;
  rule();

  text("Answers", bold, 12, TEAL);
  y -= 2;
  if (m.rows.length === 0) text(m.hiddenCount > 0 ? "No answers you may see." : "No answers.", regular, 9.5, MUTED);
  for (const r of m.rows) {
    need(30);
    text(`${r.q}${r.clinical ? "  (clinical)" : ""}`, bold, 9.5, r.clinical ? AMBER : MUTED);
    text(r.a, regular, 10, TEXT, 10);
    y -= 3;
  }
  if (m.hiddenCount > 0) {
    y -= 2;
    text(`${m.hiddenCount} health answer${m.hiddenCount === 1 ? " is" : "s are"} only shown to clinicians and left out of this copy.`, regular, 9.5, MUTED);
  }
  y -= 6;
  need(120);
  rule();
  text("Signature", bold, 12, TEAL);
  y -= 2;
  if (m.signature) {
    text(m.signature.name, italic, 16);
    y -= 2;
    const facts: [string, string][] = [
      ["Typed name", m.signature.name],
      ["Signed", m.signature.at],
      ["From", m.signature.via],
      ["Form version", `${m.title} v${m.version}`],
    ];
    for (const [k, v] of facts) {
      const lines = wrap(clean(v), regular, 9.5, width - 110);
      need(lines.length * 13.5);
      page.drawText(clean(`${k}:`), { x: MARGIN, y: y - 9.5, size: 9, font: bold, color: MUTED });
      for (const l of lines) {
        page.drawText(l, { x: MARGIN + 110, y: y - 9.5, size: 9.5, font: regular, color: TEXT });
        y -= 13.5;
      }
    }
  } else {
    text(`This form has no signature${m.completedAt ? ` – completed ${m.completedAt}` : ""}.`, regular, 9.5);
    if (m.inClinic) text(m.inClinic, regular, 9.5);
  }
  if (m.fingerprint) {
    y -= 2;
    text("Fingerprint (SHA-256 of the signed content):", bold, 9, MUTED);
    text(m.fingerprint.replace(/(.{8})/g, "$1 ").trim(), mono, 8.5);
    text("The fingerprint changes if even one character of the signed form changes.", regular, 8.5, MUTED);
  }
  y -= 6;
  text(m.checkedAt ? `Checked by the clinic ${m.checkedAt}.` : "Not yet checked by the clinic.", regular, 9.5);
  if (m.appliedAt) text(`Details copied to the patient's record ${m.appliedAt}.`, regular, 9.5);

  pages.forEach((pg, i) => {
    const footer = clean(`${m.clinicName} – ${m.title} – signed copy – produced ${m.producedAt} by ${m.producedBy} – page ${i + 1} of ${pages.length}`);
    wrap(footer, regular, 7.5, width).forEach((l, j) => pg.drawText(l, { x: MARGIN, y: MARGIN - 18 - j * 9, size: 7.5, font: regular, color: MUTED }));
    if (m.demo) pg.drawText("Demonstration clinic – fictional data only", { x: MARGIN, y: A4.h - MARGIN + 4, size: 9, font: bold, color: rgb(0.57, 0.25, 0.05) });
  });
  return pdf.save({ useObjectStreams: false });
}

