/**
 * Review roles and provenance (bh2 workstream WC): who entered what, which decisions are the approving clinician's,
 * and which words are still drafted text. One set of rules for the review reducer (the client), the validators
 * (APPROVER_DECISION, core/validation/approver-decision.ts), the acknowledgement policy (validation/acknowledge.ts) and
 * the server's store check (api/handlers/store-reports.ts), so the screen, /sign and the store never disagree.
 *
 * - The approver is Report.approver (hashed): chosen when the report is created, changed only by "Take over as
 *   approver". Decisions on a clinician box are theirs alone. A report from an earlier build has no approver: then
 *   every member who is not staff counts as the approver, exactly as before this release (the NEW-1 stop-gap rule).
 * - A clinician box (isClinicianBox) is an opinion box (section kind or fill source clinician_opinion), a
 *   physiotherapist's choice, a box whose label or guidance asks for an opinion (OPINION_BOX_WORDING), or a box with
 *   an opinion gap. When in doubt it is a clinician box.
 * - What someone other than the approver enters in a clinician box is a proposal (pendingProposal): the approver
 *   adopts it with one click (Section.adoptedBy, whose contentSha covers the box's answer and paragraphs, so any later
 *   change clears it). Until then APPROVER_DECISION blocks approval.
 * - Drafted residue (residueSpans): a span of a person's text that reproduces a drafted sentence of the box (its
 *   drafted paragraphs, the drafted wording of edited ones, and drafted paragraphs a person deleted – tombstones) with
 *   at least RESIDUE_THRESHOLD of its words keeps drafted-text strictness: cut and paste back, delete and add, a
 *   one-word or a punctuation change. A drafted sentence of fewer than SHORT_SENTENCE_TOKENS words counts only where
 *   a whole sentence of the text repeats it.
 *
 * Ledger hooks (core/validation/hooks.ts, __corpus__/ledger.json) defined here: "draft-residue" (the threshold lets a
 * genuinely rewritten sentence count as the person's own; disabled, every person-changed paragraph of a box with
 * drafted text stays drafted text) and "clinician-origin-skip" (only the approver's own text is written as origin
 * "clinician", which the drafted-text checks skip; disabled, nobody's is).
 *
 * Pure; browser and server. Owner: WC (review roles and provenance).
 */
import { canonicalize } from "./fingerprint";
import { sentenceKey, splitSentences } from "./text/sentences";
import { formatUkDate } from "./dates";
import type { ActivityEntry, Actor, FormField, Gap, Paragraph, Report, ReportApprover, ReportSection } from "./types";
import { defineHook, hookEnabled } from "./validation/hooks";

export const DRAFT_RESIDUE_HOOK = defineHook("draft-residue");
export const CLINICIAN_ORIGIN_HOOK = defineHook("clinician-origin-skip");

/* ------------------------------------------------------------------------------------------------
 * SHA-256 (synchronous): Section.adoptedBy.contentSha and PhraseAcceptance.sentenceSha are written inside the review
 * reducer and checked inside the validators, both synchronous. FIPS 180-4; checked against WebCrypto in the tests.
 * ----------------------------------------------------------------------------------------------*/

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** SHA-256 of a UTF-8 string as 64 lower-case hex characters, synchronously. */
export function sha256HexSync(text: string): string {
  const data = new TextEncoder().encode(text);
  const bitLength = data.length * 8;
  const padded = new Uint8Array(Math.ceil((data.length + 9) / 64) * 64);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(padded.length - 4, bitLength >>> 0);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7]];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }
  return Array.from(h, (x) => x.toString(16).padStart(8, "0")).join("");
}

/* ------------------------------------------------------------------------------------------------
 * Who: the approver, and whether an actor acts as them
 * ----------------------------------------------------------------------------------------------*/

/** The member id a client uses when it knows none (core/actor.ts UNKNOWN_MEMBER_ID): never matches anyone. */
const UNKNOWN_MEMBER = "unknown";

export function normaliseHcpc(s: string): string {
  return s.normalize("NFKC").replace(/\s+/g, "").toUpperCase();
}

