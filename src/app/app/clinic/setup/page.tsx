import { redirect } from "next/navigation";
import { SETUP_ORDER } from "@/components/pms/shell/nav-model";
import { navAllowed } from "@/modules/pms/core/nav";
import { PMS_NAV } from "@/modules/pms/nav";
import { requireClinicActor } from "@/server/pms/actor";
import { canOpenSetup } from "@/server/pms/reporting/setup";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * /app/clinic/setup – Set-up's start: the first set-up page (design order) this member may open. Also run in
 * generateMetadata, so the redirect (or the 404) is answered before the loading skeleton streams.
 */
async function openFirstSetupPage(): Promise<never> {
  const actor = await requireClinicActor();
  if (!canOpenSetup(actor)) notFound();
  const allowed = PMS_NAV.filter((e) => e.group === "manage" && navAllowed(e, actor.can) && e.id !== "diary.rotas");
  const first = SETUP_ORDER.map((id) => allowed.find((e) => e.id === id)).find(Boolean) ?? allowed[0];
  if (!first) notFound();
  redirect(first.href);
}

export const generateMetadata = openFirstSetupPage;

export default async function SetupStartPage() {
  return openFirstSetupPage();
}
