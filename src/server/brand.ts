/** The brand of the current request (by its Host header) – server components only. Config: src/lib/brand.ts. */
import "server-only";
import { headers } from "next/headers";
import { brandForHost, type Brand } from "../lib/brand";

export function currentBrand(): Brand {
  try {
    const h = headers();
    return brandForHost(h.get("host"));
  } catch {
    return brandForHost(null);
  }
}
