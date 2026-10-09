/** POST /api/reports/v1/connectors/file-import/bundle – thin route; logic lives in src/modules/medreport/api/handlers/file-import-bundle.ts. */
import { route } from "@/app/api/_medreport-glue";
import { handleFileImportBundle } from "@/modules/medreport/api/handlers/file-import-bundle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(handleFileImportBundle);
