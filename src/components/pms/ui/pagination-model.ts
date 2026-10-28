/** Page numbers for the pagination bar (design: "1 2 3 … 13"). Pure. */

export type PageItem = number | "gap";

/** First, last and a window of three around the current page; "gap" where pages are left out. */
export function pageItems(current: number, totalPages: number): PageItem[] {
  const total = Math.max(1, Math.floor(totalPages));
  const page = Math.min(Math.max(1, Math.floor(current)), total);
  if (total <= 5) return Array.from({ length: total }, (_, i) => i + 1);
  let start = page - 1;
  let end = page + 1;
  if (start < 1) {
    start = 1;
    end = 3;
  }
  if (end > total) {
    end = total;
    start = total - 2;
  }
  const out: PageItem[] = [];
  const push = (n: number) => {
    const last = out[out.length - 1];
    if (typeof last === "number" && n - last === 2) out.push(last + 1);
    else if (typeof last === "number" && n - last > 2) out.push("gap");
    out.push(n);
  };
  push(1);
  for (let n = Math.max(2, start); n <= Math.min(total - 1, end); n++) push(n);
  push(total);
  return out;
}

export function totalPagesOf(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, pageSize)));
}

/** "Showing 1–25 of 312" (en dash, en-GB thousands). */
export function showingText(page: number, pageSize: number, total: number): string {
  if (total <= 0) return "Nothing to show";
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const f = (n: number) => n.toLocaleString("en-GB");
  return `Showing ${f(from)}–${f(to)} of ${f(total)}`;
}