/** Two stamps name the same member: the same member id (never the unknown one). */
export function sameMember(a: { memberId?: string } | null | undefined, b: { memberId?: string } | null | undefined): boolean {
  return Boolean(a?.memberId && b?.memberId && a.memberId !== UNKNOWN_MEMBER && a.memberId === b.memberId);
}

/** The report's approving clinician, or null (a report from an earlier build, or none chosen). */
export function approverOf(report: Pick<Report, "approver">): ReportApprover | null {
  return report.approver ?? null;
}

/**
 * Whether `actor` makes the approver's decisions on this report: the approver themselves (matched by member id).
 * A report with no approver (an earlier build's) keeps that build's rule: any member who is not staff.
 */
export function actsAsApprover(actor: Pick<Actor, "memberId" | "role"> | null | undefined, report: Pick<Report, "approver">): boolean {
  if (!actor) return false;
  const approver = approverOf(report);
  if (!approver) return actor.role !== "staff";
  return sameMember(actor, approver);
}

/** The approver as an Actor stamp (role clinician, may sign) – for the takeover's `to`, and tests. */
export function approverRefOf(actor: Pick<Actor, "memberId" | "name" | "hcpc">): ReportApprover | null {
  const hcpc = actor.hcpc?.trim();
  if (!hcpc || !actor.memberId || actor.memberId === UNKNOWN_MEMBER || !actor.name.trim()) return null;
  return { memberId: actor.memberId, name: actor.name, hcpc };
}

/** Whether an actor may approve at all (signing details and "may sign"), so may take over as approver. */
export function mayApprove(actor: Pick<Actor, "role" | "canSign" | "hcpc" | "memberId"> | null | undefined): boolean {
  return Boolean(actor && actor.role !== "staff" && actor.canSign && actor.hcpc?.trim() && actor.memberId && actor.memberId !== UNKNOWN_MEMBER);
}

/** "Pat Morgan (staff)" / "Tom Ellis" – how a stamp names who entered something. */
export function enteredByName(by: Pick<Actor, "name" | "role"> | null | undefined): string {
  if (!by) return "someone other than the approving clinician";
  return by.role === "staff" ? `${by.name} (staff)` : by.name;
}

/* ------------------------------------------------------------------------------------------------
 * Clinician boxes and clinician gaps
 * ----------------------------------------------------------------------------------------------*/

/**
 * Printed wording that asks for the clinician's opinion or decision (prognosis, causation, fitness for work,
 * restrictions, recovery, permanence, further treatment, recommendations). Shown on the label or guidance of a box,
 * it makes the box a clinician box whatever its fill source says.
 */
export const OPINION_BOX_WORDING =
  /\b(?:prognos\w*|opinion|causation|caused by|attributable to|(?:un)?fit (?:for|to) (?:work|return|drive|driving|duties|normal|full|light|lighter|amended|modified)|fitness (?:for|to) (?:work|return|drive)|return(?:ing)? to (?:work|normal|full|pre-injury|usual)\b|restrictions?\b|recommend\w*|permanen\w*|expected (?:recovery|date|time|duration|return|outcome)|recovery (?:time|period)|maximum (?:medical )?improvement|further (?:treatment|sessions|physiotherapy) (?:advised|recommended|required|needed|necessary)|likely (?:outcome|recovery|duration))/i;

/** Gap kinds that only a clinician answers (core/schemas.ts GapKindSchema). */
const OPINION_GAP_KINDS: ReadonlySet<string> = new Set(["no_opinion_recorded", "opinion_not_fitting_options", "band"]);
/** Gap kinds anyone working on the report may settle. */
const MEMBER_GAP_KINDS: ReadonlySet<string> = new Set(["staff_entry", "record_value", "condition"]);
/** Gaps an earlier build raised on a record box for staff to fill (core/report-factory.ts, form-record-rules.ts, form-tables.ts). */
const RECORD_GAP_SUFFIX = /-(?:referrer|record|staff|clinic|fixed)$/;

/** A gap that asks for a clinician's opinion or choice. */
function isOpinionGap(gap: Pick<Gap, "id" | "kind">): boolean {
  return gap.id.endsWith("-physio") || (gap.kind !== undefined && OPINION_GAP_KINDS.has(gap.kind));
}

