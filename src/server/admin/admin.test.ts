/**
 * The activity page (/app/settings/activity) and the platform page (/app/platform): the data layer on node:sqlite
 * and PGlite (the D1 runs are in workers/data-gateway/test/admin-stack.test.ts), the platform gate, the wording,
 * the CSV, and source checks that every page, route and action applies its guard. Run by `npm run test:db`.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { BANNED_TERM_PATTERNS } from "../../modules/medreport/core/wording";
import { ACTIVITY_ACTORS, ACTIVITY_COPY, ACTIVITY_GROUPS, ACTIVITY_LABELS, ACTIVITY_TARGETS, activityLabel, describeActivityDetail } from "../../lib/activity-copy";
import { createPgliteTestDb, createSqliteTestDb } from "../db/testing/databases";
import { RESERVED_TENANT_SLUGS, tenantSlugProblem } from "../auth/tenant";
import { activityCsv, activityHref, activityScope, csvCell, parseActivityParams } from "./activity";
import { PLATFORM_AUDIT_TENANT, platformAdminFromSession, type PlatformSessionLike } from "./platform-console";
import { defineAdminSuite } from "./testing/admin-suite";

defineAdminSuite("node:sqlite", async () => createSqliteTestDb());
defineAdminSuite("PGlite (Postgres)", async () => createPgliteTestDb());

const ADMINS = (email: string) => ["ops@platform.example"].includes(email.trim().toLowerCase());

function session(email: string, twoFactorEnabled: boolean | null): PlatformSessionLike {
  return { user: { id: "u1", email, name: "Someone", twoFactorEnabled }, session: { id: "s1" } };
}

describe("platform page gate (404 for everyone who is not a platform administrator)", () => {
  it("only a signed-in account with two-step verification whose email is listed", () => {
    assert.equal(platformAdminFromSession(null, ADMINS), null, "signed out");
    assert.equal(platformAdminFromSession(undefined, ADMINS), null);
    assert.equal(platformAdminFromSession(session("someone@clinic.example", true), ADMINS), null, "a clinic member");
    assert.equal(platformAdminFromSession(session("ops@platform.example", false), ADMINS), null, "listed, but no two-step verification");
    assert.equal(platformAdminFromSession(session("ops@platform.example", null), ADMINS), null);
    assert.deepEqual(platformAdminFromSession(session("Ops@Platform.example", true), ADMINS), {
      userId: "u1",
      sessionId: "s1",
      email: "Ops@Platform.example",
      name: "Someone",
    });
    assert.equal(platformAdminFromSession({ user: { id: "", email: "ops@platform.example", twoFactorEnabled: true }, session: { id: "s1" } }, ADMINS), null);
  });

  it("reads CLINFORMS_PLATFORM_ADMINS by default (unset = nobody)", () => {
    const saved = process.env.CLINFORMS_PLATFORM_ADMINS;
    try {
      delete process.env.CLINFORMS_PLATFORM_ADMINS;
      assert.equal(platformAdminFromSession(session("ops@platform.example", true)), null);
      process.env.CLINFORMS_PLATFORM_ADMINS = "ops@platform.example, other@platform.example";
      assert.ok(platformAdminFromSession(session("ops@platform.example", true)));
      assert.equal(platformAdminFromSession(session("third@platform.example", true)), null);
    } finally {
      if (saved === undefined) delete process.env.CLINFORMS_PLATFORM_ADMINS;
      else process.env.CLINFORMS_PLATFORM_ADMINS = saved;
    }
  });

  it("the platform audit pseudo-tenant can never be a clinic id", () => {
    assert.equal(PLATFORM_AUDIT_TENANT, "platform");
    assert.ok(RESERVED_TENANT_SLUGS.has(PLATFORM_AUDIT_TENANT));
    assert.equal(tenantSlugProblem(PLATFORM_AUDIT_TENANT), "reserved");
  });
});

describe("activity scope by role", () => {
  it("owners and administrators: everyone; clinicians and staff: themselves", () => {
    const base = { tenantId: "t-clinic", organizationId: "o", userId: "me" };
    assert.equal(activityScope({ ...base, role: "owner" }).everyone, true);
    assert.equal(activityScope({ ...base, role: "admin" }).everyone, true);
    assert.equal(activityScope({ ...base, role: "clinician" }).everyone, false);
    assert.equal(activityScope({ ...base, role: "staff" }).everyone, false);
  });
});

describe("activity links and CSV", () => {
  it("links carry only set, valid parameters", () => {
    assert.equal(activityHref("/app/settings/activity", {}), "/app/settings/activity");
    assert.equal(
      activityHref("/app/settings/activity", { action: "member.invite", user: null, before: "01K00000000000000000000000" }),
      "/app/settings/activity?action=member.invite&before=01K00000000000000000000000",
    );
    const parsed = parseActivityParams(new URLSearchParams("action=auth.sign_in&before=01K00000000000000000000000&after=01K00000000000000000000001"));
    assert.equal(parsed.before, "01K00000000000000000000000");
    assert.equal(parsed.after, null, "before wins over after");
    assert.deepEqual(parseActivityParams({ from: "01K00000000000000000000001", to: "01K00000000000000000000000" }).from, "01K00000000000000000000001");
    assert.equal(parseActivityParams({ from: "01K00000000000000000000000", to: "01K00000000000000000000001" }).from, null, "a reversed range is dropped");
    assert.equal(parseActivityParams({ action: ["member.invite", "x"] }).action, "member.invite");
  });

  it("cells are quoted when needed and never read as formulas", () => {
    assert.equal(csvCell("plain"), "plain");
    assert.equal(csvCell(null), "");
    assert.equal(csvCell("a,b"), '"a,b"');
    assert.equal(csvCell('say "hi"'), '"say ""hi"""');
    assert.equal(csvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
    assert.equal(csvCell("+1"), "'+1");
    assert.equal(csvCell("-x"), "'-x");
    assert.equal(csvCell("@cmd"), "'@cmd");
    assert.equal(csvCell("line\nbreak"), '"line\nbreak"');
    const csv = activityCsv([{ id: "A", at: "2026-10-09T10:00:00.000Z", action: "auth.sign_in", userId: null, targetType: null, targetId: "=1+1" }]);
    assert.equal(csv, "id,at,action,user_id,target_type,target_id\r\nA,2026-10-09T10:00:00.000Z,auth.sign_in,,,'=1+1\r\n");
  });
});

/**
 * The audit actions the app writes (string literals `action: "<code>"` in src/server and src/app, tests and test
 * helpers excluded). A new audit action needs a label in src/lib/activity-copy.ts.
 */
