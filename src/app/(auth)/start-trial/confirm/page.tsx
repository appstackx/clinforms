import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AuthShell, Notice, TextLink } from "@/components/account/shell";
import { BRANDS } from "@/lib/brand";
import { SIGNUP_COPY, SIGNUP_CONFIRM_PATH, SIGNUP_PATH } from "@/lib/self-signup";
import { baseUrlSetting, brandOrigin } from "@/server/auth/config";
import { getDb } from "@/server/db";
import { ukDateTime } from "@/server/email/templates";
import { currentBrand } from "@/server/brand";
import { signupBrandForPage, signupHostServedForPage } from "@/server/signup/request";
import { viewSignupLink } from "@/server/signup/self-signup";
import { ConfirmTrialForm } from "./form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Confirm your email" };

/**
 * /start-trial/confirm?token=… – the emailed one-time link (docs/auth.md §1b). Opening it changes nothing (mail
 * scanners open links): the clinic is created only when the person types the password chosen at sign-up and submits.
 */
export default async function ConfirmTrialPage({ searchParams }: { searchParams: { token?: string } }) {
  const brand = signupBrandForPage();
  if (!brand) notFound();
  const shown = currentBrand();
  const token = String(searchParams.token ?? "");
  const view = await viewSignupLink(getDb(), token, brand);
  if (view.kind === "wrong_host" && !signupHostServedForPage(view.brand)) {
    // The link's brand host is not served here: "continue there" would come straight back to this page (a loop).
    return (
      <AuthShell brand={shown} title="Link not available" footer={<TextLink href="/login">Sign in</TextLink>}>
        <Notice tone="warning">
          This link belongs to {BRANDS[view.brand].productName}. {SIGNUP_COPY.hostNotServed}
        </Notice>
      </AuthShell>
    );
  }
  if (view.kind === "wrong_host") {
    const origin = brandOrigin(baseUrlSetting(), view.brand);
    return (
      <AuthShell brand={shown} title="Open the link from your email">
        <Notice tone="warning">
          This link belongs to {BRANDS[view.brand].productName}.{" "}
          <a className="font-medium underline" href={`${origin}${SIGNUP_CONFIRM_PATH}?token=${encodeURIComponent(token)}`}>
            Continue there
          </a>
          .
        </Notice>
      </AuthShell>
    );
  }
  if (view.kind !== "ok") {
    return (
      <AuthShell brand={shown} title="Link not available" footer={<TextLink href="/login">Sign in</TextLink>}>
        <Notice tone="warning">{SIGNUP_COPY.linkInvalid}</Notice>
        <p className="mt-4 text-sm">
          <TextLink href={SIGNUP_PATH}>Start again</TextLink>
        </p>
      </AuthShell>
    );
  }
  return (
    <AuthShell brand={shown} title="Confirm your email and create your clinic">
      <p className="mb-4 text-sm text-slate-700">
        You are creating <strong>{view.clinicName}</strong> on {shown.productName} for <strong>{view.email}</strong>. Enter the password you chose
        when you signed up. This link works once and expires on {ukDateTime(view.expiresAt)}.
      </p>
      <ConfirmTrialForm token={token} email={view.email} />
    </AuthShell>
  );
}
