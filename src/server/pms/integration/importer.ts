/**
 * The three long steps of a data import, page by page: CHECK (the dry run – nothing is written to the clinic's
 * records), IMPORT (after the staff check) and UNDO. Each call takes the batch's lease, works on one page of rows and
 * returns its progress; the page calls again until `done` (so a large file never needs one long request, and a
 * crashed call is picked up by the next one after the lease).
 *
 * Writing goes through the shared record's own repositories (validation, encryption, audit: bulk loads of ≤ 40 with
 * one audit row each) and, for appointments and invoices, through the diary's and billing's ports. Nothing is ever
 * deleted: undo archives the patients and closes the cases it made, cancels their authorisations, makes the payers
 * and referrers it added inactive and asks the diary and billing to cancel / void theirs – and KEEPS any record
 * changed or used since the import.
 */
import "server-only";
import { ukToday } from "../../../modules/pms/core/text";
import type { PmsActor } from "../../../modules/pms/core/types";
import {
  IMPORT_KIND_INFO,
  type ImportKind,
} from "../../../modules/pms/integration/import-kinds";
import type {
  BatchCounts,
  BatchStatus,
} from "../../../modules/pms/integration/import-status";
import {
  hasError,
  issue,
  type RowIssue,
} from "../../../modules/pms/integration/issues";
import { validateMapping } from "../../../modules/pms/integration/mapping";
import {
  resolveImportRecord,
  type AppointmentPlan,
  type CasePlan,
  type DirectoryRef,
  type ImportLookups,
  type ImportPlan,
  type InvoicePlan,
  type PatientPlan,
} from "../../../modules/pms/integration/resolve";
import {
  readImportRow,
  type AnyImportRecord,
  type AppointmentImportRecord,
  type CaseImportRecord,
  type InvoiceImportRecord,
} from "../../../modules/pms/integration/rows";
import {
  authorisationInputOf,
  caseInputOf,
  caseRecordIssues,
  patientInputOf,
  patientRecordIssues,
} from "../../../modules/pms/integration/to-inputs";
import { RepoInputError, type RepoContext } from "../../repos/context";
import {
  bulkCreateAuthorisations,
  bulkCreateCases,
  updateAuthorisation,
  updateCase,
} from "../../repos/pms/cases";
import {
  listPractitioners,
  listRooms,
  listServices,
  listSites,
} from "../../repos/pms/directory";
import {
  caseIdsByImportRef,
  casesOfPatients,
  claimImportStep,
  computeBatchCounts,
  countDependentImportedRows,
  countImportRows,
  finishImportStep,
  getImportBatch,
  listImportRows,
  patientIdsByImportRef,
  readyRefsBefore,
  recordDirectoryAdded,
  referrerLookups,
  releaseImportStep,
  saveRowOutcomes,
  undoneImportedCaseIds,
  unlinkedRecordsSince,
  type ImportBatch,
  type ImportRow,
  type RowOutcome,
} from "../../repos/pms/integration/import-batches";
import {
  bulkCreatePatients,
  setPatientStatus,
  updatePatient,
} from "../../repos/pms/patients";
import {
  createReferrer,
  getReferrer,
  updateReferrer,
} from "../../repos/pms/referrers";
import {
  importTargetAvailable,
  importTargetMissingMessage,
  type IntegrationPorts,
  type ResolvedInvoice,
} from "./ports";

export interface StepProgress {
  status: BatchStatus;
  done: boolean;
  /** Rows this call worked on. */
  processed: number;
  /** Rows still to do in this step. */
  remaining: number;
  counts?: BatchCounts;
  /** Another call holds the batch right now: wait a moment and call again. */
  busy?: boolean;
}

export const PAGE_SIZES = { check: 400, import: 120, undo: 100 } as const;

function today(ctx: RepoContext): string {
  return ukToday(ctx.now ? ctx.now() : new Date());
}

type ReadRow = {
  row: ImportRow;
  record: AnyImportRecord | null;
  ref: string | null;
  issues: RowIssue[];
};

function readRows(
  batch: ImportBatch,
  rows: readonly ImportRow[],
  day: string,
): ReadRow[] {
  if (!batch.mapping) throw new RepoInputError("Match the columns first.");
  const mapping = batch.mapping;
  return rows.map((row) => {
    if (!row.cells)
      return {
        row,
        record: null,
        ref: null,
        issues: [issue("REQUIRED", "error", null)],
      };
    const read = readImportRow(batch.kind, row.cells, mapping, day);
    return { row, record: read.record, ref: read.ref, issues: read.issues };
  });
}

