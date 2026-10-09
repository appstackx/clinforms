/** POST /api/reports/v1/store/files – thin route (clinic storage); logic lives in src/modules/medreport/api/handlers/store-files.ts. */
import { route } from "@/app/api/_medreport-glue";
import { handleStoreFileInit } from "@/modules/medreport/api/handlers/store-files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(handleStoreFileInit);
