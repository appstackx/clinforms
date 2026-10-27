/**
 * Diary performance check (K2-NFR-060), LOCAL ONLY, fictional data: a fresh SQLite file in a temporary folder with
 * 20,000 patients and 50,000 appointments (a busy site with 10 practitioners plus two smaller sites, weekdays over
 * about seven months), then times the diary's day view for the busy site – the whole server loader the page uses
 * (columns, rota windows, items, free slots, patient names) and its main query alone – and the patient search.
 * Prints p50 / p95 / max and SQLite's query plan of the day query. Nothing is written anywhere else; the file is
 * deleted at the end.
 *
 *   node --import ./scripts/medreport/test-setup.mjs --import tsx scripts/pms/diary-perf.ts [--appointments 50000] [--patients 20000] [--runs 60]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Kysely } from "kysely";
import { pmsCan } from "../../src/modules/pms/core/permissions";
import { addDays, isoWeekday, londonDayRange, londonToUtcOrThrow } from "../../src/modules/pms/diary/time";
import type { BulkDiaryItem } from "../../src/modules/pms/diary/schemas";
import { parseDiaryParams } from "../../src/modules/pms/diary/view";
import { NodeSqliteDialect, openSqliteDatabase } from "../../src/server/db/dialects/sqlite-local";
import { applySqliteMigrations } from "../../src/server/db/migrations";
import type { Database } from "../../src/server/db/schema";
import { testCipher } from "../../src/server/db/testing/databases";
import type { DiaryCaller } from "../../src/server/pms/diary/caller";
import { loadDiaryView } from "../../src/server/pms/diary/view";
import { bulkCreateDiaryItems, listDiary } from "../../src/server/repos/pms/diary/appointments";
import { bulkCreateAvailability } from "../../src/server/repos/pms/diary/availability";
import { createPractitioner, createRoom, createService, createSite } from "../../src/server/repos/pms/directory";
import { bulkCreatePatients, searchPatients } from "../../src/server/repos/pms/patients";

const arg = (name: string, fallback: number) => {
  const i = process.argv.indexOf(`--${name}`);
  const n = i >= 0 ? Number(process.argv[i + 1]) : fallback;
  return Number.isInteger(n) && n > 0 ? n : fallback;
};
const APPOINTMENTS = arg("appointments", 50_000);
const PATIENTS = arg("patients", 20_000);
const RUNS = arg("runs", 60);
const T = "perf-clinic";
const ACTOR = { userId: "user_perf", sessionId: null };
const FIRST_DAY = "2026-03-02";

function stats(ms: number[]): string {
  const s = ms.slice().sort((a, b) => a - b);
  const at = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return `p50 ${at(0.5).toFixed(1)} ms · p95 ${at(0.95).toFixed(1)} ms · max ${s[s.length - 1].toFixed(1)} ms (${s.length} runs)`;
}

async function time<T>(runs: number, work: () => Promise<T>): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    await work();
    out.push(performance.now() - t0);
  }
  return out;
}

async function main(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "diary-perf-"));
  const file = path.join(dir, "perf.sqlite");
  const sqlite = openSqliteDatabase(file);
  applySqliteMigrations(sqlite);
  const db = new Kysely<Database>({ dialect: new NodeSqliteDialect({ database: sqlite }) });
  const ctx = { db, cipher: testCipher() };
  try {
    const t0 = performance.now();
    // Directory: a busy site (10 practitioners, 6 rooms) and two smaller ones (5 practitioners each).
    const layout = [10, 5, 5];
    const sites: { id: string; practitioners: string[]; rooms: string[] }[] = [];
    for (let s = 0; s < layout.length; s++) {
      const site = await createSite(ctx, T, { name: `Site ${s + 1} (fictional)`, code: `S${s + 1}` }, ACTOR);
      const rooms: string[] = [];
      for (let r = 0; r < (s === 0 ? 6 : 3); r++) rooms.push((await createRoom(ctx, T, { siteId: site.id, name: `Room ${r + 1}` }, ACTOR)).id);
      const practitioners: string[] = [];
      for (let p = 0; p < layout[s]; p++) {
        const n = sites.reduce((a, x) => a + x.practitioners.length, 0) + p + 1;
        practitioners.push((await createPractitioner(ctx, T, { displayName: `Practitioner ${n}`, registrationNumber: `PH-DEMO-${String(n).padStart(2, "0")}`, defaultSiteId: site.id }, ACTOR)).id);
      }
      sites.push({ id: site.id, practitioners, rooms });
    }
    const service = (await createService(ctx, T, { name: "Follow-up", durationMinutes: 30 }, ACTOR)).id;
    const rota = sites.flatMap((s) =>
      s.practitioners.flatMap((p, i) => [1, 2, 3, 4, 5].map((weekday) => ({ practitionerId: p, siteId: s.id, roomId: s.rooms[i] ?? null, weekday, startTime: "09:00", endTime: "17:00", validFrom: FIRST_DAY }))),
    );
    await bulkCreateAvailability(ctx, T, rota, ACTOR);
    // Patients.
    const people = Array.from({ length: PATIENTS }, (_, i) => ({ firstName: `Pat${i % 997}`, lastName: `Sim${String(i).padStart(5, "0")}`, dateOfBirth: `19${50 + (i % 50)}-0${1 + (i % 9)}-1${i % 9}`, importRef: `sim-pat-${String(i + 1).padStart(5, "0")}` }));
    const patientIds: string[] = [];
    for (let i = 0; i < people.length; i += 2000) patientIds.push(...(await bulkCreatePatients(ctx, T, people.slice(i, i + 2000), ACTOR)).ids);
    const t1 = performance.now();
    // Appointments: every practitioner, weekdays, 16 half-hour slots a day, until APPOINTMENTS are made.
    const items: BulkDiaryItem[] = [];
    let day = FIRST_DAY;
    let k = 0;
    let busyDay = "";
    while (items.length < APPOINTMENTS) {
      if (isoWeekday(day) <= 5) {
        for (const s of sites) {
          s.practitioners.forEach((p, i) => {
            for (let slot = 0; slot < 16 && items.length < APPOINTMENTS; slot++) {
              const startsAt = londonToUtcOrThrow(day, 9 * 60 + slot * 30);
              const st = k % 23 === 0 ? "cancelled" : k % 17 === 0 ? "dna" : day < "2026-09-01" ? "attended" : "booked";
              items.push({ kind: "appointment", siteId: s.id, practitionerId: p, roomId: s.rooms[i] ?? null, patientId: patientIds[k % patientIds.length], serviceId: service, startsAt, endsAt: new Date(Date.parse(startsAt) + 30 * 60_000).toISOString(), status: st, feeDue: st === "dna" });
              k++;
            }
          });
        }
        busyDay = day;
      }
      day = addDays(day, 1);
    }
    for (let i = 0; i < items.length; i += 4000) await bulkCreateDiaryItems(ctx, T, items.slice(i, i + 4000), ACTOR);
    const t2 = performance.now();
    const total = await db.selectFrom("pms_appointments").select((eb) => eb.fn.countAll<number>().as("n")).where("tenant_id", "=", T).executeTakeFirstOrThrow();
    console.log(`Loaded ${PATIENTS} patients (${((t1 - t0) / 1000).toFixed(1)} s) and ${Number(total.n)} appointments (${((t2 - t1) / 1000).toFixed(1)} s) from ${FIRST_DAY} to ${busyDay}.`);

    // A full day in the middle of the range, at the busy site.
    const date = "2026-06-10";
    const busy = sites[0].id;
    const caller: DiaryCaller = { tenantId: T, actor: ACTOR, can: (p) => pmsCan("owner", p), ctx: { ...ctx, now: () => new Date("2026-06-10T07:00:00.000Z") }, siteIds: null };
    const params = parseDiaryParams({ date, site: busy }, date);
    const first = await loadDiaryView(caller, params, date);
    if (!first.ok) throw new Error("day view refused");
    console.log(`Day view ${date}, site 1: ${first.data.columns.length} columns, ${first.data.cards.length} appointments, ${first.data.columns.reduce((n, c) => n + c.freeSlots.length, 0)} free slots.`);
    const range = londonDayRange(date);
    console.log(`  day query (listDiary, site + day):      ${stats(await time(RUNS, () => listDiary(ctx, T, { ...range, siteId: busy })))}`);
    console.log(`  whole day view (loadDiaryView):         ${stats(await time(RUNS, () => loadDiaryView(caller, params, date)))}`);
    const byRoom = parseDiaryParams({ date, site: busy, by: "room" }, date);
    console.log(`  day view by room:                       ${stats(await time(RUNS, () => loadDiaryView(caller, byRoom, date)))}`);
    const week = parseDiaryParams({ date, site: busy, view: "week", resource: sites[0].practitioners[0] }, date);
    console.log(`  week view, one practitioner:            ${stats(await time(RUNS, () => loadDiaryView(caller, week, date)))}`);
    console.log(`  patient search ("sim00123"):            ${stats(await time(RUNS, () => searchPatients(ctx, T, { q: "sim00123", limit: 10 })))}`);
    const compiled = db.selectFrom("pms_appointments").select(["id"]).where("tenant_id", "=", T).where("starts_at", "<", range.to).where("ends_at", ">", range.from).where("starts_at", ">", "2026-06-09T00:00:00.000Z").where("site_id", "=", busy).where("status", "not in", ["cancelled", "late_cancelled"]).orderBy("starts_at").orderBy("id").limit(501).compile();
    const stmt = sqlite.prepare(`EXPLAIN QUERY PLAN ${compiled.sql}`) as unknown as { all: (...p: unknown[]) => { detail: string }[] };
    console.log(`  query plan: ${stmt.all(...(compiled.parameters as unknown[])).map((r) => r.detail).join(" | ")}`);
  } finally {
    await db.destroy();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

void main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