function actionsInCode(): string[] {
  const roots = ["src/server", "src/app"].map((p) => path.resolve(p));
  const found = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "testing") walk(full);
      } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        const source = fs.readFileSync(full, "utf8");
        for (const m of Array.from(source.matchAll(/action: (?:contacted \? )?"([a-z0-9_]+\.[a-z0-9_.:-]+)"(?: : "([a-z0-9_]+\.[a-z0-9_.:-]+)")?/g))) {
          found.add(m[1]);
          if (m[2]) found.add(m[2]);
        }
      }
    }
  };
  roots.forEach(walk);
  return Array.from(found).sort();
}

/**
 * The audit actions the Report API writes (src/modules/medreport): the AUDIT_ACTIONS table in auth/actor.ts and the
 * `action:` expressions of the handlers (the /store handlers choose between codes with conditionals).
 */
function moduleActionsInCode(): string[] {
  const found = new Set<string>();
  const actor = fs.readFileSync(path.resolve("src/modules/medreport/auth/actor.ts"), "utf8");
  const table = /export const AUDIT_ACTIONS = \{([\s\S]*?)\} as const;/.exec(actor);
  assert.ok(table, "AUDIT_ACTIONS table found");
  for (const m of Array.from(table[1].matchAll(/: "([a-z0-9_]+\.[a-z0-9_.:-]+)"/g))) found.add(m[1]);
  const dir = path.resolve("src/modules/medreport/api/handlers");
  for (const name of fs.readdirSync(dir)) {
    if (!/\.ts$/.test(name) || /\.test\.ts$/.test(name)) continue;
    for (const line of fs.readFileSync(path.join(dir, name), "utf8").split("\n")) {
      if (!/\baction: /.test(line)) continue;
      for (const m of Array.from(line.matchAll(/"([a-z0-9_]+\.[a-z0-9_.:-]+)"/g))) found.add(m[1]);
    }
  }
  return Array.from(found).sort();
}

