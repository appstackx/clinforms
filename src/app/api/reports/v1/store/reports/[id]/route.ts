/** GET PUT DELETE /api/reports/v1/store/reports/[id] – thin route (clinic storage); logic lives in src/modules/medreport/api/handlers/store-reports.ts. */
import { route } from "@/app/api/_medreport-glue";
import { handleStoreReportGet, handleStoreReportPut, handleStoreReportDelete } from "@/modules/medreport/api/handlers/store-reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(handleStoreReportGet);
export const PUT = route(handleStoreReportPut);
export const DELETE = route(handleStoreReportDelete);
