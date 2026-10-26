/**
 * bh2 W0 follow-up stub for WB (plan WB design 2, N-ATTR-2, seam "find-anchor", bh2-base2): findAnchor – where one
 * sentence of a cited clinician's note asserts a phrase. It replaces the indexOf acceptance: the phrase is rejected in a
 * goal, aim, plan, target, STG, LTG or a question, next to a negator or hedge (not, no, unlikely, doubtful, unclear, ?,
 * not yet, at this stage), with a stronger modality than the note's (no may → is) or the opposite polarity; "in X's
 * opinion" anchors only to a note X wrote. Every allow returns the note, its author and the sentence.
 *
 * WD design 4 reads it too: the band arithmetic is shown, as information in the gap, only when a cited clinician note
 * anchors an expectation ("<Name> recorded “should settle within 4–6 weeks” (16/09/2026)"). Defined here, in WB's
 * namespace, so WD builds against it before WB lands.
 *
 * Stub: no anchor (null) – nothing is allowed by it and no band information is shown – until WB fills it in.
 * Pure; browser and server.
 * Owner: WB (opinion guard and attribution) – docs/bh2-ownership.json.
 */
import type { Note } from "../types";

/** Where a cited note asserts the phrase. */
export interface NoteAnchor {
  noteId: string;
  /** The note's author (a clinician of the bundle). */
  author: Note["author"];
  /** The note's sentence that asserts it, as written. */
  sentence: string;
}

export interface FindAnchorInput {
  /** The drafted phrase (an opinion or expectation, e.g. "should settle within 4–6 weeks"). */
  phrase: string;
  /** The drafted sentence it sits in (for modality and polarity). */
  sentence?: string;
  /** The notes the paragraph cites (only these may anchor it). */
  notes: readonly Note[];
  /** "in X's opinion": the clinician who must have written the note. */
  holder?: string | null;
}

export const findAnchor: (input: FindAnchorInput) => NoteAnchor | null = () => null;
