/**
 * Source check of the records module's entry points (contract §6, K2-NOTE-007): every page and layout under
 * /app/clinic/patients starts with requireClinicActor, every server action with clinicActionActor, every route with
 * clinicRoute – with a permission – and everything under the clinical folders (notes, outcomes, attachments) needs a
 * clinical permission, so reception (staff, who holds none) is refused before anything is read. The clinical
 * services check it again as their first statement. Run by `npm run test:pms` and `npm run test:db`.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { pmsCan } from "../../../modules/pms/core/permissions";

const ROOT = path.resolve(__dirname, "../../../..");
const PATIENTS = path.join(ROOT, "src/app/app/clinic/patients");
const SERVICES = path.join(ROOT, "src/server/pms/records");
const CLINICAL_DIRS = ["notes", "outcomes", "attachments"];
const OTHER_MODULE_TABS = ["appointments", "invoices", "messages", "forms"];

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return OTHER_MODULE_TABS.includes(e.name) ? [] : walk(full);
    return [full];
  });
}

const rel = (f: string) => path.relative(PATIENTS, f).split(path.sep);
const isClinical = (f: string) => rel(f).some((part) => CLINICAL_DIRS.includes(part));
const files = walk(PATIENTS);

/** Each exported function's body, by name. */
function exportedBodies(source: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /export (?:default )?async function (\w+)\s*\([\s\S]*?\)(?::[^\n]*)?\s*\{\n/g;
  let m: RegExpExecArray | null;
  const starts: { name: string; at: number }[] = [];
  while ((m = re.exec(source))) starts.push({ name: m[1], at: m.index + m[0].length });
  starts.forEach((s, i) => out.set(s.name, source.slice(s.at, i + 1 < starts.length ? starts[i + 1].at : source.length)));
  return out;
}

function firstStatement(body: string): string {
  return body.trim().split(/;\s*\n/)[0];
}

describe("records module entry points", () => {
  it("found the module's files", () => {
    assert.ok(files.filter((f) => f.endsWith("page.tsx")).length >= 10);
    assert.ok(files.filter((f) => f.endsWith("actions.ts")).length >= 6);
    assert.ok(files.filter((f) => f.endsWith("route.ts")).length >= 3);
  });

  it("every page and layout starts with requireClinicActor and a permission; clinical folders need clinical.view", () => {
    for (const f of files.filter((x) => /(page|layout)\.tsx$/.test(x))) {
      const src = fs.readFileSync(f, "utf8");
      const bodies = exportedBodies(src);
      const main = Array.from(bodies.values())[0];
      assert.ok(main, `${rel(f).join("/")}: an exported async component`);
      const m = /^const actor = await requireClinicActor\(\{ permission: "([a-z.]+)" \}\)|^await requireClinicActor\(\{ permission: "([a-z.]+)" \}\)/.exec(firstStatement(main));
      assert.ok(m, `${rel(f).join("/")}: first statement is requireClinicActor({ permission })`);
      const permission = (m[1] ?? m[2]) as Parameters<typeof pmsCan>[1];
      if (isClinical(f)) assert.equal(permission, "clinical.view", `${rel(f).join("/")} needs clinical.view`);
      if (isClinical(f)) assert.equal(pmsCan("staff", permission), false);
    }
  });

  it("every server action starts with clinicActionActor and a permission; clinical folders need clinical.*", () => {
    for (const f of files.filter((x) => x.endsWith("actions.ts"))) {
      const src = fs.readFileSync(f, "utf8");
      assert.ok(src.trimStart().startsWith('"use server"'), `${rel(f).join("/")}: "use server"`);
      const bodies = exportedBodies(src);
      assert.ok(bodies.size > 0);
      for (const [name, body] of Array.from(bodies)) {
        const first = firstStatement(body);
        const m = /^const actor = await clinicActionActor\(\{ permission: "([a-z.]+)" \}\)/.exec(first);
        assert.ok(m, `${rel(f).join("/")} ${name}: first statement is clinicActionActor({ permission })`);
        assert.match(body, /if \("error" in actor\) return \{ ok: false, error: actorErrorMessage\(actor\.error\) \};/, `${name}: refuses on an actor error`);
        const permission = m[1];
        if (isClinical(f)) {
          assert.match(permission, /^clinical\./, `${rel(f).join("/")} ${name} needs a clinical permission`);
          assert.equal(pmsCan("staff", permission as Parameters<typeof pmsCan>[1]), false, `${name}: reception must not hold ${permission}`);
        }
        if (rel(f)[0] === "note-templates") assert.equal(permission, "settings.manage", name);
      }
    }
  });

  it("every route handler goes through clinicRoute with a permission; files need clinical.*, the export patients.export", () => {
    for (const f of files.filter((x) => x.endsWith("route.ts"))) {
      const src = fs.readFileSync(f, "utf8");
      const handlers = Array.from(src.matchAll(/export const (GET|POST|PUT|PATCH|DELETE|HEAD) = clinicRoute(?:<[^>]*>)?\(\{ permission: "([a-z.]+)" \}/g));
      assert.ok(handlers.length > 0, `${rel(f).join("/")}: clinicRoute`);
      assert.ok(!/export (async )?function (GET|POST|PUT|PATCH|DELETE)/.test(src), `${rel(f).join("/")}: no handler outside clinicRoute`);
      for (const [, method, permission] of handlers) {
        if (isClinical(f)) assert.match(permission, /^clinical\./, `${rel(f).join("/")} ${method}`);
        if (rel(f)[1] === "export") assert.equal(permission, "patients.export");
        if (isClinical(f) || rel(f)[1] === "export") assert.equal(pmsCan("staff", permission as Parameters<typeof pmsCan>[1]), false);
      }
    }
  });

  it("every exported function of the clinical services checks a clinical permission first", () => {
    for (const file of ["notes-service.ts", "outcomes-service.ts", "attachments-service.ts"]) {
      const src = fs.readFileSync(path.join(SERVICES, file), "utf8");
      for (const [name, body] of Array.from(exportedBodies(src))) {
        if (!/\(actor: RecordsActor/.test(src.slice(src.indexOf(`function ${name}(`), src.indexOf(`function ${name}(`) + 200))) continue;
        assert.match(firstStatement(body), /^const denied = guard\(actor, "clinical\.(view|edit|sign)"/, `${file} ${name}`);
      }
    }
  });

  it("nothing in the patients routes deletes a clinical record", () => {
    for (const f of [...files, ...walk(SERVICES), ...walk(path.join(ROOT, "src/server/repos/pms/records"))].filter((x) => /\.tsx?$/.test(x) && !x.endsWith(".test.ts") && !x.includes(`${path.sep}testing${path.sep}`))) {
      assert.ok(!/deleteFrom\(/.test(fs.readFileSync(f, "utf8")), `${f}: no deleteFrom`);
    }
  });
});
