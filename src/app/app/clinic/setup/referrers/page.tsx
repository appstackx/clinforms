import { ReferrersSetup } from "@/components/pms/reporting/setup-pages";
import { REFERRER_KINDS } from "@/modules/pms/core/schemas";
import { requireClinicActor } from "@/server/pms/actor";
import { referrersScreenFor } from "@/server/pms/reporting/setup";
import { gatedMetadata } from "@/server/pms/page-gate";

export const dynamic = "force-dynamic";
export const generateMetadata = gatedMetadata({ title: "Referrers and insurers" }, "settings.setup");

/**
 * /app/clinic/setup/referrers[?kind=&referrer=] – Set-up → Referrers and insurers (settings.setup): the directory and,
 * for payer accounts, how the patient's part is billed (excess per case / patient contribution per visit), payment
 * terms and price lists.
 */
export default async function ReferrersSetupPage({ searchParams }: { searchParams: { kind?: string; referrer?: string } }) {
  const actor = await requireClinicActor({ permission: "settings.setup" });
  const kind = searchParams.kind && (REFERRER_KINDS as readonly string[]).includes(searchParams.kind) ? searchParams.kind : null;
  const isNew = searchParams.referrer === "new";
  const r = await referrersScreenFor(actor, isNew ? null : (searchParams.referrer ?? null), kind);
  if (!r.ok) return <p role="alert">{r.error}</p>;
  return <ReferrersSetup screen={r.value} isNew={isNew || r.value.referrers.length === 0} kind={kind} />;
}
