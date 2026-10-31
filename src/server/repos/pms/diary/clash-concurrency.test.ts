/**
 * The no-double-booking trigger (migrations 0110/0119) under REAL concurrency: two connections writing at the same
 * time. PGlite is one in-process connection, so this runs only on a real local Postgres (CLINFORMS_TEST_PG_URL –
 * db/testing/real-pg.ts; skipped otherwise). The trigger takes transaction-scoped advisory locks per practitioner and
 * room (pg_advisory_xact_lock – also safe through Supabase's transaction pooler), so the second writer waits for the
 * first to commit and then sees its row. Also: patient numbers (max + 1, unique, retried) under simultaneous
 * registrations through the app's pool. Fictional data only. Run by `npm run test:pms` / `test:db`.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import { classifyDbError } from "../../../db/errors";
import { pgConnectionConfig } from "../../../db/dialects/postgres";
import { testCipher } from "../../../db/testing/databases";
import { createRealPgDb, realPgTestUrl } from "../../../db/testing/real-pg";
import { createPatient } from "../patients";

const realUrl = realPgTestUrl();
const T = "clash-clinic";
const AT = "2026-10-28T08:00:00.000Z";

describe("diary clash trigger with two concurrent writers (real Postgres)", { skip: realUrl ? false : "CLINFORMS_TEST_PG_URL not set" }, () => {
  let real: Awaited<ReturnType<typeof createRealPgDb>>;
  let url = "";
  const clients: pg.Client[] = [];
  let n = 0;
  const connect = async () => {
    const c = new pg.Client(pgConnectionConfig({ connectionString: url, ssl: "disable" }));
    await c.connect();
    clients.push(c);
    return c;
  };
  const block = (c: pg.Client, o: { practitioner?: string | null; room?: string | null; from: string; to: string }) =>
    c.query(
      `insert into pms_appointments (tenant_id, id, rev, kind, site_id, practitioner_id, room_id, starts_at, ends_at, starts_on, status, block_kind, created_at, updated_at)
       values ($1, $2, 1, 'block', 'site_1', $3, $4, $5, $6, $7, 'booked', 'admin', $8, $8)`,
      [T, `appt_${++n}`, o.practitioner ?? null, o.room ?? null, o.from, o.to, o.from.slice(0, 10), AT],
    );
  /** Resolves "pending" if the promise has not settled within `ms`. */
  const stateAfter = (p: Promise<unknown>, ms: number) =>
    Promise.race([p.then(() => "done", () => "failed"), new Promise((r) => setTimeout(() => r("pending"), ms))]);

  before(async () => {
    real = await createRealPgDb(realUrl as string);
    url = real.url;
    const c = await connect();
    await c.query(`insert into pms_sites (tenant_id, id, name, created_at, updated_at) values ($1, 'site_1', 'Riverside (fictional)', $2, $2)`, [T, AT]);
    await c.query(`insert into pms_rooms (tenant_id, id, site_id, name, created_at, updated_at) values ($1, 'room_1', 'site_1', 'Room 1', $2, $2)`, [T, AT]);
    for (const id of ["prac_1", "prac_2", "prac_3"]) {
      await c.query(`insert into pms_practitioners (tenant_id, id, display_name, created_at, updated_at) values ($1, $2, $3, $4, $4)`, [T, id, `Practitioner ${id} (fictional)`, AT]);
    }
  });
  after(async () => {
    for (const c of clients) await c.end().catch(() => undefined);
    await real?.close();
  });

  it("the same practitioner: the second writer waits for the first, then is refused (practitioner_clash → CONSTRAINT_CHECK)", async () => {
    const [a, b] = [await connect(), await connect()];
    await a.query("begin");
    await block(a, { practitioner: "prac_1", from: "2026-11-02T10:00:00.000Z", to: "2026-11-02T11:00:00.000Z" });
    await b.query("begin");
    const second = block(b, { practitioner: "prac_1", from: "2026-11-02T10:30:00.000Z", to: "2026-11-02T11:30:00.000Z" });
    second.catch(() => undefined);
    assert.equal(await stateAfter(second, 400), "pending", "blocked on the practitioner's advisory lock");
    await a.query("commit");
    const err = await second.then(() => null, (e: unknown) => e);
    assert.ok(err, "the overlapping write was refused");
    assert.equal(classifyDbError(err), "CONSTRAINT_CHECK");
    assert.equal((err as { constraint?: string }).constraint, "pms_appointments_practitioner_clash");
    await b.query("rollback");
  });

  it("the same room, different practitioners: refused (room_clash); the first writer rolling back lets the second in", async () => {
    const [a, b] = [await connect(), await connect()];
    await a.query("begin");
    await block(a, { practitioner: "prac_2", room: "room_1", from: "2026-11-03T09:00:00.000Z", to: "2026-11-03T10:00:00.000Z" });
    await b.query("begin");
    const second = block(b, { practitioner: "prac_3", room: "room_1", from: "2026-11-03T09:30:00.000Z", to: "2026-11-03T10:30:00.000Z" });
    second.catch(() => undefined);
    assert.equal(await stateAfter(second, 400), "pending", "blocked on the room's advisory lock");
    await a.query("commit");
    const err = await second.then(() => null, (e: unknown) => e);
    assert.equal((err as { constraint?: string } | null)?.constraint, "pms_appointments_room_clash");
    await b.query("rollback");

    await a.query("begin");
    await block(a, { practitioner: "prac_2", room: "room_1", from: "2026-11-04T09:00:00.000Z", to: "2026-11-04T10:00:00.000Z" });
    await b.query("begin");
    const again = block(b, { practitioner: "prac_3", room: "room_1", from: "2026-11-04T09:30:00.000Z", to: "2026-11-04T10:30:00.000Z" });
    again.catch(() => undefined);
    assert.equal(await stateAfter(again, 400), "pending");
    await a.query("rollback");
    await again;
    await b.query("commit");
  });

  it("different practitioners and rooms do not wait for each other", async () => {
    const [a, b] = [await connect(), await connect()];
    await a.query("begin");
    await block(a, { practitioner: "prac_1", from: "2026-11-05T10:00:00.000Z", to: "2026-11-05T11:00:00.000Z" });
    await b.query("begin");
    assert.equal(await stateAfter(block(b, { practitioner: "prac_2", from: "2026-11-05T10:00:00.000Z", to: "2026-11-05T11:00:00.000Z" }), 2000), "done");
    await Promise.all([a.query("commit"), b.query("commit")]);
  });

  it("patient numbers: five registrations at the same moment (the app's pool) get five different numbers", async () => {
    const ctx = { db: real.db, cipher: testCipher(), now: () => new Date(AT) };
    const actor = { userId: "user_owner", sessionId: "sess_owner" };
    const made = await Promise.all([1, 2, 3, 4, 5].map((i) => createPatient(ctx, T, { firstName: `Pat${i}`, lastName: "Concurrent (fictional)" }, actor)));
    assert.deepEqual(made.map((p) => p.patientNumber).sort((a, b) => a - b), [1, 2, 3, 4, 5]);
  });
});
