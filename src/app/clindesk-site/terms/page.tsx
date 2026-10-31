import TermsText from "@/app/(marketing)/terms/page";
import { LegalFrame } from "@/components/clindesk/legal-frame";
import { CLINIC_SYSTEM_NAME } from "@/lib/brand";
import { clindeskMetadata } from "@/lib/clindesk/site";
import { COMPANY } from "@/lib/site";

/** /terms on clindesk.co.uk – the same terms as on clinforms.co.uk (reused, not copied). */
export const metadata = clindeskMetadata({
  path: "/terms",
  title: `Terms – ${CLINIC_SYSTEM_NAME}`,
  description: `The terms on which ${COMPANY.legalName} provides its software to physiotherapy clinics.`,
});

export default function ClindeskTermsPage() {
  return (
    <LegalFrame>
      <TermsText />
    </LegalFrame>
  );
}
