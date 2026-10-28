/**
 * Demonstration diary for the demo clinic (contract §9): a rota for the practitioners of the clinic's first two
 * sites and a realistic working week (Monday–Friday of the UK week that holds `now`) of appointments – the days
 * before today attended, with some missed and cancelled (late cancellations and missed appointments carry the
 * fee flag); today partly arrived / attended; the rest booked – plus blocked time (a team meeting, a day of leave,
 * a room out of use) and a few waiting-list entries. Fictional only: it uses the seeded directory and patients
 * (scripts/pms/seed-lib.ts) and refuses a clinic that is not flagged as a demonstration clinic.
 *
 * Idempotent: the rota and the waiting list are added once; a week is added once (its appointments carry the
 * import reference "demo-diary-<date>-…", and a week already there is left as it is). Running it in a later week
 * adds that week. Bulk loads: batches of 40 + one audit row each; the clash triggers still apply.
 *
 * Wiring (orchestrator, scripts/pms/seed-demo.ts – after seedDemoClinic):
 *   await seedDiary({ db, cipher: getDataCipher() }, slug, { log: (line) => console.log(`  ${line}`) });
 */
import { ukToday } from "../../src/modules/pms/core/text";
import { addDays, addMinutesIso, isoWeekday, londonToUtcOrThrow, mondayOf } from "../../src/modules/pms/diary/time";
import type { BulkDiaryItem, AvailabilityInput } from "../../src/modules/pms/diary/schemas";
import { RepoInputError, type RepoContext } from "../../src/server/repos/context";
import { listCasesForPatient } from "../../src/server/repos/pms/cases";
import { bulkCreateDiaryItems } from "../../src/server/repos/pms/diary/appointments";
import { bulkCreateAvailability } from "../../src/server/repos/pms/diary/availability";
import { addToWaitingList } from "../../src/server/repos/pms/diary/waiting-list";
import { listPractitioners, listRooms, listServices, listSites } from "../../src/server/repos/pms/directory";
import { searchPatients } from "../../src/server/repos/pms/patients";
import { getPmsSettings } from "../../src/server/repos/pms/settings";
import { SEED_ACTOR } from "./seed-lib";
import { pmsNow } from "../../src/modules/pms/core/clock";

export interface SeedDiaryOptions {
  /** "Now" (default: the clock) – picks the week and which appointments are in the past. */
  now?: Date;
  /** Deterministic choices (default 2026). */
  seed?: number;
  log?: (line: string) => void;
}

export interface SeedDiarySummary {
  week: string;
  rotaEntries: number;
  appointments: number;
  blocks: number;
  waitingList: number;
  /** True when the week was there already (nothing added for it). */
  weekExisted: boolean;
}

const ROTA_REF = "demo-diary-rota";

/** Small deterministic generator (mulberry32). */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Worker {
  practitionerId: string;
  siteId: string;
  roomId: string | null;
  /** ISO weekdays worked. */
  days: number[];
  start: number;
  end: number;
}

