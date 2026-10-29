/** The drawer's "History of changes": newest first, UK DD/MM/YYYY HH:mm, redacted for reception like the record History. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuditEntry } from "../../repos/audit";
import { appointmentHistoryRows, ukDateTime } from "./history-rows";

const entry = (id: string, action: string, targetType: string, detail: Record<string, unknown> | null, at = "2026-10-28T09:41:00.000Z", userId: string | null = "u1"): AuditEntry => ({
  id,
  tenantId: "t1",
  userId,
  sessionId: null,
  action,
  targetType,
  targetId: "apt_X",
  detail,
  at,
});
const lookups = { users: new Map([["u1", { name: "Jess Taylor (fictional)", current: true }]]), members: new Map(), keys: new Map() };

describe("appointment history rows", () => {
  it("formats UK time as DD/MM/YYYY HH:mm (24 h, BST and GMT)", () => {
    assert.equal(ukDateTime("2026-10-28T09:41:00.000Z"), "28/10/2026 09:41");
    assert.equal(ukDateTime("2026-07-01T23:05:00.000Z"), "02/07/2026 00:05");
  });

  it("lists newest first without duplicates, with the member's name and the action in words", () => {
    const rows = appointmentHistoryRows(
      [entry("01A", "pms.appointment.book", "pms_appointment", null), entry("01C", "pms.appointment.arrive", "pms_appointment", null), entry("01B", "pms.appointment.move", "pms_appointment", { fields: ["starts_at"] }), entry("01C", "pms.appointment.arrive", "pms_appointment", null)],
      false,
      lookups,
    );
    assert.deepEqual(rows.map((r) => r.what), ["Patient marked as arrived", "Appointment moved", "Appointment booked"]);
    assert.equal(rows[0].who, "Jess Taylor (fictional)");
    assert.equal(rows[0].when, "28/10/2026 09:41");
  });

  it("reception (no clinical.view) keeps only what and when for clinical rows; a clinician sees the detail", () => {
    const note = entry("01D", "pms.note.create", "pms_note", { noteType: "initial_assessment", appointmentId: "apt_X" });
    const reception = appointmentHistoryRows([note], false, lookups);
    const clinician = appointmentHistoryRows([note], true, lookups);
    assert.equal(reception[0].detail, null);
    assert.equal(reception.length, 1);
    assert.ok(reception[0].what.length > 0);
    // The redaction never changes the stored entry.
    assert.deepEqual(note.detail, { noteType: "initial_assessment", appointmentId: "apt_X" });
    assert.ok(clinician.length === 1);
  });
});
