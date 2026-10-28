import type { Metadata } from "next";
import { ImportPlaceholder } from "@/components/pms/reporting/setup-pages";
import { requireClinicActor } from "@/server/pms/actor";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Import data" };

/** /app/clinic/setup/import – Set-up → Import data (settings.import): placeholder until the import (M9). */
export default async function ImportSetupPage() {
  await requireClinicActor({ permission: "settings.import" });
  return <ImportPlaceholder />;
}
