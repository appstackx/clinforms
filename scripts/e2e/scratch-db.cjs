/**
 * The e2e scripts' direct access to the SERVER'S SCRATCH DATABASE (test-only reads and the few writes some scripts
 * make), with one synchronous interface for both local backends:
 *
 *   SQLITE_PATH=/tmp/…/db.sqlite            node:sqlite (the path must be under /tmp or /var/folders)
 *   E2E_DATABASE_URL=postgres://…@localhost:55432/k2e2e_3270
 *                                           a Postgres ON THIS MACHINE (loopback host only – e.g. the Docker k2-pg
 *                                           test database); each call runs in a short child process (scratch-db-pg.cjs)
 *
 *   const { openScratchDb } = require("./scratch-db.cjs");
 *   const db = openScratchDb({ readOnly: true });
 *   db.prepare("SELECT id FROM pms_patients WHERE tenant_id = ? AND import_ref = ?").get("riverside-demo", "sim-pat-001");
 *   db.close();
 *
 * SQL is written once with `?` placeholders; for Postgres they become $1…$n (outside quotes). Write portable SQL:
 * quote "user", no INSERT OR REPLACE (use ON CONFLICT … DO UPDATE). Postgres rows look like the app's (dialects/
 * postgres.ts): bigint/count(*) → number, timestamptz → ISO-8601 UTC string, json → text. `run` returns { changes }.
 * Nothing secret is printed; a server database (non-loopback host) is refused.
 */
const path = require("path");
const { execFileSync } = require("child_process");

const SCRATCH_SQLITE = /^\/(private\/)?(tmp|var\/folders)\//;

function loopbackPostgresUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("E2E_DATABASE_URL is not a postgres:// URL");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") throw new Error("E2E_DATABASE_URL is not a postgres:// URL");
  if (url.searchParams.has("host") || !["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname)) {
    throw new Error("E2E_DATABASE_URL must be a Postgres on this machine (localhost) – never a server database");
  }
  return raw;
}

/** Which scratch database the server under test uses: { kind: "sqlite", file } or { kind: "postgres", url }. */
function scratchTarget(env = process.env) {
  const pgUrl = env.E2E_DATABASE_URL || "";
  const file = env.SQLITE_PATH || env.CLINFORMS_SQLITE_PATH || "";
  if (pgUrl) return { kind: "postgres", url: loopbackPostgresUrl(pgUrl) };
  if (!file || !SCRATCH_SQLITE.test(file)) throw new Error("SQLITE_PATH must be a scratch database under /tmp (or set E2E_DATABASE_URL to a local Postgres)");
  return { kind: "sqlite", file };
}

/** `?` → $1…$n, skipping '…' strings, "…" identifiers and -- comments. */
function toPgParams(sql) {
  let out = "";
  let n = 0;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'" || c === '"') {
      const end = sql.indexOf(c, i + 1);
      const stop = end < 0 ? sql.length : end + 1;
      out += sql.slice(i, stop);
      i = stop - 1;
    } else if (c === "-" && sql[i + 1] === "-") {
      const end = sql.indexOf("\n", i);
      const stop = end < 0 ? sql.length : end;
      out += sql.slice(i, stop);
      i = stop - 1;
    } else if (c === "?") {
      out += `$${++n}`;
    } else {
      out += c;
    }
  }
  return out;
}

function pgCall(url, mode, sql, args) {
  const out = execFileSync(process.execPath, [path.join(__dirname, "scratch-db-pg.cjs")], {
    input: JSON.stringify({ mode, sql: toPgParams(sql), params: args }),
    env: { ...process.env, E2E_DATABASE_URL: url },
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
  });
  return JSON.parse(out.toString("utf8"));
}

function openScratchDb({ readOnly = false } = {}) {
  const target = scratchTarget();
  if (target.kind === "sqlite") {
    const { DatabaseSync } = require("node:sqlite");
    return new DatabaseSync(target.file, readOnly ? { readOnly: true } : {});
  }
  const url = target.url;
  const guard = (sql) => {
    if (readOnly && !/^\s*(select|with)\b/i.test(sql)) throw new Error("read-only scratch database: only SELECT");
  };
  return {
    kind: "postgres",
    prepare(sql) {
      guard(sql);
      return {
        get: (...args) => pgCall(url, "get", sql, args) ?? undefined,
        all: (...args) => pgCall(url, "all", sql, args),
        run: (...args) => pgCall(url, "run", sql, args),
      };
    },
    exec(sql) {
      guard(sql);
      pgCall(url, "run", sql, []);
    },
    close() {},
  };
}

module.exports = { openScratchDb, scratchTarget, toPgParams };
