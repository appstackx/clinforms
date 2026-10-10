/** GET PUT /api/reports/v1/store/settings – thin route (clinic storage); logic lives in src/modules/medreport/api/handlers/store-settings.ts. */
import { route } from "@/app/api/_medreport-glue";
import { handleStoreSettingsGet, handleStoreSettingsPut } from "@/modules/medreport/api/handlers/store-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(handleStoreSettingsGet);
export const PUT = route(handleStoreSettingsPut);
