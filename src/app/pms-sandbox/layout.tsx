import type { Metadata } from "next";
import { PRODUCT } from "@/modules/medreport/config.public";
import { SANDBOX_LABEL } from "@/sandbox/tm3-sim/config";
import { SandboxShell } from "@/sandbox/tm3-sim/ui/sandbox-shell";

const NAME = "Simulated TM3 sandbox";
const description = `${SANDBOX_LABEL}. Fictional patients for demonstrating ${PRODUCT.name}.`;

/** Slate/blue flask glyph as an inline SVG (no public/ asset needed). */
const ICON =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iNyIgZmlsbD0iIzFlMjkzYiIvPjxwYXRoIGQ9Ik0xMyA3aDZNMTQgN3Y3bC01IDlhMiAyIDAgMCAwIDEuOCAzaDEwLjRhMiAyIDAgMCAwIDEuOC0zbC01LTlWNyIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjN2RkM2ZjIiBzdHJva2Utd2lkdGg9IjEuOCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIi8+PHBhdGggZD0iTTExLjUgMjBoOSIgc3Ryb2tlPSIjN2RkM2ZjIiBzdHJva2Utd2lkdGg9IjEuOCIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIi8+PC9zdmc+";

export const metadata: Metadata = {
  title: { default: NAME, template: `%s · ${NAME}` },
  description,
  applicationName: NAME,
  robots: { index: false, follow: false },
  openGraph: {
    title: NAME,
    description,
    url: "/pms-sandbox",
    siteName: NAME,
    locale: "en_GB",
    type: "website",
  },
  twitter: { card: "summary", title: NAME, description },
  icons: { icon: [{ url: ICON, type: "image/svg+xml" }] },
};

/**
 * /pms-sandbox – simulated clinic system (demo scaffolding, NOT the product, not affiliated with TM3).
 */
export default function PmsSandboxLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <SandboxShell>{children}</SandboxShell>
    </div>
  );
}
