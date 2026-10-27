/**
 * Estimated cost of live drafting calls (25/10/2026) – for ClinForms staff only (the platform usage page); never shown
 * to a clinic. List prices per million tokens in US dollars, as published for each model the app may use
 * (src/modules/medreport/config.server.ts AI_MODEL_ALLOW_LIST, plus the models a server-side fallback may serve):
 * input, output and cache read; a cache write (5-minute) is 1.25 × the input price.
 *
 * Cost is stored in micro US dollars: tokens × (dollars per million tokens) = micro-dollars, so the arithmetic stays
 * in integers. A model that is not listed is priced at the most expensive listed one (an estimate that errs high).
 *
 * The pound figure on the platform page uses CLINFORMS_USD_GBP_RATE (default 0.79 – check it now and then), or the
 * page's own rate field.
 */
import type { TokenUsage } from "../../modules/medreport/core/types";

export interface ModelPrice {
  /** US dollars per million input tokens. */
  input: number;
  output: number;
  cacheRead: number;
  /** Multiplier on the input price for cache writes (5-minute cache). */
  cacheWriteMultiplier: number;
}

/** Checked 25/10/2026 against the published list prices. */
export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWriteMultiplier: 1.25 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWriteMultiplier: 1.25 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWriteMultiplier: 1.25 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWriteMultiplier: 1.25 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5, cacheWriteMultiplier: 1.25 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWriteMultiplier: 1.25 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, cacheWriteMultiplier: 1.25 },
};

/** The price for a model that is not listed: the most expensive listed one. */
export const UNLISTED_MODEL_PRICE: ModelPrice = { input: 5, output: 25, cacheRead: 0.5, cacheWriteMultiplier: 1.25 };

export function modelPrice(model: string | null | undefined): { price: ModelPrice; listed: boolean } {
  const key = String(model ?? "")
    .trim()
    .toLowerCase();
  const listed = MODEL_PRICES[key];
  return listed ? { price: listed, listed: true } : { price: UNLISTED_MODEL_PRICE, listed: false };
}

const nonNegInt = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

/** Token counts of one call, cleaned (missing or invalid values = 0). */
export function cleanUsage(usage: Partial<TokenUsage> | null | undefined): { input: number; output: number; cacheRead: number; cacheWrite: number } {
  return {
    input: nonNegInt(usage?.inputTokens),
    output: nonNegInt(usage?.outputTokens),
    cacheRead: nonNegInt(usage?.cacheReadInputTokens),
    cacheWrite: nonNegInt(usage?.cacheCreationInputTokens),
  };
}

/** Estimated cost of one call in micro US dollars (rounded to a whole micro-dollar). */
export function estimateCostMicroUsd(model: string | null | undefined, usage: Partial<TokenUsage> | null | undefined): number {
  const { price } = modelPrice(model);
  const t = cleanUsage(usage);
  const micro = t.input * price.input + t.output * price.output + t.cacheRead * price.cacheRead + t.cacheWrite * price.input * price.cacheWriteMultiplier;
  return Math.round(micro);
}

export const DEFAULT_USD_GBP_RATE = 0.79;

/** A usable USD → GBP rate (0.2–5), or null. */
export function parseUsdGbpRate(raw: string | null | undefined): number | null {
  const n = Number(String(raw ?? "").trim());
  return Number.isFinite(n) && n >= 0.2 && n <= 5 ? n : null;
}

/** CLINFORMS_USD_GBP_RATE, else the default. */
export function usdGbpRate(env: Record<string, string | undefined> = process.env): number {
  return parseUsdGbpRate(env.CLINFORMS_USD_GBP_RATE) ?? DEFAULT_USD_GBP_RATE;
}

/** micro US dollars → pence at `rate` (rounded). */
export function microUsdToPence(microUsd: number, rate: number): number {
  return Math.round((microUsd / 1_000_000) * rate * 100);
}
