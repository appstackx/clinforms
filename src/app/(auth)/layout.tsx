import type { Metadata } from "next";

/** Sign-in pages (/login, /two-factor, /accept-invite, /reset-password): never indexed. */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return children;
}
