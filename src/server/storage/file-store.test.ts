/** The file store (B07): key rules, configuration, and the Supabase Storage requests (against a fake fetch). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { FileStoreError, MemoryFileStore, SupabaseFileStore, fileKey, fileStoreFromEnv } from "./file-store";

test("keys are <tenant>/<kind>/<id> and can never leave their clinic's prefix", () => {
  assert.equal(fileKey("blue-heart", "attachment", "att_01H.x"), "blue-heart/attachment/att_01H.x");
  for (const bad of [["../x", "attachment", "a"], ["t", "a/b", "c"], ["t", "attachment", ".."], ["t", "attachment", "a..b"], ["", "attachment", "a"], ["t", "attachment", "a b"]]) {
    assert.throws(() => fileKey(bad[0], bad[1], bad[2]), FileStoreError, bad.join("|"));
  }
});

test("off unless configured; supabase needs an https URL and the service key", () => {
  assert.equal(fileStoreFromEnv({}), null);
  assert.equal(fileStoreFromEnv({ CLINFORMS_FILE_STORE: "db" }), null);
  assert.ok(fileStoreFromEnv({ CLINFORMS_FILE_STORE: "memory" }) instanceof MemoryFileStore);
  assert.throws(() => fileStoreFromEnv({ CLINFORMS_FILE_STORE: "supabase" }), /SUPABASE_URL/);
  assert.throws(() => fileStoreFromEnv({ CLINFORMS_FILE_STORE: "supabase", SUPABASE_URL: "http://x", SUPABASE_SERVICE_ROLE_KEY: "k" }), /https/);
  assert.throws(() => fileStoreFromEnv({ CLINFORMS_FILE_STORE: "s3" }), /must be/);
  assert.equal(fileStoreFromEnv({ CLINFORMS_FILE_STORE: "supabase", SUPABASE_URL: "https://ref.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k" })?.name, "supabase");
});

test("Supabase Storage: private bucket, service key, no overwrite, missing = null, errors throw", async () => {
  const calls: { url: string; method: string; headers: Record<string, string>; body?: string }[] = [];
  const objects = new Map<string, string>();
  const fake = (async (url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    calls.push({ url, method: String(init.method), headers, body: typeof init.body === "string" ? init.body : undefined });
    const key = decodeURIComponent(url.replace("https://ref.supabase.co/storage/v1/object/clinic-files/", ""));
    if (init.method === "POST") {
      if (objects.has(key)) return new Response('{"statusCode":"409"}', { status: 409 });
      objects.set(key, String(init.body));
      return new Response("{}", { status: 200 });
    }
    if (init.method === "GET") return objects.has(key) ? new Response(objects.get(key), { status: 200 }) : new Response('{"statusCode":"404","error":"not_found"}', { status: 400 });
    if (init.method === "DELETE") {
      for (const k of JSON.parse(String(init.body)).prefixes) objects.delete(k);
      return new Response("[]", { status: 200 });
    }
    return new Response("", { status: 500 });
  }) as unknown as typeof fetch;
  const store = new SupabaseFileStore("https://ref.supabase.co/", "service-key", "clinic-files", fake);
  await store.put("t/attachment/a1", "v1.cipher");
  assert.equal(calls[0].url, "https://ref.supabase.co/storage/v1/object/clinic-files/t/attachment/a1");
  assert.equal(calls[0].headers.authorization, "Bearer service-key");
  assert.equal(calls[0].headers["x-upsert"], "false");
  await assert.rejects(store.put("t/attachment/a1", "again"), /refused the upload \(409\)/);
  assert.equal(await store.get("t/attachment/a1"), "v1.cipher");
  assert.equal(await store.get("t/attachment/none"), null);
  await store.remove(["t/attachment/a1"]);
  assert.equal(calls.at(-1)?.method, "DELETE");
  assert.equal(await store.get("t/attachment/a1"), null);
  const broken = new SupabaseFileStore("https://ref.supabase.co", "k", "clinic-files", (async () => new Response("down", { status: 503 })) as unknown as typeof fetch);
  await assert.rejects(broken.get("t/attachment/a1"), /refused the download \(503\)/);
});
