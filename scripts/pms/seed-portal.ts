/**
 * Demonstration online booking, patient portal and intake forms for the demo clinic (contract §9), after the diary,
 * records, billing and messages seeds:
 *   - online booking and the portal switched ON (new patients may book; 2 hours' notice; 6 weeks ahead; changes free
 *     up to 24 hours before), the clinic's phone as the contact line;
 *   - every site offered online with a map position (fictional sites at points in Milton Keynes – for the browser's
 *     "distance from you" only); the practitioners whose rota has hours marked "online" offered online;
 *   - the product's three starter forms as the clinic's active forms (sent with a new patient's first booking);
 *   - Megan Hart (sim-pat-001): a portal account, her consent form signed through the portal (sealed), a health
 *     questionnaire still to do, a shared exercise sheet, and an outcome questionnaire (NPRS) waiting in her portal.
 *
 * Everything goes through the portal repositories and services (audited, encrypted, sealed). Refuses a clinic not
 * flagged as a demonstration clinic. Idempotent: a clinic that already has booking settings is left as it is.
 *
 * Wiring (orchestrator, scripts/pms/seed-demo.ts – after seedComms):
 *   await seedPortal({ db, cipher: getDataCipher() }, slug, { log: (line) => console.log(`  ${line}`) });
 */
import { STARTER_FORMS } from "../../src/modules/pms/portal/starters";
import { outcomeQuestionnaire, OUTCOME_FORM_TITLES } from "../../src/modules/pms/portal/outcome-forms";
import { RepoInputError, type RepoContext } from "../../src/server/repos/context";
import { writeWithAudit } from "../../src/server/repos/pms/context";
import { listPractitioners, listSites, updatePractitioner } from "../../src/server/repos/pms/directory";
import { listAvailability } from "../../src/server/repos/pms/diary/availability";
import { searchPatients } from "../../src/server/repos/pms/patients";
import { getPmsSettings } from "../../src/server/repos/pms/settings";
import { ensurePortalAccount } from "../../src/server/repos/pms/portal/accounts";
import { createIntakeTemplate, listIntakeTemplates, outcomeRequestQueries, requestIntakeForm } from "../../src/server/repos/pms/portal/intake";
import { getBookingSettings, updateBookingSettings } from "../../src/server/repos/pms/portal/settings";
import { saveBookingSite } from "../../src/server/repos/pms/portal/sites";
import { sharePortalDocument } from "../../src/server/repos/pms/portal/shares";
import { submitForm } from "../../src/server/pms/portal/intake-service";
import { SEED_ACTOR } from "./seed-lib";

export interface SeedPortalOptions {
  log?: (line: string) => void;
}

/** Fictional sites placed at points in Milton Keynes (by site code). */
const POSITIONS: Record<string, { latitude: number; longitude: number }> = {
  BLE: { latitude: 51.9962, longitude: -0.7343 },
  WOL: { latitude: 52.0628, longitude: -0.8105 },
  CMK: { latitude: 52.0406, longitude: -0.7594 },
};

