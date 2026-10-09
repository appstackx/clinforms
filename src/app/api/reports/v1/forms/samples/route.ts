/** GET /api/reports/v1/forms/samples – thin route; logic lives in src/modules/medreport/api/handlers/forms-samples.ts. */
import { route } from "@/app/api/_medreport-glue";
import { handleFormSamples } from "@/modules/medreport/api/handlers/forms-samples";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(handleFormSamples);
