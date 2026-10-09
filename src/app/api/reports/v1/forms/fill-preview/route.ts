/** POST /api/reports/v1/forms/fill-preview – thin route; logic lives in src/modules/medreport/api/handlers/forms-fill-preview.ts. */
import { route } from "@/app/api/_medreport-glue";
import { handleFormsFillPreview } from "@/modules/medreport/api/handlers/forms-fill-preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = route(handleFormsFillPreview);
