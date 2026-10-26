/**
 * TESTS ONLY: records shaped as release/bh-trial-2 writes them (plan W0.3 "schema expansion", plus the fix-round keys
 * it keeps), for the rollback-shim tests (schema-forward-compat.test.ts). All fictional.
 *
 * RELEASE_KEYS / RELEASE_MEMBERS are the guard's contract: every key and enum member the release writes into a stored
 * report, receipt or form map. When the release adds one (W0.3 or later), add it here and to the builders – the guard
 * test then proves production (e132057 + the shim) reads it.
 *
 * bh2-base (release/bh-trial-2 integration): the builders write the shapes core/schemas.ts on the release defines
 * (W0.3), so the same records are valid there and read whole by production's loose schemas: the plan's "model" is
 * Report.reportModel; disposition.controllerSnapshot is a list of {sectionKey, answer?}; a fix is {kind, by, at, edits?};
 * Report.approver and the takeover's from/to are {memberId, name, hcpc}; gap resolutions carry `by`; the attended
 * sessions list is fillSource.sessions {fromSession, of?} (no `part`). Keys the release has not defined yet
 * (sections[].markedNotApplicable, paragraphs[].originalSourceIds, the "approver" origin) stay as the plan names them:
 * both lines keep them on read.
 *
 * bh2-base2 (W0 follow-up): the release now defines the rest, and the builders write its shapes – sections[].condition
 * (a frozen condition {controllers, wants?, match?, unresolved?, text?, parser?}), sections[].tombstones, flags[].ackPolicy,
 * activity[].reportId, Report.approverTakeovers, the receipt's signerConfirmations, fields[].lintAccepted
 * {rule, reason, at, by?}, analysis.guidanceVersion, and the flag codes NOT_APPLICABLE_ANSWERED and APPROVER_DECISION.
 *
 * bh2-rc1 (integration of the workstreams): WA1's frozen condition also holds wantsNot (a printed option; the box
 * applies when another is chosen) and filled (the row's text box names something), and a disposition's
 * controllerSnapshot records a text controller's text as {kind: "text", value} (an existing FormAnswer kind).
 */
import { createHmac } from "node:crypto";
import { z } from "zod";
import { withAttestedConfirmation } from "../../src/modules/medreport/auth/attestations";
import { createReceipt } from "../../src/modules/medreport/auth/sign-receipt";
import { signingKey } from "../../src/modules/medreport/config.server";
import { canonicalize } from "../../src/modules/medreport/core/fingerprint";
import type { Clinician, FormDefinition, Report, SignReceipt } from "../../src/modules/medreport/core/types";

export const RELEASE_AT = "2026-10-28T10:00:00.000Z";
const sha = (c: string) => c.repeat(64);

/** W0.3 Actor {memberId, name, role, canSign, hcpc?} – stamped as `by` on people's decisions. */
export const APPROVER = { memberId: "mem_sarah", name: "Sarah Reid", role: "clinician" as const, canSign: true, hcpc: "PH-DEMO-01" };
export const STAFF = { memberId: "mem_pat", name: "Pat Morgan", role: "staff" as const, canSign: false };
/** The approver before a takeover (Report.approverTakeovers / SignReceipt.approverTakeover `from`). */
const TOM_APPROVER = { memberId: "mem_tom", name: "Tom Ellis", hcpc: "PH-DEMO-02" };

/** Dotted paths ([] = every array item) of every key the release adds. */
export const RELEASE_KEYS = {
  report: [
    "approver",
    "reportModel",
    "sections[].disposition",
    "sections[].accepted",
    "sections[].adoptedBy",
    "sections[].answerBy",
    "sections[].condition",
    "sections[].condition.wantsNot",
    "sections[].condition.filled",
    "sections[].tombstones",
    "sections[].markedNotApplicable",
    "sections[].paragraphs[].by",
    "sections[].paragraphs[].ownWords",
    "sections[].paragraphs[].fixes",
    "sections[].paragraphs[].originalSourceIds",
    "gaps[].kind",
    "gaps[].suggestedAnswer",
    "gaps[].resolution.leftBlank",
    "gaps[].resolution.byAnswer",
    "gaps[].resolution.notApplicable",
    "gaps[].resolution.by",
    "flags[].acknowledged.by",
    "flags[].ackPolicy",
    "activity[].reportId",
    "approverTakeovers",
  ],
  receipt: ["issuedContentSha256", "acknowledgementsSha256", "approverTakeover", "signerConfirmations"],
  form: [
    "analysis.convertedWith",
    "analysis.printedLeads",
    "analysis.guidanceVersion",
    "file.sourceSha256",
    "fields[].fillSource.sessions",
    "fields[].lintAccepted",
  ],
} as const;

