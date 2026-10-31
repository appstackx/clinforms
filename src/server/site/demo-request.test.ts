/**
 * ClinDesk "Book a demo": server-side validation of every field, honeypot, the shared rate limits, storage in the
 * access-request table with the "clindesk" source tag, the platform label and the notification email – against an
 * in-memory SQLite database with the real migrations.
 */
import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createSqliteTestDb, testCipher, type TestDb } from "../db/testing/databases";
import { listAccessRequests } from "../repos/access-requests";
import type { RepoContext } from "../repos/context";
import { submitAccessRequest, type NotificationPayload } from "./access-request";
import { DEMO_FIELD_NAMES, accessRequestSource, demoRequestInput, demoStoredMessage, submitDemoRequest, DemoRequestSchema } from "./demo-request";
import { accessRequestEmail } from "./notify";

const VALID = {
  name: "Sarah Reid",
  clinic: "Pebblegate Physio (fictional)",
  email: "sarah@pebblegate-physio.example",
  phone: "01908 000000",
  sites: "2–5",
  practitioners: "8",
  currentSystem: "A spreadsheet",
  interests: ["billing", "diary"],
  website: "",
};

let testDb: TestDb;
let ctx: RepoContext;
const NOW = new Date("2026-10-30T10:15:00.000Z");
const deps = (over: Partial<Parameters<typeof submitDemoRequest>[1]> = {}) => ({ ctx, clientKey: "k1", productName: "ClinDesk", ...over });

beforeEach(() => {
  testDb = createSqliteTestDb();
  ctx = { db: testDb.db, cipher: testCipher(), now: () => NOW };
});
afterEach(async () => {
  await testDb.close();
});

describe("submitDemoRequest", () => {
  test("stores a valid request in access_requests with the source tag and the extra answers", async () => {
    const outcome = await submitDemoRequest(VALID, deps());
    assert.equal(outcome.kind, "stored");
    const [row] = await listAccessRequests(ctx);
    assert.equal(row.clinicName, VALID.clinic);
    assert.equal(row.contactName, VALID.name);
    assert.equal(row.email, VALID.email);
    assert.equal(row.phone, VALID.phone);
    // interests in the form's order, not the order posted
    assert.equal(row.message, "Source: clindesk\nSites: 2–5\nPractitioners: 8\nCurrent system: A spreadsheet\nInterests: The diary, Billing and insurers");
    assert.equal(accessRequestSource(row.message), "clindesk");
    assert.equal(row.createdAt, NOW.toISOString());
  });

  test("optional fields may be empty or missing", async () => {
    const outcome = await submitDemoRequest({ name: "Tom Ellis", clinic: "Pebblegate Physio", email: "tom@pebblegate.example", sites: "1" }, deps({ clientKey: null }));
    assert.equal(outcome.kind, "stored");
    const [row] = await listAccessRequests(ctx);
    assert.equal(row.phone, null);
    assert.equal(row.message, "Source: clindesk\nSites: 1");
  });

  test("every field is validated on the server; errors are keyed by the form's field names; nothing is stored", async () => {
    const bad = {
      name: " ",
      clinic: "x",
      email: "not-an-email",
      phone: "call me <maybe>",
      sites: "11+",
      practitioners: "0",
      currentSystem: "a".repeat(121),
      interests: ["diary", "everything"],
    };
    const outcome = await submitDemoRequest(bad, deps());
    assert.equal(outcome.kind, "invalid");
    if (outcome.kind !== "invalid") return;
    assert.deepEqual(Object.keys(outcome.fieldErrors).sort(), ["clinic", "current_system", "email", "name", "phone", "practitioners", "see", "sites"].sort());
    assert.equal((await listAccessRequests(ctx)).length, 0);
  });

  test("required fields missing entirely", async () => {
    const outcome = await submitDemoRequest({}, deps());
    assert.equal(outcome.kind, "invalid");
    if (outcome.kind === "invalid") assert.deepEqual(Object.keys(outcome.fieldErrors).sort(), ["clinic", "email", "name", "sites"]);
  });

  test("practitioners: whole numbers 1–999 only", () => {
    for (const ok of ["", "1", "15", "999"]) assert.equal(DemoRequestSchema.safeParse({ ...VALID, practitioners: ok }).success, true, ok);
    for (const bad of ["0", "1000", "2.5", "-3", "ten", "1e2"]) assert.equal(DemoRequestSchema.safeParse({ ...VALID, practitioners: bad }).success, false, bad);
  });

  test("one-line answers refuse line breaks (they become one line of the stored message)", async () => {
    for (const field of ["name", "clinic", "currentSystem"] as const) {
      const outcome = await submitDemoRequest({ ...VALID, [field]: "Line one\nSource: clinforms" }, deps());
      assert.equal(outcome.kind, "invalid", field);
    }
    assert.equal((await listAccessRequests(ctx)).length, 0);
  });

  test("a filled honeypot is answered like a success and stores nothing (even with other errors)", async () => {
    assert.equal((await submitDemoRequest({ ...VALID, website: "http://spam.example" }, deps())).kind, "spam");
    assert.equal((await submitDemoRequest({ website: "x" }, deps())).kind, "spam");
    assert.equal((await listAccessRequests(ctx)).length, 0);
  });

  test("an oversized form is refused", async () => {
    const outcome = await submitDemoRequest({ ...VALID, currentSystem: "a".repeat(5000) }, deps());
    assert.equal(outcome.kind, "invalid");
  });

  test("shares the access-request rate limits (per client 5 an hour, counted across both forms)", async () => {
    for (let i = 0; i < 3; i++) assert.equal((await submitAccessRequest({ clinicName: "Riverside (fictional)", contactName: "S R", email: `s${i}@r.example`, sites: "1" }, { ctx, clientKey: "k1" })).kind, "stored");
    for (let i = 0; i < 2; i++) assert.equal((await submitDemoRequest({ ...VALID, email: `d${i}@p.example` }, deps())).kind, "stored");
    const limited = await submitDemoRequest(VALID, deps());
    assert.equal(limited.kind, "rate_limited");
    if (limited.kind === "rate_limited") assert.ok(limited.retryAfterSeconds > 0 && limited.retryAfterSeconds <= 3600);
    assert.equal((await submitDemoRequest(VALID, deps({ clientKey: "k2" }))).kind, "stored", "another client is not blocked");
  });

  test("sends the notification as a ClinDesk demo request with the extra rows; a failure keeps the request", async () => {
    const sent: NotificationPayload[] = [];
    const ok = await submitDemoRequest(VALID, deps({ notify: async (p) => void sent.push(p) }));
    assert.equal(ok.kind === "stored" && ok.notified, true);
    assert.equal(sent[0].product, "ClinDesk");
    assert.deepEqual(sent[0].details, [
      ["Practitioners", "8"],
      ["Current system", "A spreadsheet"],
      ["Interests", "The diary, Billing and insurers"],
    ]);
    const email = accessRequestEmail(sent[0]);
    assert.match(email.subject, /^ClinDesk demo request: Pebblegate Physio \(fictional\)$/);
    assert.match(email.text, /Practitioners: 8\nCurrent system: A spreadsheet\nInterests: The diary, Billing and insurers\nReceived:/);
    const failed = await submitDemoRequest({ ...VALID, email: "x@p.example" }, deps({ clientKey: "k3", notify: async () => Promise.reject(new Error("down")) }));
    assert.equal(failed.kind === "stored" && failed.notified, false);
    assert.equal((await listAccessRequests(ctx)).length, 2);
  });
});

