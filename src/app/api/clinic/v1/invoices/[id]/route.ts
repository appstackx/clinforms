/** Public clinic API v1 (docs/clinic-system/api.md). Thin wrapper: src/server/pms/integration/api/*. Off = 404. */
import { clinicApiRoute } from "@/server/pms/integration/api/http";
import { getInvoiceById } from "@/server/pms/integration/api/endpoints";

export const dynamic = "force-dynamic";
const r = clinicApiRoute<{ id: string }>({ GET: getInvoiceById });
export const GET = r.GET;
export const POST = r.POST;
export const PUT = r.PUT;
export const PATCH = r.PATCH;
export const DELETE = r.DELETE;
export const OPTIONS = r.OPTIONS;
