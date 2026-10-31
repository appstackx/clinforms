/**
 * Demonstration data for the integration module (contract §9), after the other module seeds:
 *   - the clinic's ClinForms library: two of the bundled fictional referrer forms (Northfield Assurance's
 *     "Rehabilitation Progress Report", Harrow & Pike Medico-Legal's "Treating Physiotherapist Report"), confirmed with
 *     the server's attestation, and their files in the clinic's form storage (as "Upload a referrer form" would);
 *   - the referrer-form walk of design round 3: Emily Turner (fictional, sim-int-001), case "Right shoulder – rotator
 *     cuff" referred by Bletchley Medical Centre (fictional), insured by Northfield Assurance (fictional) with
 *     authorisation NA-55021 (6 sessions), Priya Shah's signed initial assessment and an NPRS score;
 *   (Approving with a made-up PH-DEMO number needs the ClinForms demo-clinic flag, which only ClinForms staff set:
 *   `npm run admin:set-demo-clinic -- --slug riverside-demo --on` – the e2e runner does it on its scratch database.)
 *
 * Refuses a clinic not flagged as a demonstration clinic (seed-lib). Idempotent: whatever is already there is left.
 *
 * Wiring (scripts/pms/seed-demo.ts – after seedPortal):
 *   await seedIntegration({ db, cipher: getDataCipher() }, slug, { log: (line) => console.log(`  ${line}`) });
 */
import { withAttestedConfirmation } from "../../src/modules/medreport/auth/attestations";
import { getSampleForm } from "../../src/modules/medreport/forms/samples/registry";
import { sha256Hex } from "../../src/modules/medreport/forms/file";
import type { RepoContext } from "../../src/server/repos/context";
import { beginFormFileUpload, putFormFileChunk } from "../../src/server/repos/form-file-uploads";
import { FILE_CHUNK_BYTES } from "../../src/server/repos/form-files";
import { listFormMeta } from "../../src/server/repos/forms";
import { createAuthorisation, createCase } from "../../src/server/repos/pms/cases";
import { listPractitioners, listSites } from "../../src/server/repos/pms/directory";
import { createPatient } from "../../src/server/repos/pms/patients";
import { createReferrer, listReferrers } from "../../src/server/repos/pms/referrers";
import { bulkImportNotes } from "../../src/server/repos/pms/records/notes";
import { recordOutcome } from "../../src/server/repos/pms/records/outcomes";
import { createTenantStore } from "../../src/server/store/tenant-store";
import { pmsNow } from "../../src/modules/pms/core/clock";
import { ukToday } from "../../src/modules/pms/core/text";
import { assertDemoClinic, SEED_ACTOR } from "./seed-lib";

export interface SeedIntegrationOptions {
  log?: (line: string) => void;
}

const LIBRARY = ["northfield-rehab-progress", "harrow-pike-treating-physio"] as const;
const EMILY_REF = "sim-int-001";

function daysBefore(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T12:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
}

