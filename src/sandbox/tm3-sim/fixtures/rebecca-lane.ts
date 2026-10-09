/**
 * CASE C – Rebecca Lane (fictional), 45, primary school teacher. Private medical insurance (PMI) patient.
 * Right shoulder pain after lifting her cabin case into an aircraft's overhead locker on 22/08/2026;
 * rotator cuff related shoulder pain (subacromial pain), no red flags. GP referral (Dr A Forsyth,
 * Kents Hill Medical Practice (fictional)); insurer on record Bupa – the demo fills Bupa's PUBLIC
 * further-treatment form, so the insurer is named as the record would name it. Nothing here implies any
 * link with Bupa: the membership and authorisation numbers are obviously fake (DEMO-POL-0001,
 * DEMO-AUTH-0001) and every other person and organisation is fictional.
 *
 * 7 appointments: 5 ATT + 1 CNC (22/09/2026, reason recorded) + 1 BOOKED (15/10/2026, the 6th and last
 * pre-authorised session). 5 SOAP notes, all by Sarah Reid. Episode OPEN: the latest note (N-005,
 * 01/10/2026) records a further-treatment request of 4 sessions and the clinical reason for it.
 * NPRS 7 → 5 → 4 /10, QuickDASH 52.3 → 38.6 → 29.5, PSFS 2.7 → 4.3 → 5.3 (01/09, 15/09, 01/10/2026).
 * Charges: initial assessment £70, follow-ups £55; all paid except the latest (01/10/2026).
 *
 * Planted gap (do NOT "fix" it – the demo depends on it): no clinician recorded a prognosis. The notes
 * record progress, goals and the plan only, so a prognosis question stays blank with a gap.
 *
 * Owner: sandbox/fixtures agent.
 */
import type { SimEpisode, SimOutcomeMeasure, SimPatient } from "../wire-types";
import { buildVisits, noteRef } from "./build";
import { SARAH_REID } from "./clinic";

export const REBECCA_LANE_PATIENT_ID = "sim-pat-006";
export const REBECCA_LANE_EPISODE_ID = "sim-ep-1006";
const KEY = "1006";

/** Fake insurer identifiers – an obviously invalid format, never a real membership or authorisation number. */
export const REBECCA_LANE_MEMBERSHIP_NUMBER = "DEMO-POL-0001";
export const REBECCA_LANE_AUTHORISATION_NUMBER = "DEMO-AUTH-0001";

/** Charges (pounds). */
const INITIAL_ASSESSMENT_FEE = 70;
const FOLLOW_UP_FEE = 55;

export const REBECCA_LANE_PATIENT: SimPatient = {
  id: REBECCA_LANE_PATIENT_ID,
  title: "Mrs",
  first_name: "Rebecca",
  last_name: "Lane",
  date_of_birth: "1981-07-23",
  sex: "female",
  address: { line1: "22 Larkspur Mews (fictional)", line2: "Loughton", town: "Milton Keynes", postcode: "MK5 8ZZ" },
  phone: "07700 900614",
  email: "rebecca.lane@example.com",
  occupation: "Primary school teacher",
  employer_name: "Fernbrook Primary School (fictional)",
  registered_at: "2026-08-27T15:10:00.000Z",
  episode_count: 1,
  _simulated: true,
};

export const REBECCA_LANE_EPISODE: SimEpisode = {
  id: REBECCA_LANE_EPISODE_ID,
  patient_id: REBECCA_LANE_PATIENT_ID,
  title: "Right shoulder pain after lifting a suitcase into an overhead locker",
  status: "open",
  start_date: "2026-09-01",
  end_date: null,
  referral: {
    source_type: "insurer",
    organisation_name: "Bupa",
    // The insurer's reference for this episode is its pre-authorisation number.
    reference: REBECCA_LANE_AUTHORISATION_NUMBER,
    contact_name: null,
    address: null,
    referral_date: "2026-08-28",
    reason:
      "Private medical insurance. GP referral for physiotherapy for right shoulder pain (Dr A Forsyth, Kents Hill Medical Practice (fictional), letter dated 26/08/2026). Pre-authorised: an initial assessment and 5 follow-up sessions (6 sessions in total); further sessions need a funding request to the insurer.",
    insurer_name: "Bupa",
    membership_number: REBECCA_LANE_MEMBERSHIP_NUMBER,
    authorisation_number: REBECCA_LANE_AUTHORISATION_NUMBER,
  },
  incident: {
    date: "2026-08-22",
    mechanism:
      "Lifting her cabin suitcase (approx. 12 kg) above head height into the overhead locker on a return flight from holiday; sudden sharp pain in the right shoulder as she pushed it in. No fall, no dislocation.",
    incident_type: "other",
  },
  consent: { disclosure_consent_recorded: true, recorded_on: "2026-09-01" },
  primary_clinician: SARAH_REID,
  _simulated: true,
};

