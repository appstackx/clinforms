import { test } from "node:test";
import assert from "node:assert/strict";
import { HttpError } from "../api/http";
import { createLaunchToken } from "./launch-token";
import {
  assertSessionConnector,
  assertSessionEpisode,
  createSessionToken,
  requireSession,
  sessionAllowsEpisode,
  verifySessionToken,
} from "./session-token";

const secret = "session-test-secret";
const now = new Date("2026-10-06T09:00:00Z");
const launchSession = {
  tenantId: "demo",
  kind: "launch" as const,
  connectorId: "tm3-sim" as const,
  patientId: "sim-pat-001",
  episodeId: "sim-ep-1001",
  clinician: { name: "Sarah Reid", hcpc: "PH-DEMO-01" },
};
const ref = { tenantId: "demo", connectorId: "tm3-sim" as const, patientId: "sim-pat-001", episodeId: "sim-ep-1001" };

function bearer(token: string): Request {
  return new Request("https://example.test/api/reports/v1/x", { headers: { authorization: `Bearer ${token}` } });
}

function httpError(fn: () => unknown): HttpError {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof HttpError, `expected HttpError, got ${String(err)}`);
    return err;
  }
  assert.fail("expected an HttpError");
}

test("a launch session covers exactly its episode; a demo session covers any demo episode", () => {
  const launch = createSessionToken(launchSession, { now, secret }).claims;
  assert.equal(launch.exp - launch.iat, 3600);
  assert.equal(sessionAllowsEpisode(launch, ref), true);
  assert.equal(sessionAllowsEpisode(launch, { ...ref, episodeId: "sim-ep-1002" }), false);
  assert.equal(sessionAllowsEpisode(launch, { ...ref, patientId: "sim-pat-002" }), false);
  assert.equal(sessionAllowsEpisode(launch, { ...ref, connectorId: "file-import" }), false);
  assert.equal(sessionAllowsEpisode(launch, { ...ref, tenantId: "other" }), false);

  const demo = createSessionToken({ tenantId: "demo", kind: "demo" }, { now, secret }).claims;
  assert.equal(sessionAllowsEpisode(demo, { ...ref, patientId: "sim-pat-002", episodeId: "sim-ep-1002" }), true);
  const demoSim = createSessionToken({ tenantId: "demo", kind: "demo", connectorId: "tm3-sim" }, { now, secret }).claims;
  assert.equal(sessionAllowsEpisode(demoSim, { ...ref, connectorId: "file-import" }), false);

  assert.equal(httpError(() => assertSessionEpisode(launch, { ...ref, episodeId: "sim-ep-1002" })).init.code, "SESSION_MISMATCH");
  assert.equal(httpError(() => assertSessionConnector(launch, "file-import")).init.code, "SESSION_MISMATCH");
  assert.doesNotThrow(() => assertSessionConnector(demo, "file-import"));
});

test("requireSession: missing, invalid, expired, wrong type and valid tokens", () => {
  const missing = httpError(() => requireSession(new Request("https://example.test/"), { now, secret }));
  assert.equal(missing.status, 401);
  assert.equal(missing.init.code, "UNAUTHORIZED");

  assert.equal(httpError(() => requireSession(bearer("v1.abc.def"), { now, secret })).init.code, "TOKEN_INVALID");

  const session = createSessionToken(launchSession, { now, secret });
  const expired = httpError(() => requireSession(bearer(session.token), { now: new Date("2026-10-06T10:00:01Z"), secret }));
  assert.equal(expired.status, 401);
  assert.equal(expired.init.code, "TOKEN_EXPIRED");

  const { token: launchToken } = createLaunchToken(
    { tenantId: "demo", connectorId: "tm3-sim", patientId: "p", episodeId: "e", clinician: { name: "A", hcpc: "B" } },
    { now, secret },
  );
  assert.equal(httpError(() => requireSession(bearer(launchToken), { now, secret })).init.code, "TOKEN_INVALID");

  const other = createSessionToken({ ...launchSession, tenantId: "other-clinic" }, { now, secret });
  assert.equal(httpError(() => requireSession(bearer(other.token), { now, secret })).status, 403);

  const claims = requireSession(bearer(session.token), { now: new Date("2026-10-06T09:30:00Z"), secret });
  assert.deepEqual(claims, verifySessionToken(session.token, { now, secret }).ok ? session.claims : null);
});
