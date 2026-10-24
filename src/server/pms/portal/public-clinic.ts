/**
 * The clinic behind a public page (/clinics/<clinic id>/…). A page or action of the booking page or the patient
 * portal first loads the clinic here; nothing is shown unless the clinic exists, is not closed, has the "clinic"
 * package and has switched the page on (else the 404 page – an outsider cannot tell why). The clinic id comes from
 * the address; every query after this is scoped to it.
 */
import "server-only";
import { TENANT_ID_PATTERN, type DbContext } from "../../repos/context";
import { isPackageOn } from "../../repos/pms/entitlements";
import { getPmsSettings } from "../../repos/pms/settings";
import { getBookingSettings } from "../../repos/pms/portal/settings";
import { logAuthEvent } from "../../email/log";
import type { BookingSettings } from "../../../modules/pms/portal/types";

export interface PublicClinic {
  tenantId: string;
  name: string;
  settings: BookingSettings;
  /** A demonstration clinic (fictional data): the pages say so. */
  isDemo: boolean;
}

export async function loadPublicClinic(ctx: DbContext, slug: string): Promise<PublicClinic | null> {
  if (typeof slug !== "string" || !TENANT_ID_PATTERN.test(slug)) return null;
  try {
    const org = await ctx.db.selectFrom("organization").select(["name", "metadata"]).where("slug", "=", slug).executeTakeFirst();
    if (!org || (org.metadata && /"offboardedAt"/.test(org.metadata))) return null;
    if (!(await isPackageOn(ctx, slug, "clinic"))) return null;
    const [settings, pms] = await Promise.all([getBookingSettings(ctx, slug), getPmsSettings(ctx, slug)]);
    if (!settings.onlineBooking && !settings.portal) return null;
    return { tenantId: slug, name: org.name, settings, isDemo: pms.isDemo };
  } catch (err) {
    logAuthEvent("pms.portal.clinic_unreadable", { error: err instanceof Error ? err.name : "error" });
    return null;
  }
}
