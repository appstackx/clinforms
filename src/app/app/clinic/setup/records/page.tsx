import { RecordsSetup } from "@/components/pms/reporting/setup-pages";
import { requireClinicActor } from "@/server/pms/actor";
import { recordsScreenFor } from "@/server/pms/reporting/setup";
import { gatedMetadata } from "@/server/pms/page-gate";

export const dynamic = "force-dynamic";
export const generateMetadata = gatedMetadata({ title: "Record templates" }, "settings.setup");

/** /app/clinic/setup/records – Set-up → Record templates: the note templates (editor at /patients/note-templates) and record keeping. */
export default async function RecordsSetupPage() {
  const actor = await requireClinicActor({ permission: "settings.setup" });
  const r = await recordsScreenFor(actor);
  if (!r.ok) return <p role="alert">{r.error}</p>;
  return <RecordsSetup templates={r.value.templates} settings={r.value.settings} />;
}
