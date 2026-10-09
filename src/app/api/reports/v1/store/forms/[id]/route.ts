/** GET PUT DELETE /api/reports/v1/store/forms/[id] – thin route (clinic storage); logic lives in src/modules/medreport/api/handlers/store-forms.ts. */
import { route } from "@/app/api/_medreport-glue";
import { handleStoreFormGet, handleStoreFormPut, handleStoreFormDelete } from "@/modules/medreport/api/handlers/store-forms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(handleStoreFormGet);
export const PUT = route(handleStoreFormPut);
export const DELETE = route(handleStoreFormDelete);
