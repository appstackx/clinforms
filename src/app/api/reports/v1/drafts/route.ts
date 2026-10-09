/** POST /api/reports/v1/drafts – thin route; logic lives in src/modules/medreport/api/handlers/drafts.ts. */
import { route } from "@/app/api/_medreport-glue";
import { handleDrafts } from "@/modules/medreport/api/handlers/drafts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Vercel Hobby limit. The SDK timeout is set ~10 s below this, with maxRetries: 0. */
export const maxDuration = 60;

export const POST = route(handleDrafts);
