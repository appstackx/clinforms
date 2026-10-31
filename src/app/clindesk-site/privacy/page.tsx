import PrivacyText from "@/app/(marketing)/privacy/page";
import { LegalFrame } from "@/components/clindesk/legal-frame";
import { CLINIC_SYSTEM_NAME } from "@/lib/brand";
import { clindeskMetadata } from "@/lib/clindesk/site";
import { COMPANY } from "@/lib/site";

/** /privacy on clindesk.co.uk – AppstackX's privacy policy, the same text as on clinforms.co.uk (reused, not copied). */
export const metadata = clindeskMetadata({
  path: "/privacy",
  title: `Privacy policy – ${CLINIC_SYSTEM_NAME}`,
  description: `How ${COMPANY.legalName} handles personal data.`,
});

export default function ClindeskPrivacyPage() {
  return (
    <LegalFrame>
      <PrivacyText />
    </LegalFrame>
  );
}
