/** The trial banner of the clinic area and the clinic's Studio (server-safe; wording in src/lib/trial-copy.ts). */
import { COMPANY } from "@/lib/site";
import { trialBanner, type TrialBannerState } from "@/lib/trial-copy";
import { cn } from "@/lib/utils";

/** `contactEmail`: the host brand's contact (src/lib/brand.ts – the layouts pass currentBrand()'s); default ClinForms'. */
export function TrialBannerBar({
  access,
  className,
  contactEmail = COMPANY.contactEmail,
}: {
  access: TrialBannerState | null | undefined;
  className?: string;
  contactEmail?: string;
}) {
  const banner = trialBanner(access, contactEmail);
  if (!banner) return null;
  const [before, after] = banner.text.split(contactEmail);
  return (
    <div
      role="status"
      data-testid="trial-banner"
      className={cn(
        "border-b px-4 py-2 text-center text-sm",
        banner.tone === "warning" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-teal-200 bg-teal-50 text-teal-900",
        className,
      )}
    >
      {after !== undefined ? (
        <>
          {before}
          <a href={`mailto:${contactEmail}`} className="font-medium underline underline-offset-2">
            {contactEmail}
          </a>
          {after}
        </>
      ) : (
        banner.text
      )}
      {banner.link ? (
        <>
          {" "}
          <a href={banner.link.href} className="font-medium underline underline-offset-2" data-testid="trial-banner-plan">
            {banner.link.label}
          </a>
        </>
      ) : null}
    </div>
  );
}
