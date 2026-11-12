/** Public clinic API v1 (docs/clinic-system/api.md). Thin wrapper: src/server/pms/integration/api/*. Off = 404. */
import { notFoundRoute } from "@/server/pms/integration/api/http";

export const dynamic = "force-dynamic";
// Any other path under /api/clinic/v1: the API's own 404 body (switch on or off).
const r = notFoundRoute();
export const GET = r.GET;
export const POST = r.POST;
export const PUT = r.PUT;
export const PATCH = r.PATCH;
export const DELETE = r.DELETE;
export const OPTIONS = r.OPTIONS;