const visits = buildVisits(REBECCA_LANE_EPISODE_ID, KEY, [
  // 1 · N-001 · initial assessment (outcome measures, time point 1)
  {
    date: "2026-09-01",
    time: "09:30",
    durationMinutes: 45,
    clinician: SARAH_REID,
    status: "ATT",
    charge: { amount: INITIAL_ASSESSMENT_FEE, paid: true },
    note: {
      type: "initial_assessment",
      subjective:
        "Private pt (Bupa), pre-authorised for IA + 5 FU. GP referral (Dr A Forsyth, Kents Hill Medical Practice (fictional), letter 26/08/2026): ?rotator cuff strain R shoulder, ibuprofen, refer physio.\n" +
        "On 22/08/2026 lifted her cabin case (approx. 12 kg) above head height into the overhead locker on a return flight; sharp pain R shoulder as she pushed it in. No fall, no clunk or dislocation. Pain and stiffness worse the next morning; difficulty dressing and washing hair since.\n" +
        "R hand dominant.\n" +
        "Current sx: pain lateral R shoulder into upper arm (to deltoid insertion), nil below the elbow, no P&N, no neck pain. NPRS 7/10 at worst (reaching overhead, lifting with arm away from body), 2/10 at rest. Night pain lying on R side, waking 2–3x/night.\n" +
        "Aggs: reaching overhead (putting up classroom displays, top cupboards), HBB (fastening bra), lifting kettle/shopping bags, lying on R side. Eases: rest with arm supported on a pillow, ibuprofen, heat.\n" +
        "24 hr: stiff ~15 min on waking; worse at the end of the school day and at night.\n" +
        "Red flags: no trauma or fall, no deformity, no fever, night sweats or unexplained weight loss, no hx of cancer, no arm weakness or neuro sx.\n" +
        "Work: primary school teacher (Year 4), full-time; avoiding reaching overhead, colleague putting up her displays. Hobbies: swims front crawl 2x/wk – stopped since the injury.\n" +
        "DH: ibuprofen 400 mg TDS PRN with food, paracetamol 1 g QDS PRN, levothyroxine 75 mcg OD.\n" +
        "Pt goals: swim front crawl again, put up classroom displays, sleep through the night.",
      objective:
        "Obs: R shoulder held slightly protracted; no wasting, swelling or deformity.\n" +
        "R shoulder AROM: flex 120° (P), abd 95° (P, painful arc 70–120°), ER 50° (P end range), HBB to L5 (P). L shoulder full and pain-free.\n" +
        "PROM R: flex 160° (P end range), ER 65° – same as L, not capsular.\n" +
        "Resisted R: abd 4/5 (P), ER 4/5 (P), IR 5/5; belly press neg.\n" +
        "Special tests R: Hawkins-Kennedy pos, Neer's pos, empty can pos (P, 4/5); drop arm neg, ER lag sign neg, Speed's neg, O'Brien's neg, apprehension neg.\n" +
        "Palpation: TTP R greater tuberosity / supraspinatus insertion; increased tone R upper trapezius.\n" +
        "C-spine: full pain-free AROM, Spurling's neg. UL dermatomes, myotomes and reflexes NAD.\n" +
        "Outcome measures: NPRS 7/10, QuickDASH 52.3, PSFS 2.7 (putting up displays 3/10, front crawl 1/10, sleeping on R side 4/10).",
      assessment:
        "R rotator cuff related shoulder pain (subacromial pain) following a lifting strain on 22/08/2026. No red flags. Strength 4/5 limited by pain and lag signs neg – no signs of a full-thickness cuff tear. PROM ER full – not consistent with a frozen shoulder. C-spine clear. Marked limitation of overhead and lifting tasks (QuickDASH 52.3).",
      plan:
        "Education: tendon pain and load management; relative rest from overhead lifting, keep moving within comfort; sleep with a pillow under the R arm.\n" +
        "Rx: STM R upper trapezius/infraspinatus; isometric ER and abd 5 x 45 s.\n" +
        "HEP: isometric ER/abd 5 x 45 s 2x/day, pendulums, scapular setting 10 x 3/day.\n" +
        "Plan: weekly sessions within the 6 pre-authorised; repeat NPRS/QuickDASH/PSFS at sessions 3 and 5.\n" +
        "Consent to share clinical information with the insurer (Bupa) for funding requests discussed and recorded.",
      pastMedicalHistory:
        "No previous R or L shoulder problems or treatment. Hypothyroidism – levothyroxine 75 mcg OD, stable (GP review 06/2026).",
      socialHistory:
        "Lives with husband and two children (12 and 15). Non-smoker. Alcohol approx. 4 units per week. Swims 2x/wk.",
    },
  },
  // 2 · N-002
  {
    date: "2026-09-08",
    time: "16:30",
    durationMinutes: 30,
    clinician: SARAH_REID,
    status: "ATT",
    charge: { amount: FOLLOW_UP_FEE, paid: true },
    note: {
      type: "follow_up",
      subjective:
        "R shoulder a little easier. NPRS 6/10 at worst. Night pain 1–2x/night. HEP isometrics 2x/day and pendulums, no flare. Managing at school avoiding overhead reaching.",
      objective:
        "R shoulder AROM: flex 130° (P), abd 105° (painful arc 80–120°), ER 55°, HBB L4.\n" +
        "Resisted abd and ER 4/5 (P).\n" +
        "Isometric ER/abd 5 x 45 s: pain 2/10 during, settles straight after.",
      assessment: "Settling; tolerating isometric loading.",
      plan:
        "Rx: STM R infraspinatus/upper trapezius.\n" +
        "HEP progressed: side-lying ER 0.5 kg 3 x 12, scapular retraction with band 3 x 12; continue isometrics.",
    },
  },
  // 3 · N-003 · reassessment (outcome measures, time point 2)
  {
    date: "2026-09-15",
    time: "16:30",
    durationMinutes: 30,
    clinician: SARAH_REID,
    status: "ATT",
    charge: { amount: FOLLOW_UP_FEE, paid: true },
    note: {
      type: "follow_up",
      subjective:
        "NPRS 5/10 at worst (reaching overhead), 1/10 at rest. Waking 1x/night. HEP daily. Put up a small display at school below head height with no flare. Not swimming yet.",
      objective:
        "R shoulder AROM: flex 145° (P end range), abd 130° (painful arc 90–130°), ER 60°, HBB L2.\n" +
        "Resisted abd 4+/5 (P), ER 4+/5. Hawkins-Kennedy pos.\n" +
        "Outcome measures: NPRS 5/10, QuickDASH 38.6 (52.3 on 01/09/2026), PSFS 4.3 (putting up displays 5/10, front crawl 2/10, sleeping on R side 6/10).",
      assessment: "R rotator cuff related shoulder pain, improving; tolerating progressive loading.",
      plan:
        "HEP progressed: band ER/IR 3 x 12, side-lying ER 1 kg 3 x 12, wall slides 2 x 10, scaption to 90° 0.5 kg 3 x 10.\n" +
        "Continue weekly sessions.",
    },
  },
  // 4 · CNC with reason (no charge)
  {
    date: "2026-09-22",
    time: "16:30",
    durationMinutes: 30,
    clinician: SARAH_REID,
    status: "CNC",
    reason: "Patient phoned on 18/09/2026: away on a school residential trip. Rebooked for 24/09/2026.",
  },
  // 5 · N-004
  {
    date: "2026-09-24",
    time: "16:30",
    durationMinutes: 30,
    clinician: SARAH_REID,
    status: "ATT",
    charge: { amount: FOLLOW_UP_FEE, paid: true },
    note: {
      type: "follow_up",
      subjective:
        "Back from the school trip. R shoulder sore for 1 day after carrying bags on and off the coach (NPRS 6/10), then settled. Now 4–5/10 at worst. Sleeping through most nights.",
      objective:
        "R shoulder AROM: flex 150°, abd 140° (painful arc 100–140°), ER 65°, HBB L1.\n" +
        "Scaption 1 kg 3 x 10: mild pain at end range only.",
      assessment: "Minor flare after carrying, settled; progressing.",
      plan:
        "Rx: STM R upper trapezius.\n" +
        "HEP progressed: band ER 3 x 15, scaption 1 kg 3 x 10, prone Y and T 2 x 10, wall push-up plus 2 x 10.\n" +
        "Advice: carry loads close to the body, split shopping between both hands.",
    },
  },
  // 6 · N-005 · reassessment (outcome measures, time point 3) + further-treatment request
  {
    date: "2026-10-01",
    time: "16:30",
    durationMinutes: 30,
    clinician: SARAH_REID,
    status: "ATT",
    charge: { amount: FOLLOW_UP_FEE, paid: false },
    note: {
      type: "follow_up",
      subjective:
        "Session 5 of the 6 pre-authorised. NPRS 4/10 at worst with overhead reaching and lifting at arm's length, 1/10 at rest. Sleeping on R side for part of the night. Putting up displays at shoulder height; still avoids reaching above head for more than 1 min. Tried swimming on 27/09/2026: 4 lengths breaststroke OK, front crawl painful on the recovery phase so stopped.",
      objective:
        "R shoulder AROM: flex 155° (P end range), abd 150° (painful arc 120–150°), ER 70°, HBB T12. L full.\n" +
        "Resisted abd 4+/5 (mild P), ER 5/5. Hawkins-Kennedy pos (less pain), Neer's neg, empty can 5/5 with mild P.\n" +
        "Outcome measures: NPRS 4/10, QuickDASH 29.5 (38.6 on 15/09/2026, 52.3 on 01/09/2026), PSFS 5.3 (putting up displays 6/10, front crawl 3/10, sleeping on R side 7/10).",
      assessment:
        "R rotator cuff related shoulder pain, improving: NPRS 7/10 → 4/10, QuickDASH 52.3 → 29.5, PSFS 2.7 → 5.3 since 01/09/2026. Ongoing pain and reduced strength and endurance with sustained overhead and loaded tasks. Pt goals not yet met (front crawl, overhead displays).",
      plan:
        "1 pre-authorised session left (booked 15/10/2026).\n" +
        "Further treatment request to Bupa: 4 further sessions, fortnightly over 8 wks.\n" +
        "Clinical reason: improving with progressive exercise, but at session 5 still has pain and reduced cuff and scapular strength and endurance with overhead and loaded tasks (PSFS 5.3, front crawl 3/10). Loading needs progressing to overhead and endurance work, with supervision of load and technique, before discharge to self-management. Guideline followed: BESS/BOA subacromial shoulder pain pathway – exercise-based physiotherapy is first-line management.\n" +
        "Goals for the further sessions: front crawl for 20 min without pain; put up displays above head height; lift a full box of books onto a high shelf.\n" +
        "HEP progressed: band ER at 90° abd 3 x 12, overhead press 1 kg 3 x 10, prone Y/T/W 3 x 10, serratus wall slides 2 x 10.\n" +
        "Request discussed with pt and agreed.",
    },
  },
  // 7 · BOOKED – the 6th (last) pre-authorised session
  {
    date: "2026-10-15",
    time: "16:30",
    durationMinutes: 30,
    clinician: SARAH_REID,
    status: "BOOKED",
  },
]);

