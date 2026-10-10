/**
 * Unit tests for the simulated TM3 API handlers (auth, paging, shapes, write-back checks).
 * Run: node --import tsx --test src/sandbox/tm3-sim/handlers.test.ts
 *
 * Owner: sandbox agent.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, it } from "node:test";
import { DEMO_FALLBACKS } from "./config";
import {
  dispatchSimRequest,
  simAttachDocument,
  simGetPatient,
  simListAppointments,
  simListEpisodes,
  simListNotes,
  simListOutcomeMeasures,
  simListPatients,
} from "./handlers";

const ORIGIN = "http://localhost:3000";
const BASE = `${ORIGIN}/api/tm3-sim/v1`;
const TOKEN = "unit-test-sim-token";
const ENV_KEYS = ["TM3_SIM_TOKEN", "TM3_SIM_LATENCY_MS", "MEDREPORT_AI_MODE", "ANTHROPIC_API_KEY", "MEDREPORT_LIVE_PASSCODE"];
let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = {};
  ENV_KEYS.forEach((k) => {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  });
  process.env.TM3_SIM_TOKEN = TOKEN;
  process.env.TM3_SIM_LATENCY_MS = "0";
});

afterEach(() => {
  ENV_KEYS.forEach((k) => {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  });
});

function get(path: string, token: string | null = TOKEN): Request {
  const headers: Record<string, string> = {};
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return new Request(`${BASE}${path}`, { headers });
}

const ctx = (id?: string): { params: Record<string, string> } => ({ params: id ? { id } : {} });

async function body(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

function assertSimulated(res: Response, json: Record<string, unknown>) {
  assert.equal(res.headers.get("x-simulated"), "true");
  assert.equal(json._simulated, true);
}

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function attachPayload(overrides: Record<string, unknown> = {}) {
  const bytes = Buffer.from("PK\u0003\u0004 fictional signed report bytes");
  return {
    episode_id: "sim-ep-1001",
    title: "Treating physiotherapist report – signed",
    file_name: "megan-hart-report.docx",
    mime_type: DOCX_MIME,
    content_base64: bytes.toString("base64"),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    sign_receipt: {
      report_id: "rep-123",
      content_sha256: "a".repeat(64),
      signer_name: "Sarah Reid",
      signer_hcpc: "PH-DEMO-01",
      signed_at: "2026-10-06T10:00:00.000Z",
      mac: "abc123",
    },
    ...overrides,
  };
}

function post(path: string, payload: unknown, token: string | null = TOKEN): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return new Request(`${BASE}${path}`, {
    method: "POST",
    headers,
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
}

describe("auth", () => {
  it("rejects a missing token with 401 problem+json", async () => {
    const res = await simListPatients(get("/patients", null), ctx());
    assert.equal(res.status, 401);
    assert.match(res.headers.get("content-type") ?? "", /application\/problem\+json/);
    assert.match(res.headers.get("www-authenticate") ?? "", /Bearer/);
    const json = await body(res);
    assertSimulated(res, json);
    assert.equal((json.error as { code: string }).code, "unauthorised");
    assert.equal(json.status, 401);
  });

  it("rejects a wrong token on every endpoint", async () => {
    const calls: Array<Promise<Response>> = [
      simListPatients(get("/patients", "nope"), ctx()),
      simGetPatient(get("/patients/sim-pat-001", "nope"), ctx("sim-pat-001")),
      simListEpisodes(get("/patients/sim-pat-001/episodes", "nope"), ctx("sim-pat-001")),
      simListNotes(get("/episodes/sim-ep-1001/notes", "nope"), ctx("sim-ep-1001")),
      simListAppointments(get("/episodes/sim-ep-1001/appointments", "nope"), ctx("sim-ep-1001")),
      simListOutcomeMeasures(get("/episodes/sim-ep-1001/outcome-measures", "nope"), ctx("sim-ep-1001")),
      simAttachDocument(post("/patients/sim-pat-001/documents", attachPayload(), "nope"), ctx("sim-pat-001")),
    ];
    const results = await Promise.all(calls);
    results.forEach((res) => assert.equal(res.status, 401));
  });

  it("accepts the fixed demo token when TM3_SIM_TOKEN is unset in demo mode", async () => {
    delete process.env.TM3_SIM_TOKEN;
    const ok = await simListPatients(get("/patients", DEMO_FALLBACKS.TM3_SIM_TOKEN), ctx());
    assert.equal(ok.status, 200);
  });

  it("does not fall back to the demo token outside demo mode", async () => {
    delete process.env.TM3_SIM_TOKEN;
    process.env.ANTHROPIC_API_KEY = "x";
    process.env.MEDREPORT_LIVE_PASSCODE = "y".repeat(16);
    const res = await simListPatients(get("/patients", DEMO_FALLBACKS.TM3_SIM_TOKEN), ctx());
    assert.equal(res.status, 503);
  });

  it("a passcode shorter than 16 characters is demo mode, as in the module (config.server.ts MIN_LIVE_PASSCODE_LENGTH)", async () => {
    delete process.env.TM3_SIM_TOKEN;
    process.env.ANTHROPIC_API_KEY = "x";
    process.env.MEDREPORT_LIVE_PASSCODE = "y".repeat(15);
    const ok = await simListPatients(get("/patients", DEMO_FALLBACKS.TM3_SIM_TOKEN), ctx());
    assert.equal(ok.status, 200);
  });

  it("does not accept the demo token when a real token is configured", async () => {
    const res = await simListPatients(get("/patients", DEMO_FALLBACKS.TM3_SIM_TOKEN), ctx());
    assert.equal(res.status, 401);
  });
});

describe("patients", () => {
  it("lists all six patients with the page shape", async () => {
    const res = await simListPatients(get("/patients"), ctx());
    assert.equal(res.status, 200);
    const json = await body(res);
    assertSimulated(res, json);
    assert.equal(json.total, 6);
    assert.equal(json.page, 1);
    assert.equal(json.page_size, 50);
    assert.equal(json.next_page, null);
    const data = json.data as Array<Record<string, unknown>>;
    assert.equal(data.length, 6);
    assert.deepEqual(
      data.map((p) => p.id),
      ["sim-pat-001", "sim-pat-002", "sim-pat-003", "sim-pat-004", "sim-pat-005", "sim-pat-006"],
    );
    data.forEach((p) => {
      assert.equal(p._simulated, true);
      assert.equal(typeof p.first_name, "string");
      assert.match(String(p.date_of_birth), /^\d{4}-\d{2}-\d{2}$/);
    });
  });

  it("searches by name, ID, UK date of birth and postcode (case-insensitive)", async () => {
    const ids = async (q: string) => {
      const res = await simListPatients(get(`/patients?search=${encodeURIComponent(q)}`), ctx());
      return ((await body(res)).data as Array<{ id: string }>).map((p) => p.id);
    };
    assert.deepEqual(await ids("megan"), ["sim-pat-001"]);
    assert.deepEqual(await ids("BROOKS"), ["sim-pat-002"]);
    assert.deepEqual(await ids("daniel brooks"), ["sim-pat-002"]);
    assert.deepEqual(await ids("sim-pat-004"), ["sim-pat-004"]);
    assert.deepEqual(await ids("22/11/1991"), ["sim-pat-001"]);
    assert.deepEqual(await ids("mk3 9zz"), ["sim-pat-001"]);
    assert.deepEqual(await ids("rebecca lane"), ["sim-pat-006"]);
    assert.deepEqual(await ids("23/07/1981"), ["sim-pat-006"]);
    assert.deepEqual(await ids("nobody-here"), []);
  });

  it("pages with page/page_size, next_page and a Link header", async () => {
    const first = await simListPatients(get("/patients?page_size=2"), ctx());
    const j1 = await body(first);
    assert.equal(j1.page, 1);
    assert.equal(j1.page_size, 2);
    assert.equal(j1.total, 6);
    assert.equal(j1.next_page, 2);
    assert.equal((j1.data as unknown[]).length, 2);
    assert.equal(first.headers.get("x-total-count"), "6");
    const link = first.headers.get("link") ?? "";
    assert.match(link, /rel="next"/);
    assert.match(link, /page=2/);
    assert.match(link, /page_size=2/);

    const last = await simListPatients(get("/patients?page=3&page_size=2"), ctx());
    const j3 = await body(last);
    assert.deepEqual((j3.data as Array<{ id: string }>).map((p) => p.id), ["sim-pat-005", "sim-pat-006"]);
    assert.equal(j3.next_page, null);
    assert.equal(last.headers.get("link"), null);

    const beyond = await body(await simListPatients(get("/patients?page=9&page_size=2"), ctx()));
    assert.deepEqual(beyond.data, []);
    assert.equal(beyond.next_page, null);
  });

  it("caps page_size at 100 and rejects invalid paging with 422", async () => {
    const capped = await body(await simListPatients(get("/patients?page_size=500"), ctx()));
    assert.equal(capped.page_size, 100);
    const bad = await simListPatients(get("/patients?page=0"), ctx());
    assert.equal(bad.status, 422);
    const bad2 = await simListPatients(get("/patients?page_size=abc"), ctx());
    assert.equal(bad2.status, 422);
  });

  it("gets one patient and 404s an unknown one", async () => {
    const res = await simGetPatient(get("/patients/sim-pat-001"), ctx("sim-pat-001"));
    const json = await body(res);
    assertSimulated(res, json);
    assert.equal(json.first_name, "Megan");
    assert.equal(json.last_name, "Hart");
    assert.equal(json.episode_count, 1);
    const missing = await simGetPatient(get("/patients/sim-pat-999"), ctx("sim-pat-999"));
    assert.equal(missing.status, 404);
    assertSimulated(missing, await body(missing));
  });

  it("returns a fresh copy (callers cannot mutate the fixtures)", async () => {
    const a = await body(await simGetPatient(get("/patients/sim-pat-001"), ctx("sim-pat-001")));
    a.first_name = "Changed";
    const b = await body(await simGetPatient(get("/patients/sim-pat-001"), ctx("sim-pat-001")));
    assert.equal(b.first_name, "Megan");
  });
});

describe("episodes and clinical data", () => {
  it("lists a patient's episodes (empty for registration-only patients)", async () => {
    const res = await simListEpisodes(get("/patients/sim-pat-001/episodes"), ctx("sim-pat-001"));
    const json = await body(res);
    assertSimulated(res, json);
    const data = json.data as Array<Record<string, unknown>>;
    assert.equal(data.length, 1);
    assert.equal(data[0].id, "sim-ep-1001");
    assert.equal((data[0].referral as { source_type: string }).source_type, "solicitor");

    const daniel = await body(await simListEpisodes(get("/patients/sim-pat-002/episodes"), ctx("sim-pat-002")));
    assert.equal(((daniel.data as Array<{ referral: { source_type: string } }>)[0]).referral.source_type, "employer");

    const empty = await body(await simListEpisodes(get("/patients/sim-pat-003/episodes"), ctx("sim-pat-003")));
    assert.deepEqual(empty.data, []);
    assert.equal(empty.total, 0);

    const missing = await simListEpisodes(get("/patients/nope/episodes"), ctx("nope"));
    assert.equal(missing.status, 404);
  });

  it("lists notes with SOAP fields and author {name, hcpc}", async () => {
    const res = await simListNotes(get("/episodes/sim-ep-1001/notes"), ctx("sim-ep-1001"));
    const json = await body(res);
    assertSimulated(res, json);
    const notes = json.data as Array<Record<string, unknown>>;
    assert.equal(json.total, 10);
    assert.equal(notes.length, 10);
    notes.forEach((n) => {
      ["subjective", "objective", "assessment", "plan"].forEach((k) => assert.equal(typeof n[k], "string"));
      const author = n.author as { name: string; hcpc: string };
      assert.ok(author.name.length > 0);
      assert.match(author.hcpc, /^PH-DEMO-0\d$/);
      assert.equal(n.episode_id, "sim-ep-1001");
    });
    const daniel = await body(await simListNotes(get("/episodes/sim-ep-1002/notes"), ctx("sim-ep-1002")));
    assert.equal(daniel.total, 6);
  });

  it("lists appointments with ATT/DNA/LCN statuses", async () => {
    const megan = await body(await simListAppointments(get("/episodes/sim-ep-1001/appointments"), ctx("sim-ep-1001")));
    const statuses = (megan.data as Array<{ status: string }>).map((a) => a.status);
    assert.equal(statuses.length, 11);
    assert.equal(statuses.filter((s) => s === "ATT").length, 10);
    assert.equal(statuses.filter((s) => s === "DNA").length, 1);

    const daniel = await body(await simListAppointments(get("/episodes/sim-ep-1002/appointments"), ctx("sim-ep-1002")));
    const ds = (daniel.data as Array<{ status: string; status_reason: string | null }>);
    assert.equal(ds.length, 7);
    const lcn = ds.filter((a) => a.status === "LCN");
    assert.equal(lcn.length, 1);
    assert.ok(lcn[0].status_reason);
  });

  it("pages appointments", async () => {
    const res = await simListAppointments(get("/episodes/sim-ep-1001/appointments?page=2&page_size=5"), ctx("sim-ep-1001"));
    const json = await body(res);
    assert.equal((json.data as unknown[]).length, 5);
    assert.equal(json.next_page, 3);
  });

  it("lists outcome measures", async () => {
    const megan = await body(
      await simListOutcomeMeasures(get("/episodes/sim-ep-1001/outcome-measures"), ctx("sim-ep-1001")),
    );
    const series = megan.data as Array<{ instrument: string; scores: Array<{ value: number }> }>;
    assert.deepEqual(series.map((s) => s.instrument).sort(), ["NDI", "NPRS"]);
    assert.deepEqual(series.find((s) => s.instrument === "NDI")?.scores.map((s) => s.value), [42, 24, 12]);
    const daniel = await body(
      await simListOutcomeMeasures(get("/episodes/sim-ep-1002/outcome-measures"), ctx("sim-ep-1002")),
    );
    assert.deepEqual(
      (daniel.data as Array<{ instrument: string; scores: Array<{ value: number }> }>)[0].scores.map((s) => s.value),
      [48, 30, 18],
    );
  });

  it("serves the private medical insurance case: insurer identifiers, charges, CNC and BOOKED", async () => {
    const eps = await body(await simListEpisodes(get("/patients/sim-pat-006/episodes"), ctx("sim-pat-006")));
    const ep = (eps.data as Array<{ id: string; status: string; referral: Record<string, unknown> }>)[0];
    assert.equal(ep.id, "sim-ep-1006");
    assert.equal(ep.status, "open");
    assert.equal(ep.referral.source_type, "insurer");
    assert.equal(ep.referral.insurer_name, "Bupa");
    assert.equal(ep.referral.membership_number, "DEMO-POL-0001");
    assert.equal(ep.referral.authorisation_number, "DEMO-AUTH-0001");

    const appts = await body(await simListAppointments(get("/episodes/sim-ep-1006/appointments"), ctx("sim-ep-1006")));
    const rows = appts.data as Array<{ status: string; charge?: { amount: number; currency: string; paid: boolean } | null }>;
    assert.deepEqual(rows.map((a) => a.status), ["ATT", "ATT", "ATT", "CNC", "ATT", "ATT", "BOOKED"]);
    assert.deepEqual(
      rows.map((a) => (a.charge ? [a.charge.amount, a.charge.currency, a.charge.paid] : null)),
      [[70, "GBP", true], [55, "GBP", true], [55, "GBP", true], null, [55, "GBP", true], [55, "GBP", false], null],
    );
    // Earlier cases carry no charge key at all (their wire data is unchanged).
    const megan = await body(await simListAppointments(get("/episodes/sim-ep-1001/appointments"), ctx("sim-ep-1001")));
    assert.ok((megan.data as Array<Record<string, unknown>>).every((a) => !("charge" in a)));

    const oms = await body(await simListOutcomeMeasures(get("/episodes/sim-ep-1006/outcome-measures"), ctx("sim-ep-1006")));
    assert.deepEqual(
      (oms.data as Array<{ instrument: string; scores: Array<{ value: number }> }>).map((s) => [s.instrument, s.scores.map((p) => p.value)]),
      [
        ["NPRS", [7, 5, 4]],
        ["QuickDASH", [52.3, 38.6, 29.5]],
        ["PSFS", [2.7, 4.3, 5.3]],
      ],
    );
  });

  it("404s an unknown episode", async () => {
    const res = await simListNotes(get("/episodes/sim-ep-9999/notes"), ctx("sim-ep-9999"));
    assert.equal(res.status, 404);
    assert.equal(((await body(res)).error as { code: string }).code, "episode_not_found");
  });
});

describe("POST /patients/{id}/documents", () => {
  it("returns a receipt for a valid signed document", async () => {
    const payload = attachPayload();
    const res = await simAttachDocument(post("/patients/sim-pat-001/documents", payload), ctx("sim-pat-001"));
    assert.equal(res.status, 201);
    const json = await body(res);
    assertSimulated(res, json);
    assert.match(String(json.external_document_id), /^sim-doc-[a-f0-9]{12}$/);
    assert.ok(!Number.isNaN(Date.parse(String(json.received_at))));
    assert.equal(json.sha256, payload.sha256);
  });

  it("rejects a SHA-256 that does not match the bytes", async () => {
    const res = await simAttachDocument(
      post("/patients/sim-pat-001/documents", attachPayload({ sha256: "b".repeat(64) })),
      ctx("sim-pat-001"),
    );
    assert.equal(res.status, 422);
    assert.equal(((await body(res)).error as { code: string }).code, "sha256_mismatch");
  });

  it("rejects invalid JSON (400), a bad payload (422) and another patient's episode (422)", async () => {
    const badJson = await simAttachDocument(post("/patients/sim-pat-001/documents", "{nope"), ctx("sim-pat-001"));
    assert.equal(badJson.status, 400);

    const missing = attachPayload();
    delete (missing as Record<string, unknown>).sign_receipt;
    const noReceipt = await simAttachDocument(post("/patients/sim-pat-001/documents", missing), ctx("sim-pat-001"));
    assert.equal(noReceipt.status, 422);
    assert.match(String((await body(noReceipt)).detail), /sign_receipt/);

    const badMime = await simAttachDocument(
      post("/patients/sim-pat-001/documents", attachPayload({ mime_type: "text/plain" })),
      ctx("sim-pat-001"),
    );
    assert.equal(badMime.status, 422);

    const wrongEpisode = await simAttachDocument(
      post("/patients/sim-pat-001/documents", attachPayload({ episode_id: "sim-ep-1002" })),
      ctx("sim-pat-001"),
    );
    assert.equal(wrongEpisode.status, 422);
    assert.equal(((await body(wrongEpisode)).error as { code: string }).code, "episode_mismatch");

    const badExt = await simAttachDocument(
      post("/patients/sim-pat-001/documents", attachPayload({ file_name: "report.pdf" })),
      ctx("sim-pat-001"),
    );
    assert.equal(badExt.status, 422);

    const badB64 = await simAttachDocument(
      post("/patients/sim-pat-001/documents", attachPayload({ content_base64: "%%%not-base64" })),
      ctx("sim-pat-001"),
    );
    assert.equal(badB64.status, 422);
  });

  it("404s an unknown patient", async () => {
    const res = await simAttachDocument(post("/patients/nope/documents", attachPayload()), ctx("nope"));
    assert.equal(res.status, 404);
  });
});

describe("dispatchSimRequest", () => {
  it("routes paths to handlers with decoded params", async () => {
    const res = await dispatchSimRequest(get("/patients/sim-pat-002"));
    assert.equal(res.status, 200);
    assert.equal((await body(res)).first_name, "Daniel");

    const notes = await dispatchSimRequest(get("/episodes/sim-ep-1002/notes?page_size=2"));
    const json = await body(notes);
    assert.equal((json.data as unknown[]).length, 2);
    assert.equal(json.next_page, 2);

    const attach = await dispatchSimRequest(post("/patients/sim-pat-001/documents", attachPayload()));
    assert.equal(attach.status, 201);
  });

  it("requires auth, 404s unknown paths and 405s wrong methods", async () => {
    assert.equal((await dispatchSimRequest(get("/patients", null))).status, 401);
    const unknown = await dispatchSimRequest(get("/nothing-here"));
    assert.equal(unknown.status, 404);
    assert.equal(unknown.headers.get("x-simulated"), "true");
    assert.equal((await dispatchSimRequest(new Request(`${ORIGIN}/api/other`))).status, 404);
    const wrong = await dispatchSimRequest(
      new Request(`${BASE}/patients`, { method: "DELETE", headers: { authorization: `Bearer ${TOKEN}` } }),
    );
    assert.equal(wrong.status, 405);
    assert.equal(wrong.headers.get("allow"), "GET");
  });
});
