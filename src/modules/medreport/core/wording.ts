/**
 * Customer-facing wording for HOW answers are drafted and forms are read – the one place for it.
 *
 * DISCLOSURE (decided by the product owner):
 * - "neutral" (default): describes what the product does ("drafted from the notes", "reads the form and
 *   identifies each question and answer space"), never the technology or the vendor behind it.
 * - "ai-assisted": the earlier wording that names the technology, kept so it can be switched back on
 *   later by changing DISCLOSURE alone.
 *
 * Everything a clinic can see or download goes through WORDING: Studio text, tooltips, aria-labels,
 * toasts, problem titles/details shown in the UI, the activity log, the Security & GDPR page and the
 * engine name in API fields the Studio stores or renders (publicEngineName). Internal identifiers,
 * server prompts, logs, docs, tests and API field NAMES are not governed here.
 *
 * Honesty labels stay in every variant: "Demo mode", prepared/sample drafts are never shown as live,
 * and the simulated TM3 sandbox keeps its own "not affiliated with TM3" label.
 *
 * Pure and browser-safe (type-only imports plus core/dates), so the UI, core and server can all use it.
 */
import { formatUkDate, formatUkDateTime } from "./dates";
import type { FormAnalysisMode, GenerationMode } from "./types";

export type Disclosure = "neutral" | "ai-assisted";

/** Switch the customer-facing wording here (and only here). */
export const DISCLOSURE: Disclosure = "neutral";

/** The engine name used instead of a model id in any field a clinic can see or download. */
export const NEUTRAL_ENGINE = "drafting-service";

/** One drafted group, as the generation badge's tooltip describes it. */
export interface GenerationLineInput {
  sectionKeys: readonly string[];
  mode: GenerationMode;
  /** When the group was drafted (live) or prepared (demo: recordedAt, else at). */
  at: string;
  durationMs?: number;
  model?: string;
  tokens?: number;
}

export interface Wording {
  disclosure: Disclosure;

  /* Mode badge and dialog (Studio header) ------------------------------------------------------ */
  mode: {
    unknown: string;
    checking: string;
    live: string;
    demoPasscodeAvailable: string;
    demo: string;
    ariaLabel(label: string): string;
    dialogTitle: string;
    dialogDescription: string;
    /** Show the model id and prompt version rows in the dialog. */
    showTechnicalDetails: boolean;
    thisTabLive: string;
    thisTabDemo: string;
    liveNotConfiguredTitle: string;
    liveNotConfiguredBody: string;
    passcodeLabel: string;
    useLive: string;
    switchToDemo: string;
  };

  /* Drafting the answers --------------------------------------------------------------------- */
  drafting: {
    /** Group progress while a live draft runs ("Drafting answers from 10 notes…"). */
    liveProgress(noteCount?: number): string;
    demoProgress: string;
    /** A group waiting for a free live slot (per-minute limit) before it tries again. */
    waitingForSlot: string;
    /** Label of a finished group in the progress list. */
    groupDone(mode: GenerationMode | undefined, model?: string): string;
    noDemoDraftMessage: string;
    /** New-report screen: every group was skipped because demo mode holds no answers. */
    noDemoAnswersNotice: string;
    /** Appended when some groups had no demo answers. */
    noDemoAnswersSuffix: string;
    /** Review screen: the pending questions in demo mode without prepared answers. */
    reviewNoDemoAnswers: string;
    /** Activity log entry for a merged draft. */
    activityDrafted(keys: readonly string[], mode: GenerationMode, model?: string): string;
    /** A problem code as shown in the activity log ("AI_TIMEOUT" → "timed out"). */
    failureCode(code: string): string;
  };

  /* Generation badge (review header) ------------------------------------------------------------- */
  generation: {
    live(duration: string | null): string;
    recorded(date: string): string;
    prewritten: string;
    /** One line per drafted group in the badge's tooltip. */
    line(input: GenerationLineInput, seconds: (ms: number) => string): string;
  };

  /* Paragraph origins and revert --------------------------------------------------------------- */
  origin: {
    /** Pill for a drafted paragraph (ParagraphOrigin "ai"). */
    drafted: string;
    revertToDraft: string;
  };

  /* Core labels (core/labels.ts) ----------------------------------------------------------------- */
  labels: {
    fillSourceNotesNarrative: string;
    sectionKindFromRecords: string;
    sectionKindNarrative: string;
    paragraphOriginAi: string;
    analysisMode: Record<FormAnalysisMode, string>;
    prewrittenDraft: string;
    /** How a demonstration form (FormDefinition.demoNotice) with a pre-written map was analysed. */
    prewrittenDemoFormMap: string;
  };

  /* "Filled by code" reassurances ---------------------------------------------------------------- */
  byCode: {
    calculatedHeading: string;
    identifiersOnForm: string;
    lockedFromRecords: string;
    outOfScope: string;
    computedHeading: string;
    identifiersNotice: string;
    fillHelpRegistration: string;
    fillHelpComputed: string;
    mappingIdentifiers: string;
  };

  /* Reading a referrer's form (upload dialog, mapping screen) ----------------------------------- */
  formReading: {
    introLive: string;
    introDemo: string;
    stepLive: string;
    stepDemo: string;
    /** Show the model id next to how the form was read. */
    showModel: boolean;
  };

