/**
 * Where large files live (B07): a private object store instead of the database, so a clinic's scans and letters
 * do not grow the (much dearer) database. The store only ever holds CIPHERTEXT: callers encrypt a file with the
 * clinic's key (AAD "<tenant>:<table>.object_enc:<id>") before put() and verify size + SHA-256 after get().
 *
 * Off unless configured – then every caller keeps the in-database pieces it always had (local, tests, D1):
 *   CLINFORMS_FILE_STORE=supabase
 *   SUPABASE_URL=https://<ref>.supabase.co   (the London project that holds the database)
 *   SUPABASE_SERVICE_ROLE_KEY=…               (server only, never sent to a browser)
 *   CLINFORMS_FILE_BUCKET=clinic-files        (private bucket, optional – this is the default)
 *
 * Keys are "<tenant>/<kind>/<id>": one clinic's files never share a prefix with another's.
 */

export interface FileStore {
  readonly name: string;
  put(key: string, body: string): Promise<void>;
  /** The stored body, or null when there is no such object. */
  get(key: string): Promise<string | null>;
  /** Removes these objects (missing ones are ignored). */
  remove(keys: readonly string[]): Promise<void>;
}

export class FileStoreError extends Error {
  readonly code = "FILE_STORE";
  constructor(message: string) {
    super(message);
    this.name = "FileStoreError";
  }
}

const KEY_PART = /^[a-z0-9][a-z0-9._-]{0,127}$/i;

/** "<tenant>/<kind>/<id>" – every part checked, so a key can never climb out of its clinic's prefix. */
export function fileKey(tenantId: string, kind: string, id: string): string {
  for (const part of [tenantId, kind, id]) if (!KEY_PART.test(part) || part.includes("..")) throw new FileStoreError(`Bad file key part: ${part}`);
  return `${tenantId}/${kind}/${id}`;
}

/** Supabase Storage over its REST API (no SDK): private bucket, service-role key, server side only. */
export class SupabaseFileStore implements FileStore {
  readonly name = "supabase";
  constructor(
    private readonly url: string,
    private readonly serviceKey: string,
    private readonly bucket: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private endpoint(key: string): string {
    return `${this.url.replace(/\/+$/, "")}/storage/v1/object/${encodeURIComponent(this.bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { authorization: `Bearer ${this.serviceKey}`, apikey: this.serviceKey, ...extra };
  }

  async put(key: string, body: string): Promise<void> {
    // x-upsert false: an id is written once; a clash means a bug, not a file to overwrite.
    const res = await this.fetchImpl(this.endpoint(key), { method: "POST", headers: this.headers({ "content-type": "application/octet-stream", "x-upsert": "false", "cache-control": "no-store" }), body });
    if (!res.ok) throw new FileStoreError(`The file store refused the upload (${res.status}).`);
  }

  async get(key: string): Promise<string | null> {
    const res = await this.fetchImpl(this.endpoint(key), { method: "GET", headers: this.headers(), cache: "no-store" });
    if (res.status === 404 || res.status === 400) {
      // Supabase answers a missing object with 400 {"statusCode":"404"} or a plain 404.
      const text = await res.text().catch(() => "");
      if (res.status === 404 || /not.?found|"404"/i.test(text)) return null;
      throw new FileStoreError(`The file store refused the download (${res.status}).`);
    }
    if (!res.ok) throw new FileStoreError(`The file store refused the download (${res.status}).`);
    return await res.text();
  }

  async remove(keys: readonly string[]): Promise<void> {
    for (let i = 0; i < keys.length; i += 100) {
      const res = await this.fetchImpl(`${this.url.replace(/\/+$/, "")}/storage/v1/object/${encodeURIComponent(this.bucket)}`, {
        method: "DELETE",
        headers: this.headers({ "content-type": "application/json" }),
        body: JSON.stringify({ prefixes: keys.slice(i, i + 100) }),
      });
      if (!res.ok) throw new FileStoreError(`The file store refused the removal (${res.status}).`);
    }
  }
}

/** In memory, for tests and the local demo. */
export class MemoryFileStore implements FileStore {
  readonly name = "memory";
  readonly objects = new Map<string, string>();
  async put(key: string, body: string): Promise<void> {
    if (this.objects.has(key)) throw new FileStoreError("That file already exists.");
    this.objects.set(key, body);
  }
  async get(key: string): Promise<string | null> {
    return this.objects.get(key) ?? null;
  }
  async remove(keys: readonly string[]): Promise<void> {
    for (const k of keys) this.objects.delete(k);
  }
}

export function fileStoreFromEnv(env: Readonly<Record<string, string | undefined>> = process.env): FileStore | null {
  const kind = (env.CLINFORMS_FILE_STORE ?? "").trim().toLowerCase();
  if (!kind || kind === "db" || kind === "off") return null;
  if (kind === "memory") return new MemoryFileStore();
  if (kind !== "supabase") throw new FileStoreError(`CLINFORMS_FILE_STORE must be "supabase", "memory" or unset (got "${kind}").`);
  const url = env.SUPABASE_URL?.trim();
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !/^https:\/\//.test(url) || !key) throw new FileStoreError("CLINFORMS_FILE_STORE=supabase needs SUPABASE_URL (https) and SUPABASE_SERVICE_ROLE_KEY.");
  return new SupabaseFileStore(url, key, env.CLINFORMS_FILE_BUCKET?.trim() || "clinic-files");
}

let current: FileStore | null | undefined;

/** The configured store, or null (files stay in the database). Read once per process. */
export function getFileStore(): FileStore | null {
  if (current === undefined) current = fileStoreFromEnv();
  return current;
}

/** Tests: pin the store (null = in the database); undefined = read the environment again. */
export function setFileStoreForTests(store: FileStore | null | undefined): void {
  current = store;
}
