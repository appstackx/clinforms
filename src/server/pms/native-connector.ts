/**
 * The NATIVE connector (K2-CF-001): ClinForms reads a case straight from the clinic system's own record – in the same
 * app, through the repositories (no HTTP round trip to itself) – and files the approved form back to the case.
 *
 * It implements medreport's connector interface (src/modules/medreport/connectors/types.ts) host-side and is
 * registered in the app glue (src/app/api/_medreport-glue.ts) next to the standard connectors, but it is never listed
 * on GET /connectors (no tile): it is only reached from "Complete referrer form" on a case, which issues a launch for
 * exactly that patient and case (src/server/pms/integration/referrer-forms.ts).
 *
 * Who is asking is checked here again, on every call, from the signed-in session (not only from ClinForms' own
 * launch session): the member must belong to the connector context's clinic, that clinic must have the clinic-system
 * package, the member needs patients.view and the patient must be in the member's sites. The bundle carries signed
 * notes and outcome scores only when the member may see clinical notes (clinical.view) – reception never gets a
 * clinical prefill – and the referral reason only with patients.referral. Unsigned drafts are never sent.
 *
 * Every read and every filing is audited (ids only).
 */
import "server-only";
import {
  ConnectorError,
  type AttachDocumentInput,
  type ClinicSystemConnector,
  type ConnectorContext,
  type ConnectorEpisodeRef,
} from "../../modules/medreport/connectors/types";
import type {
  AttachReceipt,
  EpisodeBundle,
  ImportPayload,
} from "../../modules/medreport/core/types";
import { CLINIC_SYSTEM_NAME } from "../../lib/brand";
import { pmsNow } from "../../modules/pms/core/clock";
import type { PmsPermission } from "../../modules/pms/core/permissions";
import type { PmsActor } from "../../modules/pms/core/types";
import { getDataCipher } from "../crypto";
import { getDb } from "../db";
import type { RepoContext } from "../repos/context";
import { getCase } from "../repos/pms/cases";
import { pmsAudit } from "../repos/pms/context";
import { fileReferrerForm } from "../repos/pms/integration/filed-forms";
import { latestOpenFormRequest } from "../repos/pms/integration/form-requests";
import { patientVisibleInScope } from "./access";
import { clinicActionActor } from "./actor";
import { hasPackage } from "./entitlements";
import {
  NativeBundleError,
  NATIVE_CONNECTOR_ID,
  loadNativeBundle,
} from "./integration/bundle";
import type { IntegrationPorts } from "./integration/ports";
import { integrationPorts } from "./integration/wiring";

/** The member behind a connector call, as far as the connector needs to know. */
export interface NativeCaller {
  tenantId: string;
  can: (permission: PmsPermission) => boolean;
  siteIds: ReadonlySet<string> | null;
  actor: PmsActor;
}

export interface NativeConnectorDeps {
  /** The signed-in member (default: the clinic system's actor from the request's session), or null. */
  caller?: () => Promise<NativeCaller | null>;
  repo?: () => RepoContext;
  ports?: () => IntegrationPorts;
  /** Whether a clinic has the clinic-system package (default: the entitlements table). */
  entitled?: (tenantId: string) => Promise<boolean>;
  now?: () => Date;
}

async function sessionCaller(): Promise<NativeCaller | null> {
  const a = await clinicActionActor({ permission: "patients.view" });
  if ("error" in a) return null;
  return {
    tenantId: a.tenantId,
    can: a.can,
    siteIds: a.siteIds,
    actor: a.actor,
  };
}

const NOT_AVAILABLE =
  "Open the form again from the patient's case in the clinic system.";