/** Enum members the release adds (open enums: core/stored-schemas.ts FORWARD_OPEN_ENUMS; Gap.kind is a new key). */
export const RELEASE_MEMBERS = {
  flagCodes: ["OTHER_CLINICIAN_VOICE", "DRAFT_FIT", "NOT_APPLICABLE_ANSWERED", "APPROVER_DECISION"],
  paragraphOrigins: ["staff", "approver"],
  registrationPaths: ["episode.firstSeenTime", "episode.attendedDate", "episode.attendedTime", "episode.attendedDates"],
  gapKinds: [
    "no_opinion_recorded",
    "opinion_not_fitting_options",
    "choice_held_back",
    "condition",
    "band",
    "record_value",
    "staff_entry",
    "meta_held_back",
  ],
  /** New keys, so production keeps whatever they hold; listed so the fixture holds every member the release writes. */
  ackPolicies: ["never", "approver", "member"],
  signerConfirmationKinds: ["assessed_patient", "treated_patient", "own_registration_number"],
} as const;

type Loose = Record<string, unknown>;

/**
 * The form map as the release stores it: converter stamp, printed leads and source hash, and its registration fields
 * moved to the release's record paths (session dates/times over up to 30 lines, a list of sessions from session 2).
 * The bundled maps' registration answers are resolved when a report is created, so the FINAL fill is unchanged.
 * Attested again, as the release confirms its own maps.
 */
export function releaseForm(base: FormDefinition): FormDefinition {
  const form = structuredClone(base) as FormDefinition & Loose;
  Object.assign(form.file, { sourceSha256: sha("b") });
  Object.assign(form.analysis, { convertedWith: "rtf-converter-3", printedLeads: { [form.fields[1].id]: "Date of birth:" }, guidanceVersion: 2 });
  const paths: Array<Loose> = [
    { path: "episode.firstSeenTime" },
    { path: "episode.attendedDate", part: { index: 14, of: 30 } },
    { path: "episode.attendedTime", part: { index: 3, of: 30 } },
    { path: "episode.attendedDates", sessions: { fromSession: 2 } },
    { path: "episode.attendedDates", sessions: { fromSession: 2, of: 8 } },
  ];
  const registration = form.fields.filter((f) => f.fillSource.kind === "registration");
  if (registration.length < paths.length) throw new Error("releaseForm: the base map needs 5 registration fields");
  paths.forEach((p, i) => {
    (registration[i] as Loose).fillSource = { kind: "registration", ...p };
  });
  (registration[0] as Loose).lintAccepted = [{ rule: "L5", reason: "Patient-reported, recorded in the notes.", by: APPROVER, at: RELEASE_AT }];
  return withAttestedConfirmation(form, "Practice manager", RELEASE_AT);
}

/**
 * The report as the release stores it: approver and reportModel 2; per-box decisions (disposition, accepted phrases,
 * adoption, answerBy, frozen condition); text provenance on paragraphs (by, own words, fixes, staff and approver
 * origins); every Gap.kind; acknowledgements with `by`; the release's flag codes; an amendment-style activity entry.
 * None of it changes what this build prints or checks for approval.
 */
