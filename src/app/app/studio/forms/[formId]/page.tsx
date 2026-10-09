import type { Metadata } from "next";
import { FormMappingScreen } from "@/modules/medreport/ui/screens/forms/form-mapping-screen";

export const metadata: Metadata = { title: "Review form mapping" };

/** One of the clinic's form maps (the client loads it from the clinic's store). */
export default function TenantFormMappingPage({ params }: { params: { formId: string } }) {
  let formId = params.formId;
  try {
    formId = decodeURIComponent(formId);
  } catch {
    // already decoded
  }
  return <FormMappingScreen formId={formId} />;
}
