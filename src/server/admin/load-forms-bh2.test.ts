/**
 * admin:load-forms – bh2 WE design 1 and 2 (the d6c779f --replace-proposed suite, extended): the analysis fields every
 * load and replace writes (file.sourceSha256, analysis.convertedWith, analysis.printedLeads, guidanceVersion), the map
 * lint before any write (refused unless accepted per field, the acceptance recorded in the audit row), the source pin,
 * the revision check, the restore of earlier maps (the rollback – only maps the clinic's audit trail records), and the
 * clinic's own rows – members, invitation, plan, package, usage, settings, reports – identical before and after.
 *
 * On node:sqlite and PGlite here (`npm run test:db`); on D1 through the gateway and real local D1 in
 * workers/data-gateway/test/load-forms-bh2.test.ts. Fictional templates and fictional clinics only.
 * Owner: WE (data, maps and mapping page).
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { Kysely } from "kysely";
import { RTF_CONVERTER_VERSION } from "../../modules/medreport/core/rtf";
import { GUIDANCE_VERSION } from "../../modules/medreport/core/schemas";
import type { FormDefinition, FormField } from "../../modules/medreport/core/types";
import { buildDocx, fictionalFormJson, layoutWith } from "../../modules/medreport/core/validation/__corpus__/harness/fixtures";
import { activityLabel, describeActivityDetail } from "../../lib/activity-copy";
import { PLATFORM_USER_ID } from "../auth/create-auth";
import type { SqliteDatabaseLike } from "../db/dialects/sqlite-local";
import type { Database } from "../db/schema";
import { createPgliteTestDb, createSqliteTestDb, testCipher } from "../db/testing/databases";
import { appendAudit, listAudit } from "../repos/audit";
import type { RepoContext } from "../repos/context";
import { setClinicPackage } from "../repos/clinic-package";
import { setClinicTrial } from "../repos/clinic-plan";
import { createForm, listForms } from "../repos/forms";
import { putFormFile } from "../repos/form-files";
import { createReport } from "../repos/reports";
import { putTenantSettings } from "../repos/tenant-settings";
import { clinicFingerprint, loadClinicForms, mapFieldsSha256, parseMapsJson, printedLeadsOf } from "./load-forms";
import { PREPARED_NOTE } from "../../modules/medreport/core/form-map-lint";
import { storedFormFileName } from "../../modules/medreport/api/store-contract";

export interface LoadFormsBh2SuiteDb {
  db: Kysely<Database>;
  close: () => Promise<void>;
  /** The SQLite database underneath (node:sqlite, the D1 stand-in): the hook case changes a row during a run. */
  sqlite?: SqliteDatabaseLike;
}

const FIXTURES = path.join(process.cwd(), "scripts/medreport/fixtures/rtf");
const sha = (bytes: Uint8Array | Buffer) => createHash("sha256").update(bytes).digest("hex");
const AT = "2026-10-26T09:00:00.000Z";

