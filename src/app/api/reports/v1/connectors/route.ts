/** GET /api/reports/v1/connectors – thin route; logic lives in src/modules/medreport/api/handlers/connectors-list.ts. */
import { route } from "@/app/api/_medreport-glue";
import { handleConnectorsList } from "@/modules/medreport/api/handlers/connectors-list";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(handleConnectorsList);
