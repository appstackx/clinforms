/**
 * One-click fixes and who may acknowledge a flag (W0.6 shared types, bh2).
 *
 *   AckPolicy     who may clear a flag by acknowledging it: never | the approving clinician | any member
 *   FixProposal   a one-click fix as WD's engine (review/fixes.ts planFix) offers it: the text before and after, the
 *                 spans it removes, and the generator that made it (WB's attribution, quotation and commentary fixes;
 *                 WD's shorten, value-only, "(dose not stated)", duplicate paragraph)
 *   FixGenerator  a generator: a proposal for one flagged paragraph, or null when it cannot fix it safely
 *
 * Types only; pure; browser and server.
 * Owner: W0 (shared; changes through the integrator) – docs/bh2-ownership.json.
 */
import type { Actor } from "./actor";
import type { AckPolicy, FormDefinition, Paragraph, Report, ReportFlag, ReportSection } from "./types";

/**
 * Who may acknowledge a flag with a reason: "never" (fix the text or the record), "approver" (only the report's
 * approving clinician, WC), "member" (anyone working on the report – today's rule for every acknowledgeable flag).
 * Stored on the flag since bh2-base2 (core/schemas.ts AckPolicySchema, ReportFlag.ackPolicy).
 */
export type { AckPolicy };

/** A flag together with the policy that applies to it (core/validation/acknowledge.ts ackPolicyOf) – ReportFlag itself since bh2-base2. */
export type FlagWithAckPolicy = ReportFlag;

/** A span of a paragraph's text: [start, end) in UTF-16 code units, as String.prototype.slice takes them. */
export interface TextSpan {
  start: number;
  end: number;
}

export interface FixProposal {
  /** The generator that made it ("name-clinician", "note-words", "shorten", …) – stable, for the activity log and tests. */
  generator: string;
  /** The flag it answers, when it answers one. */
  flagId?: string;
  sectionKey: string;
  paragraphId: string;
  /** The button's words ("Name Tom Ellis instead"). */
  label: string;
  /** The paragraph's text now, and after the fix. */
  before: string;
  after: string;
  /** What the fix takes out of `before` (whole sentences only – WD design 6). Empty for a fix that only adds or rewords. */
  removedSpans: TextSpan[];
  /** Who may apply it (an attribution fix on a clinician box is the approver's – WC). */
  ackPolicy?: AckPolicy;
}

/** What a generator sees. */
export interface FixInput {
  report: Report;
  section: ReportSection;
  paragraph: Paragraph;
  flag?: ReportFlag;
  actor: Actor;
  /**
   * bh2-rc1: the report's form map (form reports), so a generator knows the box's place on the form (a compact cell,
   * a tick's supporting text) whichever engine calls it – WD's offeredFixes passes it.
   */
  form?: Pick<FormDefinition, "fields"> | null;
}

export type FixGenerator = (input: FixInput) => FixProposal | null;
