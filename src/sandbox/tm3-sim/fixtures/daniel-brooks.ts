/**
 * CASE B – Daniel Brooks (fictional), 46, warehouse operative at Ashby Freight Ltd (fictional).
 * Lifting injury at work on 02/06/2026; mechanical low back pain, no red flags.
 * Employer referral via HR/occupational health, ref AF-OH-0457 (fitness for work report).
 *
 * 7 appointments: 6 ATT + 1 LCN (23/06/2026, reason recorded). 6 SOAP notes.
 * ODI 48 → 30 → 18 % (09/06, 14/07, 22/09/2026).
 *
 * Demo points (do NOT "fix" these):
 *  - The initial assessment holds unrelated past medical history (knee arthroscopy 2015, mild asthma) and
 *    a social history ONLY in the structured past_medical_history / social_history fields, so the employer
 *    template's scope strips them in code. No other note text mentions them.
 *  - The discharge note RECORDS the clinician's view on return to duties (phased return over 2 weeks,
 *    avoid repetitive lifting > 15 kg for 4 weeks, review in 6 weeks) – the opinion the AI may attribute.
 *  - Planted gap: no formal lifting / functional capacity test is documented anywhere.
 *
 * Owner: sandbox/fixtures agent. All people and organisations are fictional.
 */
import type { SimEpisode, SimOutcomeMeasure, SimPatient } from "../wire-types";
import { buildVisits, noteRef } from "./build";
import { SARAH_REID, TOM_ELLIS } from "./clinic";

export const DANIEL_BROOKS_PATIENT_ID = "sim-pat-002";
export const DANIEL_BROOKS_EPISODE_ID = "sim-ep-1002";
const KEY = "1002";

export const DANIEL_BROOKS_PATIENT: SimPatient = {
  id: DANIEL_BROOKS_PATIENT_ID,
  title: "Mr",
  first_name: "Daniel",
  last_name: "Brooks",
  date_of_birth: "1980-01-19",
  sex: "male",
  address: { line1: "27 Carrick Road (fictional)", line2: "Wolverton", town: "Milton Keynes", postcode: "MK12 9ZZ" },
  phone: "07700 900456",
  email: "daniel.brooks@example.com",
  occupation: "Warehouse operative",
  employer_name: "Ashby Freight Ltd (fictional)",
  registered_at: "2026-06-05T14:30:00.000Z",
  episode_count: 1,
  _simulated: true,
};

export const DANIEL_BROOKS_EPISODE: SimEpisode = {
  id: DANIEL_BROOKS_EPISODE_ID,
  patient_id: DANIEL_BROOKS_PATIENT_ID,
  title: "Low back pain following lifting injury at work",
  status: "discharged",
  start_date: "2026-06-09",
  end_date: "2026-09-22",
  referral: {
    source_type: "employer",
    organisation_name: "Ashby Freight Ltd (fictional)",
    reference: "AF-OH-0457",
    contact_name: "Karen Doyle, HR & Occupational Health Adviser",
    address: "Ashby Distribution Centre (fictional), Ashby Park, Milton Keynes, MK11 9ZZ",
    referral_date: "2026-06-05",
    reason:
      "Physiotherapy for low back pain following a lifting incident at work on 02/06/2026. Fitness for work report requested on discharge.",
  },
  incident: {
    date: "2026-06-02",
    mechanism:
      "Lifting a carton of approximately 20 kg from floor level onto a pallet with a twist to the right during a night shift; immediate onset of low back pain.",
    incident_type: "workplace",
  },
  consent: { disclosure_consent_recorded: true, recorded_on: "2026-06-09" },
  primary_clinician: TOM_ELLIS,
  _simulated: true,
};

