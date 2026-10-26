/**
 * Reading the set-up screens' forms (pure, browser-safe): FormData values to the shapes the repositories'
 * schemas accept, and the result every set-up action returns. Validation itself is the schemas' job; these only
 * convert (an unreadable number stays a string so the schema reports it next to the field).
 */

export type FormResult = { ok: true; message?: string; id?: string } | { ok: false; error: string; fieldErrors?: Record<string, string> };

export type FormSource = Pick<FormData, "get" | "getAll">;

/** Text as typed (trimmed); missing = undefined, "" stays "" (the schemas treat "" as "clear it"). */
export function text(form: FormSource, name: string): string | undefined {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : undefined;
}

/** Text or null when empty (for nullable ids such as "no site"). */
export function textOrNull(form: FormSource, name: string): string | null | undefined {
  const v = text(form, name);
  return v === undefined ? undefined : v === "" ? null : v;
}

/** A checkbox: present = true. `hidden` fields named "<name>__present" let a form say "this box was shown". */
export function checkbox(form: FormSource, name: string): boolean {
  const v = form.get(name);
  return v === "on" || v === "true" || v === "1";
}

/** A whole number, or the raw text when it is not one (so validation explains it), or undefined when empty. */
export function integer(form: FormSource, name: string): number | string | undefined {
  const v = text(form, name);
  if (v === undefined || v === "") return undefined;
  return /^-?\d+$/.test(v) ? Number(v) : v;
}

/**
 * Pounds as typed ("65", "65.5", "£1,250.00") → whole pence. "" → null (no price). Anything else → NaN, which the
 * money schemas refuse.
 */
export function poundsToPence(value: string | undefined | null): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const v = value.trim().replace(/^£/, "").replace(/,/g, "");
  if (v === "") return null;
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(v)) return Number.NaN;
  const [pounds, pence = ""] = v.split(".");
  return Number(pounds) * 100 + Number(pence.padEnd(2, "0"));
}

/** Whole pence → "65.00" for a form field ("" for none). */
export function penceToInput(pence: number | null | undefined): string {
  if (typeof pence !== "number" || !Number.isFinite(pence)) return "";
  return (Math.round(pence) / 100).toFixed(2);
}

/** A textarea of address lines → the lines (blank lines dropped); "" → null. */
export function lines(form: FormSource, name: string): string[] | null | undefined {
  const v = form.get(name);
  if (typeof v !== "string") return undefined;
  const out = v
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return out.length ? out : null;
}

/** Every value of a repeated field (checkbox lists). */
export function all(form: FormSource, name: string): string[] {
  return form
    .getAll(name)
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter(Boolean);
}

/** The first message for a field from a result, for showing next to it. */
export function fieldError(result: FormResult | null | undefined, name: string): string | undefined {
  return result && !result.ok ? result.fieldErrors?.[name] : undefined;
}
