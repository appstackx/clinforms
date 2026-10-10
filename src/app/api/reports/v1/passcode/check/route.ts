/** POST /api/reports/v1/passcode/check – thin route; logic lives in src/modules/medreport/api/handlers/passcode-check.ts. */
import { route } from "@/app/api/_medreport-glue";
import { handlePasscodeCheck } from "@/modules/medreport/api/handlers/passcode-check";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(handlePasscodeCheck);
