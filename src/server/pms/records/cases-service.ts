/**
 * Cases (episodes of care) with their referrer and payer (insurer, medico-legal company, solicitor, employer), and
 * treatment authorisations – the shared record, through the foundation's repositories. Rules: ./access.ts.
 *
 *   patients.view – list and read cases and authorisations (the case page lists its clinical notes only for
 *                   members with clinical.view)
 *   patients.edit – open and change cases, add and change authorisations
 *
 * On top of the repositories: every case/authorisation of a request must be the patient's own, the payer account
 * must be a directory entry of a kind that can pay for the case's payer type (an insurer for an insured case…), and
 * the referrer, practitioner, site and price list must exist in this clinic.
 */
import { authorisationView, type AuthorisationView } from "../../../modules/pms/core/authorisations";
import {
  AuthorisationInputSchema,
  AuthorisationPatchSchema,
  CaseInputSchema,
  CasePatchSchema,
  fieldErrors,
  type AuthorisationInput,
  type AuthorisationPatch,
  type CaseInput,
  type CasePatch,
} from "../../../modules/pms/core/schemas";
import { ukToday } from "../../../modules/pms/core/text";
import type { Authorisation, Case, CaseSummary, PayerType } from "../../../modules/pms/core/types";
import { PAYER_KINDS, PAYER_TYPE_LABELS } from "../../../modules/pms/records/copy";
import type { NoteSummary } from "../../../modules/pms/records/types";
import { createAuthorisation, createCase, getAuthorisation, getCase, listAuthorisations, listCasesForPatient, updateAuthorisation, updateCase } from "../../repos/pms/cases";
import { getPractitioner, getSite } from "../../repos/pms/directory";
import { getPriceList } from "../../repos/pms/price-lists";
import { getReferrer } from "../../repos/pms/referrers";
import { listNotesForPatient } from "../../repos/pms/records/notes";
import { attempt, fail, forbidden, guard, notFound, ok, patientInClinic, saveFailure, type Failure, type RecordsActor, type Result } from "./access";

const CASE_RENAMES: Record<string, string> = { excessPence: "excess" };
const AUTH_RENAMES: Record<string, string> = { valueAuthorisedPence: "valueAuthorised" };

function renamed(errors: Record<string, string>, renames: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(errors)) out[renames[k] ?? k] = v;
  return out;
}

export async function listCasesFor(actor: RecordsActor, patientId: string): Promise<Result<CaseSummary[]>> {
  const denied = guard(actor, "patients.view");
  if (denied) return denied;
  return attempt("list_cases", async () => {
    const patient = await patientInClinic(actor, patientId);
    if (!patient) return notFound();
    return ok(await listCasesForPatient(actor.repo(), actor.tenantId, patient.id));
  });
}

export interface CaseDetails {
  case: Case;
  authorisations: (Authorisation & { view: AuthorisationView })[];
  /** The case's clinical notes – null when the member may not see clinical notes (never an empty list for them). */
  notes: NoteSummary[] | null;
}

async function caseOfPatient(actor: RecordsActor, patientId: string, caseId: string): Promise<Case | null> {
  const patient = await patientInClinic(actor, patientId);
  if (!patient || typeof caseId !== "string" || !caseId) return null;
  const c = await getCase(actor.repo(), actor.tenantId, caseId);
  return c && c.patientId === patient.id ? c : null;
}

export async function getCaseDetails(actor: RecordsActor, patientId: string, caseId: string): Promise<Result<CaseDetails>> {
  const denied = guard(actor, "patients.view");
  if (denied) return denied;
  return attempt("case_details", async () => {
    const c = await caseOfPatient(actor, patientId, caseId);
    if (!c) return notFound();
    const today = ukToday();
    const [auths, notes] = await Promise.all([
      listAuthorisations(actor.repo(), actor.tenantId, { caseId: c.id }),
      actor.can("clinical.view") ? listNotesForPatient(actor.repo(), actor.tenantId, c.patientId, { caseId: c.id }) : Promise.resolve(null),
    ]);
    // "See referral reason and case notes" (patients.referral): without it the case comes without that text.
    const shown = actor.can("patients.referral") ? c : { ...c, referralReason: null, notes: null };
    return ok({ case: shown, authorisations: auths.map((a) => ({ ...a, view: authorisationView(a, today) })), notes });
  });
}

