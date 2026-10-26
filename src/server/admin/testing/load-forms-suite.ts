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
import { appendAudit, listAudit } from "../../repos/audit";
import type { RepoContext } from "../../repos/context";
import { RepoInputError } from "../../repos/context";
import { getFormFile, listFormFiles } from "../../repos/form-files";
import { createForm, getForm, listFormMeta, listForms, replaceForms, updateForm } from "../../repos/forms";
import { createReport } from "../../repos/reports";
import { putTenantSettings } from "../../repos/tenant-settings";
import { loadClinicForms, parseMapsJson } from "../load-forms";

export interface LoadFormsSuiteDb {
  db: Kysely<Database>;
  close: () => Promise<void>;
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
        assert.deepEqual(replacedRows.find((e) => e.targetId === a.id)?.detail?.replaces, [oldA.id]);
        assert.equal(replacedRows.find((e) => e.targetId === a.id)?.detail?.filesDeleted, 1);
        assert.equal(replacedRows.find((e) => e.targetId === harrow.id)?.detail?.filesDeleted, 0);
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

      it("replaceForms is all or nothing: a form changed or used meanwhile leaves the library exactly as it was", async () => {
        const a = await one(RCLINIC, "A.rtf");
        const c = await one(RCLINIC, "C.rtf");
        const state = await snapshot(RCLINIC);
        const row = (id: string, form: FormDefinition) => ({ id, fileSha256: form.file.sha256, status: "proposed", title: form.title, referrer: form.referrer.name, kind: form.kind, payload: { ...form, id } });
        // A stale revision (the clinic saved it meanwhile).
        const stale = await replaceForms(ctx, RCLINIC, { replace: [{ id: a.id, rev: 2, status: "proposed" }], form: row("frm_race_1", a.form), dropUnusedFiles: [a.sha] });
        assert.deepEqual(stale, { ok: false, reason: "changed" });
        // A report started on one of two forms: neither goes.
        const used = await replaceForms(ctx, RCLINIC, {
          replace: [
            { id: a.id, rev: 1, status: "proposed" },
            { id: c.id, rev: 1, status: "proposed" },
          ],
          form: row("frm_race_2", a.form),
          dropUnusedFiles: [a.sha, c.sha],
        });
        assert.deepEqual(used, { ok: false, reason: "changed" });
        assert.deepEqual(await snapshot(RCLINIC), state, "nothing changed, no stray form or file");
        await assert.rejects(replaceForms(ctx, RCLINIC, { replace: [], form: row("frm_race_3", a.form) }), RepoInputError);
        await assert.rejects(replaceForms(ctx, RCLINIC, { replace: [{ id: a.id, rev: 1, status: "proposed" }], form: row(a.id, a.form) }), RepoInputError);
        // Another clinic's id is never reached: the same ids under ROTHER do not exist there.
        const elsewhere = await replaceForms(ctx, ROTHER, { replace: [{ id: a.id, rev: 1, status: "proposed" }], form: row("frm_race_4", a.form), dropUnusedFiles: [a.sha] });
        assert.equal(elsewhere.ok, true);
        assert.equal(elsewhere.ok && elsewhere.removed, 0, "nothing of RCLINIC removed");
        assert.deepEqual(await snapshot(RCLINIC), state);
        assert.ok(await getForm(ctx, ROTHER, "frm_race_4"));
        assert.equal((await listFormMeta(ctx, ROTHER)).length, beforeOther.forms.length + 1);
      });
    });
  });
}
