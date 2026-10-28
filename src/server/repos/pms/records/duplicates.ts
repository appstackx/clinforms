/**
 * Possible duplicates of a patient being registered or edited (rules: src/modules/pms/records/duplicates.ts). Reads
 * the shared record's plain, indexed columns only (never decrypts); returns summaries with the reasons. Any status
 * is searched (an archived patient who comes back should be re-activated, not registered twice).
 */
import { duplicateKeys, duplicateReasons, type DuplicateProbe, type DuplicateReason } from "../../../../modules/pms/records/duplicates";
import type { PatientSummary } from "../../../../modules/pms/core/types";
import { getPatientSummaries } from "../patients";
import { assertTenantId, type RepoContext } from "../context";

export interface PossibleDuplicate {
  patient: PatientSummary;
  reasons: DuplicateReason[];
}

export async function findPossibleDuplicates(ctx: RepoContext, tenantId: string, probe: DuplicateProbe, options: { excludeId?: string; limit?: number } = {}): Promise<PossibleDuplicate[]> {
  assertTenantId(tenantId);
  const keys = duplicateKeys(probe);
  if (!keys.dateOfBirth && !keys.email && keys.phones.length === 0) return [];
  const limit = Math.min(Math.max(1, Math.floor(options.limit ?? 10)), 25);
  let q = ctx.db
    .selectFrom("pms_patients")
    .select(["id", "search_name", "date_of_birth", "email", "search_phone"])
    .where("tenant_id", "=", tenantId)
    .where((eb) => {
      const any = [];
      if (keys.dateOfBirth) any.push(eb("date_of_birth", "=", keys.dateOfBirth));
      if (keys.email) any.push(eb("email", "=", keys.email));
      for (const p of keys.phones) any.push(eb("search_phone", "like", `%${p}%`));
      return eb.or(any);
    });
  if (options.excludeId) q = q.where("id", "!=", options.excludeId);
  const rows = await q.orderBy("id").limit(200).execute();
  const matches = rows
    .map((r) => ({ id: r.id, reasons: duplicateReasons(probe, { searchName: r.search_name ?? "", dateOfBirth: r.date_of_birth, email: r.email, searchPhone: r.search_phone ?? "" }) }))
    .filter((m) => m.reasons.length > 0)
    .slice(0, limit);
  if (matches.length === 0) return [];
  const summaries = await getPatientSummaries(ctx, tenantId, matches.map((m) => m.id));
  return matches.flatMap((m) => {
    const patient = summaries.get(m.id);
    return patient ? [{ patient, reasons: m.reasons }] : [];
  });
}