/** The clinic's data the rows of one page need (references, directory). */
async function lookupsFor(
  ctx: RepoContext,
  tenantId: string,
  kind: ImportKind,
  records: readonly AnyImportRecord[],
  ports: IntegrationPorts,
  day: string,
): Promise<ImportLookups> {
  const refs = records.map((r) => r.ref);
  const patientRefs =
    kind === "patients"
      ? []
      : records.map(
          (r) =>
            (
              r as
                CaseImportRecord | AppointmentImportRecord | InvoiceImportRecord
            ).patientRef,
        );
  const caseRefs =
    kind === "appointments" || kind === "invoices"
      ? records
          .map(
            (r) => (r as AppointmentImportRecord | InvoiceImportRecord).caseRef,
          )
          .filter((x): x is string => Boolean(x))
      : [];
  const existingRefs: Promise<Set<string>> =
    kind === "patients"
      ? patientIdsByImportRef(ctx, tenantId, refs).then(
          (m) => new Set(m.keys()),
        )
      : kind === "cases"
        ? caseIdsByImportRef(ctx, tenantId, refs).then((m) => new Set(m.keys()))
        : kind === "appointments"
          ? (ports.diary?.existingAppointmentRefs?.(ctx, tenantId, refs) ??
            Promise.resolve(new Set<string>()))
          : (ports.billing?.existingInvoiceRefs?.(ctx, tenantId, refs) ??
            Promise.resolve(new Set<string>()));
  const needsDirectory = kind !== "patients";
  const [
    existing,
    patientsByRef,
    casesByRef,
    practitioners,
    sites,
    rooms,
    services,
    referrers,
  ] = await Promise.all([
    existingRefs,
    patientRefs.length
      ? patientIdsByImportRef(ctx, tenantId, patientRefs)
      : Promise.resolve(new Map<string, string>()),
    caseRefs.length
      ? caseIdsByImportRef(ctx, tenantId, caseRefs)
      : Promise.resolve(new Map<string, { id: string; patientId: string }>()),
    needsDirectory
      ? listPractitioners(ctx, tenantId, { includeInactive: true })
      : Promise.resolve([]),
    needsDirectory
      ? listSites(ctx, tenantId, { includeInactive: true })
      : Promise.resolve([]),
    kind === "appointments"
      ? listRooms(ctx, tenantId, { includeInactive: true })
      : Promise.resolve([]),
    kind === "appointments"
      ? listServices(ctx, tenantId, { includeInactive: true })
      : Promise.resolve([]),
    kind === "cases" || kind === "invoices"
      ? referrerLookups(ctx, tenantId)
      : Promise.resolve([]),
  ]);
  return {
    today: day,
    existingRefs: existing,
    patientsByRef,
    casesByRef,
    practitioners: practitioners.map((p) => ({
      id: p.id,
      displayName: p.displayName,
      registrationNumber: p.registrationNumber,
      defaultSiteId: p.defaultSiteId,
      importRef: p.importRef,
    })),
    sites: sites.map((s) => ({
      id: s.id,
      name: s.name,
      code: s.code,
      importRef: s.importRef,
    })),
    rooms: rooms.map((r) => ({ id: r.id, siteId: r.siteId, name: r.name })),
    services: services.map((s) => ({
      id: s.id,
      name: s.name,
      code: s.code,
      durationMinutes: s.durationMinutes,
      importRef: s.importRef,
    })),
    referrers,
  };
}

function planOf(
  kind: ImportKind,
  record: AnyImportRecord,
): Parameters<typeof resolveImportRecord>[0] {
  return { kind, record } as Parameters<typeof resolveImportRecord>[0];
}

interface Evaluated {
  read: ReadRow;
  status: "ready" | "error" | "duplicate";
  issues: RowIssue[];
  plan: ImportPlan | null;
}

