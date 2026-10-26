/**
 * Referrer forms – headings: each question's section heading, and the one outline both screens group the questions by.
 *
 * Pure: no React, no Node built-ins, no env. Split out of core/forms.ts by W0.4 (bh2 module split, pure move; core/forms.ts re-exports it).
 * bh2 W0 follow-up (seam "review-groups", bh2-base2): formOutline – the review screen's grouping of the questions, moved
 * here from ui/components/review/status.ts buildQuestionGroups.
 * bh2 WE design 4 (B0-21, B1-18, B2-29, B3-17, D-10): the stored map is the single source of truth for headings – the
 * review AND the mapping page group by formOutline, so both show the same groups, ids and titles:
 * - a map that gives headings is grouped by its own headings, exactly as stored (the data supplies complete sections:
 *   the map lint L7 checks them when ClinForms prepares a map); the only inference left is round 1's narrow fill
 *   (B0-21: a run with no heading between two questions of one heading takes it);
 * - a run with no heading is UNTITLED_HEADING on both screens;
 * - a map that gives no headings at all (Bodycare, a portal question set) is one group with no title – never split
 *   into "Form questions / Sign-off / Form questions" (B3-17) and never headed "Other questions" (B2-29).
 * The carry rules of fix rounds 2–3 (a later untitled run continuing the heading above it; a sign-off group) are not
 * used: they guessed headings the map did not give, and each round mis-grouped another form (B2-29, B3-17).
 * Owner: WE (data, maps and mapping page) – docs/bh2-ownership.json.
 */
import type { FormField } from "../types";

/**
 * Fix round 1 (B0-21): each question's section heading for grouping on screen. A run of questions the map gives no
 * section takes the heading around it when the questions before and after it share one (10Bridge's address lines
 * between two "CLAIMANT DETAILS" questions); otherwise it keeps none ("" – its own group).
 */
export function sectionHeadings(fields: ReadonlyArray<Pick<FormField, "section">>): string[] {
  const own = fields.map((f) => (typeof f.section === "string" ? f.section.trim() : ""));
  return own.map((h, i) => {
    if (h) return h;
    let before = "";
    for (let j = i - 1; j >= 0 && !before; j--) before = own[j];
    let after = "";
    for (let j = i + 1; j < own.length && !after; j++) after = own[j];
    return before && before === after ? before : "";
  });
}

/** The title of a run of questions with no heading, on a form that prints headings (the same on both screens). */
export const UNTITLED_HEADING = "Form questions";

/** Whether the map gives any heading at all (a form that prints none is one untitled group). */
export function mapGivesHeadings(fields: ReadonlyArray<Pick<FormField, "section">>): boolean {
  return fields.some((f) => typeof f.section === "string" && f.section.trim() !== "");
}

/** One group of the outline: its title and its fields (indexes into the field list, in the order they were added). */
export interface FormOutlineGroup {
  /** The form's own heading; UNTITLED_HEADING for a run without one; "" when the form prints no headings at all. */
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
 * round 1, sectionHeadings). A map with no headings at all is one group titled "".
 */
export function formOutline(fields: ReadonlyArray<Pick<FormField, "section" | "label">>): FormOutlineGroup[] {
  const groups: FormOutlineGroup[] = [];
  const groupOfLabel = new Map<string, FormOutlineGroup>();
  let current: FormOutlineGroup | null = null;
  const untitled = mapGivesHeadings(fields) ? UNTITLED_HEADING : "";
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
      group = current && current.title === untitled ? current : { title: untitled, entries: [] };
    }
    if (groups.indexOf(group) < 0) groups.push(group);
    current = group;
    group.entries.push({ index: i, context });
    groupOfLabel.set(field.label.trim().toLowerCase(), group);
  });
  return groups;
}
