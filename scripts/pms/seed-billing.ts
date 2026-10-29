/**
 * Demonstration billing for the demo clinic (contract §9), after the diary and records seeds: billing settings
 * (payment links on, fictional bank details), a few months of fictional invoices so aged debt has every band
 * (self-pay, insurer, solicitor), payments (card, cash), one insurer remittance with a short payment left, a
 * credit note, a voided invoice, a saved TEST card – the diary history's past weeks invoiced week by week (issued
 * on the Friday, most patients paying at the desk that day, insurers paying weeks later, a few left owing) – and
 * the completed visits of the first half of this week invoiced; the rest (and every missed / late-cancelled fee of
 * this week) left in "Attended, not invoiced". Everything goes through the billing repositories and
 * services (audited, encrypted, the database's own rules). Refuses a clinic not flagged as a demonstration clinic.
 *
 * Idempotent: invoices carry the import reference "demo-billing-…"; a clinic that has them is left as it is.
 *
 * Wiring (orchestrator, scripts/pms/seed-demo.ts – after seedRecords):
 *   await seedBilling({ db, cipher: getDataCipher() }, slug, { log: (line) => console.log(`  ${line}`) });
 */
import { addDaysIso } from "../../src/modules/pms/billing/status";
import { londonToUtcOrThrow, mondayOf } from "../../src/modules/pms/diary/time";
import { ukToday } from "../../src/modules/pms/core/text";
import { RepoInputError, type RepoContext } from "../../src/server/repos/context";
import { createCreditNote, spreadOverLines, voidInvoice } from "../../src/server/repos/pms/billing/credit-notes";
import { createDraftInvoice, getInvoice, issueInvoice } from "../../src/server/repos/pms/billing/invoices";
import { recordPayment } from "../../src/server/repos/pms/billing/payments";
import { saveCard } from "../../src/server/repos/pms/billing/saved-cards";
import { getBillingSettings, updateBillingSettings } from "../../src/server/repos/pms/billing/settings";
import { listPractitioners, listServices, listSites } from "../../src/server/repos/pms/directory";
import { getPmsSettings } from "../../src/server/repos/pms/settings";
import { testActor, type BillingActor } from "../../src/server/pms/billing/access";
import { uninvoicedVisitsFor } from "../../src/server/pms/billing/views";
import { invoiceVisitsFor, takePaymentFor } from "../../src/server/pms/billing/writes";
import { SEED_ACTOR } from "./seed-lib";
import { pmsNow } from "../../src/modules/pms/core/clock";

export interface SeedBillingOptions {
  now?: Date;
  log?: (line: string) => void;
}

export interface SeedBillingSummary {
  invoices: number;
  /** Of which for the diary history's past weeks. */
  historyInvoices: number;
  payments: number;
  uninvoicedLeft: number;
  existed: boolean;
}

const REF = "demo-billing";

