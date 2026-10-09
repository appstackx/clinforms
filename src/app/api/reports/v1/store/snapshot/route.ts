/** GET /api/reports/v1/store/snapshot – thin route (clinic storage); logic lives in src/modules/medreport/api/handlers/store-snapshot.ts. */
import { route } from "@/app/api/_medreport-glue";
import { handleStoreSnapshot } from "@/modules/medreport/api/handlers/store-snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(handleStoreSnapshot);