export interface BoxContext {
  /**
   * The referrer form's fields (form reports). Not used to decide who decides: that is read from the report alone
   * (isClinicianBox), so the review, /validate, /sign and the store always agree on it.
   */
  fields?: ReadonlyArray<Pick<FormField, "id" | "fillSource" | "guidance" | "label">> | null;
}

/**
 * A box whose answer is the clinician's decision (WC design 3), read from the report alone: an opinion box (section
 * kind clinician_opinion – the fill source clinician_opinion), the physiotherapist's choice on each report (its
 * "-physio" gap, raised when the report is created and kept once answered), a box whose printed label asks for an
 * opinion (OPINION_BOX_WORDING – also a "staff entry" such as a work-restriction tick, B1-15), or a box with an opinion
 * gap. A value filled from the records is not, unless its label asks for an opinion. When in doubt it is a clinician box.
 */
export function isClinicianBox(report: Pick<Report, "gaps">, section: Pick<ReportSection, "key" | "kind" | "title">, _ctx?: BoxContext): boolean {
  if (section.kind === "declaration") return false;
  if (section.kind === "clinician_opinion") return true;
  const gaps = (report.gaps ?? []).filter((g) => g.sectionKey === section.key);
  if (gaps.some((g) => g.id.endsWith("-physio"))) return true;
  if (OPINION_BOX_WORDING.test(section.title)) return true;
  // A record value is never a clinical decision because of a gap about it.
  if (section.kind === "from_records") return false;
  return gaps.some((g) => isOpinionGap(g));
}

/**
 * Who answers a gap (answerableBy, WC design 3): a gap of a clinician box, an opinion gap, and any gap whose kind is
 * unknown (an older gap) outside a record box are the approver's; a record value or staff entry and a condition are
 * anyone's.
 */
export function isClinicianGap(report: Pick<Report, "gaps" | "sections"> & Partial<Pick<Report, "approver">>, gap: Pick<Gap, "id" | "sectionKey" | "kind">, ctx?: BoxContext): boolean {
  const section = report.sections.find((s) => s.key === gap.sectionKey);
  // A report from an earlier build (no approver): that build's rule – an opinion box's gaps and the physiotherapist's choice.
  if (!report.approver) return gap.id.endsWith("-physio") || section?.kind === "clinician_opinion";
  if (isOpinionGap(gap)) return true;
  if (section && isClinicianBox(report, section, ctx)) return true;
  if (gap.kind !== undefined) return !MEMBER_GAP_KINDS.has(gap.kind);
  if (section?.kind === "from_records" || RECORD_GAP_SUFFIX.test(gap.id)) return false;
  return true;
}

/* ------------------------------------------------------------------------------------------------
 * Proposals and adoption
 * ----------------------------------------------------------------------------------------------*/

/** What a person typed or chose (not drafted, not filled from the records). */
export function isPersonParagraph(p: Pick<Paragraph, "origin">): boolean {
  return p.origin === "clinician" || p.origin === "edited" || p.origin === "staff";
}

/** SHA-256 over a box's answer and paragraphs (text and citations): what an adoption covers. */
export function boxContentSha(section: Pick<ReportSection, "answer" | "paragraphs">): string {
  return sha256HexSync(
    canonicalize({
      answer: section.answer ?? null,
      paragraphs: section.paragraphs.map((p) => ({ text: p.text, sourceIds: p.sourceIds })),
    }),
  );
}

/** The adoption still covers exactly what the box holds, and it is the approver's. */
export function adoptionCurrent(section: Pick<ReportSection, "answer" | "paragraphs" | "adoptedBy">, approver: ReportApprover | null): boolean {
  const a = section.adoptedBy;
  return Boolean(a && approver && sameMember(a.by, approver) && a.contentSha === boxContentSha(section));
}

export interface Proposal {
  /** Who entered it (their stamps; null where no stamp says). */
  by: Array<Pick<Actor, "memberId" | "name" | "role">>;
  /** "Pat Morgan (staff)", or "Pat Morgan (staff) and Tom Ellis". */
  names: string;
}

/**
 * What someone other than the approver entered in a clinician box and the approver has not adopted (WC design 5), or
 * null. Only on a report with an approver; a drafted answer or paragraph is not a proposal (it is drafted text, checked
 * as such).
 */
