/** GET /api/reports/v1/templates – thin route; logic lives in src/modules/medreport/api/handlers/templates-list.ts. */
import { route } from "@/app/api/_medreport-glue";
import { handleTemplatesList } from "@/modules/medreport/api/handlers/templates-list";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(handleTemplatesList);
