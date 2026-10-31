import CookiesText from "@/app/(marketing)/cookies/page";
import { LegalFrame } from "@/components/clindesk/legal-frame";
import { CLINIC_SYSTEM_NAME } from "@/lib/brand";
import { clindeskMetadata } from "@/lib/clindesk/site";

/**
 * /cookies on clindesk.co.uk – the same cookie policy as on clinforms.co.uk (reused, not copied). ClinDesk's hosts run
 * no analytics (src/lib/brand.ts), so its "Cookie settings" dialog says the site does not use analytics.
 */
export const metadata = clindeskMetadata({
  path: "/cookies",
  title: `Cookie policy – ${CLINIC_SYSTEM_NAME}`,
  description: "The cookies and browser storage this website and the application use.",
});

export default function ClindeskCookiesPage() {
  return (
    <LegalFrame>
      <CookiesText />
    </LegalFrame>
  );
}
