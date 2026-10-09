/**
 * The ClinForms mark – the same glyph as the public website's logo and the app icon (src/app/icon.svg,
 * src/components/marketing/logo.tsx), so the website, sign-in pages, clinic settings and the Studio show
 * one brand. Drawn here because the module may not import host components.
 */
export function BrandMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden focusable="false" data-brand-mark="">
      <rect width="32" height="32" rx="7" fill="#0D9488" />
      <path d="M10 7h9l5 5v13a1 1 0 0 1-1 1H10a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z" fill="#fff" />
      <path d="M19 7v5h5" fill="#99f6e4" />
      <path d="M12 16h8M12 19.5h8M12 23h5" stroke="#0D9488" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
