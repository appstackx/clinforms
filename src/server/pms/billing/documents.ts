/**
 * What goes on the PDFs (./pdf.tsx): an invoice, a credit note, an account or patient statement – built from the
 * repositories for one clinic. The clinic's letterhead comes from its profile (Settings → Clinic); the VAT number
 * from the billing settings when VAT-registered.
 */
import "server-only";
import { buildStatement } from "../../../modules/pms/billing/statements";
import type { Invoice } from "../../../modules/pms/billing/types";
import { vatLabel, vatSummary } from "../../../modules/pms/billing/vat";
import { formatPence, formatUkDate } from "../../../modules/pms/core/text";
import { getClinicProfile } from "../../repos/clinic-profile";
import type { RepoContext } from "../../repos/context";
import { getCreditNote } from "../../repos/pms/billing/credit-notes";
import { getInvoice } from "../../repos/pms/billing/invoices";
import type { PayerRef } from "../../repos/pms/billing/payments";
import { statementEntries } from "../../repos/pms/billing/reports";
import { getBillingSettings } from "../../repos/pms/billing/settings";
import { getPatientSummaries } from "../../repos/pms/patients";
import { getReferrer } from "../../repos/pms/referrers";
import { getPmsSettings } from "../../repos/pms/settings";
import type { DocumentPdfModel, PdfClinic, PdfParty } from "./pdf";

async function clinicOf(ctx: RepoContext, tenantId: string, fallbackName: string): Promise<{ clinic: PdfClinic; demo: boolean; instructions: string | null; vatRegistered: boolean }> {
  const [profile, billing, pms] = await Promise.all([getClinicProfile(ctx, tenantId), getBillingSettings(ctx, tenantId), getPmsSettings(ctx, tenantId)]);
  return {
    clinic: {
      name: profile?.displayName ?? fallbackName,
      legalName: profile?.legalName ?? null,
      address: profile?.address ?? [],
      postcode: profile?.postcode ?? null,
      phone: profile?.phone ?? null,
      email: profile?.email ?? null,
      vatNumber: billing.vatRegistered ? billing.vatNumber : null,
    },
    demo: pms.isDemo,
    instructions: billing.paymentInstructions,
    vatRegistered: billing.vatRegistered,
  };
}

async function practitionerNames(ctx: RepoContext, tenantId: string, ids: string[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids)).slice(0, 90);
  if (unique.length === 0) return new Map();
  const rows = await ctx.db.selectFrom("pms_practitioners").select(["id", "display_name"]).where("tenant_id", "=", tenantId).where("id", "in", unique).execute();
  return new Map(rows.map((r) => [r.id, r.display_name]));
}

/** Who a draft would go to (issued invoices carry their frozen snapshot). */
async function partyOf(ctx: RepoContext, tenantId: string, inv: Invoice): Promise<PdfParty> {
  if (inv.billToSnapshot) {
    const snap = inv.billToSnapshot;
    const refs = [...snap.references];
    if (inv.billTo === "payer" && inv.diagnosisCode) refs.push({ label: "Diagnosis code", value: inv.diagnosisCode });
    return { name: snap.name, attention: snap.attention, address: snap.address ?? [], postcode: snap.postcode, references: refs };
  }
  if (inv.billTo === "payer" && inv.payerReferrerId) {
    const r = await getReferrer(ctx, tenantId, inv.payerReferrerId);
    return { name: r?.name ?? "Payer", attention: r?.contactName ?? null, address: r?.address ?? [], postcode: r?.postcode ?? null, references: [] };
  }
  const p = (await getPatientSummaries(ctx, tenantId, [inv.patientId])).get(inv.patientId);
  return { name: p ? [p.title, p.firstName, p.lastName].filter(Boolean).join(" ") : "Patient", attention: null, address: [], postcode: p?.postcode ?? null, references: [] };
}

