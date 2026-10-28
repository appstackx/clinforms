/**
 * The diary's pure rules: UK time incl. the clock changes, statuses, clashes, recurring dates, rotas, free slots,
 * the grid layout and the input schemas. Run by `npm run test:pms` / `npm run test:db`.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { STATUS_LABELS, STATUS_TAGS } from "./copy";
import {
  canChangeStatus,
  canMove,
  findClashes,
  freeSlots,
  gridHours,
  isChargeableStatus,
  isLateCancellation,
  isOverridableClash,
  layoutColumn,
  localSpan,
  occupiesDiary,
  practitionerOverbookings,
  recurringDates,
  reportingStatus,
  ruleAppliesOn,
  rulesOverlap,
  statusOfRow,
  storedStatus,
  timeOfDay,
  windowsOn,
  withinWorkingHours,
  APPOINTMENT_STATUSES,
  OCCUPYING_STATUSES,
  type DiaryItemLike,
  type RotaRule,
} from "./rules";
import { AvailabilityInputSchema, BlockInputSchema, BookAppointmentSchema, MoveAppointmentSchema, WaitingListInputSchema, endMinuteOf } from "./schemas";
import {
  addDays,
  daysBetween,
  formatDayHeading,
  formatDayShort,
  formatHhmm,
  formatLondonTime,
  isCanonicalIso,
  isoWeekday,
  londonDayRange,
  londonParts,
  londonToUtc,
  mondayOf,
  parseHhmm,
  weekDates,
  weeksBetween,
} from "./time";

describe("UK time (Europe/London)", () => {
  it("winter is GMT, summer is BST", () => {
    assert.deepEqual(londonToUtc("2026-01-15", 9 * 60), { ok: true, iso: "2026-01-15T09:00:00.000Z" });
    assert.deepEqual(londonToUtc("2026-07-15", 9 * 60), { ok: true, iso: "2026-07-15T08:00:00.000Z" });
    assert.equal(formatLondonTime("2026-07-15T08:00:00.000Z"), "09:00");
    assert.equal(formatLondonTime("2026-01-15T09:00:00.000Z"), "09:00");
  });

  it("spring forward (29 March 2026): 01:00–01:59 does not exist, 02:00 is BST", () => {
    assert.deepEqual(londonToUtc("2026-03-29", 60), { ok: false, reason: "gap" });
    assert.deepEqual(londonToUtc("2026-03-29", 90), { ok: false, reason: "gap" });
    assert.deepEqual(londonToUtc("2026-03-29", 0), { ok: true, iso: "2026-03-29T00:00:00.000Z" });
    assert.deepEqual(londonToUtc("2026-03-29", 120), { ok: true, iso: "2026-03-29T01:00:00.000Z" });
    assert.deepEqual(londonToUtc("2026-03-29", 9 * 60), { ok: true, iso: "2026-03-29T08:00:00.000Z" });
    const day = londonDayRange("2026-03-29");
    assert.equal((Date.parse(day.to) - Date.parse(day.from)) / 3_600_000, 23, "a 23-hour day");
  });

  it("fall back (25 October 2026): 01:00–01:59 happens twice – the first (BST) one is taken", () => {
    assert.deepEqual(londonToUtc("2026-10-25", 90), { ok: true, iso: "2026-10-25T00:30:00.000Z" });
    assert.equal(londonParts("2026-10-25T01:30:00.000Z").minute, 90, "the second 01:30 (GMT) reads the same on the clock");
    assert.deepEqual(londonToUtc("2026-10-25", 9 * 60), { ok: true, iso: "2026-10-25T09:00:00.000Z" });
    assert.deepEqual(londonToUtc("2026-10-24", 9 * 60), { ok: true, iso: "2026-10-24T08:00:00.000Z" });
    const day = londonDayRange("2026-10-25");
    assert.equal((Date.parse(day.to) - Date.parse(day.from)) / 3_600_000, 25, "a 25-hour day");
    assert.deepEqual(londonDayRange("2026-10-24"), { from: "2026-10-23T23:00:00.000Z", to: "2026-10-24T23:00:00.000Z" });
  });

  it("midnight at the end of a day and past it roll into the next day", () => {
    assert.deepEqual(londonToUtc("2026-07-15", 1440), { ok: true, iso: "2026-07-15T23:00:00.000Z" });
    assert.deepEqual(londonToUtc("2026-12-31", 1440), { ok: true, iso: "2027-01-01T00:00:00.000Z" });
    assert.deepEqual(londonToUtc("2026-02-30", 600), { ok: false, reason: "gap" }, "not a date");
  });

  it("23:30 UTC in summer is already the next day in London; in winter it is not", () => {
    assert.deepEqual(londonParts("2026-07-15T23:30:00.000Z"), { date: "2026-07-16", minute: 30, weekday: 4 });
    assert.deepEqual(londonParts("2026-01-15T23:30:00.000Z"), { date: "2026-01-15", minute: 23 * 60 + 30, weekday: 4 });
  });

  it("calendar helpers", () => {
    assert.equal(addDays("2026-10-24", 8), "2026-11-01");
    assert.equal(addDays("2026-03-01", -1), "2026-02-28");
    assert.equal(daysBetween("2026-10-24", "2026-11-01"), 8);
    assert.equal(isoWeekday("2026-10-24"), 6, "a Saturday");
    assert.equal(isoWeekday("2026-10-25"), 7, "a Sunday");
    assert.equal(mondayOf("2026-10-25"), "2026-10-19");
    assert.equal(weeksBetween("2026-10-19", "2026-11-02"), 2);
    assert.deepEqual(weekDates("2026-10-21").slice(0, 2), ["2026-10-19", "2026-10-20"]);
    assert.equal(parseHhmm("09:30"), 570);
    assert.equal(parseHhmm("9:30"), null);
    assert.equal(parseHhmm("24:00"), null);
    assert.equal(formatHhmm(570), "09:30");
    assert.equal(endMinuteOf("24:00"), 1440);
    assert.equal(formatDayHeading("2026-10-24"), "Saturday 24 October 2026");
    assert.equal(formatDayShort("2026-10-24"), "Sat 24 Oct");
    assert.equal(isCanonicalIso("2026-10-24T09:00:00.000Z"), true);
    assert.equal(isCanonicalIso("2026-10-24T09:00:00Z"), false, "no milliseconds: would compare wrongly as text");
  });
});

describe("statuses", () => {
  it("every status has a label and a short tag", () => {
    for (const s of APPOINTMENT_STATUSES) {
      assert.ok(STATUS_LABELS[s] && STATUS_TAGS[s], s);
    }
  });

  it("occupying statuses keep the slot; cancellations free it", () => {
    assert.deepEqual(APPOINTMENT_STATUSES.filter(occupiesDiary), ["booked", "arrived", "in_treatment", "attended", "dna"]);
    // The database's list: in treatment is stored as arrived (+ treatment_started_at).
    assert.deepEqual([...OCCUPYING_STATUSES], ["booked", "arrived", "attended", "dna"]);
  });

  it("in treatment (Khuram's decision B): booked → arrived → in treatment → attended, each step undone", () => {
    assert.deepEqual([...APPOINTMENT_STATUSES], ["booked", "arrived", "in_treatment", "attended", "dna", "late_cancelled", "cancelled"]);
    assert.equal(canChangeStatus("appointment", "arrived", "in_treatment"), true, "Start treatment");
    assert.equal(canChangeStatus("appointment", "in_treatment", "arrived"), true, "undo goes back to arrived");
    assert.equal(canChangeStatus("appointment", "in_treatment", "attended"), true, "completed");
    assert.equal(canChangeStatus("appointment", "attended", "in_treatment"), true, "undo completed");
    assert.equal(canChangeStatus("appointment", "booked", "in_treatment"), false, "arrive first");
    assert.equal(canChangeStatus("appointment", "in_treatment", "dna"), false);
    assert.equal(canChangeStatus("appointment", "in_treatment", "cancelled"), false);
    assert.equal(canChangeStatus("block", "booked", "in_treatment"), false);
    assert.equal(canMove("in_treatment"), false, "treatment under way");
    assert.equal(storedStatus("in_treatment"), "arrived");
    assert.equal(storedStatus("attended"), "attended");
    assert.equal(statusOfRow("arrived", "2026-10-27T13:30:00.000Z"), "in_treatment");
    assert.equal(statusOfRow("arrived", null), "arrived");
    assert.equal(statusOfRow("attended", "2026-10-27T13:30:00.000Z"), "attended", "completed keeps when treatment started");
    // Billing: not billable until attended; reports count in treatment as arrived.
    assert.equal(isChargeableStatus("in_treatment"), false);
    assert.equal(isChargeableStatus("arrived"), false);
    assert.equal(isChargeableStatus("attended"), true);
    assert.equal(isChargeableStatus("dna"), true);
    assert.equal(isChargeableStatus("late_cancelled"), true);
    assert.equal(reportingStatus("in_treatment"), "arrived");
    // On screen "attended" is "Completed" everywhere; in treatment has its own words.
    assert.equal(STATUS_LABELS.attended, "Completed");
    assert.equal(STATUS_TAGS.attended, "Completed");
    assert.equal(STATUS_LABELS.in_treatment, "In treatment");
    assert.equal(STATUS_LABELS.dna, "Did not attend");
  });

  it("double-booking (Khuram's decision A): only a practitioner's other appointment, or the patient's own, may be overridden", () => {
    const base = { withId: "x", startsAt: "a", endsAt: "b" };
    assert.equal(isOverridableClash({ ...base, resource: "practitioner", withKind: "appointment" }), true);
    assert.equal(isOverridableClash({ ...base, resource: "practitioner", withKind: "block" }), false, "never over leave or a meeting");
    assert.equal(isOverridableClash({ ...base, resource: "room", withKind: "appointment" }), false, "rooms stay strict");
    assert.equal(isOverridableClash({ ...base, resource: "room", withKind: "block" }), false);
    assert.equal(isOverridableClash({ ...base, resource: "patient", withKind: "appointment" }), true);
    assert.deepEqual(
      practitionerOverbookings([
        { ...base, withId: "p1", resource: "practitioner", withKind: "appointment" },
        { ...base, withId: "r1", resource: "room", withKind: "appointment" },
        { ...base, withId: "b1", resource: "practitioner", withKind: "block" },
      ]).map((c) => c.withId),
      ["p1"],
    );
  });

  it("allowed changes", () => {
    assert.equal(canChangeStatus("appointment", "booked", "attended"), true);
    assert.equal(canChangeStatus("appointment", "booked", "late_cancelled"), true);
    assert.equal(canChangeStatus("appointment", "attended", "cancelled"), false, "an attended appointment is history");
    assert.equal(canChangeStatus("appointment", "attended", "booked"), true, "undo a mistaken click");
    assert.equal(canChangeStatus("appointment", "cancelled", "booked"), true, "reinstate");
    assert.equal(canChangeStatus("appointment", "booked", "booked"), false);
    assert.equal(canChangeStatus("block", "booked", "attended"), false);
    assert.equal(canChangeStatus("block", "booked", "cancelled"), true);
    assert.equal(canMove("booked"), true);
    assert.equal(canMove("attended"), false);
    assert.equal(canMove("cancelled"), false);
  });

  it("late cancellation: under 24 hours before the start, or after it", () => {
    const start = "2026-10-26T10:00:00.000Z";
    assert.equal(isLateCancellation(start, "2026-10-25T09:59:00.000Z"), false);
    assert.equal(isLateCancellation(start, "2026-10-25T10:01:00.000Z"), true);
    assert.equal(isLateCancellation(start, "2026-10-26T11:00:00.000Z"), true);
    assert.equal(isLateCancellation(start, "2026-10-24T10:00:00.000Z", 48), false);
  });
});

describe("clashes", () => {
  const item = (id: string, start: string, end: string, extra: Partial<DiaryItemLike> = {}): DiaryItemLike => ({
    id,
    kind: "appointment",
    status: "booked",
    practitionerId: "prac_A",
    roomId: "room_1",
    patientId: "pat_1",
    startsAt: `2026-10-26T${start}:00.000Z`,
    endsAt: `2026-10-26T${end}:00.000Z`,
    ...extra,
  });
  const existing = [
    item("a1", "09:00", "09:30"),
    item("a2", "10:00", "10:45", { practitionerId: "prac_B", roomId: "room_2", patientId: "pat_2" }),
    item("a3", "11:00", "11:30", { status: "cancelled" }),
    item("b1", "12:00", "13:00", { kind: "block", patientId: null, roomId: null }),
  ];

  it("touching items do not clash (half-open times)", () => {
    assert.deepEqual(findClashes({ practitionerId: "prac_A", roomId: "room_1", startsAt: "2026-10-26T09:30:00.000Z", endsAt: "2026-10-26T10:00:00.000Z" }, existing), []);
  });

  it("practitioner, room and patient clashes are told apart", () => {
    const c = findClashes({ practitionerId: "prac_A", roomId: "room_2", patientId: "pat_2", startsAt: "2026-10-26T09:15:00.000Z", endsAt: "2026-10-26T10:15:00.000Z" }, existing);
    assert.deepEqual(
      c.map((x) => `${x.resource}:${x.withId}`),
      ["practitioner:a1", "room:a2", "patient:a2"],
    );
  });

  it("cancelled items free the slot; blocks stop bookings; an item never clashes with itself", () => {
    assert.deepEqual(findClashes({ practitionerId: "prac_A", roomId: "room_1", startsAt: "2026-10-26T11:00:00.000Z", endsAt: "2026-10-26T11:30:00.000Z" }, existing), []);
    assert.deepEqual(
      findClashes({ practitionerId: "prac_A", roomId: null, startsAt: "2026-10-26T12:30:00.000Z", endsAt: "2026-10-26T12:45:00.000Z" }, existing).map((x) => x.withKind),
      ["block"],
    );
    assert.deepEqual(findClashes({ id: "a1", practitionerId: "prac_A", roomId: "room_1", startsAt: "2026-10-26T09:10:00.000Z", endsAt: "2026-10-26T09:40:00.000Z" }, existing), []);
  });
});

describe("recurring bookings", () => {
  it("weekly and fortnightly dates, capped at 52", () => {
    assert.deepEqual(recurringDates("2026-10-20", 1, 3), ["2026-10-20", "2026-10-27", "2026-11-03"]);
    assert.deepEqual(recurringDates("2026-10-20", 2, 2), ["2026-10-20", "2026-11-03"]);
    assert.equal(recurringDates("2026-10-20", 1, 500).length, 52);
  });

  it("a weekly 09:00 booking stays at 09:00 across the clock change (the instant moves by an hour)", () => {
    const [before, after] = recurringDates("2026-10-20", 1, 2).map((d) => londonToUtc(d, 540));
    assert.deepEqual([before, after], [
      { ok: true, iso: "2026-10-20T08:00:00.000Z" },
      { ok: true, iso: "2026-10-27T09:00:00.000Z" },
    ]);
  });
});

describe("rotas", () => {
  const rule = (extra: Partial<RotaRule> = {}): RotaRule => ({
    practitionerId: "prac_A",
    siteId: "site_1",
    roomId: "room_1",
    weekday: 1,
    startMinute: 9 * 60,
    endMinute: 17 * 60,
    everyWeeks: 1,
    validFrom: "2026-10-05",
    validTo: null,
    active: true,
    ...extra,
  });

  it("weekday, date range and every-other-week", () => {
    assert.equal(ruleAppliesOn(rule(), "2026-10-26"), true);
    assert.equal(ruleAppliesOn(rule(), "2026-10-27"), false, "a Tuesday");
    assert.equal(ruleAppliesOn(rule(), "2026-09-28"), false, "before it starts");
    assert.equal(ruleAppliesOn(rule({ validTo: "2026-10-19" }), "2026-10-26"), false, "after it ends");
    const fortnightly = rule({ everyWeeks: 2 });
    assert.deepEqual(["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"].map((d) => ruleAppliesOn(fortnightly, d)), [true, false, true, false]);
    assert.equal(ruleAppliesOn(rule({ active: false }), "2026-10-26"), false);
  });

  it("windows of a day and working hours", () => {
    const rules = [rule(), rule({ practitionerId: "prac_B", startMinute: 12 * 60, endMinute: 20 * 60 }), rule({ weekday: 2 })];
    const windows = windowsOn("2026-10-26", rules);
    assert.deepEqual(windows.map((w) => `${w.practitionerId} ${formatHhmm(w.startMinute)}-${formatHhmm(w.endMinute)}`), ["prac_A 09:00-17:00", "prac_B 12:00-20:00"]);
    assert.equal(withinWorkingHours(windows, "prac_A", "2026-10-26", 9 * 60, 9 * 60 + 30), true);
    assert.equal(withinWorkingHours(windows, "prac_A", "2026-10-26", 16 * 60 + 45, 17 * 60 + 15), false);
  });

  it("overlapping rota entries of one practitioner are found, alternate weeks are not", () => {
    assert.equal(rulesOverlap(rule(), rule({ startMinute: 16 * 60, endMinute: 18 * 60 })), true);
    assert.equal(rulesOverlap(rule(), rule({ startMinute: 17 * 60, endMinute: 18 * 60 })), false, "back to back");
    assert.equal(rulesOverlap(rule(), rule({ weekday: 2 })), false);
    assert.equal(rulesOverlap(rule({ validTo: "2026-10-19" }), rule({ validFrom: "2026-10-26" })), false, "one ends before the other starts");
    assert.equal(rulesOverlap(rule({ everyWeeks: 2 }), rule({ everyWeeks: 2, validFrom: "2026-10-12" })), false, "alternate weeks");
    assert.equal(rulesOverlap(rule({ everyWeeks: 2 }), rule({ everyWeeks: 2, validFrom: "2026-10-19" })), true, "the same weeks");
  });
});

describe("free slots", () => {
  const windows = windowsOn("2026-10-26", [
    { practitionerId: "prac_A", siteId: "site_1", roomId: "room_1", weekday: 1, startMinute: 540, endMinute: 660, everyWeeks: 1, validFrom: "2026-01-05", validTo: null, active: true },
  ]);

  it("30-minute slots between bookings, at 15-minute steps; room and practitioner both count", () => {
    const slots = freeSlots({
      windows,
      busy: [
        { practitionerId: "prac_A", roomId: "room_1", startsAt: "2026-10-26T09:30:00.000Z", endsAt: "2026-10-26T10:00:00.000Z" },
        { practitionerId: "prac_Z", roomId: "room_1", startsAt: "2026-10-26T10:30:00.000Z", endsAt: "2026-10-26T10:45:00.000Z" },
      ],
      durationMinutes: 30,
    });
    assert.deepEqual(slots.map((s) => formatHhmm(s.startMinute)), ["09:00", "10:00"]);
  });

  it("not before now; nothing for a zero duration", () => {
    assert.deepEqual(freeSlots({ windows, busy: [], durationMinutes: 60, notBefore: "2026-10-26T09:50:00.000Z" }).map((s) => formatHhmm(s.startMinute)), ["10:00"]);
    assert.deepEqual(freeSlots({ windows, busy: [], durationMinutes: 0 }), []);
  });

  it("the spring gap has no slots; the day's other hours are in BST", () => {
    const w = windowsOn("2026-03-29", [{ practitionerId: "p", siteId: "s", roomId: null, weekday: 7, startMinute: 0, endMinute: 180, everyWeeks: 1, validFrom: "2026-01-04", validTo: null, active: true }]);
    const slots = freeSlots({ windows: w, busy: [], durationMinutes: 60, stepMinutes: 60 });
    assert.deepEqual(slots.map((s) => `${formatHhmm(s.startMinute)} ${s.startsAt}`), ["00:00 2026-03-29T00:00:00.000Z", "02:00 2026-03-29T01:00:00.000Z"]);
  });
});

describe("day grid layout", () => {
  it("boxes from local times; overlapping items share the column in lanes", () => {
    const items = [
      { id: "x", startsAt: "2026-10-26T09:00:00.000Z", endsAt: "2026-10-26T09:30:00.000Z" },
      { id: "y", startsAt: "2026-10-26T09:15:00.000Z", endsAt: "2026-10-26T09:45:00.000Z" },
      { id: "z", startsAt: "2026-10-26T11:00:00.000Z", endsAt: "2026-10-26T11:05:00.000Z" },
    ];
    const boxes = layoutColumn(items, "2026-10-26", 8 * 60, 18 * 60);
    assert.deepEqual(boxes, [
      { id: "x", top: 60, height: 30, lane: 0, lanes: 2 },
      { id: "y", top: 75, height: 30, lane: 1, lanes: 2 },
      { id: "z", top: 180, height: 10, lane: 0, lanes: 1 },
    ]);
  });

  it("summer times are drawn at their UK time", () => {
    const [box] = layoutColumn([{ id: "s", startsAt: "2026-07-15T08:00:00.000Z", endsAt: "2026-07-15T08:30:00.000Z" }], "2026-07-15", 8 * 60, 18 * 60);
    assert.equal(box.top, 60, "09:00 BST is one hour after 08:00 on the grid");
  });

  it("an item before midnight is clamped to the day", () => {
    assert.deepEqual(localSpan({ startsAt: "2026-10-26T23:30:00.000Z", endsAt: "2026-10-27T00:30:00.000Z" }, "2026-10-26"), { start: 1410, end: 1440 });
    assert.deepEqual(localSpan({ startsAt: "2026-10-26T23:30:00.000Z", endsAt: "2026-10-27T00:30:00.000Z" }, "2026-10-27"), { start: 0, end: 30 });
  });

  it("grid hours cover the windows and items, in whole hours", () => {
    assert.deepEqual(gridHours([{ startMinute: 7 * 60 + 30, endMinute: 20 * 60 + 15 }], []), { start: 7 * 60, end: 21 * 60 });
    assert.deepEqual(gridHours([], []), { start: 8 * 60, end: 18 * 60 });
    assert.equal(timeOfDay(11 * 60 + 59), "morning");
    assert.equal(timeOfDay(17 * 60), "evening");
  });
});

describe("input schemas", () => {
  const ids = { patientId: "pat_01J00000000000000000000000", serviceId: "svc_01J00000000000000000000000", practitionerId: "prac_01J00000000000000000000000", siteId: "site_01J00000000000000000000000" };

  it("a booking: date, 24-hour time, optional room, a repeat of 2–52", () => {
    assert.equal(BookAppointmentSchema.safeParse({ ...ids, date: "2026-10-26", startTime: "09:30", roomId: "" }).success, true);
    assert.equal(BookAppointmentSchema.parse({ ...ids, date: "2026-10-26", startTime: "09:30", roomId: "" }).roomId, null, '"" means no room');
    assert.equal(BookAppointmentSchema.safeParse({ ...ids, date: "2026-10-26", startTime: "9.30" }).success, false);
    assert.equal(BookAppointmentSchema.safeParse({ ...ids, date: "2026-02-30", startTime: "09:30" }).success, false);
    assert.equal(BookAppointmentSchema.safeParse({ ...ids, date: "2026-10-26", startTime: "09:30", repeat: { intervalWeeks: 1, occurrences: 1 } }).success, false);
    assert.equal(BookAppointmentSchema.safeParse({ ...ids, date: "2026-10-26", startTime: "09:30", authorisationId: "auth_01J00000000000000000000000" }).success, false, "an authorisation needs its case");
  });

  it("a move keeps the revision; a block needs a practitioner or a room and an end after the start", () => {
    assert.equal(MoveAppointmentSchema.safeParse({ date: "2026-10-26", startTime: "10:00" }).success, false, "no revision");
    assert.equal(BlockInputSchema.safeParse({ siteId: ids.siteId, blockKind: "leave", date: "2026-10-26", startTime: "08:00", endTime: "24:00" }).success, false);
    assert.equal(BlockInputSchema.safeParse({ siteId: ids.siteId, practitionerId: ids.practitionerId, blockKind: "leave", date: "2026-10-26", startTime: "08:00", endTime: "24:00" }).success, true);
    assert.equal(BlockInputSchema.safeParse({ siteId: ids.siteId, practitionerId: ids.practitionerId, blockKind: "leave", date: "2026-10-26", startTime: "10:00", endTime: "09:00" }).success, false);
  });

  it("rota entries and waiting-list entries", () => {
    const base = { practitionerId: ids.practitionerId, siteId: ids.siteId, weekday: 1, startTime: "09:00", endTime: "17:00", validFrom: "2026-10-26" };
    assert.equal(AvailabilityInputSchema.safeParse(base).success, true);
    assert.equal(AvailabilityInputSchema.safeParse({ ...base, weekday: 8 }).success, false);
    assert.equal(AvailabilityInputSchema.safeParse({ ...base, validTo: "2026-10-01" }).success, false);
    assert.deepEqual(WaitingListInputSchema.parse({ patientId: ids.patientId, preferredDays: [5, 1, 1] }).preferredDays, [1, 5]);
    assert.equal(WaitingListInputSchema.safeParse({ patientId: ids.patientId, earliestOn: "2026-11-02", latestOn: "2026-11-01" }).success, false);
  });
});
