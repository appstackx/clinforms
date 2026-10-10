/**
 * scripts/db/key-fingerprint.ts against the real endpoint handler (src/server/ops/key-fingerprint.ts) through an
 * in-process fetch: same fingerprints on both sides, MATCH / MISMATCH rows, every refusal, and no key material or
 * cron secret in anything the script prints.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import { keyringFromEnv } from "../../src/server/crypto/envelope";
import { handleKeyFingerprint } from "../../src/server/ops/key-fingerprint";
import { compareFingerprints, fileFingerprints, fingerprintEndpoint, run } from "./key-fingerprint";

const CRON = "file-cron-secret-".padEnd(48, "c");
const K1 = randomBytes(32);
const K2 = randomBytes(32);
const keysJson = (keys: Record<string, Buffer>) => JSON.stringify(Object.fromEntries(Object.entries(keys).map(([kid, k]) => [kid, k.toString("base64")])));

function secretsFile(overrides: Record<string, string | undefined> = {}, prefix = "PRODUCTION_"): Map<string, string> {
  const base: Record<string, string | undefined> = {
    [`${prefix}CLINFORMS_DATA_KEYS`]: keysJson({ k1: K1, k2: K2 }),
    [`${prefix}CLINFORMS_DATA_KEY_ID`]: "k2",
    [`${prefix}CRON_SECRET`]: CRON,
    ...overrides,
  };
  return new Map(Object.entries(base).filter((e): e is [string, string] => e[1] !== undefined));
}

interface Server {
  keys?: string;
  kid?: string;
  cron?: string;
}

/** A fetch that serves GET /api/ops/key-fingerprint from the real handler with the "deployment's" env. */
function deployment(server: Server = {}) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const env = { CLINFORMS_DATA_KEYS: server.keys ?? keysJson({ k1: K1, k2: K2 }), CLINFORMS_DATA_KEY_ID: server.kid ?? "k2" };
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (new URL(url).pathname !== "/api/ops/key-fingerprint") return new Response("<html>not found</html>", { status: 404 });
    return handleKeyFingerprint(new Request(url, { headers: init?.headers }), {
      secret: "cron" in server ? server.cron : CRON,
      keyring: () => keyringFromEnv(env),
      log: () => undefined,
    });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

async function cli(argv: string[], secrets: Map<string, string>, fetchImpl: typeof fetch) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(argv, { secrets, fetch: fetchImpl, out: (l) => out.push(l), err: (l) => err.push(l) });
  const all = [...out, ...err].join("\n");
  return { code, out, err, all };
}

/** The script never prints the cron secret or any 12-character run of a key's base64 / base64url / hex. */
function assertNoSecrets(text: string, keys: Buffer[] = [K1, K2]): void {
  assert.ok(!text.includes(CRON), "cron secret printed");
  assert.ok(!text.includes(CRON.slice(0, 12)), "part of the cron secret printed");
  for (const key of keys) {
    for (const encoded of [key.toString("base64"), key.toString("base64url"), key.toString("hex")]) {
      for (let i = 0; i + 12 <= encoded.length; i++) assert.ok(!text.includes(encoded.slice(i, i + 12)), "key material printed");
    }
  }
}

const BASE = "https://clinforms.example";

