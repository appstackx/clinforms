/** GET /api/reports/v1/templates/[id]/docx – thin route; logic lives in src/modules/medreport/api/handlers/template-docx.ts. */
import { route } from "@/app/api/_medreport-glue";
import { handleTemplateDocx } from "@/modules/medreport/api/handlers/template-docx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(handleTemplateDocx);