/** Reads and resolves a page of rows (the same for the check and the import – the import re-checks every row). */
async function evaluate(
  ctx: RepoContext,
  tenantId: string,
  batch: ImportBatch,
  rows: readonly ImportRow[],
  ports: IntegrationPorts,
  inFileEarlier: Set<string>,
): Promise<Evaluated[]> {
  const day = today(ctx);
  const reads = readRows(batch, rows, day);
  const records = reads
    .map((r) => r.record)
    .filter((r): r is AnyImportRecord => r !== null);
  const lookups = await lookupsFor(
    ctx,
    tenantId,
    batch.kind,
    records,
    ports,
    day,
  );
  const seen = new Set(inFileEarlier);
  return reads.map((read) => {
    if (!read.record)
      return { read, status: "error", issues: read.issues, plan: null };
    if (seen.has(read.record.ref))
      return {
        read,
        status: "duplicate",
        issues: [...read.issues, issue("DUPLICATE_IN_FILE", "warning", "ref")],
        plan: null,
      };
    const resolved = resolveImportRecord(
      planOf(batch.kind, read.record),
      lookups,
    );
    const issues = [...read.issues, ...resolved.issues];
    if (resolved.duplicate)
      return { read, status: "duplicate", issues, plan: null };
    if (!resolved.plan || hasError(issues))
      return { read, status: "error", issues, plan: null };
    const recordIssues =
      resolved.plan.kind === "patients"
        ? patientRecordIssues(resolved.plan, day)
        : resolved.plan.kind === "cases"
          ? caseRecordIssues(resolved.plan)
          : [];
    if (recordIssues.length)
      return {
        read,
        status: "error",
        issues: [...issues, ...recordIssues],
        plan: null,
      };
    seen.add(read.record.ref);
    return { read, status: "ready", issues, plan: resolved.plan };
  });
}

function planLinks(plan: ImportPlan | null): {
  patientId: string | null;
  caseId: string | null;
} {
  if (!plan || plan.kind === "patients")
    return { patientId: null, caseId: null };
  if (plan.kind === "cases") return { patientId: plan.patientId, caseId: null };
  return { patientId: plan.patientId, caseId: plan.caseId };
}

async function remainingRows(
  ctx: RepoContext,
  tenantId: string,
  batch: ImportBatch,
  status: "staged" | "ready" | "imported",
): Promise<number> {
  return (await countImportRows(ctx, tenantId, batch.id)).byStatus[status];
}

/** What a busy or finished batch answers when the step cannot be claimed. */
async function notClaimed(
  ctx: RepoContext,
  tenantId: string,
  batchId: string,
  doneStatus: BatchStatus,
): Promise<StepProgress> {
  const b = await getImportBatch(ctx, tenantId, batchId);
  if (!b)
    throw new RepoInputError("That import does not exist in this clinic.");
  if (b.status === doneStatus)
    return {
      status: b.status,
      done: true,
      processed: 0,
      remaining: 0,
      counts: b.counts,
    };
  if (b.leaseUntil)
    return {
      status: b.status,
      done: false,
      processed: 0,
      remaining: -1,
      busy: true,
    };
  throw new RepoInputError("This import is not at that step.");
}

/* ------------------------------------------------------------------------------------------------
 * CHECK (dry run)
 * ----------------------------------------------------------------------------------------------*/

export async function runCheckPage(
  ctx: RepoContext,
  tenantId: string,
  batchId: string,
  actor: PmsActor,
  ports: IntegrationPorts,
  pageSize: number = PAGE_SIZES.check,
): Promise<StepProgress> {
  const before = await getImportBatch(ctx, tenantId, batchId);
  if (!before)
    throw new RepoInputError("That import does not exist in this clinic.");
  if (before.status === "mapping") {
    const problems = before.mapping
      ? validateMapping(before.kind, before.mapping)
      : [{ field: null, message: "Match the columns first." }];
    if (problems.length) throw new RepoInputError(problems[0].message);
  }
  const batch = await claimImportStep(
    ctx,
    tenantId,
    batchId,
    ["mapping", "checking"],
    "checking",
  );
  if (!batch) return notClaimed(ctx, tenantId, batchId, "checked");
  try {
    const rows = await listImportRows(ctx, tenantId, batchId, {
      statuses: ["staged"],
      limit: pageSize,
    });
    if (rows.length === 0) {
      const counts = await computeBatchCounts(ctx, tenantId, batch);
      await finishImportStep(
        ctx,
        tenantId,
        batchId,
        {
          from: "checking",
          to: "checked",
          stamp: "checked",
          counts,
          action: "pms.import_batch.check",
        },
        actor,
      );
      return {
        status: "checked",
        done: true,
        processed: 0,
        remaining: 0,
        counts,
      };
    }
    const reads = readRows(batch, rows, today(ctx));
    const refs = reads.map((r) => r.ref).filter((x): x is string => Boolean(x));
    const earlier = await readyRefsBefore(
      ctx,
      tenantId,
      batchId,
      refs,
      rows[0].rowNo,
    );
    const evaluated = await evaluate(
      ctx,
      tenantId,
      batch,
      rows,
      ports,
      earlier,
    );
    await saveRowOutcomes(
      ctx,
      tenantId,
      batchId,
      evaluated.map((e): RowOutcome => ({
        id: e.read.row.id,
        status: e.status,
        issues: e.issues,
        sourceRef: e.read.ref,
        ...planLinks(e.plan),
      })),
    );
    const remaining = await remainingRows(ctx, tenantId, batch, "staged");
    return {
      status: "checking",
      done: false,
      processed: rows.length,
      remaining,
    };
  } finally {
    await releaseImportStep(ctx, tenantId, batchId);
  }
}

