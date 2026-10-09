/** POST /api/reports/v1/forms/confirm – thin route; logic lives in src/modules/medreport/api/handlers/forms-confirm.ts. */
import { route } from "@/app/api/_medreport-glue";
import { handleFormsConfirm } from "@/modules/medreport/api/handlers/forms-confirm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(handleFormsConfirm);