export function pendingProposal(report: Pick<Report, "approver" | "gaps">, section: ReportSection, ctx?: BoxContext): Proposal | null {
  const approver = approverOf(report);
  if (!approver || !isClinicianBox(report, section, ctx)) return null;
  const by: Array<Pick<Actor, "memberId" | "name" | "role">> = [];
  let unstamped = false;
  const add = (stamp: Pick<Actor, "memberId" | "name" | "role"> | undefined) => {
    if (!stamp) unstamped = true;
    else if (!sameMember(stamp, approver) && !by.some((b) => sameMember(b, stamp) || (b.name === stamp.name && b.role === stamp.role))) by.push(stamp);
  };
  for (const p of section.paragraphs) {
    if (!isPersonParagraph(p) || !p.text.trim()) continue;
    // Origin "clinician" with no stamp: the clinician's own words, as it has always meant (the review stamps every
    // paragraph it writes, and the store refuses "clinician" text from anyone but the approver).
    if (!p.by && p.origin === "clinician") continue;
    if (!p.by || !sameMember(p.by, approver)) add(p.by);
  }
  const answer = section.answer;
  if (answer && answer.kind !== "text" && answer.value !== null && answer.value !== "" && section.answerBy && !sameMember(section.answerBy, approver)) add(section.answerBy);
  if (by.length === 0 && !unstamped) return null;
  if (adoptionCurrent(section, approver)) return null;
  const names = [...by.map((b) => enteredByName(b)), ...(unstamped ? [enteredByName(null)] : [])];
  return { by, names: names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0] };
}

/* ------------------------------------------------------------------------------------------------
 * Drafted residue
 * ----------------------------------------------------------------------------------------------*/

/** A span of a person's text that reproduces a drafted sentence at least this closely keeps drafted strictness. */
export const RESIDUE_THRESHOLD = 0.8;
/** Drafted sentences shorter than this (in words) count only where a whole sentence of the text repeats them. */
export const SHORT_SENTENCE_TOKENS = 4;

interface Token {
  t: string;
  start: number;
  end: number;
}

function tokens(text: string): Token[] {
  const out: Token[] = [];
  const re = /[A-Za-z0-9\u00C0-\u024F]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push({ t: m[0].toLowerCase(), start: m.index, end: m.index + m[0].length });
  return out;
}

export interface Span {
  start: number;
  end: number;
}

/** The drafted sentences of a box: its drafted paragraphs, the drafted wording of edited ones, and tombstones. */
export function draftedSentences(section: Pick<ReportSection, "paragraphs" | "tombstones">, opts: { exceptParagraphId?: string } = {}): string[] {
  const texts: string[] = [];
  for (const p of section.paragraphs) {
    if (p.origin === "ai" && p.id !== opts.exceptParagraphId) texts.push(p.text);
    else if (p.origin === "edited" && p.originalText !== undefined) texts.push(p.originalText);
  }
  for (const t of section.tombstones ?? []) texts.push(t.text);
  const out: string[] = [];
  for (const text of texts) for (const s of splitSentences(text, "prose")) if (out.indexOf(s.text) < 0) out.push(s.text);
  return out;
}

function countOverlap(window: readonly Token[], drafted: readonly string[]): number {
  const pool = new Map<string, number>();
  for (const t of drafted) pool.set(t, (pool.get(t) ?? 0) + 1);
  let n = 0;
  for (const w of window) {
    const left = pool.get(w.t) ?? 0;
    if (left > 0) {
      n += 1;
      pool.set(w.t, left - 1);
    }
  }
  return n;
}

/**
 * The spans of `text` that reproduce one of `drafted` (sentences) with at least RESIDUE_THRESHOLD of its words, in
 * order; overlapping spans are merged. A drafted sentence of fewer than SHORT_SENTENCE_TOKENS words matches only a
 * whole sentence of `text` with the same words.
 */
