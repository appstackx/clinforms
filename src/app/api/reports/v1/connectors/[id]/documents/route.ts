/** POST /api/reports/v1/connectors/[id]/documents – thin route; logic lives in src/modules/medreport/api/handlers/documents.ts. */
import { route } from "@/app/api/_medreport-glue";
import { handleDocuments } from "@/modules/medreport/api/handlers/documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(handleDocuments);
