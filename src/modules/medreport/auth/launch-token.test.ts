import { test } from "node:test";
import assert from "node:assert/strict";
import { createLaunchToken, verifyLaunchToken, LAUNCH_TOKEN_TTL_SECONDS } from "./launch-token";
import { createSessionToken, verifySessionToken } from "./session-token";

const secret = "test-secret-not-used-anywhere-else";
const input = {
  tenantId: "demo",
  connectorId: "tm3-sim" as const,
  patientId: "sim-pat-001",
  episodeId: "sim-ep-001",
  clinician: { name: "S. Reid", hcpc: "PH-DEMO-01" },
};

test("launch token round-trips its claims", () => {
  const now = new Date("2026-10-06T09:00:00Z");
  const issued = createLaunchToken(input, { now, secret });
  assert.equal(issued.claims.exp - issued.claims.iat, LAUNCH_TOKEN_TTL_SECONDS);
  assert.equal(issued.expiresAt, "2026-10-06T09:10:00.000Z");
  const result = verifyLaunchToken(issued.token, { now: new Date("2026-10-06T09:05:00Z"), secret });
  assert.deepEqual(result, { ok: true, claims: issued.claims });
});

test("launch token expires, rejects tampering, the wrong secret and use as a session token", () => {
  const now = new Date("2026-10-06T09:00:00Z");
  const { token } = createLaunchToken(input, { now, secret });
  assert.deepEqual(verifyLaunchToken(token, { now: new Date("2026-10-06T09:10:01Z"), secret }), { ok: false, reason: "expired" });
  assert.deepEqual(verifyLaunchToken(token, { now, secret: "other-secret" }), { ok: false, reason: "bad_signature" });

  const [v, payload, mac] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString()), patientId: "other" })).toString("base64url");
  assert.deepEqual(verifyLaunchToken(`${v}.${forged}.${mac}`, { now, secret }), { ok: false, reason: "bad_signature" });
  assert.deepEqual(verifyLaunchToken("not-a-token", { now, secret }), { ok: false, reason: "malformed" });
  assert.deepEqual(verifySessionToken(token, { now, secret }), { ok: false, reason: "wrong_type" });
});

test("session token round-trips and expires after an hour", () => {
  const now = new Date("2026-10-06T09:00:00Z");
  const session = createSessionToken({ ...input, kind: "launch" }, { now, secret });
  const ok = verifySessionToken(session.token, { now: new Date("2026-10-06T09:59:59Z"), secret });
  assert.equal(ok.ok, true);
  assert.deepEqual(verifySessionToken(session.token, { now: new Date("2026-10-06T10:00:00Z"), secret }), { ok: false, reason: "expired" });
});