/* ------------------------------------------------------------------------------------------------
 * IMPORT (after the staff check)
 * ----------------------------------------------------------------------------------------------*/

/** Adds the payers and referrers a page needs to the directory, once per name and kind. */
async function ensureDirectory(
  ctx: RepoContext,
  tenantId: string,
  batch: ImportBatch,
  refs: readonly (DirectoryRef | null)[],
  actor: PmsActor,
  added: string[],
): Promise<Map<string, string>> {
  const wanted = new Map<
    string,
    { name: string; kind: Parameters<typeof createReferrer>[2]["kind"] }
  >();
  for (const r of refs)
    if (r && "add" in r)
      wanted.set(`${r.add.kind}|${r.add.name.toLowerCase()}`, r.add);
  const ids = new Map<string, string>();
  if (wanted.size === 0) return ids;
  // A name added by an earlier page of this import is already there now (re-read to find it).
  const existing = await referrerLookups(ctx, tenantId);
  for (const [key, add] of Array.from(wanted.entries())) {
    const found = existing.find(
      (e) =>
        e.kind === add.kind && e.name.toLowerCase() === add.name.toLowerCase(),
    );
    if (found) {
      ids.set(key, found.id);
      continue;
    }
    const created = await createReferrer(
      ctx,
      tenantId,
      { kind: add.kind, name: add.name.slice(0, 160), notes: null },
      actor,
    );
    ids.set(key, created.id);
    added.push(created.id);
  }
  await recordDirectoryAdded(ctx, tenantId, batch.id, added);
  return ids;
}

function directoryId(
  ref: DirectoryRef | null,
  ids: Map<string, string>,
): string | null {
  if (!ref) return null;
  if ("id" in ref) return ref.id;
  return ids.get(`${ref.add.kind}|${ref.add.name.toLowerCase()}`) ?? null;
}

async function importPatients(
  ctx: RepoContext,
  tenantId: string,
  batch: ImportBatch,
  ready: readonly Evaluated[],
  actor: PmsActor,
): Promise<RowOutcome[]> {
  const out: RowOutcome[] = [];
  for (let i = 0; i < ready.length; i += 40) {
    const chunk = ready.slice(i, i + 40);
    const plans = chunk.map((e) => e.plan as PatientPlan);
    const created = await bulkCreatePatients(
      ctx,
      tenantId,
      plans.map(patientInputOf),
      actor,
      { source: "import", batchId: batch.id },
    );
    for (let k = 0; k < chunk.length; k++) {
      const id = created.ids[k];
      let rev = 1;
      const status = plans[k].record.status;
      if (
        status !== "active" &&
        (await setPatientStatus(ctx, tenantId, id, status, actor))
      )
        rev = 2;
      out.push({
        id: chunk[k].read.row.id,
        status: "imported",
        issues: chunk[k].issues,
        sourceRef: chunk[k].read.ref,
        patientId: id,
        targetId: id,
        targetRev: rev,
        wipeData: true,
      });
    }
  }
  return out;
}

