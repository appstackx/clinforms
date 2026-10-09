/** Studio paths: the same screens under /reports (public demo) and /app/studio (a clinic's own Studio). */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_STUDIO_BASE_PATH, PUBLIC_SECURITY_PATH, normaliseBasePath, studioPaths, studioSection } from "./routes";

describe("studioPaths", () => {
  it("defaults to the public demo at /reports (every path the demo has always used)", () => {
    const p = studioPaths();
    assert.equal(DEFAULT_STUDIO_BASE_PATH, "/reports");
    assert.equal(p.home, "/reports");
    assert.equal(p.newReport, "/reports/new");
    assert.equal(p.newReportWithForm("form_1"), "/reports/new?form=form_1");
    assert.equal(p.forms, "/reports/forms");
    assert.equal(p.form("form_1"), "/reports/forms/form_1");
    assert.equal(p.batch, "/reports/batch");
    assert.equal(p.templates, "/reports/templates");
    assert.equal(p.security, "/reports/security");
    assert.equal(p.report("rpt_1"), "/reports/rpt_1");
  });

  it("mounts under /app/studio for a clinic, with the public trust page as Security", () => {
    const p = studioPaths("/app/studio", "tenant");
    assert.equal(p.basePath, "/app/studio");
    assert.equal(p.home, "/app/studio");
    assert.equal(p.newReport, "/app/studio/new");
    assert.equal(p.forms, "/app/studio/forms");
    assert.equal(p.form("f"), "/app/studio/forms/f");
    assert.equal(p.report("r"), "/app/studio/r");
    assert.equal(p.security, PUBLIC_SECURITY_PATH);
    assert.equal(PUBLIC_SECURITY_PATH, "/security");
  });

  it("encodes ids", () => {
    const p = studioPaths("/app/studio");
    assert.equal(p.report("a b/c?d"), "/app/studio/a%20b%2Fc%3Fd");
    assert.equal(p.form("x&y"), "/app/studio/forms/x%26y");
    assert.equal(p.newReportWithForm("x&y=z"), "/app/studio/new?form=x%26y%3Dz");
  });

  it("normalises the base path and refuses anything that is not a same-origin absolute path", () => {
    assert.equal(normaliseBasePath("/app/studio/"), "/app/studio");
    assert.equal(normaliseBasePath("/app/studio///"), "/app/studio");
    for (const bad of [undefined, null, "", "app/studio", "//evil.example", "https://evil.example", "/a?b", "/a#b", "/a b", "/a\\b"]) {
      assert.equal(normaliseBasePath(bad), "/reports", String(bad));
    }
  });
});

describe("studioSection (navigation highlight)", () => {
  it("home and report review are 'reports'; named pages are their own section", () => {
    for (const base of ["/reports", "/app/studio"]) {
      assert.equal(studioSection(base, base), "reports");
      assert.equal(studioSection(`${base}/`, base), "reports");
      assert.equal(studioSection(`${base}/rpt_123`, base), "reports");
      assert.equal(studioSection(`${base}/new`, base), "new");
      assert.equal(studioSection(`${base}/new?form=x`, base), "new");
      assert.equal(studioSection(`${base}/forms`, base), "forms");
      assert.equal(studioSection(`${base}/forms/form_1`, base), "forms");
      assert.equal(studioSection(`${base}/batch`, base), "batch");
      assert.equal(studioSection(`${base}/templates`, base), "templates");
      assert.equal(studioSection(`${base}/security`, base), "security");
    }
  });

  it("a report id that merely starts like a page name is still a report", () => {
    assert.equal(studioSection("/reports/newest-report", "/reports"), "reports");
    assert.equal(studioSection("/reports/formsy", "/reports"), "reports");
  });

  it("paths outside the Studio (or too deep to be a report) are not a section", () => {
    assert.equal(studioSection("/reportsx", "/reports"), null);
    assert.equal(studioSection("/app", "/app/studio"), null);
    assert.equal(studioSection("/app/settings/clinic", "/app/studio"), null);
    assert.equal(studioSection("/reports/rpt_1/extra", "/reports"), null);
    assert.equal(studioSection(null, "/reports"), null);
    assert.equal(studioSection("/reports", "/app/studio"), null);
  });
});