const visits = buildVisits(DANIEL_BROOKS_EPISODE_ID, KEY, [
  // 1 · N-001 · initial assessment (holds the structured PMH / social history that scope strips)
  {
    date: "2026-06-09",
    time: "10:00",
    durationMinutes: 60,
    clinician: TOM_ELLIS,
    status: "ATT",
    note: {
      type: "initial_assessment",
      subjective:
        "Employer referral via Ashby Freight Ltd (fictional) HR/OH, ref AF-OH-0457. On 02/06/2026 during a night shift, lifted a carton of approx. 20 kg from floor level onto a pallet, twisting to his R; immediate sharp pain across the low back R>L. Finished the shift on light tasks, reported to supervisor and logged in the accident book. Seen by GP 04/06/2026: mechanical LBP, naproxen prescribed, advised to stay active. Off work since 03/06/2026.\n" +
        "Current sx: central and R-sided LBP. No leg pain, P&N or weakness. NPRS 6/10 at worst, 3/10 at best.\n" +
        "Aggs: bending forward (putting on socks), sitting >20 min, getting out of the car, lifting shopping. Eases: walking, lying with knees bent, heat.\n" +
        "24 hr: stiff ~30 min on waking, eases with movement; worse after sitting in the evening. Wakes when turning in bed.\n" +
        "Red flags: no saddle anaesthesia, no bladder or bowel change, no bilateral leg symptoms, no unexplained weight loss, no night pain unrelated to movement, no history of malignancy, no fever.\n" +
        "Work: warehouse operative, 4 nights on / 4 off, 12-hr shifts. Manual handling of cartons up to 25 kg, frequent floor-to-pallet lifting, operates a pallet truck.\n" +
        "No previous episodes of LBP needing treatment or time off work.\n" +
        "DH: naproxen 500 mg BD with omeprazole (GP), paracetamol PRN.",
      objective:
        "Obs: guarded movement, reduced lumbar lordosis, no lateral shift.\n" +
        "Lumbar AROM: Flex fingertips to knees (P, ~50% limited), Ext 50% (P), R SF 75% (P), L SF full, rotation full.\n" +
        "Palpation: TTP R L4–S1 paraspinals; R quadratus lumborum hypertonic.\n" +
        "PAIVMs: central PA L4 and L5 stiff, reproduce LBP; R UPA L4/5 most comparable.\n" +
        "Neuro: L2–S1 dermatomes intact to LT; myotomes L2–S1 5/5; KJ 2+ and AJ 2+ symmetrical. SLR L 75°, R 70° (LBP at end range only, no leg symptoms); slump neg bilat.\n" +
        "Hips: full, pain-free ROM bilat; FABER neg.\n" +
        "Outcome measures: ODI 48%, NPRS 6/10.",
      assessment:
        "Acute non-specific mechanical LBP following a lifting injury at work on 02/06/2026. No red flags; no neurological signs. Severe disability on ODI (48%). Not fit for full warehouse duties (heavy manual handling) at present.",
      plan:
        "Reassured about the benign nature of mechanical LBP and the benefits of staying active.\n" +
        "Rx: STM R lumbar paraspinals/QL, Maitland grade II central PAs L4–L5, heat.\n" +
        "HEP: pelvic tilts 10 x 3/day, knee rolls 10 each way x 3/day, cat–camel 10 x 2/day, walking 20 min/day building up.\n" +
        "Work: could return on amended duties (no lifting from floor level, no loads >10 kg) if the employer can accommodate; to discuss with HR/OH.\n" +
        "Plan: weekly sessions.\n" +
        "Consent to disclose records to the employer (HR/OH) for a fitness for work report discussed and recorded.",
      pastMedicalHistory:
        "Right knee arthroscopy (partial medial meniscectomy) 2015 – no current symptoms. Mild asthma since childhood – salbutamol inhaler PRN, well controlled, no hospital admissions.",
      socialHistory:
        "Lives with partner and two children (8 and 11). Non-smoker. Alcohol approx. 6 units per week. Plays 5-a-side football fortnightly – stopped since the injury.",
    },
  },
  // 2 · N-002
  {
    date: "2026-06-16",
    time: "10:00",
    durationMinutes: 30,
    clinician: TOM_ELLIS,
    status: "ATT",
    note: {
      type: "follow_up",
      subjective:
        "NPRS 5/10 at worst. Morning stiffness down to ~15 min. Walking 30 min/day. Sitting tolerance ~30 min. HEP daily. Still off work; HR has confirmed amended duties (scanning and labelling, no lifting >10 kg) from 22/06/2026.",
      objective:
        "Lumbar AROM: Flex fingertips to mid-shin (P end range), Ext 75% (P), R SF full (stretch), L SF full.\n" +
        "Palpation: TTP R L4/5 paraspinals.\n" +
        "Neuro not repeated (no leg symptoms).",
      assessment: "Improving mechanical LBP.",
      plan:
        "Rx: STM, grade III central PAs L4–L5, R UPA L4/5.\n" +
        "HEP progressed: bridges 3 x 10, bird-dog 3 x 8 each side, sit-to-stand 3 x 10.\n" +
        "Advised pacing for the return to amended duties.",
    },
  },
  // 3 · LCN with reason
  {
    date: "2026-06-23",
    time: "10:00",
    durationMinutes: 30,
    clinician: TOM_ELLIS,
    status: "LCN",
    reason:
      "Patient phoned on the morning of the appointment: first week back on amended night shifts and unable to attend after a shift.",
  },
  // 4 · N-003
  {
    date: "2026-06-30",
    time: "10:00",
    durationMinutes: 30,
    clinician: TOM_ELLIS,
    status: "ATT",
    note: {
      type: "follow_up",
      subjective:
        "Back on amended duties since 22/06/2026 (scanning and labelling, no lifting >10 kg), 4 nights on. Manages shifts; LBP 4/10 by the end of a shift, settles after sleep. Bending and putting on socks now easier.",
      objective:
        "Lumbar AROM: Flex fingertips to ankles, Ext full (P end range), SF full bilat.\n" +
        "Palpation: minimal TTP R L5 paraspinals.\n" +
        "SLR 85° bilat, no symptoms.",
      assessment: "Progressing well and tolerating amended duties.",
      plan:
        "Rx: STM, grade III central PAs L4–L5.\n" +
        "HEP progressed: hip hinge with dowel 3 x 10, bodyweight goblet squat 3 x 10, side plank 3 x 20 s each side.\n" +
        "Manual handling technique discussed: hip hinge, load close to the body, turn the feet rather than twisting.",
    },
  },
  // 5 · N-004 · reassessment (mid ODI)
  {
    date: "2026-07-14",
    time: "10:00",
    durationMinutes: 45,
    clinician: SARAH_REID,
    status: "ATT",
    note: {
      type: "follow_up",
      subjective:
        "Seen by SR (TE on leave). Reassessment. LBP 3/10 at worst after shifts, 1/10 most of the day. No leg symptoms. Sitting 1 hr without problem. Still on amended duties (no lifting >10 kg). Keen to return to normal duties but worried about repeated lifting from floor level.",
      objective:
        "Lumbar AROM: Flex full (fingertips to floor), Ext full, SF full; mild stiffness at end-range flexion.\n" +
        "Palpation: no TTP.\n" +
        "Neuro: L2–S1 NAD.\n" +
        "Outcome measures: ODI 30% (48% on 09/06/2026).",
      assessment:
        "Mechanical LBP, improving: moderate disability on ODI (30%). Some fear of re-injury with repetitive floor-level lifting.",
      plan:
        "Education on graded loading and load tolerance.\n" +
        "HEP progressed to loaded strength work: kettlebell deadlift 12 kg 3 x 8, goblet squat 8 kg 3 x 10, side plank 3 x 30 s.\n" +
        "Sessions reduced to every 3–4 wks alongside a self-directed gym programme.",
    },
  },
  // 6 · N-005
  {
    date: "2026-08-11",
    time: "10:00",
    durationMinutes: 30,
    clinician: TOM_ELLIS,
    status: "ATT",
    note: {
      type: "follow_up",
      subjective:
        "LBP 2/10 at worst after a busy shift, mostly 0–1/10. Gym programme 3x/wk. Employer has widened his duties: occasional lifts up to 15 kg, still no repetitive floor-to-pallet lifting.",
      objective:
        "Lumbar AROM full and pain-free.\n" +
        "Gym exercise technique reviewed (kettlebell deadlift 12 kg): good form, no symptoms.",
      assessment: "Good progress; tolerating wider amended duties.",
      plan:
        "HEP progressed: kettlebell deadlift 16 kg, suitcase carry, step-ups. Continue gym programme.\n" +
        "Final review in about 6 wks once current duties are tolerated consistently.",
    },
  },
  // 7 · N-006 · discharge – records the clinician's return-to-duties view
  {
    date: "2026-09-22",
    time: "10:00",
    durationMinutes: 30,
    clinician: TOM_ELLIS,
    status: "ATT",
    note: {
      type: "discharge",
      subjective:
        "Final review. LBP 1–2/10 at worst after 4 nights of shifts, settles on rest days. No leg symptoms. On amended duties with occasional lifts up to 15 kg and no repetitive floor-level lifting; no flare-ups in the last 6 wks. Gym 3x/wk. Confident with lifting technique and would like to return to normal duties.",
      objective:
        "Lumbar AROM full and pain-free in all directions.\n" +
        "Palpation: no TTP.\n" +
        "Neuro: L2–S1 dermatomes, myotomes and reflexes NAD; SLR 85° bilat.\n" +
        "Outcome measures: ODI 18% (30% on 14/07/2026, 48% on 09/06/2026).",
      assessment:
        "Mechanical LBP following the workplace lifting injury on 02/06/2026, now with minimal disability on ODI (18%).\n" +
        "Opinion on work: in my opinion he is fit for a phased return to normal duties over 2 weeks; he should avoid repetitive lifting >15 kg for 4 weeks; review in 6 weeks.",
      plan:
        "Discharged from active physiotherapy to self-management.\n" +
        "Return-to-work recommendation for HR/OH (ref AF-OH-0457): phased return to normal duties over 2 weeks; avoid repetitive lifting >15 kg for 4 weeks; review in 6 weeks.\n" +
        "Continue gym programme 2–3x/wk and maintenance HEP (bridges, bird-dog, side plank, hip hinge).\n" +
        "Advised to contact the clinic if symptoms recur.",
    },
  },
]);

export const DANIEL_BROOKS_APPOINTMENTS = visits.appointments;
export const DANIEL_BROOKS_NOTES = visits.notes;

export const DANIEL_BROOKS_OUTCOME_MEASURES: SimOutcomeMeasure[] = [
  {
    id: "sim-om-1002-odi",
    episode_id: DANIEL_BROOKS_EPISODE_ID,
    instrument: "ODI",
    unit: "%",
    higher_is_worse: true,
    scores: [
      { date: "2026-06-09", value: 48, note_id: noteRef(KEY, 1) },
      { date: "2026-07-14", value: 30, note_id: noteRef(KEY, 5) },
      { date: "2026-09-22", value: 18, note_id: noteRef(KEY, 7) },
    ],
    _simulated: true,
  },
];