async function importCases(
  ctx: RepoContext,
  tenantId: string,
  batch: ImportBatch,
  ready: readonly Evaluated[],
  actor: PmsActor,
): Promise<RowOutcome[]> {
  const plans = ready.map((e) => e.plan as CasePlan);
  const added = batch.directoryAdded.slice();
  const ids = await ensureDirectory(
    ctx,
    tenantId,
    batch,
    plans.flatMap((p) => [p.payer, p.referrer]),
    actor,
    added,
  );
  const out: RowOutcome[] = [];
  for (let i = 0; i < ready.length; i += 40) {
    const chunk = ready.slice(i, i + 40);
    const chunkPlans = plans.slice(i, i + 40);
    const payers = chunkPlans.map((p) => directoryId(p.payer, ids));
    const inputs = chunkPlans.map((p, k) =>
      caseInputOf(p, {
        payerReferrerId: payers[k],
        referrerId: directoryId(p.referrer, ids),
      }),
    );
    const caseIds = await bulkCreateCases(ctx, tenantId, inputs, actor, {
      source: "import",
      batchId: batch.id,
    });
    const auths = chunkPlans
      .map((p, k) => ({
        k,
        input: authorisationInputOf(p, caseIds[k], payers[k]),
      }))
      .filter(
        (
          a,
        ): a is {
          k: number;
          input: NonNullable<ReturnType<typeof authorisationInputOf>>;
        } => a.input !== null,
      );
    const authIds = auths.length
      ? await bulkCreateAuthorisations(
          ctx,
          tenantId,
          auths.map((a) => a.input),
          actor,
          { source: "import", batchId: batch.id },
        )
      : [];
    const authOf = new Map(auths.map((a, n) => [a.k, authIds[n]]));
    chunk.forEach((e, k) => {
      const authId = authOf.get(k);
      out.push({
        id: e.read.row.id,
        status: "imported",
        issues: e.issues,
        sourceRef: e.read.ref,
        patientId: chunkPlans[k].patientId,
        caseId: caseIds[k],
        targetId: caseIds[k],
        targetRev: 1,
        extra: authId ? { authorisationId: authId } : null,
        wipeData: true,
      });
    });
  }
  return out;
}

async function importThroughPort(
  ctx: RepoContext,
  tenantId: string,
  batch: ImportBatch,
  ready: readonly Evaluated[],
  actor: PmsActor,
  ports: IntegrationPorts,
): Promise<RowOutcome[]> {
  let written: { ref: string; id: string; rev: number }[];
  if (batch.kind === "appointments") {
    const port = ports.diary;
    if (!port?.importAppointments)
      throw new RepoInputError(importTargetMissingMessage("appointments"));
    written = await port.importAppointments(
      ctx,
      tenantId,
      ready.map((e) => e.plan as AppointmentPlan),
      actor,
      { batchId: batch.id },
    );
  } else {
    const port = ports.billing;
    if (!port?.importInvoices)
      throw new RepoInputError(importTargetMissingMessage("invoices"));
    const plans = ready.map((e) => e.plan as InvoicePlan);
    const added = batch.directoryAdded.slice();
    const ids = await ensureDirectory(
      ctx,
      tenantId,
      batch,
      plans.map((p) => p.payer),
      actor,
      added,
    );
    const resolved: ResolvedInvoice[] = plans.map(({ payer, ...rest }) => ({
      ...rest,
      payerReferrerId: directoryId(payer, ids),
    }));
    written = await port.importInvoices(ctx, tenantId, resolved, actor, {
      batchId: batch.id,
    });
  }
  const byRef = new Map(written.map((w) => [w.ref, w]));
  return ready.map((e) => {
    const plan = e.plan as AppointmentPlan | InvoicePlan;
    const w = byRef.get(plan.record.ref);
    if (!w)
      return {
        id: e.read.row.id,
        status: "skipped",
        issues: [...e.issues, issue("NOT_WRITTEN", "error", null)],
        sourceRef: e.read.ref,
      };
    return {
      id: e.read.row.id,
      status: "imported",
      issues: e.issues,
      sourceRef: e.read.ref,
      patientId: plan.patientId,
      caseId: plan.caseId,
      targetId: w.id,
      targetRev: w.rev,
      wipeData: true,
    };
  });
}

/**
 * Rows this import already wrote in a call that ended before it could note them: the record (made after the staff
 * check, linked to no import row) is adopted as this row's, rather than skipped as "already in the clinic".
 * Patients and cases only – the diary and billing make their writes and notes themselves.
 */
