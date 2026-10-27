/**
 * The platform usage page's query (?month=YYYY-MM&rate=0.79), shared by the page and its CSV download.
 */
import { isPeriod, ukPeriodOf } from "@/server/repos/usage-period";
import { parseUsdGbpRate, usdGbpRate } from "@/server/usage/pricing";

export interface UsageQuery {
  period: string;
  rate: number;
  /** The rate came from the query (else CLINFORMS_USD_GBP_RATE or the default). */
  rateOverridden: boolean;
}

export function usageQuery(params: URLSearchParams | Record<string, string | string[] | undefined>, now = new Date()): UsageQuery {
  const get = (k: string) => {
    if (params instanceof URLSearchParams) return params.get(k) ?? undefined;
    const v = params[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const month = get("month");
  const rate = parseUsdGbpRate(get("rate"));
  return { period: isPeriod(month) ? month : ukPeriodOf(now), rate: rate ?? usdGbpRate(), rateOverridden: rate !== null };
}
