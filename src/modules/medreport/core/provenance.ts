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
 *   adopts it with one click (Section.adoptedBy, whose contentSha covers the box's answer and paragraphs). The
 *   approver's own entry in a clinician box confirms it the same way (the review stamps adoptedBy for them). A later
 *   change by anyone else leaves that adoption stale – it no longer matches – so the box reads "changed since Sarah
 *   Reid last confirmed it" and waits for the approver again, whether the change added, rewrote or removed something
 *   (approverEntryLost: a change that would take away what the approver confirmed without leaving a proposal is
 *   refused). Until then APPROVER_DECISION blocks approval.
 * - Drafted residue (residueSpans): a span of a person's text that reproduces a drafted sentence of the box (its
 *   drafted paragraphs, the drafted wording of edited ones, and drafted paragraphs a person deleted – tombstones) with
 *   at least RESIDUE_THRESHOLD of its words keeps drafted-text strictness: cut and paste back, delete and add, a
 *   one-word or a punctuation change, words inserted inside it (a window up to RESIDUE_WINDOW_GROWTH times the drafted
 *   sentence's length). A drafted sentence of fewer than SHORT_SENTENCE_TOKENS words counts only where a whole
 *   sentence of the text repeats it.
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
import type { ActivityEntry, Actor, FormDefinition, FormField, Gap, Paragraph, Report, ReportApprover, ReportSection } from "./types";
import { defineHook, hookEnabled } from "./validation/hooks";
import { sectionKindForFillSource } from "./forms/fields";
import { isGradeScale } from "./forms/answer-shape";
import { issueDetails } from "./issue-state";

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
 * harden-WC: causation and fitness for work in other words ("… as a result of the accident", "able to fulfil all
 * duties"), and the clinician's own findings – a diagnosis, the clinical impression, a whiplash grade, whether the
 * treatment goals were met – which referrer forms often map as drafted questions ("when in doubt it is a clinician box").
 */
export const OPINION_BOX_WORDING =
  /\b(?:prognos\w*|opinion|causation|caused by|attributable to|(?:un)?fit (?:for|to) (?:work|return|drive|driving|duties|normal|full|light|lighter|amended|modified)|fitness (?:for|to) (?:work|return|drive)|return(?:ing)? to (?:work|normal|full|pre-injury|usual)\b|restrictions?\b|recommend\w*|permanen\w*|expected (?:recovery|date|time|duration|return|outcome)|recovery (?:time|period)|maximum (?:medical )?improvement|further (?:treatment|sessions|physiotherapy) (?:advised|recommended|required|needed|necessary)|likely (?:outcome|recovery|duration)|(?:as a (?:direct )?result of|due to|resulting from|arising from|because of) (?:the|this|his|her|their|an?) (?:accident|injury|incident|collision|index event)|(?:un)?able to (?:fulfil|fulfill|carry out|perform|undertake|resume|manage)\b[\w\s,'’-]{0,30}?\b(?:duties|work|job|role)\b|capable of (?:work|working|duties|full duties)|diagnos\w*|clinical impression|WAD grade|quebec (?:classification|scoring|scale|grade)|goals?\b[\w\s,'’-]{0,60}?\b(?:achieved|met|reached)\b)/i;

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

/** A form field as the review rules read it (the map's field; answerType and options where the caller has them). */
export type BoxField = Pick<FormField, "id" | "fillSource" | "guidance" | "label"> & Partial<Pick<FormField, "answerType" | "options" | "required" | "section">>;

export interface BoxContext {
  /** The referrer form's fields (form reports): the boxes as the report factory makes them (factoryBoxOf). */
  fields?: ReadonlyArray<BoxField> | null;
  /**
   * The boxes as the report factory makes them – the template's sections (formToTemplate(form) for a form report, the
   * built-in template otherwise): key, kind and title. Read before `fields`.
   */
  boxes?: ReadonlyArray<Pick<ReportSection, "key" | "kind" | "title">> | null;
}

/*
 * R1T-WC-02 (SEC-2): the lookups the rules make once per box, per gap and per paragraph are indexed once per array (the
 * report's sections, gaps and a box's paragraphs are immutable – every edit makes new arrays), never searched again for
 * every element: a body of 20,000 paragraphs or gaps costs linear time, not quadratic.
 */
const byIdCache = new WeakMap<object, Map<string, unknown>>();
function indexBy<T>(list: readonly T[] | null | undefined, keyOf: (x: T) => string): Map<string, T> {
  if (!list) return new Map();
  let m = byIdCache.get(list) as Map<string, T> | undefined;
  if (!m) {
    m = new Map();
    for (const x of list) {
      const k = keyOf(x);
      if (!m.has(k)) m.set(k, x);
    }
    byIdCache.set(list, m as Map<string, unknown>);
  }
  return m;
}
/** The first section with this key (as Array.find would give it), indexed once per sections array. */
export function sectionByKey<S extends Pick<ReportSection, "key">>(sections: readonly S[] | null | undefined, key: string): S | undefined {
  return indexBy(sections, (s) => s.key).get(key);
}
/** The first paragraph with this id (as Array.find would give it), indexed once per paragraphs array. */
export function paragraphById<P extends Pick<Paragraph, "id">>(paragraphs: readonly P[] | null | undefined, id: string): P | undefined {
  return indexBy(paragraphs, (p) => p.id).get(id);
}
const gapsByBoxCache = new WeakMap<object, Map<string, Gap[]>>();
/** A report's gaps by box, built once per gaps array. */
function gapsOfBox(gaps: readonly Gap[] | null | undefined, key: string): readonly Gap[] {
  if (!gaps || gaps.length === 0) return [];
  let m = gapsByBoxCache.get(gaps);
  if (!m) {
    m = new Map();
    for (const g of gaps) {
      const list = m.get(g.sectionKey);
      if (list) list.push(g);
      else m.set(g.sectionKey, [g]);
    }
    gapsByBoxCache.set(gaps, m);
  }
  return m.get(key) ?? [];
}
function fieldOf(ctx: BoxContext | null | undefined, key: string): BoxField | undefined {
  return ctx?.fields ? indexBy(ctx.fields, (f) => f.id).get(key) : undefined;
}

/**
 * The box `key` as the report factory makes it (core/report-factory.ts: kind from the field's fill source, title = its
 * printed label; a built-in template's section as it is), from the form map or template in `ctx`, or null (no map, no
 * such box). harden-WC (check2-WC major A): what the report says about its own box is the client's – this is what the
 * clinic's own map or the built-in template says.
 */
export function factoryBoxOf(ctx: BoxContext | null | undefined, key: string): Pick<ReportSection, "key" | "kind" | "title"> | null {
  const made = ctx?.boxes ? indexBy(ctx.boxes, (b) => b.key).get(key) : undefined;
  if (made) return made;
  const field = fieldOf(ctx, key);
  if (!field) return null;
  const kind = sectionKindForFillSource(field.fillSource);
  return kind ? { key, kind, title: field.label } : null;
}

/**
 * The box is an opinion box (the map's fill source clinician_opinion, or – with no map – the section's own kind): drafting
 * never answers one (ai/form-drafting-answers.ts decideStructuredAnswer holds every drafted opinion back), so drafted
 * text in it never vouches for its answer (R1T-WC-03).
 */
export function isOpinionBox(section: Pick<ReportSection, "key" | "kind">, ctx?: BoxContext | null): boolean {
  if (section.kind === "clinician_opinion") return true;
  const field = fieldOf(ctx, section.key);
  if (field) return field.fillSource.kind === "clinician_opinion";
  return factoryBoxOf(ctx, section.key)?.kind === "clinician_opinion";
}

/**
 * The physiotherapist's own choice on each report (a staff-entry box whose guidance says the physiotherapist chooses it,
 * core/forms/record-paths.ts recordSourceOf "physio_choice"): neither the records nor drafting ever answer it, so an
 * answer no one's stamp vouches for is someone's entry (R1T-WC-03), never "from the records".
 */
export function isPhysioChoiceBox(ctx: BoxContext | null | undefined, key: string): boolean {
  const field = fieldOf(ctx, key);
  return Boolean(field && field.fillSource.kind === "registration" && field.fillSource.path === "staff.entry" && /\bchosen by the (?:physiotherapist|clinician)\b/i.test(field.guidance ?? ""));
}

/**
 * R1T-WC-09: a drafted question answered on a printed scale of degree (core/forms/answer-shape.ts isGradeScale – "0 … 10",
 * "Grade 1 / 2 / 3", "None / Mild / Severe"), which only a clinician grades (B3-15: drafting never ticks one). It is a
 * clinician box whatever kind of question drafting raised about it ("band" when the notes gave a grade, "record_value"
 * when they gave none): a staff entry there is a proposal the approver adopts. Read from the form map (`ctx.fields` with
 * the field's answer type and options); without them, the box's "band" question still makes it one (OPINION_GAP_KINDS).
 */
export function isGradeScaleBox(ctx: BoxContext | null | undefined, key: string): boolean {
  const field = fieldOf(ctx, key);
  if (!field || field.fillSource.kind !== "notes_narrative" || field.answerType !== "single_choice" || !Array.isArray(field.options)) return false;
  return isGradeScale({ label: field.label, options: field.options, answerType: field.answerType });
}

/**
 * A box whose answer is the clinician's decision (WC design 3): an opinion box (section kind clinician_opinion – the
 * fill source clinician_opinion), the physiotherapist's choice on each report (its "-physio" gap, raised when the
 * report is created and kept once answered), a box whose printed label asks for an opinion (OPINION_BOX_WORDING – also
 * a "staff entry" such as a work-restriction tick, B1-15), or a box with an opinion gap. A value filled from the
 * records is not, unless its label asks for an opinion. When in doubt it is a clinician box.
 * harden-WC (check2-WC major A): read from the box as the report holds it AND – where `ctx` has the form map or the
 * template – as the report factory made it (factoryBoxOf); either one makes it a clinician box. A report whose boxes
 * are as made (every report the factory and the review write) reads exactly as before; a box relabelled in the request
 * body (kind "from_records", title "Notes") is still the opinion box the map says it is.
 */
export function isClinicianBox(report: Pick<Report, "gaps">, section: Pick<ReportSection, "key" | "kind" | "title">, ctx?: BoxContext): boolean {
  if (clinicianBoxAsHeld(report, section)) return true;
  const made = factoryBoxOf(ctx, section.key);
  if (made && (made.kind !== section.kind || made.title !== section.title) && clinicianBoxAsHeld(report, { key: section.key, kind: made.kind, title: made.title })) return true;
  // R1T-WC-09: a printed grade scale is graded by the clinician only, whatever question drafting raised about it.
  return section.kind !== "declaration" && isGradeScaleBox(ctx, section.key);
}

function clinicianBoxAsHeld(report: Pick<Report, "gaps">, section: Pick<ReportSection, "key" | "kind" | "title">): boolean {
  if (section.kind === "declaration") return false;
  if (section.kind === "clinician_opinion") return true;
  const gaps = gapsOfBox(report.gaps, section.key);
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
  const section = sectionByKey(report.sections, gap.sectionKey);
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

/**
 * Section.adoptedBy.contentSha once someone other than the approver changed the box (the review writes it; the store lets
 * anyone write exactly this change and nothing else to an adoption): never equal to a real box's SHA-256, so the box
 * waits for the approver's Adopt again even if it is changed back to what they adopted.
 */
export const VOIDED_ADOPTION_SHA = "0".repeat(64);

/** The adoption still covers exactly what the box holds, and it is the approver's. */
export function adoptionCurrent(section: Pick<ReportSection, "answer" | "paragraphs" | "adoptedBy">, approver: ReportApprover | null): boolean {
  const a = section.adoptedBy;
  return Boolean(a && approver && sameMember(a.by, approver) && a.contentSha === boxContentSha(section));
}

export interface Proposal {
  /** Who entered it (their stamps; null where no stamp says). */
  by: Array<Pick<Actor, "memberId" | "name" | "role">>;
  /** "Pat Morgan (staff)", or "Pat Morgan (staff) and Tom Ellis"; "" when nobody's stamp is in the box (stale only). */
  names: string;
  /** The approver's adoption of the box no longer covers what it holds: someone else changed (or removed) something. */
  stale: boolean;
  /** "Entered by Pat Morgan (staff)" / "Changed since Sarah Reid last confirmed it" – the label's first words. */
  summary: string;
}

/**
 * What someone other than the approver entered in a clinician box and the approver has not adopted (WC design 5), or
 * null. Only on a report with an approver; a drafted answer or paragraph is not a proposal (it is drafted text, checked
 * as such). A box the approver adopted or confirmed (Section.adoptedBy) that has changed since – an entry added,
 * rewritten or removed by someone else – is one too (`stale`), even when no one else's stamp is left in it.
 */
export function pendingProposal(report: Pick<Report, "approver" | "gaps">, section: ReportSection, ctx?: BoxContext): Proposal | null {
  const approver = approverOf(report);
  if (!approver || !isClinicianBox(report, section, ctx)) return null;
  if (adoptionCurrent(section, approver)) return null;
  const by: Array<Pick<Actor, "memberId" | "name" | "role">> = [];
  // R1T-WC-02: who is already listed, by member id and by name and role (a Set – never a search per paragraph).
  const listed = new Set<string>();
  let unstamped = false;
  const add = (stamp: Pick<Actor, "memberId" | "name" | "role"> | undefined) => {
    if (!stamp) unstamped = true;
    else if (!sameMember(stamp, approver)) {
      const idKey = stamp.memberId && stamp.memberId !== UNKNOWN_MEMBER ? `id:${stamp.memberId}` : null;
      const nameKey = `name:${stamp.role}:${stamp.name}`;
      if ((idKey && listed.has(idKey)) || listed.has(nameKey)) return;
      if (idKey) listed.add(idKey);
      listed.add(nameKey);
      by.push(stamp);
    }
  };
  for (const p of section.paragraphs) {
    if (!isPersonParagraph(p) || !p.text.trim()) continue;
    // Origin "clinician" with no stamp: the clinician's own words, as it has always meant (the review stamps every
    // paragraph it writes, and the store refuses "clinician" text from anyone but the approver).
    if (!p.by && p.origin === "clinician") continue;
    if (!p.by || !sameMember(p.by, approver)) add(p.by);
  }
  if (answerSet(section.answer)) {
    if (section.answerBy) {
      if (!sameMember(section.answerBy, approver)) add(section.answerBy);
    } else if (!answerDraftedOrFromRecords(report, section, ctx)) {
      // harden-WC (check2-WC major B): an answer nobody's stamp vouches for, which neither drafting nor the records
      // gave (the review stamps every answer a person sets) – someone's entry, waiting for the approver.
      add(undefined);
    }
  }
  const stale = Boolean(section.adoptedBy && sameMember(section.adoptedBy.by, approver));
  if (by.length === 0 && !unstamped && !stale) return null;
  const list = [...by.map((b) => enteredByName(b)), ...(unstamped ? [enteredByName(null)] : [])];
  const names = list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}` : (list[0] ?? "");
  return { by, names, stale, summary: names ? `Entered by ${names}` : `Changed since ${approver.name} last confirmed it` };
}

/**
 * R1T-WC-08: what someone other than the approver typed into a box that is not a clinician box and that cites nothing
 * (a staff answer in a narrative box – UNCITED_PARAGRAPH blocks it and nobody may acknowledge that), or null. The
 * approver's remedy is the same audited "Adopt" as in a clinician box (adoptBox): their words keep "Entered by Pat
 * Morgan (staff)", the label adds "– adopted by Sarah Reid", and the approver takes them as their own (origin
 * "clinician", no citation needed) – never "These are my own words", which is for the approver's own rewrites. A
 * paragraph that still keeps drafted residue is not offered (it stays drafted text). Only on a report with an approver.
 */
export function uncitedOthersText(report: Pick<Report, "approver" | "gaps">, section: ReportSection, ctx?: BoxContext): Proposal | null {
  const approver = approverOf(report);
  if (!approver || section.kind === "declaration" || section.kind === "from_records" || isClinicianBox(report, section, ctx)) return null;
  if (adoptionCurrent(section, approver)) return null;
  const by: Array<Pick<Actor, "memberId" | "name" | "role">> = [];
  const listed = new Set<string>();
  for (const p of section.paragraphs) {
    if (!othersUncitedParagraph(section, p, approver)) continue;
    const stamp = p.by ?? { memberId: UNKNOWN_MEMBER, name: "staff", role: "staff" as const };
    const k = `${stamp.memberId}|${stamp.name}|${stamp.role}`;
    if (listed.has(k)) continue;
    listed.add(k);
    by.push(stamp);
  }
  if (by.length === 0) return null;
  const list = by.map((b) => enteredByName(b));
  const names = list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}` : list[0];
  return { by, names, stale: false, summary: `Entered by ${names}` };
}

/** A person's paragraph someone other than the approver typed, citing nothing, with no drafted residue (uncitedOthersText). */
export function othersUncitedParagraph(section: Pick<ReportSection, "paragraphs" | "tombstones">, p: Paragraph, approver: ReportApprover | null): boolean {
  if (!approver || !p.text.trim() || p.sourceIds.length > 0) return false;
  if (p.origin !== "edited") return false;
  if (p.origin === "edited" && p.originalText !== undefined) return false;
  if (p.by && sameMember(p.by, approver)) return false;
  return paragraphResidue(section, p).length === 0;
}

/**
 * A structured answer that says something – anything but a clear: null or "" (the review clears with these, reducer
 * setStructuredAnswer), or an empty table (rows []). R2-TPN-01 (final check, fix r2c): an empty list on a yes/no, tick
 * box, choice, date or number box is NOT a clear – it used to read as one here (no stamp needed) while
 * isSectionAnswered counted it answered (no MISSING_PLACEHOLDER), so an unstamped `value: []` blanked a records or
 * drafted answer and was signed. Now every value isSectionAnswered counts as answered is set here (it needs a stamp),
 * the store refuses a list on those kinds and blank words outright (store-reports.ts answerValueMalformed), and
 * isSectionAnswered counts them unanswered.
 */
export function answerSet(answer: ReportSection["answer"]): boolean {
  if (!answer || answer.kind === "text") return false;
  const v = answer.value;
  if (v === null || v === "") return false;
  return !(answer.kind === "rows" && Array.isArray(v) && v.length === 0);
}

/**
 * Whether a box's unstamped answer is one drafting, the records or the approver's own words give (harden-WC, check2-WC
 * major B): a box filled from the records (by code, when the report was made), or one whose answer the box's text
 * backs – drafted text (a drafted paragraph, or drafted text a person edited) or the clinician's own words – or a
 * question about it that is still open or that the approver settled (a drafted answer that cites nothing raises one,
 * ai/assemble.ts). Anything else unstamped is someone's entry: the review stamps every answer a person sets
 * (Section.answerBy).
 */
function answerDraftedOrFromRecords(report: Pick<Report, "approver" | "gaps">, section: Pick<ReportSection, "key" | "kind" | "paragraphs">, ctx?: BoxContext): boolean {
  const physioChoice = isPhysioChoiceBox(ctx, section.key);
  if (section.kind === "from_records" && !physioChoice) return true;
  const approver = approverOf(report);
  // R1T-WC-03 (SAF-2): drafting never answers an opinion box (it holds every drafted opinion back), and nothing but a
  // person answers the physiotherapist's choice, so neither drafted text nor an open question there vouches for an answer
  // no one's stamp vouches for – it is someone's entry, a proposal the approver adopts. Only the approver's own words, or
  // a question of the box they settled, back it.
  const opinion = physioChoice || isOpinionBox(section, ctx);
  // The clinician's own words in the box (origin "clinician": only the approver writes it – the store refuses it from
  // anyone else) back its answer as they always have.
  const backs = (p: ReportSection["paragraphs"][number]) =>
    (!opinion && (p.origin === "ai" || (p.origin === "edited" && p.originalText !== undefined))) || (p.origin === "clinician" && (!p.by || sameMember(p.by, approver)));
  if (section.paragraphs.some((p) => p.text.trim() !== "" && backs(p))) return true;
  return gapsOfBox(report.gaps, section.key).some((g) => (!opinion && !g.resolution) || (Boolean(g.resolution?.by) && sameMember(g.resolution?.by, approver)));
}

const sameJson = (a: unknown, b: unknown) => canonicalize(a ?? null) === canonicalize(b ?? null);

/**
 * Whether a change to a clinician box (the box `key` in `before` → `after`, both with the same approver) takes away
 * what the approving clinician confirmed there – their own paragraphs (stamped by them, or unstamped "clinician"
 * text) and their own answer; everything in the box while their adoption covered it, or once they settled one of its
 * clinician gaps – WITHOUT the box then reading as a proposal (pendingProposal). The review undoes such a change and
 * the store refuses it (403): what the approver said is never removed or replaced behind their back (problem E1). The
 * review itself always leaves a trace (its stale adoption, or the person's stamp), so this only refuses what a
 * modified client, or a box confirmed before adoptions were stamped, would lose silently.
 */
export function approverEntryLost(before: Report, after: Report, key: string, ctx?: BoxContext): boolean {
  const approver = approverOf(after);
  if (!approver || !before.approver || !sameMember(before.approver, approver)) return false;
  const was = sectionByKey(before.sections, key);
  if (!was || !isClinicianBox(before, was, ctx)) return false;
  const now = sectionByKey(after.sections, key);
  const whole =
    adoptionCurrent(was, approver) ||
    gapsOfBox(before.gaps, key).some((g) => g.resolution && !g.resolution.notApplicable && sameMember(g.resolution.by, approver));
  let lost = false;
  for (const p of was.paragraphs) {
    if (!p.text.trim()) continue;
    const own = isPersonParagraph(p) && (p.by ? sameMember(p.by, approver) : p.origin === "clinician");
    if (!whole && !own) continue;
    const q = now ? paragraphById(now.paragraphs, p.id) : undefined;
    if (!q || q.text !== p.text || !sameJson(q.sourceIds, p.sourceIds)) {
      lost = true;
      break;
    }
  }
  if (!lost && answerSet(was.answer) && (whole || (was.answerBy && sameMember(was.answerBy, approver))) && !sameJson(now?.answer, was.answer)) lost = true;
  if (!lost) return false;
  return !now || pendingProposal(after, now, ctx) === null;
}

/**
 * The decisions on a report that do not stand for `keeps` (WC design 1's takeover; the store's import of a case from
 * the public demo): acceptances, adoptions, acknowledgements, own-words records, paragraph acknowledgement reasons and
 * approver-only dispositions made by anyone else are removed; "clinician" text anyone else wrote becomes a proposal
 * ("edited", or "staff" in a record box); clinician gaps someone else settled open again. Pure.
 */
export function voidDecisionsNotBy(report: Report, keeps: (by: { memberId?: string } | null | undefined) => boolean, ctx: RuleContext = {}): Pick<Report, "sections" | "gaps" | "flags"> {
  const ruledOut = ruledOutByRule(report, ctx);
  const sections = report.sections.map((s): ReportSection => {
    const next: ReportSection = { ...s };
    if (next.accepted?.length) {
      const kept = next.accepted.filter((a) => keeps(a.by));
      if (kept.length) next.accepted = kept;
      else delete next.accepted;
    }
    if (next.adoptedBy && !keeps(next.adoptedBy.by)) delete next.adoptedBy;
    if (next.disposition && !keeps(next.disposition.by) && (next.disposition.kind === "applies_anyway" || isClinicianBox(report, s, ctx))) delete next.disposition;
    next.paragraphs = s.paragraphs.map((p): Paragraph => {
      const q: Paragraph = { ...p };
      delete q.ackReason;
      if (q.ownWords && !keeps(q.ownWords.by)) delete q.ownWords;
      if (q.origin === "clinician" && !keeps(q.by)) q.origin = s.kind === "from_records" ? "staff" : "edited";
      return q;
    });
    return next;
  });
  const voided = { ...report, sections };
  const gaps = report.gaps.map((g) => {
    // R1T-WC-05: "not applicable" stands only where the box really is ruled out (ruledOutByRule), never on a claim.
    if (!g.resolution || (g.resolution.notApplicable && ruledOut.has(g.sectionKey)) || keeps(g.resolution.by) || !isClinicianGap(voided, g, ctx)) return g;
    const open = { ...g };
    delete open.resolution;
    return open;
  });
  const flags = report.flags.map((f) => {
    if (!f.acknowledged || keeps(f.acknowledged.by) || f.severity === "warning") return f;
    const open = { ...f };
    delete open.acknowledged;
    return open;
  });
  return { sections, gaps, flags };
}

/** BoxContext plus the form map itself, for the issue state's reading of the boxes (ruledOutByRule). */
export interface RuleContext extends BoxContext {
  /** The referrer's form map (form reports), as the issue state reads it (core/issue-state.ts issueDetails). */
  form?: Pick<FormDefinition, "fields"> | null;
}

const ruledOutCache = new WeakMap<object, { form: unknown; keys: Set<string> }>();

/**
 * R1T-WC-05 (SAF-4): the boxes a rule rules out – their condition as the server reads it (core/issue-state.ts: the form
 * map's reading for a report of this release, the conditions frozen when it was created otherwise) or a session the
 * patient did not attend – never a person's "not applicable" decision, and never a box the approver chose to print
 * anyway. Only there may a question about the box be settled as "not applicable" (gaps.ts settleConditionalGaps) by
 * anyone: everywhere else such a resolution is checked like any other (a clinician gap is the approver's). Worked out once
 * per report (the report is immutable).
 */
export function ruledOutByRule(report: Report, ctx: RuleContext = {}): ReadonlySet<string> {
  const form = ctx.form ?? null;
  const hit = ruledOutCache.get(report);
  if (hit && hit.form === form) return hit.keys;
  const keys = new Set<string>();
  try {
    for (const box of issueDetails(report, form)) {
      if (box.state.kind === "not_applicable" && (box.state.reason === "condition" || box.state.reason === "session_not_attended")) keys.add(box.key);
    }
  } catch {
    // A report the issue state cannot read rules nothing out: every question stays someone's to settle.
  }
  ruledOutCache.set(report, { form, keys });
  return keys;
}

/* ------------------------------------------------------------------------------------------------
 * Drafted residue
 * ----------------------------------------------------------------------------------------------*/

/** A span of a person's text that reproduces a drafted sentence at least this closely keeps drafted strictness. */
export const RESIDUE_THRESHOLD = 0.8;
/** Drafted sentences shorter than this (in words) count only where a whole sentence of the text repeats them. */
export const SHORT_SENTENCE_TOKENS = 4;
/**
 * The longest span a drafted sentence of m words is looked for in: 1.5 × m words, so a drafted opinion with a clause
 * inserted inside it ("He is expected, given the progress he has shown so far, to make a full recovery …") is still
 * drafted residue.
 */
export const RESIDUE_WINDOW_GROWTH = 1.5;
/**
 * R1T-WC-01 (SAF-1): the most words of one drafted sentence a residue window is looked for with. A longer drafted
 * "sentence" – a paragraph with no full stop, a deleted paragraph thousands of words long – counts as runs of at most
 * this many words, each read like a sentence of its own (stricter, not looser: a text that keeps most of such a
 * sentence keeps most of one of its runs). No sentence a draft writes is this long.
 */
export const RESIDUE_MAX_SENTENCE_TOKENS = 60;
/**
 * R1T-WC-01: the most drafted sentences one box's residue check reads. A box with more (no draft writes that many; a
 * forged body may) reads every person's paragraph in it as drafted throughout – the strict reading, never a looser one.
 */
export const RESIDUE_MAX_DRAFTED_SENTENCES = 2000;
/**
 * R1T-WC-01: the word steps one paragraph's residue check may take (each drafted sentence: its words, plus two passes
 * over the paragraph when it could match at all). Beyond it the paragraph is drafted throughout (the strict reading);
 * the same body always gives the same answer, on the client and the server. Real boxes use well under 1% of it.
 */
export const RESIDUE_WORK_BUDGET = 4_000_000;

interface Token {
  t: string;
  start: number;
  end: number;
}

function tokens(text: string): Token[] {
  const out: Token[] = [];
  const re = /[A-Za-z0-9À-ɏ]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push({ t: m[0].toLowerCase(), start: m.index, end: m.index + m[0].length });
  return out;
}

export interface Span {
  start: number;
  end: number;
}

/**
 * A box's drafted sentences, each once (a Set – never a search per sentence, R1T-WC-02), with the one drafted paragraph
 * that alone gives it (null: an edited paragraph's drafted wording, a tombstone, or two drafted paragraphs give it).
 * Worked out once per paragraphs array and tombstones array (the report is immutable).
 */
interface DraftedSet {
  tombstones: unknown;
  sentences: Map<string, string | null>;
}
const draftedCache = new WeakMap<object, DraftedSet>();

function draftedSetOf(section: Pick<ReportSection, "paragraphs" | "tombstones">): DraftedSet {
  const hit = draftedCache.get(section.paragraphs);
  if (hit && hit.tombstones === section.tombstones) return hit;
  const sentences = new Map<string, string | null>();
  const add = (text: string, owner: string | null) => {
    for (const s of splitSentences(text, "prose")) {
      if (!sentences.has(s.text)) sentences.set(s.text, owner);
      else if (sentences.get(s.text) !== owner) sentences.set(s.text, null);
    }
  };
  for (const p of section.paragraphs) {
    if (p.origin === "ai") add(p.text, p.id);
    else if (p.origin === "edited" && p.originalText !== undefined) add(p.originalText, null);
  }
  for (const t of section.tombstones ?? []) add(t.text, null);
  const set: DraftedSet = { tombstones: section.tombstones, sentences };
  draftedCache.set(section.paragraphs, set);
  return set;
}

/** The drafted sentences of a box: its drafted paragraphs, the drafted wording of edited ones, and tombstones. */
export function draftedSentences(section: Pick<ReportSection, "paragraphs" | "tombstones">, opts: { exceptParagraphId?: string } = {}): string[] {
  const out: string[] = [];
  draftedSetOf(section).sentences.forEach((owner, text) => {
    if (owner === null || owner !== opts.exceptParagraphId) out.push(text);
  });
  return out;
}

/** A drafted sentence's words as the runs a window is looked for with (RESIDUE_MAX_SENTENCE_TOKENS). */
function runsOf(words: readonly string[]): string[][] {
  if (words.length <= RESIDUE_MAX_SENTENCE_TOKENS) return [words.slice()];
  const k = Math.ceil(words.length / RESIDUE_MAX_SENTENCE_TOKENS);
  const size = Math.ceil(words.length / k);
  const out: string[][] = [];
  for (let i = 0; i < words.length; i += size) out.push(words.slice(i, i + size));
  return out;
}

/**
 * Where the text (its words as ids, `seq`) reproduces a drafted sentence of m words (`want`: how often each id is in
 * it): the shortest window, from m up to RESIDUE_WINDOW_GROWTH × m words, that holds at least RESIDUE_THRESHOLD of them
 * (each drafted word counted as often as the sentence has it) – its best-scoring position, trimmed to its first and
 * last drafted word – or null. Shortest first, so a kept drafted sentence next to the person's own sentence never
 * reaches into it.
 * R1T-WC-01 (SAF-1): linear in the text. What a window holds only grows with it, so the shortest length that holds
 * enough is found with two pointers in one pass (then the earliest best window of that length in one more) – the same
 * window the earlier search tried every length from m to 1.5 m for, which was quadratic in the sentence's length.
 * `have` is all zeros on entry and on return.
 */
function residueWindow(seq: Int32Array, want: Int32Array, have: Int32Array, m: number): { start: number; end: number } | null {
  const n = seq.length;
  const minLen = Math.min(m, n);
  const maxLen = Math.min(n, Math.max(minLen, Math.ceil(m * RESIDUE_WINDOW_GROWTH)));
  const enough = (overlap: number) => overlap / m >= RESIDUE_THRESHOLD;
  // 1. The shortest window anywhere that holds enough (it can only be extended to minLen, never needs to be shorter).
  let shortest = Infinity;
  let overlap = 0;
  let l = 0;
  let added = 0;
  while (added < n) {
    const id = seq[added];
    if (have[id] < want[id]) overlap += 1;
    have[id] += 1;
    added += 1;
    while (enough(overlap)) {
      const len = added - l;
      if (len < shortest) shortest = len;
      const o = seq[l];
      have[o] -= 1;
      if (have[o] < want[o]) overlap -= 1;
      l += 1;
    }
    if (shortest <= minLen) break;
  }
  for (let i = l; i < added; i++) have[seq[i]] = 0;
  if (shortest === Infinity) return null;
  const len = Math.max(minLen, shortest);
  if (len > maxLen) return null;
  // 2. The earliest best-scoring window of that length.
  overlap = 0;
  let best = -1;
  let bestAt = -1;
  for (let i = 0; i < n; i++) {
    const id = seq[i];
    if (have[id] < want[id]) overlap += 1;
    have[id] += 1;
    if (i >= len) {
      const o = seq[i - len];
      have[o] -= 1;
      if (have[o] < want[o]) overlap -= 1;
    }
    if (i >= len - 1 && overlap > best) {
      best = overlap;
      bestAt = i - len + 1;
    }
  }
  for (let i = Math.max(0, n - len); i < n; i++) have[seq[i]] = 0;
  if (bestAt < 0 || !enough(best)) return null;
  let start = bestAt;
  let end = bestAt + len - 1;
  while (start < end && want[seq[start]] === 0) start += 1;
  while (end > start && want[seq[end]] === 0) end -= 1;
  return { start, end };
}

/**
 * The spans of `text` that reproduce one of `drafted` (sentences) with at least RESIDUE_THRESHOLD of its words, in
 * order; overlapping spans are merged. A drafted sentence of fewer than SHORT_SENTENCE_TOKENS words matches only a
 * whole sentence of `text` with the same words.
 * R1T-WC-01 (SAF-1): bounded. A drafted sentence the text cannot reproduce (it holds too few of its words at all) costs
 * only its own words; the rest cost two linear passes (residueWindow). More than RESIDUE_MAX_DRAFTED_SENTENCES, or more
 * work than RESIDUE_WORK_BUDGET, and the whole text is drafted residue – the strict reading.
 */
export function residueSpans(text: string, drafted: readonly string[]): Span[] {
  const all = tokens(text);
  if (all.length === 0 || drafted.length === 0) return [];
  const whole: Span[] = [{ start: 0, end: text.length }];
  if (drafted.length > RESIDUE_MAX_DRAFTED_SENTENCES) return whole;
  // The text's words as ids, once.
  const ids = new Map<string, number>();
  const seq = new Int32Array(all.length);
  for (let i = 0; i < all.length; i++) {
    let id = ids.get(all[i].t);
    if (id === undefined) {
      id = ids.size;
      ids.set(all[i].t, id);
    }
    seq[i] = id;
  }
  const inText = new Int32Array(ids.size);
  for (let i = 0; i < seq.length; i++) inText[seq[i]] += 1;
  const want = new Int32Array(ids.size);
  const have = new Int32Array(ids.size);
  const touched: number[] = [];
  let work = all.length;
  let sentenceKeys: Map<string, Span[]> | null = null;
  const spans: Span[] = [];
  for (const d of drafted) {
    const words = tokens(d).map((x) => x.t);
    work += words.length;
    if (words.length === 0) continue;
    if (words.length < SHORT_SENTENCE_TOKENS) {
      if (!sentenceKeys) {
        sentenceKeys = new Map();
        for (const s of splitSentences(text, "prose")) {
          const key = tokens(s.text).map((x) => x.t).join(" ");
          const list = sentenceKeys.get(key);
          if (list) list.push({ start: s.start, end: s.end });
          else sentenceKeys.set(key, [{ start: s.start, end: s.end }]);
        }
        work += all.length;
      }
      for (const sp of sentenceKeys.get(words.join(" ")) ?? []) spans.push({ ...sp });
      continue;
    }
    for (const run of runsOf(words)) {
      const m = run.length;
      // How many of its words the text holds at all: a sentence it cannot reproduce costs no pass over the text.
      let possible = 0;
      for (const t of run) {
        const id = ids.get(t);
        if (id === undefined) continue;
        if (want[id] === 0) touched.push(id);
        want[id] += 1;
        if (want[id] <= inText[id]) possible += 1;
      }
      if (possible / m >= RESIDUE_THRESHOLD) {
        work += 2 * all.length;
        if (work > RESIDUE_WORK_BUDGET) return whole;
        const w = residueWindow(seq, want, have, m);
        if (w) spans.push({ start: all[w.start].start, end: all[w.end].end });
      }
      for (const id of touched) want[id] = 0;
      touched.length = 0;
    }
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
 * R1T-WC-01: a paragraph's residue against its box, worked out once – the acknowledgement policy asks for it once per
 * opinion or voice flag (validation/acknowledge.ts), and the validators, the store and the review ask again. Keyed on the
 * paragraph and checked against the box's paragraphs and tombstones (all immutable).
 */
const residueCache = new WeakMap<object, { paragraphs: unknown; tombstones: unknown; text: string; spans: Span[] }>();

function residueOfParagraph(section: Pick<ReportSection, "paragraphs" | "tombstones">, paragraph: Paragraph, drafted: readonly string[]): Span[] {
  const hit = residueCache.get(paragraph);
  if (hit && hit.paragraphs === section.paragraphs && hit.tombstones === section.tombstones && hit.text === paragraph.text) return hit.spans;
  const spans = residueSpans(paragraph.text, drafted);
  residueCache.set(paragraph, { paragraphs: section.paragraphs, tombstones: section.tombstones, text: paragraph.text, spans });
  return spans;
}

/**
 * The drafted residue in a paragraph of a box: drafted text itself is drafted throughout; a person's paragraph keeps
 * drafted strictness where it reproduces a drafted sentence of the box (residueSpans). `forAcknowledgement`: an
 * edited paragraph whose words are exactly its drafted wording is taken as the person's edit as stored – the safety
 * corpus's model of edited text (its "~origin-edited" variants and OPN-carrier-08: the approver acknowledges) – so the
 * approver may acknowledge its checks as on any edited text; for "These are my own words" and adoption it is still
 * drafted throughout. Neither the review nor the store can produce it from drafted text: the review turns such a
 * paragraph back into drafted text, and the store refuses relabelling drafted text as a person's without a change, and
 * any rewrite of the drafted wording (api/handlers/store-reports.ts, check-WC minor 8).
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
  return residueOfParagraph(section, paragraph, drafted);
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

