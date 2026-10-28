/**
 * GET /app/clinic/billing/export?state&q – the invoice list as CSV (reports.export), checked in clinicRoute and again
 * in the billing service; audited with the count and the filters' names. Formula-looking cells are defused.
 */
import { ukToday } from "@/modules/pms/core/text";
import { invoicesCsvFor } from "@/server/pms/billing/views";
import { clinicRoute } from "@/server/pms/http";
import { INVOICE_LIST_STATES, type InvoiceListState } from "@/server/repos/pms/billing/invoices";

export const dynamic = "force-dynamic";

export const GET = clinicRoute({ permission: "reports.export" }, async (req, actor) => {
  const url = new URL(req.url);
  const state = url.searchParams.get("state") ?? "all";
  const result = await invoicesCsvFor(actor, { state: (INVOICE_LIST_STATES as readonly string[]).includes(state) ? (state as InvoiceListState) : "all", q: (url.searchParams.get("q") ?? "").slice(0, 80) });
  if (!result.ok) return Response.json({ error: { code: result.code.toUpperCase(), message: result.error } }, { status: result.code === "forbidden" ? 403 : 400 });
  const body = new TextEncoder().encode(`﻿${result.value.csv}`);
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-length": String(body.byteLength),
      "content-disposition": `attachment; filename="invoices-${ukToday()}.csv"`,
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
    },
  });
});
