/** POST /api/reports/v1/validate – thin route; logic lives in src/modules/medreport/api/handlers/validate.ts. */
import { route } from "@/app/api/_medreport-glue";
import { handleValidate } from "@/modules/medreport/api/handlers/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(handleValidate);
