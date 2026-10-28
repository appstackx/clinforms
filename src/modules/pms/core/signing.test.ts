/** Signing details (Member access → Signing details): the HCPC format, demo numbers only in a demo clinic. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SIGNING_COPY, checkSigning, signedByLine } from "./signing";

const real = { demoClinic: false };
const demo = { demoClinic: true };

describe("signing details", () => {
  it("HCPC: PH and digits, typed loosely, stored normalised", () => {
    const r = checkSigning({ registrationBody: "HCPC", registrationNumber: " ph 123-456 ", maySign: true }, real);
    assert.deepEqual(r, { ok: true, value: { registrationBody: "HCPC", registrationNumber: "PH123456", maySign: true } });
    for (const bad of ["123456", "PH12", "PH1234567", "OT123456", "PH12A456"]) {
      const x = checkSigning({ registrationBody: "HCPC", registrationNumber: bad, maySign: true }, real);
      assert.deepEqual(x, { ok: false, fieldErrors: { registrationNumber: SIGNING_COPY.number } }, bad);
    }
  });

  it("PH-DEMO-NN only in a demo clinic (main's demo rules)", () => {
    assert.deepEqual(checkSigning({ registrationBody: "HCPC", registrationNumber: "ph demo 01", maySign: true }, demo), { ok: true, value: { registrationBody: "HCPC", registrationNumber: "PH-DEMO-01", maySign: true } });
    assert.deepEqual(checkSigning({ registrationBody: "HCPC", registrationNumber: "PH-DEMO-01", maySign: true }, real), { ok: false, fieldErrors: { registrationNumber: SIGNING_COPY.demoOnly } });
  });

  it("an unknown register is refused; may sign needs a number; an empty number is allowed when not signing", () => {
    assert.equal(checkSigning({ registrationBody: "GMC", registrationNumber: "PH123456", maySign: true }, real).ok, false);
    assert.deepEqual(checkSigning({ registrationBody: "HCPC", registrationNumber: "", maySign: true }, real), { ok: false, fieldErrors: { registrationNumber: SIGNING_COPY.needNumber } });
    assert.deepEqual(checkSigning({ registrationBody: "HCPC", registrationNumber: "  ", maySign: false }, real), { ok: true, value: { registrationBody: "HCPC", registrationNumber: null, maySign: false } });
  });

  it("how signed notes show it", () => {
    assert.equal(signedByLine("Priya Shah", "Physiotherapist", "HCPC", "PH-DEMO-01"), "Signed by Priya Shah, Physiotherapist · HCPC PH-DEMO-01");
    assert.equal(signedByLine("Priya Shah", null, null, null), "Signed by Priya Shah");
  });
});