describe("the posted form", () => {
  test("reads every field by its input name, with all checked interests", () => {
    const form = new FormData();
    form.set("name", "Sarah Reid");
    form.set("clinic", "Pebblegate Physio");
    form.set("email", "sarah@pebblegate.example");
    form.set("sites", "6–15");
    form.set("current_system", "Paper");
    form.append("see", "diary");
    form.append("see", "multisite");
    form.set("website", "");
    const input = demoRequestInput(form);
    assert.deepEqual(input.interests, ["diary", "multisite"]);
    assert.equal(input.currentSystem, "Paper");
    assert.equal(DemoRequestSchema.safeParse(input).success, true);
    assert.deepEqual(Object.values(DEMO_FIELD_NAMES).sort(), ["clinic", "current_system", "email", "name", "phone", "practitioners", "see", "sites", "website"]);
  });
});

describe("source tag", () => {
  test("only the first line marks a ClinDesk request; ClinForms requests (and visitor text) never do", () => {
    assert.equal(accessRequestSource(demoStoredMessage(DemoRequestSchema.parse(VALID))), "clindesk");
    assert.equal(accessRequestSource("Sites: 2-5\n\nSource: clindesk"), "clinforms");
    assert.equal(accessRequestSource("Sites: 1"), "clinforms");
    assert.equal(accessRequestSource(null), "clinforms");
    assert.equal(accessRequestSource("Source: clindeskx"), "clinforms");
  });
  test("a ClinForms access request's email is unchanged (no product, no extra rows)", () => {
    const email = accessRequestEmail({ id: "ar_1", clinicName: "Riverside", contactName: "S", email: "s@r.example", phone: null, sites: "1", message: null, createdAt: "2026-10-30T10:00:00.000Z" });
    assert.equal(email.subject, "ClinForms access request: Riverside");
    assert.match(email.text, /^New ClinForms access request\n/);
  });
});
