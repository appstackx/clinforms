/** POST /api/reports/v1/launch – thin route; logic lives in src/modules/medreport/api/handlers/launch.ts. */
import { route } from "@/app/api/_medreport-glue";
import { handleLaunch } from "@/modules/medreport/api/handlers/launch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(handleLaunch);
