/**
 * apply-map-edits (bh2 WE design 6): the edit list's rules on fictional maps – set and replace by field id, session
 * questions mapped by the number in their printed label (never by position), every edit checked, nothing guessed.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyEditList, applyTemplateEdits, type MapsFile } from "./apply-map-edits";
import { CliError } from "./cli";

const field = (id: string, label: string, patch: Record<string, unknown> = {}) => ({
  id,
  label,
  guidance: "",
  answerType: "date",
  anchor: { kind: "docx", target: "table_cell", blockId: `t0.r${Number(id.slice(2))}.c1` },
  fillSource: { kind: "notes_narrative" },
  required: false,
  confidence: "high",
  ...patch,
});

/** A fictional discharge form whose session table is stored in reading order (7, 1, 8, 2 …). */
const maps = (): Record<string, MapsFile> => ({
  "orchard.maps.json": {
    "Orchard EOTS.rtf": {
      title: "Orchard Discharge (fictional)",
      referrer: { name: "Orchard Case Management (fictional)", type: "case_manager" },
      file: { sha256: "a".repeat(64), fileName: "Orchard EOTS.rtf" },
      warnings: ["An old note (fictional)."],
      fields: [
        field("F-01", "Session date 7"),
        field("F-02", "Session date 1"),
        field("F-03", "Session date 8"),
        field("F-04", "Session date 2"),
        field("F-05", "Work status", { answerType: "single_choice", options: ["Working", "Not working"], fillSource: { kind: "registration", path: "staff.entry" }, guidance: "Chosen from the notes (fictional).", note: "Ask the owner (fictional)." }),
      ],
    },
  },
});

describe("apply-map-edits", () => {
  it("sets and replaces by field id; null removes a key; the map's marker and notes; what changed (ids and keys only)", () => {
    const { files, reports } = applyEditList(maps(), {
      maps: {
        "orchard.maps.json": {
          "Orchard EOTS.rtf": {
            guidanceVersion: 2,
            dropWarnings: true,
            fields: { "F-05": { set: { fillSource: { kind: "clinician_opinion" }, note: null }, replace: [{ key: "guidance", find: "from the notes", with: "by the clinician" }] } },
          },
        },
      },
    });
    const m = files["orchard.maps.json"]["Orchard EOTS.rtf"];
    const f5 = m.fields.find((f) => f.id === "F-05") as Record<string, unknown>;
    assert.deepEqual(f5.fillSource, { kind: "clinician_opinion" });
    assert.equal(f5.note, undefined);
    assert.equal(f5.guidance, "Chosen by the clinician (fictional).");
    assert.equal(m.guidanceVersion, 2);
    assert.equal(m.warnings, undefined);
    assert.deepEqual(reports, [{ file: "orchard.maps.json", template: "Orchard EOTS.rtf", changed: { "F-05": ["guidance", "fillSource", "note"] }, sessions: 0 }]);
    // The input is not changed.
    assert.equal((maps()["orchard.maps.json"]["Orchard EOTS.rtf"].fields[4] as Record<string, unknown>).note, "Ask the owner (fictional).");
  });

  it("session questions take their index from the printed label's number (+ offset), never from their position", () => {
    const { map, sessions } = applyTemplateEdits(maps()["orchard.maps.json"]["Orchard EOTS.rtf"], { sessions: [{ ids: ["F-01", "F-02", "F-03", "F-04"], path: "episode.attendedDate", of: 14, offset: 1 }] }, "t");
    assert.equal(sessions, 4);
    assert.deepEqual(
      map.fields.slice(0, 4).map((f) => (f.fillSource as { part: { index: number } }).part.index),
      [8, 2, 9, 3],
      "label 7 → session 8 (after the assessment), label 1 → 2 …",
    );
    assert.deepEqual((map.fields[0] as Record<string, unknown>).fillSource, { kind: "registration", path: "episode.attendedDate", part: { index: 8, of: 14 } });
  });

  it("adds a question after an existing one (a new id, listed in form order)", () => {
    const added = field("F-09", "Treatment received to date (fictional)", { answerType: "long_text", fillSource: { kind: "clinician_opinion" } });
    const { map, changed } = applyTemplateEdits(maps()["orchard.maps.json"]["Orchard EOTS.rtf"], { add: [{ after: "F-02", field: added }] }, "t");
    assert.deepEqual(map.fields.map((f) => f.id), ["F-01", "F-02", "F-09", "F-03", "F-04", "F-05"]);
    assert.deepEqual(changed, { "F-09": ["added"] });
    assert.throws(() => applyTemplateEdits(maps()["orchard.maps.json"]["Orchard EOTS.rtf"], { add: [{ field: { ...added, id: "F-02" } }] }, "t"), /needs a new id/);
    assert.throws(() => applyTemplateEdits(maps()["orchard.maps.json"]["Orchard EOTS.rtf"], { add: [{ after: "F-99", field: added }] }, "t"), /no field F-99/);
  });

  it("refuses an unknown file, template or field, a find that is not there exactly once, a label without a number, a bad result", () => {
    const run = (list: Parameters<typeof applyEditList>[1]) => () => applyEditList(maps(), list);
    assert.throws(run({ maps: { "nope.maps.json": {} } }), CliError);
    assert.throws(run({ maps: { "orchard.maps.json": { "Nope.rtf": {} } } }), CliError);
    assert.throws(run({ maps: { "orchard.maps.json": { "Orchard EOTS.rtf": { fields: { "F-99": { set: { required: true } } } } } } }), /no field F-99/);
    assert.throws(run({ maps: { "orchard.maps.json": { "Orchard EOTS.rtf": { fields: { "F-05": { replace: [{ key: "guidance", find: "absent", with: "x" }] } } } } } }), /exactly once/);
    assert.throws(run({ maps: { "orchard.maps.json": { "Orchard EOTS.rtf": { sessions: [{ ids: ["F-05"], path: "episode.attendedDate", of: 8 }] } } } }), /names no session number/);
    assert.throws(run({ maps: { "orchard.maps.json": { "Orchard EOTS.rtf": { sessions: [{ ids: ["F-01"], path: "episode.attendedDate", of: 31 }] } } } }), /must be 1–30/);
    assert.throws(run({ maps: { "orchard.maps.json": { "Orchard EOTS.rtf": { fields: { "F-05": { set: { answerType: "not-a-type" } } } } } } }), /not a valid question/);
    assert.throws(run({ maps: { "orchard.maps.json": { "Orchard EOTS.rtf": { fields: { "F-05": { set: { id: "F-06" } } } } } } }), /never changed/);
  });
});
