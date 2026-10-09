/** PUT /api/reports/v1/store/files/[sha256]/chunks/[idx] – thin route (clinic storage); logic lives in src/modules/medreport/api/handlers/store-files.ts. */
import { route } from "@/app/api/_medreport-glue";
import { handleStoreFileChunk } from "@/modules/medreport/api/handlers/store-files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const PUT = route(handleStoreFileChunk);
