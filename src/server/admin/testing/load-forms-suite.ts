/**
 * TESTS ONLY: admin:load-forms (10/2026, src/server/admin/load-forms.ts) – a clinic's own templates into its forms
 * library, encrypted for that clinic, every map a PROPOSAL – on every database: node:sqlite and PGlite
 * (src/server/admin/load-forms.test.ts) and D1 through the gateway (workers/data-gateway/test/admin-stack.test.ts).
 * Fictional templates only (scripts/medreport/fixtures/rtf, the bundled fictional sample forms).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { Kysely } from "kysely";
import { getSampleForm } from "../../../modules/medreport/forms/samples/registry";
import { HARROW_PIKE_FORM } from "../../../modules/medreport/forms/samples/maps/harrow-pike";
import type { FormDefinition } from "../../../modules/medreport/core/types";
import { PLATFORM_USER_ID } from "../../auth/create-auth";
import type { Database } from "../../db/schema";
import { testCipher } from "../../db/testing/databases";
import { listAudit } from "../../repos/audit";
import type { RepoContext } from "../../repos/context";
import { RepoInputError } from "../../repos/context";
import { getFormFile } from "../../repos/form-files";
import { listForms } from "../../repos/forms";
import { loadClinicForms, parseMapsJson } from "../load-forms";

export interface LoadFormsSuiteDb {
  db: Kysely<Database>;
  close: () => Promise<void>;
}

const CLINIC = "load-forms-test";
const OTHER = "load-forms-other";
const FIXTURES = path.join(process.cwd(), "scripts/medreport/fixtures/rtf");

export function defineLoadFormsSuite(label: string, factory: () => Promise<LoadFormsSuiteDb>, options: { skip?: string | false } = {}): void {
  describe(`admin:load-forms – ${label}`, { skip: options.skip }, () => {
    let t: LoadFormsSuiteDb;
    let ctx: RepoContext;
    let dir = "";
    const at = "2026-10-24T09:00:00.000Z";

    before(async () => {
      t = await factory();
      ctx = { db: t.db, cipher: testCipher(), now: () => new Date(at) };
      for (const slug of [CLINIC, OTHER]) {
        await t.db.insertInto("organization").values({ id: `org-${slug}`, name: `${slug} (fictional)`, slug, logo: null, createdAt: at, metadata: null }).execute();
      }
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "clinforms-load-forms-"));
      fs.copyFileSync(path.join(FIXTURES, "practice-codes-report.rtf"), path.join(dir, "Larkfield IA.rtf"));
      fs.copyFileSync(path.join(FIXTURES, "initial-assessment-report.rtf"), path.join(dir, "Larchfield IA.rtf"));
      const sample = getSampleForm("harrow-pike-treating-physio");
      assert.ok(sample);
      fs.writeFileSync(path.join(dir, "Harrow Pike.docx"), await sample.loadFile());
      fs.writeFileSync(path.join(dir, "Old template.doc"), Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]));
      fs.writeFileSync(path.join(dir, "notes.txt"), "not a form");
      // Security fix 24/10/2026: a symbolic link in the folder is never followed.
      fs.symlinkSync(path.join(FIXTURES, "initial-assessment-report.rtf"), path.join(dir, "Linked IA.rtf"));
    });
    after(async () => {
      fs.rmSync(dir, { recursive: true, force: true });
      await t?.close();
    });

    const harrowMap = () => ({
      "Harrow Pike.docx": { title: HARROW_PIKE_FORM.title, referrer: HARROW_PIKE_FORM.referrer, fields: HARROW_PIKE_FORM.fields, file: { sha256: HARROW_PIKE_FORM.file.sha256 } },
    });

    it("refuses an unknown or closed clinic, a maps file naming files that are not there, and bad JSON", async () => {
      await assert.rejects(loadClinicForms(ctx, { tenantId: "no-such-clinic", dir, maps: {} }), RepoInputError);
      await assert.rejects(loadClinicForms(ctx, { tenantId: CLINIC, dir, maps: parseMapsJson(JSON.stringify({ "Missing.rtf": { referrer: { name: "X (fictional)", type: "mlc" }, fields: [] } })) }), /not in the folder/);
      assert.throws(() => parseMapsJson("{"), RepoInputError);
      assert.throws(() => parseMapsJson(JSON.stringify({ "a.rtf": { fields: [] } })), /needs a referrer/);
      assert.deepEqual(Object.keys(parseMapsJson(JSON.stringify({ maps: [{ file: { fileName: "/x/Harrow Pike.docx" }, referrer: { name: "H (fictional)", type: "mlc" }, fields: [] }] }))), ["Harrow Pike.docx"]);
    });

    it("preview: every file checked and reported, nothing stored", async () => {
      const r = await loadClinicForms(ctx, { tenantId: CLINIC, dir, maps: parseMapsJson(JSON.stringify(harrowMap())), readMissing: true, defaultReferrer: { name: "Larkfield Rehabilitation Network (fictional)", type: "mlc" } });
      assert.equal(r.dryRun, true);
      const by = new Map(r.files.map((f) => [f.file, f] as const));
      assert.equal(by.get("Harrow Pike.docx")?.status, "ready");
      assert.equal(by.get("Harrow Pike.docx")?.mapFrom, "json");
      const codes = by.get("Larkfield IA.rtf");
      assert.equal(codes?.status, "ready");
      assert.equal(codes?.mapFrom, "reading");
      assert.equal(codes?.convertedFromRtf, true);
      assert.ok((codes?.fromRecords ?? 0) >= 20 && codes?.forStaff === 2 && codes?.mergeFields === 26, JSON.stringify(codes));
      assert.equal(by.get("Old template.doc")?.status, "refused");
      assert.match(by.get("Old template.doc")?.reason ?? "", /save it as a Word Document \(\.docx\) or Rich Text Format/);
      assert.equal(by.get("notes.txt")?.status, "skipped");
      assert.equal(by.get("Linked IA.rtf")?.status, "skipped", "a symbolic link is not followed");
      assert.match(by.get("Linked IA.rtf")?.reason ?? "", /symbolic link: not followed/);
      assert.equal((await listForms(ctx, CLINIC)).length, 0, "nothing stored");
      assert.equal((await listAudit(ctx, CLINIC)).length, 0, "nothing audited");
    });

    it("a map that does not fit its file is refused (another version, a place that is not there)", async () => {
      const wrongSha = { "Harrow Pike.docx": { ...harrowMap()["Harrow Pike.docx"], file: { sha256: "f".repeat(64) } } };
      const r1 = await loadClinicForms(ctx, { tenantId: CLINIC, dir, maps: parseMapsJson(JSON.stringify(wrongSha)) });
      assert.equal(r1.files.find((f) => f.file === "Harrow Pike.docx")?.status, "refused");
      assert.match(r1.files.find((f) => f.file === "Harrow Pike.docx")?.reason ?? "", /another version of this file/);
      const moved = HARROW_PIKE_FORM.fields.map((f, i) => (i === 0 && f.anchor.kind === "docx" ? { ...f, anchor: { ...f.anchor, blockId: "p999" } } : f));
      const r2 = await loadClinicForms(ctx, { tenantId: CLINIC, dir, maps: { "Harrow Pike.docx": { title: "H", referrer: HARROW_PIKE_FORM.referrer, fields: moved } } });
      assert.match(r2.files.find((f) => f.file === "Harrow Pike.docx")?.reason ?? "", /the place p999 is not in this file/);
      const notAField = await loadClinicForms(ctx, { tenantId: CLINIC, dir, maps: { "Harrow Pike.docx": { title: "H", referrer: HARROW_PIKE_FORM.referrer, fields: [{ id: "nope" }] } } });
      assert.equal(notAField.files.find((f) => f.file === "Harrow Pike.docx")?.status, "refused");
      // Files without a map and without --read-missing are skipped, never guessed.
      assert.equal(r1.files.find((f) => f.file === "Larkfield IA.rtf")?.status, "skipped");
    });

    it("confirm: files encrypted for this clinic only, maps PROPOSED with their merge codes, audited; a second run skips them", async () => {
      const r = await loadClinicForms(ctx, {
        tenantId: CLINIC,
        dir,
        maps: parseMapsJson(JSON.stringify(harrowMap())),
        readMissing: true,
        confirm: true,
        defaultReferrer: { name: "Larkfield Rehabilitation Network (fictional)", type: "mlc" },
      });
      assert.equal(r.dryRun, false);
      const loaded = r.files.filter((f) => f.status === "loaded");
      assert.equal(loaded.length, 3, JSON.stringify(r.files.map((f) => [f.file, f.status, f.reason])));
      const forms = await listForms<FormDefinition>(ctx, CLINIC);
      assert.equal(forms.length, 3);
      for (const f of forms) {
        assert.equal(f.status, "proposed");
        assert.equal(f.payload.status, "proposed");
        assert.equal(f.payload.confirmed, undefined, "never confirmed by the script");
        assert.equal(f.payload.tenantId, CLINIC);
        assert.ok(f.payload.analysis.warnings.some((w) => /Prepared by ClinForms/.test(w)));
        const file = await getFormFile(ctx, CLINIC, f.fileSha256);
        assert.ok(file, "the file is stored and decrypts");
        assert.equal(file.sha256, f.fileSha256);
        assert.equal(await getFormFile(ctx, OTHER, f.fileSha256), null, "and only for this clinic");
      }
      const codes = forms.find((f) => f.payload.file.fileName === "Larkfield IA.rtf");
      assert.equal(codes?.payload.analysis.mergeFields?.length, 26, "merge codes recorded: approval stays blocked while one is left");
      assert.ok(codes?.payload.fields.some((x) => x.fillSource.kind === "registration" && x.fillSource.path === "patient.firstName"));
      const harrow = forms.find((f) => f.payload.file.fileName === "Harrow Pike.docx");
      assert.equal(harrow?.payload.analysis.mode, "demo_prewritten");
      assert.equal(harrow?.payload.fields.length, HARROW_PIKE_FORM.fields.length);

      const audit = await listAudit(ctx, CLINIC);
      assert.equal(audit.filter((e) => e.action === "form.create").length, 3);
      assert.equal(audit.filter((e) => e.action === "file.upload").length, 3);
      assert.equal(audit.filter((e) => e.action === "clinic.forms_loaded").length, 1);
      assert.ok(audit.every((e) => e.userId === PLATFORM_USER_ID));

      const again = await loadClinicForms(ctx, { tenantId: CLINIC, dir, maps: parseMapsJson(JSON.stringify(harrowMap())), readMissing: true, confirm: true });
      assert.equal(again.files.filter((f) => f.status === "loaded").length, 0);
      assert.ok(again.files.filter((f) => f.status === "skipped").some((f) => /already in the clinic's forms library/.test(f.reason ?? "")));
      assert.equal((await listForms(ctx, CLINIC)).length, 3);
    });

    it("verify fix: a file that converts without a single question (a form kept in text boxes) is refused, never loaded", async () => {
      const own = fs.mkdtempSync(path.join(os.tmpdir(), "clinforms-load-forms-empty-"));
      try {
        // Fictional: the whole form sits in a drawn text box, which the RTF converter leaves out.
        fs.writeFileSync(path.join(own, "Text box form.rtf"), "{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}{\\shp{\\*\\shpinst{\\sp{\\sn shapeType}{\\sv 202}}{\\shptxt \\pard Name: <<P_SURNAME>>\\par}}}}");
        const r = await loadClinicForms(ctx, { tenantId: OTHER, dir: own, maps: {}, readMissing: true, confirm: true });
        assert.equal(r.files[0]?.status, "refused", JSON.stringify(r.files[0]));
        assert.match(r.files[0]?.reason ?? "", /No questions were found in this file/);
        assert.equal((await listForms(ctx, OTHER)).length, 0, "nothing stored");
      } finally {
        fs.rmSync(own, { recursive: true, force: true });
      }
    });
  });
}
