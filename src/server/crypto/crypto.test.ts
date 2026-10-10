import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import { DataCipher, DataCryptoError, kidOf, parseKeyring } from "./envelope";

const k1 = randomBytes(32).toString("base64");
const k2 = randomBytes(32).toString("base64");
const ctxA = { tenantId: "clinic-a", table: "reports", rowId: "r-1" };

function cipher(keys: Record<string, string>, active: string): DataCipher {
  return new DataCipher(parseKeyring(JSON.stringify(keys), active));
}

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof DataCryptoError, `expected DataCryptoError, got ${String(err)}`);
    return err.code;
  }
  assert.fail("expected an error");
}

describe("data envelope (AES-256-GCM, HKDF per tenant, AAD tenant:table:row)", () => {
  it("round-trips strings and bytes and uses the v1.<kid>.<iv>.<ct> format", () => {
    const c = cipher({ k1 }, "k1");
    const ct = c.encrypt("Megan Hart – fictional", ctxA);
    assert.match(ct, /^v1\.k1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/);
    assert.equal(c.decryptString(ct, ctxA), "Megan Hart – fictional");
    const bytes = randomBytes(70_000);
    assert.deepEqual(c.decryptBytes(c.encrypt(bytes, ctxA), ctxA), bytes);
    assert.equal(c.decryptString(c.encrypt("", ctxA), ctxA), "");
  });

  it("uses a fresh IV every time", () => {
    const c = cipher({ k1 }, "k1");
    assert.notEqual(c.encrypt("same", ctxA), c.encrypt("same", ctxA));
  });

  it("rejects tampering with the ciphertext, IV or tag", () => {
    const c = cipher({ k1 }, "k1");
    const ct = c.encrypt("payload", ctxA);
    const [v, kid, iv, body] = ct.split(".");
    const flip = (s: string, i: number) => {
      const b = Buffer.from(s, "base64url");
      b[i] ^= 0x01;
      return b.toString("base64url");
    };
    assert.equal(code(() => c.decryptString([v, kid, iv, flip(body, 0)].join("."), ctxA)), "DECRYPT_FAILED");
    assert.equal(code(() => c.decryptString([v, kid, iv, flip(body, Buffer.from(body, "base64url").length - 1)].join("."), ctxA)), "DECRYPT_FAILED");
    assert.equal(code(() => c.decryptString([v, kid, flip(iv, 3), body].join("."), ctxA)), "DECRYPT_FAILED");
  });

  it("binds the ciphertext to its tenant, table and row (AAD + per-tenant key)", () => {
    const c = cipher({ k1 }, "k1");
    const ct = c.encrypt("payload", ctxA);
    assert.equal(code(() => c.decryptString(ct, { ...ctxA, tenantId: "clinic-b" })), "DECRYPT_FAILED");
    assert.equal(code(() => c.decryptString(ct, { ...ctxA, rowId: "r-2" })), "DECRYPT_FAILED");
    assert.equal(code(() => c.decryptString(ct, { ...ctxA, table: "forms" })), "DECRYPT_FAILED");
  });

  it("refuses an unknown kid and malformed strings", () => {
    const a = cipher({ k1 }, "k1");
    const b = cipher({ k2 }, "k2");
    assert.equal(code(() => b.decryptString(a.encrypt("x", ctxA), ctxA)), "UNKNOWN_KID");
    for (const bad of ["", "v1.k1.abc", "v2.k1.AAAAAAAAAAAAAAAA.AAAA", "v1.k1.!!!.AAAA", "v1.k1.AAAA.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"]) {
      assert.equal(code(() => a.decryptString(bad, ctxA)), "MALFORMED", bad);
    }
  });

  it("rotates by kid: old ciphertext still decrypts, rotate() re-encrypts with the active key", () => {
    const old = cipher({ k1 }, "k1");
    const ct1 = old.encrypt("history", ctxA);
    const both = cipher({ k1, k2 }, "k2");
    assert.equal(both.decryptString(ct1, ctxA), "history");
    assert.equal(both.needsRotation(ct1), true);
    const ct2 = both.rotate(ct1, ctxA);
    assert.equal(kidOf(ct2), "k2");
    assert.equal(both.needsRotation(ct2), false);
    assert.equal(both.rotate(ct2, ctxA), ct2);
    const onlyNew = cipher({ k2 }, "k2");
    assert.equal(onlyNew.decryptString(ct2, ctxA), "history");
    assert.equal(code(() => onlyNew.decryptString(ct1, ctxA)), "UNKNOWN_KID");
  });

  it("validates the keyring without echoing key material", () => {
    const short = randomBytes(16).toString("base64");
    for (const [json, kid] of [
      [undefined, "k1"],
      ["not json", "k1"],
      ["[]", "k1"],
      ["{}", "k1"],
      [JSON.stringify({ k1: short }), "k1"],
      [JSON.stringify({ "bad.kid": k1 }), "bad.kid"],
      [JSON.stringify({ k1 }), "k9"],
      [JSON.stringify({ k1 }), ""],
    ] as const) {
      try {
        parseKeyring(json, kid);
        assert.fail("expected BAD_KEYRING");
      } catch (err) {
        assert.ok(err instanceof DataCryptoError);
        assert.equal(err.code, "BAD_KEYRING");
        assert.ok(!err.message.includes(short) && !err.message.includes(k1));
      }
    }
  });

  it("rejects ambiguous AAD parts", () => {
    const c = cipher({ k1 }, "k1");
    assert.equal(code(() => c.encrypt("x", { tenantId: "a:b", table: "t", rowId: "r" })), "BAD_AAD");
    assert.equal(code(() => c.encrypt("x", { tenantId: "a", table: "t:x", rowId: "r" })), "BAD_AAD");
    assert.equal(code(() => c.encrypt("x", { tenantId: "a", table: "t", rowId: "" })), "BAD_AAD");
    // rowId may contain ':' (e.g. form_file_chunks rows are "<sha256>:<idx>")
    const ct = c.encrypt("x", { tenantId: "a", table: "t", rowId: "abc:1" });
    assert.equal(c.decryptString(ct, { tenantId: "a", table: "t", rowId: "abc:1" }), "x");
  });
});