  /* Copying answers (review screen: per question, all, .txt) ------------------------------------ */
  answersCopy: AnswersCopyWording;

  /* Insurer portal question sets (forms library, mapping, review) -------------------------------- */
  questionSet: QuestionSetWording;

  /* "See exactly what the drafting service receives" panel -------------------------------------- */
  payload: {
    toggle: string;
    subtitle: string;
    building: string;
    questionsNote: string;
    recordCaption(label: string, model: string, promptVersion: string): string;
    /** Server: the identifiers bullet of POST /ai/payload-preview `removed`. */
    identifiersRemoved: string;
  };

  /* Home screen ---------------------------------------------------------------------------------- */
  home: {
    securityCardBlurb: string;
  };

  /* Security & GDPR page ------------------------------------------------------------------------- */
  security: {
    subProcessors: string;
    receivesTitle: string;
    receivesPoints: string[];
    payloadPointerBefore: string;
    payloadPointerLink: string;
    payloadPointerAfter: string;
    draftsLabelled: string;
    statusRow: { area: string; demo: string; live: string };
  };

  /* Server messages shown in the Studio (problem titles/details, trace, warnings) ---------------- */
  server: {
    liveUnavailableTitle: string;
    liveLocked(minutes: number, alternative: string): string;
    passcodeRequired(action: string): string;
    passcodeInvalid: string;
    noPasscodeConfigured: string;
    liveRateLimited(seconds: number, alternative: string): string;
    gateActionDraft: string;
    gateActionAnalyse: string;
    analyseAlternative: string;
    refusalTitle: string;
    sdk: {
      timeout(alt: string): string;
      notConfigured: string;
      misconfigured: string;
      rateLimited(alternative: string): string;
      badRequest(noun: string): string;
      unreachable(alt: string): string;
      apiError(status: string, alt: string): string;
      refusal(noun: string, alt: string): string;
      unreadable(alt: string): string;
    };
    noDemoFormAnswers: string;
    noDemoTemplateDraft: string;
    analysis: {
      fallbackNote(code: string): string;
      recordedDetail(date: string, model?: string): string;
      prewrittenDetail: string;
      /** A pre-written map of an uploaded (non-bundled) demonstration form, e.g. a public insurer form. */
      uploadedPrewrittenDetail: string;
      tooManyCalls(calls: number): string;
      liveDetail(info: { model: string; chunks: number; effort: string; questions: number }): string;
      liveFailedRules(code: string): string;
      rulesOnlyTrace: string;
      liveErrorWarning(message: string): string;
      rulesOnlyWarning: string;
      prefilledRemoved: string;
    };
    /** Wave 2: who may call the Report API (sign-in, clinics, roles, limits). Names no technology. */
    access: AccessWording;
  };
}

/** Problem titles and details for sign-in, clinic (tenant), role and limit refusals (api/handlers, auth/actor.ts). */
export interface AccessWording {
  signInTitle: string;
  signInDetail: string;
  clinicSignInDetail: string;
  twoFactorTitle: string;
  twoFactorDetail: string;
  noClinicTitle: string;
  noClinicDetail: string;
  demoOffTitle: string;
  demoOffDetail: string;
  otherClinicTitle: string;
  otherClinic(what: string): string;
  roleTitle: string;
  role(action: string): string;
  cannotSignTitle: string;
  cannotSignDetail: string;
  signAsYourselfTitle: string;
  signAsYourself(name: string): string;
  draftingOffTitle: string;
  draftingOffDetail: string;
  clinicLimitTitle: string;
  clinicMinuteLimit(seconds: number): string;
  clinicDailyLimit: string;
  liveNotAvailableForClinic: string;
  originTitle: string;
  originDetail: string;
  jsonTitle: string;
  jsonDetail: string;
  demoConnectorTitle: string;
  demoConnectorDetail(label: string): string;
  partnerKeyTitle: string;
  partnerKeyDetail: string;
  launchStateUnavailable: string;
}

