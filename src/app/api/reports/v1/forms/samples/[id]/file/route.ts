/** GET /api/reports/v1/forms/samples/[id]/file – thin route; logic lives in src/modules/medreport/api/handlers/forms-sample-file.ts. */
import { route } from "@/app/api/_medreport-glue";
import { handleFormSampleFile } from "@/modules/medreport/api/handlers/forms-sample-file";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(handleFormSampleFile);
