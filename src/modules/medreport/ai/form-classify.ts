import "server-only";

/**
 * Deterministic label classifier for referrer form questions. Used:
 * - in rules mode (no AI call): to propose an answer type and a fill source for every answer space;
 * - after a live or recorded analysis (form-postvalidate.ts): to ENFORCE the two safety rules –
 *   identifiers are always filled by code from registration (never drafted), and opinion questions
 *   are always "clinician_opinion" (only a recorded opinion may be attributed).
 *
 * Plain keyword rules over the printed label (and its section heading). UK form wording.
 *
 * Owner: ai agent.
 */
import type { AnswerType, FactId, FillSource, OutcomeInstrument, RegistrationPath } from "../core/types";

export interface LabelClass {
  /** Best guess at the fill source. */
  fillSource: FillSource;
  /** Answer type suggested by the wording (null = keep what the layout suggests). */
  answerType: AnswerType | null;
  /** True when the label asks for something identifying the patient (forced to registration). */
  identifier: boolean;
  /** True when the wording always asks for a clinical opinion (forced to clinician_opinion). */
  opinion: boolean;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\s+/g, " ")
    .trim();

const reg = (path: RegistrationPath): FillSource => ({ kind: "registration", path });

const SIGNOFF_CONTEXT = /\b(?:declaration|sign(?:ed|ature|-off| off)?|statement of truth|confirm(?:ation)?|attestation)\b/;

const OUTCOMES: Array<[RegExp, OutcomeInstrument]> = [
  [/\bndi\b|neck disability index/, "NDI"],
  [/\bodi\b|oswestry/, "ODI"],
  [/\bnprs\b|numeric(?:al)? pain rating|pain score/, "NPRS"],
  [/\bpsfs\b|patient[- ]specific functional scale/, "PSFS"],
  [/quick ?dash/, "QuickDASH"],
];