async function adoptInterrupted(
  ctx: RepoContext,
  tenantId: string,
  batch: ImportBatch,
  duplicates: readonly Evaluated[],
): Promise<Map<string, RowOutcome>> {
  const out = new Map<string, RowOutcome>();
  if (
    (batch.kind !== "patients" && batch.kind !== "cases") ||
    !batch.approvedAt ||
    duplicates.length === 0
  )
    return out;
  const refs = duplicates
    .map((d) => d.read.record?.ref)
    .filter((x): x is string => Boolean(x));
  const byRef =
    batch.kind === "patients"
      ? new Map(
          Array.from(
            (await patientIdsByImportRef(ctx, tenantId, refs)).entries(),
          ).map(([ref, id]) => [ref, { id, patientId: id }]),
        )
      : await caseIdsByImportRef(ctx, tenantId, refs);
  const ids = Array.from(byRef.values()).map((v) => v.id);
  const fresh = await unlinkedRecordsSince(
    ctx,
    tenantId,
    batch.kind === "patients" ? "pms_patients" : "pms_cases",
    ids,
    batch.approvedAt,
  );
  for (const d of duplicates) {
    const found = d.read.record ? byRef.get(d.read.record.ref) : undefined;
    const rev = found ? fresh.get(found.id) : undefined;
    if (!found || rev === undefined) continue;
    out.set(d.read.row.id, {
      id: d.read.row.id,
      status: "imported",
      issues: d.read.issues,
      sourceRef: d.read.ref,
      patientId: found.patientId,
      caseId: batch.kind === "cases" ? found.id : null,
      targetId: found.id,
      targetRev: rev,
      wipeData: true,
    });
  }
  return out;
}

export async function runImportPage(
  ctx: RepoContext,
  tenantId: string,
  batchId: string,
  actor: PmsActor,
  ports: IntegrationPorts,
  pageSize: number = PAGE_SIZES.import,
): Promise<StepProgress> {
  const before = await getImportBatch(ctx, tenantId, batchId);
  if (!before)
    throw new RepoInputError("That import does not exist in this clinic.");
  if (
    (before.kind === "appointments" || before.kind === "invoices") &&
    !importTargetAvailable(before.kind, ports)
  )
    throw new RepoInputError(importTargetMissingMessage(before.kind));
  const batch = await claimImportStep(
    ctx,
    tenantId,
    batchId,
    ["approved", "importing"],
    "importing",
  );
  if (!batch) return notClaimed(ctx, tenantId, batchId, "imported");
  try {
    const rows = await listImportRows(ctx, tenantId, batchId, {
      statuses: ["ready"],
      limit: pageSize,
    });
    if (rows.length === 0) {
      const latest = (await getImportBatch(ctx, tenantId, batchId)) ?? batch;
      const counts = await computeBatchCounts(
        ctx,
        tenantId,
        batch,
        latest.directoryAdded.length,
      );
      await finishImportStep(
        ctx,
        tenantId,
        batchId,
        {
          from: "importing",
          to: "imported",
          stamp: "imported",
          counts,
          action: "pms.import_batch.commit",
        },
        actor,
      );
      return {
        status: "imported",
        done: true,
        processed: 0,
        remaining: 0,
        counts,
      };
    }
    // Every row is checked again: the clinic's records may have changed since the check (another import, a new patient).
    const evaluated = await evaluate(
      ctx,
      tenantId,
      batch,
      rows,
      ports,
      new Set(),
    );
    const ready = evaluated.filter((e) => e.status === "ready");
    const adopted = await adoptInterrupted(
      ctx,
      tenantId,
      batch,
      evaluated.filter((e) => e.status === "duplicate"),
    );
    const notNow: RowOutcome[] = evaluated
      .filter((e) => e.status !== "ready" && !adopted.has(e.read.row.id))
      .map((e) => ({
        id: e.read.row.id,
        status: "skipped",
        issues: e.issues,
        sourceRef: e.read.ref,
      }));
    let written: RowOutcome[] = [];
    if (ready.length) {
      written =
        batch.kind === "patients"
          ? await importPatients(ctx, tenantId, batch, ready, actor)
          : batch.kind === "cases"
            ? await importCases(ctx, tenantId, batch, ready, actor)
            : await importThroughPort(
                ctx,
                tenantId,
                batch,
                ready,
                actor,
                ports,
              );
    }
    await saveRowOutcomes(ctx, tenantId, batchId, [
      ...written,
      ...Array.from(adopted.values()),
      ...notNow,
    ]);
    const remaining = await remainingRows(ctx, tenantId, batch, "ready");
    return {
      status: "importing",
      done: false,
      processed: rows.length,
      remaining,
    };
  } finally {
    await releaseImportStep(ctx, tenantId, batchId);
  }
}

