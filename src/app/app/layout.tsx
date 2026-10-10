import type { Metadata } from "next";

/**
 * /app – the signed-in clinic area. Every page and server action checks the session, two-step verification
 * and clinic membership itself (src/server/auth/session.ts); the Edge middleware only redirects requests
 * without a session cookie.
 */
export const metadata: Metadata = {
  title: { default: "Clinic", template: "%s · ClinForms" },
  robots: { index: false, follow: false },
};

export default function AppAreaLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-slate-50 text-slate-900">{children}</div>;
}
