/**
 * admin:add-question-set (16/11/2026, src/server/admin/add-question-set.ts) on node:sqlite: a portal question set
 * into one clinic's forms library as a PROPOSAL, encrypted for that clinic, audited, nothing else changed – and its
 * argument handling. Fictional questions only. Run by `npm run test:db`.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { CliError, parseArgs } from "../../../scripts/admin/cli";
import { addQuestionSetArgs } from "../../../scripts/admin/add-question-set";
import { PREPARED_NOTE } from "../../modules/medreport/core/form-map-lint";
import { EXAMPLE_PORTAL_QUESTIONS, isQuestionSet, questionSetSha256 } from "../../modules/medreport/core/question-set";
import { FormDefinitionSchema } from "../../modules/medreport/core/schemas";
import { PLATFORM_USER_ID } from "../auth/create-auth";
import { createSqliteTestDb, testCipher } from "../db/testing/databases";
import { listAudit } from "../repos/audit";
import { RepoInputError, type RepoContext } from "../repos/context";
import { getForm, listFormMeta } from "../repos/forms";
import { addClinicQuestionSet } from "./add-question-set";

const CLINIC = "question-set-test";
const OTHER = "question-set-other";
const CLOSED = "question-set-closed";
const REFERRER = { name: "Northbridge Rehabilitation (fictional)", type: "case_manager" as const };

describe("admin:add-question-set – node:sqlite", () => {
  let t: Awaited<ReturnType<typeof createSqliteTestDb>>;
  let ctx: RepoContext;
  const at = "2026-11-16T09:00:00.000Z";

  before(async () => {
    t = await createSqliteTestDb();
    ctx = { db: t.db, cipher: testCipher(), now: () => new Date(at) };
    for (const [slug, metadata] of [[CLINIC, null], [OTHER, null], [CLOSED, JSON.stringify({ offboardedAt: at })]] as const) {
      await t.db.insertInto("organization").values({ id: `org-${slug}`, name: `${slug} (fictional)`, slug, logo: null, createdAt: at, metadata }).execute();
    }
  });
  after(async () => {
    await t?.close();
  });

  it("refuses an unknown or closed clinic, a missing referrer and questions that do not parse – nothing is stored", async () => {
    await assert.rejects(addClinicQuestionSet(ctx, { tenantId: "no-such-clinic", referrer: REFERRER, questionsText: EXAMPLE_PORTAL_QUESTIONS, confirm: true }), RepoInputError);
    await assert.rejects(addClinicQuestionSet(ctx, { tenantId: CLOSED, referrer: REFERRER, questionsText: EXAMPLE_PORTAL_QUESTIONS, confirm: true }), RepoInputError);
    await assert.rejects(addClinicQuestionSet(ctx, { tenantId: CLINIC, referrer: { name: "  ", type: "insurer" }, questionsText: EXAMPLE_PORTAL_QUESTIONS, confirm: true }), RepoInputError);
    const empty = await addClinicQuestionSet(ctx, { tenantId: CLINIC, referrer: REFERRER, questionsText: "# Only a heading\n\n", confirm: true });
    assert.equal(empty.status, "refused");
    assert.ok(empty.errors.length > 0);
    assert.equal((await listFormMeta(ctx, CLINIC)).length, 0);
    assert.equal((await listAudit(ctx, CLINIC)).length, 0);
  });

  it("previews by default; with confirm stores one proposed question set for that clinic only, audited as onboarding", async () => {
    const preview = await addClinicQuestionSet(ctx, { tenantId: CLINIC, referrer: REFERRER, questionsText: EXAMPLE_PORTAL_QUESTIONS });
    assert.equal(preview.dryRun, true);
    assert.equal(preview.status, "ready");
    assert.equal(preview.questions, 14);
    assert.equal(preview.headings, 3);
    assert.ok(preview.fromRecords > 0, "identifiers come from the record");
    assert.equal((await listFormMeta(ctx, CLINIC)).length, 0, "a preview stores nothing");

    const stored = await addClinicQuestionSet(ctx, { tenantId: CLINIC, referrer: REFERRER, title: "Northbridge – treatment report (portal)", questionsText: EXAMPLE_PORTAL_QUESTIONS, notes: ["Two screens of the portal were not available: add their questions before confirming."], confirm: true });
    assert.equal(stored.status, "loaded");
    assert.deepEqual(stored.invariants, { ok: true, changed: [] });
    const metas = await listFormMeta(ctx, CLINIC);
    assert.equal(metas.length, 1);
    assert.equal(metas[0].status, "proposed");
    assert.equal(metas[0].kind, "questions");
    assert.equal(metas[0].title, "Northbridge – treatment report (portal)");
    assert.equal((await listFormMeta(ctx, OTHER)).length, 0, "no other clinic");

    const record = await getForm(ctx, CLINIC, stored.formId as string);
    const form = FormDefinitionSchema.parse(record?.payload);
    assert.ok(isQuestionSet(form));
    assert.equal(form.tenantId, CLINIC);
    assert.equal(form.status, "proposed");
    assert.equal(form.confirmed, undefined);
    assert.equal(form.fields.length, 14);
    assert.equal(form.file.sha256, await questionSetSha256(form.fields), "the canonical question list is its version");
    assert.deepEqual(form.analysis.warnings.slice(0, 2), [PREPARED_NOTE, "Two screens of the portal were not available: add their questions before confirming."]);

    const audit = await listAudit(ctx, CLINIC);
    assert.deepEqual(audit.map((r) => r.action).sort(), ["clinic.forms_loaded", "form.create"]);
    assert.ok(audit.every((r) => r.userId === PLATFORM_USER_ID));
    const created = audit.find((r) => r.action === "form.create");
    assert.deepEqual(created?.detail, { via: "onboarding", status: "proposed", fields: 14, kind: "questions", mapFrom: "questions" });
  });

  it("the same questions again are skipped (also in the preview); different questions are a new form", async () => {
    for (const confirm of [false, true]) {
      const again = await addClinicQuestionSet(ctx, { tenantId: CLINIC, referrer: REFERRER, questionsText: EXAMPLE_PORTAL_QUESTIONS, confirm });
      assert.equal(again.status, "skipped");
    }
    assert.equal((await listFormMeta(ctx, CLINIC)).length, 1);
    const other = await addClinicQuestionSet(ctx, { tenantId: CLINIC, referrer: REFERRER, questionsText: `${EXAMPLE_PORTAL_QUESTIONS}\nAnything else to add? [long] [optional]`, confirm: true });
    assert.equal(other.status, "loaded");
    assert.equal((await listFormMeta(ctx, CLINIC)).length, 2);
  });
});

describe("admin:add-question-set arguments", () => {
  const args = (list: string[]) => parseArgs(list);
  it("needs a clinic, the referrer with its type and the questions file; preview unless --confirm", () => {
    const a = addQuestionSetArgs(args(["--slug", "blue-heart", "--referrer", "Northbridge Rehabilitation (fictional)", "--referrer-type", "case_manager", "--questions", "/tmp/q.txt"]));
    assert.deepEqual(a, { slug: "blue-heart", questionsPath: "/tmp/q.txt", referrer: { name: "Northbridge Rehabilitation (fictional)", type: "case_manager" }, title: null, note: null, confirm: false });
    assert.equal(addQuestionSetArgs(args(["--slug", "x", "--referrer", "R", "--referrer-type", "insurer", "--questions", "q.txt", "--confirm", "--title", "T", "--note", "N"])).confirm, true);
    assert.throws(() => addQuestionSetArgs(args(["--referrer", "R", "--referrer-type", "insurer", "--questions", "q.txt"])), CliError);
    assert.throws(() => addQuestionSetArgs(args(["--slug", "x", "--referrer", "R", "--referrer-type", "nope", "--questions", "q.txt"])), CliError);
    assert.throws(() => addQuestionSetArgs(args(["--slug", "x", "--referrer", "R", "--referrer-type", "insurer"])), CliError);
  });
});
