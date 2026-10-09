/**
 * CASE A – Megan Hart (fictional), 34, office administrator.
 * Rear-end shunt as a stationary driver on 12/03/2026; whiplash-associated disorder grade II.
 * Instructed by Harrow & Pike Solicitors (fictional), ref HP/RTA/2291 (treating physiotherapist report).
 *
 * 11 appointments: 10 ATT + 1 DNA (15/04/2026, NO reason recorded). 10 SOAP notes by two physios.
 * NDI 42 → 24 → 12 %, NPRS 7 → 4 → 2 (18/03, 06/05, 07/07/2026).
 *
 * Planted gaps (do NOT "fix" these – the demo depends on them):
 *  1. No pre-accident history anywhere: no past_medical_history / social_history fields and no
 *     mention of previous neck problems in any note.
 *  2. The DNA on 15/04/2026 has no reason recorded, and no later note explains it.
 *  3. No prognosis recorded by any clinician: the discharge note gives status and the HEP only.
 *
 * Owner: sandbox/fixtures agent. All people and organisations are fictional.
 */
import type { SimEpisode, SimOutcomeMeasure, SimPatient } from "../wire-types";
import { buildVisits, noteRef } from "./build";
import { SARAH_REID, TOM_ELLIS } from "./clinic";

export const MEGAN_HART_PATIENT_ID = "sim-pat-001";
export const MEGAN_HART_EPISODE_ID = "sim-ep-1001";
const KEY = "1001";

export const MEGAN_HART_PATIENT: SimPatient = {
  id: MEGAN_HART_PATIENT_ID,
  title: "Ms",
  first_name: "Megan",
  last_name: "Hart",
  date_of_birth: "1991-11-22",
  sex: "female",
  address: { line1: "14 Willow Bank (fictional)", line2: "Bletchley", town: "Milton Keynes", postcode: "MK3 9ZZ" },
  phone: "07700 900123",
  email: "megan.hart@example.com",
  occupation: "Office administrator",
  employer_name: "Ashby Property Services (fictional)",
  registered_at: "2026-03-16T10:12:00.000Z",
  episode_count: 1,
  _simulated: true,
};

export const MEGAN_HART_EPISODE: SimEpisode = {
  id: MEGAN_HART_EPISODE_ID,
  patient_id: MEGAN_HART_PATIENT_ID,
  title: "Neck pain and headaches following road traffic accident",
  status: "discharged",
  start_date: "2026-03-18",
  end_date: "2026-07-07",
  referral: {
    source_type: "solicitor",
    organisation_name: "Harrow & Pike Solicitors (fictional)",
    reference: "HP/RTA/2291",
    contact_name: "Amelia Grant",
    address: "3 Silbury Arcade (fictional), Milton Keynes, MK9 0ZZ",
    referral_date: "2026-03-16",
    reason:
      "Assessment and treatment following a road traffic accident on 12/03/2026. A treating physiotherapist report will be requested on discharge.",
  },
  incident: {
    date: "2026-03-12",
    mechanism:
      "Rear-end collision. Restrained driver of a stationary car queuing at traffic lights, struck from behind by another car. Airbags did not deploy. No head strike, no loss of consciousness.",
    incident_type: "road_traffic_accident",
  },
  consent: { disclosure_consent_recorded: true, recorded_on: "2026-03-18" },
  primary_clinician: SARAH_REID,
  _simulated: true,
};

