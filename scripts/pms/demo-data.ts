/**
 * The demonstration clinic for the clinic system: "Riverside Physiotherapy (fictional)" – 3 sites, 6 rooms,
 * 8 practitioners, appointment types and price lists, referrers and payers, and 200 patients with cases, payers
 * and treatment authorisations. EVERYTHING IS FICTIONAL (CLAUDE.md "Fictional data only"):
 * - organisations end "(fictional)"; e-mail addresses are @example.com;
 * - phone numbers come from Ofcom's ranges for drama (07700 900xxx mobiles, 01632 960xxx landlines);
 * - practitioners carry the invalid registration format PH-DEMO-0N; patients are sim-pat-NNN (001 and 002 are the
 *   ClinForms demo patients Megan Hart and Daniel Brooks, as in src/sandbox/tm3-sim/fixtures; the rest start at
 *   sim-pat-007, after the sandbox's own 003–006);
 * - postcodes use the "9ZZ" units of the existing fixtures.
 * Deterministic: the same seed gives the same clinic (a small PRNG, no Math.random).
 */
import type { AuthorisationInput, CaseInput, PatientInput, PractitionerInput, ReferrerInput, ServiceInput, SiteInput } from "../../src/modules/pms/core/schemas";
import type { PayerType, ReferrerKind } from "../../src/modules/pms/core/types";

export const DEMO_CLINIC = {
  slug: "riverside-demo",
  name: "Riverside Physiotherapy (fictional)",
  ownerEmail: "owner@riverside-demo.example.com",
} as const;