export function releaseReport(base: Report, mapSha256: string): Report {
  const report = structuredClone(base) as Report & Loose;
  Object.assign(report, {
    approver: { memberId: APPROVER.memberId, name: APPROVER.name, hcpc: APPROVER.hcpc },
    reportModel: 2,
    approverTakeovers: [{ from: TOM_APPROVER, to: { memberId: APPROVER.memberId, name: APPROVER.name, hcpc: APPROVER.hcpc }, at: RELEASE_AT }],
  });
  if (report.form) report.form.mapSha256 = mapSha256;
  const answered = report.sections.filter((s) => s.paragraphs.length > 0);
  if (answered.length < 2) throw new Error("releaseReport: needs two answered boxes");
  const [first, second] = answered;
  Object.assign(first, {
    disposition: { kind: "applies_anyway", by: APPROVER, at: RELEASE_AT, reason: "The prior question was answered Yes.", controllerSnapshot: [{ sectionKey: second.key, answer: { kind: "yes_no", value: true } }, { sectionKey: second.key, answer: { kind: "text", value: "Back at work on light duties." } }] },
    accepted: [{ check: "OPINION_LANGUAGE", phrase: "good recovery", sentenceSha: sha("c"), noteId: "N-001", by: APPROVER, at: RELEASE_AT, reason: "My own recorded opinion." }],
    adoptedBy: { by: APPROVER, at: RELEASE_AT, contentSha: sha("d") },
    answerBy: APPROVER,
    condition: { controllers: [second.key], wants: "yes", wantsNot: "No", filled: true, text: "Only if the claimant is still in treatment.", parser: "conditions-2", readFrom: "label" },
    tombstones: [{ paragraphId: `${first.key}-deleted-1`, text: "A drafted line someone deleted.", sourceIds: ["N-001"], by: STAFF, at: RELEASE_AT }],
    markedNotApplicable: { by: STAFF.name, at: RELEASE_AT },
  });
  Object.assign(second, { answerBy: STAFF });
  first.paragraphs[0] = Object.assign(first.paragraphs[0], {
    origin: "staff",
    by: STAFF,
    fixes: [{ kind: "attribution", by: APPROVER, at: RELEASE_AT, edits: [{ start: 0, end: 0, text: "Sarah Reid recorded that " }] }],
    originalSourceIds: ["N-001"],
  });
  second.paragraphs[0] = Object.assign(second.paragraphs[0], { origin: "approver", by: APPROVER, ownWords: { by: APPROVER, at: RELEASE_AT } });
  const kinds = RELEASE_MEMBERS.gapKinds;
  report.gaps = [
    ...report.gaps.map((g) => ({ ...g, kind: "record_value" as const })),
    ...kinds.map((kind, i) => ({
      id: `gap-release-${i + 1}`,
      sectionKey: first.key,
      issue: `Release gap (${kind}).`,
      suggestedQuestion: "Confirm with the approving physiotherapist.",
      relatedNoteIds: [],
      raisedBy: "system" as const,
      kind,
      suggestedAnswer: "Yes",
      resolution: { kind: "resolved" as const, text: "Settled by the approver.", at: RELEASE_AT, leftBlank: false, byAnswer: true, notApplicable: false, by: APPROVER },
    })),
  ];
  report.flags = [
    ...RELEASE_MEMBERS.flagCodes.map((code, i) => ({
      id: `flag-release-${i + 1}`,
      code: code as Report["flags"][number]["code"],
      severity: i === 0 ? ("blocking" as const) : ("warning" as const),
      sectionKey: first.key,
      message: `Release check ${code}.`,
      ackPolicy: RELEASE_MEMBERS.ackPolicies[(i + 1) % RELEASE_MEMBERS.ackPolicies.length],
      acknowledged: { reason: "Checked by the approver.", at: RELEASE_AT, by: APPROVER },
    })),
  ];
  const entry: Loose = { at: RELEASE_AT, actor: APPROVER.name, action: "disposition_set", detail: "F-01: applies anyway.", reportId: "rpt_previous_version" };
  report.activity = [...report.activity, entry as Report["activity"][number]];
  return report;
}

export interface ReceiptInput {
  signer: Clinician;
  attestations: readonly string[];
  formMapSha256: string;
  now: Date;
}

/** A receipt as this build's /sign issues it (the baseline). */
export function receiptFor(report: Report, input: ReceiptInput): Promise<SignReceipt> {
  return createReceipt({
    report,
    signer: input.signer,
    statementAccepted: true,
    attestations: [...input.attestations],
    formMapSha256: input.formMapSha256,
    approvedVia: { kind: "demo", sid: "sid-approval" },
    now: input.now,
  });
}

/** Every key a receipt of the release holds, MAC over all of them – as the release's /sign issues it. */
export async function releaseReceipt(report: Report, input: ReceiptInput, bind?: { form: FormDefinition; fileBase64: string }): Promise<SignReceipt> {
  const { mac: _mac, ...unsigned } = await receiptFor(report, input);
  const bound = bind ? await releaseBindings(report, input, bind) : null;
  const signed: Loose = {
    ...unsigned,
    issuedContentSha256: bound?.issuedContentSha256 ?? sha("e"),
    acknowledgementsSha256: bound?.acknowledgementsSha256 ?? sha("f"),
    approverTakeover: { from: TOM_APPROVER, to: { memberId: APPROVER.memberId, name: APPROVER.name, hcpc: APPROVER.hcpc }, at: RELEASE_AT },
    signerConfirmations: RELEASE_MEMBERS.signerConfirmationKinds.map((kind) => ({
      kind,
      fieldId: "F-01",
      ...(kind === "own_registration_number" ? { value: APPROVER.hcpc } : {}),
    })),
  };
  return { ...signed, mac: createHmac("sha256", signingKey("receipt")).update(canonicalize(signed), "utf8").digest("base64url") } as unknown as SignReceipt;
}

/* ------------------------------------------------------------------------------------------------
 * Schema walks (the guard)
 * ----------------------------------------------------------------------------------------------*/

interface WalkDef {
  type: string;
  shape?: Record<string, z.ZodType>;
  element?: z.ZodType;
  innerType?: z.ZodType;
  options?: z.ZodType[];
  discriminator?: string;
  valueType?: z.ZodType;
  entries?: Record<string, string>;
  values?: unknown[];
}

