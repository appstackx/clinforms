/** POST /api/reports/v1/connectors/file-import/confirm – thin route; logic lives in src/modules/medreport/api/handlers/file-import-confirm.ts. */
import { route } from "@/app/api/_medreport-glue";
import { handleFileImportConfirm } from "@/modules/medreport/api/handlers/file-import-confirm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(handleFileImportConfirm);
