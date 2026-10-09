/** POST /api/reports/v1/templates/validate – thin route; logic lives in src/modules/medreport/api/handlers/templates-validate.ts. */
import { route } from "@/app/api/_medreport-glue";
import { handleTemplatesValidate } from "@/modules/medreport/api/handlers/templates-validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(handleTemplatesValidate);
