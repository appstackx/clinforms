import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AuthShell } from "@/components/account/shell";
import { authSecret } from "@/server/auth/config";
import { currentBrand } from "@/server/brand";
import { checkStopTips } from "@/server/trial/emails";
import { StopTipsForm } from "./form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Stop tips emails", robots: { index: false, follow: false } };

/**
 * /trial/stop-tips?c=<clinic>&t=<signature> – the "Stop these tips emails" link in the trial's welcome and tips emails
 * (src/server/trial/emails.ts). Opening it changes nothing (mail scanners open links): the button does. Without a valid
 * signature the page does not exist (404) – nothing new is reachable while self sign-up is off.
 */
export default function StopTipsPage({ searchParams }: { searchParams: { c?: string; t?: string } }) {
  const c = String(searchParams.c ?? "").slice(0, 80);
  const t = String(searchParams.t ?? "").slice(0, 80);
  let valid = false;
  try {
    valid = checkStopTips(authSecret(), c, t);
  } catch {
    valid = false;
  }
  if (!valid) notFound();
  return (
    <AuthShell brand={currentBrand()} title="Stop tips emails" subtitle="Stop the tips we send during your free trial. Emails about your account itself still arrive.">
      <StopTipsForm c={c} t={t} />
    </AuthShell>
  );
}
