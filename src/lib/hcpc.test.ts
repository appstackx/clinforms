/**
 * Members' signing numbers (Settings → Members, src/app/app/(clinic)/settings/members/actions.ts): a registration
 * number in any clinic; the made-up demo format PH-DEMO-NN only in a demo clinic (its plan, read on the server).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isValidHcpc, normaliseHcpc, signingNumberFor } from "./hcpc";

describe("signingNumberFor", () => {
  it("a real clinic: registration numbers only, exactly as before – a made-up PH-DEMO number is refused", () => {
    assert.equal(signingNumberFor("ph 123456", { demoClinic: false }), "PH123456");
    assert.equal(signingNumberFor("PH-123456", { demoClinic: false }), "PH123456");
    assert.equal(signingNumberFor("OT12345", { demoClinic: false }), "OT12345");
    for (const v of ["PH-DEMO-01", "ph demo 02", "PHDEMO03", "123456", "PH-DEMO-1", "PH12", "-"]) assert.equal(signingNumberFor(v, { demoClinic: false }), null, v);
    assert.equal(isValidHcpc("PH-DEMO-01"), false, "the strict check itself never accepts a made-up number");
    // Every number the old check accepted is accepted, and stored the same way.
    for (const v of ["PH123456", "ph 1234", "SL 123456", "abc12345"]) assert.equal(signingNumberFor(v, { demoClinic: false }), isValidHcpc(v) ? normaliseHcpc(v) : null, v);
  });

  it("a demo clinic: PH-DEMO-NN too (stored as PH-DEMO-NN), and registration numbers as before", () => {
    assert.equal(signingNumberFor("ph-demo-01", { demoClinic: true }), "PH-DEMO-01");
    assert.equal(signingNumberFor("PH DEMO 02", { demoClinic: true }), "PH-DEMO-02");
    assert.equal(signingNumberFor("PHDEMO10", { demoClinic: true }), "PH-DEMO-10");
    assert.equal(signingNumberFor("PH123456", { demoClinic: true }), "PH123456");
    for (const v of ["PH-DEMO-001", "PH-DEMO-1", "XX-DEMO-01", ""]) assert.equal(signingNumberFor(v, { demoClinic: true }), null, v);
  });
});