describe("activity wording", () => {
  it("every audit action the app writes has a plain-English label", () => {
    const actions = actionsInCode();
    assert.ok(actions.length >= 20, `found ${actions.length} actions`);
    const missing = actions.filter((a) => !ACTIVITY_LABELS[a]);
    assert.deepEqual(missing, []);
    for (const group of ACTIVITY_GROUPS) for (const a of group.actions) assert.ok(ACTIVITY_LABELS[a], a);
  });

  it("every audit action the Report API and the Studio's storage write has a label and a filter group", () => {
    const actions = moduleActionsInCode();
    for (const expected of ["report.sign", "report.draft_live", "form.confirm", "report.create", "file.upload", "settings.update"]) {
      assert.ok(actions.indexOf(expected) >= 0, `found ${expected}`);
    }
    assert.deepEqual(actions.filter((a) => !ACTIVITY_LABELS[a]), []);
    const grouped = new Set(ACTIVITY_GROUPS.flatMap((g) => g.actions));
    assert.deepEqual(actions.filter((a) => !grouped.has(a)), []);
  });

  it("unknown actions still get a readable name", () => {
    assert.equal(activityLabel("report.archive_later"), "Report: archive later");
    assert.equal(activityLabel("form.map_confirm"), "Form: map confirm");
    assert.equal(activityLabel("custom"), "Custom");
    assert.equal(describeActivityDetail("unknown.action", { secret: "x" }), null, "unknown details are never shown");
    assert.equal(describeActivityDetail("member.role_change", { from: "staff", to: "clinician" }), "Staff → Clinician");
    assert.equal(describeActivityDetail("clinic.update", { fields: ["displayName", "retentionDays"] }), "Changed: name, how long reports are kept");
  });

  it("no banned technology or vendor terms in the labels, details, names and page copy", () => {
    const texts = [
      ...Object.values(ACTIVITY_LABELS),
      ...Object.values(ACTIVITY_ACTORS),
      ...Object.values(ACTIVITY_TARGETS),
      ...Object.values(ACTIVITY_COPY),
      ...ACTIVITY_GROUPS.map((g) => g.label),
      ...Object.keys(ACTIVITY_LABELS).map(activityLabel),
      ...[
        describeActivityDetail("member.role_change", { from: "admin", to: "owner" }),
        describeActivityDetail("auth.session_revoke", { scope: "revoke-other-sessions" }),
        describeActivityDetail("auth.password_reset_link_refused", { reason: "other_clinic_email_off" }),
        describeActivityDetail("auth.password_reset_link_refused", { reason: "other_clinic_email_failed" }),
        describeActivityDetail("auth.password_reset_link", { delivery: "not_sent" }),
      ].filter((t): t is string => typeof t === "string"),
    ];
    for (const text of texts) {
      const hit = BANNED_TERM_PATTERNS.find((re) => re.test(text));
      assert.equal(hit, undefined, text);
    }
  });
});

describe("every activity and platform entry point applies its guard (source checks)", () => {
  const read = (p: string) => fs.readFileSync(path.resolve(p), "utf8");

  it("the platform page answers 404 unless requirePlatformAdmin() passes, before any data is read", () => {
    const page = read("src/app/app/platform/page.tsx");
    const body = page.slice(page.indexOf("export default async function"));
    const guard = body.indexOf("await requirePlatformAdmin()");
    assert.ok(guard > 0, "the page calls requirePlatformAdmin()");
    assert.ok(guard < body.indexOf("getDb()"), "before the database is touched");
    const guards = read("src/server/admin/guards.ts");
    assert.match(guards, /if \(!admin\) notFound\(\);/);
    assert.match(guards, /getServerSession\(\{ fresh: true \}\)/, "past the session cookie cache");
  });

  it("every platform server action checks platformActionAdmin() first", () => {
    const actions = read("src/app/app/platform/actions.ts");
    const fns = Array.from(actions.matchAll(/export async function (\w+)\([^)]*\)[^{]*\{\n([^\n]*)\n([^\n]*)/g));
    assert.ok(fns.length >= 2, `found ${fns.length} actions`);
    for (const m of fns) {
      assert.match(m[2], /const admin = await platformActionAdmin\(\);/, m[1]);
      assert.match(m[3], /if \(!admin\) return/, m[1]);
    }
  });

  it("the activity page and its download scope the query by role (the person filter is never taken from the request alone)", () => {
    for (const file of ["src/app/app/(clinic)/settings/activity/page.tsx", "src/app/app/(clinic)/settings/activity/export/route.ts"]) {
      const source = read(file);
      assert.match(source, /activityScope\(/, file);
      assert.match(source, /activityQuery\(scope, params\)/, file);
      assert.ok(!/listAudit\(/.test(source), `${file} reads the trail only through the scoped helpers`);
    }
    assert.match(read("src/app/app/(clinic)/settings/activity/page.tsx"), /await requireAppContext\(\)/);
    const route = read("src/app/app/(clinic)/settings/activity/export/route.ts");
    assert.match(route, /const ctx = await actionContext\(\);\n\s+if \("error" in ctx\)/);
    assert.match(route, /action: "audit\.export"/, "downloads are recorded");
  });
});
