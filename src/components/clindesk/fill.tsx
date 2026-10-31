import { contentText, type ClindeskContentKey } from "@/lib/clindesk/content";

/**
 * One fill-in from content/clindesk-site.json. Filled: the value as plain text (with `className`, if given). Not
 * filled yet: a visible bracketed marker in the design's placeholder style (`.ph`) – the placeholder as written in
 * drafts, "[to confirm]" in production – and `data-to-confirm` names the key (tests and the go-live check use it).
 */
export function Fill({ k, className }: { k: ClindeskContentKey; className?: string }) {
  const t = contentText(k);
  if (t.filled) return className ? <span className={className}>{t.text}</span> : <>{t.text}</>;
  return (
    <span className={className ? `ph ${className}` : "ph"} data-to-confirm={k}>
      {t.text}
    </span>
  );
}
