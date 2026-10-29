/**
 * "Complete referrer form" on a case (K2-CF-003/004, design round 3 ReferrerForm): the server side of the case's
 * "Referrer and insurer forms" panel, the form picker, the hand-over to ClinForms and the filed forms.
 *
 *   referrerFormsFor()       – the panel: the clinic's ClinForms library (confirmed forms, the case's referrer's and
 *                              insurer's first), the forms filed to the case, whether this member may start one;
 *   startReferrerFormFor()   – records the request (form chosen, consent, whether a clinical prefill is offered) and
 *                              issues a ClinForms launch for exactly this patient and case through the NATIVE connector
 *                              (src/server/pms/native-connector.ts) – in-process, no partner key, no HTTP to itself –
 *                              and answers the Studio address that opens the chosen form with the record loaded;
 *   filedFormsForPatient()   – the record's Forms tab: every approved form filed back, with who approved it and when;
 *   filedFormFileFor()       – one filed file (clinical.view only: a completed referrer form holds clinical content).
 *
 * Rules: the clinic must have both packages (the clinic system and ClinForms); patients.view and the patient in the
 * member's sites; the request is audited in its own write; a member without clinical.view (reception) may still start
 * a form, but ClinForms then receives no signed notes or outcome scores (the native connector checks it again).
 */
import "server-only";
import { createLaunchToken } from "../../../modules/medreport/auth/launch-token";
import { isPlausibleRecordId } from "../../../modules/pms/records/form-values";
import { ukToday } from "../../../modules/pms/core/text";
import { logAuthEvent } from "../../email/log";
import { RepoInputError } from "../../repos/context";
import { pmsAudit } from "../../repos/pms/context";
import { listFormMeta } from "../../repos/forms";
import { getCase } from "../../repos/pms/cases";
import {
  findPractitionerByUser,
  getPractitioner,
} from "../../repos/pms/directory";
import { getReferrer } from "../../repos/pms/referrers";
import {
  listFiledForms,
  readFiledFormFile,
  type FiledFormSummary,
} from "../../repos/pms/integration/filed-forms";
import { createFormRequest } from "../../repos/pms/integration/form-requests";
import { patientVisibleInScope } from "../access";
import type { ClinicActor } from "../actor";
import { hasPackage } from "../entitlements";
import { NATIVE_CONNECTOR_ID } from "./bundle";
import { assertTenantMayCreate } from "../../../modules/medreport/auth/clinic-access";
import type { ClinicProfile } from "../../../modules/medreport/api/deps";
import { HttpError } from "../../../modules/medreport/api/http";
import { loadClinicProfile } from "../../auth/medreport-actor";
import { getDb } from "../../db";

/** What the panel and the launch read outside the clinic system (tests replace them). */
export interface ReferrerFormDeps {
  /** Whether the clinic has a package (default: the entitlements table). */
  packageOn?: (tenantId: string, pkg: "reports" | "clinic") => Promise<boolean>;
  /** ClinForms' clinic profile with its trial (default: loadClinicProfile on the app's database). */
  clinicProfile?: (tenantId: string) => Promise<ClinicProfile | null>;
}

/** M10 M1: the words when ClinForms' trial has ended (the partner launch answers 403 TRIAL_ENDED). */
export const TRIAL_ENDED_MESSAGE = "Your ClinForms trial has ended, so no new forms can be started. Ask the clinic owner to choose a plan.";

/** null when ClinForms may start a form for this clinic; else the reason (its trial has ended). */
async function launchRefusal(tenantId: string, deps: ReferrerFormDeps): Promise<string | null> {
  const clinicProfile = deps.clinicProfile ?? ((t: string) => loadClinicProfile(getDb(), t));
  try {
    await assertTenantMayCreate({ clinicProfile } as Parameters<typeof assertTenantMayCreate>[0], tenantId, "launch");
    return null;
  } catch (err) {
    if (err instanceof HttpError) return TRIAL_ENDED_MESSAGE;
    throw err;
  }
}

export type ReferrerFormsActor = Pick<
  ClinicActor,
  "tenantId" | "userId" | "name" | "can" | "actor" | "repo"
> &
  Partial<Pick<ClinicActor, "siteIds">>;

export type Result<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      code: "forbidden" | "not_found" | "invalid" | "error";
      error: string;
    };

const FORBIDDEN = "You do not have permission to do that.";
const NOT_FOUND = "This case no longer exists in this clinic.";

/** Where a clinic's Studio opens a launch (medreport api/handlers/launch.ts TENANT_LAUNCH_PATH). */
export const STUDIO_NEW_PATH = "/app/studio/new";

export interface LibraryForm {
  id: string;
  title: string;
  referrer: string | null;
  /** The form's referrer is the case's payer or referrer (shown first, "for this case"). */
  forThisCase: boolean;
}

export interface FiledFormRow extends FiledFormSummary {
  caseTitle: string | null;
}

