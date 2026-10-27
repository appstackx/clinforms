/** POST /api/reports/v1/store/reports/[id]/reuse – thin route (clinic storage); logic lives in src/modules/medreport/api/handlers/store-report-reuse.ts. */
import { route } from "@/app/api/_medreport-glue";
import { handleStoreReportReuse } from "@/modules/medreport/api/handlers/store-report-reuse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(handleStoreReportReuse);
