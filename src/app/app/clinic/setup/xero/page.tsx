import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { XeroSetup } from "@/components/pms/integration/xero-setup";
import { connectErrorText } from "@/modules/pms/integration/xero";
import { requireClinicActor } from "@/server/pms/actor";
import { xeroAvailable, xeroClientFromEnv } from "@/server/pms/integration/xero/config";
import { mayManageXero, xeroScreenFor } from "@/server/pms/integration/xero/screen";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Xero" };

/**
 * /app/clinic/setup/xero – Set-up → Xero (xe03–xe05): the clinic's switch, connect / disconnect, the account and tax
 * mapping, the "send from" date and the send list with Retry / Skip. Owners and admins only; behind the platform
 * switch CLINFORMS_XERO=on (off = the 404 page, no navigation entry).
 */
export default async function XeroSetupPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  if (!xeroAvailable()) notFound();
  const actor = await requireClinicActor({ permission: "settings.setup" });
  if (!mayManageXero(actor)) notFound();
  const h = headers();
  const view = await xeroScreenFor(actor, xeroClientFromEnv(), h.get("x-forwarded-host") ?? h.get("host"));
  const error = typeof searchParams?.error === "string" ? connectErrorText(searchParams.error) : null;
  const connected = searchParams?.connected === "1";
  return <XeroSetup view={view} notice={error ? { tone: "error", text: error } : connected ? { tone: "success", text: `Connected to ${view.connection.orgName ?? "Xero"}.` } : null} />;
}