/* ------------------------------------------------------------------------------------------------
 * UNDO
 * ----------------------------------------------------------------------------------------------*/

/** Why a batch cannot be undone yet (null: it can). */
export async function undoBlocker(
  ctx: RepoContext,
  tenantId: string,
  batch: ImportBatch,
): Promise<string | null> {
  if (batch.status !== "imported" && batch.status !== "undoing")
    return "Only an import that has finished can be undone.";
  const n = await countDependentImportedRows(
    ctx,
    tenantId,
    batch.id,
    batch.kind,
  );
  if (n === 0) return null;
  const what =
    batch.kind === "patients"
      ? "cases, appointments or invoices imported for these patients"
      : "appointments or invoices imported for these cases";
  return `Undo the ${what} first (${n.toLocaleString("en-GB")} ${n === 1 ? "row" : "rows"} in later imports).`;
}

async function inUse(
  ctx: RepoContext,
  tenantId: string,
  kind: "patients" | "cases",
  ids: readonly string[],
  ports: IntegrationPorts,
): Promise<Set<string>> {
  const used = new Set<string>();
  const add = (s: Set<string> | undefined) => s?.forEach((x) => used.add(x));
  if (kind === "patients") {
    const cases = await casesOfPatients(ctx, tenantId, ids);
    const undone = await undoneImportedCaseIds(
      ctx,
      tenantId,
      cases.map((c) => c.id),
    );
    for (const c of cases) if (!undone.has(c.id)) used.add(c.patientId);
    add(await ports.records?.patientsWithRecords?.(ctx, tenantId, ids));
    add(await ports.diary?.patientsWithAppointments?.(ctx, tenantId, ids));
    add(await ports.billing?.patientsWithInvoices?.(ctx, tenantId, ids));
  } else {
    add(await ports.records?.casesWithRecords?.(ctx, tenantId, ids));
    add(await ports.diary?.casesWithAppointments?.(ctx, tenantId, ids));
    add(await ports.billing?.casesWithInvoices?.(ctx, tenantId, ids));
  }
  return used;
}

async function undoPatients(
  ctx: RepoContext,
  tenantId: string,
  rows: readonly ImportRow[],
  actor: PmsActor,
  ports: IntegrationPorts,
): Promise<RowOutcome[]> {
  const ids = rows
    .map((r) => r.targetId)
    .filter((x): x is string => Boolean(x));
  const used = await inUse(ctx, tenantId, "patients", ids, ports);
  const out: RowOutcome[] = [];
  for (const row of rows) {
    const id = row.targetId;
    if (!id || used.has(id)) {
      out.push({ id: row.id, status: "kept" });
      continue;
    }
    // Unchanged since the import (same revision): its import reference is released, then it is archived.
    const released = await updatePatient(
      ctx,
      tenantId,
      id,
      row.targetRev ?? 1,
      { importRef: null },
      actor,
    );
    if (!released.ok) {
      out.push({ id: row.id, status: "kept" });
      continue;
    }
    await setPatientStatus(ctx, tenantId, id, "archived", actor);
    out.push({ id: row.id, status: "undone" });
  }
  return out;
}

async function undoCases(
  ctx: RepoContext,
  tenantId: string,
  rows: readonly ImportRow[],
  actor: PmsActor,
  ports: IntegrationPorts,
): Promise<RowOutcome[]> {
  const ids = rows
    .map((r) => r.targetId)
    .filter((x): x is string => Boolean(x));
  const used = await inUse(ctx, tenantId, "cases", ids, ports);
  const out: RowOutcome[] = [];
  for (const row of rows) {
    const id = row.targetId;
    if (!id || used.has(id)) {
      out.push({ id: row.id, status: "kept" });
      continue;
    }
    const closed = await updateCase(
      ctx,
      tenantId,
      id,
      row.targetRev ?? 1,
      { status: "closed", importRef: null },
      actor,
    );
    if (!closed.ok) {
      out.push({ id: row.id, status: "kept" });
      continue;
    }
    const authId = row.extra?.authorisationId;
    if (authId)
      await updateAuthorisation(
        ctx,
        tenantId,
        authId,
        1,
        { status: "cancelled", importRef: null },
        actor,
      );
    out.push({ id: row.id, status: "undone" });
  }
  return out;
}

