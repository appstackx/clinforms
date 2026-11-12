import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { ApiKeysSetup } from "@/components/pms/integration/api-keys";
import { requireClinicActor } from "@/server/pms/actor";
import { apiScreenFor, clinicApiAvailable, mayManageApi } from "@/server/pms/integration/api/screen";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "API keys" };

/** The address the clinic's other systems call (this host, HTTPS unless local). */
function apiBase(): string {
  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  const local = /^(localhost|127\.0\.0\.1|[a-z0-9-]+\.localhost)(:\d+)?$/i.test(host);
  const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim() || (local ? "http" : "https");
  return `${proto}://${host}/api/clinic/v1`;
}

/**
 * /app/clinic/setup/api – Set-up → API keys (tracker xt03): the clinic's API on/off, its keys (create – shown once –,
 * rotate, revoke, last used, calls) and the developer docs with examples. The owner only; behind the platform switch
 * CLINFORMS_CLINIC_API=on (off = the 404 page, no navigation entry).
 */
export default async function ApiKeysSetupPage() {
  if (!clinicApiAvailable()) notFound();
  const actor = await requireClinicActor({ permission: "settings.owner" });
  if (!mayManageApi(actor)) notFound();
  const view = await apiScreenFor(actor);
  return <ApiKeysSetup view={view} apiBase={apiBase()} />;
}
