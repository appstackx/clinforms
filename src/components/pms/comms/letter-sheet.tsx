/**
 * The A4 letter (design round 3, letter editor "A4 preview" and the print page): the clinic's name and address, the
 * date, the recipient's address block, "Re:" line, the body (blank lines = paragraphs, "- " lines = bullets), the
 * signature line. Plain markup – the print stylesheet (LETTER_PRINT_CSS) prints only this sheet on A4.
 */
import { formatUkDate } from "@/modules/pms/core/text";

export const LETTER_PRINT_CSS = `
@page { size: A4; margin: 0; }
@media print {
  body * { visibility: hidden !important; }
  .letter-print-root, .letter-print-root * { visibility: visible !important; }
  .letter-print-root { position: absolute; left: 0; top: 0; width: 210mm; }
  .letter-print-root .letter-sheet { box-shadow: none !important; margin: 0 !important; }
  .print-toolbar { display: none !important; }
}`;

function Body({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <>
      {blocks.map((b, i) => {
        const lines = b.split("\n");
        if (lines.every((l) => /^\s*[-•]\s+/.test(l))) {
          return (
            <ul key={i} className="my-2 list-disc pl-5">
              {lines.map((l, j) => (
                <li key={j}>{l.replace(/^\s*[-•]\s+/, "")}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className="my-2 whitespace-pre-wrap">
            {b}
          </p>
        );
      })}
    </>
  );
}

export interface LetterSheetProps {
  clinic: { name: string; lines: string[]; phone: string | null };
  letterOn: string;
  recipient: { name: string | null; address: string[] | null; postcode: string | null };
  subject: string;
  body: string;
  signature: string | null;
  draft: boolean;
  withdrawn?: boolean;
}

export function LetterSheet(p: LetterSheetProps) {
  return (
    <article className="letter-sheet relative mx-auto flex min-h-[297mm] w-[210mm] flex-col bg-white px-[20mm] py-[18mm] text-[11pt] leading-[1.45] text-[#0f172a] shadow-[0_8px_24px_rgba(15,23,42,0.12)]" data-testid="letter-sheet">
      {p.draft || p.withdrawn ? (
        <span aria-hidden className="pointer-events-none absolute right-[20mm] top-[8mm] rounded border border-[#CBD5E1] px-2 text-[9pt] font-semibold uppercase tracking-wide text-[#64748B]">
          {p.withdrawn ? "Withdrawn" : "Draft – not signed"}
        </span>
      ) : null}
      <header className="flex justify-between gap-6">
        <div>
          <strong className="block text-[12pt]">{p.clinic.name}</strong>
          {p.clinic.lines.map((l) => (
            <span key={l} className="block text-[9.5pt] text-[#334155]">
              {l}
            </span>
          ))}
          {p.clinic.phone ? <span className="block text-[9.5pt] text-[#334155]">{p.clinic.phone}</span> : null}
        </div>
        <span className="whitespace-nowrap text-[10pt]">{formatUkDate(p.letterOn)}</span>
      </header>
      <address className="mt-[12mm] not-italic">
        {[p.recipient.name, ...(p.recipient.address ?? []), p.recipient.postcode].filter(Boolean).map((l, i) => (
          <span key={i} className="block">
            {l}
          </span>
        ))}
      </address>
      <strong className="mt-[10mm] block">{p.subject}</strong>
      <div className="mt-2 flex-1">
        <Body text={p.body} />
      </div>
      {p.signature ? (
        <footer className="mt-6 border-t border-[#E2E8F0] pt-3 text-[10pt]" data-testid="letter-signature">
          <span className="block font-[cursive] text-[15pt] text-[#0f172a]">{p.signature.split(",")[0]}</span>
          <span className="block text-[#334155]">{p.signature}</span>
          <span className="block text-[8.5pt] text-[#64748B]">Signed electronically</span>
        </footer>
      ) : null}
      <span className="mt-6 border-t border-[#E2E8F0] pt-2 text-[8pt] text-[#64748B]">{p.clinic.name}</span>
    </article>
  );
}
