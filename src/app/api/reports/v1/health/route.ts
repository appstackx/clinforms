/** GET /api/reports/v1/health – thin route; logic lives in src/modules/medreport/api/handlers/health.ts. */
import { route } from "@/app/api/_medreport-glue";
import { handleHealth } from "@/modules/medreport/api/handlers/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(handleHealth);