async function undoThroughPort(
  ctx: RepoContext,
  tenantId: string,
  batch: ImportBatch,
  rows: readonly ImportRow[],
  actor: PmsActor,
  ports: IntegrationPorts,
): Promise<RowOutcome[]> {
  const items = rows
    .filter((r) => r.targetId)
    .map((r) => ({ id: r.targetId as string, rev: r.targetRev ?? 1 }));
  const undo =
    batch.kind === "appointments"
      ? ports.diary?.undoImportedAppointments
      : ports.billing?.undoImportedInvoices;
  if (!undo)
    throw new RepoInputError(
      importTargetMissingMessage(
        batch.kind === "appointments" ? "appointments" : "invoices",
      ),
    );
  const result = await undo(ctx, tenantId, items, actor);
  const undone = new Set(result.undone);
  return rows.map((r) => ({
    id: r.id,
    status: r.targetId && undone.has(r.targetId) ? "undone" : "kept",
  }));
}

/** Makes the payers and referrers the import added inactive – unless someone changed them since. */
async function retireDirectoryAdded(
  ctx: RepoContext,
  tenantId: string,
  batch: ImportBatch,
  actor: PmsActor,
): Promise<void> {
  for (const id of batch.directoryAdded) {
    const r = await getReferrer(ctx, tenantId, id);
    if (r && r.active && r.rev === 1)
      await updateReferrer(ctx, tenantId, id, 1, { active: false }, actor);
  }
}

export async function runUndoPage(
  ctx: RepoContext,
  tenantId: string,
  batchId: string,
  actor: PmsActor,
  ports: IntegrationPorts,
  pageSize: number = PAGE_SIZES.undo,
): Promise<StepProgress> {
  const before = await getImportBatch(ctx, tenantId, batchId);
  if (!before)
    throw new RepoInputError("That import does not exist in this clinic.");
  const blocker = await undoBlocker(ctx, tenantId, before);
  if (blocker) {
    if (before.status === "undone")
      return {
        status: "undone",
        done: true,
        processed: 0,
        remaining: 0,
        counts: before.counts,
      };
    throw new RepoInputError(blocker);
  }
  const batch = await claimImportStep(
    ctx,
    tenantId,
    batchId,
    ["imported", "undoing"],
    "undoing",
  );
  if (!batch) return notClaimed(ctx, tenantId, batchId, "undone");
  try {
    const rows = await listImportRows(ctx, tenantId, batchId, {
      statuses: ["imported"],
      limit: pageSize,
    });
    if (rows.length === 0) {
      await retireDirectoryAdded(ctx, tenantId, batch, actor);
      const counts = await computeBatchCounts(
        ctx,
        tenantId,
        batch,
        batch.directoryAdded.length,
      );
      await finishImportStep(
        ctx,
        tenantId,
        batchId,
        {
          from: "undoing",
          to: "undone",
          stamp: "undone",
          counts,
          action: "pms.import_batch.undo",
        },
        actor,
      );
      return {
        status: "undone",
        done: true,
        processed: 0,
        remaining: 0,
        counts,
      };
    }
    const outcomes =
      batch.kind === "patients"
        ? await undoPatients(ctx, tenantId, rows, actor, ports)
        : batch.kind === "cases"
          ? await undoCases(ctx, tenantId, rows, actor, ports)
          : await undoThroughPort(ctx, tenantId, batch, rows, actor, ports);
    await saveRowOutcomes(ctx, tenantId, batchId, outcomes);
    const remaining = await remainingRows(ctx, tenantId, batch, "imported");
    return {
      status: "undoing",
      done: false,
      processed: rows.length,
      remaining,
    };
  } finally {
    await releaseImportStep(ctx, tenantId, batchId);
  }
}

/** The label of a kind's records in sentences ("patients"). */
export function nounOf(kind: ImportKind): string {
  return IMPORT_KIND_INFO[kind].noun;
}