export const REBECCA_LANE_APPOINTMENTS = visits.appointments;
export const REBECCA_LANE_NOTES = visits.notes;

export const REBECCA_LANE_OUTCOME_MEASURES: SimOutcomeMeasure[] = [
  {
    id: "sim-om-1006-nprs",
    episode_id: REBECCA_LANE_EPISODE_ID,
    instrument: "NPRS",
    unit: "/10",
    higher_is_worse: true,
    scores: [
      { date: "2026-09-01", value: 7, note_id: noteRef(KEY, 1) },
      { date: "2026-09-15", value: 5, note_id: noteRef(KEY, 3) },
      { date: "2026-10-01", value: 4, note_id: noteRef(KEY, 6) },
    ],
    _simulated: true,
  },
  {
    id: "sim-om-1006-quickdash",
    episode_id: REBECCA_LANE_EPISODE_ID,
    instrument: "QuickDASH",
    unit: "/100",
    higher_is_worse: true,
    scores: [
      { date: "2026-09-01", value: 52.3, note_id: noteRef(KEY, 1) },
      { date: "2026-09-15", value: 38.6, note_id: noteRef(KEY, 3) },
      { date: "2026-10-01", value: 29.5, note_id: noteRef(KEY, 6) },
    ],
    _simulated: true,
  },
  {
    id: "sim-om-1006-psfs",
    episode_id: REBECCA_LANE_EPISODE_ID,
    instrument: "PSFS",
    unit: "/10",
    higher_is_worse: false,
    scores: [
      { date: "2026-09-01", value: 2.7, note_id: noteRef(KEY, 1) },
      { date: "2026-09-15", value: 4.3, note_id: noteRef(KEY, 3) },
      { date: "2026-10-01", value: 5.3, note_id: noteRef(KEY, 6) },
    ],
    _simulated: true,
  },
];