export function residueSpans(text: string, drafted: readonly string[]): Span[] {
  const all = tokens(text);
  if (all.length === 0 || drafted.length === 0) return [];
  const spans: Span[] = [];
  const sentences = splitSentences(text, "prose");
  for (const d of drafted) {
    const dt = tokens(d).map((x) => x.t);
    if (dt.length === 0) continue;
    if (dt.length < SHORT_SENTENCE_TOKENS) {
      const key = dt.join(" ");
      for (const s of sentences) {
        if (tokens(s.text).map((x) => x.t).join(" ") === key) spans.push({ start: s.start, end: s.end });
      }
      continue;
    }
    const m = dt.length;
    const len = Math.min(m, all.length);
    let best = 0;
    let bestAt = -1;
    for (let i = 0; i + len <= all.length; i++) {
      const score = countOverlap(all.slice(i, i + len), dt) / m;
      if (score > best) {
        best = score;
        bestAt = i;
      }
    }
    if (bestAt >= 0 && best >= RESIDUE_THRESHOLD) spans.push({ start: all[bestAt].start, end: all[bestAt + len - 1].end });
  }
  spans.sort((a, b) => a.start - b.start);
  const merged: Span[] = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else merged.push({ ...s });
  }
  return merged;
}

/**
 * The drafted residue in a paragraph of a box: drafted text itself is drafted throughout; a person's paragraph keeps
 * drafted strictness where it reproduces a drafted sentence of the box (residueSpans). `forAcknowledgement`: an
 * edited paragraph whose words are exactly its drafted wording is the editor's text as stored (the review itself
 * turns such a paragraph back into drafted text), so the approver may acknowledge its checks as on any edited text;
 * for "These are my own words" and adoption it is still drafted throughout.
 * With the "draft-residue" hook disabled, any person-changed paragraph in a box with drafted text is drafted throughout.
 */
export function paragraphResidue(section: Pick<ReportSection, "paragraphs" | "tombstones">, paragraph: Paragraph, opts: { forAcknowledgement?: boolean } = {}): Span[] {
  const whole: Span[] = paragraph.text.trim() ? [{ start: 0, end: paragraph.text.length }] : [];
  if (paragraph.origin === "ai") return whole;
  if (paragraph.origin === "from_records") return [];
  const unchangedEdit = paragraph.origin === "edited" && paragraph.originalText !== undefined && paragraph.text === paragraph.originalText;
  if (unchangedEdit) return opts.forAcknowledgement ? [] : whole;
  const drafted = draftedSentences(section, { exceptParagraphId: paragraph.id });
  if (drafted.length === 0) return [];
  if (!hookEnabled(DRAFT_RESIDUE_HOOK)) return whole;
  return residueSpans(paragraph.text, drafted);
}

/** Whether `evidence` (a flag's offending words) lies in one of `spans` of `text`; not found anywhere: any span counts. */
export function evidenceInSpans(text: string, evidence: string | undefined, spans: readonly Span[]): boolean {
  if (spans.length === 0) return false;
  const needle = (evidence ?? "").trim().toLowerCase();
  if (!needle) return true;
  const hay = text.toLowerCase();
  let at = hay.indexOf(needle);
  if (at < 0) return true;
  while (at >= 0) {
    const end = at + needle.length;
    if (spans.some((s) => at < s.end && end > s.start)) return true;
    at = hay.indexOf(needle, at + 1);
  }
  return false;
}

/** The sentences of `text` that contain drafted residue, for "split it out" and the review's explanation. */
export function residueSentences(text: string, spans: readonly Span[]): string[] {
  return splitSentences(text, "prose")
    .filter((s) => spans.some((r) => r.start < s.end && r.end > s.start))
    .map((s) => s.text);
}

/** SHA-256 of a sentence in its canonical form (PhraseAcceptance.sentenceSha). */
export function sentenceSha(sentence: string): string {
  return sha256HexSync(sentenceKey(sentence));
}

/* ------------------------------------------------------------------------------------------------
 * The origin a person's text gets
 * ----------------------------------------------------------------------------------------------*/

/**
 * The origin of a paragraph a person wrote or changed (WC design 6):
 * - a box filled from the records: "clinician" for the approver's entry, "staff" for anyone else's (a value entered
 *   for this report – no citation, labelled by who entered it);
 * - otherwise "clinician" only for the approver's own new words with no drafted residue ("clinician-origin-skip");
 *   drafted text a person changed stays "edited" (editing never turns drafted text into the clinician's own words –
 *   that is "These are my own words", the approver's audited decision), and so does anyone else's text.
 */