function safeName(text: string): string {
  return text.replace(/[^A-Za-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "document";
}

export async function invoiceDocument(ctx: RepoContext, tenantId: string, clinicName: string, invoiceId: string): Promise<{ model: DocumentPdfModel; filename: string } | null> {
  const inv = await getInvoice(ctx, tenantId, invoiceId);
  if (!inv || inv.status === "cancelled") return null;
  const { clinic, demo, instructions, vatRegistered } = await clinicOf(ctx, tenantId, clinicName);
  const pracs = await practitionerNames(
    ctx,
    tenantId,
    inv.lines.map((l) => l.practitionerId).filter((x): x is string => typeof x === "string"),
  );
  const showVat = vatRegistered || inv.lines.some((l) => l.vatPence !== 0);
  const draft = inv.status === "draft";
  const facts = [
    { label: "Invoice number", value: inv.number ?? "Draft" },
    { label: "Invoice date", value: inv.issuedOn ? formatUkDate(inv.issuedOn) : "Not issued" },
    ...(inv.dueOn ? [{ label: "Payment due", value: formatUkDate(inv.dueOn) }] : []),
  ];
  const totals: DocumentPdfModel["totals"] = [];
  if (showVat) totals.push({ label: "Net", value: formatPence(inv.netPence) }, { label: "VAT", value: formatPence(inv.vatPence) });
  totals.push({ label: "Total", value: formatPence(inv.totalPence), strong: true });
  if (inv.creditedPence) totals.push({ label: "Credited", value: `-${formatPence(inv.creditedPence)}` });
  if (inv.paidPence) totals.push({ label: "Paid", value: `-${formatPence(inv.paidPence)}` });
  if (!draft) totals.push({ label: inv.balancePence < 0 ? "Owed to you" : "Balance due", value: formatPence(Math.abs(inv.balancePence)), strong: true });
  const notes: string[] = [];
  if (inv.notes) notes.push(inv.notes);
  if (!draft && inv.balancePence > 0 && inv.dueOn) notes.push(`Please pay by ${formatUkDate(inv.dueOn)}, quoting ${inv.number}.`);
  if (instructions) notes.push(instructions);
  if (!showVat) notes.push("No VAT is charged.");
  const model: DocumentPdfModel = {
    title: draft ? "Draft invoice" : "Invoice",
    clinic,
    facts,
    to: await partyOf(ctx, tenantId, inv),
    columns: showVat
      ? [
          { label: "Date", width: "12%" },
          { label: "Description", width: "40%" },
          { label: "Code", width: "12%" },
          { label: "Qty", width: "6%", align: "right" },
          { label: "Price", width: "11%", align: "right" },
          { label: "VAT", width: "8%", align: "right" },
          { label: "Amount", width: "11%", align: "right" },
        ]
      : [
          { label: "Date", width: "13%" },
          { label: "Description", width: "47%" },
          { label: "Code", width: "12%" },
          { label: "Qty", width: "6%", align: "right" },
          { label: "Price", width: "11%", align: "right" },
          { label: "Amount", width: "11%", align: "right" },
        ],
    rows: inv.lines.map((l) => {
      const who = l.practitionerId ? pracs.get(l.practitionerId) : null;
      const text = `${l.description ?? ""}${who ? ` – ${who}` : ""}${l.discountPence ? ` (less ${formatPence(l.discountPence)})` : ""}`;
      const base = [l.serviceOn ? formatUkDate(l.serviceOn) : "", text, l.billingCode ?? "", String(l.quantity), formatPence(l.unitPricePence)];
      return { cells: showVat ? [...base, vatLabel(l.vatCode, l.vatRateBp), formatPence(l.totalPence)] : [...base, formatPence(l.totalPence)] };
    }),
    vatSummary: showVat ? vatSummary(inv.lines.map((l) => ({ ...l }))).map((v) => ({ label: vatLabel(v.vatCode, v.vatRateBp), net: formatPence(v.netPence), vat: formatPence(v.vatPence) })) : null,
    totals,
    notes,
    footerText: `${clinic.name} · ${inv.number ?? "Draft invoice"}`,
    demo,
  };
  return { model, filename: `${safeName(draft ? `draft-invoice` : `invoice-${inv.number}`)}.pdf` };
}

export async function creditNoteDocument(ctx: RepoContext, tenantId: string, clinicName: string, creditNoteId: string): Promise<{ model: DocumentPdfModel; filename: string } | null> {
  const cn = await getCreditNote(ctx, tenantId, creditNoteId);
  if (!cn) return null;
  const inv = await getInvoice(ctx, tenantId, cn.invoiceId);
  if (!inv) return null;
  const { clinic, demo, vatRegistered } = await clinicOf(ctx, tenantId, clinicName);
  const byLine = new Map(inv.lines.map((l) => [l.id, l]));
  const showVat = vatRegistered || cn.vatPence !== 0;
  const model: DocumentPdfModel = {
    title: "Credit note",
    clinic,
    facts: [
      { label: "Credit note number", value: cn.number },
      { label: "Date", value: formatUkDate(cn.issuedOn) },
      { label: "Credits invoice", value: inv.number ?? "" },
    ],
    to: await partyOf(ctx, tenantId, inv),
    columns: showVat
      ? [
          { label: "Date", width: "14%" },
          { label: "Description", width: "50%" },
          { label: "VAT", width: "12%", align: "right" },
          { label: "Amount", width: "24%", align: "right" },
        ]
      : [
          { label: "Date", width: "14%" },
          { label: "Description", width: "62%" },
          { label: "Amount", width: "24%", align: "right" },
        ],
    rows: cn.lines.map((l) => {
      const line = byLine.get(l.invoiceLineId);
      const base = [line?.serviceOn ? formatUkDate(line.serviceOn) : "", line?.description ?? ""];
      return { cells: showVat ? [...base, formatPence(l.vatPence), formatPence(l.totalPence)] : [...base, formatPence(l.totalPence)] };
    }),
    vatSummary: null,
    totals: [...(showVat ? [{ label: "Net", value: formatPence(cn.netPence) }, { label: "VAT", value: formatPence(cn.vatPence) }] : []), { label: "Total credited", value: formatPence(cn.totalPence), strong: true }],
    notes: [cn.reason ? `Reason: ${cn.reason}` : ""].filter(Boolean),
    footerText: `${clinic.name} · ${cn.number}`,
    demo,
  };
  return { model, filename: `credit-note-${safeName(cn.number)}.pdf` };
}

export async function statementDocument(
  ctx: RepoContext,
  tenantId: string,
  clinicName: string,
  payer: PayerRef,
  from: string,
  until: string,
): Promise<{ model: DocumentPdfModel; filename: string; truncated: boolean } | null> {
  let to: PdfParty;
  if (payer.payerKind === "account") {
    const r = await getReferrer(ctx, tenantId, payer.payerReferrerId);
    if (!r) return null;
    to = { name: r.name, attention: r.contactName, address: r.address ?? [], postcode: r.postcode, references: [] };
  } else {
    const p = (await getPatientSummaries(ctx, tenantId, [payer.patientId])).get(payer.patientId);
    if (!p) return null;
    const full = await ctx.db.selectFrom("pms_patients").select(["address_json"]).where("tenant_id", "=", tenantId).where("id", "=", payer.patientId).executeTakeFirst();
    let address: string[] = [];
    try {
      address = full?.address_json ? (JSON.parse(full.address_json) as string[]) : [];
    } catch {
      address = [];
    }
    to = { name: [p.title, p.firstName, p.lastName].filter(Boolean).join(" "), attention: null, address, postcode: p.postcode, references: [{ label: "Patient number", value: String(p.patientNumber) }] };
  }
  const { entries, truncated } = await statementEntries(ctx, tenantId, payer, until);
  const st = buildStatement(entries, from, until);
  const names =
    payer.payerKind === "account"
      ? await getPatientSummaries(
          ctx,
          tenantId,
          entries.map((e) => e.patientId).filter((x): x is string => typeof x === "string"),
        )
      : new Map();
  const { clinic, demo, instructions } = await clinicOf(ctx, tenantId, clinicName);
  const byId = new Map(entries.map((e) => [e.id, e]));
  const model: DocumentPdfModel = {
    title: "Statement",
    clinic,
    facts: [
      { label: "Period", value: `${formatUkDate(from)} to ${formatUkDate(until)}` },
      { label: "Brought forward", value: formatPence(st.openingPence) },
    ],
    to,
    columns: [
      { label: "Date", width: "12%" },
      { label: "Reference", width: "14%" },
      { label: "Details", width: "38%" },
      { label: "Charged", width: "12%", align: "right" },
      { label: "Paid / credited", width: "12%", align: "right" },
      { label: "Balance", width: "12%", align: "right" },
    ],
    rows: [
      { cells: [formatUkDate(from), "", "Brought forward", "", "", formatPence(st.openingPence)] },
      ...st.rows.map((r) => {
        const patientId = byId.get(r.id)?.patientId;
        const who = patientId ? names.get(patientId) : null;
        return {
          cells: [
            formatUkDate(r.on),
            r.reference,
            who ? `${r.description} – ${who.firstName} ${who.lastName}` : r.description,
            r.debitPence ? formatPence(r.debitPence) : "",
            r.creditPence ? formatPence(r.creditPence) : "",
            formatPence(r.balancePence),
          ],
        };
      }),
    ],
    vatSummary: null,
    totals: [
      { label: "Charged in the period", value: formatPence(st.totals.debitPence) },
      { label: "Paid or credited in the period", value: formatPence(st.totals.creditPence) },
      { label: st.closingPence < 0 ? "In credit" : "Balance owed", value: formatPence(Math.abs(st.closingPence)), strong: true },
    ],
    notes: [truncated ? "This statement is shortened: the account has more entries than one statement holds." : "", instructions ?? ""].filter(Boolean),
    footerText: `${clinic.name} · Statement to ${formatUkDate(until)}`,
    demo,
  };
  return { model, filename: `statement-${safeName(to.name)}-${until}.pdf`, truncated };
}
