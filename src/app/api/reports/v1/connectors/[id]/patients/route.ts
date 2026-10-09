/** GET /api/reports/v1/connectors/[id]/patients – thin route; logic lives in src/modules/medreport/api/handlers/patients.ts. */
import { route } from "@/app/api/_medreport-glue";
import { handlePatients } from "@/modules/medreport/api/handlers/patients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(handlePatients);
