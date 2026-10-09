/** POST /api/reports/v1/render – thin route; logic lives in src/modules/medreport/api/handlers/render.ts. */
import { route } from "@/app/api/_medreport-glue";
import { handleRender } from "@/modules/medreport/api/handlers/render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Form reports may convert Word → PDF with LibreOffice where it is installed. */
export const maxDuration = 60;

export const POST = route(handleRender);
