import type { Metadata } from "next";
import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { PRODUCT } from "@/modules/medreport/config.public";

export const metadata: Metadata = { title: { absolute: `Page not found · ${PRODUCT.name}` } };

/** Any URL outside /reports, /pms-sandbox and the APIs. */
export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 text-slate-900">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-teal-50">
          <FileQuestion className="h-5 w-5 text-teal-700" aria-hidden />
        </span>
        <h1 className="mt-3 text-lg font-semibold">Page not found</h1>
        <p className="mt-1 text-sm text-slate-600">There is nothing at this address.</p>
        <Link
          href="/reports"
          className="mt-5 inline-flex h-9 items-center rounded-lg bg-teal-600 px-4 text-sm font-semibold text-white hover:bg-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
        >
          Open {PRODUCT.name}
        </Link>
      </div>
    </main>
  );
}