export async function seedDiary(ctx: RepoContext, tenantId: string, options: SeedDiaryOptions = {}): Promise<SeedDiarySummary> {
  const log = options.log ?? (() => undefined);
  if (!(await getPmsSettings(ctx, tenantId)).isDemo) throw new RepoInputError(`"${tenantId}" is not flagged as a demonstration clinic: the demo diary is loaded into demonstration clinics only.`);
  const now = options.now ?? pmsNow();
  const nowIso = now.toISOString();
  const today = ukToday(now);
  const monday = mondayOf(today);
  const rand = random(options.seed ?? 2026);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)];

  const sites = (await listSites(ctx, tenantId)).slice(0, 2);
  if (sites.length < 2) throw new RepoInputError("The demo diary needs the demo clinic's sites (run the clinic seed first).");
  const [practitioners, rooms, services] = await Promise.all([listPractitioners(ctx, tenantId, { bookableOnly: true }), listRooms(ctx, tenantId), listServices(ctx, tenantId)]);
  const byCode = (code: string) => services.find((s) => s.code === code) ?? null;
  const follow = byCode("FU") ?? services[0];
  const initial = byCode("IA") ?? follow;
  const mix = [follow, follow, follow, follow, initial, byCode("ACU") ?? follow, byCode("SM") ?? follow, byCode("TEL") ?? follow, byCode("DR") ?? follow].filter(Boolean);

  // Who works where: the practitioners whose usual site is one of the two; the first two of a site get its rooms.
  const workers: Worker[] = [];
  for (const site of sites) {
    const siteRooms = rooms.filter((r) => r.siteId === site.id);
    practitioners
      .filter((p) => p.defaultSiteId === site.id)
      .forEach((p, i) => {
        workers.push({
          practitionerId: p.id,
          siteId: site.id,
          roomId: siteRooms[i] ? siteRooms[i].id : null,
          days: i < 2 ? [1, 2, 3, 4, 5] : [2, 4],
          start: i === 1 ? 10 * 60 : 9 * 60,
          end: i === 1 ? 18 * 60 : 17 * 60,
        });
      });
  }
  if (workers.length === 0) throw new RepoInputError("The demo diary needs practitioners at the demo clinic's sites.");

  // Rota (once).
  let rotaEntries = 0;
  const haveRota = await ctx.db.selectFrom("pms_availability").select("id").where("tenant_id", "=", tenantId).where("import_ref", "like", `${ROTA_REF}-%`).limit(1).executeTakeFirst();
  if (!haveRota) {
    const rota: AvailabilityInput[] = workers.flatMap((w, wi) =>
      w.days.map((day) => ({
        practitionerId: w.practitionerId,
        siteId: w.siteId,
        roomId: w.roomId,
        weekday: day,
        startTime: `${String(Math.floor(w.start / 60)).padStart(2, "0")}:00`,
        endTime: `${String(Math.floor(w.end / 60)).padStart(2, "0")}:00`,
        validFrom: monday,
        onlineBookable: wi % 2 === 0,
        importRef: `${ROTA_REF}-${wi + 1}-${day}`,
      })),
    );
    rotaEntries = (await bulkCreateAvailability(ctx, tenantId, rota, SEED_ACTOR, { source: "demo-seed" })).length;
    log(`Diary: ${rotaEntries} rota entries for ${workers.length} practitioners at ${sites.map((s) => s.name).join(" and ")}.`);
  }

  const weekRef = `demo-diary-${monday}`;
  const haveWeek = await ctx.db.selectFrom("pms_appointments").select("id").where("tenant_id", "=", tenantId).where("import_ref", "like", `${weekRef}-%`).limit(1).executeTakeFirst();
  let appointments = 0;
  let blocks = 0;
  if (!haveWeek) {
    const patients = [...(await searchPatients(ctx, tenantId, { limit: 100 })), ...(await searchPatients(ctx, tenantId, { limit: 100, offset: 100 }))];
    if (patients.length < 10) throw new RepoInputError("The demo diary needs the demo clinic's patients (run the clinic seed first).");
    // Shuffle so the week is not alphabetical.
    for (let i = patients.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [patients[i], patients[j]] = [patients[j], patients[i]];
    }
    const caseOf = new Map<string, string | null>();
    const openCase = async (patientId: string) => {
      if (!caseOf.has(patientId)) caseOf.set(patientId, (await listCasesForPatient(ctx, tenantId, patientId)).find((c) => c.status === "open")?.id ?? null);
      return caseOf.get(patientId) ?? null;
    };

    const items: BulkDiaryItem[] = [];
    const busyPatient = new Map<string, { s: number; e: number }[]>();
    const at = (date: string, minute: number) => londonToUtcOrThrow(date, minute);
    const blocked: { practitionerId: string | null; roomId: string | null; date: string; start: number; end: number }[] = [];
    // Blocked time: a team meeting at each site on Wednesday 13:00–14:00, one practitioner's day of leave on
    // Friday, the second room of the first site out of use on Thursday morning.
    const wed = addDays(monday, 2);
    for (const w of workers.filter((x) => x.days.includes(3))) blocked.push({ practitionerId: w.practitionerId, roomId: null, date: wed, start: 13 * 60, end: 14 * 60 });
    const onLeave = workers[workers.length - 1];
    blocked.push({ practitionerId: onLeave.practitionerId, roomId: null, date: addDays(monday, 4), start: 0, end: 1440 });
    const secondRoom = rooms.filter((r) => r.siteId === sites[0].id)[1];
    if (secondRoom) blocked.push({ practitionerId: null, roomId: secondRoom.id, date: addDays(monday, 3), start: 9 * 60, end: 12 * 60 });
    for (let i = 0; i < blocked.length; i++) {
      const b = blocked[i];
      const site = b.practitionerId ? (workers.find((w) => w.practitionerId === b.practitionerId)?.siteId as string) : sites[0].id;
      items.push({
        kind: "block",
        siteId: site,
        practitionerId: b.practitionerId,
        roomId: b.roomId,
        startsAt: at(b.date, b.start),
        endsAt: b.end === 1440 ? at(addDays(b.date, 1), 0) : at(b.date, b.end),
        status: "booked",
        blockKind: b.end - b.start >= 1440 ? "leave" : b.roomId ? "closed" : "meeting",
        title: b.end - b.start >= 1440 ? "Annual leave" : b.roomId ? "Out of use (repairs)" : "Team meeting",
        source: "import",
        importRef: `${weekRef}-blk-${i + 1}`,
      });
    }
    const isBlocked = (w: Worker, date: string, s: number, e: number) =>
      blocked.some((b) => b.date === date && s < b.end && e > b.start && ((b.practitionerId && b.practitionerId === w.practitionerId) || (b.roomId && b.roomId === w.roomId)));

    let next = 0;
    for (let d = 0; d < 5; d++) {
      const date = addDays(monday, d);
      for (let wi = 0; wi < workers.length; wi++) {
        const w = workers[wi];
        if (!w.days.includes(isoWeekday(date))) continue;
        let minute = w.start;
        while (minute < w.end) {
          const service = minute === w.start ? initial : pick(mix);
          const length = service.durationMinutes;
          const end = minute + length;
          const lunch = minute < 13 * 60 && end > 12 * 60 + 30;
          if (end > w.end || lunch || isBlocked(w, date, minute, end) || rand() < 0.25) {
            minute = lunch ? 13 * 60 + 30 : minute + 15;
            continue;
          }
          // A patient who is not already somewhere else then.
          let patient = patients[next % patients.length];
          for (let tries = 0; tries < patients.length; tries++) {
            const spans = busyPatient.get(patient.id) ?? [];
            if (!spans.some((x) => x.s < end + d * 1440 && x.e > minute + d * 1440)) break;
            patient = patients[++next % patients.length];
          }
          next++;
          busyPatient.set(patient.id, [...(busyPatient.get(patient.id) ?? []), { s: minute + d * 1440, e: end + d * 1440 }]);
          const startsAt = at(date, minute);
          const endsAt = addMinutesIso(startsAt, length);
          const past = endsAt <= nowIso;
          const started = startsAt <= nowIso;
          const r = rand();
          let status: BulkDiaryItem["status"] = "booked";
          if (past) status = r < 0.76 ? "attended" : r < 0.84 ? "dna" : r < 0.91 ? "late_cancelled" : "cancelled";
          else if (started) status = "arrived";
          else if (date === today && r < 0.05) status = "late_cancelled";
          else if (r < 0.06) status = "cancelled";
          items.push({
            kind: "appointment",
            siteId: w.siteId,
            practitionerId: w.practitionerId,
            roomId: w.roomId,
            patientId: patient.id,
            caseId: await openCase(patient.id),
            serviceId: service.id,
            startsAt,
            endsAt,
            status,
            source: rand() < 0.15 ? "online" : "staff",
            feeDue: status === "dna" || status === "late_cancelled",
            cancelReason: status === "cancelled" || status === "late_cancelled" ? pick(["patient", "patient", "illness", "weather", "clinic"] as const) : null,
            importRef: `${weekRef}-${wi + 1}-${date}-${String(minute).padStart(4, "0")}`,
          });
          minute = end;
        }
      }
    }
    const ids = await bulkCreateDiaryItems(ctx, tenantId, items, SEED_ACTOR, { source: "demo-seed", week: monday });
    blocks = items.filter((i) => i.kind === "block").length;
    appointments = ids.length - blocks;
    const byStatus = items.filter((i) => i.kind === "appointment").reduce<Record<string, number>>((acc, i) => ({ ...acc, [i.status]: (acc[i.status] ?? 0) + 1 }), {});
    log(`Diary: week of ${monday} – ${appointments} appointments (${Object.entries(byStatus).map(([k, v]) => `${v} ${k}`).join(", ")}), ${blocks} blocked times.`);
  } else {
    log(`Diary: the week of ${monday} is there already – nothing added.`);
  }

  // Waiting list (once – with the rota).
  let waitingList = 0;
  if (!haveRota) {
    const people = await searchPatients(ctx, tenantId, { limit: 12, offset: 20 });
    const entries = [
      { priority: "urgent" as const, siteId: sites[0].id, practitionerId: workers[0].practitionerId, preferredTime: "morning" as const, notes: "Happy to take any short-notice gap (fictional)." },
      { priority: "soon" as const, siteId: sites[1].id, preferredDays: [2, 4], preferredTime: "afternoon" as const },
      { priority: "routine" as const, siteId: null, preferredTime: "evening" as const, notes: "Works shifts – evenings only (fictional)." },
      { priority: "routine" as const, siteId: sites[0].id, preferredDays: [1, 3, 5] },
    ];
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const p = people[i];
      if (!p) break;
      await addToWaitingList(ctx, tenantId, { patientId: p.id, serviceId: follow.id, ...e, earliestOn: today }, SEED_ACTOR);
      waitingList++;
    }
    log(`Diary: ${waitingList} patients on the waiting list.`);
  }
  return { week: monday, rotaEntries, appointments, blocks, waitingList, weekExisted: Boolean(haveWeek) };
}
