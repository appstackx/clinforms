import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SignedFormView } from "@/components/pms/portal/signed-form-view";
import { formatWhen } from "@/modules/pms/portal/time";
import { requireClinicActor } from "@/server/pms/actor";
import { patientOr404 } from "@/server/pms/records/record";
import { patientResponseFor } from "@/server/pms/portal/staff";
import { applyResponseAction, reviewResponseAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Signed form" };

/**
 * One form on the record (design round 3 "Intake forms – signed copy on the record"): "Signed and sealed", the answers
 * (health answers shown only with clinical.view – reception gets "N health answers are only shown to clinicians"),
 * the signature panel with the seal's fingerprint, Mark checked, copy details to the record.
 */
export default async function PatientFormPage({ params }: { params: { patientId: string; responseId: string } }) {
  const actor = await requireClinicActor({ permission: "patients.view" });
  const patient = await patientOr404(actor, params.patientId);
  const r = await patientResponseFor(actor, patient.id, params.responseId);
  if (!r.ok) notFound();
  const v = r.value;
  const resp = v.response;
  return (
    <SignedFormView
      patientId={patient.id}
      patientName={`${patient.firstName} ${patient.lastName}`}
      name={resp.name}
      version={resp.templateVersion}
      status={resp.status}
      answers={v.answers.filter((a) => a.field.type !== "heading").map((a) => ({ id: a.field.id, q: a.field.label, clinical: Boolean(a.field.sensitive), value: a.value === "hidden" ? null : a.value, type: a.field.type, hidden: a.value === "hidden" }))}
      hiddenCount={v.hiddenCount}
      signature={resp.signatureName && resp.signedAt ? { name: resp.signatureName, at: formatWhen(resp.signedAt), via: resp.trust === "verified" ? "Patient portal, signed in by email link" : "Booking link (not signed in) – check at the first visit" } : null}
      submittedAt={resp.submittedAt ? formatWhen(resp.submittedAt) : null}
      fingerprint={resp.contentSha256 ? resp.contentSha256.slice(0, 24).replace(/(.{4})/g, "$1 ").trim() : null}
      sealIntact={v.sealIntact}
      reviewedAt={resp.reviewedAt ? formatWhen(resp.reviewedAt) : null}
      appliedAt={resp.appliedAt ? formatWhen(resp.appliedAt) : null}
      updates={v.updates}
      canApply={v.canApply}
      review={reviewResponseAction.bind(null, patient.id, resp.id)}
      apply={applyResponseAction.bind(null, patient.id, resp.id)}
    />
  );
}
