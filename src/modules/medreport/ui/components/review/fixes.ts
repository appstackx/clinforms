/**
 * Review workspace model – one-click fixes: "Write in my own voice", "Name <clinician> instead" and removing the
 * draft's superseded "not recorded" sentences.
 *
 * Pure, no React. Split out of review-model.ts by W0.4 (bh2 module split, pure move; review-model.ts re-exports it).
 * Owner: WD (drafting and text edits; the one-click engine) – docs/bh2-ownership.json. WB's fix generators reach the
 * review through here.
 */
import { inOwnClinicalWording, isOwnVoiceCandidate, nameClinicianInstead, otherCliniciansInFirstPerson } from "../../../core/voice";
import { appendActivity } from "../../../core/report-factory";
import type { Report, ReportFlag, ReportSection } from "../../../core/types";
import { editParagraph, removeParagraph } from "./reducer";

/* ------------------------------------------------------------------------------------------------
 * The signer's own voice, leftover "not recorded" sentences
 * ----------------------------------------------------------------------------------------------*/

/**
 * Drafted paragraphs that report `authorName`'s own notes as record-keeping – in the third person ("Sarah
 * Reid recorded…", "she recorded…") or as "I recorded…" – which "Write in my own voice" turns into the
 * signer's plain clinical wording (core/voice.ts inOwnClinicalWording).
 */
export function ownVoiceCandidates(report: Pick<Report, "sections" | "bundleSnapshot">, authorName: string): Array<{ key: string; paragraphId: string }> {
  const out: Array<{ key: string; paragraphId: string }> = [];
  for (const s of report.sections) {
    for (const p of s.paragraphs) {
      if (isOwnVoiceCandidate(p, report.bundleSnapshot, authorName, { pronouns: true }) && inOwnClinicalWording(p.text, authorName, { pronouns: true }) !== p.text) out.push({ key: s.key, paragraphId: p.id });
    }
  }
  return out;
}

/**
 * Rewrite every candidate paragraph in the author's own voice. Each becomes "edited" (the AI wording
 * stays available through "Revert to AI draft"); citations are unchanged. One activity entry.
 */
export function writeInOwnVoice(report: Report, authorName: string, actor: string, now?: Date): Report {
  const targets = ownVoiceCandidates(report, authorName);
  if (targets.length === 0) return report;
  let next = report;
  for (const t of targets) {
    const p = next.sections.find((s) => s.key === t.key)?.paragraphs.find((x) => x.id === t.paragraphId);
    if (p) next = editParagraph(next, t.key, t.paragraphId, inOwnClinicalWording(p.text, authorName, { pronouns: true }), now);
  }
  return appendActivity(
    next,
    { actor, action: "edited", detail: `Wrote ${targets.length} drafted answer${targets.length === 1 ? "" : "s"} about ${authorName}'s own notes in ${authorName}'s own clinical wording (citations unchanged).` },
    now,
  );
}

/**
 * "Name Tom Ellis instead" (fix round 1, B0-1): the rewrite offered on an OTHER_CLINICIAN_VOICE flag – the paragraph
 * with the one other clinician whose note it cites named instead of "I" / "me" / "my" – or null (two clinicians, or
 * wording the rewrite cannot settle: the clinician edits it).
 */
export function nameClinicianFix(report: Pick<Report, "sections" | "bundleSnapshot" | "author">, flag: Pick<ReportFlag, "code" | "sectionKey" | "paragraphId">): { name: string; text: string } | null {
  if (flag.code !== "OTHER_CLINICIAN_VOICE" || !flag.sectionKey || !flag.paragraphId) return null;
  const p = report.sections.find((s) => s.key === flag.sectionKey)?.paragraphs.find((x) => x.id === flag.paragraphId);
  if (!p) return null;
  const others = otherCliniciansInFirstPerson(p, report.bundleSnapshot, report.author);
  if (!others || others.length !== 1) return null;
  const text = nameClinicianInstead(p.text, others[0]);
  return text ? { name: others[0], text } : null;
}

/** Apply nameClinicianFix() to the flagged paragraphs (by flag ID): each becomes "edited" (revertable); one activity entry each. */
export function nameCliniciansInstead(report: Report, flags: readonly ReportFlag[], actor: string, now?: Date): Report {
  let next = report;
  for (const flag of flags) {
    const fix = nameClinicianFix(next, flag);
    if (!fix || !flag.sectionKey || !flag.paragraphId) continue;
    next = appendActivity(
      editParagraph(next, flag.sectionKey, flag.paragraphId, fix.text, now),
      { actor, action: "edited", detail: `${flag.sectionKey}: named ${fix.name}, who wrote the cited note, instead of “I” or “my” (citations unchanged).` },
      now,
    );
  }
  return next;
}

/** Sentences of drafted text that only say something was NOT recorded. */
export function notRecordedSentences(text: string): string[] {
  return (text.match(/[^.!?]+[.!?]+/g) ?? [])
    .map((x) => x.trim())
    .filter((x) => /\b(?:no|not|nothing)\b[^.!?]*\b(?:recorded|documented|noted|stated)\b/i.test(x) && !/\bI recorded\b/.test(x));
}

/**
 * On an opinion question the clinician has now answered: the AI paragraphs' "No … was recorded."
 * sentences, which the clinician's own answer replaces.
 */
export function supersededAbsenceSentences(section: Pick<ReportSection, "kind" | "paragraphs">): Array<{ paragraphId: string; sentence: string }> {
  if (section.kind !== "clinician_opinion") return [];
  if (!section.paragraphs.some((p) => p.origin === "clinician" && p.text.trim())) return [];
  const out: Array<{ paragraphId: string; sentence: string }> = [];
  for (const p of section.paragraphs) {
    if (p.origin !== "ai" && p.origin !== "edited") continue;
    for (const sentence of notRecordedSentences(p.text)) out.push({ paragraphId: p.id, sentence });
  }
  return out;
}

/** Remove superseded "not recorded" sentences (paragraphs left empty are removed). */
export function removeAbsenceSentences(report: Report, key: string, actor: string, now?: Date): Report {
  const section = report.sections.find((s) => s.key === key);
  if (!section) return report;
  const found = supersededAbsenceSentences(section);
  if (found.length === 0) return report;
  let next = report;
  for (const { paragraphId, sentence } of found) {
    const p = next.sections.find((s) => s.key === key)?.paragraphs.find((x) => x.id === paragraphId);
    if (!p) continue;
    const text = p.text.replace(sentence, "").replace(/\s{2,}/g, " ").trim();
    next = text ? editParagraph(next, key, paragraphId, text, now) : removeParagraph(next, key, paragraphId, now);
  }
  return appendActivity(next, { actor, action: "edited", detail: `${key}: removed the draft's “not recorded” wording now that the clinician has answered.` }, now);
}
