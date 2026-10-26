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
import type { SqliteDatabaseLike } from "../../db/dialects/sqlite-local";
import type { Database } from "../../db/schema";
import { testCipher } from "../../db/testing/databases";
import { appendAudit, listAudit, listAuditAbout } from "../../repos/audit";
import type { RepoContext } from "../../repos/context";
import { RepoInputError } from "../../repos/context";
import { getFormFile, listFormFiles, putFormFile } from "../../repos/form-files";
import { MAX_REPLACED_FORMS, createForm, deleteForm, getForm, listFormMeta, listForms, replaceForms, updateForm } from "../../repos/forms";
import { createReport } from "../../repos/reports";
import { putTenantSettings } from "../../repos/tenant-settings";
import { loadClinicForms, parseMapsJson } from "../load-forms";

export interface LoadFormsSuiteDb {
  db: Kysely<Database>;
  close: () => Promise<void>;
  /**
   * The SQLite database underneath, when there is one in this process (node:sqlite, the D1 stand-in): the hook cases
   * use it to change the clinic's data between a replace's plan and its batch, as the Studio or a second run would.
   */
  sqlite?: SqliteDatabaseLike;
}

const CLINIC = "load-forms-test";
const OTHER = "load-forms-other";
/** --replace-proposed (10/2026): its own clinics, so the earlier cases' library stays as it is. */
const RCLINIC = "load-forms-replace";
const ROTHER = "load-forms-replace-other";
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
      for (const slug of [CLINIC, OTHER, RCLINIC, ROTHER]) {
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

    describe("--replace-proposed (10/2026): corrected maps and conversions replace forms nobody has confirmed or used", () => {
      const X = { name: "Larkfield Rehabilitation Network (fictional)", type: "mlc" as const };
      const Y = { name: "Orchard Case Management (fictional)", type: "case_manager" as const };
      /** One file per state the replace rule has to respect (A = still a plain proposal). */
      const STATES = ["A", "B", "C", "D", "E", "F", "G"] as const;
      let root = "";
      const v1 = () => path.join(root, "v1");
      const v1Other = () => path.join(root, "v1-other");
      const v2 = () => path.join(root, "v2");
      /** A fictional RTF template; each variant differs by one closing line (another conversion of "the same" form). */
      const variant = (tag: string) => {
        const rtf = fs.readFileSync(path.join(FIXTURES, "practice-codes-report.rtf"), "utf8");
        return rtf.replace(/\}\s*$/, `\\pard\\plain\\f0\\fs20 Template ${tag} (fictional)\\par\n}`);
      };
      const harrowV1 = () => ({
        "Harrow Pike.docx": { title: HARROW_PIKE_FORM.title, referrer: HARROW_PIKE_FORM.referrer, fields: HARROW_PIKE_FORM.fields, file: { sha256: HARROW_PIKE_FORM.file.sha256 } },
      });
      /** The corrected map: one question's staff guidance reworded (the wording here is the test's own, fictional). */
      const CLEAN_GUIDANCE = "Reworded staff guidance for the replace test (fictional).";
      const harrowV2 = () => ({
        "Harrow Pike.docx": { ...harrowV1()["Harrow Pike.docx"], fields: HARROW_PIKE_FORM.fields.map((f, i) => (i === 0 ? { ...f, guidance: CLEAN_GUIDANCE } : f)) },
      });
      const run = (tenantId: string, d: string, maps: Record<string, unknown>, opts: { confirm?: boolean; referrer?: typeof X } = {}) =>
        loadClinicForms(ctx, { tenantId, dir: d, maps: parseMapsJson(JSON.stringify(maps)), readMissing: true, defaultReferrer: opts.referrer ?? X, replaceProposed: true, confirm: opts.confirm });
      /** Everything replace mode may touch: the forms (id, revision, file, status, map) and the stored files. */
      const snapshot = async (tenantId: string) => ({
        forms: (await listForms<FormDefinition>(ctx, tenantId))
          .map((f) => ({ id: f.id, rev: f.rev, sha: f.fileSha256, status: f.status, payload: JSON.stringify(f.payload) }))
          .sort((a, b) => a.id.localeCompare(b.id)),
        files: (await listFormFiles(ctx, tenantId)).map((f) => f.sha256).sort(),
      });
      const byName = async (tenantId: string) => {
        const out = new Map<string, { id: string; rev: number; sha: string; form: FormDefinition }[]>();
        for (const f of await listForms<FormDefinition>(ctx, tenantId)) {
          const list = out.get(f.payload.file.fileName) ?? [];
          list.push({ id: f.id, rev: f.rev, sha: f.fileSha256, form: f.payload });
          out.set(f.payload.file.fileName, list);
        }
        return out;
      };
      const one = async (tenantId: string, name: string) => {
        const list = (await byName(tenantId)).get(name) ?? [];
        assert.equal(list.length, 1, `exactly one form for ${name}`);
        return list[0];
      };
      let initial: Awaited<ReturnType<typeof snapshot>>;
      let beforeOther: Awaited<ReturnType<typeof snapshot>>;
      let oldIds: Map<string, string>;

      before(async () => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "clinforms-load-forms-replace-"));
        for (const d of [v1(), v1Other(), v2()]) fs.mkdirSync(d);
        const sample = getSampleForm("harrow-pike-treating-physio");
        assert.ok(sample);
        const docx = await sample.loadFile();
        for (const tag of STATES) {
          fs.writeFileSync(path.join(v1(), `${tag}.rtf`), variant(`${tag} v1`));
          fs.writeFileSync(path.join(v2(), `${tag}.rtf`), variant(`${tag} v2`));
        }
        fs.writeFileSync(path.join(v1(), "Harrow Pike.docx"), docx);
        fs.writeFileSync(path.join(v2(), "Harrow Pike.docx"), docx); // the same bytes: a corrected map only
        fs.writeFileSync(path.join(v1Other(), "Other ref.rtf"), variant("Other v1"));
        fs.writeFileSync(path.join(v2(), "Other ref.rtf"), variant("Other v2"));
        fs.writeFileSync(path.join(v2(), "Studio.rtf"), variant("Studio v2"));

        // The earlier load (normal mode), in both clinics; "Other ref.rtf" for another referrer.
        for (const tenantId of [RCLINIC, ROTHER]) {
          const r = await loadClinicForms(ctx, { tenantId, dir: v1(), maps: parseMapsJson(JSON.stringify(harrowV1())), readMissing: true, defaultReferrer: X, confirm: true });
          assert.equal(r.files.filter((f) => f.status === "loaded").length, 8, JSON.stringify(r.files.map((f) => [f.file, f.status, f.reason])));
        }
        const other = await loadClinicForms(ctx, { tenantId: RCLINIC, dir: v1Other(), maps: {}, readMissing: true, defaultReferrer: Y, confirm: true });
        assert.equal(other.files[0]?.status, "loaded");

        // What the clinic did since (fictional, as the Studio and the Report API would record it).
        const forms = await byName(RCLINIC);
        oldIds = new Map(Array.from(forms.entries()).map(([name, list]) => [name, list[0].id] as const));
        const get = (name: string) => (forms.get(name) ?? [])[0];
        const member = "user-fictional-clinician";
        const b = get("B.rtf"); // confirmed
        const confirmed = await updateForm(
          ctx,
          RCLINIC,
          { id: b.id, fileSha256: b.sha, status: "confirmed", title: b.form.title, referrer: b.form.referrer.name, kind: b.form.kind, payload: { ...b.form, status: "confirmed", confirmed: { by: "Sarah Reid (fictional)", at } } },
          b.rev,
        );
        assert.ok(confirmed.ok);
        await appendAudit(ctx, RCLINIC, { userId: member, action: "form.confirm", targetType: "form", targetId: b.id, detail: { kind: "docx", fields: b.form.fields.length } });
        const c = get("C.rtf"); // a draft report completes it
        assert.ok((await createReport(ctx, RCLINIC, { id: "rpt_replace_c", status: "draft", formId: c.id, templateId: `form:${c.id}`, payload: { fictional: true } })).ok);
        const d = get("D.rtf"); // a report approved with it, since deleted: only the activity log remembers
        await appendAudit(ctx, RCLINIC, { userId: member, action: "report.sign", targetType: "report", targetId: "rpt_replace_d", detail: { formId: d.id, receiptMac: "fictional" } });
        const e = get("E.rtf"); // its map edited and saved in the Studio (still a proposal)
        const edited = await updateForm(ctx, RCLINIC, { id: e.id, fileSha256: e.sha, status: "proposed", title: e.form.title, referrer: e.form.referrer.name, kind: e.form.kind, payload: e.form }, e.rev);
        assert.ok(edited.ok);
        await appendAudit(ctx, RCLINIC, { userId: member, action: "form.update", targetType: "form", targetId: e.id, detail: { rev: 2, status: "proposed" } });
        await putTenantSettings(ctx, RCLINIC, { "larkfield-fictional": get("F.rtf").id }); // F: linked to a referrer
        const g = get("G.rtf"); // confirmed once, then turned back into a proposal (revision and status as loaded)
        await appendAudit(ctx, RCLINIC, { userId: member, action: "form.confirm", targetType: "form", targetId: g.id, detail: { kind: "docx", fields: g.form.fields.length } });
        // A form the clinic added itself in the Studio, from a file of the same name as one in the folder.
        const studio = { ...get("A.rtf").form, id: "frm_studio_fictional", file: { ...get("A.rtf").form.file, fileName: "Studio.rtf", sha256: "e".repeat(64) } };
        assert.ok((await createForm(ctx, RCLINIC, { id: studio.id, fileSha256: "e".repeat(64), status: "proposed", title: studio.title, referrer: studio.referrer.name, kind: studio.kind, payload: studio })).ok);
        oldIds.set("Studio.rtf", studio.id);

        initial = await snapshot(RCLINIC);
        beforeOther = await snapshot(ROTHER);
      });
      after(() => {
        if (root) fs.rmSync(root, { recursive: true, force: true });
      });

      const expectRefused = (files: { file: string; status: string; reason?: string }[]) => {
        const reason = (name: string) => files.find((f) => f.file === name)?.reason ?? "";
        const status = (name: string) => files.find((f) => f.file === name)?.status;
        for (const name of ["B.rtf", "C.rtf", "D.rtf", "E.rtf", "F.rtf", "G.rtf", "Studio.rtf", "Other ref.rtf"]) assert.equal(status(name), "refused", `${name}: ${reason(name)}`);
        assert.match(reason("B.rtf"), /has been confirmed by the clinic: it is kept as it is/);
        assert.match(reason("C.rtf"), /is used by 1 report \(draft or approved\)/);
        assert.match(reason("D.rtf"), /has been used for a report \(activity log\)/);
        assert.match(reason("E.rtf"), /changed in the clinic's Studio after it was loaded \(revision 2\)/);
        assert.match(reason("F.rtf"), /linked to a referrer in the clinic's settings/);
        assert.match(reason("G.rtf"), /was confirmed once \(activity log\)/);
        assert.match(reason("Studio.rtf"), /added in the clinic's Studio, not loaded by ClinForms/);
        assert.match(reason("Other ref.rtf"), /loaded from a file of this name for another referrer: nothing is replaced/);
        for (const name of ["B.rtf", "C.rtf", "D.rtf", "E.rtf", "F.rtf", "G.rtf", "Studio.rtf"]) assert.ok(reason(name).includes(oldIds.get(name) ?? "?"), `${name} names the form it keeps`);
      };

      it("dry run: REPLACE / LOAD / SKIP / REFUSED per file, nothing changed or audited", async () => {
        const audit = (await listAudit(ctx, RCLINIC, { limit: 500 })).length;
        const r = await run(RCLINIC, v2(), harrowV2());
        assert.equal(r.dryRun, true);
        assert.equal(r.replaceProposed, true);
        const by = new Map(r.files.map((f) => [f.file, f] as const));
        assert.equal(by.get("A.rtf")?.status, "replace");
        assert.deepEqual(by.get("A.rtf")?.replaces, [oldIds.get("A.rtf")]);
        assert.equal(by.get("Harrow Pike.docx")?.status, "replace", "identical bytes, corrected map");
        assert.deepEqual(by.get("Harrow Pike.docx")?.replaces, [oldIds.get("Harrow Pike.docx")]);
        expectRefused(r.files);
        // A clinic without these forms: every file would be loaded.
        const fresh = await run(ROTHER, v1Other(), {});
        assert.equal(fresh.files[0]?.status, "ready");
        assert.deepEqual(await snapshot(RCLINIC), initial, "nothing changed");
        assert.deepEqual(await snapshot(ROTHER), beforeOther);
        assert.equal((await listAudit(ctx, RCLINIC, { limit: 500 })).length, audit, "nothing audited");
      });

      it("confirm: one form per template, the new map as a fresh proposal, the old file gone once unused; refused forms and another clinic untouched; audited", async () => {
        const auditBefore = new Set((await listAudit(ctx, RCLINIC, { limit: 500 })).map((e) => e.id));
        const r = await run(RCLINIC, v2(), harrowV2(), { confirm: true });
        const by = new Map(r.files.map((f) => [f.file, f] as const));
        assert.equal(by.get("A.rtf")?.status, "replaced", JSON.stringify(by.get("A.rtf")));
        assert.equal(by.get("Harrow Pike.docx")?.status, "replaced");
        expectRefused(r.files);

        const library = await byName(RCLINIC);
        for (const [name, list] of Array.from(library.entries())) assert.equal(list.length, 1, `one form for ${name}`);
        const a = await one(RCLINIC, "A.rtf");
        const oldA = initial.forms.find((f) => f.id === oldIds.get("A.rtf"));
        assert.ok(oldA);
        assert.notEqual(a.id, oldA.id, "a fresh proposal");
        assert.equal(a.id, by.get("A.rtf")?.formId);
        assert.equal(a.rev, 1);
        assert.equal(a.form.status, "proposed");
        assert.equal(a.form.confirmed, undefined);
        assert.notEqual(a.sha, oldA.sha, "the new conversion");
        assert.ok(await getFormFile(ctx, RCLINIC, a.sha), "new file stored");
        assert.equal(await getFormFile(ctx, RCLINIC, oldA.sha), null, "old file deleted: no form uses it any more");
        assert.equal((await getForm(ctx, RCLINIC, oldA.id)), null, "old form deleted");
        const harrow = await one(RCLINIC, "Harrow Pike.docx");
        assert.notEqual(harrow.id, oldIds.get("Harrow Pike.docx"));
        assert.equal(harrow.form.fields[0]?.guidance, CLEAN_GUIDANCE, "the corrected map");
        assert.equal(harrow.sha, HARROW_PIKE_FORM.file.sha256);
        assert.ok(await getFormFile(ctx, RCLINIC, harrow.sha), "the same file is kept (the new form uses it)");
        assert.ok(harrow.form.analysis.warnings.some((w) => /Prepared by ClinForms/.test(w)));

        // Refused: exactly as they were.
        const now = await snapshot(RCLINIC);
        for (const name of ["B.rtf", "C.rtf", "D.rtf", "E.rtf", "F.rtf", "G.rtf", "Studio.rtf", "Other ref.rtf"]) {
          const id = oldIds.get(name);
          assert.deepEqual(now.forms.find((f) => f.id === id), initial.forms.find((f) => f.id === id), name);
        }
        assert.deepEqual(await snapshot(ROTHER), beforeOther, "another clinic's forms and files: untouched");

        const added = (await listAudit(ctx, RCLINIC, { limit: 500 })).filter((e) => !auditBefore.has(e.id));
        assert.ok(added.every((e) => e.userId === PLATFORM_USER_ID));
        const replacedRows = added.filter((e) => e.action === "form.replace");
        assert.deepEqual(replacedRows.map((e) => e.targetId).sort(), [a.id, harrow.id].sort());
        assert.deepEqual(replacedRows.find((e) => e.targetId === a.id)?.detail, { via: "onboarding", status: "proposed", replaces: [oldA.id], fields: a.form.fields.length, kind: a.form.kind, mapFrom: "reading" });
        assert.deepEqual(replacedRows.find((e) => e.targetId === harrow.id)?.detail?.mapFrom, "json");
        const run1 = added.filter((e) => e.action === "clinic.forms_replaced");
        assert.equal(run1.length, 1);
        assert.deepEqual(run1[0]?.detail, { replaced: 2, forms: 0, refused: 8, skipped: 0 });
        assert.equal(added.filter((e) => e.action === "file.upload").length, 1, "only A's new file was written");
        assert.equal(added.filter((e) => e.action === "form.create" || e.action === "form.delete").length, 0);
        for (const e of added) assert.ok(!JSON.stringify(e.detail).includes(CLEAN_GUIDANCE) && !JSON.stringify(e.detail).includes("fictional)"), "ids and counts only");
      });

      it("a re-run changes nothing (skipped: already this file and map), refusals stay; the same in preview", async () => {
        const state = await snapshot(RCLINIC);
        const audit = (await listAudit(ctx, RCLINIC, { limit: 500 })).length;
        for (const confirm of [false, true]) {
          const r = await run(RCLINIC, v2(), harrowV2(), { confirm });
          const by = new Map(r.files.map((f) => [f.file, f] as const));
          for (const name of ["A.rtf", "Harrow Pike.docx"]) {
            assert.equal(by.get(name)?.status, "skipped", `${name}: ${by.get(name)?.reason}`);
            assert.match(by.get(name)?.reason ?? "", /already has this file and this map/);
          }
          expectRefused(r.files);
        }
        assert.deepEqual(await snapshot(RCLINIC), state);
        assert.equal((await listAudit(ctx, RCLINIC, { limit: 500 })).length, audit, "no audit rows");
      });

      it("review fix: a reading (--read-missing, no map in the maps file) never replaces a form made from a map", async () => {
        const state = await snapshot(RCLINIC);
        const audit = (await listAudit(ctx, RCLINIC, { limit: 500 })).length;
        for (const confirm of [false, true]) {
          const r = await run(RCLINIC, v2(), {}, { confirm });
          const harrow = r.files.find((f) => f.file === "Harrow Pike.docx");
          assert.equal(harrow?.status, "skipped", JSON.stringify(harrow));
          assert.equal(harrow?.mapFrom, "reading");
          assert.match(harrow?.reason ?? "", /^No map for this file in the maps file: the form frm_\S+ in the library was made from a map, which a layout reading never replaces/);
          // Forms made by the reading are still compared with a new reading: unchanged, so skipped.
          assert.match(r.files.find((f) => f.file === "A.rtf")?.reason ?? "", /already has this file and this map/);
        }
        assert.deepEqual(await snapshot(RCLINIC), state);
        assert.equal((await listAudit(ctx, RCLINIC, { limit: 500 })).length, audit);
      });

      /** The audit rows targeting or naming any of these ids (what replaceForms' auditRowsAbout counts). */
      const auditAbout = async (tenantId: string, ids: string[]) => new Set((await Promise.all(ids.map((id) => listAuditAbout(ctx, tenantId, id, { limit: 500 })))).flat().map((e) => e.id)).size;
      const formRow = (id: string, form: FormDefinition, sha = form.file.sha256) => ({ id, fileSha256: sha, status: "proposed", title: form.title, referrer: form.referrer.name, kind: form.kind, payload: { ...form, id } });

      it("replaceForms is all or nothing: a form changed or used meanwhile leaves the library exactly as it was", async () => {
        const a = await one(RCLINIC, "A.rtf");
        const c = await one(RCLINIC, "C.rtf");
        const state = await snapshot(RCLINIC);
        const audit = (await listAudit(ctx, RCLINIC, { limit: 500 })).length;
        const rows = await auditAbout(RCLINIC, [a.id]);
        // A stale revision (the clinic saved it meanwhile).
        const stale = await replaceForms(ctx, RCLINIC, { replace: [{ id: a.id, rev: 2, status: "proposed" }], auditRowsAbout: rows, form: formRow("frm_race_1", a.form), dropUnusedFiles: [a.sha] });
        assert.deepEqual(stale, { ok: false, reason: "changed" });
        // A report started on one of two forms: neither goes.
        const used = await replaceForms(ctx, RCLINIC, {
          replace: [
            { id: a.id, rev: 1, status: "proposed" },
            { id: c.id, rev: 1, status: "proposed" },
          ],
          auditRowsAbout: await auditAbout(RCLINIC, [a.id, c.id]),
          form: formRow("frm_race_2", a.form),
          dropUnusedFiles: [a.sha, c.sha],
        });
        assert.deepEqual(used, { ok: false, reason: "changed" });
        assert.deepEqual(await snapshot(RCLINIC), state, "nothing changed, no stray form or file");
        assert.equal((await listAudit(ctx, RCLINIC, { limit: 500 })).length, audit, "no audit row");
        await assert.rejects(replaceForms(ctx, RCLINIC, { replace: [], auditRowsAbout: 0, form: formRow("frm_race_3", a.form) }), RepoInputError);
        await assert.rejects(replaceForms(ctx, RCLINIC, { replace: [{ id: a.id, rev: 1, status: "proposed" }], auditRowsAbout: rows, form: formRow(a.id, a.form) }), RepoInputError);
        await assert.rejects(replaceForms(ctx, RCLINIC, { replace: [{ id: a.id, rev: 1, status: "proposed" }], auditRowsAbout: -1, form: formRow("frm_race_3", a.form) }), RepoInputError);
        // Review fix: forms that are not there (another clinic's id, or removed meanwhile) are never "replaced" – the
        // new form is not stored either.
        const elsewhere = await replaceForms(ctx, ROTHER, { replace: [{ id: a.id, rev: 1, status: "proposed" }], auditRowsAbout: 0, form: formRow("frm_race_4", a.form), dropUnusedFiles: [a.sha] });
        assert.deepEqual(elsewhere, { ok: false, reason: "changed" });
        assert.deepEqual(await snapshot(RCLINIC), state);
        assert.deepEqual(await snapshot(ROTHER), beforeOther, "nothing stored in the other clinic");
      });

      describe("review fixes (10/2026): every rule re-checked in the batch, one file per template, concurrent runs", () => {
        let n = 0;
        /** A new fictional clinic of its own. */
        const clinic = async () => {
          const slug = `load-forms-fix-${++n}`;
          await t.db.insertInto("organization").values({ id: `org-${slug}`, name: `${slug} (fictional)`, slug, logo: null, createdAt: at, metadata: null }).execute();
          return slug;
        };
        /** A folder of its own with these files (contents: a variant tag, or the bytes themselves). */
        const folder = (files: Record<string, string | Buffer>) => {
          const d = fs.mkdtempSync(path.join(root, "f-"));
          for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(d, name), typeof content === "string" ? variant(content) : content);
          return d;
        };
        const load = async (tenantId: string, d: string) => {
          const r = await loadClinicForms(ctx, { tenantId, dir: d, maps: {}, readMissing: true, defaultReferrer: X, confirm: true });
          assert.ok(r.files.every((f) => f.status === "loaded"), JSON.stringify(r.files.map((f) => [f.file, f.status, f.reason])));
          return r;
        };
        const replaceRun = (tenantId: string, d: string, confirm: boolean, c: RepoContext = ctx) =>
          loadClinicForms(c, { tenantId, dir: d, maps: {}, readMissing: true, defaultReferrer: X, replaceProposed: true, confirm });
        const statuses = (r: Awaited<ReturnType<typeof replaceRun>>) => Object.fromEntries(r.files.map((f) => [f.file, f.status]));
        const reasonOf = (r: Awaited<ReturnType<typeof replaceRun>>, file: string) => r.files.find((f) => f.file === file)?.reason ?? "";
        /** Stored files no form refers to (expected: none). */
        const orphans = async (tenantId: string) => {
          const used = new Set((await listFormMeta(ctx, tenantId)).map((m) => m.fileSha256));
          return (await listFormFiles(ctx, tenantId)).filter((f) => !used.has(f.sha256)).length;
        };
        const auditCount = async (tenantId: string, action?: string) => (await listAudit(ctx, tenantId, { limit: 500 })).filter((e) => !action || e.action === action).length;

        it("R-safety-1: two runs at the same time – one replaces, the other changes nothing (never two forms, never a false audit row)", async () => {
          for (const [first, second] of [
            ["T v2", "T v2"], // the same folder twice (two terminals)
            ["T v2", "T v3"], // two conversions at once (two workstreams)
          ]) {
            const slug = await clinic();
            await load(slug, folder({ "T.rtf": "T v1" }));
            const [d1, d2] = [folder({ "T.rtf": first }), folder({ "T.rtf": second })];
            const [r1, r2] = await Promise.all([replaceRun(slug, d1, true), replaceRun(slug, d2, true)]);
            const all = [r1.files[0], r2.files[0]];
            assert.ok(all.every((f) => ["replaced", "refused", "skipped"].includes(f.status)), JSON.stringify(all));
            const replacedCount = all.filter((f) => f.status === "replaced").length;
            assert.ok(replacedCount >= 1, JSON.stringify(all));
            for (const f of all) if (f.status === "refused") assert.match(f.reason ?? "", /changed while it was being replaced|was replaced meanwhile by frm_\S+ \(another run\)/);
            const forms = await listForms<FormDefinition>(ctx, slug);
            assert.equal(forms.length, 1, `one form for the template: ${JSON.stringify(all)}`);
            assert.equal(await auditCount(slug, "form.replace"), replacedCount, "a form.replace row per real replace only");
            assert.equal(await orphans(slug), 0, "no stored file without a form");
            assert.ok(await getFormFile(ctx, slug, forms[0].fileSha256), "the form's file is stored and decrypts");
            // The run whose form is in the library now: its folder is a SKIP on the next preview.
            const winner = all.find((f) => f.formId === forms[0].id);
            assert.ok(winner, "the remaining form is the one a run reported as replaced");
            const again = await replaceRun(slug, winner === r1.files[0] ? d1 : d2, false);
            assert.equal(again.files[0]?.status, "skipped", JSON.stringify(again.files[0]));
          }
        });

        it("R-correctness-1/-9: one file per template – same bytes, same name, or a form an earlier file matched – the same in the preview and with --confirm; a LOAD with replaces", async () => {
          const slug = await clinic();
          await load(slug, folder({ "A.rtf": "A v1", "M.rtf": "M v1" }));
          const before = await byName(slug);
          // B.rtf: A's new bytes again. Z.rtf: A's OLD bytes (matches the form A.rtf replaces). New.rtf: a new template.
          const d = folder({ "A.rtf": "A v2", "B.rtf": "A v2", "Z.rtf": "A v1", "New.rtf": "New v1" });
          const expected = { "A.rtf": "replace", "B.rtf": "refused", "Z.rtf": "refused", "New.rtf": "ready" };
          const preview = await replaceRun(slug, d, false);
          assert.deepEqual(statuses(preview), expected);
          assert.match(reasonOf(preview, "B.rtf"), /^A\.rtf in this folder has the same bytes: one file per template/);
          assert.match(reasonOf(preview, "Z.rtf"), new RegExp(`^The form ${before.get("A.rtf")?.[0]?.id} in the library is already matched by A\\.rtf in this folder`));
          const confirm = await replaceRun(slug, d, true);
          assert.deepEqual(statuses(confirm), { ...expected, "A.rtf": "replaced", "New.rtf": "loaded" }, "the preview showed exactly this");
          const after = await byName(slug);
          assert.deepEqual(Array.from(after.keys()).sort(), ["A.rtf", "M.rtf", "New.rtf"]);
          for (const list of Array.from(after.values())) assert.equal(list.length, 1);
          assert.equal(after.get("M.rtf")?.[0]?.id, before.get("M.rtf")?.[0]?.id, "the other template untouched");
          const rows = (await listAudit(ctx, slug, { limit: 500 })).filter((e) => e.action === "clinic.forms_replaced");
          assert.deepEqual(rows[0]?.detail, { replaced: 1, forms: 1, refused: 2, skipped: 0 });
          assert.equal(await auditCount(slug, "form.create"), 3, "two from the first load, one LOADED now");
          assert.equal(await orphans(slug), 0);
          // Two names that differ only in case (a case-sensitive disk only; macOS keeps one of them).
          const d2 = folder({ "q.rtf": "Q v1", "Q.rtf": "Q v2" });
          if (fs.readdirSync(d2).length === 2) {
            const r = await replaceRun(slug, d2, false);
            assert.match(reasonOf(r, "q.rtf"), /^Q\.rtf in this folder has the same name \(case and accents aside\)/);
          }
        });

        it("R-correctness-9: names match apart from case and Unicode form; a renamed file matches by its bytes; new name and new bytes = a new template; same bytes for another referrer is the same template", async () => {
          const slug = await clinic();
          const nfd = "Cafe\u0301 IA.rtf";
          await load(slug, folder({ [nfd]: "Cafe v1", "R1.rtf": "R1 v1", "R2.rtf": "R2 v1" }));
          const own = fs.mkdtempSync(path.join(root, "y-"));
          fs.writeFileSync(path.join(own, "S.rtf"), variant("S v1"));
          assert.equal((await loadClinicForms(ctx, { tenantId: slug, dir: own, maps: {}, readMissing: true, defaultReferrer: Y, confirm: true })).files[0]?.status, "loaded");
          const ids = new Map(Array.from((await byName(slug)).entries()).map(([k, v]) => [k.normalize("NFC"), v[0].id] as const));
          const d = folder({ "CAFÉ ia.rtf": "Cafe v2", "R1 renamed.rtf": "R1 v1", "R2 renamed.rtf": "R2 v2", "S for X.rtf": "S v1" });
          for (const confirm of [false, true]) {
            const r = await replaceRun(slug, d, confirm);
            const st = (f: string) => r.files.find((x) => x.file === f);
            assert.equal(st("CAFÉ ia.rtf")?.status, confirm ? "replaced" : "replace", JSON.stringify(st("CAFÉ ia.rtf")));
            assert.deepEqual(st("CAFÉ ia.rtf")?.replaces, [ids.get("Café IA.rtf")]);
            assert.deepEqual(st("R1 renamed.rtf")?.replaces, [ids.get("R1.rtf")], "same bytes, new name: the same template");
            assert.equal(st("R2 renamed.rtf")?.status, confirm ? "loaded" : "ready", "new name and new bytes: a new template");
            assert.deepEqual(st("S for X.rtf")?.replaces, [ids.get("S.rtf")], "same bytes for another referrer: the same template");
          }
          const after = await byName(slug);
          assert.equal(after.get("S for X.rtf")?.[0]?.form.referrer.name, X.name, "the map's referrer is the new one");
          assert.ok(!after.has("R1.rtf") && after.has("R2.rtf") && after.has("R2 renamed.rtf"));
        });

        it("R-correctness-9: a form.store_confirmed row alone, or a report naming the form only by template_id, keeps the form", async () => {
          const slug = await clinic();
          await load(slug, folder({ "P.rtf": "P v1", "Q.rtf": "Q v1" }));
          const forms = await byName(slug);
          const p = forms.get("P.rtf")?.[0];
          const q = forms.get("Q.rtf")?.[0];
          assert.ok(p && q);
          await appendAudit(ctx, slug, { userId: "user-fictional", action: "form.store_confirmed", targetType: "form", targetId: p.id, detail: { rev: 1, status: "proposed" } });
          assert.ok((await createReport(ctx, slug, { id: "rpt_template_only", status: "draft", templateId: `form:${q.id}`, payload: { fictional: true } })).ok);
          const state = await snapshot(slug);
          const r = await replaceRun(slug, folder({ "P.rtf": "P v2", "Q.rtf": "Q v2" }), true);
          assert.deepEqual(statuses(r), { "P.rtf": "refused", "Q.rtf": "refused" });
          assert.match(reasonOf(r, "P.rtf"), /was confirmed once \(activity log\)/);
          assert.match(reasonOf(r, "Q.rtf"), /is used by 1 report \(draft or approved\)/);
          assert.deepEqual(await snapshot(slug), state);
        });

        it("R-safety-2: a form the run cannot read (another data key) refuses the whole run before anything is done", async () => {
          const slug = await clinic();
          await load(slug, folder({ "U.rtf": "U v1" }));
          const state = await snapshot(slug);
          const audit = await auditCount(slug);
          const otherKeys: RepoContext = { ...ctx, cipher: testCipher() };
          for (const confirm of [false, true]) {
            await assert.rejects(replaceRun(slug, folder({ "U.rtf": "U v2" }), confirm, otherKeys), (err: unknown) => {
              assert.ok(err instanceof RepoInputError);
              assert.match(err.message, /^1 form in the clinic's library cannot be read with this database's data keys \(frm_\S+\): .*nothing was changed\.$/);
              return true;
            });
          }
          assert.deepEqual(await snapshot(slug), state);
          assert.equal(await auditCount(slug), audit);
        });

        it(`R-safety-5/R-correctness-5: replaceForms takes up to ${MAX_REPLACED_FORMS} forms in one batch (inside D1's 100 parameters); more are refused before anything is stored`, async () => {
          const slug = await clinic();
          await load(slug, folder({ "Cap.rtf": "Cap v1" }));
          const base = (await one(slug, "Cap.rtf")).form;
          const ids: string[] = [];
          for (let i = 0; i < MAX_REPLACED_FORMS; i++) {
            const id = `frm_cap_${i}`;
            assert.ok((await createForm(ctx, slug, formRow(id, { ...base, id }, base.file.sha256))).ok);
            ids.push(id);
          }
          // The loader refuses a file matching more than the cap (here: the loaded form and the ten copies) – no file stored.
          const files = (await listFormFiles(ctx, slug)).length;
          const r = await replaceRun(slug, folder({ "Cap.rtf": "Cap v2" }), true);
          assert.equal(r.files[0]?.status, "refused");
          assert.match(r.files[0]?.reason ?? "", new RegExp(`^${MAX_REPLACED_FORMS + 1} forms in the library match this file \\(at most ${MAX_REPLACED_FORMS}`));
          assert.equal((await listFormFiles(ctx, slug)).length, files, "nothing stored");
          await assert.rejects(
            replaceForms(ctx, slug, { replace: [...ids, "frm_cap_x"].map((id) => ({ id, rev: 1, status: "proposed" })), auditRowsAbout: 0, form: formRow("frm_cap_new", base) }),
            RepoInputError,
          );
          // Exactly the cap, in one batch – on D1 too.
          const swapped = await replaceForms(ctx, slug, {
            replace: ids.map((id) => ({ id, rev: 1, status: "proposed" })),
            auditRowsAbout: await auditAbout(slug, ids),
            form: formRow("frm_cap_new", base),
            dropUnusedFiles: [base.file.sha256],
            audit: [{ userId: PLATFORM_USER_ID, action: "form.replace", targetType: "form", targetId: "frm_cap_new", detail: { via: "onboarding", replaces: ids } }],
          });
          assert.equal(swapped.ok, true, JSON.stringify(swapped));
          assert.equal(swapped.ok && swapped.removed, MAX_REPLACED_FORMS);
          assert.equal(swapped.ok && swapped.filesDeleted, 0, "the loaded form still uses the file");
          assert.deepEqual((await listFormMeta(ctx, slug)).map((m) => m.id).sort(), [(await byName(slug)).get("Cap.rtf")?.find((f) => !f.id.startsWith("frm_cap"))?.id, "frm_cap_new"].sort());
          assert.equal((await listAudit(ctx, slug, { limit: 500 })).filter((e) => e.targetId === "frm_cap_new").length, 1, "its audit row, in the same batch");
        });

        it("R-safety-1/R-correctness-7: replaceForms re-checks in the batch – a report by template_id, a referrer link, a new audit row, the new file gone, the old form gone", async () => {
          const slug = await clinic();
          await load(slug, folder({ "G.rtf": "G v1" }));
          const g = await one(slug, "G.rtf");
          const file = await putFormFile(ctx, slug, { bytes: Buffer.from("fictional replacement file"), fileName: "form.docx", mimeType: "application/octet-stream" });
          const attempt = async (formId: string, sha = file.sha256, rows?: number) =>
            replaceForms(ctx, slug, {
              replace: [{ id: g.id, rev: 1, status: "proposed" }],
              auditRowsAbout: rows ?? (await auditAbout(slug, [g.id])),
              form: formRow(formId, g.form, sha),
              dropUnusedFiles: [g.sha],
              audit: [{ userId: PLATFORM_USER_ID, action: "form.replace", targetType: "form", targetId: formId, detail: { via: "onboarding", replaces: [g.id] } }],
            });
          const state = await snapshot(slug);
          const audit = await auditCount(slug);
          const unchanged = async (why: string) => {
            assert.deepEqual(await snapshot(slug), state, why);
            assert.equal(await auditCount(slug), audit, `${why}: no audit row`);
          };
          assert.deepEqual(await attempt("frm_guard_1", "a".repeat(64)), { ok: false, reason: "changed" }, "the new form's file is not stored");
          await unchanged("file");
          const rows = await auditAbout(slug, [g.id]);
          assert.deepEqual(await attempt("frm_guard_2", file.sha256, rows + 1), { ok: false, reason: "changed" }, "the audit trail is not what the plan saw");
          await unchanged("audit");
          await putTenantSettings(ctx, slug, { "larkfield-fictional": g.id });
          assert.deepEqual(await attempt("frm_guard_3"), { ok: false, reason: "changed" }, "linked to a referrer");
          await putTenantSettings(ctx, slug, {});
          const settled = await snapshot(slug);
          assert.deepEqual(settled, state);
          assert.ok((await createReport(ctx, slug, { id: "rpt_guard", status: "draft", templateId: `form:${g.id}`, payload: { fictional: true } })).ok);
          assert.deepEqual(await attempt("frm_guard_4"), { ok: false, reason: "changed" }, "a report names it by template_id only");
          assert.deepEqual(await snapshot(slug), state);
          // Now the clinic removes the form (and its report): nothing to replace, so nothing is stored either.
          assert.ok(await deleteForm(ctx, slug, g.id));
          const gone = await snapshot(slug);
          const auditGone = await auditCount(slug);
          assert.deepEqual(await attempt("frm_guard_5"), { ok: false, reason: "changed" });
          assert.deepEqual(await snapshot(slug), gone);
          assert.equal(await auditCount(slug), auditGone);
        });

        it("hook case: another run replaced the form after this run read the library – REFUSED as replaced meanwhile, nothing done", async (tc) => {
          const raw = t.sqlite;
          if (!raw) {
            tc.skip("needs the SQLite database underneath (node:sqlite, D1 stand-in)");
            return;
          }
          const slug = await clinic();
          await load(slug, folder({ "K.rtf": "K v1" }));
          const k = await one(slug, "K.rtf");
          let armed = true;
          // The library is read (and decrypted) first; the other run's batch lands before this run plans the file.
          const cipher = new Proxy(ctx.cipher, {
            get(target, prop) {
              const value = Reflect.get(target, prop, target) as unknown;
              if (prop !== "decryptString" || typeof value !== "function") return typeof value === "function" ? value.bind(target) : value;
              return (enc: unknown, aad: { table?: string; rowId?: string }) => {
                const out = (value as (e: unknown, a: unknown) => unknown).call(target, enc, aad);
                if (armed && aad?.table === "forms" && aad.rowId === k.id) {
                  armed = false;
                  raw.prepare("DELETE FROM forms WHERE tenant_id = ? AND id = ?").run(slug, k.id);
                  raw
                    .prepare("INSERT INTO audit_log (id, tenant_id, user_id, session_id, action, target_type, target_id, detail_json, at) VALUES ('01HOOKAUDITFICTIONAL00002', ?, ?, NULL, 'form.replace', 'form', 'frm_other_run', ?, ?)")
                    .run(slug, PLATFORM_USER_ID, JSON.stringify({ via: "onboarding", replaces: [k.id] }), at);
                }
                return out;
              };
            },
          });
          const files = (await listFormFiles(ctx, slug)).map((f) => f.sha256);
          const r = await replaceRun(slug, folder({ "K.rtf": "K v2" }), true, { ...ctx, cipher });
          assert.equal(armed, false, "the hook ran");
          assert.equal(r.files[0]?.status, "refused", JSON.stringify(r.files[0]));
          assert.equal(r.files[0]?.reason, `The form ${k.id} in the library was replaced meanwhile by frm_other_run (another run): nothing is done for this file. Run the preview again.`);
          assert.deepEqual(await listFormMeta(ctx, slug), [], "nothing stored");
          assert.deepEqual((await listFormFiles(ctx, slug)).map((f) => f.sha256), files, "no file written");
        });

        it("hook cases: the clinic changes the form between the plan and the batch – REFUSED, the new file removed again, nothing audited", async (tc) => {
          const raw = t.sqlite;
          if (!raw) {
            tc.skip("needs the SQLite database underneath (node:sqlite, D1 stand-in)");
            return;
          }
          const run = (sql: string, ...params: (string | number | null)[]) => raw.prepare(sql).run(...params);
          const cases: [string, (slug: string, id: string) => void][] = [
            ["saved in the Studio (revision 2)", (slug, id) => run("UPDATE forms SET rev = rev + 1 WHERE tenant_id = ? AND id = ?", slug, id)],
            ["removed in the Studio", (slug, id) => run("DELETE FROM forms WHERE tenant_id = ? AND id = ?", slug, id)],
            ["a report started on it (template_id only)", (slug, id) => run("INSERT INTO reports (tenant_id, id, rev, status, form_id, template_id, payload_enc, created_at, updated_at) VALUES (?, 'rpt_hook', 1, 'draft', NULL, ?, 'x', ?, ?)", slug, `form:${id}`, at, at)],
            ["linked to a referrer", (slug, id) => run("INSERT INTO tenant_settings (tenant_id, referrer_links_json, updated_at) VALUES (?, ?, ?)", slug, JSON.stringify({ "larkfield-fictional": id }), at)],
            [
              "approved with it (activity log only)",
              (slug, id) =>
                run("INSERT INTO audit_log (id, tenant_id, user_id, session_id, action, target_type, target_id, detail_json, at) VALUES ('01HOOKAUDITFICTIONAL00000', ?, 'user-fictional', NULL, 'report.sign', 'report', 'rpt_gone', ?, ?)", slug, JSON.stringify({ formId: id }), at),
            ],
            [
              "replaced by another run first",
              (slug, id) => {
                run("DELETE FROM forms WHERE tenant_id = ? AND id = ?", slug, id);
                run("INSERT INTO audit_log (id, tenant_id, user_id, session_id, action, target_type, target_id, detail_json, at) VALUES ('01HOOKAUDITFICTIONAL00001', ?, ?, NULL, 'form.replace', 'form', 'frm_other_run', ?, ?)", slug, PLATFORM_USER_ID, JSON.stringify({ via: "onboarding", replaces: [id] }), at);
              },
            ],
            [
              "the new file removed meanwhile",
              (slug) => {
                for (const table of ["form_file_chunks", "form_files"]) run(`DELETE FROM ${table} WHERE tenant_id = ? AND sha256 NOT IN (SELECT file_sha256 FROM forms WHERE tenant_id = ?)`, slug, slug);
              },
            ],
          ];
          for (const [label, change] of cases) {
            const slug = await clinic();
            await load(slug, folder({ "H.rtf": "H v1" }));
            const h = await one(slug, "H.rtf");
            let armed = true;
            // ctx.cipher.encrypt for a forms row runs in replaceForms after the plan and the file upload, before the batch.
            const cipher = new Proxy(ctx.cipher, {
              get(target, prop) {
                const value = Reflect.get(target, prop, target) as unknown;
                if (prop !== "encrypt" || typeof value !== "function") return typeof value === "function" ? value.bind(target) : value;
                return (plain: unknown, aad: { table?: string }) => {
                  if (armed && aad?.table === "forms") {
                    armed = false;
                    change(slug, h.id);
                  }
                  return (value as (p: unknown, a: unknown) => unknown).call(target, plain, aad);
                };
              },
            });
            const formsAfterChange = async () => (await listFormMeta(ctx, slug)).map((m) => `${m.id}@${m.rev}`).sort();
            const auditBefore = new Set((await listAudit(ctx, slug, { limit: 500 })).map((e) => e.id));
            const r = await replaceRun(slug, folder({ "H.rtf": "H v2" }), true, { ...ctx, cipher });
            assert.equal(armed, false, `${label}: the hook ran`);
            assert.equal(r.files[0]?.status, "refused", `${label}: ${JSON.stringify(r.files[0])}`);
            assert.match(r.files[0]?.reason ?? "", /changed while it was being replaced: nothing was replaced/, label);
            assert.deepEqual(r.files[0]?.replaces, [h.id]);
            const left = await formsAfterChange();
            assert.ok(left.length <= 1 && left.every((x) => x.startsWith(`${h.id}@`)), `${label}: no new form (${left.join(", ")})`);
            const shas = (await listFormFiles(ctx, slug)).map((f) => f.sha256);
            assert.ok(!shas.some((sha) => sha !== h.sha), `${label}: the new file is not left behind`);
            const added = (await listAudit(ctx, slug, { limit: 500 })).filter((e) => !auditBefore.has(e.id));
            assert.ok(added.every((e) => e.userId !== PLATFORM_USER_ID || e.targetId === "frm_other_run"), `${label}: nothing audited by the run (${added.map((e) => e.action).join(", ")})`);
          }
        });
      });
    });
  });
}
