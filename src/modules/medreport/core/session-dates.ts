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
 * Its call site would be in createFormReport (core/report-factory.ts, WA1's file) – see the "session-dates-call-site"
 * seam in docs/bh2-ownership.json.
 *
 * Pure; browser and server. Nothing imports this module yet.
 * Owner: WE (data, maps and mapping page) – docs/bh2-ownership.json.
 */
export {};