const visits = buildVisits(MEGAN_HART_EPISODE_ID, KEY, [
  // 1 · N-001 · initial assessment
  {
    date: "2026-03-18",
    time: "09:00",
    durationMinutes: 60,
    clinician: SARAH_REID,
    status: "ATT",
    note: {
      type: "initial_assessment",
      subjective:
        "Referred by Harrow & Pike Solicitors (fictional) following RTA on 12/03/2026. Pt was the restrained driver of a stationary car queuing at traffic lights when struck from behind. Airbags did not deploy. No head strike, no LOC. Self-extricated and exchanged details at the scene. Neck stiffness came on the same evening, worse on waking 13/03/2026. Seen at an urgent treatment centre 13/03/2026: no imaging, advised simple analgesia and to keep moving.\n" +
        "Current sx: central and bilateral neck pain L>R spreading into both upper traps. No arm pain, P&N or weakness. NPRS 7/10 at worst, 3/10 at best. Occipital headaches 3–4x/wk lasting 2–3 hrs, started 2 days after the accident. Sleep disturbed, waking 2–3x/night on turning.\n" +
        "Aggs: driving (esp. checking blind spot and reversing), sitting at computer >30 min, looking up to high shelves. Eases: heat, paracetamol + ibuprofen, gentle movement.\n" +
        "24 hr: stiff ~45 min on waking, worse at end of working day.\n" +
        "Work/function: office administrator, full-time, desk-based. Off work 13/03/2026 and 16/03/2026, back since 17/03/2026 taking extra breaks. Driving short local journeys only; reports feeling anxious and checking the rear-view mirror repeatedly when stopped in traffic.\n" +
        "DH: paracetamol 1 g QDS, ibuprofen 400 mg TDS PRN with food.\n" +
        "Red flags: no dizziness, diplopia, dysarthria, dysphagia, drop attacks or nausea; no bilateral UL symptoms; no gait disturbance.\n" +
        "Pt goals: drive without neck pain, get through a working day without headache, sleep through the night.",
      objective:
        "Obs: forward head posture, guarded neck movement, turns trunk to look over shoulder.\n" +
        "C-spine AROM: Flex 30° (P end range), Ext 25° (P, posterior neck), L rot 45° (P L side), R rot 50° (P), L SF 20°, R SF 25°.\n" +
        "Palpation: TTP bilateral upper trapezius and levator scapulae L>R; TTP C2–C4 paraspinals L>R; increased tone L sub-occipitals.\n" +
        "PAIVMs: central PA C2–C5 stiff, reproduce local neck pain; L UPA C3/4 most comparable.\n" +
        "Neuro: UL dermatomes C5–T1 intact to LT; myotomes C5–T1 5/5 bilat; biceps, triceps and brachioradialis reflexes 2+ and symmetrical.\n" +
        "Special tests: Spurling's neg bilat; ULTT1 (median) neg bilat; flexion-rotation test 28° L, 35° R (positive L); cranio-cervical flexion test holds 22 mmHg x 10 s, unable to progress to 24 mmHg.\n" +
        "Outcome measures: NDI 42%, NPRS 7/10.",
      assessment:
        "Presentation consistent with whiplash-associated disorder grade II (Quebec Task Force): neck pain with musculoskeletal signs (reduced AROM, point tenderness) and no neurological signs. Headaches consistent with a cervicogenic component (positive FRT L, reproduced with L upper cervical PAIVMs). Moderate disability on NDI (42%). Some driving-related anxiety reported.",
      plan:
        "Explained WAD and reassured; advised to stay active, no collar, regular heat.\n" +
        "Rx: STM bilateral upper traps/levator scapulae, Maitland grade II central PAs C2–C5, sub-occipital release.\n" +
        "HEP: chin tucks 10 x 3/day, active rotation 10 each way x 3/day, scapular setting 10 x 3/day.\n" +
        "Work: posture breaks every 30 min, screen raised to eye level.\n" +
        "Plan: weekly sessions; repeat NDI/NPRS at reassessment in about 6–7 wks.\n" +
        "Consent to disclose records to the instructing solicitor discussed and recorded.",
    },
  },
  // 2 · N-002
  {
    date: "2026-03-25",
    time: "09:00",
    durationMinutes: 30,
    clinician: SARAH_REID,
    status: "ATT",
    note: {
      type: "follow_up",
      subjective:
        "Neck 'a bit easier' since last week. NPRS 6/10 at worst. Headaches 3x this wk. Doing HEP 2x/day. Still waking 1–2x/night. Managing at work with breaks; driving short distances only.",
      objective:
        "C-spine AROM: Flex 35°, Ext 30° (P), L rot 50° (P), R rot 55°, L SF 22°, R SF 28°.\n" +
        "Palpation: TTP L upper trapezius and levator scapulae; sub-occipital tone reduced.\n" +
        "Neuro not re-tested (no new symptoms).",
      assessment: "WAD II with early improvement in AROM. Headache frequency slightly reduced.",
      plan:
        "Rx: STM, grade II–III central PAs C2–C5, sub-occipital release.\n" +
        "HEP progressed: added upper trapezius stretch 3 x 30 s each side.\n" +
        "Continue weekly.",
    },
  },
  // 3 · N-003
  {
    date: "2026-04-01",
    time: "09:00",
    durationMinutes: 30,
    clinician: SARAH_REID,
    status: "ATT",
    note: {
      type: "follow_up",
      subjective:
        "NPRS 5/10 at worst. Headaches 2x/wk, shorter (~1 hr). Sleep improving, waking once a night. Drove 40 min at the weekend – neck sore for a few hours afterwards. Still anxious at junctions when cars approach from behind.",
      objective:
        "C-spine AROM: Flex 40°, Ext 35° (P end range), L rot 55°, R rot 60°, L SF 25°, R SF 30°.\n" +
        "CCFT: holds 24 mmHg x 10 s. FRT 34° L, 38° R.\n" +
        "Palpation: TTP reduced, mainly L levator scapulae.",
      assessment: "Improving AROM and deep neck flexor endurance. Cervicogenic headache settling.",
      plan:
        "Rx: STM, grade III L UPA C3/4, SNAGs into L rotation.\n" +
        "HEP: cranio-cervical flexion training 10 s holds x 10, theraband rows 3 x 12.\n" +
        "Advised graded increase in driving time. Driving anxiety discussed; pt to raise with GP if not settling.",
    },
  },
  // 4 · N-004
  {
    date: "2026-04-08",
    time: "09:00",
    durationMinutes: 30,
    clinician: TOM_ELLIS,
    status: "ATT",
    note: {
      type: "follow_up",
      subjective:
        "Seen by TE (SR on leave). Neck 'about the same as last week': NPRS 5/10 at worst, 2/10 at best. Headaches 2x this wk. Long day at work on Monday – 7/10 by the evening, settled overnight.",
      objective:
        "C-spine AROM: Flex 40°, Ext 35°, L rot 55° (P), R rot 60°, L SF 25°, R SF 30°.\n" +
        "Palpation: TTP L C3/4 paraspinals and L levator scapulae.\n" +
        "Neuro screen UL: dermatomes, myotomes and reflexes NAD.",
      assessment: "WAD II; plateau this week linked to workload. Neurologically intact.",
      plan:
        "Rx: STM, grade III L UPA C3/4, thoracic extension mobilisation over foam roller.\n" +
        "HEP: added thoracic extension over towel roll 10 x 2/day. Workstation advice reinforced.\n" +
        "Next appt 15/04/2026 with TE.",
    },
  },
  // 5 · DNA – no reason recorded (planted gap)
  {
    date: "2026-04-15",
    time: "09:00",
    durationMinutes: 30,
    clinician: TOM_ELLIS,
    status: "DNA",
  },
  // 6 · N-005
  {
    date: "2026-04-22",
    time: "09:00",
    durationMinutes: 30,
    clinician: SARAH_REID,
    status: "ATT",
    note: {
      type: "follow_up",
      subjective:
        "Pt feels she is 'getting there'. NPRS 4/10 at worst. Headaches 1–2x/wk, mild. Sleeping through most nights. Driving up to 30 min without an increase in symptoms.",
      objective:
        "C-spine AROM: Flex 45°, Ext 40°, L rot 60°, R rot 65°, L SF 30°, R SF 35°.\n" +
        "Palpation: mild TTP L levator scapulae only.\n" +
        "CCFT: holds 26 mmHg x 10 s.",
      assessment: "Good progress in AROM and motor control.",
      plan:
        "Rx: STM L levator scapulae, SNAGs L rotation.\n" +
        "HEP progressed: CCF with head lift, prone Y/T raises 2 x 10, theraband rows 3 x 15.\n" +
        "Reassessment with outcome measures next session.",
    },
  },
  // 7 · N-006 · reassessment (mid outcome scores)
  {
    date: "2026-05-06",
    time: "09:00",
    durationMinutes: 45,
    clinician: SARAH_REID,
    status: "ATT",
    note: {
      type: "follow_up",
      subjective:
        "Reassessment, 7 wks after IA. NPRS 4/10 at worst (end of working day), 1/10 at best. Headaches ~1x/wk, under 1 hr, eased by paracetamol. Sleeping through. Working full days with breaks. Driving to work again (25 min each way); some neck discomfort after longer drives. Less anxious driving but still checks mirror at lights.",
      objective:
        "C-spine AROM: Flex 45°, Ext 45° (end-range stiffness only), L rot 65°, R rot 70°, L SF 35°, R SF 38°.\n" +
        "Palpation: mild TTP L upper trapezius.\n" +
        "FRT 40° L, 42° R. CCFT: 26 mmHg x 10 s; 28 mmHg x 6 s.\n" +
        "Neuro: UL NAD.\n" +
        "Outcome measures: NDI 24% (42% on 18/03/2026), NPRS 4/10 (7/10 on 18/03/2026).",
      assessment:
        "WAD II, improving. Mild disability on NDI (24%). Residual end-range stiffness, deep neck flexor endurance deficit and L levator scapulae trigger point.",
      plan:
        "Rx: STM, SNAGs.\n" +
        "HEP progressed to strength/endurance: CCF 10 x 10 s at 28 mmHg, prone cervical extension holds, band pull-aparts 3 x 15.\n" +
        "Reduce to fortnightly sessions.",
    },
  },
  // 8 · N-007
  {
    date: "2026-05-20",
    time: "09:00",
    durationMinutes: 30,
    clinician: TOM_ELLIS,
    status: "ATT",
    note: {
      type: "follow_up",
      subjective:
        "NPRS 3/10 at worst. 2 mild headaches in the last fortnight. Neck stiff after a 1-hr drive to visit family at the weekend, settled next day. Doing HEP daily.",
      objective:
        "C-spine AROM: Flex 50°, Ext 50°, L rot 70° (end-range tightness), R rot 70°, L SF 38°, R SF 40°.\n" +
        "Palpation: minimal TTP. Thoracic rotation full bilat.",
      assessment: "Continued improvement; residual end-range stiffness into L rotation.",
      plan:
        "Rx: SNAGs L rotation, STM L levator scapulae.\n" +
        "HEP: added resisted isometrics in 4 directions 5 x 10 s; continue previous programme.\n" +
        "Continue fortnightly.",
    },
  },
  // 9 · N-008
  {
    date: "2026-06-03",
    time: "09:00",
    durationMinutes: 30,
    clinician: TOM_ELLIS,
    status: "ATT",
    note: {
      type: "follow_up",
      subjective:
        "NPRS 3/10 at worst after long days at the desk, mostly 0–1/10. 1 headache in 2 wks. Back to swimming 1x/wk – neck ache after breaststroke.",
      objective:
        "C-spine AROM full and pain-free except mild pull at end-range L rotation and end-range extension.\n" +
        "CCFT: 28 mmHg x 10 s x 10.\n" +
        "Neuro: NAD.",
      assessment: "Near-full AROM with good deep neck flexor endurance.",
      plan:
        "Rx: SNAGs. Swimming advice: alternate strokes, avoid prolonged neck extension in breaststroke.\n" +
        "HEP progressed: prone Y/T/W 3 x 12 with 1 kg, chin tuck with rotation.\n" +
        "Review in 2 wks.",
    },
  },
  // 10 · N-009
  {
    date: "2026-06-17",
    time: "09:00",
    durationMinutes: 30,
    clinician: SARAH_REID,
    status: "ATT",
    note: {
      type: "follow_up",
      subjective:
        "Neck 'much better'. NPRS 2/10 at worst. 1 mild headache in 2 wks. Driving up to 1 hr without symptoms. Working full days, taking breaks. Swimming 2x/wk.",
      objective:
        "C-spine AROM: Flex 50°, Ext 55°, L rot 75°, R rot 75°, L SF 40°, R SF 42°; mild discomfort at end-range L rotation.\n" +
        "Palpation: no significant TTP.\n" +
        "CCFT: 28 mmHg x 10 s x 10.",
      assessment: "WAD II with good functional progress. Minimal residual symptoms.",
      plan:
        "HEP reviewed and progressed to a maintenance programme (3x/wk).\n" +
        "Discharge plan discussed: 3 wks of self-management, then final review.",
    },
  },
  // 11 · N-010 · discharge (no prognosis recorded – planted gap)
  {
    date: "2026-07-07",
    time: "09:00",
    durationMinutes: 30,
    clinician: SARAH_REID,
    status: "ATT",
    note: {
      type: "discharge",
      subjective:
        "Final review. Occasional neck ache (NPRS 2/10 at worst) after long days at the computer or drives over 1 hr; 0/10 most days. 1 mild headache in the last 3 wks. Sleeping well. Working full-time, normal duties. Driving without restriction; less anxious driving but still checks the mirror more than before the accident. Swimming 2x/wk. Doing maintenance HEP 3x/wk.",
      objective:
        "C-spine AROM: Flex 55°, Ext 55°, L rot 75°, R rot 80°, L SF 40°, R SF 45°; mild pull at end-range L rotation, no pain.\n" +
        "Palpation: no TTP.\n" +
        "Neuro: UL dermatomes, myotomes and reflexes NAD. FRT 42° L, 44° R.\n" +
        "Outcome measures: NDI 12% (24% on 06/05/2026, 42% on 18/03/2026); NPRS 2/10 (4/10 on 06/05/2026, 7/10 on 18/03/2026).",
      assessment:
        "Episode of care complete. Residual intermittent low-level neck ache with prolonged sitting or driving. Full functional AROM; no neurological signs.",
      plan:
        "Discharged from active physiotherapy to self-management.\n" +
        "Maintenance HEP: CCF 10 x 10 s, prone Y/T/W 3 x 12, active rotation and upper trapezius stretches daily; continue swimming.\n" +
        "Workstation breaks every 30–45 min.\n" +
        "Advised to contact the clinic or GP if symptoms increase.",
    },
  },
]);

export const MEGAN_HART_APPOINTMENTS = visits.appointments;
export const MEGAN_HART_NOTES = visits.notes;

export const MEGAN_HART_OUTCOME_MEASURES: SimOutcomeMeasure[] = [
  {
    id: "sim-om-1001-ndi",
    episode_id: MEGAN_HART_EPISODE_ID,
    instrument: "NDI",
    unit: "%",
    higher_is_worse: true,
    scores: [
      { date: "2026-03-18", value: 42, note_id: noteRef(KEY, 1) },
      { date: "2026-05-06", value: 24, note_id: noteRef(KEY, 7) },
      { date: "2026-07-07", value: 12, note_id: noteRef(KEY, 11) },
    ],
    _simulated: true,
  },
  {
    id: "sim-om-1001-nprs",
    episode_id: MEGAN_HART_EPISODE_ID,
    instrument: "NPRS",
    unit: "/10",
    higher_is_worse: true,
    scores: [
      { date: "2026-03-18", value: 7, note_id: noteRef(KEY, 1) },
      { date: "2026-05-06", value: 4, note_id: noteRef(KEY, 7) },
      { date: "2026-07-07", value: 2, note_id: noteRef(KEY, 11) },
    ],
    _simulated: true,
  },
];
