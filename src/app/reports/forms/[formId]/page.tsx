import type { Metadata } from "next";
import { FormMappingScreen } from "@/modules/medreport/ui/screens/forms/form-mapping-screen";

export const metadata: Metadata = { title: "Review form mapping" };

/** Form maps live in the browser, so the server only passes the ID. Owner: studio-a agent. */
export default function FormMappingPage({ params }: { params: { formId: string } }) {
  let formId = params.formId;
  try {
    formId = decodeURIComponent(formId);
  } catch {
    // already decoded
  }
  return <FormMappingScreen formId={formId} />;
}
