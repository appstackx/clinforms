/** M10 L4: one formula-defusing rule for every clinic-system CSV. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defuseFormula, looksLikeFormula, quoteCsv, safeCsvText } from "./csv-safe";
import { csvCell as reportCell } from "../reporting/csv";
import { csvCell as listCell } from "../records/patient-list";
import { csvCell as billingCell } from "../billing/csv";
import { csvField as importField } from "../integration/csv";
import { historyCsv } from "./access";

const DANGEROUS = ["=1+1", "+1", "-1+cmd", "@SUM(A1)", "|calc", " =1", "  @x", "\t=1", "\r=1", "\n=1", " =1", "　=1", "＝1+1", "＋1", "＠x", "｜x"];

describe("M10 L4: CSV formula defusing", () => {
  it("leading whitespace, full-width signs, line breaks and | are defused", () => {
    for (const d of DANGEROUS) {
      assert.equal(looksLikeFormula(d), true, JSON.stringify(d));
      assert.ok(defuseFormula(d).startsWith("'"), JSON.stringify(d));
    }
    for (const fine of ["Megan Hart", "07700 900123", "2026-10-28", "a=b", "x|y", ""]) assert.equal(defuseFormula(fine), fine);
    assert.equal(defuseFormula("-12.5", { keepNumbers: true }), "-12.5");
  });

  it("quoted when it holds a quote, the delimiter, CR or LF", () => {
    assert.equal(quoteCsv('say "hi"'), '"say ""hi"""');
    assert.equal(quoteCsv("a\rb"), '"a\rb"');
    assert.equal(quoteCsv("a;b", ";"), '"a;b"');
    assert.equal(safeCsvText("\n=1"), "\"'\n=1\"");
  });

  it("every CSV writer of the clinic system uses it", () => {
    for (const cell of [reportCell, listCell, billingCell, (v: string) => importField(v)]) {
      for (const d of DANGEROUS) assert.match(cell(d), /^"?'/, `${cell.name}: ${JSON.stringify(d)}`);
      assert.equal(cell("a\rb"), '"a\rb"');
    }
    const csv = historyCsv([{ at: "2026-10-28T10:00:00.000Z", byUserId: "u1", kind: "role", subjectUserId: null, items: [] }] as never, () => " =HYPERLINK(1)\r", (x) => x);
    assert.equal(csv, "When,Who,What,Change\r\n");
    const named = historyCsv(
      [{ at: "2026-10-28T10:00:00.000Z", byUserId: "u1", kind: "member", subjectUserId: "u2", items: [{ type: "role", from: "staff", to: "clinician" }] }] as never,
      () => " =HYPERLINK(1)\r",
      (x) => x,
    );
    assert.ok(named.includes("\"' =HYPERLINK(1)\r\""), named);
  });
});
