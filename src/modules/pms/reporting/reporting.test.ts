/** Pure rules of the reporting and set-up module: periods, UK time, inputs, figures, CSV, staff access, audit ids. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { auditIdRange, clinicSystemAuditAreas, ulidLowerBound, ulidTime, ulidTimePart } from "./audit-search";
import { NAV_LABEL_MAX, REPORTS, REPORT_IDS, isReportId, reportAccess, reportNavLabel, reportsFor } from "./catalogue";
import { PAYER_TYPE_LABELS, labelOf } from "./copy";
import { csvCell, penceToPounds, rateToPercent, reportFileName, toCsv } from "./csv";
import type { AppointmentFact, DebtFact, RevenueFact } from "./facts";
import {
  agedDebt,
  attendanceByWeek,
  attendanceBy,
  attendanceOf,
  authorisationAlerts,
  barPercent,
  debtBucket,
  formatMinutes,
  formatRate,
  monthSeries,
  debtKey,
  openMinutes,
  openMinutesByDay,
  overduePence,
  patientMix,
  patientMixFromFirstDates,
  previousPeriod,
  revenueBy,
  revenueOf,
  totalUtilisation,
  utilisationByPractitioner,
  utilisationByRoom,
  utilisationBySite,
  weeklyOpenMinutes,
} from "./metrics";
import { addDays, daysInclusive, eachDay, isoWeekday, monthLabel, monthsOf, periodInstants, resolvePeriod, ukDateOf, ukMidnightMs, ukMinutesOf, weekLabel, weekStart, weeksOf } from "./periods";
import { ClosureInputSchema, OpeningHoursInputSchema, TimeOfDaySchema, parseAuditSearch, parseReportFilter, timeToMinutes, minutesToTime } from "./schemas";
import { scopeAllows, scopeFromSiteIds, siteFilterFor, sitesInScope } from "./site-scope";
import { clipToOpening, closureOn, openSessionsOn, openingInfo } from "./opening";
import { coveredMinutes, dayUtilisation, mergeIntervals, subtractIntervals } from "./intervals";
import { checkAvailabilityFacts, checkVisitFacts } from "./fact-checks";

describe("periods (UK calendar)", () => {
  const today = "2026-10-24"; // a Saturday
  it("weeks start on Monday; months, quarters, years", () => {
    assert.equal(isoWeekday(today), 6);
    assert.equal(isoWeekday("2026-10-25"), 7);
    assert.equal(isoWeekday("2026-10-19"), 1);
    const ok = (p: Parameters<typeof resolvePeriod>[0], custom = {}) => {
      const r = resolvePeriod(p, today, custom);
      assert.ok(r.ok, p);
      return [r.period.from, r.period.to, r.period.days];
    };
    assert.deepEqual(ok("this_week"), ["2026-10-19", "2026-10-25", 7]);
    assert.deepEqual(ok("last_week"), ["2026-10-12", "2026-10-18", 7]);
    assert.deepEqual(ok("this_month"), ["2026-10-01", "2026-10-31", 31]);
    assert.deepEqual(ok("last_month"), ["2026-09-01", "2026-09-30", 30]);
    assert.deepEqual(ok("last_30_days"), ["2026-09-25", "2026-10-24", 30]);
    assert.deepEqual(ok("this_quarter"), ["2026-10-01", "2026-12-31", 92]);
    assert.deepEqual(ok("last_quarter"), ["2026-07-01", "2026-09-30", 92]);
    assert.deepEqual(ok("last_12_months"), ["2025-11-01", "2026-10-31", 365]);
    assert.deepEqual(ok("this_year"), ["2026-01-01", "2026-12-31", 365]);
    assert.deepEqual(ok("custom", { from: "2026-02-01", to: "2026-02-28" }), ["2026-02-01", "2026-02-28", 28]);
    assert.deepEqual(resolvePeriod("last_month", "2026-01-15").ok && resolvePeriod("last_month", "2026-01-15"), { ok: true, period: { preset: "last_month", from: "2025-12-01", to: "2025-12-31", days: 31 } });
  });
  it("custom periods are checked: both dates, in order, at most a year", () => {
    assert.deepEqual(resolvePeriod("custom", today, { from: "2026-10-01" }), { ok: false, error: "Enter a start and an end date." });
    assert.deepEqual(resolvePeriod("custom", today, { from: "2026-10-02", to: "2026-10-01" }), { ok: false, error: "The end date is before the start date." });
    assert.equal(resolvePeriod("custom", today, { from: "2024-01-01", to: "2026-01-01" }).ok, false);
    assert.equal(resolvePeriod("custom", today, { from: "2026-02-30", to: "2026-03-01" }).ok, false, "a date that does not exist");
  });
  it("days, months and labels", () => {
    assert.equal(addDays("2026-12-31", 1), "2027-01-01");
    assert.equal(addDays("2028-03-01", -1), "2028-02-29");
    assert.equal(daysInclusive("2026-10-01", "2026-10-01"), 1);
    assert.equal(daysInclusive("2026-10-02", "2026-10-01"), 0);
    assert.deepEqual(eachDay("2026-10-30", "2026-11-02"), ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
    assert.deepEqual(monthsOf("2025-11-15", "2026-02-01"), ["2025-11", "2025-12", "2026-01", "2026-02"]);
    assert.equal(monthLabel("2026-10"), "Oct 2026");
    const prev = previousPeriod({ from: "2026-10-01", to: "2026-10-31", days: 31 });
    assert.deepEqual(prev, { from: "2026-08-31", to: "2026-09-30", days: 31 });
  });
  it("UK time: summer time, winter time and the change-over days", () => {
    assert.equal(ukDateOf("2026-10-24T23:30:00.000Z"), "2026-10-25", "BST: 00:30 the next day");
    assert.equal(ukDateOf("2026-12-24T23:30:00.000Z"), "2026-12-24", "GMT");
    assert.equal(ukMinutesOf("2026-07-01T08:15:00.000Z"), 9 * 60 + 15);
    assert.equal(new Date(ukMidnightMs("2026-07-01")).toISOString(), "2026-06-30T23:00:00.000Z");
    assert.equal(new Date(ukMidnightMs("2026-12-01")).toISOString(), "2026-12-01T00:00:00.000Z");
    assert.equal(new Date(ukMidnightMs("2026-03-29")).toISOString(), "2026-03-29T00:00:00.000Z", "clocks go forward at 01:00 UTC that day");
    assert.equal(new Date(ukMidnightMs("2026-03-30")).toISOString(), "2026-03-29T23:00:00.000Z");
    assert.equal(new Date(ukMidnightMs("2026-10-25")).toISOString(), "2026-10-24T23:00:00.000Z", "clocks go back at 01:00 UTC that day");
    assert.equal(new Date(ukMidnightMs("2026-10-26")).toISOString(), "2026-10-26T00:00:00.000Z");
    assert.deepEqual(periodInstants({ from: "2026-10-01", to: "2026-10-31" }), { start: "2026-09-30T23:00:00.000Z", end: "2026-11-01T00:00:00.000Z" });
  });
});

describe("inputs (opening hours, closures, query strings)", () => {
  it("times are HH:MM in steps of 5 minutes", () => {
    assert.equal(TimeOfDaySchema.safeParse("08:00").success, true);
    assert.equal(TimeOfDaySchema.safeParse("8:00").success, false);
    assert.equal(TimeOfDaySchema.safeParse("24:00").success, false);
    assert.equal(TimeOfDaySchema.safeParse("08:07").success, false);
    assert.equal(timeToMinutes("19:45"), 1185);
    assert.equal(minutesToTime(1185), "19:45");
  });
  it("opening sessions: closing after opening, no overlap on a day, at most three a day", () => {
    const site = "site_01HZZZZZZZZZZZZZZZZZZZZZZZ";
    assert.equal(OpeningHoursInputSchema.safeParse({ siteId: site, sessions: [{ weekday: 1, opensAt: "08:00", closesAt: "13:00" }, { weekday: 1, opensAt: "14:00", closesAt: "20:00" }] }).success, true);
    assert.equal(OpeningHoursInputSchema.safeParse({ siteId: site, sessions: [] }).success, false, "closed all week is refused (switch the site off or add a closure)");
    const overlap = OpeningHoursInputSchema.safeParse({ siteId: site, sessions: [{ weekday: 2, opensAt: "08:00", closesAt: "13:00" }, { weekday: 2, opensAt: "12:00", closesAt: "18:00" }] });
    assert.equal(overlap.success, false);
    assert.match(JSON.stringify(overlap.error?.issues), /overlap/);
    assert.equal(OpeningHoursInputSchema.safeParse({ siteId: site, sessions: [{ weekday: 3, opensAt: "13:00", closesAt: "09:00" }] }).success, false);
    assert.equal(OpeningHoursInputSchema.safeParse({ siteId: site, sessions: [{ weekday: 8, opensAt: "09:00", closesAt: "10:00" }] }).success, false);
    const four = [8, 10, 12, 14].map((h) => ({ weekday: 4, opensAt: `${String(h).padStart(2, "0")}:00`, closesAt: `${String(h + 1).padStart(2, "0")}:00` }));
    assert.equal(OpeningHoursInputSchema.safeParse({ siteId: site, sessions: four }).success, false);
  });
  it("closures: one day by default, never backwards, at most 62 days", () => {
    const one = ClosureInputSchema.parse({ startsOn: "2026-12-25", reason: " Christmas Day " });
    assert.deepEqual(one, { startsOn: "2026-12-25", reason: "Christmas Day" });
    assert.equal(ClosureInputSchema.safeParse({ startsOn: "2026-12-25", endsOn: "2026-12-24" }).success, false);
    assert.equal(ClosureInputSchema.safeParse({ startsOn: "2026-01-01", endsOn: "2026-06-01" }).success, false);
    assert.equal(ClosureInputSchema.safeParse({ startsOn: "2026-12-24", endsOn: "2027-01-01", siteId: null }).success, true);
  });
  it("query strings: unknown or malformed values are dropped", () => {
    assert.deepEqual(parseReportFilter({ period: "last_month", from: "2026-13-01", to: "2026-10-31", site: "site_x", practitioner: ["prac_1", "prac_2"] }), {
      preset: "last_month",
      from: null,
      to: "2026-10-31",
      siteId: "site_x",
      practitionerId: "prac_1",
      serviceId: null,
    });
    assert.deepEqual(parseReportFilter(new URLSearchParams("period=everything&site=%27%3B--&service=svc_1")), { preset: null, from: null, to: null, siteId: null, practitionerId: null, serviceId: "svc_1" });
    const audit = parseAuditSearch({ from: "2026-10-01", area: "pms.patient", action: "DROP TABLE", user: "user_1", type: "pms_patient", record: "pat_01", before: "01JABCDEFGHJKMNPQRSTVWXYZ0" });
    assert.equal(audit.area, "pms.patient");
    assert.equal(audit.action, null);
    assert.equal(audit.targetType, "pms_patient");
    assert.equal(audit.before, "01JABCDEFGHJKMNPQRSTVWXYZ0");
    assert.equal(parseAuditSearch({ before: "not-a-ulid" }).before, null);
  });
});

let n = 0;
function appt(partial: Partial<AppointmentFact>): AppointmentFact {
  n += 1;
  return { month: "2026-10", siteId: "s1", roomId: "r1", practitionerId: "p1", outcome: "attended", appointments: 1, minutes: 30, ...partial };
}

describe("attendance", () => {
  const list = [
    appt({ outcome: "attended", appointments: 2, minutes: 60 }),
    appt({ outcome: "attended", practitionerId: "p2" }),
    appt({ outcome: "dna" }),
    appt({ outcome: "late_cancel", practitionerId: "p2" }),
    appt({ outcome: "cancelled" }),
    appt({ outcome: "unrecorded" }),
    appt({ outcome: "upcoming" }),
    appt({ outcome: "attended", practitionerId: null, appointments: 0, minutes: 0 }),
  ];
  it("rates are out of the appointments that were due", () => {
    const a = attendanceOf(list);
    assert.deepEqual(
      { total: a.total, attended: a.attended, dna: a.dna, late: a.lateCancel, cancelled: a.cancelled, upcoming: a.upcoming, unrecorded: a.unrecorded, due: a.due },
      { total: 8, attended: 3, dna: 1, late: 1, cancelled: 1, upcoming: 1, unrecorded: 1, due: 5 },
    );
    assert.equal(a.dnaRate, 0.2);
    assert.equal(a.lateCancelRate, 0.2);
    assert.equal(formatRate(a.attendedRate), "60.0%");
    assert.equal(attendanceOf([]).dnaRate, null, "nothing due: no rate");
    assert.equal(formatRate(null), "–");
  });
  it("grouped by practitioner, biggest first; no key or nothing in it = left out", () => {
    const rows = attendanceBy(list, (x) => x.practitionerId);
    assert.deepEqual(rows.map((r) => [r.key, r.total, r.dna, r.lateCancel]), [["p1", 6, 1, 0], ["p2", 2, 0, 1]]);
  });
});

describe("opening hours and utilisation", () => {
  const sessions = [
    { siteId: "s1", weekday: 1, opensAt: "08:00", closesAt: "12:00" },
    { siteId: "s1", weekday: 1, opensAt: "13:00", closesAt: "17:00" },
    { siteId: "s1", weekday: 2, opensAt: "09:00", closesAt: "17:00" },
    { siteId: "s2", weekday: 1, opensAt: "09:00", closesAt: "13:00" },
  ];
  // 2026-10-05 Monday, 2026-10-06 Tuesday, 2026-10-12 Monday (closed at s1)
  const closures = [{ siteId: "s1", startsOn: "2026-10-12", endsOn: "2026-10-12" }];
  const period = { from: "2026-10-05", to: "2026-10-12" };
  it("open minutes per weekday, by day, less closures", () => {
    assert.deepEqual(weeklyOpenMinutes(sessions, "s1").slice(1), [480, 480, 0, 0, 0, 0, 0]);
    const byDay = openMinutesByDay(sessions, closures, "s1", period.from, period.to);
    assert.equal(byDay.get("2026-10-05"), 480);
    assert.equal(byDay.get("2026-10-12"), 0, "closed");
    assert.equal(openMinutes(sessions, closures, "s1", period.from, period.to), 960);
    assert.equal(openMinutes(sessions, [{ siteId: null, startsOn: "2026-10-05", endsOn: "2026-10-05" }], "s2", period.from, period.to), 240, "a closure of every site");
  });
  it("by site (rooms count), by room, by practitioner (rota only); cancelled appointments freed their slot", () => {
    const facts = [
      appt({ minutes: 60, siteId: "s1", roomId: "r1", practitionerId: "p1", outcome: "attended" }),
      appt({ minutes: 30, siteId: "s1", roomId: "r2", practitionerId: "p1", outcome: "dna" }),
      appt({ minutes: 30, siteId: "s1", roomId: "r1", practitionerId: "p2", outcome: "cancelled" }),
      appt({ minutes: 45, siteId: "s2", roomId: "r3", practitionerId: "p2", outcome: "upcoming" }),
    ];
    const rooms = [
      { id: "r1", siteId: "s1" },
      { id: "r2", siteId: "s1" },
      { id: "r3", siteId: "s2" },
    ];
    const sites = utilisationBySite(facts, [{ id: "s1" }, { id: "s2" }, { id: "s3" }], rooms, sessions, closures, period);
    const s1 = sites.find((r) => r.key === "s1");
    assert.deepEqual([s1?.bookedMinutes, s1?.attendedMinutes, s1?.availableMinutes, s1?.appointments], [90, 60, 1920, 2]);
    assert.equal(s1?.utilisation, 90 / 1920);
    assert.equal(sites.find((r) => r.key === "s3")?.utilisation, null, "no opening hours: no rate");
    const byRoom = utilisationByRoom(facts, rooms, sessions, closures, period);
    assert.equal(byRoom.find((r) => r.key === "r1")?.utilisation, 60 / 960);
    assert.equal(byRoom.find((r) => r.key === "r3")?.availableMinutes, 480);
    const byPrac = utilisationByPractitioner(facts, [{ id: "p1" }, { id: "p2" }], [
      { practitionerId: "p1", siteId: "s1", month: "2026-10", minutes: 240 },
      { practitionerId: "p1", siteId: "s2", month: "2026-10", minutes: 120 },
    ]);
    assert.equal(byPrac.find((r) => r.key === "p1")?.utilisation, 90 / 360);
    assert.equal(byPrac.find((r) => r.key === "p2")?.utilisation, null, "no working hours recorded");
    assert.equal(byPrac.find((r) => r.key === "p2")?.bookedMinutes, 45);
    assert.deepEqual(totalUtilisation(byPrac), { bookedMinutes: 90, availableMinutes: 360, utilisation: 0.25 });
    assert.equal(formatMinutes(95), "1 h 35 min");
    assert.equal(formatMinutes(1920), "32 h");
    assert.equal(barPercent(0, 10), 0);
    assert.equal(barPercent(0.1, 1000), 1, "small values stay visible");
    assert.equal(barPercent(5, 10), 50);
  });
});

describe("utilisation never passes 100 %: available = (rota ∪ bookings) − blocked time", () => {
  it("interval helpers", () => {
    assert.deepEqual(mergeIntervals([[600, 660], [540, 600], [700, 720], [650, 680], [5, 5]]), [[540, 680], [700, 720]]);
    assert.equal(coveredMinutes([[540, 600], [570, 630]]), 90, "overlaps counted once");
    assert.deepEqual(subtractIntervals([[540, 780]], [[600, 660], [700, 1440]]), [[540, 600], [660, 700]]);
    assert.deepEqual(subtractIntervals([[540, 600]], []), [[540, 600]]);
  });
  it("a booking outside the rota / opening hours counts as available time too", () => {
    // Rota 09:00–12:00 (hours were cut to that after booking); bookings 10:00–11:00 and 14:00–17:00.
    const u = dayUtilisation([[540, 720]], [[600, 660], [840, 1020]], []);
    assert.deepEqual(u, { available: 360, booked: 240, blocked: 0 });
    // The case that showed 275 %: everything booked outside 2 h of opening.
    const all = dayUtilisation([[480, 600]], [[600, 1020]], []);
    assert.equal(all.booked / all.available, 420 / 540);
    assert.ok(all.booked <= all.available);
  });
  it("leave and other blocked time come off the available time; a whole day of leave leaves nothing", () => {
    assert.deepEqual(dayUtilisation([[540, 1020]], [[540, 600]], [[780, 840]]), { available: 420, booked: 60, blocked: 60 });
    assert.deepEqual(dayUtilisation([[540, 1020]], [], [[0, 1440]]), { available: 0, booked: 0, blocked: 480 });
    // Double-booked time counts once.
    assert.deepEqual(dayUtilisation([[540, 600]], [[540, 570], [540, 570]], []), { available: 60, booked: 30, blocked: 0 });
  });
  it("by practitioner: the source's clipped booked minutes win over the appointments' own minutes", () => {
    const facts = [appt({ minutes: 600, siteId: "s1", roomId: null, practitionerId: "p1", outcome: "attended" })];
    const rows = utilisationByPractitioner(facts, [{ id: "p1" }], [{ practitionerId: "p1", siteId: "s1", month: "2026-10", date: "2026-10-05", minutes: 540, bookedMinutes: 420, blockedMinutes: 0 }]);
    assert.equal(rows[0].bookedMinutes, 420);
    assert.equal(rows[0].utilisation, 420 / 540);
    assert.equal(rows[0].attendedMinutes, 600, "attended minutes still from the appointments");
  });
  it("fact checks: booked more than available, or new/returning facts outside the period, are left out", () => {
    const f = { from: "2026-10-01", to: "2026-10-31", siteIds: null, practitionerId: null, known: { siteIds: ["s1"], roomIds: [], practitionerIds: ["p1"] } };
    const a = checkAvailabilityFacts(
      [
        { practitionerId: "p1", siteId: "s1", month: "2026-10", date: "2026-10-05", minutes: 60, bookedMinutes: 30 },
        { practitionerId: "p1", siteId: "s1", month: "2026-10", date: "2026-10-05", minutes: 60, bookedMinutes: 90 },
      ],
      f,
    );
    assert.deepEqual([a.facts.length, a.dropped], [1, 1]);
    const v = checkVisitFacts(
      [
        { month: "2026-10", date: "2026-10-05", siteId: "s1", practitionerId: "p1", firstVisit: true, appointments: 2 },
        { month: "2026-11", date: "2026-11-05", siteId: "s1", practitionerId: "p1", firstVisit: false, appointments: 1 },
        { month: "2026-10", date: "2026-10-05", siteId: "s9", practitionerId: "p1", firstVisit: false, appointments: 1 },
      ],
      f,
    );
    assert.deepEqual([v.facts.length, v.dropped], [1, 2]);
  });
});

describe("new and returning patients", () => {
  it("from first visits or first cases: first date in the period = new", () => {
    const mix = patientMixFromFirstDates(
      [
        { patientId: "a", firstOn: "2026-10-03" },
        { patientId: "a", firstOn: "2026-10-09" },
        { patientId: "b", firstOn: "2024-02-01" },
        { patientId: "c", firstOn: "2026-10-30" },
      ],
      { from: "2026-10-01", to: "2026-10-31" },
    );
    assert.deepEqual(mix, { patients: 3, newPatients: 2, returning: 1, newShare: 2 / 3 });
    assert.deepEqual(patientMix(4, 9), { patients: 4, newPatients: 4, returning: 0, newShare: 1 }, "never more new than seen");
    assert.deepEqual(monthSeries(new Map([["2026-10", 4]]), ["2026-09", "2026-10"]), [
      { month: "2026-09", value: 0 },
      { month: "2026-10", value: 4 },
    ]);
  });
});

describe("revenue and debt", () => {
  it("invoiced less credited; received by payment date", () => {
    const facts: RevenueFact[] = [
      { month: "2026-10", siteId: "s1", practitionerId: "p1", payerType: "self_pay", kind: "invoiced", count: 1, amountPence: 6500 },
      { month: "2026-10", siteId: "s1", practitionerId: "p1", payerType: "insurer", kind: "invoiced", count: 1, amountPence: 5000 },
      { month: "2026-10", siteId: "s1", practitionerId: null, payerType: "insurer", kind: "credited", count: 1, amountPence: 1500 },
      { month: "2026-10", siteId: "s1", practitionerId: null, payerType: "self_pay", kind: "received", count: 2, amountPence: 6000 },
    ];
    assert.deepEqual(revenueOf(facts), { invoicedPence: 11500, creditedPence: 1500, netPence: 10000, receivedPence: 6000, invoices: 2 });
    const byPayer = revenueBy(facts, (f) => f.payerType);
    assert.deepEqual(byPayer.map((r) => [r.key, r.netPence, r.receivedPence]), [["self_pay", 6500, 6000], ["insurer", 3500, 0]]);
    assert.equal(revenueBy(facts, (f) => f.practitionerId).length, 1, "facts without a practitioner are left out of that view");
    assert.equal(labelOf(PAYER_TYPE_LABELS, "mlc"), "Medico-legal company");
  });
  it("aged debt by payer account, from the due date", () => {
    const today = "2026-10-24";
    assert.equal(debtBucket("2026-11-19", today), "not_due");
    assert.equal(debtBucket("2026-10-24", today), "not_due", "due today is not overdue yet – as billing's aged debt");
    assert.equal(debtBucket("2026-10-23", today), "d0_30");
    assert.equal(debtBucket("2026-09-23", today), "d31_60");
    assert.equal(debtBucket("2026-08-24", today), "d61_90");
    assert.equal(debtBucket("2026-01-01", today), "d91_plus");
    const d = (partial: Partial<DebtFact>): DebtFact => ({ payerType: "insurer", payerReferrerId: "ref_a", siteId: "s1", dueOn: today, invoices: 1, outstandingPence: 1000, ...partial });
    const { rows, total } = agedDebt(
      [
        d({ dueOn: "2026-06-01", outstandingPence: 10000 }),
        d({ dueOn: "2026-10-10", outstandingPence: 5000, siteId: "s2" }),
        d({ payerType: "mlc", payerReferrerId: "ref_b", dueOn: "2026-09-01", outstandingPence: 30000 }),
        d({ payerType: "self_pay", payerReferrerId: null, dueOn: "2026-10-20", outstandingPence: 4000, invoices: 2 }),
        d({ payerType: "employer", payerReferrerId: null, outstandingPence: 0 }),
      ],
      today,
    );
    assert.deepEqual(rows.map((r) => [r.key, r.invoices, r.outstandingPence]), [["ref_b", 1, 30000], ["ref_a", 2, 15000], ["self_pay", 2, 4000]]);
    assert.deepEqual(rows[1].buckets, { not_due: 0, d0_30: 5000, d31_60: 0, d61_90: 0, d91_plus: 10000 });
    assert.equal(rows[1].oldestDueOn, "2026-06-01");
    assert.equal(total.outstandingPence, 49000);
    assert.equal(total.invoices, 5);
    assert.equal(overduePence(total), 40000);
    assert.equal(overduePence(total, 90), 10000);
    assert.equal(debtKey({ payerType: "solicitor", payerReferrerId: null }), "solicitor:unassigned");
  });
});

describe("authorisation alerts", () => {
  const base = { status: "active" as const, sessionsAuthorised: 6, valueAuthorisedPence: null, sessionsUsed: 2, valueUsedPence: 0, validFrom: null };
  it("expiring soon, recently expired, used up or nearly; cancelled never; soonest first", () => {
    const list = [
      { ...base, code: "far", expiresOn: "2027-03-01" },
      { ...base, code: "soon", expiresOn: "2026-11-01" },
      { ...base, code: "expired", expiresOn: "2026-10-10" },
      { ...base, code: "old", expiresOn: "2026-01-10" },
      { ...base, code: "last", expiresOn: null, sessionsUsed: 5 },
      { ...base, code: "used", expiresOn: "2026-12-01", sessionsUsed: 6 },
      { ...base, code: "cancelled", status: "cancelled" as const, expiresOn: "2026-10-30" },
    ];
    const alerts = authorisationAlerts(list, "2026-10-24", 14);
    assert.deepEqual(
      alerts.map((a) => [a.authorisation.code, a.reasons]),
      [
        ["expired", ["expired_recently"]],
        ["soon", ["expires_soon"]],
        ["used", ["used_up"]],
        ["last", ["few_sessions_left"]],
      ],
    );
  });
});

describe("CSV", () => {
  it("quotes, neutralises formulas, keeps numbers, starts with a byte-order mark", () => {
    assert.equal(csvCell('Hart, "Meg"'), '"Hart, ""Meg"""');
    assert.equal(csvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
    assert.equal(csvCell("-1"), "'-1");
    assert.equal(csvCell(-1), "-1");
    assert.equal(csvCell(null), "");
    assert.equal(csvCell(true), "yes");
    assert.equal(toCsv(["a", "b"], [[1, "x\ny"]]), '﻿a,b\r\n1,"x\ny"\r\n');
    assert.equal(penceToPounds(12345), 123.45);
    assert.equal(rateToPercent(0.0625), 6.3);
    assert.equal(rateToPercent(null), null);
    assert.equal(reportFileName("utilisation", "riverside-demo", "2026-10-01", "2026-10-31"), "utilisation-riverside-demo-2026-10-01-to-2026-10-31.csv");
  });
});

describe("site access (from the access module's actor.siteIds)", () => {
  it("every site, or the member's sites only", () => {
    assert.deepEqual(scopeFromSiteIds(null), { all: true });
    const limited = scopeFromSiteIds(new Set(["s1", "s2"]));
    assert.deepEqual(limited, { all: false, siteIds: ["s1", "s2"] });
    assert.equal(scopeAllows(limited, "s1"), true);
    assert.equal(scopeAllows(limited, "s3"), false);
    assert.equal(scopeAllows(limited, null), false);
    assert.deepEqual(sitesInScope(limited, [{ id: "s3" }, { id: "s2" }, { id: "s1" }]).map((s) => s.id), ["s2", "s1"]);
    assert.deepEqual(siteFilterFor(limited, "s3"), ["s1", "s2"], "a site outside the scope is ignored");
    assert.deepEqual(siteFilterFor(limited, "s2"), ["s2"]);
    assert.equal(siteFilterFor({ all: true }, null), null);
  });
});

describe("one opening-hours source (rota windows clipped to the site's hours)", () => {
  const info = openingInfo(
    [
      { siteId: "a", weekday: 1, opensAt: "08:00", closesAt: "12:00" },
      { siteId: "a", weekday: 1, opensAt: "13:00", closesAt: "20:00" },
    ],
    [
      { siteId: "a", startsOn: "2026-11-09", endsOn: "2026-11-09", reason: "Training" },
      { siteId: null, startsOn: "2026-12-25", endsOn: "2026-12-28", reason: "Christmas" },
    ],
  );
  const w = (siteId: string, date: string, startMinute: number, endMinute: number) => ({ siteId, date, startMinute, endMinute });
  it("cuts a window to each session, drops closed days, leaves sites without hours alone", () => {
    assert.deepEqual(clipToOpening([w("a", "2026-11-02", 420, 1260)], info).map((x) => [x.startMinute, x.endMinute]), [[480, 720], [780, 1200]]);
    assert.deepEqual(clipToOpening([w("a", "2026-11-03", 540, 600)], info), [], "Tuesday: no session = closed");
    assert.deepEqual(clipToOpening([w("a", "2026-11-09", 540, 600)], info), [], "the site's own closure");
    assert.deepEqual(clipToOpening([w("b", "2026-12-26", 540, 600)], info), [], "an all-sites closure");
    assert.deepEqual(clipToOpening([w("b", "2026-11-03", 420, 1260)], info).map((x) => [x.startMinute, x.endMinute]), [[420, 1260]], "no hours set = not limited");
    assert.equal(openSessionsOn(info, "b", "2026-11-03"), null);
    assert.equal(closureOn(info, "a", "2026-12-25")?.reason, "Christmas");
  });
});

describe("audit ids and areas", () => {
  it("ULID bounds of UK dates", () => {
    const ms = Date.parse("2026-10-24T09:00:00.000Z");
    assert.equal(ulidTimePart(ms).length, 10);
    assert.equal(ulidTime(`${ulidTimePart(ms)}ABCDEFGHJKMNPQRS`), "2026-10-24T09:00:00.000Z");
    assert.equal(ulidTime("nope"), null);
    const { lower, upper } = auditIdRange("2026-10-24", "2026-10-24");
    assert.equal(ulidTime(lower as string), "2026-10-23T23:00:00.000Z");
    assert.equal(ulidTime(upper as string), "2026-10-24T23:00:00.000Z");
    assert.ok((lower as string) < ulidLowerBound(ms) && ulidLowerBound(ms) < (upper as string));
    assert.deepEqual(auditIdRange(null, null), { lower: null, upper: null });
  });
  it("areas come from every module's audit labels", () => {
    const areas = clinicSystemAuditAreas({ "pms.patient.create": "x", "pms.patient.update": "y", "pms.site.create": "z", "clinic.package_change": "w" }, { pms_patient: "Patient" });
    assert.deepEqual(areas, [
      { id: "pms.patient", label: "Patient", actions: ["pms.patient.create", "pms.patient.update"] },
      { id: "pms.site", label: "Site", actions: ["pms.site.create"] },
    ]);
    assert.ok(clinicSystemAuditAreas().some((a) => a.id === "pms.patient"));
  });
});

describe("report catalogue", () => {
  it("every report's navigation label fits the rail (M10: \"New and returning patie…\" was cut off)", () => {
    for (const id of REPORT_IDS) assert.ok(reportNavLabel(REPORTS[id]).length <= NAV_LABEL_MAX, `${id}: ${reportNavLabel(REPORTS[id])}`);
    assert.equal(reportNavLabel(REPORTS.patients), "New and returning");
    assert.equal(REPORTS.patients.title, "New and returning patients");
  });
  it("every report has a page under the reports area", () => {
    for (const id of REPORT_IDS) {
      assert.equal(REPORTS[id].id, id);
      assert.ok(REPORTS[id].href.startsWith("/app/clinic/reports/"), id);
    }
    assert.equal(isReportId("utilisation"), true);
    assert.equal(isReportId("../etc"), false);
  });

  it("who opens what: all reports with reports.all; appointments and caseload only with reports.own; nothing otherwise", () => {
    const can = (granted: string[]) => (p: string) => granted.includes(p);
    assert.equal(reportAccess("revenue", can(["reports.all"])), "all");
    assert.equal(reportAccess("attendance", can(["reports.own"])), "own");
    assert.equal(reportAccess("patients", can(["reports.own"])), "own", "new and returning patients: own caseload like the other appointment reports");
    assert.equal(reportAccess("revenue", can(["reports.own"])), null);
    assert.equal(reportAccess("attendance", can(["reports.export"])), null);
    assert.deepEqual(
      reportsFor(can(["reports.own"])).map((g) => [g.group, g.reports.map((r) => r.id)]),
      [
        ["Appointments", ["attendance", "utilisation", "patients"]],
        ["Clinical", ["caseload"]],
      ],
    );
    assert.deepEqual(reportsFor(can(["reports.all"])).map((g) => g.group), ["Appointments", "Clinical", "Finance"]);
    assert.deepEqual(reportsFor(can([])), []);
  });
});

describe("weeks", () => {
  it("last 6 weeks = this week and the five before (Monday to Sunday); weeks of a period; labels", () => {
    const r = resolvePeriod("last_6_weeks", "2026-10-28");
    assert.ok(r.ok);
    assert.deepEqual([r.period.from, r.period.to, r.period.days], ["2026-09-21", "2026-11-01", 42]);
    assert.deepEqual(weeksOf("2026-09-23", "2026-10-06"), ["2026-09-21", "2026-09-28", "2026-10-05"]);
    assert.equal(weekStart("2026-11-01"), "2026-10-26");
    assert.equal(weekLabel("2026-09-21"), "w/c 21/09/2026");
    assert.equal(weekLabel("2026-09-21", true), "21/09");
  });

  it("attendance by week from dated facts (facts without a date count only in totals)", () => {
    const f = (date: string | undefined, outcome: AppointmentFact["outcome"]): AppointmentFact => ({ month: (date ?? "2026-10-01").slice(0, 7), date, siteId: "s1", roomId: null, practitionerId: "p1", outcome, appointments: 1, minutes: 30 });
    const weeks = attendanceByWeek([f("2026-10-05", "attended"), f("2026-10-07", "dna"), f("2026-10-13", "attended"), f(undefined, "dna")], ["2026-10-05", "2026-10-12", "2026-10-19"]);
    assert.deepEqual(weeks.map((w) => [w.key, w.due, w.dna]), [
      ["2026-10-05", 2, 1],
      ["2026-10-12", 1, 0],
      ["2026-10-19", 0, 0],
    ]);
  });
});
