/**
 * Release rule (bh2 WA1 design 7): no forms-engine change is deployed while approved trial reports exist without first
 * running this check. For every approved report of a clinic it reads the report, its form map and the referrer's file
 * from the clinic's encrypted store, issues the FINAL document again exactly as /render FINAL does (the issue state's
 * answers, the receipt's signer and time – api/handlers/sign/receipt.ts issuedDocument) and compares:
 *   OK         the document and the acknowledgements still hash to what the receipt records
 *   CHANGED    a FINAL copy would now be refused (409 ISSUED_COPY_CHANGED) – do not deploy; investigate first
 *   UNBOUND    a receipt from before the release (no issued-document hash): it renders on the earlier path
 *   MAP_CHANGED  the clinic's stored form map is not the one approved (receipt.formMapSha256): /render refuses that map
 *              for this receipt anyway, so there is nothing to compare – the approved map is no longer in the store
 *   NO_FILE    the referrer's file is not in the clinic's store (nothing to compare)
 *   ERROR      the report could not be checked (the error's name only)
 * READ-ONLY: nothing is written, nothing is decrypted to disk. Prints report ids, form ids and outcomes only – never
 * patient data, wording or keys. Exit code 1 when any report is CHANGED or ERROR.
 *
 *   node --disable-warning=ExperimentalWarning --import ./scripts/medreport/test-setup.mjs --import tsx \
 *     scripts/admin/check-issued.ts --slug <clinic id> [--env preview|production]
 *
 * --env production reads production with the PRODUCTION_* settings of the secrets file – Khuram's go only (it reads
 * a clinic's encrypted reports, even though it changes nothing).
 * Owner: WA1 (issue state and receipt) – docs/bh2-ownership.json.
 */
import { formToTemplate } from "../../src/modules/medreport/core/forms";
import { StoredFormDefinitionSchema, StoredReportSchema } from "../../src/modules/medreport/core/stored-schemas";
import type { FormDefinition, Report } from "../../src/modules/medreport/core/types";
import { validateReport } from "../../src/modules/medreport/core/validation";
import { acknowledgementsSha256, bindsIssuedDocument, issuedContentSha256, issuedDocument } from "../../src/modules/medreport/api/handlers/sign/receipt";
import { formMapMatches } from "../../src/modules/medreport/auth/attestations";
import type { TenantStore } from "../../src/modules/medreport/api/store-port";
import { decodeFormFile } from "../../src/modules/medreport/forms/file";
import { applyTarget, parseArgs, resolveTarget, runCli, str } from "./cli";

export type CheckIssuedOutcome = "OK" | "CHANGED" | "UNBOUND" | "MAP_CHANGED" | "NO_FILE" | "ERROR";

export interface CheckIssuedRow {
  reportId: string;
  formId: string | null;
  outcome: CheckIssuedOutcome;
  /** CHANGED: what differs ("document", "acknowledgements"); ERROR: the error's name. */
  detail?: string;
}

/** Re-issue one approved report and compare it with its receipt. */
export async function checkIssuedReport(store: TenantStore, tenantId: string, report: Report): Promise<CheckIssuedRow> {
  const receipt = report.receipt;
  const row = { reportId: report.id, formId: report.form?.formId ?? null };
  if (!receipt || (!receipt.issuedContentSha256 && !receipt.acknowledgementsSha256)) return { ...row, outcome: "UNBOUND" };
  let form: FormDefinition | null = null;
  if (report.form) {
    const stored = await store.getForm(tenantId, report.form.formId);
    const parsed = stored ? StoredFormDefinitionSchema.safeParse(stored.payload) : null;
    if (!parsed?.success) return { ...row, outcome: "ERROR", detail: "form map not readable" };
    form = parsed.data;
    // Only the map that was approved is ever issued with this receipt (/render FINAL checks the same hash).
    if (receipt.formMapSha256 && !formMapMatches(form, receipt.formMapSha256)) return { ...row, outcome: "MAP_CHANGED" };
  }
  const template = form ? formToTemplate(form) : null;
  const changed: string[] = [];
  if (receipt.acknowledgementsSha256 && template) {
    const { flags } = validateReport(report, template, { form });
    if (acknowledgementsSha256(flags, report.gaps ?? []) !== receipt.acknowledgementsSha256) changed.push("acknowledgements");
  }
  if (receipt.issuedContentSha256 && form && bindsIssuedDocument(form) && report.form) {
    const file = await store.getFile(tenantId, report.form.fileSha256);
    if (!file) return { ...row, outcome: changed.length ? "CHANGED" : "NO_FILE", ...(changed.length ? { detail: changed.join(", ") } : {}) };
    const decoded = decodeFormFile(Buffer.from(file.bytes).toString("base64"));
    const issued = await issuedDocument({ report, form, file: decoded, approval: receipt });
    if (issuedContentSha256(issued.bytes) !== receipt.issuedContentSha256) changed.push("document");
  }
  return changed.length ? { ...row, outcome: "CHANGED", detail: changed.join(", ") } : { ...row, outcome: "OK" };
}

/** Every approved report of the clinic, re-issued and compared (read-only). */
export async function checkIssuedReports(store: TenantStore, tenantId: string): Promise<CheckIssuedRow[]> {
  const out: CheckIssuedRow[] = [];
  for (const meta of await store.listReports(tenantId)) {
    if (meta.status !== "signed") continue;
    try {
      const stored = await store.getReport(tenantId, meta.id);
      const parsed = stored ? StoredReportSchema.safeParse(stored.payload) : null;
      if (!parsed?.success) {
        out.push({ reportId: meta.id, formId: meta.formId ?? null, outcome: "ERROR", detail: "report not readable" });
        continue;
      }
      out.push(await checkIssuedReport(store, tenantId, parsed.data));
    } catch (err) {
      out.push({ reportId: meta.id, formId: meta.formId ?? null, outcome: "ERROR", detail: err instanceof Error ? err.name : typeof err });
    }
  }
  return out;
}

if (process.argv[1] && /check-issued\.ts$/.test(process.argv[1])) {
  void runCli(async () => {
    const args = parseArgs(process.argv.slice(2));
    const target = resolveTarget(args);
    applyTarget(target);
    const tenantId = (str(args, "slug", true) as string).trim();
    // Server modules load only now, with the target's settings in place.
    const { getDb } = await import("../../src/server/db");
    const { getDataCipher } = await import("../../src/server/crypto");
    const { createTenantStore } = await import("../../src/server/store/tenant-store");
    const store = createTenantStore(() => ({ db: getDb(), cipher: getDataCipher() }));
    const rows = await checkIssuedReports(store, tenantId);
    if (rows.length === 0) {
      console.log("No approved reports.");
      return;
    }
    for (const r of rows) console.log([r.outcome.padEnd(8), r.reportId.padEnd(36), (r.formId ?? "-").padEnd(36), r.detail ?? ""].join("  ").trimEnd());
    const bad = rows.filter((r) => r.outcome === "CHANGED" || r.outcome === "ERROR");
    const count = (o: CheckIssuedOutcome) => rows.filter((r) => r.outcome === o).length;
    console.log(
      `\n${rows.length} approved report(s): ${count("OK")} OK, ${bad.length} CHANGED or ERROR, ${count("UNBOUND")} UNBOUND, ${count("MAP_CHANGED")} MAP_CHANGED, ${count("NO_FILE")} NO_FILE.`,
    );
    if (bad.length > 0) process.exitCode = 1;
  });
}