/**
 * The closed vocabulary a write schema accepts: for every enum, literal, template literal and discriminator position
 * (dotted path; `[]` array items, `{}` record values, `<kind>` a union variant), the members it allows. Enums in
 * `open` are left out (the shim accepts any member there).
 */
export function closedVocabulary(schema: z.ZodType, open: ReadonlySet<z.ZodType>, path = "", out: Record<string, string[]> = {}): Record<string, string[]> {
  if (open.has(schema)) return out;
  const def = schema._zod.def as unknown as WalkDef;
  const add = (p: string, members: string[]) => {
    out[p] = Array.from(new Set([...(out[p] ?? []), ...members])).sort();
  };
  switch (def.type) {
    case "object":
      for (const [k, v] of Object.entries((schema as z.ZodObject).shape)) closedVocabulary(v as z.ZodType, open, `${path}.${k}`, out);
      break;
    case "array":
      closedVocabulary(def.element!, open, `${path}[]`, out);
      break;
    case "optional":
    case "nullable":
      closedVocabulary(def.innerType!, open, path, out);
      break;
    case "record":
      closedVocabulary(def.valueType!, open, `${path}{}`, out);
      break;
    case "union":
      for (const option of def.options!) {
        if (def.discriminator) {
          const tag = String(((option as z.ZodObject).shape[def.discriminator]._zod.def as unknown as WalkDef).values![0]);
          add(`${path}<${def.discriminator}>`, [tag]);
          closedVocabulary(option, open, `${path}<${tag}>`, out);
        } else {
          closedVocabulary(option, open, path, out);
        }
      }
      break;
    case "enum":
      add(path, Object.values(def.entries!));
      break;
    case "literal":
      add(path, def.values!.map(String));
      break;
    case "template_literal":
      add(path, [`/${(schema as unknown as { _zod: { pattern: RegExp } })._zod.pattern.source}/`]);
      break;
  }
  return out;
}

/** Every object node of a JSON value, with its path. */
export function objectNodes(value: unknown, path = "$", out: Array<{ path: string; node: Loose }> = []): Array<{ path: string; node: Loose }> {
  if (Array.isArray(value)) value.forEach((v, i) => objectNodes(v, `${path}[${i}]`, out));
  else if (value && typeof value === "object") {
    out.push({ path, node: value as Loose });
    for (const [k, v] of Object.entries(value)) objectNodes(v, `${path}.${k}`, out);
  }
  return out;
}

/** The values at a manifest path ("sections[].paragraphs[].by"); missing keys are left out. */
export function valuesAt(value: unknown, path: string): unknown[] {
  let current: unknown[] = [value];
  for (const part of path.split(".")) {
    const many = part.endsWith("[]");
    const key = many ? part.slice(0, -2) : part;
    const next: unknown[] = [];
    for (const v of current) {
      if (!v || typeof v !== "object" || !(key in v)) continue;
      const got = (v as Loose)[key];
      if (many && Array.isArray(got)) next.push(...got);
      else if (!many) next.push(got);
    }
    current = next;
  }
  return current;
}

/**
 * bh2 WA1 (design 6–7): on the release line the receipt's issued-document and acknowledgement hashes are bound –
 * /render FINAL recomputes them – so a release receipt carries the real values, worked out with the release's own
 * functions. A line without them (production + the shim, where both keys are opaque) keeps the planted values.
 */
async function releaseBindings(report: Report, input: ReceiptInput, bind: { form: FormDefinition; fileBase64: string }): Promise<{ issuedContentSha256: string; acknowledgementsSha256: string } | null> {
  const RECEIPT_MODULE = ["..", "..", "src", "modules", "medreport", "api", "handlers", "sign", "receipt"].join("/");
  let mod: Loose;
  try {
    mod = (await import(/* @vite-ignore */ RECEIPT_MODULE)) as Loose;
  } catch {
    return null;
  }
  if (typeof mod.issuedDocument !== "function" || typeof mod.issuedContentSha256 !== "function" || typeof mod.acknowledgementsSha256 !== "function") return null;
  const { validateReport } = await import("../../src/modules/medreport/core/validation");
  const { formToTemplate } = await import("../../src/modules/medreport/core/forms");
  const { decodeFormFile } = await import("../../src/modules/medreport/forms/file");
  const flags = validateReport(report, formToTemplate(bind.form), { form: bind.form }).flags;
  const issued = (await (mod.issuedDocument as (i: Loose) => Promise<{ bytes: Uint8Array }>)({ report, form: bind.form, file: decodeFormFile(bind.fileBase64), approval: { signer: input.signer, signedAt: input.now.toISOString() } })).bytes;
  return {
    issuedContentSha256: (mod.issuedContentSha256 as (b: Uint8Array) => string)(issued),
    acknowledgementsSha256: (mod.acknowledgementsSha256 as (f: unknown, g: unknown) => string)(flags, report.gaps ?? []),
  };
}
