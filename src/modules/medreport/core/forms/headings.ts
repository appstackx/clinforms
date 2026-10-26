/**
 * Referrer forms – headings: each question's section heading for grouping on screen.
 *
 * Pure: no React, no Node built-ins, no env. Split out of core/forms.ts by W0.4 (bh2 module split, pure move; core/forms.ts re-exports it).
 * bh2 W0 follow-up (seam "review-groups", bh2-base2): formOutline – the review screen's grouping of the questions, moved
 * here unchanged from ui/components/review/status.ts buildQuestionGroups, so WE owns the one outline the review and the
 * mapping page share (WE design 4) and WA1's status.ts only builds its questions from it.
 * Owner: WE (data, maps and mapping page) – docs/bh2-ownership.json.
 */
import type { FormField } from "../types";

/**
 * Fix round 1 (B0-21): each question's section heading for grouping on screen. A run of questions the map gives no
 * section takes the heading around it when the questions before and after it share one (10Bridge's address lines
 * between two "CLAIMANT DETAILS" questions); otherwise it keeps none ("" – its own group).
 */
export function sectionHeadings(fields: ReadonlyArray<Pick<FormField, "section">>): string[] {
  const own = fields.map((f) => f.section?.trim() ?? "");
  return own.map((h, i) => {
    if (h) return h;
    let before = "";
    for (let j = i - 1; j >= 0 && !before; j--) before = own[j];
    let after = "";
    for (let j = i + 1; j < own.length && !after; j++) after = own[j];
    return before && before === after ? before : "";
  });
}

/** The title of a run of questions with no heading (the review screen's group; WE design 4: the same on the mapping page). */
export const UNTITLED_HEADING = "Form questions";

/** One group of the outline: its title and its fields (indexes into the field list, in the order they were added). */
export interface FormOutlineGroup {
  title: string;
  entries: Array<{
    /** Index of the field in the form's field list. */
    index: number;
    /** The printed question this field sits under, when its "section" is an earlier question's label ("If modified duties, please give details"). */
    context: string | undefined;
  }>;
}

/**
 * The form's questions, grouped by the form's own headings, in form order. A field whose heading is the label of an
 * earlier question (a sub-question) joins that question's group, with the question as its context; consecutive fields
 * with no heading share one untitled group – unless the fields around them share a heading, which they then take (fix
 * round 1, sectionHeadings).
 */
export function formOutline(fields: ReadonlyArray<Pick<FormField, "section" | "label">>): FormOutlineGroup[] {
  const groups: FormOutlineGroup[] = [];
  const groupOfLabel = new Map<string, FormOutlineGroup>();
  let current: FormOutlineGroup | null = null;
  // Fix round 1 (B0-21): questions with no heading inside a section keep it (sectionHeadings).
  const headings = sectionHeadings(fields);
  fields.forEach((field, i) => {
    const heading = headings[i];
    const parentGroup = heading ? groupOfLabel.get(heading.toLowerCase()) : undefined;
    let group: FormOutlineGroup;
    let context: string | undefined;
    if (parentGroup) {
      group = parentGroup;
      context = heading;
    } else if (heading) {
      group = current && current.title === heading ? current : { title: heading, entries: [] };
    } else {
      group = current && current.title === UNTITLED_HEADING ? current : { title: UNTITLED_HEADING, entries: [] };
    }
    if (groups.indexOf(group) < 0) groups.push(group);
    current = group;
    group.entries.push({ index: i, context });
    groupOfLabel.set(field.label.trim().toLowerCase(), group);
  });
  return groups;
}
