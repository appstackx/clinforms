import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AuthShell, TextLink } from "@/components/account/shell";
import { SIGNUP_COPY } from "@/lib/self-signup";
import { authSecret } from "@/server/auth/config";
import { currentBrand } from "@/server/brand";
import { signupBrandForPage } from "@/server/signup/request";
import { issueFormStamp } from "@/server/signup/self-signup";
import { StartTrialForm } from "./form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Start your free trial" };

/**
 * /start-trial – self-serve sign-up (docs/auth.md §1b). 404 unless CLINFORMS_SELF_SIGNUP is on for this host's brand.
 * The form carries a signed time stamp (minimum fill time, maximum age) and a hidden honeypot field.
 */
export default function StartTrialPage() {
  const brand = signupBrandForPage();
  if (!brand) notFound();
  const shown = currentBrand();
  return (
    <AuthShell
      brand={shown}
      title={SIGNUP_COPY.title}
      subtitle={`Create your clinic's ${shown.productName} account. We will email you a link to confirm your address.`}
      footer={
        <>
          Already have an account? <TextLink href="/login">Sign in</TextLink>
        </>
      }
    >
      <StartTrialForm stamp={issueFormStamp(authSecret(), brand)} />
    </AuthShell>
  );
}