/** mulberry32 – a tiny deterministic PRNG. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SITES: (SiteInput & { key: string; rooms: string[] })[] = [
  { key: "BLE", name: "Bletchley (fictional)", code: "BLE", address: ["2 Station Parade (fictional)", "Bletchley", "Milton Keynes"], postcode: "MK2 9ZZ", phone: "01632 960101", email: "bletchley@riverside-demo.example.com", sortOrder: 1, rooms: ["Room 1", "Room 2"] },
  { key: "WOL", name: "Wolverton (fictional)", code: "WOL", address: ["18 Market Row (fictional)", "Wolverton", "Milton Keynes"], postcode: "MK12 9ZZ", phone: "01632 960102", email: "wolverton@riverside-demo.example.com", sortOrder: 2, rooms: ["Room 1", "Room 2"] },
  { key: "CMK", name: "Central Milton Keynes (fictional)", code: "CMK", address: ["5 Silbury Court (fictional)", "Central Milton Keynes"], postcode: "MK9 9ZZ", phone: "01632 960103", email: "cmk@riverside-demo.example.com", sortOrder: 3, rooms: ["Room 1", "Rehab gym"] },
];

export const PRACTITIONERS: (PractitionerInput & { site: string })[] = [
  { displayName: "Sarah Reid", registrationNumber: "PH-DEMO-01", colour: "#0D9488", site: "BLE", email: "sarah.reid@riverside-demo.example.com", sortOrder: 1 },
  { displayName: "Tom Ellis", registrationNumber: "PH-DEMO-02", colour: "#2563EB", site: "WOL", email: "tom.ellis@riverside-demo.example.com", sortOrder: 2 },
  { displayName: "Priya Shah", registrationNumber: "PH-DEMO-03", colour: "#7C3AED", site: "CMK", email: "priya.shah@riverside-demo.example.com", sortOrder: 3, onlineBookable: true },
  { displayName: "James Okafor", registrationNumber: "PH-DEMO-04", colour: "#DB2777", site: "BLE", email: "james.okafor@riverside-demo.example.com", sortOrder: 4, onlineBookable: true },
  { displayName: "Hannah Moore", registrationNumber: "PH-DEMO-05", colour: "#EA580C", site: "WOL", email: "hannah.moore@riverside-demo.example.com", sortOrder: 5 },
  { displayName: "Amira Hassan", registrationNumber: "PH-DEMO-06", colour: "#16A34A", site: "CMK", email: "amira.hassan@riverside-demo.example.com", sortOrder: 6, onlineBookable: true },
  { displayName: "Owen Hughes", registrationNumber: "PH-DEMO-07", colour: "#CA8A04", site: "CMK", email: "owen.hughes@riverside-demo.example.com", sortOrder: 7 },
  { displayName: "Grace Bennett", registrationNumber: "PH-DEMO-08", profession: "sports_therapist", colour: "#475569", site: "BLE", email: "grace.bennett@riverside-demo.example.com", sortOrder: 8 },
];

export const SERVICES: (ServiceInput & { key: string })[] = [
  { key: "IA", name: "Initial assessment", code: "IA", category: "initial", durationMinutes: 45, defaultPricePence: 7000, colour: "#0D9488", onlineBookable: true, sortOrder: 1 },
  { key: "FU", name: "Follow-up", code: "FU", category: "follow_up", durationMinutes: 30, defaultPricePence: 5500, colour: "#2563EB", onlineBookable: true, sortOrder: 2 },
  { key: "FUX", name: "Extended follow-up", code: "FUX", category: "follow_up", durationMinutes: 45, defaultPricePence: 7000, colour: "#1D4ED8", sortOrder: 3 },
  { key: "TEL", name: "Telephone review", code: "TEL", category: "follow_up", durationMinutes: 15, defaultPricePence: 3000, colour: "#64748B", sortOrder: 4 },
  { key: "ACU", name: "Acupuncture", code: "ACU", category: "treatment", durationMinutes: 30, defaultPricePence: 5500, colour: "#7C3AED", sortOrder: 5 },
  { key: "SM", name: "Sports massage", code: "SM", category: "treatment", durationMinutes: 45, defaultPricePence: 5500, colour: "#475569", onlineBookable: true, sortOrder: 6 },
  { key: "PIL", name: "Clinical Pilates class", code: "PIL", category: "class", durationMinutes: 60, defaultPricePence: 1500, colour: "#16A34A", sortOrder: 7 },
  { key: "MLA", name: "Medico-legal assessment", code: "MLA", category: "assessment", durationMinutes: 60, defaultPricePence: 12000, colour: "#B45309", sortOrder: 8 },
  { key: "DR", name: "Discharge review", code: "DR", category: "follow_up", durationMinutes: 30, defaultPricePence: 5500, colour: "#0F766E", sortOrder: 9 },
];

export const REFERRERS: (ReferrerInput & { key: string; prefix?: string })[] = [
  { key: "NW", prefix: "NW", kind: "insurer", name: "Northwell Health Insurance (fictional)", contactName: "Claims team", phone: "01632 960201", email: "claims@northwell.example.com", notes: "Electronic invoices only; authorisation code on every invoice." },
  { key: "AL", prefix: "AL", kind: "insurer", name: "Albion Medical Cover (fictional)", contactName: "Provider services", phone: "01632 960202", email: "providers@albion-cover.example.com" },
  { key: "KE", prefix: "KE", kind: "insurer", name: "Kestrel Healthcare (fictional)", contactName: "Pre-authorisations", phone: "01632 960203", email: "preauth@kestrel-health.example.com" },
  { key: "MMR", prefix: "MMR", kind: "mlc", name: "Meridian Medical Reporting (fictional)", contactName: "Instructions desk", phone: "01632 960211", email: "instructions@meridian-mr.example.com" },
  { key: "CML", prefix: "CML", kind: "mlc", name: "Calder Medico-Legal (fictional)", contactName: "Rehabilitation team", phone: "01632 960212", email: "rehab@calder-ml.example.com" },
  { key: "HP", prefix: "HP", kind: "solicitor", name: "Harrow & Pike Solicitors (fictional)", contactName: "Amelia Grant", phone: "01632 960221", email: "amelia.grant@harrow-pike.example.com", address: ["3 Silbury Arcade (fictional)", "Milton Keynes"], postcode: "MK9 0ZZ" },
  { key: "FL", prefix: "FL", kind: "solicitor", name: "Fenwick Law (fictional)", contactName: "Personal injury team", phone: "01632 960222", email: "pi@fenwick-law.example.com" },
  { key: "AF", prefix: "AF", kind: "employer", name: "Ashby Freight Ltd (fictional)", contactName: "Karen Doyle, HR & Occupational Health Adviser", phone: "01632 960231", email: "occupational.health@ashby-freight.example.com" },
  { key: "CCM", prefix: "CCM", kind: "case_manager", name: "Corbridge Case Management (fictional)", contactName: "Case managers", phone: "01632 960241", email: "cases@corbridge-cm.example.com" },
  { key: "GPB", kind: "gp", name: "Bletchley Medical Centre (fictional)", phone: "01632 960251", address: ["1 Queensway (fictional)", "Bletchley"], postcode: "MK2 9ZZ" },
  { key: "GPW", kind: "gp", name: "Wolverton Health Centre (fictional)", phone: "01632 960252", address: ["40 Church Street (fictional)", "Wolverton"], postcode: "MK12 9ZZ" },
  { key: "CON", kind: "consultant", name: "Mr Adam Lyle, Consultant Orthopaedic Surgeon (fictional)", phone: "01632 960261" },
];

/** Price lists: the clinic's own self-pay list (default) and two insurers' own lists, by service key. */
export const PRICE_LISTS: { key: string; name: string; payerType: PayerType; referrer?: string; isDefault?: boolean; prices: Record<string, [number, string?]> }[] = [
  { key: "SELF", name: "Self-pay 2026", payerType: "self_pay", isDefault: true, prices: { IA: [7000], FU: [5500], FUX: [7000], TEL: [3000], ACU: [5500], SM: [5500], PIL: [1500], DR: [5500] } },
  { key: "NW", name: "Northwell 2026 (fictional)", payerType: "insurer", referrer: "NW", prices: { IA: [6500, "NW-PHY-IA"], FU: [4800, "NW-PHY-FU"], FUX: [6000, "NW-PHY-FUX"], TEL: [2500, "NW-PHY-TEL"], DR: [4800, "NW-PHY-FU"] } },
  { key: "AL", name: "Albion 2026 (fictional)", payerType: "insurer", referrer: "AL", prices: { IA: [6800, "AL-01"], FU: [5000, "AL-02"], ACU: [5000, "AL-05"], DR: [5000, "AL-02"] } },
  { key: "MLC", name: "Medico-legal 2026", payerType: "mlc", prices: { IA: [9000], FU: [6500], MLA: [15000], DR: [6500] } },
];

