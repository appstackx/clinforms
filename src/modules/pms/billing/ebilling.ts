/**
 * Insurer e-billing: what is sent for each insurer invoice, and the channels it can go through. Pure.
 *
 * Channels (src/server/pms/billing/ebilling-channels.ts implements them):
 * - "csv": a claims file the clinic uploads to the insurer's own provider portal or sends as agreed – connected;
 * - "healthcode": the UK clearing house most insurers use. NOT CONNECTED: it needs this system's own Healthcode
 *   registration and agreement (a registration is per practice system). Nothing is ever sent to it; the screen
 *   says so.
 *
 * Every claim line carries what insurers ask for: invoice number (at most 10 characters), invoice date, membership
 * number, pre-authorisation code, the service date and the insurer's own billing code, the practitioner's
 * registration number, the amounts and the diagnosis code when recorded.
 */
import { penceDecimal, toCsv } from "./csv";
import type { ExportChannel } from "./types";

export interface ExportChannelInfo {
  id: ExportChannel;
  label: string;
  connected: boolean;
  /** Plain explanation for the screen. */
  description: string;
}

export const EXPORT_CHANNEL_INFO: Readonly<Record<ExportChannel, ExportChannelInfo>> = {
  csv: {
    id: "csv",
    label: "Claims file (CSV)",
    connected: true,
    description: "A spreadsheet of the selected invoices, one row per treatment, to upload to the insurer's provider portal or send as agreed with them.",
  },
  healthcode: {
    id: "healthcode",
    label: "Healthcode e-billing",
    connected: false,
    description:
      "Not connected yet. Sending invoices through Healthcode needs this system's own Healthcode registration and agreement; until then, nothing is sent and invoices go by the claims file or the insurer's portal.",
  },
};

export interface ClaimLine {
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string | null;
  payerName: string;
  patientLastName: string;
  patientFirstName: string;
  patientDateOfBirth: string | null;
  patientNumber: number;
  membershipNumber: string | null;
  authorisationCode: string | null;
  claimReference: string | null;
  serviceDate: string | null;
  billingCode: string | null;
  description: string;
  practitionerName: string | null;
  practitionerRegistration: string | null;
  quantity: number;
  netPence: number;
  vatPence: number;
  totalPence: number;
  diagnosisCode: string | null;
}

export const CLAIM_CSV_HEADER = [
  "Invoice number",
  "Invoice date",
  "Due date",
  "Payer",
  "Patient surname",
  "Patient forename",
  "Patient date of birth",
  "Patient number",
  "Membership number",
  "Authorisation code",
  "Claim reference",
  "Service date",
  "Service code",
  "Description",
  "Practitioner",
  "Practitioner registration",
  "Quantity",
  "Net",
  "VAT",
  "Total",
  "Diagnosis code",
] as const;

export function claimsCsv(lines: readonly ClaimLine[]): string {
  return toCsv(
    CLAIM_CSV_HEADER,
    lines.map((l) => [
      l.invoiceNumber,
      l.invoiceDate,
      l.dueDate,
      l.payerName,
      l.patientLastName,
      l.patientFirstName,
      l.patientDateOfBirth,
      l.patientNumber,
      l.membershipNumber,
      l.authorisationCode,
      l.claimReference,
      l.serviceDate,
      l.billingCode,
      l.description,
      l.practitionerName,
      l.practitionerRegistration,
      l.quantity,
      penceDecimal(l.netPence),
      penceDecimal(l.vatPence),
      penceDecimal(l.totalPence),
      l.diagnosisCode,
    ]),
  );
}

/** Problems that would get a claim rejected – shown before the export (none = ready). */
export function claimProblems(invoice: { number: string | null; membershipNumber: string | null; authorisationCode: string | null; lines: readonly { billingCode: string | null; kind: string }[] }): string[] {
  const out: string[] = [];
  if (!invoice.number) out.push("The invoice has not been issued.");
  else if (invoice.number.length > 10) out.push("The invoice number is longer than 10 characters.");
  if (!invoice.membershipNumber) out.push("No membership number on the case.");
  if (!invoice.authorisationCode) out.push("No authorisation code.");
  if (invoice.lines.some((l) => l.kind === "service" && !l.billingCode)) out.push("A treatment has no insurer billing code.");
  return out;
}
