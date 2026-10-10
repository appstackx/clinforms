import assert from "node:assert/strict";
import { createHash, createHmac, hkdfSync, randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import { HKDF_INFO, parseKeyring } from "./envelope";
import { KEY_FINGERPRINT_LABEL, KEY_FINGERPRINT_PATTERN, keyFingerprint, keyringFingerprints } from "./fingerprint";

/** Bytes 0x00..0x1f. */
const SEQ_KEY = Buffer.from(Array.from({ length: 32 }, (_, i) => i));

describe("data key fingerprints (HMAC-SHA256(raw key, 'clinforms:key-fingerprint:v1'), first 16 hex)", () => {
  it("matches known answers computed independently (openssl dgst -sha256 -mac HMAC)", () => {
    // printf '%s' clinforms:key-fingerprint:v1 | openssl dgst -sha256 -mac HMAC -macopt hexkey:000102…1f
    assert.equal(keyFingerprint(SEQ_KEY), "52780e4c408337e0");
    assert.equal(keyFingerprint(Buffer.alloc(32, 0xff)), "71ccd22e93ce2474");
    assert.equal(KEY_FINGERPRINT_LABEL, "clinforms:key-fingerprint:v1");
  });

  it("is stable: same key → same fingerprint, whatever the kid, the keyring order or the base64 padding", () => {
    const key = randomBytes(32);
    const b64 = key.toString("base64");
    const a = keyringFingerprints(parseKeyring(JSON.stringify({ k1: b64, k2: SEQ_KEY.toString("base64") }), "k1"));
    const b = keyringFingerprints(parseKeyring(JSON.stringify({ k2: SEQ_KEY.toString("base64"), k1: b64.replace(/=+$/, "") }), "k1"));
    assert.deepEqual(a, b);
    assert.deepEqual(a, {
      activeKid: "k1",
      keys: [
        { kid: "k1", fingerprint: keyFingerprint(key) },
        { kid: "k2", fingerprint: "52780e4c408337e0" },
      ],
    });
    const renamed = keyringFingerprints(parseKeyring(JSON.stringify({ other: b64 }), "other"));
    assert.equal(renamed.keys[0].fingerprint, keyFingerprint(key));
    assert.match(keyFingerprint(key), KEY_FINGERPRINT_PATTERN);
  });

  it("tells keys apart (1 000 random keys, no collision; one flipped bit changes it)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(keyFingerprint(randomBytes(32)));
    assert.equal(seen.size, 1000);
    const flipped = Buffer.from(SEQ_KEY);
    flipped[31] ^= 1;
    assert.notEqual(keyFingerprint(flipped), keyFingerprint(SEQ_KEY));
  });

  it("is domain-separated from the key itself, plain hashes, other labels and the data subkeys", () => {
    for (const key of [SEQ_KEY, randomBytes(32), randomBytes(32)]) {
      const fp = keyFingerprint(key);
      const hex = key.toString("hex");
      for (let i = 0; i + 16 <= hex.length; i++) assert.notEqual(hex.slice(i, i + 16), fp);
      const other = (label: string) => createHmac("sha256", key).update(label, "utf8").digest("hex").slice(0, 16);
      assert.notEqual(fp, createHash("sha256").update(key).digest("hex").slice(0, 16));
      assert.notEqual(fp, other("clinforms:key-fingerprint:v2"));
      assert.notEqual(fp, other(HKDF_INFO));
      assert.notEqual(fp, other(""));
      assert.notEqual(fp, createHmac("sha256", KEY_FINGERPRINT_LABEL).update(key).digest("hex").slice(0, 16), "key and message not swapped");
      for (const tenant of ["clinic-a", "zz-selftest", ""]) {
        const subkey = Buffer.from(hkdfSync("sha256", key, Buffer.from(tenant, "utf8"), Buffer.from(HKDF_INFO, "utf8"), 32));
        assert.notEqual(fp, subkey.toString("hex").slice(0, 16));
        assert.notEqual(fp, keyFingerprint(subkey));
      }
    }
    assert.notEqual(KEY_FINGERPRINT_LABEL, HKDF_INFO);
  });

  it("never carries key material in its output", () => {
    const keys = { k1: randomBytes(32), k2: randomBytes(32) };
    const out = JSON.stringify(
      keyringFingerprints(parseKeyring(JSON.stringify({ k1: keys.k1.toString("base64"), k2: keys.k2.toString("base64") }), "k2")),
    );
    for (const key of Object.values(keys)) {
      for (const encoded of [key.toString("base64"), key.toString("base64url"), key.toString("hex")]) {
        for (let i = 0; i + 12 <= encoded.length; i++) assert.ok(!out.includes(encoded.slice(i, i + 12)), "no 12-character run of an encoded key");
      }
    }
    assert.deepEqual(Object.keys(JSON.parse(out)).sort(), ["activeKid", "keys"]);
  });
});