export function defineLoadFormsBh2Suite(label: string, factory: () => Promise<LoadFormsBh2SuiteDb>, options: { skip?: string | false } = {}): void {
  describe(`admin:load-forms (bh2 WE) – ${label}`, { skip: options.skip }, () => {
    let t: LoadFormsBh2SuiteDb;
    let ctx: RepoContext;
    let root = "";
    let n = 0;
    before(async () => {
      t = await factory();
      ctx = { db: t.db, cipher: testCipher(), now: () => new Date(AT) };
      root = fs.mkdtempSync(path.join(os.tmpdir(), "clinforms-load-forms-bh2-"));
    });
    after(async () => {
      if (root) fs.rmSync(root, { recursive: true, force: true });
      await t?.close();
    });

    /** A fictional clinic of its own, with an owner invited (never signed in), a trial, a package, usage, settings and a report. */
    const clinic = async (opts: { full?: boolean } = {}) => {
      const slug = `load-forms-bh2-${++n}`;
      const orgId = `org-${slug}`;
      await t.db.insertInto("organization").values({ id: orgId, name: `${slug} (fictional)`, slug, logo: null, createdAt: AT, metadata: null }).execute();
      if (opts.full) {
        const userId = `user-${slug}`;
        await t.db.insertInto("user").values({ id: userId, name: "Olive Owner (fictional)", email: `${userId}@clinic.example`, emailVerified: true, image: null, createdAt: AT, updatedAt: AT, twoFactorEnabled: false }).execute();
        await t.db.insertInto("member").values({ id: `m-${slug}`, organizationId: orgId, userId, role: "admin", createdAt: AT }).execute();
        await t.db.insertInto("invitation").values({ id: `inv-${slug}`, organizationId: orgId, email: "owner@clinic.example", role: "owner", status: "pending", expiresAt: "2026-10-31T09:00:00.000Z", createdAt: AT, inviterId: userId }).execute();
        await setClinicTrial(ctx, slug, { days: 3, startOnFirstSignIn: true });
        await setClinicPackage(ctx, slug, { package: "starter", monthlyPricePence: 9900, reportsIncluded: 25, extraReportPence: 150 });
        await t.db.insertInto("clinic_usage").values({ tenant_id: slug, period: "2026-10", created_at: AT, updated_at: AT }).execute();
        await t.db.insertInto("usage_event").values({ id: `ue-${slug}`, tenant_id: slug, kind: "report_started", period: "2026-10", created_at: AT }).execute();
        await putTenantSettings(ctx, slug, { "orchard-fictional": "frm_not_these" });
        assert.ok((await createReport(ctx, slug, { id: `rpt_${slug.replace(/-/g, "_")}`, status: "draft", templateId: "solicitor_rta", payload: { fictional: true } })).ok);
      }
      return slug;
    };
    const folder = (files: Record<string, Uint8Array | Buffer | string>) => {
      const d = fs.mkdtempSync(path.join(root, "f-"));
      for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(d, name), content);
      return d;
    };
    const run = (slug: string, dir: string, maps: Record<string, unknown>, opts: { confirm?: boolean; replace?: boolean; restore?: boolean; readMissing?: boolean } = {}) =>
      loadClinicForms(ctx, {
        tenantId: slug,
        dir,
        maps: parseMapsJson(JSON.stringify(maps)),
        readMissing: opts.readMissing ?? false,
        defaultReferrer: { name: "Orchard Case Management (fictional)", type: "case_manager" },
        replaceProposed: opts.replace ?? false,
        restore: opts.restore ?? false,
        confirm: opts.confirm ?? false,
      });
    const one = async (slug: string) => {
      const forms = await listForms<FormDefinition>(ctx, slug);
      assert.equal(forms.length, 1, `one form: ${forms.map((f) => f.id).join(", ")}`);
      return forms[0];
    };

    /** The corpus's fictional discharge form (ClinForms' own wording): a "To return to …" blank, a staff-entered work status. */
    const discharge = fictionalFormJson("cf-discharge");
    const dischargeBytes = Buffer.from(buildDocx(layoutWith("cf-discharge")));
    const dischargeMap = (fields: unknown[] = discharge.fields, extra: Record<string, unknown> = {}) => ({
      [discharge.fileName]: { title: discharge.title, referrer: discharge.referrer, fields, file: { sourceSha256: sha(dischargeBytes) }, ...extra },
    });
    /** Its work-status question (staff.entry, a status with "lighter duties") accepted with a reason. */
    const accepted = (reason = "Patient-reported work status, recorded in the notes (fictional).") =>
      discharge.fields.map((f) => (f.id === "F-04" ? { ...f, lintAccepted: [{ rule: "L5", reason, at: AT }] } : f));

    it("the map lint runs before anything is written: a finding refuses the map, an accepted one is recorded in the audit row", async () => {
      const slug = await clinic();
      const dir = folder({ [discharge.fileName]: dischargeBytes });
      for (const confirm of [false, true]) {
        const refused = await run(slug, dir, dischargeMap(), { confirm });
        assert.equal(refused.files[0]?.status, "refused", JSON.stringify(refused.files[0]));
        assert.match(refused.files[0]?.reason ?? "", /^The map does not pass the map lint \(L5@F-04\): fix the map, or accept a finding for its question with lintAccepted and the reason\.$/);
        assert.deepEqual(refused.files[0]?.lint, { errors: ["L5@F-04"], accepted: [] });
      }
      assert.equal((await listForms(ctx, slug)).length, 0, "nothing stored");
      assert.equal((await listAudit(ctx, slug)).length, 0, "nothing audited");
      // Accepted for its question: loaded, and the audit row names the rule, the question and ClinForms' reason.
      const r = await run(slug, dir, dischargeMap(accepted()), { confirm: true });
      assert.equal(r.files[0]?.status, "loaded", JSON.stringify(r.files[0]));
      assert.deepEqual(r.files[0]?.lint, { errors: [], accepted: ["L5@F-04"] });
      const row = (await listAudit(ctx, slug)).find((e) => e.action === "form.create");
      assert.deepEqual(row?.detail?.lintAccepted, [{ rule: "L5", fieldId: "F-04", reason: "Patient-reported work status, recorded in the notes (fictional)." }]);
      // An acceptance of another rule does not cover L5.
      const other = discharge.fields.map((f) => (f.id === "F-04" ? { ...f, lintAccepted: [{ rule: "L1", reason: "Written for staff (fictional).", at: AT }] } : f));
      const again = await run(await clinic(), dir, dischargeMap(other));
      assert.equal(again.files[0]?.status, "refused");
    });

    it("every load writes file.sourceSha256, analysis.printedLeads from the template, and (a converted file) analysis.convertedWith", async () => {
      const slug = await clinic();
      const rtf = fs.readFileSync(path.join(FIXTURES, "initial-assessment-report.rtf"));
      const dir = folder({ [discharge.fileName]: dischargeBytes, "Larchfield IA.rtf": rtf });
      const r = await run(slug, dir, dischargeMap(accepted()), { confirm: true, readMissing: true });
      assert.deepEqual(r.files.map((f) => f.status), ["loaded", "loaded"], JSON.stringify(r.files.map((f) => [f.file, f.status, f.reason])));
      const forms = await listForms<FormDefinition>(ctx, slug);
      const docx = forms.find((f) => f.payload.file.fileName === discharge.fileName)?.payload;
      const converted = forms.find((f) => f.payload.file.fileName === "Larchfield IA.rtf")?.payload;
      assert.ok(docx && converted);
      assert.equal(docx.file.sourceSha256, sha(dischargeBytes), "a Word file: its own SHA-256");
      assert.equal(docx.file.sourceSha256, docx.file.sha256);
      assert.equal(docx.analysis.convertedWith, undefined, "not converted");
      assert.deepEqual(docx.analysis.printedLeads, { "F-27": "To return to" }, "the words printed before the “…” blank");
      assert.equal(docx.analysis.guidanceVersion, undefined, "a map that does not say it is in this release's wording");
      assert.equal(converted.file.sourceSha256, sha(rtf), "the RTF template as supplied, before conversion");
      assert.notEqual(converted.file.sourceSha256, converted.file.sha256);
      assert.equal(converted.analysis.convertedWith, RTF_CONVERTER_VERSION);
      assert.equal(converted.analysis.guidanceVersion, GUIDANCE_VERSION, "a reading is written in this release's wording");
      assert.ok(converted.analysis.warnings.filter((w) => /prepared by ClinForms/i.test(w)).length === 1, "exactly one prepared line");
      // A map that says it is written in this release's wording keeps the marker.
      const v2 = await run(await clinic(), dir, dischargeMap(accepted(), { guidanceVersion: 2 }), { confirm: true });
      assert.equal(v2.files.find((f) => f.file === discharge.fileName)?.status, "loaded");
    });

    it("printedLeadsOf: only blanks inside printed words, at most the clause before the blank", () => {
      const field = (id: string, placeholderText: string, blockId = "p0"): FormField =>
        ({ id, label: id, guidance: "", answerType: "short_text", anchor: { kind: "docx", target: "replace_placeholder", blockId, placeholderText }, fillSource: { kind: "notes_narrative" }, required: false, confidence: "high" }) as FormField;
      const text: Record<string, string> = { p0: "Goal: To return to … within six weeks", p1: "Name: ..........", p2: "…", p3: "Pain at rest. Usually … at night" };
      const leads = printedLeadsOf([field("F-01", "…"), field("F-02", "..........", "p1"), field("F-03", "…", "p2"), field("F-04", "…", "p3"), field("F-05", "Name", "p1")], (id) => text[id] ?? null);
      assert.deepEqual(leads, { "F-01": "To return to", "F-04": "Usually" });
      // Two blanks in one block: each question's lead is read before its own blank; a clause after a comma and a capital.
      const two = printedLeadsOf([field("F-01", "…", "p9"), field("F-02", "…", "p9")], () => "Plan agreed, To return to … within six weeks in … visits at most");
      assert.deepEqual(two, { "F-01": "To return to", "F-02": "within six weeks in" });
    });

    it("the source pin: a map pinned to the file as supplied loads after a new conversion; a pin to an earlier conversion is refused (unless restoring)", async () => {
      const rtf = fs.readFileSync(path.join(FIXTURES, "initial-assessment-report.rtf"));
      const dir = folder({ "Larchfield IA.rtf": rtf });
      // A map file built from a reading of the template: the same fields, with each pin in turn.
      const readingClinic = await clinic();
      const reading = (await run(readingClinic, dir, {}, { readMissing: true, confirm: true })).files[0];
      assert.equal(reading?.status, "loaded");
      const stored = (await one(readingClinic)).payload;
      const map = (file: Record<string, string>) => ({ "Larchfield IA.rtf": { title: stored.title, referrer: stored.referrer, fields: stored.fields, file } });
      const bySource = await run(await clinic(), dir, map({ sourceSha256: sha(rtf) }));
      assert.equal(bySource.files[0]?.status, "ready", JSON.stringify(bySource.files[0]));
      const byConversion = await run(await clinic(), dir, map({ sha256: stored.file.sha256 }));
      assert.equal(byConversion.files[0]?.status, "ready", "the current conversion");
      const earlier = await run(await clinic(), dir, map({ sha256: "f".repeat(64) }));
      assert.equal(earlier.files[0]?.status, "refused");
      assert.match(earlier.files[0]?.reason ?? "", /another version of this file \(or another conversion of it\)/);
      const wrongSource = await run(await clinic(), dir, map({ sourceSha256: "e".repeat(64), sha256: stored.file.sha256 }));
      assert.match(wrongSource.files[0]?.reason ?? "", /^The map was made from another file \(its source pin does not match this file\)/);
    });

    /**
     * What an earlier release's admin:load-forms stored (production's maps-v1): the form, its file and its creation row –
     * no map lint, no source pin, no map digest in the audit row.
     */
    const seedEarlierRelease = async (slug: string, fields: unknown[]) => {
      const id = `frm_earlier_${slug.replace(/-/g, "_")}`;
      const file = { fileName: discharge.fileName, mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" as const, sha256: sha(dischargeBytes), sizeBytes: dischargeBytes.length };
      await putFormFile(ctx, slug, { bytes: new Uint8Array(dischargeBytes), fileName: storedFormFileName(file.mimeType), mimeType: file.mimeType, expectedSha256: file.sha256 });
      const payload: FormDefinition = {
        id,
        tenantId: slug,
        referrer: discharge.referrer,
        title: discharge.title,
        file,
        kind: "docx",
        fields: fields as FormField[],
        status: "proposed",
        analysis: { mode: "demo_prewritten", promptVersion: "onboarding-1", at: AT, warnings: [PREPARED_NOTE] },
        createdAt: AT,
        updatedAt: AT,
      };
      assert.ok((await createForm(ctx, slug, { id, fileSha256: file.sha256, status: "proposed", title: payload.title, referrer: payload.referrer.name, kind: "docx", sampleId: null, payload })).ok);
      await appendAudit(ctx, slug, { userId: PLATFORM_USER_ID, action: "form.create", targetType: "form", targetId: id, detail: { via: "onboarding", status: "proposed", fields: fields.length, kind: "docx", mapFrom: "json" } });
      return id;
    };

    it("replace + restore (the rollback): the earlier map comes back over an untouched form, its findings listed, the restore audited", async () => {
      const slug = await clinic();
      const dir = folder({ [discharge.fileName]: dischargeBytes });
      // v1 as production holds it: loaded by an earlier release, pinned to an earlier conversion and carrying a note
      // written for the preparer.
      const v1Fields = accepted().map((f) => (f.id === "F-12" ? { ...f, note: "Ask the clinic manager what this score means (fictional)." } : f));
      const v1 = { [discharge.fileName]: { title: discharge.title, referrer: discharge.referrer, fields: v1Fields, file: { sha256: "d".repeat(64) } } };
      const v1Id = await seedEarlierRelease(slug, v1Fields);
      // Before v2 replaced it, --restore-maps knows no map of this clinic: nothing is brought back.
      const early = await run(slug, dir, v1, { replace: true, restore: true });
      assert.equal(early.files[0]?.status, "refused", JSON.stringify(early.files[0]));
      // v2: the clean map, pinned to the source – replaces it, and its row records the map it replaced.
      const second = await run(slug, dir, dischargeMap(accepted(), { guidanceVersion: 2 }), { confirm: true, replace: true });
      assert.equal(second.files[0]?.status, "replaced", JSON.stringify(second.files[0]));
      assert.deepEqual(second.files[0]?.replaces, [v1Id]);
      const v2Form = await one(slug);
      assert.equal(v2Form.payload.fields.find((f) => f.id === "F-12")?.note, undefined);
      const replaceRow = (await listAudit(ctx, slug, { action: "form.replace" }))[0];
      assert.deepEqual(replaceRow?.detail?.replacesMapSha256, [mapFieldsSha256(v1Fields)]);
      assert.equal(replaceRow?.detail?.mapSha256, mapFieldsSha256(v2Form.payload.fields));
      // Without --restore-maps the earlier map is refused (its pin and its findings); with it, it comes back.
      const refused = await run(slug, dir, v1, { replace: true });
      assert.equal(refused.files[0]?.status, "refused");
      const back = await run(slug, dir, v1, { confirm: true, replace: true, restore: true });
      assert.equal(back.files[0]?.status, "replaced", JSON.stringify(back.files[0]));
      assert.deepEqual(back.files[0]?.replaces, [v2Form.id]);
      assert.deepEqual(back.files[0]?.lint?.errors, ["L1@F-12"], "listed, not refused (a Word file needs no source pin: L11 is for converted files)");
      const restored = await one(slug);
      assert.equal(restored.rev, 1, "a fresh proposal, revision 1");
      assert.equal(restored.payload.fields.find((f) => f.id === "F-12")?.note, "Ask the clinic manager what this score means (fictional).");
      assert.equal(restored.payload.analysis.guidanceVersion, undefined, "the earlier map's guidance reads as before (legacy rewrite on screen)");
      const rows = (await listAudit(ctx, slug, { limit: 100 })).filter((e) => e.action === "form.replace");
      assert.equal(rows.length, 2);
      assert.equal(rows.filter((e) => e.detail?.restore === true).length, 1, "the restore is audited as one");
      assert.ok(rows.every((e) => e.userId === PLATFORM_USER_ID));
      // And v2 can come back over the restored v1 the same way (its own row recorded it).
      const forward = await run(slug, dir, dischargeMap(accepted(), { guidanceVersion: 2 }), { replace: true, restore: true });
      assert.equal(forward.files[0]?.status, "replace", JSON.stringify(forward.files[0]));
    });

    it("--restore-maps never loads a map ClinForms did not load or replace for this clinic (check-WE minor 1)", async () => {
      const slug = await clinic();
      const dir = folder({ [discharge.fileName]: dischargeBytes });
      await seedEarlierRelease(slug, accepted());
      // A brand-new map with an open L5 (the work status left to staff, not accepted): refused with and without restore.
      for (const restore of [false, true]) {
        for (const confirm of [false, true]) {
          const r = await run(slug, dir, dischargeMap(discharge.fields), { confirm, replace: true, restore });
          assert.equal(r.files[0]?.status, "refused", JSON.stringify(r.files[0]));
          if (restore) assert.match(r.files[0]?.reason ?? "", /^--restore-maps brings back only a map ClinForms loaded or replaced for this clinic before/);
        }
      }
      // A map another clinic had: still not this clinic's.
      const other = await clinic();
      await run(other, dir, dischargeMap(accepted(), { guidanceVersion: 2 }), { confirm: true });
      const elsewhere = await run(slug, dir, dischargeMap(accepted(), { guidanceVersion: 2 }), { replace: true, restore: true });
      assert.equal(elsewhere.files[0]?.status, "refused");
      assert.equal((await one(slug)).payload.fields.length, discharge.fields.length, "the clinic's form is as it was");
    });

    it("a re-run is idempotent: every form SKIP with the new fields, 0 writes, 0 audit rows", async () => {
      const slug = await clinic();
      const rtf = fs.readFileSync(path.join(FIXTURES, "initial-assessment-report.rtf"));
      const dir = folder({ [discharge.fileName]: dischargeBytes, "Larchfield IA.rtf": rtf });
      const maps = dischargeMap(accepted(), { guidanceVersion: 2 });
      assert.ok((await run(slug, dir, maps, { confirm: true, readMissing: true })).files.every((f) => f.status === "loaded"));
      const before = JSON.stringify((await listForms(ctx, slug)).map((f) => [f.id, f.rev, f.fileSha256, f.payload]));
      const audit = (await listAudit(ctx, slug, { limit: 100 })).length;
      for (const confirm of [false, true]) {
        const again = await run(slug, dir, maps, { confirm, replace: true, readMissing: true });
        assert.deepEqual(again.files.map((f) => f.status), ["skipped", "skipped"], JSON.stringify(again.files.map((f) => [f.file, f.status, f.reason])));
      }
      assert.equal(JSON.stringify((await listForms(ctx, slug)).map((f) => [f.id, f.rev, f.fileSha256, f.payload])), before);
      assert.equal((await listAudit(ctx, slug, { limit: 100 })).length, audit);
    });

    it("the revision check: a form whose revision is not what ClinForms' own loads account for is kept", async () => {
      const slug = await clinic();
      const dir = folder({ [discharge.fileName]: dischargeBytes });
      await run(slug, dir, dischargeMap(accepted()), { confirm: true });
      const form = await one(slug);
      // A second creation row for the same form id (no Studio activity; the revision is still 1): not what one load accounts for.
      await appendAudit(ctx, slug, { userId: PLATFORM_USER_ID, action: "form.create", targetType: "form", targetId: form.id, detail: { via: "onboarding", status: "proposed", fields: 1, kind: "docx", mapFrom: "json" } });
      const r = await run(slug, dir, dischargeMap(accepted(), { guidanceVersion: 2 }), { replace: true });
      assert.equal(r.files[0]?.status, "refused");
      assert.match(r.files[0]?.reason ?? "", new RegExp(`^The form ${form.id} in the library has revision 1, but ClinForms loaded it 2 times \\(a change without an activity row\\): it is kept as it is\\.$`));
    });

    it("the clinic's members, invitation, plan, package, usage, settings and reports are identical before and after (and the run says so)", async () => {
      const slug = await clinic({ full: true });
      const dir = folder({ [discharge.fileName]: dischargeBytes });
      const rows = async () => ({
        fp: await clinicFingerprint(t.db, slug),
        invitation: await t.db.selectFrom("invitation").select(["id", "status", "role", "expiresAt"]).where("organizationId", "=", `org-${slug}`).execute(),
        members: (await t.db.selectFrom("member").select("id").where("organizationId", "=", `org-${slug}`).execute()).length,
        plan: await t.db.selectFrom("clinic_plan").selectAll().where("tenant_id", "=", slug).execute(),
        pkg: await t.db.selectFrom("clinic_package").selectAll().where("tenant_id", "=", slug).execute(),
      });
      const before = await rows();
      assert.equal(before.invitation[0]?.status, "pending");
      const loaded = await run(slug, dir, dischargeMap(accepted()), { confirm: true });
      assert.deepEqual(loaded.invariants, { ok: true, changed: [] });
      const replaced = await run(slug, dir, dischargeMap(accepted(), { guidanceVersion: 2 }), { confirm: true, replace: true });
      assert.equal(replaced.files[0]?.status, "replaced");
      assert.deepEqual(replaced.invariants, { ok: true, changed: [] });
      assert.deepEqual(await rows(), before, "every row as it was");
      // The preview reads nothing it would compare.
      assert.equal((await run(slug, dir, dischargeMap(accepted()), { replace: true })).invariants, undefined);
    });

    it("a clinic row changed during a confirmed run is reported (the CLI exits non-zero on it)", async () => {
      // Every database: the fingerprint names exactly the table whose row changed.
      const probe = await clinic({ full: true });
      const before = await clinicFingerprint(t.db, probe);
      await t.db.updateTable("clinic_package").set({ notes: "changed by the test (fictional)" }).where("tenant_id", "=", probe).execute();
      const after = await clinicFingerprint(t.db, probe);
      assert.deepEqual((Object.keys(before) as Array<keyof typeof before>).filter((k) => before[k] !== after[k]), ["clinic_package"]);
      // Where the SQLite database underneath is at hand (node:sqlite, the D1 stand-in): a change during the run itself.
      const raw = t.sqlite;
      if (!raw) return;
      const slug = await clinic({ full: true });
      const dir = folder({ [discharge.fileName]: dischargeBytes });
      let armed = true;
      const cipher = new Proxy(ctx.cipher, {
        get(target, prop) {
          const value = Reflect.get(target, prop, target) as unknown;
          if (prop !== "encrypt" || typeof value !== "function") return typeof value === "function" ? value.bind(target) : value;
          return (plain: unknown, aad: { table?: string }) => {
            if (armed && aad?.table === "forms") {
              armed = false;
              raw.prepare("UPDATE clinic_plan SET trial_days = 30 WHERE tenant_id = ?").run(slug);
            }
            return (value as (p: unknown, a: unknown) => unknown).call(target, plain, aad);
          };
        },
      });
      const r = await loadClinicForms({ ...ctx, cipher }, { tenantId: slug, dir, maps: parseMapsJson(JSON.stringify(dischargeMap(accepted()))), confirm: true });
      assert.equal(armed, false, "the hook ran");
      assert.deepEqual(r.invariants, { ok: false, changed: ["clinic_plan"] });
    });

    it("activity labels: form.replace, clinic.forms_replaced and form.lint_accepted in plain words", () => {
      assert.equal(activityLabel("form.replace"), "Form replaced by an updated version from ClinForms");
      assert.equal(activityLabel("clinic.forms_replaced"), "Forms updated in the library by ClinForms");
      assert.equal(activityLabel("form.lint_accepted"), "Form question accepted as worded by a clinician");
      assert.equal(
        describeActivityDetail("form.lint_accepted", { rule: "L5", fieldId: "F-28", judgement: "fitness for work", reason: "The patient reports it." }),
        "Question F-28 asks for a clinical judgement (fitness for work) because: “The patient reports it.”",
      );
    });
  });
}

// This file's own runs (the D1 runs import defineLoadFormsBh2Suite from workers/data-gateway/test/load-forms-bh2.test.ts).
if (require.main === module) {
  defineLoadFormsBh2Suite("node:sqlite", async () => createSqliteTestDb());
  defineLoadFormsBh2Suite("PGlite (Postgres)", async () => createPgliteTestDb());
}
