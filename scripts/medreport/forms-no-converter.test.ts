/**
 * On a deployment without LibreOffice (Vercel), a Word form's PDF copy is refused with 503
 * PDF_CONVERSION_UNAVAILABLE and the "download Word" notice, while the Word original still renders.
 * Separate file: node:test runs each file in its own process, so the converter lookup starts fresh.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { MedreportDeps } from "../../src/modules/medreport/api/deps";
import { handleRender } from "../../src/modules/medreport/api/handlers/render";
import { bindHandler } from "../../src/modules/medreport/api/http";
import { NOTICES } from "../../src/modules/medreport/config.public";
import { pdfConversionAvailable } from "../../src/modules/medreport/forms/convert";
import { KINGSWAY_FORM } from "../../src/modules/medreport/forms/samples/maps/kingsway";
import { getSampleForm } from "../../src/modules/medreport/forms/samples/registry";
import { completedSampleReport } from "./form-sample-answers";
import { demoBearer } from "./test-actors";

test("no LibreOffice → 503 PDF_CONVERSION_UNAVAILABLE for a Word form's PDF copy; Word still works", async () => {
  process.env.VERCEL = "1";
  delete process.env.MEDREPORT_SOFFICE_PATH;
  assert.equal(pdfConversionAvailable(), false);
  const report = completedSampleReport("daniel-brooks", KINGSWAY_FORM);
  const fileBase64 = Buffer.from(await getSampleForm("kingsway-rtw-assessment")!.loadFile()).toString("base64");
  const call = (format: string) =>
    bindHandler(handleRender, () => ({}) as MedreportDeps)(
      new Request(`http://localhost/api/reports/v1/render?format=${format}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: demoBearer() },
        body: JSON.stringify({ report, form: KINGSWAY_FORM, fileBase64 }),
      }),
      { params: {} },
    );
  const pdf = await call("pdf");
  assert.equal(pdf.status, 503);
  const problem = await pdf.json();
  assert.equal(problem.code, "PDF_CONVERSION_UNAVAILABLE");
  assert.equal(problem.detail, NOTICES.pdfConversionUnavailable);
  const word = await call("original");
  assert.equal(word.status, 200);
  assert.equal(word.headers.get("x-medreport-render"), "draft");
});
