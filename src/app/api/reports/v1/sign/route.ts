/** POST /api/reports/v1/sign – thin route; logic lives in src/modules/medreport/api/handlers/sign.ts. */
import { route } from "@/app/api/_medreport-glue";
import { handleSign } from "@/modules/medreport/api/handlers/sign";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(handleSign);
