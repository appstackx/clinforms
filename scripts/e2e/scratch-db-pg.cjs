/**
 * Child process of scratch-db.cjs: runs ONE statement on the local Postgres in E2E_DATABASE_URL (TLS off – loopback
 * only, checked by the parent) and prints the result as JSON. Input on stdin: { mode: "get"|"all"|"run", sql, params }.
 * Rows are shaped like the app's (src/server/db/dialects/postgres.ts): int8 → number, timestamptz → ISO string,
 * json/jsonb → text.
 */
const pg = require("pg");

const iso = (v) => {
  const d = new Date(v.includes("T") ? v : v.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00"));
  return Number.isNaN(d.getTime()) ? v : d.toISOString();
};
const parsers = { 20: (v) => Number(v), 114: (v) => v, 3802: (v) => v, 1114: (v) => iso(`${v}Z`), 1184: iso };
const types = { getTypeParser: (oid, format) => (format !== "binary" && parsers[oid]) || pg.types.getTypeParser(oid, format) };

(async () => {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const { mode, sql, params } = JSON.parse(input);
  const client = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL, ssl: false, types, connectionTimeoutMillis: 10000 });
  await client.connect();
  try {
    const r = await client.query(sql, params);
    const out = mode === "get" ? (r.rows[0] ?? null) : mode === "all" ? r.rows : { changes: r.rowCount ?? 0 };
    process.stdout.write(JSON.stringify(out));
  } finally {
    await client.end();
  }
})().catch((err) => {
  process.stderr.write(`scratch-db (postgres): ${err && err.message ? err.message : String(err)}\n`);
  process.exit(1);
});
