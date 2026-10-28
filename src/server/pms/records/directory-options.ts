/** The clinic directory as form choices (practitioners, sites, price lists, referrers and payer accounts). */
import "server-only";
import { REFERRER_KIND_LABELS } from "../../../modules/pms/records/copy";
import type { ClinicActor } from "../actor";
import { listPractitioners, listSites } from "../../repos/pms/directory";
import { listPriceLists } from "../../repos/pms/price-lists";
import { listReferrers } from "../../repos/pms/referrers";

export interface Choice {
  value: string;
  label: string;
}

export async function directoryOptions(actor: ClinicActor) {
  const ctx = actor.repo();
  const [practitioners, sites, priceLists, referrers] = await Promise.all([
    listPractitioners(ctx, actor.tenantId, { includeInactive: true }),
    listSites(ctx, actor.tenantId, { includeInactive: true }),
    listPriceLists(ctx, actor.tenantId, { includeInactive: true }),
    listReferrers(ctx, actor.tenantId, { includeInactive: true, limit: 500 }),
  ]);
  return {
    practitioners: practitioners.filter((p) => p.active).map((p) => ({ value: p.id, label: p.registrationNumber ? `${p.displayName} (${p.registrationNumber})` : p.displayName })),
    sites: sites.filter((s) => s.active).map((s) => ({ value: s.id, label: s.name })),
    priceLists: priceLists.filter((l) => l.active).map((l) => ({ value: l.id, label: l.name })),
    referrers: referrers.filter((r) => r.active).map((r) => ({ value: r.id, label: `${r.name} – ${REFERRER_KIND_LABELS[r.kind]}`, kind: r.kind as string })),
    names: {
      practitioners: Object.fromEntries(practitioners.map((p) => [p.id, p.displayName])) as Record<string, string>,
      sites: Object.fromEntries(sites.map((s) => [s.id, s.name])) as Record<string, string>,
      referrers: Object.fromEntries(referrers.map((r) => [r.id, r.name])) as Record<string, string>,
      priceLists: Object.fromEntries(priceLists.map((l) => [l.id, l.name])) as Record<string, string>,
    },
  };
}
