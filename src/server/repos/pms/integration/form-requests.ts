/**
 * `pms_form_requests` – "Complete referrer form" started from a case: who the form is for and whether the patient
 * agreed that it may be shared with them (the date, and how – encrypted). The native connector reads the latest
 * one of a case into the ClinForms record as the disclosure consent. Never deleted by the app.
 */
import type { Selectable } from "kysely";
import { INTEGRATION_ID_PREFIXES as P } from "../../../../modules/pms/integration/ids";
import {
  FormRequestInputSchema,
  type FormRequestInput,
} from "../../../../modules/pms/integration/schemas";
import type { PmsActor } from "../../../../modules/pms/core/types";
import type { PmsFormRequestsTable } from "../../../db/pms-schema/integration";
import {
  assertTenantId,
  b01,
  decryptField,
  encryptField,
  isOn,
  nowIso,
  parseInput,
  pmsAuditQuery,
  pmsId,
  writeWithAudit,
  type RepoContext,
} from "../context";

const T = "pms_form_requests";

export interface FormRequest {
  tenantId: string;
  id: string;
  patientId: string;
  caseId: string;
  referrerId: string | null;
  consentRecorded: boolean;
  consentOn: string | null;
  /** Decrypted (get only). */
  consentNote: string | null;
  formRef: string | null;
  formTitle: string | null;
  clinicalPrefill: boolean;
  status: "opened" | "filed";
  filedFormId: string | null;
  filedAt: string | null;
  requestedBy: string | null;
  createdAt: string;
}

function toRequest(
  ctx: RepoContext,
  r: Selectable<PmsFormRequestsTable>,
  withNote: boolean,
): FormRequest {
  return {
    tenantId: r.tenant_id,
    id: r.id,
    patientId: r.patient_id,
    caseId: r.case_id,
    referrerId: r.referrer_id,
    consentRecorded: isOn(r.consent_recorded),
    consentOn: r.consent_on,
    consentNote: withNote
      ? decryptField(
          ctx,
          r.tenant_id,
          T,
          "consent_note_enc",
          r.id,
          r.consent_note_enc,
        )
      : null,
    formRef: r.form_ref,
    formTitle: r.form_title,
    clinicalPrefill: isOn(r.clinical_prefill),
    status: r.status === "filed" ? "filed" : "opened",
    filedFormId: r.filed_form_id,
    filedAt: r.filed_at,
    requestedBy: r.requested_by,
    createdAt: r.created_at,
  };
}

export async function createFormRequest(
  ctx: RepoContext,
  tenantId: string,
  input: FormRequestInput,
  actor: PmsActor,
): Promise<FormRequest> {
  assertTenantId(tenantId);
  const d = parseInput(FormRequestInputSchema, input, "Referrer form");
  const id = pmsId(P.formRequest, ctx);
  const at = nowIso(ctx);
  await writeWithAudit(
    ctx,
    [
      ctx.db.insertInto(T).values({
        tenant_id: tenantId,
        id,
        patient_id: d.patientId,
        case_id: d.caseId,
        referrer_id: d.referrerId ?? null,
        consent_recorded: b01(d.consentRecorded),
        consent_on: d.consentRecorded ? (d.consentOn ?? null) : null,
        consent_note_enc: encryptField(
          ctx,
          tenantId,
          T,
          "consent_note_enc",
          id,
          d.consentRecorded ? d.consentNote : null,
        ),
        form_ref: d.formRef ?? null,
        form_title: d.formTitle ?? null,
        clinical_prefill: b01(d.clinicalPrefill ?? false),
        status: "opened",
        filed_form_id: null,
        filed_at: null,
        requested_by: actor.userId,
        created_at: at,
      }),
      pmsAuditQuery(ctx, tenantId, actor, {
        action: "pms.form_request.create",
        targetType: "pms_form_request",
        targetId: id,
        detail: {
          caseId: d.caseId,
          consent: d.consentRecorded,
          clinicalPrefill: d.clinicalPrefill ?? false,
        },
      }),
    ],
    {
      foreignKey:
        "The case or the referrer does not exist in this clinic (or the case is another patient's).",
    },
  );
  return (await getFormRequest(ctx, tenantId, id)) as FormRequest;
}

export async function getFormRequest(
  ctx: RepoContext,
  tenantId: string,
  id: string,
): Promise<FormRequest | null> {
  assertTenantId(tenantId);
  const row = await ctx.db
    .selectFrom(T)
    .selectAll()
    .where("tenant_id", "=", tenantId)
    .where("id", "=", id)
    .executeTakeFirst();
  return row ? toRequest(ctx, row, true) : null;
}

/** The latest request of a case (the consent the ClinForms record carries), or null. */
export async function latestFormRequest(
  ctx: RepoContext,
  tenantId: string,
  caseId: string,
): Promise<FormRequest | null> {
  assertTenantId(tenantId);
  const row = await ctx.db
    .selectFrom(T)
    .selectAll()
    .where("tenant_id", "=", tenantId)
    .where("case_id", "=", caseId)
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .limit(1)
    .executeTakeFirst();
  return row ? toRequest(ctx, row, false) : null;
}

/** The latest request of a case still waiting for its approved form (the one a filed form answers), or null. */
export async function latestOpenFormRequest(
  ctx: RepoContext,
  tenantId: string,
  caseId: string,
): Promise<FormRequest | null> {
  assertTenantId(tenantId);
  const row = await ctx.db
    .selectFrom(T)
    .selectAll()
    .where("tenant_id", "=", tenantId)
    .where("case_id", "=", caseId)
    .where("status", "=", "opened")
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .limit(1)
    .executeTakeFirst();
  return row ? toRequest(ctx, row, false) : null;
}

/** A case's requests, newest first (no notes decrypted). */
export async function listFormRequests(
  ctx: RepoContext,
  tenantId: string,
  caseId: string,
): Promise<FormRequest[]> {
  assertTenantId(tenantId);
  const rows = await ctx.db
    .selectFrom(T)
    .selectAll()
    .where("tenant_id", "=", tenantId)
    .where("case_id", "=", caseId)
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .limit(100)
    .execute();
  return rows.map((r) => toRequest(ctx, r, false));
}
