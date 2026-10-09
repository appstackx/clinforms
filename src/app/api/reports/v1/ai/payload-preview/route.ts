/** POST /api/reports/v1/ai/payload-preview – thin route; logic lives in src/modules/medreport/api/handlers/ai-payload-preview.ts. */
import { route } from "@/app/api/_medreport-glue";
import { handleAiPayloadPreview } from "@/modules/medreport/api/handlers/ai-payload-preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(handleAiPayloadPreview);