/** The access wording is the same under every disclosure setting: it never names a technology. */
const ACCESS: AccessWording = {
  signInTitle: "Sign in required",
  signInDetail: "Sign in to your clinic's account, or open the public demo.",
  clinicSignInDetail: "This link belongs to a clinic's account. Sign in to that clinic first, then open the link again.",
  twoFactorTitle: "Two-step verification required",
  twoFactorDetail: "Set up two-step verification for your account before working with patient records.",
  noClinicTitle: "Choose a clinic",
  noClinicDetail: "Your account is not working in a clinic at the moment. Choose a clinic, then try again.",
  demoOffTitle: "The public demo is switched off",
  demoOffDetail: "The public demo is not available on this site. Sign in to your clinic's account.",
  otherClinicTitle: "This belongs to another clinic",
  otherClinic: (what) => `This ${what} belongs to another clinic. Open it from that clinic's own account.`,
  roleTitle: "Not available for your role",
  role: (action) => `Your role in this clinic cannot ${action}. Ask a clinician or an administrator of your clinic.`,
  cannotSignTitle: "Approval needs a signing clinician",
  cannotSignDetail:
    "Only a clinician whose clinic profile has an HCPC number and permission to sign can approve. Ask an administrator of your clinic to update your profile.",
  signAsYourselfTitle: "Approve as yourself",
  signAsYourself: (name) => `You are signed in as ${name}. The approval is recorded under your own name and HCPC number.`,
  draftingOffTitle: "Drafting is switched off",
  draftingOffDetail: "Drafting from the notes is switched off for this clinic. Complete the answers yourself, or ask your clinic's administrator.",
  clinicLimitTitle: "Your clinic's drafting limit is reached",
  clinicMinuteLimit: (seconds) => `Your clinic has reached its drafting limit for this minute. Try again in ${seconds} s.`,
  clinicDailyLimit: "Your clinic has reached its drafting limit for today. Try again tomorrow, or complete the answers yourself.",
  liveNotAvailableForClinic: "Drafting from the notes is not available on this site at the moment. Complete the answers yourself, or try again later.",
  originTitle: "Request refused",
  originDetail: "This request did not come from this site, so it was refused.",
  jsonTitle: "Unsupported request format",
  jsonDetail: "Send the request body as JSON (content-type application/json).",
  demoConnectorTitle: "Part of the public demo only",
  demoConnectorDetail: (label) => `${label} is part of the public demo and is not available to clinics.`,
  partnerKeyTitle: "Partner key required",
  partnerKeyDetail: "POST /launch is called server-to-server by the clinic system with a valid partner key.",
  launchStateUnavailable: "Launch links cannot be checked at the moment. Try again shortly.",
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Copying answers out of a completed form (core/answer-copy.ts and the review screen). */
export interface AnswersCopyWording {
  /** Marks copied text while the answers are not approved (spec wording – keep exactly). */
  draftMarker: string;
  /** Shown for a question nobody has answered yet. */
  toComplete: string;
  /** Shown, once approved, for an (optional) question the clinician left blank. */
  leftBlank: string;
  /** Shown for a sign-off answer before approval. */
  onApproval: string;
  panelTitle: string;
  panelTitlePortal: string;
  panelIntro: string;
  panelIntroPortal(referrer: string): string;
  draftNotice: string;
  approvedNotice: string;
  copyAll: string;
  downloadTxt: string;
  copyOne: string;
  copyOneAria(label: string): string;
  nothingToCopy: string;
  copiedOne(label: string): string;
  copiedAll(count: number): string;
  copiedDraftDetail: string;
  copiedApprovedDetail: string;
  copyFailed: string;
  downloaded: string;
  gapsCount(count: number): string;
  leftBlankCount(count: number): string;
  approvedHeader(name: string, hcpc: string, date: string): string;
}

/** Portal question sets: an insurer's online questions with no file (core/question-set.ts). */
export interface QuestionSetWording {
  addButton: string;
  dialogTitle: string;
  dialogDescription: string;
  hintHelp: string;
  exampleButton: string;
  submit: string;
  howItWorks: string;
  analysisLabel: string;
  noFile: string;
  previewTitle: string;
  previewNote: string;
  approvedTitle: string;
  summaryPdf: string;
}

/* Copy and portal wording describe what staff do, not how answers are drafted: one text for both variants. */
const ANSWERS_COPY: AnswersCopyWording = {
  draftMarker: "Draft – not yet approved",
  toComplete: "[to complete]",
  leftBlank: "[left blank]",
  onApproval: "[completed on approval]",
  panelTitle: "Copy answers",
  panelTitlePortal: "Answers for the portal",
  panelIntro: "Copy an answer, or all of them, as plain text – for a portal, an e-mail or a letter. Dates are DD/MM/YYYY and ticks are written as the option chosen.",
  panelIntroPortal: (referrer) =>
    `Copy each answer into ${referrer}'s portal, question by question, or copy them all at once. Dates are DD/MM/YYYY and ticks are written as the option chosen.`,
  draftNotice: "Not approved yet: copied text is marked “Draft – not yet approved”. Approve the answers before entering them anywhere.",
  approvedNotice: "Approved: copied text is the approved answers.",
  copyAll: "Copy all answers",
  downloadTxt: "Download answers (.txt)",
  copyOne: "Copy",
  copyOneAria: (label) => `Copy the answer to “${label}”`,
  nothingToCopy: "No answer to copy yet",
  copiedOne: (label) => `Answer to “${label}” copied`,
  copiedAll: (count) => `${plural(count, "answer")} copied`,
  copiedDraftDetail: "Marked “Draft – not yet approved” until a clinician approves the answers.",
  copiedApprovedDetail: "The approved answers, ready to paste.",
  copyFailed: "This browser did not allow copying. Download the answers (.txt) instead, or select the text and copy it.",
  downloaded: "Answers downloaded",
  gapsCount: (count) => `${plural(count, "question")} still to complete`,
  leftBlankCount: (count) => `${plural(count, "question")} left blank on approval – copied as “[left blank]”.`,
  approvedHeader: (name, hcpc, date) => `Approved by ${name} (HCPC ${hcpc}) on ${date}`,
};

const QUESTION_SET: QuestionSetWording = {
  addButton: "Add portal questions",
  dialogTitle: "Add an insurer portal's questions",
  dialogDescription:
    "Some insurers take treatment reports through an online portal instead of a form. Paste or type the portal's questions once; they are then answered for every patient like any other form.",
  hintHelp:
    "One question per line. Optionally end a line with its answer type: [date], [yes/no], [number], [long] or [short] – or [choice: A | B | C] and [optional]. Start a line with # for a heading.",
  exampleButton: "Insert example questions",
  submit: "Add and check the questions",
  howItWorks:
    "Each answer is drafted from the notes with its sources, checked and approved by the clinician, then copied into the portal. A PDF summary of the questions and approved answers is kept for the record.",
  analysisLabel: "Typed or pasted by staff",
  noFile: "No file – the answers are copied into the portal",
  previewTitle: "Summary of the questions and answers",
  previewNote: "Portal questions have no form file: this summary is what is kept for the record.",
  approvedTitle: "Approved – the answers are final",
  summaryPdf: "Summary (PDF)",
};

/** Problem codes in plain words (the codes themselves stay in the API). */
const NEUTRAL_FAILURE_CODES: Record<string, string> = {
  AI_TIMEOUT: "timed out",
  AI_ERROR: "service error",
  AI_REFUSAL: "declined",
  AI_MAX_TOKENS: "cut off",
  LIVE_AI_UNAVAILABLE: "live drafting unavailable",
  NO_DEMO_DRAFT: "no demo draft",
  RATE_LIMITED: "rate limited",
  PASSCODE_REQUIRED: "passcode required",
  PASSCODE_INVALID: "passcode not recognised",
};

/* ------------------------------------------------------------------------------------------------
 * Neutral (default): what the product does, not the technology
 * ----------------------------------------------------------------------------------------------*/

const NEUTRAL: Wording = {
  disclosure: "neutral",
  mode: {
    unknown: "Drafting status unknown",
    checking: "Checking drafting mode…",
    live: "Live drafting",
    demoPasscodeAvailable: "Demo mode · passcode for live",
    demo: "Demo mode",
    ariaLabel: (label) => `Drafting mode: ${label}. Change`,
    dialogTitle: "Drafting mode",
    dialogDescription:
      "Every drafted answer and every form reading is labelled with how it was produced, so nothing prepared in advance is passed off as live.",
    showTechnicalDetails: false,
    thisTabLive: "Live drafting from the notes",
    thisTabDemo: "Prepared demo drafts and sample maps – nothing is drafted live",
    liveNotConfiguredTitle: "Live drafting is not configured on this deployment",
    liveNotConfiguredBody: "Drafts and form readings come from prepared demo data. Each one is labelled.",
    passcodeLabel: "Live drafting passcode",
    useLive: "Use live drafting",
    switchToDemo: "Switch to demo mode",
  },
  drafting: {
    liveProgress: (n) => (n && n > 0 ? `Drafting answers from ${plural(n, "note")}…` : "Drafting answers from the notes…"),
    demoProgress: "Loading the prepared demo answers for this patient and form…",
    waitingForSlot: "Live drafting is at its limit for this minute – waiting a few seconds, then drafting these answers…",
    groupDone: (mode) =>
      mode === "live" ? "Drafted from the notes" : mode === "demo_recorded" ? "Prepared demo draft" : mode === "demo_prewritten" ? "Sample draft (demo)" : "",
    noDemoDraftMessage: "Demo mode holds no prepared answers for this patient and form (live drafting would draft them from the notes).",
    noDemoAnswersNotice:
      "There are no prepared demo answers for this patient and form, so nothing was drafted. With live drafting (passcode) these questions are drafted from the notes with citations; here, open the form and complete them in review.",
    noDemoAnswersSuffix: " There are no prepared demo answers for this patient and form – use live drafting (passcode) or answer them in review.",
    reviewNoDemoAnswers:
      "This demo holds no prepared answers for this patient and form, so nothing was drafted. Answer them below – or enter the live drafting passcode (top right) and they can be drafted from the notes, with citations.",
    activityDrafted: (keys, mode) =>
      mode === "live"
        ? `Drafted ${keys.join(", ")} from the notes.`
        : `Drafted ${keys.join(", ")} (${mode === "demo_recorded" ? "prepared demo draft" : "sample draft"}).`,
    failureCode: (code) => NEUTRAL_FAILURE_CODES[code] ?? code.toLowerCase().replace(/_/g, " "),
  },
  generation: {
    live: (duration) => `Drafted from the notes${duration ? ` in ${duration}` : ""}`,
    recorded: (date) => `Prepared demo draft (${date})`,
    prewritten: "Sample draft (demo)",
    line: (g, seconds) => {
      const parts = [g.sectionKeys.join(", ")];
      if (g.mode === "demo_recorded") parts.push("prepared demo draft");
      if (g.mode === "demo_prewritten") parts.push("sample draft");
      else parts.push(`drafted ${formatUkDateTime(g.at)}`);
      if (g.mode !== "demo_prewritten" && g.durationMs !== undefined) parts.push(seconds(g.durationMs));
      return parts.join(" · ");
    },
  },
  origin: {
    drafted: "Draft",
    revertToDraft: "Revert to the draft",
  },
  labels: {
    fillSourceNotesNarrative: "Drafted from the notes – cited",
    sectionKindFromRecords: "From records – filled by code",
    sectionKindNarrative: "Drafted from the notes",
    paragraphOriginAi: "Draft",
    analysisMode: {
      live: "Read from the form (live)",
      demo_recorded: "Prepared demo reading",
      demo_prewritten: "Pre-written sample map",
      rules: "Found by layout rules",
    },
    prewrittenDraft: "Sample draft (demo)",
    prewrittenDemoFormMap: "Pre-written demonstration map",
  },
  byCode: {
    calculatedHeading: "Calculated by code from the record",
    identifiersOnForm: "Names, dates of birth and identifiers on the form are filled in by our own code from the clinic record.",
    lockedFromRecords: "Filled in by code from the clinic record. To change it, correct the clinic record.",
    outOfScope: "– out of scope for this referrer, never sent for drafting",
    computedHeading: "Computed from the record by code",
    identifiersNotice:
      "Identifiers are written onto the form by our own code. The drafting service never receives the name, date of birth, address or contact details.",
    fillHelpRegistration: "Copied by code from the TM3 registration, referral or episode – never drafted.",
    fillHelpComputed: "Calculated by code from the appointments and outcome scores – never drafted.",
    mappingIdentifiers: "Identifiers are always copied by code from TM3, never drafted.",
  },
  formReading: {
    introLive: "The system reads the form and identifies each question and answer space – no patient data is involved at this step.",
    introDemo:
      "Demo mode: a prepared reading is used if this exact file has one; otherwise the questions are found by layout rules and you complete the mapping.",
    stepLive: "Identifying questions and answer spaces – where each answer goes and where it comes from",
    stepDemo: "Loading the prepared reading of this file, or matching questions by layout rules",
    showModel: false,
  },
  answersCopy: ANSWERS_COPY,
  questionSet: QUESTION_SET,
  payload: {
    toggle: "See exactly what the drafting service receives",
    subtitle: "The minimised record for this patient, exactly as a drafting request would send it – nothing is sent to show it.",
    building: "Building the preview…",
    questionsNote: "The referrer form's questions are sent with it; identifiers on the form are always filled in by our own code.",
    recordCaption: (label) => `${label} – exactly as the drafting service receives it`,
    identifiersRemoved: "Identifiers on the form (name, date of birth, references, the clinician's details) → filled in by our own code from the clinic record.",
  },
  home: {
    securityCardBlurb: "What the drafting service receives, who can see what, and what is in place before real patient data.",
  },
  security: {
    subProcessors:
      "Every sub-processor (hosting, and the contracted drafting service) is listed in the DPA's sub-processor schedule, and the clinic is told before any change.",
    receivesTitle: "What the drafting service receives – and what it does not",
    receivesPoints: [
      "Drafting the answers and reading referrer forms are performed by a contracted sub-processor, under a data processing agreement.",
      "It receives only the minimised record shown in the data step: the patient's name is replaced with “[CLAIMANT]”; date of birth (age only), address, phone, e-mail and NHS-style numbers are never sent.",
      "Names, dates of birth and references on the referrer's form are filled in by our own code from the clinic record.",
      "Employer and case-manager forms: past medical and social history are removed before drafting.",
      "Referrer forms are read as blank forms; if one arrives already filled in, the patient details are removed first and staff are asked for the blank form.",
      "Your data is not used for training. Retention by the sub-processor is limited as set out in the DPA, and the sub-processor is listed in the DPA's sub-processor schedule. Where processing happens outside the UK, the transfer is covered by those data processing terms and recorded in the DPIA.",
    ],
    payloadPointerBefore: "When you complete a form, the data step has ",
    payloadPointerLink: "“See exactly what the drafting service receives”",
    payloadPointerAfter: ", which shows the minimised record for that patient.",
    draftsLabelled:
      "Every draft is labelled with how it was produced – drafted live, a prepared demo draft or a sample draft – never passed off as something else.",
    statusRow: {
      area: "Drafting and form reading",
      demo: "Prepared demo drafts, or live drafting behind a passcode",
      live: "The same minimised input, sent only to the contracted sub-processor under the DPA; your data is not used for training",
    },
  },
  server: {
    liveUnavailableTitle: "Live drafting is not available",
    liveLocked: (minutes, alt) => `Live drafting is locked for a few minutes after repeated wrong passcodes. Try again in ${minutes} min, or ${alt}.`,
    passcodeRequired: (action) => `Enter the live drafting passcode to ${action}.`,
    passcodeInvalid: "Check the live drafting passcode and try again.",
    noPasscodeConfigured: "No live drafting passcode is configured.",
    liveRateLimited: (seconds, alt) => `Live drafting is limited per minute. Try again in ${seconds} s, or ${alt}.`,
    gateActionDraft: "draft live from the notes",
    gateActionAnalyse: "read forms live",
    analyseAlternative: "use the prepared or layout-rules mapping",
    refusalTitle: "This section could not be drafted",
    sdk: {
      timeout: (alt) => `The drafting service did not answer in time. ${alt}`,
      notConfigured: "Live drafting is not configured on this deployment.",
      misconfigured: "Live drafting is not configured correctly on this deployment.",
      rateLimited: (alternative) => `The drafting service is busy right now. Wait a moment and retry, or ${alternative}.`,
      badRequest: (noun) => `The drafting service rejected the ${noun} request.`,
      unreachable: (alt) => `Could not reach the drafting service. ${alt}`,
      apiError: (status, alt) => `The drafting service returned an error (${status}). ${alt}`,
      refusal: (noun, alt) => `The drafting service declined this ${noun} request. ${alt}`,
      unreadable: (alt) => `The drafting service's answer could not be read. ${alt}`,
    },
    noDemoFormAnswers:
      "There are no prepared demo answers for this patient and form. Live drafting is needed to draft them, or complete the fields yourself.",
    noDemoTemplateDraft: "There is no prepared demo draft for this patient and template. Live drafting is needed to draft it.",
    analysis: {
      fallbackNote: () => "Live form reading could not finish just now; the stored map of this exact form was used instead.",
      recordedDetail: (date) => `Prepared demo reading of this exact form (${date})`,
      prewrittenDetail: "Pre-written map of this bundled sample form",
      uploadedPrewrittenDetail: "Pre-written demonstration map of this exact uploaded form",
      tooManyCalls: (calls) => `This form needs ${calls} parallel requests and the per-minute live limit has no room for them now.`,
      liveDetail: ({ chunks, questions }) =>
        `Read live: ${plural(questions, "question")} proposed (${plural(chunks, "parallel request")})`,
      liveFailedRules: () => "Live form reading could not finish; the map was proposed by layout rules instead",
      rulesOnlyTrace: "Layout rules only (demo mode). Every question is marked for review.",
      liveErrorWarning: (message) => `Live form reading could not be completed (${message}) The questions below were found by layout rules – check each one.`,
      rulesOnlyWarning: "Mapped by layout rules only: check every question, its answer type and where its answer comes from.",
      prefilledRemoved: "They were removed before the form was read.",
    },
    access: ACCESS,
  },
};

/* ------------------------------------------------------------------------------------------------
 * AI-assisted (kept for later): the earlier wording that names the technology
 * ----------------------------------------------------------------------------------------------*/

const RECORDED_MODE_TEXT: Record<GenerationMode, string> = {
  live: "live",
  demo_recorded: "recorded Claude output",
  demo_prewritten: "pre-written, no AI call",
};

const AI_ASSISTED: Wording = {
  disclosure: "ai-assisted",
  mode: {
    unknown: "AI status unknown",
    checking: "Checking AI…",
    live: "Live AI",
    demoPasscodeAvailable: "Demo AI · passcode for live",
    demo: "Demo AI · recorded",
    ariaLabel: (label) => `AI mode: ${label}. Change`,
    dialogTitle: "AI mode",
    dialogDescription: "Every drafted answer and form analysis is badged with how it was produced, so nothing pre-written is passed off as live.",
    showTechnicalDetails: true,
    thisTabLive: "Live Claude",
    thisTabDemo: "Recorded Claude output / pre-written (no AI call)",
    liveNotConfiguredTitle: "Live AI is not configured on this deployment",
    liveNotConfiguredBody: "Drafts and form analyses come from recorded Claude output or pre-written demo data. Each is labelled.",
    passcodeLabel: "Live AI passcode",
    useLive: "Use live AI",
    switchToDemo: "Switch to demo AI",
  },
  drafting: {
    liveProgress: () => "Claude is drafting these answers strictly from the notes, with citations…",
    demoProgress: "Loading recorded answers for this patient and form (no AI call)…",
    waitingForSlot: "Live AI is at its limit for this minute – waiting a few seconds, then drafting these answers…",
    groupDone: (mode, model) =>
      mode === "live"
        ? model
          ? `Live Claude (${model})`
          : "Live Claude"
        : mode === "demo_recorded"
          ? "Recorded Claude output – no AI call"
          : mode === "demo_prewritten"
            ? "Pre-written draft – no AI call"
            : "",
    noDemoDraftMessage: "Demo mode holds no recorded answers for this patient and form (live AI would draft them from the notes).",
    noDemoAnswersNotice:
      "There are no recorded Claude answers for this patient and form, so nothing was drafted. With live AI (passcode) these questions are drafted from the notes with citations; here, open the form and complete them in review.",
    noDemoAnswersSuffix: " There are no recorded demo answers for this patient and form – use live AI (passcode) or answer them in review.",
    reviewNoDemoAnswers:
      "This demo holds no recorded answers for this patient and form, so nothing was drafted. Answer them below – or enter the live AI passcode (top right) and they can be drafted from the notes, with citations.",
    activityDrafted: (keys, mode, model) => {
      const label =
        mode === "live" ? `live AI${model ? `, ${model}` : ""}` : mode === "demo_recorded" ? "recorded Claude output" : "pre-written draft, no AI call";
      return `Drafted ${keys.join(", ")} (${label}).`;
    },
    failureCode: (code) => code,
  },
  generation: {
    live: (duration) => `Drafted live by Claude${duration ? ` in ${duration}` : ""}`,
    recorded: (date) => `Recorded Claude draft from ${date}`,
    prewritten: "Pre-written demo draft – no AI call",
    line: (g, seconds) => {
      const parts = [g.sectionKeys.join(", "), RECORDED_MODE_TEXT[g.mode]];
      if (g.model && g.mode !== "demo_prewritten") parts.push(g.model);
      if (g.mode === "live" && g.durationMs !== undefined) parts.push(seconds(g.durationMs));
      if (g.mode === "demo_recorded") parts.push(`recorded ${formatUkDate(g.at)}`);
      if (g.tokens) parts.push(`${g.tokens.toLocaleString("en-GB")} tokens`);
      return parts.join(" · ");
    },
  },
  origin: {
    drafted: "AI draft",
    revertToDraft: "Revert to AI draft",
  },
  labels: {
    fillSourceNotesNarrative: "Drafted from the notes – AI, cited",
    sectionKindFromRecords: "From records – not AI",
    sectionKindNarrative: "AI narrative",
    paragraphOriginAi: "AI",
    analysisMode: {
      live: "Analysed by Claude (live)",
      demo_recorded: "Recorded Claude analysis",
      demo_prewritten: "Pre-written mapping – no AI call",
      rules: "Parsed by rules – no AI call",
    },
    prewrittenDraft: "Pre-written draft – no AI call",
    prewrittenDemoFormMap: "Pre-written demonstration map – no AI call",
  },
  byCode: {
    calculatedHeading: "Calculated by code – never by AI",
    identifiersOnForm: "Names, dates of birth and identifiers on the form are filled by code, never by the AI.",
    lockedFromRecords: "Filled by code, never by the AI. To change it, correct the clinic record.",
    outOfScope: "– out of scope for this referrer, never sent to the AI",
    computedHeading: "Computed from the record – by code, not AI",
    identifiersNotice: "Identifiers are written onto the form by code. The AI never sees the name, date of birth, address or contact details.",
    fillHelpRegistration: "Copied by code from the TM3 registration, referral or episode – never written by AI.",
    fillHelpComputed: "Calculated by code from the appointments and outcome scores – never written by AI.",
    mappingIdentifiers: "Identifiers are always copied by code from TM3, never written by AI.",
  },
  formReading: {
    introLive: "Claude reads the form's questions and layout only – no patient data is involved at this step.",
    introDemo:
      "Demo AI: a recorded Claude analysis is used if this exact file has one; otherwise the questions are found by rules (no AI call) and you complete the mapping.",
    stepLive: "Claude is identifying the questions, where each answer goes and where it comes from",
    stepDemo: "Loading the recorded analysis for this file, or matching questions by rules (no AI call)",
    showModel: true,
  },
  answersCopy: ANSWERS_COPY,
  questionSet: QUESTION_SET,
  payload: {
    toggle: "See exactly what is sent to the AI",
    subtitle: "The minimised record for this patient, as a drafting call would send it – no AI call is made to show it.",
    building: "Building the payload…",
    questionsNote: "The referrer form's questions are sent with it; the AI never fills identifiers on the form.",
    recordCaption: (label, model, promptVersion) => `${label} – sent to ${model} (prompt ${promptVersion})`,
    identifiersRemoved: "Identifiers on the form (name, date of birth, references, the clinician's details) → filled in by code, never by the AI.",
  },
  home: {
    securityCardBlurb: "What the AI sees, who can see what, and what is in place before real patient data.",
  },
  security: {
    subProcessors: "Every sub-processor (hosting, the AI provider) is listed in the agreement, and the clinic is told before any change.",
    receivesTitle: "What is sent to the AI – and what is not",
    receivesPoints: [
      "The patient's name is replaced with “[CLAIMANT]”. Date of birth (age only), address, phone, e-mail and NHS-style numbers are never sent.",
      "Names, dates of birth and references on the referrer's form are filled in by code from the clinic record, never by the AI.",
      "Employer and case-manager forms: past medical and social history are removed before drafting.",
      "Referrer forms are analysed as blank forms; if one arrives already filled in, the patient details are removed first and staff are asked for the blank form.",
      "Claude is used through Anthropic's commercial API, whose terms do not allow clinic data to be used for training. Retention is limited as set out in the DPA. Where processing happens outside the UK, the transfer is covered by the provider's data processing terms and recorded in the DPIA.",
    ],
    payloadPointerBefore: "When you complete a form, the data step has ",
    payloadPointerLink: "“See exactly what is sent to the AI”",
    payloadPointerAfter: ", which shows the minimised record for that patient.",
    draftsLabelled: "Drafts are labelled with how they were produced – live AI, recorded AI or pre-written – never passed off as something else.",
    statusRow: {
      area: "AI drafting",
      demo: "Recorded Claude drafts, or live Claude behind a passcode",
      live: "The same minimised input; provider terms that exclude training on clinic data",
    },
  },
  server: {
    liveUnavailableTitle: "Live AI is not available",
    liveLocked: (minutes, alt) => `Live AI is locked for a few minutes after repeated wrong passcodes. Try again in ${minutes} min, or ${alt}.`,
    passcodeRequired: (action) => `Enter the live AI passcode to ${action}.`,
    passcodeInvalid: "Check the live AI passcode and try again.",
    noPasscodeConfigured: "No live AI passcode is configured.",
    liveRateLimited: (seconds, alt) => `Live AI is limited per minute. Try again in ${seconds} s, or ${alt}.`,
    gateActionDraft: "draft with Claude",
    gateActionAnalyse: "analyse forms with Claude",
    analyseAlternative: "use the recorded or rules-based mapping",
    refusalTitle: "Claude declined to draft this section",
    sdk: {
      timeout: (alt) => `Claude did not answer in time. ${alt}`,
      notConfigured: "Live AI is not configured on this deployment.",
      misconfigured: "Live AI is not configured correctly on this deployment.",
      rateLimited: (alternative) => `Claude is rate-limited right now. Wait a moment and retry, or ${alternative}.`,
      badRequest: (noun) => `Claude rejected the ${noun} request.`,
      unreachable: (alt) => `Could not reach Claude. ${alt}`,
      apiError: (status, alt) => `Claude returned an error (${status}). ${alt}`,
      refusal: (noun, alt) => `Claude declined this ${noun} request. ${alt}`,
      unreadable: (alt) => `Claude's answer could not be read. ${alt}`,
    },
    noDemoFormAnswers:
      "There are no pre-written or recorded answers for this patient and form. Live AI is needed to draft them, or complete the fields yourself.",
    noDemoTemplateDraft: "There is no pre-written or recorded draft for this patient and template. Live AI is needed to draft it.",
    analysis: {
      fallbackNote: (code) => `Claude could not finish now (${code}); used the stored map of this exact form instead.`,
      recordedDetail: (date, model) => `Recorded Claude analysis of this exact form (${date}${model ? `, ${model}` : ""}) – no AI call now`,
      prewrittenDetail: "Pre-written map of this bundled sample form – no AI call",
      uploadedPrewrittenDetail: "Pre-written demonstration map of this exact uploaded form – no AI call",
      tooManyCalls: (calls) => `This form needs ${calls} parallel Claude calls and the per-minute live limit has no room for them now.`,
      liveDetail: ({ model, chunks, effort, questions }) =>
        `Claude (${model}), ${chunks} parallel call${chunks === 1 ? "" : "s"}, ${effort} effort, ${questions} questions proposed`,
      liveFailedRules: (code) => `Claude could not finish (${code}); the map was proposed by rules instead`,
      rulesOnlyTrace: "Rules only – no AI call (demo mode). Every question is marked for review.",
      liveErrorWarning: (message) => `Claude could not complete the analysis (${message}) The questions below were found by rules – check each one.`,
      rulesOnlyWarning: "Mapped by rules only (no AI call): check every question, its answer type and where its answer comes from.",
      prefilledRemoved: "They were removed before the AI saw the form.",
    },
    access: ACCESS,
  },
};

/** The wording for a disclosure setting (exported for tests and previews). */
export function wordingFor(disclosure: Disclosure): Wording {
  return disclosure === "ai-assisted" ? AI_ASSISTED : NEUTRAL;
}

/** The customer-facing wording in force. */
export const WORDING: Wording = wordingFor(DISCLOSURE);

/**
 * The engine name to put in any API field the Studio stores, renders or lets a clinic download
 * (generation.model, form.analysis.model, the payload preview): never a vendor model id while neutral.
 */
export function publicEngineName(model: string | undefined, disclosure: Disclosure = DISCLOSURE): string | undefined {
  if (!model) return undefined;
  return disclosure === "ai-assisted" ? model : NEUTRAL_ENGINE;
}

/**
 * The footer line every draft preview and final render of a demonstration form carries
 * (FormDefinition.demoNotice, e.g. a public insurer form in a private demo). The same text whatever
 * the disclosure setting. `publisher` is the form's owner as printed on it ("Bupa"); without one the
 * sentence names "its publisher".
 */
export function demoFormNotice(publisher?: string): string {
  const name = publisher?.replace(/\s+/g, " ").trim().slice(0, 120);
  return `Public form used for demonstration only – not affiliated with or endorsed by ${name || "its publisher"}. Fictional patient data.`;
}

/** Vendor and technology terms that must not appear in neutral customer-facing text (case-insensitive except "AI"). */
export const BANNED_TERM_PATTERNS: readonly RegExp[] = [
  // "AI" as a word, also inside codes such as AI_ERROR (but not "Aisha", "maintain" or "SAID").
  /(?:^|[^A-Za-z])AI(?![A-Za-z])/,
  /\bA\.I\./,
  /artificial intelligence/i,
  /claude/i,
  /anthropic/i,
  /\bLLMs?\b/i,
  /language model/i,
  /\bGPT/i,
  /machine learning/i,
  /\bneural/i,
  /\bprompts?\b/i,
  /\bbots?\b/i,
];

/** True when text contains a banned vendor/technology term (see BANNED_TERM_PATTERNS). */
export function hasBannedTerm(text: string): boolean {
  return BANNED_TERM_PATTERNS.some((re) => re.test(text));
}

/**
 * Text written by an earlier build (activity entries stored in a browser before the neutral wording)
 * rewritten for display and download while DISCLOSURE is neutral. New text never needs it.
 */
export function neutralLegacyText(text: string, disclosure: Disclosure = DISCLOSURE): string {
  if (disclosure === "ai-assisted") return text;
  return text
    .replace(/\(live AI(?:, [\w.-]+)?\)/g, "(drafted from the notes)")
    .replace(/\(recorded Claude output\)/g, "(prepared demo draft)")
    .replace(/\(pre-written draft, no AI call\)/g, "(sample draft)")
    .replace(/\b(?:LIVE_AI_UNAVAILABLE|AI_TIMEOUT|AI_ERROR|AI_REFUSAL|AI_MAX_TOKENS)\b/g, (code) => NEUTRAL_FAILURE_CODES[code] ?? code)
    .replace(/\bclaude-[a-z0-9.-]+/gi, NEUTRAL_ENGINE)
    .replace(/\brecorded Claude (output|analysis|draft)\b/gi, "prepared demo $1")
    .replace(/\blive Claude\b/gi, "live drafting")
    .replace(/\bthe AI\b/g, "the drafting service")
    .replace(/\bno AI call\b/g, "nothing sent")
    .replace(/\blive AI\b/gi, "live drafting")
    .replace(/\bClaude\b/g, "the drafting service")
    .replace(/\bAnthropic\b/g, "the sub-processor")
    .replace(/\bAI\b/g, "drafting");
}
