/** Courses (PK02): the pure rules – expiry, state, labels, pro rata credit, which course a visit can use. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CourseTypeInputSchema, courseCovers, courseExpiry, courseProgressLabel, courseSaleLine, courseState, offerCourses, parseServiceIds, proRataCredit, type PatientCourse } from "./courses";

const course = (over: Partial<PatientCourse> = {}): PatientCourse => ({
  id: "pcrs_1",
  rev: 1,
  patientId: "pat_1",
  courseTypeId: "crst_1",
  name: "6 follow-ups",
  serviceIds: ["svc_fu"],
  caseId: null,
  saleInvoiceId: "inv_1",
  saleLineId: "invl_1",
  sessionsTotal: 6,
  sessionsUsed: 3,
  soldOn: "2026-11-02",
  expiresOn: "2027-03-12",
  status: "active",
  cancelledAt: null,
  cancelCreditNoteId: null,
  ...over,
});
const visit = (n: number, over: Partial<{ serviceId: string; caseId: string | null; date: string; patientId: string; eligible: boolean }> = {}) => ({
  appointmentId: `appt_${n}`,
  patientId: "pat_1",
  serviceId: "svc_fu",
  caseId: null,
  date: `2026-11-${String(10 + n).padStart(2, "0")}`,
  eligible: true,
  ...over,
});

describe("courses (pure)", () => {
  it("expiry: valid N days counts the day of sale; no days = no expiry", () => {
    assert.equal(courseExpiry("2026-11-02", 1), "2026-11-02");
    assert.equal(courseExpiry("2026-11-02", 180), "2027-04-30");
    assert.equal(courseExpiry("2026-12-31", 31), "2027-01-30");
    assert.equal(courseExpiry("2026-11-02", null), null);
  });

  it("state and the screen's label in UK dates", () => {
    assert.equal(courseState(course(), "2026-11-10"), "active");
    assert.equal(courseState(course(), "2027-03-13"), "expired");
    assert.equal(courseState(course({ sessionsUsed: 6 }), "2026-11-10"), "used_up");
    assert.equal(courseState(course({ status: "cancelled" }), "2026-11-10"), "cancelled");
    assert.equal(courseProgressLabel(course()), "3 of 6 used · expires 12/03/2027");
    assert.equal(courseProgressLabel(course({ expiresOn: null, sessionsUsed: 0 })), "0 of 6 used · no expiry");
  });

  it("pro rata credit of the unused sessions, never more than is left on the line", () => {
    assert.equal(proRataCredit({ totalPence: 27000, creditedPence: 0 }, 6, 3), 13500);
    assert.equal(proRataCredit({ totalPence: 10000, creditedPence: 0 }, 3, 1), 6667);
    assert.equal(proRataCredit({ totalPence: 27000, creditedPence: 20000 }, 6, 0), 7000);
    assert.equal(proRataCredit({ totalPence: 27000, creditedPence: 0 }, 6, 6), 0);
  });

  it("pro rata after a part credit: (line total − already credited) × unused ÷ total, capped at what is left", () => {
    // Review finding 3: £600 for 6, £300 credited (half price agreed), 3 used → the fair refund is £150, not £300.
    assert.equal(proRataCredit({ totalPence: 60000, creditedPence: 30000 }, 6, 3), 15000);
    assert.equal(proRataCredit({ totalPence: 60000, creditedPence: 30000 }, 6, 0), 30000, "nothing used: everything left");
    assert.equal(proRataCredit({ totalPence: 60000, creditedPence: 60000 }, 6, 1), 0, "nothing left to credit");
    assert.equal(proRataCredit({ totalPence: 10000, creditedPence: 1 }, 3, 1), 6666);
  });

  it("covers: the service, the case, the date, a session left, active only", () => {
    assert.equal(courseCovers(course(), visit(1)), true);
    assert.equal(courseCovers(course(), visit(1, { serviceId: "svc_ia" })), false);
    assert.equal(courseCovers(course({ caseId: "case_1" }), visit(1)), false);
    assert.equal(courseCovers(course({ caseId: "case_1" }), visit(1, { caseId: "case_1" })), true);
    assert.equal(courseCovers(course(), visit(1, { date: "2027-03-13" })), false);
    assert.equal(courseCovers(course({ sessionsUsed: 6 }), visit(1)), false);
    assert.equal(courseCovers(course({ status: "used_up" }), visit(1)), false);
    assert.equal(courseCovers(course(), visit(1, { patientId: "pat_2" })), false);
  });

  it("offers count down in date order, the course running out first goes first, never more than is left", () => {
    const soon = course({ id: "pcrs_soon", sessionsTotal: 2, sessionsUsed: 1, expiresOn: "2026-12-01" });
    const later = course({ id: "pcrs_later", sessionsTotal: 3, sessionsUsed: 0, expiresOn: null });
    const offers = offerCourses([visit(3), visit(1), visit(2), visit(4), visit(5), visit(6, { eligible: false })], [later, soon]);
    assert.deepEqual(
      Array.from(offers.entries()).map(([a, o]) => [a, o.patientCourseId, o.label]),
      [
        ["appt_1", "pcrs_soon", "Use course (1 of 2 left)"],
        ["appt_2", "pcrs_later", "Use course (3 of 3 left)"],
        ["appt_3", "pcrs_later", "Use course (2 of 3 left)"],
        ["appt_4", "pcrs_later", "Use course (1 of 3 left)"],
      ],
    );
  });

  it("the sale line, the input schema and stored service ids", () => {
    assert.deepEqual(courseSaleLine({ name: "6 follow-ups", pricePence: 27000, vatCode: "exempt" }), { kind: "item", description: "Course: 6 follow-ups", quantity: 1, unitPricePence: 27000, vatCode: "exempt" });
    assert.equal(CourseTypeInputSchema.safeParse({ name: "x", serviceIds: ["svc_1"], sessions: 6, pricePence: 100, validDays: null }).success, true);
    assert.equal(CourseTypeInputSchema.safeParse({ name: "x", serviceIds: [], sessions: 6, pricePence: 100 }).success, false);
    assert.equal(CourseTypeInputSchema.safeParse({ name: "x", serviceIds: ["svc_1"], sessions: 101, pricePence: 100 }).success, false);
    assert.deepEqual(parseServiceIds('["a","b",3]'), ["a", "b"]);
    assert.deepEqual(parseServiceIds("not json"), []);
  });
});
