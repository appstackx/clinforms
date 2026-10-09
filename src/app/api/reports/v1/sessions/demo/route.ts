/** POST /api/reports/v1/sessions/demo – thin route; logic lives in src/modules/medreport/api/handlers/sessions-demo.ts. */
import { route } from "@/app/api/_medreport-glue";
import { handleSessionsDemo } from "@/modules/medreport/api/handlers/sessions-demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(handleSessionsDemo);
