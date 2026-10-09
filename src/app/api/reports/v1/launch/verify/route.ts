/** POST /api/reports/v1/launch/verify – thin route; logic lives in src/modules/medreport/api/handlers/launch-verify.ts. */
import { route } from "@/app/api/_medreport-glue";
import { handleLaunchVerify } from "@/modules/medreport/api/handlers/launch-verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(handleLaunchVerify);