const FIRST_F = ["Olivia", "Amelia", "Isla", "Ava", "Emily", "Sophie", "Grace", "Ella", "Chloe", "Lucy", "Ruby", "Freya", "Zara", "Hannah", "Leah", "Megan", "Erin", "Niamh", "Imogen", "Rosie", "Nadia", "Maya", "Holly", "Jasmine", "Abigail"];
const FIRST_M = ["Oliver", "George", "Harry", "Jack", "Noah", "Leo", "Charlie", "Oscar", "Jacob", "Thomas", "William", "Joshua", "Ethan", "Samuel", "Rory", "Callum", "Kieran", "Arjun", "Ravi", "Tariq", "Ben", "Luke", "Ryan", "Adam", "Marcus"];
const LAST = ["Smith", "Jones", "Taylor", "Brown", "Williams", "Wilson", "Johnson", "Davies", "Patel", "Robinson", "Wright", "Thompson", "Evans", "Walker", "White", "Roberts", "Green", "Hall", "Wood", "Jackson", "Clarke", "Khan", "Hughes", "Edwards", "Turner", "Hill", "Cooper", "Ward", "Morris", "King", "Baker", "Harrison", "Martin", "Lewis", "Young", "Allen", "Mitchell", "Kelly", "Begum", "Ahmed"];
const STREETS = ["Willow Bank", "Carrick Road", "Saxon Gate", "Elder Way", "Oak Drive", "Bradwell Road", "Fennel Drive", "Linford Lane", "Sherwood Drive", "Harrier Court", "Monks Way", "Kiln Farm Road", "Chaffron Way", "Brickhill Street", "Tattenhoe Lane"];
const TOWNS: [string, string][] = [
  ["Bletchley", "MK3 9ZZ"],
  ["Fenny Stratford", "MK2 9ZZ"],
  ["Wolverton", "MK12 9ZZ"],
  ["Stony Stratford", "MK11 9ZZ"],
  ["Newport Pagnell", "MK16 9ZZ"],
  ["Central Milton Keynes", "MK9 9ZZ"],
  ["Shenley", "MK5 9ZZ"],
  ["Woburn Sands", "MK17 9ZZ"],
];
const OCCUPATIONS = ["Office administrator", "Teacher", "Nurse", "Warehouse operative", "Retired", "Student", "Software developer", "Electrician", "Delivery driver", "Hairdresser", "Accountant", "Chef", "Care worker", "Plumber", "Police officer", "Shop assistant"];
const CONDITIONS = [
  "Lower back pain",
  "Neck pain",
  "Right knee pain",
  "Left knee pain",
  "Right shoulder pain",
  "Left shoulder pain",
  "Plantar heel pain",
  "Right ankle sprain",
  "Tennis elbow",
  "Hip pain",
  "Post-operative knee rehabilitation",
  "Sciatica",
  "Whiplash after a road traffic accident",
  "Hamstring strain",
  "Achilles tendon pain",
  "Wrist pain",
];
const ALERTS = ["Latex allergy", "Pacemaker – no electrotherapy", "Type 1 diabetes", "Takes anticoagulants", "Epilepsy", "Pregnant (second trimester)", "Osteoporosis"];

