import Link from "next/link";
import { PRODUCT } from "@/modules/medreport/config.public";

/** The ClinForms mark (same glyph as src/app/icon.svg) and name, linking home. */
export function LogoMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden focusable="false">
      <rect width="32" height="32" rx="7" fill="#0D9488" />
      <path d="M10 7h9l5 5v13a1 1 0 0 1-1 1H10a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z" fill="#fff" />
      <path d="M19 7v5h5" fill="#99f6e4" />
      <path d="M12 16h8M12 19.5h8M12 23h5" stroke="#0D9488" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function Logo() {
  return (
    <Link
      href="/"
      className="flex items-center gap-2 rounded-lg text-lg font-semibold tracking-tight text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2"
    >
      <LogoMark />
      <span>{PRODUCT.name}</span>
    </Link>
  );
}