/** Registration paths by label wording (identifiers first). */
function registrationFor(label: string, inSignoff: boolean): { path: RegistrationPath; identifier: boolean; answerType: AnswerType | null } | null {
  const l = label;
  if (/\b(?:date of birth|d\.?o\.?b\.?|birth date)\b/.test(l)) return { path: "patient.dob", identifier: true, answerType: "date" };
  if (/\b(?:forename|first name|given name)s?\b/.test(l)) return { path: "patient.firstName", identifier: true, answerType: "short_text" };
  if (/\b(?:surname|last name|family name)\b/.test(l)) return { path: "patient.lastName", identifier: true, answerType: "short_text" };
  if (
    /\b(?:claimant|patient|client|employee|injured party|applicant|member|policy ?holder|insured)(?:'s)? (?:full )?name\b/.test(l) ||
    /^(?:full )?name(?: of (?:claimant|patient|client|employee|injured party))?\s*:?$/.test(l) ||
    /^(?:the )?(?:claimant|patient|client|employee|injured party|insured)\s*:?$/.test(l)
  ) {
    if (inSignoff) return null;
    return { path: "patient.fullName", identifier: true, answerType: "short_text" };
  }
  if (/\b(?:claimant|patient|client|employee|home)(?:'s)? address\b|^address\s*:?$/.test(l)) return { path: "patient.address", identifier: true, answerType: "long_text" };
  if (/^age\b|\bage of (?:claimant|patient|employee)\b|\bage at\b/.test(l)) return { path: "patient.age", identifier: false, answerType: "number" };
  if (/^(?:sex|gender)\b/.test(l)) return { path: "patient.sex", identifier: false, answerType: "short_text" };
  if (/\b(?:occupation|job title|job role|position held)\b/.test(l)) return { path: "patient.occupation", identifier: false, answerType: "short_text" };
  if (/\bemployer(?:'s name)?\s*:?$|\bname of employer\b/.test(l)) return { path: "patient.employer", identifier: false, answerType: "short_text" };
  if (/\b(?:your|our|referrer|instructing|case|claim|file|matter|policy|oh|occupational health|insurer|solicitor|mlc|agency|client|employer)(?:'s)? ?(?:ref(?:erence)?|no\.?|number)\b|\breference(?: no\.?| number)?\s*:?$|^ref(?:erence)?(?: no\.?| number)?\s*:?$/.test(l)) {
    return { path: "referral.reference", identifier: true, answerType: "short_text" };
  }
  if (/\b(?:instructing party|referrer|referring (?:organisation|company)|solicitor|insurer|case manager)(?:'s)? name\b/.test(l)) {
    return { path: "referral.referrerName", identifier: false, answerType: "short_text" };
  }
  if (/\bdate of (?:the )?(?:accident|incident|injury|index event|collision|rta)\b|\b(?:accident|incident|injury) date\b/.test(l)) {
    return { path: "incident.date", identifier: false, answerType: "date" };
  }
  if (/\bdate (?:of )?(?:first|initial) (?:seen|appointment|assessment|treatment|attendance|consultation)\b|\b(?:first|initial) (?:appointment|assessment|treatment) date\b|\bdate first seen\b|\b(?:date )?treatment (?:started|commenced|began)\b|\bstart date of treatment\b/.test(l)) {
    return { path: "episode.firstSeen", identifier: false, answerType: "date" };
  }
  if (/\bdate (?:of )?(?:last|final|most recent) (?:seen|appointment|assessment|treatment|attendance|consultation)\b|\bdate last seen\b/.test(l)) {
    return { path: "episode.lastSeen", identifier: false, answerType: "date" };
  }
  if (/\b(?:date of discharge|discharge date)\b/.test(l)) return { path: "episode.dischargeDate", identifier: false, answerType: "date" };
  if (/\b(?:date of (?:this )?report|report date)\b/.test(l)) return { path: "report.date", identifier: false, answerType: "date" };
  if (/\b(?:clinic|practice|provider)(?:'s)? name\b|\bname of (?:clinic|practice|provider)\b/.test(l)) return { path: "clinic.name", identifier: false, answerType: "short_text" };
  if (/\b(?:clinic|practice|provider)(?:'s)? address\b/.test(l)) return { path: "clinic.address", identifier: false, answerType: "long_text" };
  if (!inSignoff) {
    if (/\b(?:treating )?(?:physiotherapist|clinician|therapist|practitioner)(?:'s)? name\b|\bname of (?:the )?(?:treating )?(?:physiotherapist|clinician|therapist|practitioner)\b|\btreating (?:physiotherapist|clinician|therapist)\b/.test(l)) {
      return { path: "clinician.name", identifier: false, answerType: "clinician_name" };
    }
    if (/\bhcpc\b|\b(?:professional )?registration (?:no\.?|number)\b/.test(l)) return { path: "clinician.hcpc", identifier: false, answerType: "hcpc_number" };
    if (/\b(?:profession|professional qualifications?|job title of clinician)\b/.test(l)) return { path: "clinician.profession", identifier: false, answerType: "short_text" };
  }
  return null;
}

const OPINION_RE =
  /\b(?:prognos\w*|in your (?:professional )?opinion|your opinion|opinion|restrictions?|limitations?|recommend\w*|fit (?:for|to) (?:work|return|drive|duties)|fitness (?:for|to) work|return to (?:work|normal|full) duties|return to work|adjustments?|causation|caused by|attributable|consistent with (?:the )?(?:accident|incident|mechanism)|further treatment|further sessions|future treatment|ongoing treatment|estimated|expected (?:recovery|duration)|recovery (?:period|time)|likely to|permanent\w*|long[- ]term|residual (?:symptoms|disability)|capable of|able to (?:work|drive|return)|work capacity|phased return|should|reviewed|review date|maximum medical improvement|mmi|(?:likely|expected|long[- ]term|final) outcome)\b/;

/** Wording that always asks for the clinician's opinion (enforced after an AI analysis). */
const STRONG_OPINION_RE =
  /\b(?:prognos\w*|in your (?:professional )?opinion|causation|caused by|attributable to|(?:un)?fit (?:for|to)|fitness (?:for|to) work|return to work|restrictions? (?:on|to)|functional restrictions?|recommend\w*|permanent\w*)\b/;

const LEAVE_BLANK_RE =
  /\b(?:office use|official use|internal use|for (?:[\w&'-]+ ){0,4}use only|invoice|payment|bank|sort code|account (?:no|number)|vat|fee|billing|claims handler|for completion by (?:the )?(?:solicitor|insurer|referrer|agency))\b/;

/** Classify a printed label (and its section heading). */
export function classifyLabel(label: string, section?: string): LabelClass {
  const l = norm(label);
  const sec = norm(section ?? "");
  const inSignoff = SIGNOFF_CONTEXT.test(sec) || /^(?:signed|signature)\b/.test(l);

  if (LEAVE_BLANK_RE.test(l) || LEAVE_BLANK_RE.test(sec)) {
    return { fillSource: { kind: "leave_blank" }, answerType: null, identifier: false, opinion: false };
  }

  // Sign-off.
  if (/\bsignature\b|^signed\b/.test(l)) return { fillSource: { kind: "signoff", part: "signature" }, answerType: "signature", identifier: false, opinion: false };
  if (inSignoff) {
    if (/\bhcpc\b|\bregistration (?:no\.?|number)\b/.test(l)) return { fillSource: { kind: "signoff", part: "hcpc" }, answerType: "hcpc_number", identifier: false, opinion: false };
    if (/\bname\b/.test(l)) return { fillSource: { kind: "signoff", part: "name" }, answerType: "clinician_name", identifier: false, opinion: false };
    if (/^date\b|\bdate signed\b|\bdate of signature\b/.test(l)) return { fillSource: { kind: "signoff", part: "date" }, answerType: "date_signed", identifier: false, opinion: false };
  }
  if (/\bdate signed\b|\bdate of signature\b|^date\s*:?$/.test(l)) return { fillSource: { kind: "signoff", part: "date" }, answerType: "date_signed", identifier: false, opinion: false };

  // Figures computed by code.
  const countQuestion = l.length <= 70 && !/\b(?:provided|describe|details|summary|including|type of)\b/.test(l);
  if (countQuestion && /\b(?:number|no\.?|total) of (?:sessions|appointments|treatments|treatment sessions|visits|consultations)(?: attended)?\b|\b(?:sessions|appointments|treatments) attended\b/.test(l) && !/\bmissed|dna|did not attend|failed|cancel/.test(l)) {
    return { fillSource: { kind: "computed_fact", factId: "FACT-attendance", format: "sessions_attended" }, answerType: "number", identifier: false, opinion: false };
  }
  if (countQuestion && /\b(?:missed|dna|did not attend|failed to attend|non-?attendance)\b/.test(l) && /\b(?:number|no\.?|how many|appointments|sessions)\b/.test(l)) {
    return { fillSource: { kind: "computed_fact", factId: "FACT-attendance", format: "dna_count" }, answerType: "number", identifier: false, opinion: false };
  }
  if (/^attendance\b|\battendance record\b/.test(l)) {
    return { fillSource: { kind: "computed_fact", factId: "FACT-attendance", format: "summary" }, answerType: null, identifier: false, opinion: false };
  }
  for (const [re, instrument] of OUTCOMES) {
    if (re.test(l)) {
      const factId = `FACT-outcomes-${instrument}` as FactId;
      return { fillSource: { kind: "computed_fact", factId, format: "summary" }, answerType: null, identifier: false, opinion: false };
    }
  }

  const registration = registrationFor(l, inSignoff);
  if (registration) {
    return { fillSource: reg(registration.path), answerType: registration.answerType, identifier: registration.identifier, opinion: false };
  }

  if (STRONG_OPINION_RE.test(l)) return { fillSource: { kind: "clinician_opinion" }, answerType: null, identifier: false, opinion: true };
  if (OPINION_RE.test(l)) return { fillSource: { kind: "clinician_opinion" }, answerType: null, identifier: false, opinion: false };
  if (/\bopinion\b/.test(sec) && !/\b(?:history|examination|findings|treatment provided|symptoms)\b/.test(l)) {
    return { fillSource: { kind: "clinician_opinion" }, answerType: null, identifier: false, opinion: false };
  }

  return { fillSource: { kind: "notes_narrative" }, answerType: null, identifier: false, opinion: false };
}

/** Answer type suggested by the label alone (used when the layout gives no hint). */
export function answerTypeFromLabel(label: string): AnswerType | null {
  const l = norm(label);
  if (/^(?:is|are|was|were|has|have|had|did|does|do|will|would|can|could|should)\b.*\?$/.test(l)) return "yes_no";
  if (/\bdate\b/.test(l) && !/\b(?:to|up to) date\b/.test(l)) return "date";
  if (/\b(?:number of|how many)\b/.test(l)) return "number";
  return null;
}