export function personOrigin(input: {
  report: Pick<Report, "approver">;
  section: Pick<ReportSection, "kind" | "paragraphs" | "tombstones">;
  paragraph: Paragraph;
  /** The paragraph before this change (absent: a new paragraph). */
  before?: Paragraph;
  actor: Pick<Actor, "memberId" | "role">;
}): Paragraph["origin"] {
  const { report, section, paragraph, before, actor } = input;
  if (paragraph.origin === "ai" || paragraph.origin === "from_records") return paragraph.origin;
  const fromDraft = paragraph.originalText !== undefined || before?.origin === "ai" || (before?.origin === "edited" && before.originalText !== undefined);
  if (!approverOf(report)) {
    // A report from an earlier build (no approver): that build's rules – a value entered in a record box, and a member's
    // own new words, are "clinician"; staff text elsewhere, and drafted text a person changed, are "edited".
    if (section.kind === "from_records") return "clinician";
    if (actor.role === "staff" || fromDraft) return "edited";
    return before && before.origin !== "clinician" ? "edited" : "clinician";
  }
  const approver = actsAsApprover(actor, report);
  if (section.kind === "from_records") return approver ? "clinician" : "staff";
  if (!approver || fromDraft || !hookEnabled(CLINICIAN_ORIGIN_HOOK)) return "edited";
  return paragraphResidue(section, { ...paragraph, origin: "clinician" }).length > 0 ? "edited" : "clinician";
}

/**
 * Text the approver wrote (WC design 6; WB design 3 reads it): a person's paragraph stamped by the report's approver
 * (Paragraph.by) with no drafted residue – the approver's own words whatever its origin ("clinician" when typed,
 * "edited" when it replaced drafted text; editing never switches the origin). The opinion checks treat its hits as
 * informational; a box's gaps settle when it appears (B1-10).
 */
export function approverWritten(report: Pick<Report, "approver">, section: Pick<ReportSection, "paragraphs" | "tombstones">, paragraph: Paragraph): boolean {
  const approver = approverOf(report);
  if (!approver || !isPersonParagraph(paragraph) || !paragraph.text.trim()) return false;
  if (!paragraph.by || !sameMember(paragraph.by, approver)) return false;
  return paragraphResidue(section, paragraph).length === 0;
}

/** The box holds words the approver wrote (approverWritten); a report from an earlier build: a clinician's own paragraph. */
export function hasApproverWords(report: Pick<Report, "approver">, section: Pick<ReportSection, "paragraphs" | "tombstones">): boolean {
  if (!approverOf(report)) return section.paragraphs.some((p) => p.origin === "clinician" && p.text.trim() !== "");
  return section.paragraphs.some((p) => approverWritten(report, section, p));
}

/* ------------------------------------------------------------------------------------------------
 * Amendments (WC design 8)
 * ----------------------------------------------------------------------------------------------*/

/**
 * Version 1's "superseded" entry once its amended version 2 is approved: "Superseded by version 2 (approved
 * 27/10/2026).", naming version 2 (ActivityEntry.reportId) so it is written once however often version 2 is stored or
 * loaded. Outside the content fingerprint: version 1's receipt still verifies. The clinic's store writes it on the
 * server; the public demo's browser store, on approval.
 */
export function supersededEntry(v2: Pick<Report, "id" | "version" | "receipt">, now: Date = new Date()): ActivityEntry {
  const signedAt = v2.receipt?.signedAt ?? now.toISOString();
  return {
    at: signedAt,
    actor: v2.receipt?.signer.name ?? "ClinForms",
    action: "superseded",
    detail: `Superseded by version ${v2.version ?? 2} (approved ${formatUkDate(signedAt.slice(0, 10))}).`,
    reportId: v2.id,
  };
}

/** Whether version 1 already reads as superseded by this version 2. */
export function isSupersededBy(v1: Pick<Report, "activity">, v2Id: string): boolean {
  return v1.activity.some((e) => e.action === "superseded" && e.reportId === v2Id);
}

