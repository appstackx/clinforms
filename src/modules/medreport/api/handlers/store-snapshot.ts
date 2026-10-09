import "server-only";

/**
 * GET /api/reports/v1/store/snapshot (signed-in clinic member, two-step verified)
 * → {tenantId, reports: summaries, forms: summaries, settings: {referrerLinks, updatedAt}, limits}.
 * Summaries carry no patient data (ids, revisions, statuses, template / form ids, times). The Studio fetches
 * the full records it needs by id (GET /store/reports/{id}, /store/forms/{id}).
 *
 * Owner: store slice (wave 2).
 */
import { MAX_FORM_FILE_BYTES } from "../../config.public";
import { json, type MedreportHandler } from "../http";
import { ReferrerLinksSchema, STORE_FILE_CHUNK_BYTES, type StoreSnapshotResponse } from "../store-contract";
import { requireTenantActor } from "./store-actor";

export const handleStoreSnapshot: MedreportHandler = async (req, _ctx, deps) => {
  const t = await requireTenantActor(req, deps);
  const [reports, forms, settings] = await Promise.all([
    t.store.listReports(t.tenantId),
    t.store.listForms(t.tenantId),
    t.store.getSettings(t.tenantId),
  ]);
  const links = ReferrerLinksSchema.safeParse(settings?.referrerLinks ?? {});
  const body: StoreSnapshotResponse = {
    tenantId: t.tenantId,
    reports: reports.map((r) => ({
      id: r.id,
      rev: r.rev,
      status: r.status,
      templateId: r.templateId,
      formId: r.formId,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
    forms: forms.map((f) => ({
      id: f.id,
      rev: f.rev,
      status: f.status,
      title: f.title,
      kind: f.kind,
      fileSha256: f.fileSha256,
      sampleId: f.sampleId,
      updatedAt: f.updatedAt,
    })),
    settings: { referrerLinks: links.success ? links.data : {}, updatedAt: settings?.updatedAt ?? null },
    limits: { chunkBytes: STORE_FILE_CHUNK_BYTES, maxFileBytes: MAX_FORM_FILE_BYTES },
  };
  return json(body);
};