export interface DemoPatient {
  importRef: string;
  patient: PatientInput;
  cases: (Omit<CaseInput, "patientId" | "practitionerId" | "siteId" | "payerReferrerId" | "referrerId" | "priceListId"> & {
    practitioner: number;
    site: string;
    payer?: string;
    referrer?: string;
    priceList?: string;
    authorisation?: Omit<AuthorisationInput, "caseId" | "referrerId"> & { issuer?: string; sessionsUsed: number };
  })[];
}

const pad = (n: number, w: number) => String(n).padStart(w, "0");

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return isoDate(new Date(Date.UTC(y, m - 1, d + days)));
}

/** The 200 fictional patients (deterministic for a seed). `today` = "YYYY-MM-DD". */
export function demoPatients(count = 200, seed = 2026, today = "2026-10-24"): DemoPatient[] {
  const rnd = prng(seed);
  const pick = <T>(list: readonly T[]) => list[Math.floor(rnd() * list.length)];
  const chance = (p: number) => rnd() < p;
  const between = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  const out: DemoPatient[] = [
    {
      importRef: "sim-pat-001",
      patient: {
        title: "Ms",
        firstName: "Megan",
        lastName: "Hart",
        dateOfBirth: "1991-11-22",
        sex: "female",
        phoneMobile: "07700 900123",
        email: "megan.hart@example.com",
        address: ["14 Willow Bank (fictional)", "Bletchley", "Milton Keynes"],
        postcode: "MK3 9ZZ",
        occupation: "Office administrator",
        employer: "Ashby Property Services (fictional)",
        gpPractice: "Bletchley Medical Centre (fictional)",
        consentTreatment: true,
        consentShareGp: true,
        importRef: "sim-pat-001",
      },
      cases: [
        {
          title: "Neck pain and headaches following road traffic accident",
          status: "discharged",
          openedOn: "2026-03-18",
          closedOn: "2026-07-07",
          practitioner: 0,
          site: "BLE",
          payerType: "solicitor",
          payer: "HP",
          claimReference: "HP/RTA/2291",
          injuryOn: "2026-03-12",
          referralReceivedOn: "2026-03-16",
          referralReason: "Assessment and treatment following a road traffic accident on 12/03/2026. A treating physiotherapist report will be requested on discharge.",
          priceList: "MLC",
          authorisation: { code: "HP-RTA-2291-A", sessionsAuthorised: 8, expiresOn: "2026-07-31", sessionsUsed: 8 },
        },
      ],
    },
    {
      importRef: "sim-pat-002",
      patient: {
        title: "Mr",
        firstName: "Daniel",
        lastName: "Brooks",
        dateOfBirth: "1980-01-19",
        sex: "male",
        phoneMobile: "07700 900456",
        email: "daniel.brooks@example.com",
        address: ["27 Carrick Road (fictional)", "Wolverton", "Milton Keynes"],
        postcode: "MK12 9ZZ",
        occupation: "Warehouse operative",
        employer: "Ashby Freight Ltd (fictional)",
        gpPractice: "Wolverton Health Centre (fictional)",
        consentTreatment: true,
        importRef: "sim-pat-002",
      },
      cases: [
        {
          title: "Low back pain following lifting injury at work",
          status: "discharged",
          openedOn: "2026-06-09",
          closedOn: "2026-09-22",
          practitioner: 1,
          site: "WOL",
          payerType: "employer",
          payer: "AF",
          claimReference: "AF-OH-0457",
          injuryOn: "2026-06-02",
          referralReceivedOn: "2026-06-05",
          referralReason: "Physiotherapy for low back pain following a lifting incident at work on 02/06/2026. Fitness for work report requested on discharge.",
        },
      ],
    },
  ];
  const usedPhones = new Set([123, 456]);
  let phone = 0;
  const nextPhone = () => {
    while (usedPhones.has(phone)) phone++;
    usedPhones.add(phone);
    return `07700 900${pad(phone, 3)}`;
  };
  const authCounters: Record<string, number> = {};
  for (let i = 0; out.length < count; i++) {
    const n = 7 + i;
    const female = chance(0.55);
    const first = female ? pick(FIRST_F) : pick(FIRST_M);
    const last = pick(LAST);
    const child = chance(0.05);
    const age = child ? between(9, 17) : between(18, 86);
    const dob = addDays(today, -(age * 365 + between(0, 364)));
    const [town, postcode] = pick(TOWNS);
    const ref = `sim-pat-${pad(n, 3)}`;
    const marketing = chance(0.2);
    const patient: PatientInput = {
      title: child ? null : female ? pick(["Ms", "Mrs", "Miss", "Dr"]) : pick(["Mr", "Mr", "Mr", "Dr"]),
      firstName: first,
      lastName: last,
      dateOfBirth: dob,
      sex: female ? "female" : "male",
      phoneMobile: nextPhone(),
      email: `${first}.${last}.${n}@example.com`.toLowerCase(),
      address: [`${between(1, 120)} ${pick(STREETS)} (fictional)`, town, "Milton Keynes"],
      postcode,
      occupation: child ? "School pupil" : age >= 67 ? "Retired" : pick(OCCUPATIONS),
      gpPractice: town === "Wolverton" || town === "Stony Stratford" ? "Wolverton Health Centre (fictional)" : "Bletchley Medical Centre (fictional)",
      emergencyName: chance(0.5) ? `${pick(female ? FIRST_M : FIRST_F)} ${last}` : null,
      emergencyPhone: null,
      emergencyRelationship: null,
      consentTreatment: chance(0.95),
      consentShareGp: chance(0.7),
      reminderSms: chance(0.92),
      reminderEmail: chance(0.85),
      marketingEmail: marketing,
      marketingConsentSource: marketing ? "written" : null,
      alerts: chance(0.08) ? pick(ALERTS) : null,
      importRef: ref,
    };
    if (patient.emergencyName) {
      patient.emergencyPhone = nextPhone();
      patient.emergencyRelationship = pick(["Partner", "Parent", "Sibling", "Friend", "Child"]);
    }
    const cases: DemoPatient["cases"] = [];
    const caseCount = chance(0.3) ? 2 : 1;
    for (let c = 0; c < caseCount; c++) {
      const older = c === 0 && caseCount === 2;
      const openedOn = older ? addDays(today, -between(220, 700)) : addDays(today, -between(1, 200));
      const statusRoll = rnd();
      const status = older ? "closed" : statusRoll < 0.62 ? "open" : statusRoll < 0.92 ? "discharged" : "closed";
      const closedOn = status === "open" ? null : addDays(openedOn, between(28, 120));
      const payerRoll = rnd();
      const practitioner = between(0, PRACTITIONERS.length - 1);
      const site = PRACTITIONERS[practitioner].site;
      const base = {
        title: pick(CONDITIONS),
        status: status as "open" | "discharged" | "closed",
        openedOn,
        closedOn: closedOn && closedOn > today ? today : closedOn,
        practitioner,
        site,
        referralReceivedOn: addDays(openedOn, -between(1, 10)),
      };
      if (payerRoll < 0.55) {
        cases.push({ ...base, payerType: "self_pay", priceList: "SELF", referrer: chance(0.3) ? pick(["GPB", "GPW", "CON"]) : undefined });
      } else if (payerRoll < 0.8) {
        const ins = pick(["NW", "AL", "KE"]);
        authCounters[ins] = (authCounters[ins] ?? 0) + 1;
        const sessions = pick([4, 5, 6, 8]);
        const expires = addDays(openedOn, pick([42, 56, 84, 120]));
        cases.push({
          ...base,
          payerType: "insurer",
          payer: ins,
          priceList: ins === "KE" ? "SELF" : ins,
          membershipNumber: `${ins}-${pad(between(100000, 999999), 6)}`,
          excessPence: chance(0.3) ? pick([5000, 10000, 15000]) : null,
          referrer: chance(0.4) ? "GPB" : undefined,
          authorisation: {
            code: `${ins}-AUTH-${pad(authCounters[ins], 4)}`,
            sessionsAuthorised: sessions,
            valueAuthorisedPence: chance(0.4) ? sessions * 5000 + 6500 : null,
            validFrom: openedOn,
            expiresOn: expires,
            sessionsUsed: Math.min(sessions, status === "open" ? between(0, sessions) : sessions),
            issuer: ins,
          },
        });
      } else if (payerRoll < 0.92) {
        const mlc = pick(["MMR", "CML", "HP", "FL"]);
        const injuryOn = addDays(openedOn, -between(7, 60));
        cases.push({
          ...base,
          title: chance(0.6) ? "Whiplash after a road traffic accident" : base.title,
          payerType: mlc === "HP" || mlc === "FL" ? "solicitor" : "mlc",
          payer: mlc,
          priceList: "MLC",
          claimReference: `${mlc}/${pad(between(1000, 9999), 4)}`,
          injuryOn,
          referralReason: "Rehabilitation after an accident; a report will be requested on discharge.",
          authorisation: chance(0.6)
            ? { code: `${mlc}-${pad(between(100, 999), 3)}-A`, sessionsAuthorised: 6, validFrom: openedOn, expiresOn: addDays(openedOn, 120), sessionsUsed: status === "open" ? between(0, 6) : 6, issuer: mlc }
            : undefined,
        });
      } else if (payerRoll < 0.97) {
        cases.push({ ...base, payerType: "employer", payer: "AF", claimReference: `AF-OH-${pad(between(100, 999), 4)}`, priceList: "SELF" });
      } else {
        cases.push({ ...base, payerType: "other", payer: "CCM", claimReference: `CCM-${pad(between(1000, 9999), 4)}`, priceList: "SELF" });
      }
    }
    out.push({ importRef: ref, patient, cases });
  }
  return out;
}

/** Kinds of the referrers by key (tests). */
export const REFERRER_KINDS_BY_KEY: Record<string, ReferrerKind> = Object.fromEntries(REFERRERS.map((r) => [r.key, r.kind]));
