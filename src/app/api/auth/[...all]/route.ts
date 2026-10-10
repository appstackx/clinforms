/**
 * Better Auth's HTTP API (docs/auth.md). The ClinForms pages use server actions; this endpoint serves the
 * same flows for API clients, with Better Auth's database-backed rate limits and origin checks. Endpoints
 * ClinForms does not offer are switched off (DISABLED_PATHS in src/server/auth/create-auth.ts).
 */
import { getAuth } from "@/server/auth/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(req: Request): Promise<Response> {
  return getAuth().handler(req);
}

export { handle as GET, handle as POST };
