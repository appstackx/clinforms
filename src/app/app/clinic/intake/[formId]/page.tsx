import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { IntakeBuilder } from "@/components/pms/portal/intake-builder";
import { requireClinicActor } from "@/server/pms/actor";
import { intakeFormFor } from "@/server/pms/portal/staff";
import { saveIntakeFormAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Form builder" };

/** /app/clinic/intake/<form> – the form builder (design round 3 "Intake forms – builder"), settings.setup. */
export default async function IntakeBuilderPage({ params }: { params: { formId: string } }) {
  const actor = await requireClinicActor({ permission: "settings.setup" });
  const r = await intakeFormFor(actor, params.formId);
  if (!r.ok) notFound();
  return <IntakeBuilder template={r.value} save={saveIntakeFormAction} />;
}
