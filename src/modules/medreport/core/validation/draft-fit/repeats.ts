/**
 * DRAFT_FIT part "repeat" (B0-16): a numbered row (Activity 2) that repeats an earlier row of the same table (Activity
 * 1).
 *
 * Split out of core/validation/draft-fit.ts by W0.4 (bh2 module split): the same check, moved; draft-fit.ts runs the parts.
 * Owner: WD (drafting and text edits) – docs/bh2-ownership.json.
 */
import type { ReportFlag } from "../../types";
import { makeFlag } from "../context";
import type { DraftFitPart } from "../draft-fit";
import type { ValidatorInput } from "../registry";
import { words } from "./shorten";

/** Two row answers that say the same thing: one's words all in the other's, or most of them shared. */
function repeats(a: string, b: string): boolean {
  const wa = new Set(words(a).filter((w) => w.length > 2));
  const wb = new Set(words(b).filter((w) => w.length > 2));
  if (wa.size === 0 || wb.size === 0) return false;
  const shared = Array.from(wa).filter((w) => wb.has(w)).length;
  return shared === Math.min(wa.size, wb.size) || shared / Math.max(wa.size, wb.size) >= 0.6;
}

export function repeatsPart(input: ValidatorInput): DraftFitPart {
  const flags: ReportFlag[] = [];
  const firstText = new Map<string, string>();
  return {
    paragraph(p, section) {
      // Rows are compared on printed answers only (a yes/no, date or choice prints its value, not its supporting text).
      const printed = !section.answer || section.answer.kind === "text";
      if (printed && section.paragraphs[0] === p && !firstText.has(section.key)) firstText.set(section.key, p.text);
      return [];
    },
    finish() {
      // Numbered rows of one table: "Activity 2" repeating "Activity 1" (same words before and after the number).
      const rows = new Map<string, Array<{ key: string; n: number; title: string }>>();
      for (const s of input.report.sections ?? []) {
        const m = /^(.*?)(\d+)(\D*)$/.exec(s.title.trim());
        if (!m || !firstText.has(s.key)) continue;
        const id = `${m[1]}#${m[3]}`;
        rows.set(id, [...(rows.get(id) ?? []), { key: s.key, n: Number(m[2]), title: s.title.trim() }]);
      }
      rows.forEach((list) => {
        list.sort((a, b) => a.n - b.n);
        list.forEach((row, i) => {
          const earlier = list.slice(0, i).find((r) => repeats(firstText.get(r.key) ?? "", firstText.get(row.key) ?? ""));
          if (!earlier) return;
          const p = (input.report.sections ?? []).find((s) => s.key === row.key)?.paragraphs[0];
          flags.push(
            makeFlag({
              code: "DRAFT_FIT",
              severity: "warning",
              sectionKey: row.key,
              ...(p && { paragraphId: p.id }),
              evidence: `repeat ${earlier.key}`,
              message: `This repeats “${earlier.title}” (${earlier.key}) – give the next item the notes record, or leave it blank.`,
            }),
          );
        });
      });
      return flags;
    },
  };
}
