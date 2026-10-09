/** GET /api/reports/v1/templates/[id] – thin route; logic lives in src/modules/medreport/api/handlers/template-get.ts. */
import { route } from "@/app/api/_medreport-glue";
import { handleTemplateGet } from "@/modules/medreport/api/handlers/template-get";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(handleTemplateGet);
