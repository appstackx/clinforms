/** Public clinic API v1 (docs/clinic-system/api.md). Thin wrapper: src/server/pms/integration/api/*. Off = 404. */
import { CLINIC_SYSTEM_NAME } from "@/lib/brand";
import { clinicApiOpenApi } from "@/modules/pms/integration/api-openapi";
import { publicApiRoute } from "@/server/pms/integration/api/http";

export const dynamic = "force-dynamic";
const r = publicApiRoute({
  scope: null,
  // No key needed: the document holds no clinic data. Same switch, HTTPS rule and per-network limit as the API.
  handle: async ({ url }) => ({ body: clinicApiOpenApi({ title: CLINIC_SYSTEM_NAME, serverUrl: `${url.origin}/api/clinic/v1` }) }),
});
export const GET = r.GET;
export const POST = r.POST;
export const PUT = r.PUT;
export const PATCH = r.PATCH;
export const DELETE = r.DELETE;
export const OPTIONS = r.OPTIONS;
