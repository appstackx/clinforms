/** POST /api/reports/v1/connectors/file-import/read – thin route; logic lives in src/modules/medreport/api/handlers/file-import-read.ts. */
import { route } from "@/app/api/_medreport-glue";
import { handleFileImportRead } from "@/modules/medreport/api/handlers/file-import-read";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(handleFileImportRead);
