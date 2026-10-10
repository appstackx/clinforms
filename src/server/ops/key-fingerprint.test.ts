import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { afterEach, describe, it } from "node:test";
import { DataCryptoError, getDataCipher, keyringFromEnv, parseKeyring } from "../crypto";
import { keyringFingerprints } from "../crypto/fingerprint";
import { handleKeyFingerprint } from "./key-fingerprint";

const SECRET = "fingerprint-cron-secret-".padEnd(48, "f");
const K1 = randomBytes(32);
const K2 = randomBytes(32);
const KEYS_JSON = JSON.stringify({ k1: K1.toString("base64"), k2: K2.toString("base64") });
const ENV = { CLINFORMS_DATA_KEYS: KEYS_JSON, CLINFORMS_DATA_KEY_ID: "k2" };

function req(auth?: string): Request {
  return new Request("https://clinforms.example/api/ops/key-fingerprint", { headers: auth === undefined ? {} : { authorization: auth } });
}

/** Every 12-character run of each key's base64, base64url and hex form, and the cron secret itself. */
function assertNoSecrets(text: string, keys: Buffer[] = [K1, K2]): void {
  assert.ok(!text.includes(SECRET), "cron secret leaked");
  for (const key of keys) {
    for (const encoded of [key.toString("base64"), key.toString("base64url"), key.toString("hex")]) {
      for (let i = 0; i + 12 <= encoded.length; i++) assert.ok(!text.includes(encoded.slice(i, i + 12)), "key material leaked");
    }
  }
}

function recorder() {
  const lines: string[] = [];
  return { lines, log: (event: string, detail: Record<string, unknown>) => lines.push(`${event} ${JSON.stringify(detail)}`) };
}

