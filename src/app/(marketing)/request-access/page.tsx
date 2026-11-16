import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { COMPANY } from "@/lib/site";
import { PRODUCT } from "@/modules/medreport/config.public";
import { RequestAccessForm } from "./request-access-form";
import { ProseFrame } from "@/components/marketing/prose-frame";

const TITLE = "Request access";
const DESCRIPTION = `Ask for ${PRODUCT.name} for your physiotherapy clinic. Tell us about your clinic and the referrers' forms you receive, and we will be in touch.`;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/request-access" },
  openGraph: { title: `${TITLE} · ${PRODUCT.name}`, description: DESCRIPTION, url: "/request-access", siteName: PRODUCT.name, locale: "en_GB", type: "website" },
};

export default function RequestAccessPage() {
  return (
    <ProseFrame>
    <div className="bg-gradient-to-b from-teal-50/60 via-white to-white">
      <div className="mx-auto grid max-w-6xl gap-12 px-4 py-12 sm:px-6 sm:py-16 lg:grid-cols-[1fr_1.15fr] lg:gap-16 lg:px-8">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">Request access</h1>
          <p className="mt-4 text-lg leading-8 text-slate-600">
            {PRODUCT.name} is available to UK physiotherapy clinics by invitation. Tell us a little about your clinic and
            we will get in touch.
          </p>
          <div className="mt-10 flex gap-3 rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
            <ShieldCheck className="h-5 w-5 shrink-0 text-teal-700" aria-hidden />
            <p>
              We use these details only to reply to your request. See our{" "}
              <Link href="/privacy" className="font-medium text-teal-800 underline underline-offset-2">
                privacy policy
              </Link>
              . Prefer email? Write to{" "}
              <a href={`mailto:${COMPANY.contactEmail}`} className="font-medium text-teal-800 underline underline-offset-2">
                {COMPANY.contactEmail}
              </a>
              .
            </p>
          </div>
        </div>
        <RequestAccessForm />
      </div>
    </div>
    </ProseFrame>
  );
}