/** The case's links must be this clinic's, and the payer account must fit the payer type. */
async function checkCaseLinks(actor: RecordsActor, links: { payerType?: PayerType | null; payerReferrerId?: string | null; referrerId?: string | null; practitionerId?: string | null; siteId?: string | null; priceListId?: string | null }): Promise<Failure | null> {
  const ctx = actor.repo();
  const t = actor.tenantId;
  const payerType = links.payerType ?? "self_pay";
  if (links.payerReferrerId) {
    if (payerType === "self_pay") return fail("invalid", "A self-pay case has no payer account.", { fieldErrors: { payerReferrerId: "Leave this empty for a self-pay case, or choose who pays." } });
    const payer = await getReferrer(ctx, t, links.payerReferrerId);
    if (!payer) return fail("invalid", "The payer account does not exist in this clinic.", { fieldErrors: { payerReferrerId: "Choose a payer account from the list." } });
    if (!PAYER_KINDS[payerType].includes(payer.kind)) {
      return fail("invalid", `That account cannot pay for a case of type “${PAYER_TYPE_LABELS[payerType]}”.`, { fieldErrors: { payerReferrerId: "Choose an account of the right kind." } });
    }
  }
  if (links.referrerId && !(await getReferrer(ctx, t, links.referrerId))) return fail("invalid", "The referrer does not exist in this clinic.", { fieldErrors: { referrerId: "Choose a referrer from the list." } });
  if (links.practitionerId && !(await getPractitioner(ctx, t, links.practitionerId))) return fail("invalid", "The practitioner does not exist in this clinic.", { fieldErrors: { practitionerId: "Choose a practitioner from the list." } });
  if (links.siteId && !(await getSite(ctx, t, links.siteId))) return fail("invalid", "The site does not exist in this clinic.", { fieldErrors: { siteId: "Choose a site from the list." } });
  if (links.priceListId && !(await getPriceList(ctx, t, links.priceListId))) return fail("invalid", "The price list does not exist in this clinic.", { fieldErrors: { priceListId: "Choose a price list from the list." } });
  return null;
}

/** Opens a case for the patient. */
export async function openCaseFor(actor: RecordsActor, patientId: string, input: Omit<CaseInput, "patientId">): Promise<Result<Case>> {
  const denied = guard(actor, "patients.edit");
  if (denied) return denied;
  return attempt("open_case", async () => {
    const patient = await patientInClinic(actor, patientId);
    if (!patient) return notFound();
    const full: CaseInput = actor.can("patients.referral") ? { ...input, patientId: patient.id } : { ...input, referralReason: undefined, notes: undefined, patientId: patient.id };
    const parsed = CaseInputSchema.safeParse(full);
    if (!parsed.success) return fail("invalid", "Some details need checking.", { fieldErrors: renamed(fieldErrors(parsed.error), CASE_RENAMES) });
    const bad = await checkCaseLinks(actor, parsed.data);
    if (bad) return bad;
    return ok(await createCase(actor.repo(), actor.tenantId, full, actor.actor));
  });
}

