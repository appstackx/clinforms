/**
 * POST /app/clinic/billing/claims/file – the insurer claims file (CSV) for one payer account and invoice dates, from
 * the Claims screen's form. billing.view + reports.export (clinicRoute and again in the service); same origin only.
 * The invoices are read on the server; each one is logged as sent with its audit row. Formula cells are defused.
 */
import { claimsFileFor } from "@/server/pms/billing/claims";
import { clinicRoute } from "@/server/pms/http";

export const dynamic = "force-dynamic";

export const POST = clinicRoute({ permission: "reports.export" }, async (req, actor) => {
  const form = await req.formData();
  const text = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" ? v.slice(0, 80) : "";
  };
  const result = await claimsFileFor(actor, { payerReferrerId: text("payerReferrerId"), from: text("from"), until: text("until"), includeSent: text("includeSent") === "1" });
  if (!result.ok) return Response.json({ error: { code: result.code.toUpperCase(), message: result.error } }, { status: result.code === "forbidden" ? 403 : result.code === "not_found" ? 404 : 400 });
  const body = new TextEncoder().encode(`﻿${result.value.body}`);
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": result.value.contentType,
      "content-length": String(body.byteLength),
      "content-disposition": `attachment; filename="${result.value.name.replace(/[^A-Za-z0-9._-]/g, "")}"`,
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
    },
  });
});