export async function seedPortal(ctx: RepoContext, tenantId: string, options: SeedPortalOptions = {}): Promise<{ existed: boolean }> {
  const log = options.log ?? (() => undefined);
  if (!(await getPmsSettings(ctx, tenantId)).isDemo) throw new RepoInputError("Online booking demo data is only for a clinic flagged as a demonstration clinic.");
  const current = await getBookingSettings(ctx, tenantId);
  if (current.rev > 0) {
    log("online booking: already set up – left as it is");
    return { existed: true };
  }
  const sites = await listSites(ctx, tenantId);
  await updateBookingSettings(
    ctx,
    tenantId,
    0,
    {
      onlineBooking: true,
      portal: true,
      newPatients: true,
      minNoticeHours: 2,
      maxDaysAhead: 42,
      slotStepMinutes: 15,
      cancelNoticeHours: 24,
      patientCancel: true,
      contactPhone: sites[0]?.phone ?? null,
      introText: "Book a physiotherapy appointment at any of our clinics. New and existing patients welcome.",
      cancellationPolicy: "Cancel or move free of charge up to 24 hours before. Later than that, or if you don't attend, the full fee may be charged.",
    },
    SEED_ACTOR,
  );
  for (const s of sites) {
    const pos = s.code ? POSITIONS[s.code] : undefined;
    await saveBookingSite(ctx, tenantId, 0, { siteId: s.id, online: true, latitude: pos?.latitude ?? null, longitude: pos?.longitude ?? null }, SEED_ACTOR);
  }
  // Offer online the practitioners whose rota has hours marked for online booking (the diary seed marks every
  // other rota window "online"); their other hours stay reception-only.
  const rota = await listAvailability(ctx, tenantId, {});
  const withOnlineHours = new Set(rota.filter((r) => r.onlineBookable).map((r) => r.practitionerId));
  let offered = 0;
  for (const p of await listPractitioners(ctx, tenantId)) {
    if (withOnlineHours.has(p.id) && !p.onlineBookable) {
      await updatePractitioner(ctx, tenantId, p.id, { onlineBookable: true }, SEED_ACTOR);
      offered++;
    }
  }
  log(`online booking: on – ${sites.length} sites offered online; ${offered} more practitioners offered online (their rota hours marked online)`);

  const existing = new Set((await listIntakeTemplates(ctx, tenantId)).map((t) => t.name));
  const formIds: Record<string, string> = {};
  for (const s of STARTER_FORMS) {
    if (existing.has(s.name)) continue;
    const t = await createIntakeTemplate(
      ctx,
      tenantId,
      { name: s.name, kind: s.kind, description: s.description, sendWhen: s.sendWhen, requiresSignature: s.requiresSignature, signatureStatement: s.signatureStatement, setsTreatmentConsent: s.setsTreatmentConsent, definition: s.definition },
      SEED_ACTOR,
    );
    formIds[s.key] = t.id;
  }
  log(`intake forms: ${Object.keys(formIds).length} starter forms active`);

  const megan = (await searchPatients(ctx, tenantId, { q: "Megan Hart", status: "active", limit: 5 })).find((p) => p.firstName === "Megan" && p.lastName === "Hart");
  if (megan) {
    await ensurePortalAccount(ctx, tenantId, megan.id, SEED_ACTOR);
    if (formIds.consent) {
      const consent = await requestIntakeForm(ctx, tenantId, { templateId: formIds.consent, patientId: megan.id }, SEED_ACTOR);
      await submitForm(
        ctx,
        tenantId,
        consent.response.id,
        1,
        { answers: { consent_treatment: "on", consent_records: "on", share_gp: "yes", cancellations: "on" }, signatureName: "Megan Hart", trust: "verified" },
        { userId: null, sessionId: null },
      );
    }
    if (formIds.health) await requestIntakeForm(ctx, tenantId, { templateId: formIds.health, patientId: megan.id }, SEED_ACTOR);
    await sharePortalDocument(ctx, tenantId, { patientId: megan.id, title: "Home exercises – neck", body: "Chin tucks: 10 repetitions, three times a day.\nShoulder rolls: 10 backwards, twice a day.\nStop any exercise that makes the pain much worse and tell your physiotherapist." }, SEED_ACTOR);
    const nprs = outcomeQuestionnaire("nprs");
    const q = outcomeRequestQueries(ctx, tenantId, { patientId: megan.id, caseId: null, measure: "nprs", name: OUTCOME_FORM_TITLES.nprs, form: nprs }, SEED_ACTOR);
    await writeWithAudit(ctx, q.queries);
    log("portal: Megan Hart – account, signed consent, a questionnaire to do, a shared exercise sheet, a pain rating to do");
  }
  return { existed: false };
}
