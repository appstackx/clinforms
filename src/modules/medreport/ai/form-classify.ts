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
 * Multi-party forms (insurer claim forms): the party that completes the answer space (`completedBy`) is
 * the label's own signer ("Policyholder's signature", "Signature of medical practitioner"), else the
 * section's party (given by the caller from the PDF outline, else read from the section heading: "– to
 * be completed by the policyholder", "Therapist's declaration"), else – for a question put to the patient
 * in the second person ("When did you first notice your symptoms?") – the patient. A part of the form for
 * anyone but the clinic is always leave_blank, and a signature, name or date is the clinician's sign-off
 * only where the clinic signs: never in another party's signature box or declaration.
 *
 * Owner: ai agent.
 */
import { headingParty, isNonClinicParty, partyOfWho, signerParty } from "../core/parties";
import { RegistrationPathSchema } from "../core/schemas";
import type { AnswerType, FactId, FillSource, OutcomeInstrument, Party, RegistrationPath } from "../core/types";

export interface LabelClass {
  /** Best guess at the fill source. */
  fillSource: FillSource;
  /** Answer type suggested by the wording (null = keep what the layout suggests). */
  answerType: AnswerType | null;
  /** True when the label asks for something identifying the patient (forced to registration). */
  identifier: boolean;
  /** True when the wording always asks for a clinical opinion (forced to clinician_opinion). */
  opinion: boolean;
  /** Who the form says completes this answer space (absent = not stated). */
  completedBy?: Party;
  /**
   * A number or name the clinic record does not hold (a scheme's number, the company holding a company
   * policy, a work telephone number, the clinic's provider number): left blank for staff, whatever an
   * analysis proposed (post-validation).
   */
  notHeld?: boolean;
  /** A count in a treatment plan ("Number of sessions" under "Treatment plan"): sessions planned, not attended. */
  plannedCount?: boolean;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\s+/g, " ")
    .trim();

const reg = (path: RegistrationPath): FillSource => ({ kind: "registration", path });

const SIGNOFF_CONTEXT = /\b(?:declaration|declare|sign(?:ed|ature|-off| off)?|statement of truth|confirm(?:ation)?|attestation)\b/;

/**
 * Registration paths added with the insurer-form record fields (patient / clinic phone and e-mail,
 * insurer membership and authorisation numbers). Looked up at run time so this classifier works with
 * and without them: a path the schema does not list yet is never proposed.
 */
const KNOWN_PATHS = new Set<string>(RegistrationPathSchema.options);
function optionalPath(path: string): RegistrationPath | null {
  return KNOWN_PATHS.has(path) ? (path as RegistrationPath) : null;
}

/** A section about the clinic's own practitioner ("Therapist details", "Treating physiotherapist"). */
const CLINICIAN_SECTION = /\b(?:therapist|physio(?:therapist)?|clinician|practitioner|provider|treating)(?:'s|s')?\b/;
const NOT_CLINICIAN_SECTION = /\bmedical practitioner|\b(?:patient|claimant|policy ?holder|member|insured|employee)(?:'s|s')?\b/;
const inClinicianSection = (sec: string) => CLINICIAN_SECTION.test(sec) && !NOT_CLINICIAN_SECTION.test(sec);

const PHONE_RE = /\b(?:tel(?:ephone)?|phone)\b|^mobile\b|\bmobile (?:no\b|numbers?|phone|tel)\b|\bmob\.? no\b|\bcontact (?:no\b|numbers?|telephone|phone)/;
const EMAIL_RE = /\be-?mail\b/;
/** "Number of telephone consultations", "Please email the form to…": not a contact-details box. */
const NOT_CONTACT = /\b(?:consultations?|appointments?|sessions?|calls?|review|follow[- ]up|triage|advice|contacted|treatment)\b|^please\b/;
/** Contact details of someone the clinic record does not hold (GP, solicitor, insurer, other company). */
const OTHERS_CONTACT = /\b(?:gp|doctor|surgery|specialist|consultant|hospital|solicitor|insurer|employer|referrer|case manager|company|third party|next of kin|emergency)\b/;
const CLINIC_CONTACT = /\b(?:clinic|practice|provider|therapist|physio\w*|practitioner|clinician|your (?:practice|clinic))\b/;

