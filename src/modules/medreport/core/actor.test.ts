/**
 * W0.6 shared types (bh2): the Actor every review action carries – who builds one, what it may do, and that its shape is
 * the plan's (W0.3 ActorSchema: memberId, name, role, canSign, hcpc?). Fictional people only.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SYSTEM_ACTOR_NAME, UNKNOWN_MEMBER_ID, demoActor, isApproverActor, isStaffActor, memberActor, namedActor, type Actor } from "./actor";

describe("core/actor.ts (W0.6)", () => {
  it("memberActor: the signed-in member, with their id, role and signing details", () => {
    const sarah = memberActor({ userId: "usr_sarah", name: "Sarah Reid", role: "clinician", canSign: true, hcpc: "PH-DEMO-01" }, "fallback");
    assert.deepEqual(sarah, { memberId: "usr_sarah", name: "Sarah Reid", role: "clinician", canSign: true, hcpc: "PH-DEMO-01" });
    assert.equal(memberActor({ userId: "usr_tom", name: "Tom Ellis", role: "owner", hcpc: "PH-DEMO-02" }, "x").canSign, true, "owners may sign");
  });

  it("memberActor: staff never sign; nor does a member the clinic does not allow, or one without a registration number", () => {
    const pat = memberActor({ userId: "usr_pat", name: "Pat Morgan", role: "staff", canSign: true, hcpc: "PH-DEMO-09" }, "x");
    assert.equal(pat.canSign, false);
    assert.equal(isStaffActor(pat), true);
    assert.equal(memberActor({ userId: "u", name: "Priya Shah", role: "clinician", canSign: false, hcpc: "PH-DEMO-03" }, "x").canSign, false);
    assert.equal(memberActor({ userId: "u", name: "Priya Shah", role: "clinician", hcpc: "  " }, "x").canSign, false);
    assert.equal(memberActor({ userId: "u", name: "Priya Shah", role: "clinician", hcpc: "  " }, "x").hcpc, undefined);
  });

  it("memberActor without a member: the fallback name, an unknown id, not staff (as the NEW-1 stop-gap) and never a signer", () => {
    const a = memberActor(undefined, "Clinic member");
    assert.deepEqual(a, { memberId: UNKNOWN_MEMBER_ID, name: "Clinic member", role: "clinician", canSign: false });
    assert.equal(isStaffActor(a), false);
    assert.equal(memberActor({ name: "No id", role: "clinician" }, "x").memberId, UNKNOWN_MEMBER_ID);
  });

  it("demoActor and namedActor", () => {
    assert.deepEqual(demoActor("Sarah Reid", "PH-DEMO-01"), { memberId: "demo", name: "Sarah Reid", role: "clinician", canSign: true, hcpc: "PH-DEMO-01" });
    assert.deepEqual(demoActor("Clinic staff (demo session)"), { memberId: "demo", name: "Clinic staff (demo session)", role: "clinician", canSign: true });
    assert.deepEqual(namedActor("Pat Morgan", "staff"), { memberId: UNKNOWN_MEMBER_ID, name: "Pat Morgan", role: "staff", canSign: false });
    assert.equal(namedActor("Tom Ellis", "clinician", { hcpc: "PH-DEMO-02" }).canSign, true);
    assert.equal(namedActor("Tom Ellis").canSign, false, "no registration number, no signing");
  });

  it("isApproverActor matches the approver by member id only – never by name, never an unknown member", () => {
    const approver = { memberId: "usr_sarah", name: "Sarah Reid", hcpc: "PH-DEMO-01" };
    assert.equal(isApproverActor(namedActor("Sarah Reid", "clinician", { memberId: "usr_sarah" }), approver), true);
    assert.equal(isApproverActor(namedActor("Sarah Reid", "clinician", { memberId: "usr_other" }), approver), false, "same name, another member");
    assert.equal(isApproverActor(namedActor("Sarah Reid"), { ...approver, memberId: UNKNOWN_MEMBER_ID }), false);
    assert.equal(isApproverActor(namedActor("Sarah Reid", "clinician", { memberId: "usr_sarah" }), null), false, "no approver yet");
  });

  it("the shape is the plan's (W0.3 ActorSchema) and code is never an Actor", () => {
    const keys = (a: Actor) => Object.keys(a).sort();
    assert.deepEqual(keys(memberActor({ userId: "u", name: "Sarah Reid", role: "clinician", hcpc: "PH-DEMO-01" }, "x")), ["canSign", "hcpc", "memberId", "name", "role"]);
    assert.equal(SYSTEM_ACTOR_NAME, "System", "the name the activity log has always shown for the drafting step");
    for (const a of [memberActor(undefined, "x"), demoActor("x"), namedActor("x", "staff")]) {
      assert.ok(a.memberId.length > 0 && a.name.length > 0, "memberId and name are never empty (ActorSchema: min 1)");
      assert.ok(["owner", "admin", "clinician", "staff"].includes(a.role));
    }
  });
});