describe("ops:key-fingerprint (scripts/db/key-fingerprint.ts)", () => {
  it("lists kid + fingerprint from the secrets file – the same values the endpoint returns – without calling anything", async () => {
    const { fetchImpl, calls } = deployment();
    const r = await cli(["--env", "production"], secretsFile(), fetchImpl);
    assert.equal(r.code, 0, r.all);
    assert.equal(calls.length, 0);
    const file = fileFingerprints(secretsFile(), "production");
    const served = await (await deployment().fetchImpl(`${BASE}/api/ops/key-fingerprint`, { headers: { authorization: `Bearer ${CRON}` } })).json();
    assert.deepEqual(file, served);
    assert.match(r.all, new RegExp(`k1\\s+${file.keys[0].fingerprint}\\n`));
    assert.match(r.all, new RegExp(`k2\\s+${file.keys[1].fingerprint}  \\(active\\)`));
    assertNoSecrets(r.all);
  });

  it("--compare: MATCH per kid and for activeKid when the deployment holds the same keyring (exit 0)", async () => {
    const { fetchImpl, calls } = deployment();
    const r = await cli(["--env", "production", "--compare", `${BASE}/`], secretsFile(), fetchImpl);
    assert.equal(r.code, 0, r.all);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${BASE}/api/ops/key-fingerprint`);
    assert.equal(calls[0].init?.redirect, "manual");
    assert.equal(new Headers(calls[0].init?.headers).get("authorization"), `Bearer ${CRON}`);
    assert.match(r.all, /MATCH\s+kid k1\s+file [0-9a-f]{16}\s+deployment [0-9a-f]{16}/);
    assert.match(r.all, /MATCH\s+kid k2\s/);
    assert.match(r.all, /MATCH\s+activeKid\s+file k2\s+deployment k2/);
    assert.match(r.out.at(-1) ?? "", /^MATCH: the secrets file holds exactly the data keys https:\/\/clinforms\.example uses \(3\/3 rows\)\.$/);
    assert.ok(!r.all.includes("MISMATCH"));
    assertNoSecrets(r.all);
  });

  it("--compare: MISMATCH for different key bytes, a different active kid and a kid on one side only (exit 1)", async () => {
    const other = randomBytes(32);
    const cases: { server: Server; expect: RegExp[] }[] = [
      { server: { keys: keysJson({ k1: K1, k2: other }) }, expect: [/MATCH\s+kid k1/, /MISMATCH\s+kid k2\s.*\(different key bytes\)/, /MATCH\s+activeKid/] },
      { server: { kid: "k1" }, expect: [/MISMATCH\s+activeKid\s+file k2\s+deployment k1\s+\(new data would be written with a different key\)/] },
      { server: { keys: keysJson({ k2: K2 }) }, expect: [/MISMATCH\s+kid k1\s+file [0-9a-f]{16}\s+deployment -\s+\(only in the secrets file\)/] },
      { server: { keys: keysJson({ k1: K1, k2: K2, k3: other }) }, expect: [/MISMATCH\s+kid k3\s+file -\s+deployment [0-9a-f]{16}\s+\(only on the deployment\)/] },
    ];
    for (const { server, expect } of cases) {
      const r = await cli(["--env", "production", "--compare", BASE], secretsFile(), deployment(server).fetchImpl);
      assert.equal(r.code, 1, r.all);
      for (const re of expect) assert.match(r.all, re);
      assert.match(r.out.at(-1) ?? "", /^MISMATCH: \d of \d rows differ/);
      assertNoSecrets(r.all, [K1, K2, other]);
    }
  });

  it("explains every refusal in one line (exit 2) and never prints the secret", async () => {
    const htmlStatus = (status: number, headers: Record<string, string> = {}) => {
      const calls: string[] = [];
      const f = (async (input: string | URL | Request) => {
        calls.push(String(input));
        return new Response("<html>nope</html>", { status, headers });
      }) as typeof fetch;
      return { f, calls };
    };
    const cases: { name: string; fetchImpl: typeof fetch; secrets?: Map<string, string>; expect: RegExp }[] = [
      { name: "wrong secret", fetchImpl: deployment({ cron: "another-cron-secret-".padEnd(40, "x") }).fetchImpl, expect: /HTTP 401: the deployment refused PRODUCTION_CRON_SECRET/ },
      { name: "unset secret", fetchImpl: deployment({ cron: undefined }).fetchImpl, expect: /HTTP 503: CRON_SECRET is not set on the deployment/ },
      { name: "bad keyring", fetchImpl: deployment({ kid: "k9" }).fetchImpl, expect: /HTTP 500: the deployment could not load its data keyring \(BAD_KEYRING\)/ },
      { name: "old deployment", fetchImpl: htmlStatus(404).f, expect: /HTTP 404: no \/api\/ops\/key-fingerprint on that deployment/ },
      { name: "protection", fetchImpl: htmlStatus(401).f, expect: /HTTP 401 from something other than the endpoint/ },
      { name: "other", fetchImpl: htmlStatus(502).f, expect: /HTTP 502 from https:\/\/clinforms\.example\/api\/ops\/key-fingerprint/ },
      {
        name: "network",
        fetchImpl: (async () => {
          throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
        }) as typeof fetch,
        expect: /Could not reach https:\/\/clinforms\.example\/api\/ops\/key-fingerprint \(ECONNREFUSED\)/,
      },
      {
        name: "unexpected body",
        fetchImpl: (async () => Response.json({ activeKid: "k2", keys: [{ kid: "k2", fingerprint: K2.toString("base64") }] })) as typeof fetch,
        expect: /answered 200 but not with \{activeKid, keys/,
      },
    ];
    for (const c of cases) {
      const r = await cli(["--env", "production", "--compare", BASE], c.secrets ?? secretsFile(), c.fetchImpl);
      assert.equal(r.code, 2, `${c.name}: ${r.all}`);
      assert.match(r.err.join("\n"), c.expect, c.name);
      assertNoSecrets(r.all);
    }

    const redirect = htmlStatus(308, { location: "https://elsewhere.example/api/ops/key-fingerprint" });
    const r = await cli(["--env", "production", "--compare", BASE], secretsFile(), redirect.f);
    assert.equal(r.code, 2);
    assert.match(r.err.join("\n"), /HTTP 308: redirected to https:\/\/elsewhere\.example\/api\/ops\/key-fingerprint – pass the final URL/);
    assert.deepEqual(redirect.calls, [`${BASE}/api/ops/key-fingerprint`], "the redirect is not followed");
  });

  it("refuses bad usage and incomplete secrets files before any request", async () => {
    const swapped = randomBytes(32);
    const cases: { argv: string[]; secrets?: Map<string, string>; expect: RegExp }[] = [
      { argv: [], expect: /--env is required/ },
      { argv: ["--env", "staging"], expect: /--env must be production or preview/ },
      { argv: ["--env", "production", "--yes"], expect: /Unknown option --yes/ },
      { argv: ["--env", "production", "--compare"], expect: /--compare needs a value/ },
      { argv: ["--env", "production", "--compare", "http://clinforms.example"], expect: /must be an https:\/\/ URL/ },
      { argv: ["--env", "production", "--compare", "clinforms.example"], expect: /needs the site's base URL/ },
      { argv: ["--env", "production", "--compare", "https://user:pw@clinforms.example"], expect: /must not contain a user name or password/ },
      { argv: ["--env", "production", "--compare", BASE], secrets: secretsFile({ PRODUCTION_CRON_SECRET: undefined }), expect: /PRODUCTION_CRON_SECRET is missing from the secrets file/ },
      { argv: ["--env", "production"], secrets: secretsFile({ PRODUCTION_CLINFORMS_DATA_KEYS: undefined }), expect: /PRODUCTION_CLINFORMS_DATA_KEYS is missing/ },
      { argv: ["--env", "production"], secrets: secretsFile({ PRODUCTION_CLINFORMS_DATA_KEY_ID: "k7" }), expect: /fail the app's keyring check \(BAD_KEYRING\)/ },
      {
        argv: ["--env", "production"],
        secrets: secretsFile({ PRODUCTION_CLINFORMS_DATA_KEYS: JSON.stringify({ [swapped.toString("base64")]: "k1" }), PRODUCTION_CLINFORMS_DATA_KEY_ID: "k1" }),
        expect: /fail the app's keyring check \(BAD_KEYRING\)/,
      },
      { argv: ["--env", "preview"], expect: /PREVIEW_CLINFORMS_DATA_KEYS is missing/ },
    ];
    for (const c of cases) {
      const { fetchImpl, calls } = deployment();
      const r = await cli(c.argv, c.secrets ?? secretsFile(), fetchImpl);
      assert.equal(r.code, 2, `${c.argv.join(" ")}: ${r.all}`);
      assert.match(r.err.join("\n"), c.expect);
      assert.equal(calls.length, 0);
      assertNoSecrets(r.all, [K1, K2, swapped]);
    }
  });

  it("uses the PREVIEW_ lines for --env preview and allows plain http only for localhost", async () => {
    const { fetchImpl, calls } = deployment();
    const r = await cli(["--env", "preview", "--compare", "http://localhost:3123"], secretsFile({}, "PREVIEW_"), fetchImpl);
    assert.equal(r.code, 0, r.all);
    assert.equal(calls[0].url, "http://localhost:3123/api/ops/key-fingerprint");
    assert.match(r.all, /PREVIEW_CLINFORMS_DATA_KEYS/);
    assert.equal(fingerprintEndpoint("http://127.0.0.1:4000/anything?x=1").href, "http://127.0.0.1:4000/api/ops/key-fingerprint");
    assert.equal(fingerprintEndpoint("https://clinforms.co.uk").href, "https://clinforms.co.uk/api/ops/key-fingerprint");
  });

  it("compareFingerprints is all-or-nothing", () => {
    const a = { activeKid: "k1", keys: [{ kid: "k1", fingerprint: "0123456789abcdef" }] };
    assert.equal(compareFingerprints(a, a).ok, true);
    assert.equal(compareFingerprints(a, { ...a, keys: [] }).ok, false);
    assert.equal(compareFingerprints(a, { activeKid: "k1", keys: [{ kid: "k1", fingerprint: "fedcba9876543210" }] }).ok, false);
  });
});