export interface ReferrerFormsPanel {
  /** ClinForms (the Reports package) is on for the clinic. */
  clinForms: boolean;
  /** The member may start "Complete referrer form" (patients.view, both packages, ClinForms' trial not ended). */
  canStart: boolean;
  /** Why not, when ClinForms is on but no form can be started (M10 M1: the trial has ended). */
  cannotStartReason: string | null;
  /** The member may see clinical notes: ClinForms gets the signed notes and outcome scores. */
  clinicalPrefill: boolean;
  /** The member may open the filed files. */
  canOpenFiles: boolean;
  library: LibraryForm[];
  filed: FiledFormRow[];
  /** The names the library was matched against (the case's payer and referrer). */
  matchedNames: string[];
}

/** "Bluewell Health (fictional)" → "bluewell health". */
function nameKey(raw: string | null | undefined): string {
  return (raw ?? "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function matches(
  formReferrer: string | null,
  names: readonly string[],
): boolean {
  const k = nameKey(formReferrer);
  if (!k) return false;
  return names.some((n) => {
    const m = nameKey(n);
    return Boolean(m) && (m === k || m.includes(k) || k.includes(m));
  });
}

async function caseInScope(
  actor: ReferrerFormsActor,
  patientId: string,
  caseId: string,
) {
  if (!isPlausibleRecordId(patientId) || !isPlausibleRecordId(caseId))
    return null;
  const ctx = actor.repo();
  if (
    actor.siteIds &&
    !(await patientVisibleInScope(
      ctx,
      actor.tenantId,
      patientId,
      actor.siteIds,
    ))
  )
    return null;
  const c = await getCase(ctx, actor.tenantId, caseId);
  return c && c.patientId === patientId ? c : null;
}

function fail<T>(
  code: "forbidden" | "not_found" | "invalid" | "error",
  error: string,
): Result<T> {
  return { ok: false, code, error };
}

export async function referrerFormsFor(
  actor: ReferrerFormsActor,
  patientId: string,
  caseId: string,
  deps: ReferrerFormDeps = {},
): Promise<Result<ReferrerFormsPanel>> {
  if (!actor.can("patients.view")) return fail("forbidden", FORBIDDEN);
  const c = await caseInScope(actor, patientId, caseId);
  if (!c) return fail("not_found", NOT_FOUND);
  const ctx = actor.repo();
  const clinForms = await (deps.packageOn ?? hasPackage)(actor.tenantId, "reports");
  const refusal = clinForms ? await launchRefusal(actor.tenantId, deps) : null;
  const [payer, referrer, filed, meta] = await Promise.all([
    c.payerReferrerId
      ? getReferrer(ctx, actor.tenantId, c.payerReferrerId)
      : Promise.resolve(null),
    c.referrerId
      ? getReferrer(ctx, actor.tenantId, c.referrerId)
      : Promise.resolve(null),
    listFiledForms(ctx, actor.tenantId, { caseId: c.id }),
    clinForms ? listFormMeta(ctx, actor.tenantId) : Promise.resolve([]),
  ]);
  const names = [payer?.name, referrer?.name].filter((x): x is string =>
    Boolean(x),
  );
  const library = meta
    .filter((f) => f.status === "confirmed")
    .map((f): LibraryForm => ({
      id: f.id,
      title: f.title,
      referrer: f.referrer,
      forThisCase: matches(f.referrer, names),
    }))
    .sort(
      (a, b) =>
        Number(b.forThisCase) - Number(a.forThisCase) ||
        a.title.localeCompare(b.title),
    );
  return {
    ok: true,
    value: {
      clinForms,
      canStart: clinForms && refusal === null,
      cannotStartReason: refusal,
      clinicalPrefill: actor.can("clinical.view"),
      canOpenFiles: actor.can("clinical.view"),
      library,
      filed: filed.map((f) => ({ ...f, caseTitle: c.title })),
      matchedNames: names,
    },
  };
}

export interface StartReferrerFormInput {
  patientId: string;
  caseId: string;
  formId: string;
  /** The patient agreed that the completed form may be shared with the referrer. */
  consentRecorded: boolean;
  consentOn?: string | null;
}

/** Records the request and answers the Studio address that opens the chosen form with this case loaded. */
export async function startReferrerFormFor(
  actor: ReferrerFormsActor,
  input: StartReferrerFormInput,
  deps: ReferrerFormDeps = {},
): Promise<Result<{ url: string; requestId: string }>> {
  if (!actor.can("patients.view")) return fail("forbidden", FORBIDDEN);
  const c = await caseInScope(
    actor,
    String(input.patientId ?? ""),
    String(input.caseId ?? ""),
  );
  if (!c) return fail("not_found", NOT_FOUND);
  if (!(await (deps.packageOn ?? hasPackage)(actor.tenantId, "reports")))
    return fail("forbidden", "ClinForms is not switched on for this clinic.");
  // M10 M1: the same trial-ended rule as ClinForms' partner launch (api/handlers/launch.ts) – before anything is written.
  const refusal = await launchRefusal(actor.tenantId, deps);
  if (refusal) return fail("forbidden", refusal);
  const ctx = actor.repo();
  const form = (await listFormMeta(ctx, actor.tenantId)).find(
    (f) => f.id === input.formId && f.status === "confirmed",
  );
  if (!form)
    return fail(
      "invalid",
      "Choose a form from your clinic's ClinForms library.",
    );
  try {
    const consentOn = input.consentRecorded
      ? (input.consentOn ?? ukToday(ctx.now ? ctx.now() : new Date()))
      : null;
    const clinicalPrefill = actor.can("clinical.view");
    const request = await createFormRequest(
      ctx,
      actor.tenantId,
      {
        patientId: c.patientId,
        caseId: c.id,
        referrerId: c.payerReferrerId ?? c.referrerId ?? null,
        consentRecorded: input.consentRecorded,
        consentOn,
        consentNote: null,
        formRef: form.id,
        formTitle: form.title.slice(0, 300),
        clinicalPrefill,
      },
      actor.actor,
    );
    // The clinician the form is completed for: the member's own practitioner record with a registration number,
    // else the case's practitioner (the approving clinician is still whoever approves in ClinForms).
    const own = await findPractitionerByUser(ctx, actor.tenantId, actor.userId);
    const treating = own?.registrationNumber
      ? own
      : c.practitionerId
        ? await getPractitioner(ctx, actor.tenantId, c.practitionerId)
        : null;
    const clinician = treating?.registrationNumber
      ? { name: treating.displayName, hcpc: treating.registrationNumber }
      : { name: actor.name || "Clinician", hcpc: "not recorded" };
    const issued = createLaunchToken({
      tenantId: actor.tenantId,
      connectorId: NATIVE_CONNECTOR_ID,
      patientId: c.patientId,
      episodeId: c.id,
      clinician,
      // M10 L7: only this member can redeem the launch (ClinForms' /launch/verify checks it).
      forUserId: actor.userId,
    });
    const url = `${STUDIO_NEW_PATH}?lt=${encodeURIComponent(issued.token)}&form=${encodeURIComponent(form.id)}`;
    return { ok: true, value: { url, requestId: request.id } };
  } catch (err) {
    if (err instanceof RepoInputError) return fail("invalid", err.message);
    logAuthEvent("pms_referrer_form_start_failed", {
      error: err instanceof Error ? err.name : "error",
    });
    return fail("error", "Something went wrong. Please try again.");
  }
}

/** The record's Forms tab: every approved referrer form filed back, newest first (patients.view; nothing decrypted). */
export async function filedFormsForPatient(
  actor: ReferrerFormsActor,
  patientId: string,
): Promise<Result<{ rows: FiledFormRow[]; canOpenFiles: boolean }>> {
  if (!actor.can("patients.view")) return fail("forbidden", FORBIDDEN);
  if (!isPlausibleRecordId(patientId)) return fail("not_found", NOT_FOUND);
  const ctx = actor.repo();
  if (
    actor.siteIds &&
    !(await patientVisibleInScope(
      ctx,
      actor.tenantId,
      patientId,
      actor.siteIds,
    ))
  )
    return fail("not_found", NOT_FOUND);
  const rows = await listFiledForms(ctx, actor.tenantId, { patientId });
  const titles = new Map<string, string | null>();
  for (const id of Array.from(new Set(rows.map((r) => r.caseId))))
    titles.set(id, (await getCase(ctx, actor.tenantId, id))?.title ?? null);
  return {
    ok: true,
    value: {
      rows: rows.map((r) => ({
        ...r,
        caseTitle: titles.get(r.caseId) ?? null,
      })),
      canOpenFiles: actor.can("clinical.view"),
    },
  };
}

/** One filed form's file (clinical.view – the completed form holds clinical content), checked against its checksum. */
export async function filedFormFileFor(
  actor: ReferrerFormsActor,
  patientId: string,
  filedFormId: string,
): Promise<Result<{ bytes: Buffer; mimeType: string; fileName: string }>> {
  if (!actor.can("clinical.view")) return fail("forbidden", FORBIDDEN);
  if (!isPlausibleRecordId(patientId) || !isPlausibleRecordId(filedFormId))
    return fail("not_found", "This form no longer exists in this clinic.");
  const ctx = actor.repo();
  if (
    actor.siteIds &&
    !(await patientVisibleInScope(
      ctx,
      actor.tenantId,
      patientId,
      actor.siteIds,
    ))
  )
    return fail("not_found", "This form no longer exists in this clinic.");
  try {
    const file = await readFiledFormFile(ctx, actor.tenantId, filedFormId);
    if (!file || file.form.patientId !== patientId)
      return fail("not_found", "This form no longer exists in this clinic.");
    await pmsAudit(ctx, actor.tenantId, actor.actor, {
      action: "pms.filed_form.view",
      targetType: "pms_filed_form",
      targetId: filedFormId,
      detail: { caseId: file.form.caseId },
    });
    return {
      ok: true,
      value: {
        bytes: file.bytes,
        mimeType: file.form.mimeType,
        fileName: file.form.fileName,
      },
    };
  } catch (err) {
    logAuthEvent("pms_filed_form_read_failed", {
      error: err instanceof Error ? err.name : "error",
    });
    return fail("error", "The filed form could not be read. Please try again.");
  }
}
