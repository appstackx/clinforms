import type { Metadata } from "next";
import { PRODUCT } from "@/modules/medreport/config.public";
import { StudioShell } from "@/modules/medreport/ui/components/shared/studio-shell";
import { MedreportHost } from "./medreport-host";

const description = `${PRODUCT.tagline}. Demo with fictional data.`;

/** Teal report glyph as an inline SVG (no public/ asset needed). */
const ICON =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iNyIgZmlsbD0iIzBEOTQ4OCIvPjxwYXRoIGQ9Ik0xMCA3aDlsNSA1djEzYTEgMSAwIDAgMS0xIDFIMTBhMSAxIDAgMCAxLTEtMVY4YTEgMSAwIDAgMSAxLTF6IiBmaWxsPSIjZmZmIi8+PHBhdGggZD0iTTE5IDd2NWg1IiBmaWxsPSIjOTlmNmU0Ii8+PHBhdGggZD0iTTEyIDE2aDhNMTIgMTkuNWg4TTEyIDIzaDUiIHN0cm9rZT0iIzBEOTQ4OCIgc3Ryb2tlLXdpZHRoPSIxLjYiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPjwvc3ZnPg==";

export const metadata: Metadata = {
  title: { default: PRODUCT.name, template: `%s · ${PRODUCT.name}` },
  description,
  applicationName: PRODUCT.name,
  authors: [{ name: PRODUCT.vendor, url: "https://appstackx.co.uk" }],
  keywords: ["medico-legal report", "physiotherapy", "treating physiotherapist report", "fitness for work", "TM3"],
  robots: { index: false, follow: false },
  openGraph: {
    title: PRODUCT.name,
    description,
    url: "/reports",
    siteName: PRODUCT.name,
    locale: "en_GB",
    type: "website",
  },
  twitter: { card: "summary", title: PRODUCT.name, description },
  icons: { icon: [{ url: ICON, type: "image/svg+xml" }] },
};

/**
 * /reports – the Studio. The studio chrome lives in ui/components/shared/studio-shell.tsx (studio-a).
 * Orchestrator-owned.
 */
export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <MedreportHost>
        <StudioShell>{children}</StudioShell>
      </MedreportHost>
    </div>
  );
}
