/** POST /api/reports/v1/forms/analyse – thin route; logic lives in src/modules/medreport/api/handlers/forms-analyse.ts. */
import { route } from "@/app/api/_medreport-glue";
import { handleFormsAnalyse } from "@/modules/medreport/api/handlers/forms-analyse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = route(handleFormsAnalyse);
