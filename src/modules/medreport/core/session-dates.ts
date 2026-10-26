/**
 * Session dates filled by code (reserved module, W0.4/W0.6 – owner WE).
 *
 * The plan moves `sessionDatesByCode` here. That function came with round 3 (B2-19, release/bh-trial-fixes) and is not
 * on this base (bh2-r1 = production + round 1), so there was nothing to move: the attended appointments' dates and
 * times a map asks for explicitly (registration paths episode.firstSeenTime, episode.attendedDate,
 * episode.attendedTime) are resolved in core/forms/record-paths.ts resolveRegistrationValue, as before.
 *
 * What WE may put here (plan WE design 4 and 5): a re-implementation of sessionDatesByCode behind corpus cases, used
 * only for maps without explicit episode.attended* fields, and the list path episode.attendedDates {fromSession, of?}.
 *
 * bh2 W0 follow-up (bh2-base2, seam "session-dates-call-site"): the call site is wired. createFormReport
 * (core/report-factory.ts, WA1's file) asks sessionDatesByCode for every drafted box (notes_narrative /
 * clinician_opinion) before it leaves the box for drafting; an answer fills the box from the records instead. So WE
 * changes only this file, and WA1 never needs it. The stub answers nothing: every box is drafted, as before.
 *
 * Pure; browser and server.
 * Owner: WE (data, maps and mapping page) – docs/bh2-ownership.json.
 */
import type { ComputedFact, EpisodeBundle, FormDefinition, FormField, FrozenCondition, ReportSection } from "./types";

/** What createFormReport hands over for one drafted box. */
export interface SessionDatesInput {
  field: FormField;
  form: Pick<FormDefinition, "title" | "fields">;
  bundle: Pick<EpisodeBundle, "appointments">;
  computedFacts: readonly ComputedFact[];
  /** The box's condition as frozen at creation (WA1 design 3), once WA1 passes it; absent until then. */
  condition?: FrozenCondition | null;
}

/** A box the record answers: its text (cited), and the structured answer for a date question. */
export interface SessionDatesAnswer {
  text: string;
  sourceIds: string[];
  answer?: ReportSection["answer"];
}

/** The session dates the record holds for this box, or null (not such a question, or no such session) – WE fills it in. */
export const sessionDatesByCode: (input: SessionDatesInput) => SessionDatesAnswer | null = () => null;