export async function seedBilling(base: Pick<RepoContext, "db" | "cipher">, tenantId: string, options: SeedBillingOptions = {}): Promise<SeedBillingSummary> {
  const now = options.now ?? pmsNow();
  const ctx: RepoContext = { ...base, now: () => now };
  const log = options.log ?? (() => undefined);
  if (!(await getPmsSettings(ctx, tenantId)).isDemo) throw new RepoInputError("Billing demo data is only for a clinic flagged as a demonstration clinic.");
  const existing = await ctx.db.selectFrom("pms_invoices").select("id").where("tenant_id", "=", tenantId).where("import_ref", "like", `${REF}-%`).limit(1).executeTakeFirst();
  if (existing) {
    log("Billing: demonstration invoices are there already – nothing added.");
    return { invoices: 0, historyInvoices: 0, payments: 0, uninvoicedLeft: 0, existed: true };
  }
  const today = ukToday(now);
  const actor: BillingActor = { ...testActor(ctx, tenantId, "owner", { userId: SEED_ACTOR.userId, name: "Demonstration data" }), actor: SEED_ACTOR };

  // Settings: payment links on (test mode), fictional bank details, accounts pay in 30 days.
  const s = await getBillingSettings(ctx, tenantId);
  if (s.rev === 0) {
    await updateBillingSettings(
      ctx,
      tenantId,
      0,
      {
        paymentLinksEnabled: true,
        accountTermsDays: 30,
        selfPayTermsDays: 14,
        // Bank details for invoices (Set-up → Billing settings, migration 0139) – fictional, all zeros.
        bankDetails: { accountName: "Riverside Physiotherapy (fictional)", sortCode: "00-00-00", accountNumber: "00000000" },
        paymentInstructions: "Please quote the invoice number.",
      },
      SEED_ACTOR,
    );
  }

  const [sites, practitioners, services] = await Promise.all([listSites(ctx, tenantId), listPractitioners(ctx, tenantId), listServices(ctx, tenantId)]);
  const site = sites[0]?.id ?? null;
  const prac = practitioners[0]?.id ?? null;
  const fu = services.find((x) => x.code === "FU") ?? services[0];
  const ia = services.find((x) => x.code === "IA") ?? services[0];
  if (!fu || !ia) throw new RepoInputError("Billing demo data needs the seeded appointment types.");

  /** A seeded patient by their import reference ("sim-pat-001"). */
  const patient = async (ref: string) => (await ctx.db.selectFrom("pms_patients").select("id").where("tenant_id", "=", tenantId).where("import_ref", "=", ref).executeTakeFirst())?.id ?? null;
  let invoices = 0;
  let payments = 0;

  /** A historic invoice (lines by hand, no diary visit), issued on `on`. */
  async function past(key: string, patientId: string | null, caseId: string | null, billTo: "patient" | "payer", lines: { serviceId: string; on: string; pence: number }[], on: string) {
    if (!patientId) return null;
    const { invoice, excessInvoice } = await createDraftInvoice(
      ctx,
      tenantId,
      { patientId, caseId, billTo, siteId: site, importRef: `${REF}-${key}`, lines: lines.map((l) => ({ serviceId: l.serviceId, practitionerId: prac, serviceOn: l.on, unitPricePence: l.pence })) },
      SEED_ACTOR,
      { applyExcess: billTo === "payer" },
    );
    const issued = await issueInvoice(ctx, tenantId, invoice.id, invoice.rev, { issuedOn: on }, SEED_ACTOR);
    if (excessInvoice) await issueInvoice(ctx, tenantId, excessInvoice.id, excessInvoice.rev, { issuedOn: on }, SEED_ACTOR);
    invoices += excessInvoice ? 2 : 1;
    return issued.ok ? issued.invoice : null;
  }

  // Self-pay history (Owen-style: an old one paid by card, a missed-appointment fee and a follow-up still owed).
  const megan = await patient("sim-pat-001");
  const daniel = await patient("sim-pat-002");
  const p7 = await patient("sim-pat-007");
  const p8 = await patient("sim-pat-008");
  const paidOld = await past("self-1", p7, null, "patient", [{ serviceId: fu.id, on: addDaysIso(today, -70), pence: 5500 }], addDaysIso(today, -70));
  if (paidOld && p7) {
    await recordPayment(ctx, tenantId, { payerKind: "patient", patientId: p7, receivedOn: addDaysIso(today, -70), method: "card", amountPence: 5500, reference: "Card reader", siteId: site, allocations: [{ invoiceId: paidOld.id, amountPence: 5500 }] }, SEED_ACTOR);
    payments += 1;
  }
  await past("self-2", p7, null, "patient", [{ serviceId: fu.id, on: addDaysIso(today, -56), pence: 6500 }], addDaysIso(today, -56));
  await past("self-3", p7, null, "patient", [{ serviceId: fu.id, on: addDaysIso(today, -15), pence: 5500 }], addDaysIso(today, -15));
  await past("self-4", p8, null, "patient", [{ serviceId: ia.id, on: addDaysIso(today, -100), pence: 7000 }], addDaysIso(today, -100));

  // Insurer and solicitor accounts: open invoices of different ages; a voided one and a credit note.
  const insured = await ctx.db
    .selectFrom("pms_cases")
    .select(["id", "patient_id", "payer_type", "payer_referrer_id"])
    .where("tenant_id", "=", tenantId)
    .where("status", "=", "open")
    .where("payer_type", "in", ["insurer", "solicitor", "mlc"])
    .where("payer_referrer_id", "is not", null)
    .orderBy("id")
    .limit(12)
    .execute();
  const byType = (t: string) => insured.filter((c) => c.payer_type === t);
  const ins = byType("insurer");
  const ages = [-80, -40, -20, -9];
  for (let i = 0; i < Math.min(ins.length, ages.length); i++) {
    const c = ins[i];
    await past(`ins-${i}`, c.patient_id, c.id, "payer", [
      { serviceId: ia.id, on: addDaysIso(today, ages[i] - 7), pence: 7500 },
      { serviceId: fu.id, on: addDaysIso(today, ages[i]), pence: 6000 },
    ], addDaysIso(today, ages[i]));
  }
  const sol = byType("solicitor")[0] ?? byType("mlc")[0];
  if (sol) await past("sol-0", sol.patient_id, sol.id, "payer", [{ serviceId: ia.id, on: addDaysIso(today, -68), pence: 25000 }], addDaysIso(today, -67));

  // A voided invoice (raised in error) and a credit note (goodwill) on Daniel Brooks.
  const toVoid = await past("void-0", daniel, null, "patient", [{ serviceId: fu.id, on: addDaysIso(today, -14), pence: 5500 }], addDaysIso(today, -14));
  if (toVoid) await voidInvoice(ctx, tenantId, toVoid.id, { reason: "Raised in error (fictional)" }, SEED_ACTOR);
  const credited = await past("credit-0", daniel, null, "patient", [{ serviceId: ia.id, on: addDaysIso(today, -21), pence: 7000 }], addDaysIso(today, -21));
  if (credited) {
    const full = (await getInvoice(ctx, tenantId, credited.id))!;
    await createCreditNote(ctx, tenantId, { invoiceId: full.id, lines: spreadOverLines(full, 1500), reason: "Goodwill – short session (fictional)" }, SEED_ACTOR);
  }

  // A remittance from the first insurer: pays its oldest invoice in full and the next one short (left outstanding).
  if (ins[0]?.payer_referrer_id) {
    const open = await ctx.db
      .selectFrom("pms_invoices")
      .select(["id", "total_pence", "paid_pence", "credited_pence"])
      .where("tenant_id", "=", tenantId)
      .where("status", "=", "issued")
      .where("bill_to", "=", "payer")
      .where("payer_referrer_id", "=", ins[0].payer_referrer_id)
      .orderBy("issued_on")
      .limit(2)
      .execute();
    const owed = open.map((o) => Number(o.total_pence) - Number(o.paid_pence) - Number(o.credited_pence));
    if (open.length && owed[0] > 0) {
      const allocations = [{ invoiceId: open[0].id, amountPence: owed[0] }, ...(open[1] && owed[1] > 1500 ? [{ invoiceId: open[1].id, amountPence: owed[1] - 1500 }] : [])];
      const total = allocations.reduce((a, x) => a + x.amountPence, 0);
      await recordPayment(ctx, tenantId, { payerKind: "account", payerReferrerId: ins[0].payer_referrer_id, receivedOn: addDaysIso(today, -5), method: "bank_transfer", amountPence: total, reference: "NW-RA-2210", allocations }, SEED_ACTOR);
      payments += 1;
    }
  }

  // A saved TEST card for Megan Hart (provider references are stand-ins: card on file works with the local test stub).
  if (megan) await saveCard(ctx, tenantId, { patientId: megan, provider: "stripe", customerRef: "cus_demo_megan_hart", methodRef: "pm_demo_visa_1111", brand: "visa", last4: "1111", expMonth: 8, expYear: 2028 }, SEED_ACTOR);

  // The diary history (scripts/pms/seed-diary.ts, "demo-hist-…"): each past week's chargeable visits invoiced and
  // issued on its Friday ("now" = Friday 18:30), as the clinic would have; most patients paid at the desk that day,
  // insurers three weeks later (the last four weeks still open), one patient in eight still owing.
  const history = await ctx.db
    .selectFrom("pms_appointments")
    .select(["id", "starts_on"])
    .where("tenant_id", "=", tenantId)
    .where("kind", "=", "appointment")
    .where("import_ref", "like", "demo-hist-%")
    .where("status", "in", ["attended", "dna", "late_cancelled"])
    .orderBy("starts_on")
    .orderBy("id")
    .execute();
  const weeks = new Map<string, string[]>();
  for (const a of history) weeks.set(mondayOf(a.starts_on), [...(weeks.get(mondayOf(a.starts_on)) ?? []), a.id]);
  let historyInvoices = 0;
  let w = 0;
  for (const [monday, ids] of Array.from(weeks.entries())) {
    const friday = addDaysIso(monday, 4);
    if (friday >= today) continue;
    const at = new Date(londonToUtcOrThrow(friday, 18 * 60 + 30));
    const weekCtx: RepoContext = { ...base, now: () => at };
    const weekActor: BillingActor = { ...testActor(weekCtx, tenantId, "owner", { userId: SEED_ACTOR.userId, name: "Demonstration data" }), actor: SEED_ACTOR };
    const made: string[] = [];
    for (let i = 0; i < ids.length; i += 40) {
      const chunk = ids.slice(i, i + 40);
      const r = await invoiceVisitsFor(weekActor, { appointmentIds: chunk, issue: true });
      if (r.ok) made.push(...r.value.invoices.map((x) => x.id));
    }
    historyInvoices += made.length;
    const issued = made.length
      ? await ctx.db
          .selectFrom("pms_invoices")
          .select(["id", "patient_id", "bill_to", "payer_referrer_id", "site_id", "total_pence", "paid_pence", "credited_pence"])
          .where("tenant_id", "=", tenantId)
          .where("status", "=", "issued")
          .where("id", "in", made)
          .orderBy("id")
          .execute()
      : [];
    const owed = (x: (typeof issued)[number]) => Number(x.total_pence) - Number(x.paid_pence) - Number(x.credited_pence);
    let n = 0;
    for (const inv of issued.filter((x) => x.bill_to === "patient" && owed(x) > 0)) {
      if (++n % 8 === 0) continue; // still owing
      await recordPayment(weekCtx, tenantId, { payerKind: "patient", patientId: inv.patient_id, receivedOn: friday, method: n % 3 === 0 ? "cash" : "card", amountPence: owed(inv), reference: n % 3 === 0 ? "Cash at the desk" : "Card reader", siteId: inv.site_id, allocations: [{ invoiceId: inv.id, amountPence: owed(inv) }] }, SEED_ACTOR);
      payments += 1;
    }
    const paidOn = addDaysIso(friday, 21);
    if (paidOn <= addDaysIso(today, -7)) {
      const byPayer = new Map<string, typeof issued>();
      for (const inv of issued.filter((x) => x.bill_to === "payer" && x.payer_referrer_id && owed(x) > 0)) byPayer.set(inv.payer_referrer_id as string, [...(byPayer.get(inv.payer_referrer_id as string) ?? []), inv]);
      for (const [payer, list] of Array.from(byPayer.entries())) {
        for (let i = 0; i < list.length; i += 40) {
          const part = list.slice(i, i + 40);
          const allocations = part.map((x) => ({ invoiceId: x.id, amountPence: owed(x) }));
          const ctxPaid: RepoContext = { ...base, now: () => new Date(londonToUtcOrThrow(paidOn, 12 * 60)) };
          await recordPayment(ctxPaid, tenantId, { payerKind: "account", payerReferrerId: payer, receivedOn: paidOn, method: "bank_transfer", amountPence: allocations.reduce((a, x) => a + x.amountPence, 0), reference: `REM-${monday.replace(/-/g, "")}-${++w}`, allocations }, SEED_ACTOR);
          payments += 1;
        }
      }
    }
  }
  invoices += historyInvoices;

  // This week's chargeable visits: invoice (and issue) the older half, take a few payments, leave the rest.
  const visits = await uninvoicedVisitsFor(actor);
  if (visits.ok && visits.value.visits.length) {
    const all = visits.value.visits.slice().sort((a, b) => a.date.localeCompare(b.date) || (a.startTime ?? "").localeCompare(b.startTime ?? ""));
    // Completed visits only: missed and late-cancelled fees stay in "Attended, not invoiced" to show them.
    const chosen = all.slice(0, Math.floor(all.length / 2)).filter((v) => v.chargePence !== null && v.status === "attended");
    for (let i = 0; i < chosen.length; i += 40) {
      const r = await invoiceVisitsFor(actor, { appointmentIds: chosen.slice(i, i + 40).map((v) => v.appointmentId), issue: true });
      if (r.ok) invoices += r.value.invoices.length;
    }
    // Card and cash at the desk for the first few self-pay patients.
    const payers = Array.from(new Set(chosen.filter((v) => v.billTo === "patient" && v.status === "attended").map((v) => v.patientId))).slice(0, 6);
    for (let i = 0; i < payers.length; i++) {
      const patientId = payers[i];
      const owed = await ctx.db
        .selectFrom("pms_invoices")
        .select((eb) => eb.fn.sum<number>(eb(eb("total_pence", "-", eb.ref("paid_pence")), "-", eb.ref("credited_pence"))).as("n"))
        .where("tenant_id", "=", tenantId)
        .where("patient_id", "=", patientId)
        .where("bill_to", "=", "patient")
        .where("status", "=", "issued")
        .executeTakeFirst();
      const amount = Number(owed?.n ?? 0);
      if (amount <= 0) continue;
      const r = await takePaymentFor(actor, { patientId, method: i % 2 === 0 ? "card_now" : "cash", amountPence: i === 3 ? Math.floor(amount / 2) : amount, siteId: site });
      if (r.ok) payments += 1;
    }
  }
  const left = await uninvoicedVisitsFor(actor);
  const uninvoicedLeft = left.ok ? left.value.visits.length : 0;
  log(`Billing: ${invoices} invoices (${historyInvoices} for the past weeks), ${payments} payments, ${uninvoicedLeft} chargeable visits left to invoice (fictional).`);
  return { invoices, historyInvoices, payments, uninvoicedLeft, existed: false };
}
