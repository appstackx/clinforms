/** The trial banner of the clinic area and the clinic's Studio (server-safe; wording in src/lib/trial-copy.ts). */
import { COMPANY } from "@/lib/site";
import { trialBanner, type TrialBannerState } from "@/lib/trial-copy";
import { cn } from "@/lib/utils";

export function TrialBannerBar({ access, className }: { access: TrialBannerState | null | undefined; className?: string }) {
  const banner = trialBanner(access, COMPANY.contactEmail);
  if (!banner) return null;
  const [before, after] = banner.text.split(COMPANY.contactEmail);
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
          <a href={`mailto:${COMPANY.contactEmail}`} className="font-medium underline underline-offset-2">
            {COMPANY.contactEmail}
          </a>
          {after}
        </>
      ) : (
        banner.text
      )}
    </div>
  );
}