export async function seedIntegration(ctx: RepoContext, tenantId: string, options: SeedIntegrationOptions = {}): Promise<{ forms: number; patient: boolean }> {
  const log = options.log ?? (() => {});
  await assertDemoClinic(ctx.db, tenantId);
  const c: RepoContext = { ...ctx, now: ctx.now ?? pmsNow };


  // The library: confirmed sample forms with their files.
  const have = new Set((await listFormMeta(c, tenantId)).map((f) => f.id));
  const store = createTenantStore(() => c);
  let forms = 0;
  for (const id of LIBRARY) {
    const sample = getSampleForm(id);
    const map = sample?.loadForm ? await sample.loadForm() : undefined;
    if (!sample || !map) continue;
    const bytes = await sample.loadFile();
    const sha = sha256Hex(bytes);
    const begun = await beginFormFileUpload(c, tenantId, { sha256: sha, fileName: sample.fileName, mimeType: sample.mimeType, sizeBytes: bytes.byteLength });
    if (begun.held !== "all") {
      for (let idx = 0; idx * FILE_CHUNK_BYTES < bytes.byteLength; idx++) {
        await putFormFileChunk(c, tenantId, sha, idx, bytes.subarray(idx * FILE_CHUNK_BYTES, Math.min(bytes.byteLength, (idx + 1) * FILE_CHUNK_BYTES)));
      }
    }
    if (have.has(map.id)) continue;
    const form = withAttestedConfirmation({ ...map, tenantId, status: "confirmed", sampleId: sample.id }, "Clinic manager (demo)", c.now!().toISOString());
    await store.createForm(tenantId, { id: form.id, status: form.status, title: form.title, referrer: form.referrer.name, kind: form.kind, fileSha256: form.file.sha256, sampleId: sample.id, payload: { ...form, tenantId } });
    forms++;
  }
  log(`ClinForms library: ${forms} sample referrer forms added (${LIBRARY.length} offered)`);

  // The referrer-form walk.
  const existing = await c.db.selectFrom("pms_patients").select("id").where("tenant_id", "=", tenantId).where("import_ref", "=", EMILY_REF).executeTakeFirst();
  if (existing) return { forms, patient: false };
  const today = ukToday(c.now!());
  const referrers = await listReferrers(c, tenantId, { includeInactive: true });
  const insurer = referrers.find((r) => r.name === "Northfield Assurance (fictional)") ?? (await createReferrer(c, tenantId, { kind: "insurer", name: "Northfield Assurance (fictional)", contactName: "Rehabilitation claims", phone: "01632 960204", email: "rehab@northfield-assurance.example.com" }, SEED_ACTOR));
  const gp = referrers.find((r) => r.name === "Bletchley Medical Centre (fictional)") ?? null;
  const priya = (await listPractitioners(c, tenantId, { includeInactive: true })).find((p) => p.displayName === "Priya Shah") ?? null;
  const site = (await listSites(c, tenantId)).find((s) => s.id === priya?.defaultSiteId) ?? (await listSites(c, tenantId))[0];
  const emily = await createPatient(
    c,
    tenantId,
    { title: "Mrs", firstName: "Emily", lastName: "Turner", dateOfBirth: "1982-09-27", sex: "female", email: "emily.turner@example.com", phoneMobile: "07700 900417", address: ["12 Example Row (fictional)", "Bletchley"], postcode: "MK3 9ZZ", gpName: "Dr A. Fenwick (fictional)", gpPractice: "Bletchley Medical Centre (fictional)", importRef: EMILY_REF } as never,
    SEED_ACTOR,
  );
  const opened = daysBefore(today, 8);
  const kase = await createCase(
    c,
    tenantId,
    {
      patientId: emily.id,
      title: "Right shoulder – rotator cuff",
      openedOn: opened,
      payerType: "insurer",
      payerReferrerId: insurer.id,
      referrerId: gp?.id ?? null,
      practitionerId: priya?.id ?? null,
      siteId: site?.id ?? null,
      membershipNumber: "NA-883201",
      claimReference: "NA/RC/2291",
      referralReceivedOn: opened,
      referralReason: "Right shoulder pain for six weeks, worse reaching overhead (fictional).",
    },
    SEED_ACTOR,
  );
  await createAuthorisation(c, tenantId, { caseId: kase.id, patientId: emily.id, referrerId: insurer.id, code: "NA-55021", sessionsAuthorised: 6, validFrom: opened } as never, SEED_ACTOR);
  const seenOn = daysBefore(today, 1);
  const [noteId] = await bulkImportNotes(
    c,
    tenantId,
    [
      {
        patientId: emily.id,
        caseId: kase.id,
        templateId: "builtin-initial-soap",
        seenOn,
        practitionerId: priya?.id ?? null,
        author: { name: "Priya Shah", registration: "PH-DEMO-03", userId: null },
        sections: {
          subjective: "Right shoulder pain for 6 weeks, gradual onset, worse reaching overhead and lying on the right side. Office worker. Goal: swim again (fictional).",
          objective: "Painful arc 70–110°. Positive Hawkins-Kennedy and Empty can tests. Full passive range. Neck clear.",
          assessment: "Rotator cuff related shoulder pain.",
          plan: "Education, isometric loading, scapular work, home programme. Review weekly.",
          consent: "Verbal consent to assessment and treatment.",
        },
        signed: true,
        importRef: "sim-int-note-001",
      },
    ],
    SEED_ACTOR,
    { source: "seed" },
  );
  await recordOutcome(c, tenantId, { patientId: emily.id, caseId: kase.id, noteId, measure: "nprs", takenOn: seenOn, answers: { items: { pain: 6 } } }, SEED_ACTOR);
  log(`Referrer-form walk: Emily Turner (${EMILY_REF}), case "Right shoulder – rotator cuff", Northfield Assurance, NA-55021, 1 signed note, NPRS 6/10`);
  return { forms, patient: true };
}