/** Changes a case (revision-checked). The payer check uses the case's values where the change leaves them. */
export async function updateCaseFor(actor: RecordsActor, patientId: string, caseId: string, expectedRev: number, patch: CasePatch): Promise<Result<{ rev: number }>> {
  const denied = guard(actor, "patients.edit");
  if (denied) return denied;
  const parsed = CasePatchSchema.safeParse(patch);
  if (!parsed.success) return fail("invalid", "Some details need checking.", { fieldErrors: renamed(fieldErrors(parsed.error), CASE_RENAMES) });
  // Without "See referral reason and case notes" the member never sees that text, so may not overwrite it either.
  if (!actor.can("patients.referral") && (parsed.data.referralReason !== undefined || parsed.data.notes !== undefined)) return forbidden();
  return attempt("update_case", async () => {
    const c = await caseOfPatient(actor, patientId, caseId);
    if (!c) return notFound();
    const d = parsed.data;
    const pick = <K extends keyof typeof d>(k: K, current: unknown) => (d[k] !== undefined ? d[k] : current);
    const bad = await checkCaseLinks(actor, {
      payerType: pick("payerType", c.payerType) as PayerType,
      payerReferrerId: pick("payerReferrerId", c.payerReferrerId) as string | null,
      referrerId: d.referrerId,
      practitionerId: d.practitionerId,
      siteId: d.siteId,
      priceListId: d.priceListId,
    });
    if (bad) return bad;
    const openedOn = pick("openedOn", c.openedOn) as string;
    const closedOn = pick("closedOn", c.closedOn) as string | null;
    if (closedOn && closedOn < openedOn) return fail("invalid", "The case cannot close before it opens.", { fieldErrors: { closedOn: "The case cannot close before it opens." } });
    const saved = await updateCase(actor.repo(), actor.tenantId, c.id, expectedRev, patch, actor.actor);
    return saved.ok ? ok({ rev: saved.rev }) : saveFailure(saved);
  });
}

async function checkAuthorisationReferrer(actor: RecordsActor, referrerId: string | null | undefined): Promise<Failure | null> {
  if (!referrerId) return null;
  return (await getReferrer(actor.repo(), actor.tenantId, referrerId)) ? null : fail("invalid", "The issuer does not exist in this clinic.", { fieldErrors: { referrerId: "Choose who issued it from the list." } });
}

export async function addAuthorisationFor(actor: RecordsActor, patientId: string, caseId: string, input: Omit<AuthorisationInput, "caseId">): Promise<Result<Authorisation>> {
  const denied = guard(actor, "patients.edit");
  if (denied) return denied;
  return attempt("add_authorisation", async () => {
    const c = await caseOfPatient(actor, patientId, caseId);
    if (!c) return notFound();
    const full: AuthorisationInput = { ...input, caseId: c.id };
    const parsed = AuthorisationInputSchema.safeParse(full);
    if (!parsed.success) return fail("invalid", "Some details need checking.", { fieldErrors: renamed(fieldErrors(parsed.error), AUTH_RENAMES) });
    const bad = await checkAuthorisationReferrer(actor, parsed.data.referrerId);
    if (bad) return bad;
    return ok(await createAuthorisation(actor.repo(), actor.tenantId, full, actor.actor));
  });
}

export async function updateAuthorisationFor(actor: RecordsActor, patientId: string, caseId: string, authorisationId: string, expectedRev: number, patch: AuthorisationPatch): Promise<Result<{ rev: number }>> {
  const denied = guard(actor, "patients.edit");
  if (denied) return denied;
  const parsed = AuthorisationPatchSchema.safeParse(patch);
  if (!parsed.success) return fail("invalid", "Some details need checking.", { fieldErrors: renamed(fieldErrors(parsed.error), AUTH_RENAMES) });
  return attempt("update_authorisation", async () => {
    const c = await caseOfPatient(actor, patientId, caseId);
    if (!c) return notFound();
    const auth = typeof authorisationId === "string" && authorisationId ? await getAuthorisation(actor.repo(), actor.tenantId, authorisationId) : null;
    if (!auth || auth.caseId !== c.id) return notFound();
    const bad = await checkAuthorisationReferrer(actor, parsed.data.referrerId);
    if (bad) return bad;
    const saved = await updateAuthorisation(actor.repo(), actor.tenantId, auth.id, expectedRev, patch, actor.actor);
    return saved.ok ? ok({ rev: saved.rev }) : saveFailure(saved);
  });
}

/** Cancels an authorisation (kept on the case) or brings it back into use. */
export async function setAuthorisationStatusFor(actor: RecordsActor, patientId: string, caseId: string, authorisationId: string, expectedRev: number, status: "active" | "cancelled"): Promise<Result<{ rev: number }>> {
  if (status !== "active" && status !== "cancelled") return fail("invalid", "Choose a status.");
  return updateAuthorisationFor(actor, patientId, caseId, authorisationId, expectedRev, { status });
}