export function createNativeConnector(
  deps: NativeConnectorDeps = {},
): ClinicSystemConnector {
  const repo = deps.repo ?? (() => ({ db: getDb(), cipher: getDataCipher(), now: pmsNow }));
  const ports = deps.ports ?? integrationPorts;
  const entitled =
    deps.entitled ?? ((tenantId: string) => hasPackage(tenantId, "clinic"));
  const callerOf = deps.caller ?? sessionCaller;

  /** The member of THIS clinic with the clinic system and patients.view, and the case of this patient in their sites. */
  async function authorise(
    ctx: ConnectorContext,
    ref: ConnectorEpisodeRef,
  ): Promise<{ caller: NativeCaller; repoCtx: RepoContext }> {
    if (!(await entitled(ctx.tenantId)))
      throw new ConnectorError(
        "NOT_CONFIGURED",
        `${CLINIC_SYSTEM_NAME} is not switched on for this clinic.`,
      );
    const caller = await callerOf();
    if (
      !caller ||
      caller.tenantId !== ctx.tenantId ||
      !caller.can("patients.view")
    )
      throw new ConnectorError("NOT_FOUND", NOT_AVAILABLE);
    const repoCtx = repo();
    const kase = await getCase(repoCtx, ctx.tenantId, ref.episodeId);
    if (!kase || kase.patientId !== ref.patientId)
      throw new ConnectorError("NOT_FOUND", NOT_AVAILABLE);
    if (
      caller.siteIds !== null &&
      !(await patientVisibleInScope(
        repoCtx,
        ctx.tenantId,
        ref.patientId,
        caller.siteIds,
      ))
    )
      throw new ConnectorError("NOT_FOUND", NOT_AVAILABLE);
    return { caller, repoCtx };
  }

  return {
    id: NATIVE_CONNECTOR_ID,
    label: CLINIC_SYSTEM_NAME,
    simulated: false,
    status: "connected",
    capabilities: {
      patients: true,
      clinicalNotes: true,
      appointments: true,
      outcomeMeasures: true,
      writeBackDocuments: true,
    },
    note: `${CLINIC_SYSTEM_NAME} – this clinic's own patient record`,

    async getEpisodeBundle(
      ctx: ConnectorContext,
      ref: ConnectorEpisodeRef | { upload: ImportPayload },
    ): Promise<EpisodeBundle> {
      if ("upload" in ref)
        throw new ConnectorError(
          "UNSUPPORTED",
          "Uploads are not read through the clinic system's record.",
        );
      const { caller, repoCtx } = await authorise(ctx, ref);
      const clinical = caller.can("clinical.view");
      try {
        const bundle = await loadNativeBundle(
          repoCtx,
          ctx.tenantId,
          ref.patientId,
          ref.episodeId,
          {
            ports: ports(),
            clinical,
            referral: caller.can("patients.referral"),
            now: deps.now?.() ?? pmsNow(),
          },
        );
        await pmsAudit(repoCtx, ctx.tenantId, caller.actor, {
          action: "pms.native.bundle_read",
          targetType: "pms_case",
          targetId: ref.episodeId,
          detail: {
            patientId: ref.patientId,
            clinical,
            notes: bundle.notes.length,
            outcomes: bundle.outcomeMeasures.length,
            appointments: bundle.appointments.length,
          },
        });
        ctx.trace.push({
          method: "GET",
          url: "native:/case-record",
          status: 200,
          ms: 0,
          transport: "in-process",
        });
        return bundle;
      } catch (err) {
        if (err instanceof NativeBundleError)
          throw new ConnectorError(
            err.code === "NOT_FOUND" ? "NOT_FOUND" : "INVALID_DATA",
            err.message,
          );
        throw err;
      }
    },

    async attachDocument(
      ctx: ConnectorContext,
      input: AttachDocumentInput,
    ): Promise<AttachReceipt> {
      const { caller, repoCtx } = await authorise(ctx, {
        patientId: input.patientId,
        episodeId: input.episodeId,
      });
      const bytes = new Uint8Array(Buffer.from(input.contentBase64, "base64"));
      const request = await latestOpenFormRequest(
        repoCtx,
        ctx.tenantId,
        input.episodeId,
      );
      const r = input.receipt;
      const { form } = await fileReferrerForm(
        repoCtx,
        ctx.tenantId,
        {
          patientId: input.patientId,
          caseId: input.episodeId,
          title: input.title.slice(0, 300),
          fileName: input.fileName.slice(0, 200),
          mimeType: input.mimeType as "application/pdf",
          sha256: input.sha256,
          reportId: r.reportId,
          // The receipt as issued (ids, signer, times, hashes – no patient data).
          receipt: JSON.parse(JSON.stringify(r)) as Record<string, unknown>,
          signerName: r.signer.name.slice(0, 160),
          signerRegistration: r.signer.hcpc.slice(0, 40),
          signedAt: r.signedAt,
          formRequestId: request?.id ?? null,
        },
        bytes,
        caller.actor,
      );
      ctx.trace.push({
        method: "POST",
        url: "native:/case-record/forms",
        status: 201,
        ms: 0,
        transport: "in-process",
      });
      return {
        externalDocumentId: form.id,
        receivedAt: form.filedAt,
        sha256: form.sha256,
      };
    },
  };
}
