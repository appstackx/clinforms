/** GET /api/reports/v1/connectors/[id]/patients/[pid]/episodes/[eid]/bundle – thin route; logic lives in src/modules/medreport/api/handlers/bundle.ts. */
import { route } from "@/app/api/_medreport-glue";
import { handleBundle } from "@/modules/medreport/api/handlers/bundle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(handleBundle);