/** Phone, e-mail and fax labels: the patient's or the clinic's details by code, anyone else's left blank. */
function contactFor(label: string, sec: string): { source: FillSource; identifier: boolean } | null {
  if (label.length > 70 || NOT_CONTACT.test(label)) return null;
  const phone = PHONE_RE.test(label);
  const email = EMAIL_RE.test(label);
  if (/\bfax\b/.test(label)) return { source: { kind: "leave_blank" }, identifier: false };
  if (!phone && !email) return null;
  if (OTHERS_CONTACT.test(label)) return { source: { kind: "leave_blank" }, identifier: false };
  const clinic = CLINIC_CONTACT.test(label) || inClinicianSection(sec);
  const path = optionalPath(`${clinic ? "clinic" : "patient"}.${email ? "email" : "phone"}`);
  // Never drafted: without the record path the staff member fills it in.
  return { source: path ? reg(path) : { kind: "leave_blank" }, identifier: !clinic };
}

const PROVIDER_NUMBER = /\b(?:provider|practitioner|recognition|supplier|payee) (?:no\.?|number|code|id)\b/;
const MEMBERSHIP_NUMBER = /\b(?:membership|member|customer)(?:'s)? ?(?:no\.?|number|id)\b/;
/** A company or group scheme's own number – not the patient's membership number. */
const SCHEME_NUMBER = /\b(?:scheme|group|company|corporate)(?:'s)? ?(?:no\.?|number|id)\b/;
/** The company that holds a company policy ("Company name (if a company policy)"). */
const COMPANY_POLICY = /^(?:company|employer)(?:'s)? name\b.*\bpolicy\b|^name of (?:the )?company\b.*\bpolicy\b/;
/** A work telephone number (a bare "Work" box under "Telephone numbers: Home … Work …"). */
const WORK_PHONE = /^(?:work|office|business)(?: (?:tel(?:ephone)?|phone)(?: (?:no\.?|number))?)?\s*:?$/;
const AUTHORISATION_NUMBER = /\b(?:pre-?)?authori[sz]ation (?:no\.?|number|code|reference|ref)\b|\bauth(?:orisation)? code\b/;

/** A question put to the patient in the second person ("When did you first notice your symptoms?"). */
const SECOND_PERSON = /\b(?:you|your|yourself|you've|you're|you'll)\b/;
const PATIENT_TOPIC =
  /\b(?:doctor|gp|symptoms?|illness|medication|prescri\w*|insurance|insurer|policy|pregnan\w*|hospital|wrong with you|need (?:any )?(?:further )?treatment|your (?:medical )?condition|your injury|your claim|your health)\b/;
const THIRD_PERSON = /\b(?:patient|claimant|client|member|policy ?holder|insured|employee|injured party|physio\w*|therapist|practitioner|clinician|hcpc|treating)s?\b/;
const CLINICIAN_YOU =
  /\byou (?:have )?(?:provided|gave|given|treated|are treating|assessed|examined|saw|seen|recommend\w*|referred|carried out|performed|plan|propose|expect|consider)\b|\byour (?:opinion|assessment|findings|clinical|professional|practice|clinic|patient)\b/;
function asksThePatient(label: string): boolean {
  return SECOND_PERSON.test(label) && PATIENT_TOPIC.test(label) && !THIRD_PERSON.test(label) && !CLINICIAN_YOU.test(label);
}

/** "Doctor's name", "Name of medical practitioner" inside a declaration: the signer's party. */
function signerNameParty(label: string): Party | null {
  const m = /^(.{2,40}?)(?:'s|s')? (?:full |printed )?name\b|\bname of (?:the )?(.{2,40})/.exec(label);
  if (!m) return null;
  return partyOfWho(m[1] ?? m[2] ?? "");
}

const OUTCOMES: Array<[RegExp, OutcomeInstrument]> = [
  [/\bndi\b|neck disability index/, "NDI"],
  [/\bodi\b|oswestry/, "ODI"],
  [/\bnprs\b|numeric(?:al)? pain rating|pain score/, "NPRS"],
  [/\bpsfs\b|patient[- ]specific functional scale/, "PSFS"],
  [/quick ?dash/, "QuickDASH"],
];

const FIRST_SCORE = /\b(?:initial|baseline|first|start(?:ing)?|pre-treatment)\s+(?:score|assessment|measure|outcome|result)s?\b/;
const LATEST_SCORE = /\b(?:current|latest|most recent|final|end|discharge|present|post-treatment)\s+(?:score|assessment|measure|outcome|result)s?\b/;

/** "Initial score" → first_score, "Current score" → latest_score (label first, then its context); else the summary. */
export function scoreFormat(label: string, context: string): "first_score" | "latest_score" | "summary" {
  for (const text of [label, context]) {
    const first = FIRST_SCORE.test(text);
    const latest = LATEST_SCORE.test(text);
    if (first !== latest) return first ? "first_score" : "latest_score";
  }
  return "summary";
}

/** Registration paths by label wording (identifiers first). */
function registrationFor(label: string, inSignoff: boolean, sec = ""): { path: RegistrationPath; identifier: boolean; answerType: AnswerType | null } | null {
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
    // A bare "Name" under the therapist's details is the clinician's, not the patient's.
    if (/^(?:full )?name\s*:?$/.test(l) && inClinicianSection(sec)) return { path: "clinician.name", identifier: false, answerType: "clinician_name" };
    return { path: "patient.fullName", identifier: true, answerType: "short_text" };
  }
  if (/\b(?:claimant|patient|client|employee|home)(?:'s)? address\b|^address\s*:?$/.test(l)) return { path: "patient.address", identifier: true, answerType: "long_text" };
  if (/^age\b|\bage of (?:claimant|patient|employee)\b|\bage at\b/.test(l)) return { path: "patient.age", identifier: false, answerType: "number" };
  if (/^(?:sex|gender)\b/.test(l)) return { path: "patient.sex", identifier: false, answerType: "short_text" };
  // The patient's title (Mr, Mrs, Ms…), often a radio group or tick boxes: "Title (please tick)".
  if (
    !inSignoff &&
    !inClinicianSection(sec) &&
    /^(?:(?:claimant|patient|client|member|policy ?holder|insured)(?:'s)? )?title(?: \((?:please )?(?:tick|circle|select|state)[^)]*\))?\s*:?$/.test(l)
  ) {
    const path = optionalPath("patient.title");
    if (path) return { path, identifier: false, answerType: null };
  }
  if (/\b(?:occupation|job title|job role|position held)\b/.test(l)) return { path: "patient.occupation", identifier: false, answerType: "short_text" };
  if (/\bemployer(?:'s name)?\s*:?$|\bname of employer\b/.test(l)) return { path: "patient.employer", identifier: false, answerType: "short_text" };
  if (MEMBERSHIP_NUMBER.test(l)) return { path: optionalPath("referral.membershipNumber") ?? "referral.reference", identifier: true, answerType: "short_text" };
  if (AUTHORISATION_NUMBER.test(l)) return { path: optionalPath("referral.authorisationNumber") ?? "referral.reference", identifier: true, answerType: "short_text" };
  if (/\b(?:your|our|referrer|instructing|case|claim|file|matter|policy|oh|occupational health|insurer|solicitor|mlc|agency|client|employer|membership|member|customer|scheme)(?:'s)? ?(?:ref(?:erence)?|no\.?|number)\b|\breference(?: no\.?| number)?\s*:?$|^ref(?:erence)?(?: no\.?| number)?\s*:?$/.test(l)) {
    return { path: "referral.reference", identifier: true, answerType: "short_text" };
  }
  if (/\b(?:instructing party|referrer|referring (?:organisation|company)|solicitor|insurer|case manager)(?:'s)? name\b/.test(l)) {
    return { path: "referral.referrerName", identifier: false, answerType: "short_text" };
  }
  if (/\bdate of (?:the )?(?:accident|incident|injury|index event|collision|rta)\b|\b(?:accident|incident|injury) date\b/.test(l)) {
    return { path: "incident.date", identifier: false, answerType: "date" };
  }
  if (/\bdate (?:of )?(?:first|initial) (?:seen|appointment|assessment|treatment|attendance|consultation)\b|\b(?:first|initial) (?:appointment|assessment|treatment) date\b|\bdate first seen\b|\b(?:date )?treatment (?:started|commenced|began)\b|\bstart date of treatment\b|\btreatment start date\b|\bdate (?:of )?treatment start(?:ed)?\b/.test(l)) {
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

const PREGNANCY_RE =
  /\b(?:pregnan\w*|maternity|childbirth|antenatal|ante-natal|postnatal|fertility treatment|ivf|(?:estimated|expected) date of (?:delivery|birth|confinement)|due date of (?:the )?(?:baby|birth))\b/;

const LEAVE_BLANK_RE =
  /\b(?:office use|official use|internal use|for (?:[\w&'-]+ ){0,4}use only|invoice|payments?|payment method|bank|bank (?:name|address)|sort code|account (?:no|number|holder|holder's|holders|name)|iban|bic|swift|cheques?|payable to|vat|fee|billing|claims handler|(?:for completion|to be completed) by (?:the |your )?(?:instructing )?(?:solicitor|insurer|referrer|agency|case manager|claims handler))\b/;

/**
 * Classify a printed label (and its section heading).
 *
 * `party`: who the outline says completes this part of the form (PDF sections, forms/pdf-sections.ts);
 * undefined = read it from the section heading; null = the caller knows the section names no one.
 */
export function classifyLabel(label: string, section?: string, party?: Party | null): LabelClass {
  const l = norm(label);
  const sec = norm(section ?? "");
  // A question ("Have you signed and dated the form?") is never a signature, name or date box.
  const question = /\?\s*$/.test(l);
  const inSignoff = !question && (SIGNOFF_CONTEXT.test(sec) || /^(?:signed|signature)\b/.test(l));

  const sectionParty = party === undefined ? headingParty(sec) ?? undefined : party === null || party === "unknown" ? undefined : party;
  let completedBy: Party | undefined = signerParty(l) ?? (inSignoff ? signerNameParty(l) ?? undefined : undefined) ?? sectionParty;
  if (!completedBy && asksThePatient(l)) completedBy = "patient";
  const who = completedBy ? { completedBy } : {};

  if (LEAVE_BLANK_RE.test(l) || LEAVE_BLANK_RE.test(sec)) {
    return { fillSource: { kind: "leave_blank" }, answerType: null, identifier: false, opinion: false, ...who };
  }
  // Pregnancy and maternity questions (an insurer's maternity claim): the patient's own information,
  // never the physiotherapy record's – left blank for the patient.
  if (PREGNANCY_RE.test(l) || PREGNANCY_RE.test(sec)) {
    return { fillSource: { kind: "leave_blank" }, answerType: null, identifier: false, opinion: false, completedBy: completedBy ?? "patient" };
  }
  // Someone else's part of the form (the policyholder's details, the GP's medical section, the patient's
  // own account, their signature): left blank.
  if (isNonClinicParty(completedBy)) {
    return { fillSource: { kind: "leave_blank" }, answerType: null, identifier: false, opinion: false, ...who };
  }
  // Numbers and names the clinic record does not hold: a company or group scheme's number, the company
  // that holds a company policy, a work telephone number. Staff enter them, or they stay blank.
  if (SCHEME_NUMBER.test(l) || COMPANY_POLICY.test(l) || WORK_PHONE.test(l)) {
    return { fillSource: { kind: "leave_blank" }, answerType: "short_text", identifier: SCHEME_NUMBER.test(l), opinion: false, notHeld: true, ...who };
  }
  if (PROVIDER_NUMBER.test(l)) {
    // The clinic's number with the insurer: not in the record, never drafted – staff enter it.
    return { fillSource: { kind: "leave_blank" }, answerType: "short_text", identifier: true, opinion: false, notHeld: true, ...who };
  }

  // Sign-off: only where the clinic signs (its declaration, or a signature on a form sent to the clinic).
  if (!question && /\bsignature\b|^signed\b/.test(l)) return { fillSource: { kind: "signoff", part: "signature" }, answerType: "signature", identifier: false, opinion: false, ...who };
  if (inSignoff) {
    if (/\bhcpc\b|\bregistration (?:no\.?|number)\b/.test(l)) return { fillSource: { kind: "signoff", part: "hcpc" }, answerType: "hcpc_number", identifier: false, opinion: false, ...who };
    if (/\bname\b/.test(l)) return { fillSource: { kind: "signoff", part: "name" }, answerType: "clinician_name", identifier: false, opinion: false, ...who };
    if (/^date\b|\bdate signed\b|\bdate of signature\b/.test(l)) return { fillSource: { kind: "signoff", part: "date" }, answerType: "date_signed", identifier: false, opinion: false, ...who };
  }
  if (!question && /\bdate signed\b|\bdate of signature\b/.test(l)) return { fillSource: { kind: "signoff", part: "date" }, answerType: "date_signed", identifier: false, opinion: false, ...who };
  // A bare "Date" outside any declaration: the date the form is completed, not a signature date.
  if (/^date\s*:?$/.test(l)) return { fillSource: reg("report.date"), answerType: "date", identifier: false, opinion: false, ...who };

  const contact = contactFor(l, sec);
  if (contact) return { fillSource: contact.source, answerType: contact.source.kind === "leave_blank" ? null : "short_text", identifier: contact.identifier, opinion: false, ...who };

  // Figures computed by code.
  const countQuestion = l.length <= 70 && !/\b(?:provided|describe|details|summary|including|type of)\b/.test(l);
  // "Number of sessions" in a treatment PLAN is the number planned, not the number attended.
  const planned = /\b(?:plan|proposed|propose|further|additional|requested|request|future|remaining|recommended|estimated)\b/.test(`${sec} ${l}`) && !/\b(?:attended|to date|so far|received|completed|used|had)\b/.test(l);
  const sessionCount = /\b(?:number|no\.?|total) of (?:sessions|appointments|treatments|treatment sessions|visits|consultations)(?: attended)?\b|\b(?:sessions|appointments|treatments) attended\b/.test(l) && !/\bmissed|dna|did not attend|failed|cancel/.test(l);
  if (countQuestion && !planned && sessionCount) {
    return { fillSource: { kind: "computed_fact", factId: "FACT-attendance", format: "sessions_attended" }, answerType: "number", identifier: false, opinion: false, ...who };
  }
  const plannedCount = countQuestion && planned && sessionCount ? { plannedCount: true } : {};
  if (countQuestion && /\b(?:missed|dna|did not attend|failed to attend|non-?attendance)\b/.test(l) && /\b(?:number|no\.?|how many|appointments|sessions)\b/.test(l)) {
    return { fillSource: { kind: "computed_fact", factId: "FACT-attendance", format: "dna_count" }, answerType: "number", identifier: false, opinion: false, ...who };
  }
  if (/^attendance\b|\battendance record\b/.test(l)) {
    return { fillSource: { kind: "computed_fact", factId: "FACT-attendance", format: "summary" }, answerType: null, identifier: false, opinion: false, ...who };
  }
  // Outcome measures: named in the label, or in the context of a score column ("Initial score" under
  // "Outcome Measures – such as Patient Specific Functional Scale"). The first or latest score for an
  // "Initial" / "Current" column, the whole series otherwise.
  const scoreColumn = /^(?:(?:initial|baseline|first|start|current|latest|most recent|final|end|discharge|present)\s+)?(?:score|outcome|result|measure)s?\b/.test(l);
  for (const [re, instrument] of OUTCOMES) {
    if (re.test(l) || (scoreColumn && re.test(sec))) {
      const factId = `FACT-outcomes-${instrument}` as FactId;
      return { fillSource: { kind: "computed_fact", factId, format: scoreFormat(l, sec) }, answerType: null, identifier: false, opinion: false, ...who };
    }
  }

  const registration = registrationFor(l, inSignoff, sec);
  if (registration) {
    return { fillSource: reg(registration.path), answerType: registration.answerType, identifier: registration.identifier, opinion: false, ...who };
  }

  if (STRONG_OPINION_RE.test(l)) return { fillSource: { kind: "clinician_opinion" }, answerType: null, identifier: false, opinion: true, ...who, ...plannedCount };
  if (OPINION_RE.test(l)) return { fillSource: { kind: "clinician_opinion" }, answerType: null, identifier: false, opinion: false, ...who, ...plannedCount };
  if (/\bopinion\b/.test(sec) && !/\b(?:history|examination|findings|treatment provided|symptoms)\b/.test(l)) {
    return { fillSource: { kind: "clinician_opinion" }, answerType: null, identifier: false, opinion: false, ...who, ...plannedCount };
  }

  return { fillSource: { kind: "notes_narrative" }, answerType: null, identifier: false, opinion: false, ...who, ...plannedCount };
}

/** Answer type suggested by the label alone (used when the layout gives no hint). */
export function answerTypeFromLabel(label: string): AnswerType | null {
  const l = norm(label);
  if (/^(?:is|are|was|were|has|have|had|did|does|do|will|would|can|could|should)\b.*\?$/.test(l)) return "yes_no";
  if (/\bdate\b/.test(l) && !/\b(?:to|up to) date\b/.test(l)) return "date";
  if (/\b(?:number of|how many)\b/.test(l) && !/\b(?:tel(?:ephone)?|phone|fax|mobile|policy|membership|reference|registration|account)\b/.test(l)) return "number";
  return null;
}