describe("GET /api/ops/key-fingerprint (handler)", () => {
  it("answers 503 while CRON_SECRET is unset or too short – without loading the keyring", async () => {
    for (const secret of [undefined, "", "short-secret"]) {
      const { lines, log } = recorder();
      let loaded = false;
      const res = await handleKeyFingerprint(req(`Bearer ${secret ?? ""}`), {
        secret,
        keyring: () => {
          loaded = true;
          return keyringFromEnv(ENV);
        },
        log,
      });
      assert.equal(res.status, 503);
      assert.deepEqual(await res.json(), { ok: false, error: "Not configured." });
      assert.equal(loaded, false);
      assert.deepEqual(lines, ['ops.key_fingerprint.refused {"reason":"not_configured"}']);
    }
  });

  it("answers 401 to a missing, wrong or malformed Authorization header – without loading the keyring", async () => {
    for (const auth of [undefined, "", `Bearer ${SECRET}x`, `Bearer ${SECRET.slice(0, -1)}`, SECRET, `bearer ${SECRET}`, `Basic ${SECRET}`, `Bearer  ${SECRET}`]) {
      const { lines, log } = recorder();
      let loaded = false;
      const res = await handleKeyFingerprint(req(auth), {
        secret: SECRET,
        keyring: () => {
          loaded = true;
          return keyringFromEnv(ENV);
        },
        log,
      });
      assert.equal(res.status, 401, `auth ${JSON.stringify(auth?.slice(0, 8))}`);
      assert.deepEqual(await res.json(), { ok: false, error: "Unauthorized." });
      assert.equal(loaded, false);
      assert.deepEqual(lines, ['ops.key_fingerprint.refused {"reason":"unauthorized"}']);
    }
  });

  it("returns {activeKid, keys:[{kid, fingerprint}]} for the right secret, uncached and noindex", async () => {
    const { lines, log } = recorder();
    const res = await handleKeyFingerprint(req(`Bearer ${SECRET}`), { secret: SECRET, keyring: () => keyringFromEnv(ENV), log });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /^application\/json/);
    assert.match(res.headers.get("cache-control") ?? "", /no-store/);
    assert.match(res.headers.get("x-robots-tag") ?? "", /noindex/);
    const text = await res.text();
    const body = JSON.parse(text);
    assert.deepEqual(body, keyringFingerprints(parseKeyring(KEYS_JSON, "k2")));
    assert.deepEqual(Object.keys(body).sort(), ["activeKid", "keys"]);
    assert.equal(body.activeKid, "k2");
    assert.deepEqual(
      body.keys.map((k: { kid: string }) => k.kid),
      ["k1", "k2"],
    );
    for (const k of body.keys) assert.deepEqual(Object.keys(k).sort(), ["fingerprint", "kid"]);
    assertNoSecrets(text);
    assertNoSecrets(lines.join("\n"));
    assert.deepEqual(lines, ['ops.key_fingerprint.served {"activeKid":"k2","keys":2}']);
  });

  it("fails a malformed keyring exactly as the data cipher does (500 + the loader's code), without echoing the loader's message", async () => {
    const swapped = randomBytes(32);
    const cases: Record<string, string | undefined>[] = [
      {},
      { CLINFORMS_DATA_KEYS: "not json", CLINFORMS_DATA_KEY_ID: "k1" },
      { CLINFORMS_DATA_KEYS: "[]", CLINFORMS_DATA_KEY_ID: "k1" },
      { CLINFORMS_DATA_KEYS: JSON.stringify({ k1: randomBytes(16).toString("base64") }), CLINFORMS_DATA_KEY_ID: "k1" },
      { CLINFORMS_DATA_KEYS: KEYS_JSON, CLINFORMS_DATA_KEY_ID: "k3" },
      { CLINFORMS_DATA_KEYS: KEYS_JSON },
      // A key pasted where the kid belongs: the loader's own message would quote 40 characters of it.
      { CLINFORMS_DATA_KEYS: JSON.stringify({ [swapped.toString("base64")]: "k1" }), CLINFORMS_DATA_KEY_ID: "k1" },
    ];
    const saved = { keys: process.env.CLINFORMS_DATA_KEYS, kid: process.env.CLINFORMS_DATA_KEY_ID };
    try {
      for (const env of cases) {
        let cipherCode = "";
        process.env.CLINFORMS_DATA_KEYS = env.CLINFORMS_DATA_KEYS ?? "";
        process.env.CLINFORMS_DATA_KEY_ID = env.CLINFORMS_DATA_KEY_ID ?? "";
        if (env.CLINFORMS_DATA_KEYS === undefined) delete process.env.CLINFORMS_DATA_KEYS;
        if (env.CLINFORMS_DATA_KEY_ID === undefined) delete process.env.CLINFORMS_DATA_KEY_ID;
        try {
          getDataCipher();
          assert.fail("the data cipher accepted a malformed keyring");
        } catch (error) {
          assert.ok(error instanceof DataCryptoError);
          cipherCode = error.code;
        }
        const { lines, log } = recorder();
        const res = await handleKeyFingerprint(req(`Bearer ${SECRET}`), { secret: SECRET, keyring: () => keyringFromEnv(process.env), log });
        assert.equal(res.status, 500);
        const text = await res.text();
        assert.deepEqual(JSON.parse(text), { ok: false, error: "The data keyring could not be loaded.", code: cipherCode });
        assert.equal(cipherCode, "BAD_KEYRING");
        assert.deepEqual(lines, [`ops.key_fingerprint.failed {"code":"BAD_KEYRING"}`]);
        assertNoSecrets(text + lines.join("\n"), [K1, K2, swapped]);
      }
    } finally {
      if (saved.keys === undefined) delete process.env.CLINFORMS_DATA_KEYS;
      else process.env.CLINFORMS_DATA_KEYS = saved.keys;
      if (saved.kid === undefined) delete process.env.CLINFORMS_DATA_KEY_ID;
      else process.env.CLINFORMS_DATA_KEY_ID = saved.kid;
    }
  });

  it("reports an unexpected loader failure as UNKNOWN without its message", async () => {
    const { lines, log } = recorder();
    const res = await handleKeyFingerprint(req(`Bearer ${SECRET}`), {
      secret: SECRET,
      keyring: () => {
        throw new Error(`boom ${K1.toString("base64")}`);
      },
      log,
    });
    assert.equal(res.status, 500);
    const text = await res.text();
    assert.equal(JSON.parse(text).code, "UNKNOWN");
    assertNoSecrets(text + lines.join("\n"));
  });
});

describe("GET /api/ops/key-fingerprint (route wiring)", () => {
  const saved = { ...process.env };
  afterEach(() => {
    for (const name of ["CRON_SECRET", "CLINFORMS_DATA_KEYS", "CLINFORMS_DATA_KEY_ID"]) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  });

  it("is a dynamic Node route reading CRON_SECRET and the app's CLINFORMS_DATA_KEYS / _KEY_ID", async () => {
    const route = await import("@/app/api/ops/key-fingerprint/route");
    assert.equal(route.runtime, "nodejs");
    assert.equal(route.dynamic, "force-dynamic");
    const quiet = console.info;
    console.info = () => undefined;
    try {
      delete process.env.CRON_SECRET;
      Object.assign(process.env, ENV);
      assert.equal((await route.GET(req(`Bearer ${SECRET}`))).status, 503);
      process.env.CRON_SECRET = SECRET;
      assert.equal((await route.GET(req("Bearer nope-nope-nope-nope"))).status, 401);
      const res = await route.GET(req(`Bearer ${SECRET}`));
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), keyringFingerprints(parseKeyring(KEYS_JSON, "k2")));
    } finally {
      console.info = quiet;
    }
  });
});
