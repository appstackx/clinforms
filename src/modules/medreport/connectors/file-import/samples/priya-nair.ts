/**
 * Sample import case (FICTIONAL): Priya Nair, 42, primary school teacher. Slipped on a wet floor in a
 * supermarket on 03/04/2026 and fell onto her outstretched right arm; right shoulder pain (rotator cuff
 * related shoulder pain). Instructed by Calder & Moss Solicitors (fictional), ref CM/PI/0815.
 *
 * One clinician (Sarah Reid, PH-DEMO-01). 7 appointments: 6 attended + 1 cancelled with notice.
 * QuickDASH 52 → 34 → 20, NPRS 6 → 3 → 1. Pre-incident history and disclosure consent recorded; the
 * discharge note records the clinician's expected outlook. Everyone and every organisation is fictional.
 *
 * BROWSER-SAFE plain data (the Studio offers it as "Download sample export"). The JSON, CSV and text
 * samples in ./index.ts are all generated from this one object, so they describe the same case.
 *
 * Owner: integration agent.
 */
import type { ImportDocument } from "../format";

const SARAH_REID = { name: "Sarah Reid", hcpc: "PH-DEMO-01", role: "Senior Physiotherapist, MCSP" };

export const PRIYA_NAIR_IMPORT: ImportDocument = {
  format: "appstackx-reports.import",
  version: 1,
  patient: {
    id: "imp-pat-3017",
    title: "Mrs",
    first_name: "Priya",
    last_name: "Nair",
    date_of_birth: "1984-09-14",
    sex: "female",
    address: { line1: "27 Linford Close (fictional)", line2: "Newport Pagnell", town: "Milton Keynes", postcode: "MK16 0ZZ" },
    phone: "07700 900456",
    email: "priya.nair@example.com",
    occupation: "Primary school teacher",
    employer_name: "Oakfield Primary School (fictional)",
  },
  episode: {
    id: "imp-ep-3017-1",
    title: "Right shoulder pain after a fall",
    status: "discharged",
    start_date: "2026-04-10",
    end_date: "2026-06-26",
    referral: {
      source_type: "solicitor",
      organisation_name: "Calder & Moss Solicitors (fictional)",
      reference: "CM/PI/0815",
      contact_name: "Hannah Lowe",
      address: "8 Market Row (fictional), Milton Keynes, MK9 0ZZ",
      referral_date: "2026-04-08",
      reason: "Assessment and treatment after a slip in a supermarket on 03/04/2026; treating physiotherapist report to follow.",
    },
    incident: {
      date: "2026-04-03",
      mechanism:
        "Slipped on a wet, unsigned floor in a supermarket aisle and fell onto her outstretched right arm. No head injury.",
      incident_type: "slip_trip_fall",
    },
    consent: { disclosure_consent_recorded: true, recorded_on: "2026-04-10" },
    primary_clinician: SARAH_REID,
  },
  notes: [
    {
      id: "imp-note-01",
      note_date: "2026-04-10",
      note_time: "10:00",
      note_type: "initial_assessment",
      author: SARAH_REID,
      subjective:
        "Slipped on a wet floor in a supermarket on 03/04/2026 and landed on her outstretched R arm. Immediate R shoulder pain; seen at the urgent treatment centre the same day, X-ray reported no fracture. Pain lateral R shoulder into the upper arm, worse lifting the arm above shoulder height and lying on the R side. NPRS 6/10 at worst, 2/10 at rest. Waking 2x/night. Teaching with difficulty: cannot write on the whiteboard above head height. No neck pain, no P&N.\nNo previous R shoulder problems; no previous treatment for the shoulder.",
      objective:
        "R shoulder AROM: flex 110° (P), abd 95° (P, painful arc 70–110°), ER 40°, IR to L3. L shoulder full and pain-free.\nResisted abd and ER painful and 4/5; Hawkins-Kennedy positive R; drop arm test negative; no instability signs.\nCervical screen clear.\nOutcome measures: QuickDASH 52, NPRS 6/10.",
      assessment:
        "Presentation consistent with R rotator cuff related shoulder pain following a fall on an outstretched arm. No signs of a full-thickness tear on testing.",
      plan:
        "Advice and reassurance; relative rest from overhead tasks, keep moving below shoulder height.\nHEP: pendular exercises, isometric ER/abd 5 x 30 s, scapular setting.\nWeekly sessions; review QuickDASH/NPRS in about 5 weeks.\nConsent to disclose records to the instructing solicitor discussed and recorded.",
      free_text: null,
      past_medical_history: "Mild hypertension, controlled on medication. No previous shoulder injury.",
      social_history: null,
      appointment_id: "imp-appt-01",
    },
    {
      id: "imp-note-02",
      note_date: "2026-04-17",
      note_time: "10:00",
      note_type: "follow_up",
      author: SARAH_REID,
      subjective: "Slightly easier. Still waking once a night. Doing HEP daily. Managing at school with a colleague helping with displays.",
      objective: "R flex 125° (P end range), abd 110° (P). Resisted ER 4/5, less painful.",
      assessment: "Early improvement in range and pain on loading.",
      plan: "Progressed HEP: band ER/IR 3 x 10, wall slides.\nContinue weekly.",
      free_text: null,
      past_medical_history: null,
      social_history: null,
      appointment_id: "imp-appt-02",
    },
    {
      id: "imp-note-03",
      note_date: "2026-05-01",
      note_time: "10:00",
      note_type: "follow_up",
      author: SARAH_REID,
      subjective: "Sleeping through most nights. Pain mainly with reaching overhead at the whiteboard.",
      objective: "R flex 145°, abd 140° (painful arc 120–140°). Resisted abd 4+/5.",
      assessment: "Continuing improvement; overhead loading remains provocative.",
      plan: "Added prone Y/T raises and loaded flexion to tolerance. Next session in 2 weeks with reassessment.",
      free_text: null,
      past_medical_history: null,
      social_history: null,
      appointment_id: "imp-appt-04",
    },
    {
      id: "imp-note-04",
      note_date: "2026-05-15",
      note_time: "10:00",
      note_type: "follow_up",
      author: SARAH_REID,
      subjective: "Back to full teaching duties, including displays with a step-stool. Occasional ache after a long day.",
      objective:
        "R flex 160°, abd 155°, ER 70°. Hawkins-Kennedy mildly positive. Resisted tests 5/5 with mild discomfort on ER.\nOutcome measures: QuickDASH 34, NPRS 3/10.",
      assessment: "Good progress: function improving, mild residual cuff irritability.",
      plan: "Progressed to overhead strengthening. Sessions every 3 weeks.",
      free_text: null,
      past_medical_history: null,
      social_history: null,
      appointment_id: "imp-appt-05",
    },
    {
      id: "imp-note-05",
      note_date: "2026-06-05",
      note_time: "10:00",
      note_type: "follow_up",
      author: SARAH_REID,
      subjective: "Ache only after carrying heavy bags of books. Swimming again (breaststroke).",
      objective: "Full R shoulder AROM; end-range ER slightly uncomfortable. Resisted tests 5/5 pain-free.",
      assessment: "Near-full recovery of function; minor end-range discomfort.",
      plan: "Maintenance HEP 3x/week. Review in 3 weeks for discharge.",
      free_text: null,
      past_medical_history: null,
      social_history: null,
      appointment_id: "imp-appt-06",
    },
    {
      id: "imp-note-06",
      note_date: "2026-06-26",
      note_time: "10:00",
      note_type: "discharge",
      author: SARAH_REID,
      subjective: "Working full-time with no restrictions. Occasional ache (NPRS 1/10) after heavy lifting. Sleeping well.",
      objective: "Full, pain-free R shoulder AROM. Resisted tests 5/5.\nOutcome measures: QuickDASH 20, NPRS 1/10.",
      assessment:
        "Discharged. Residual minor end-range discomfort. In my opinion the remaining discomfort is likely to settle over the next 6–8 weeks with continued home exercise.",
      plan: "Discharged with maintenance HEP 3x/week for 8 weeks. Self-refer if symptoms recur.",
      free_text: null,
      past_medical_history: null,
      social_history: null,
      appointment_id: "imp-appt-07",
    },
  ],
  appointments: [
    { id: "imp-appt-01", date: "2026-04-10", start_time: "10:00", duration_minutes: 60, status: "ATT", status_reason: null, clinician: SARAH_REID, note_id: "imp-note-01" },
    { id: "imp-appt-02", date: "2026-04-17", start_time: "10:00", duration_minutes: 30, status: "ATT", status_reason: null, clinician: SARAH_REID, note_id: "imp-note-02" },
    {
      id: "imp-appt-03",
      date: "2026-04-24",
      start_time: "10:00",
      duration_minutes: 30,
      status: "CNC",
      status_reason: "Patient phoned two days ahead: parents' evening at school; rebooked.",
      clinician: SARAH_REID,
      note_id: null,
    },
    { id: "imp-appt-04", date: "2026-05-01", start_time: "10:00", duration_minutes: 30, status: "ATT", status_reason: null, clinician: SARAH_REID, note_id: "imp-note-03" },
    { id: "imp-appt-05", date: "2026-05-15", start_time: "10:00", duration_minutes: 30, status: "ATT", status_reason: null, clinician: SARAH_REID, note_id: "imp-note-04" },
    { id: "imp-appt-06", date: "2026-06-05", start_time: "10:00", duration_minutes: 30, status: "ATT", status_reason: null, clinician: SARAH_REID, note_id: "imp-note-05" },
    { id: "imp-appt-07", date: "2026-06-26", start_time: "10:00", duration_minutes: 30, status: "ATT", status_reason: null, clinician: SARAH_REID, note_id: "imp-note-06" },
  ],
  outcome_measures: [
    {
      id: "imp-om-quickdash",
      instrument: "QuickDASH",
      unit: "/100",
      higher_is_worse: true,
      scores: [
        { date: "2026-04-10", value: 52, note_id: "imp-note-01" },
        { date: "2026-05-15", value: 34, note_id: "imp-note-04" },
        { date: "2026-06-26", value: 20, note_id: "imp-note-06" },
      ],
    },
    {
      id: "imp-om-nprs",
      instrument: "NPRS",
      unit: "/10",
      higher_is_worse: true,
      scores: [
        { date: "2026-04-10", value: 6, note_id: "imp-note-01" },
        { date: "2026-05-15", value: 3, note_id: "imp-note-04" },
        { date: "2026-06-26", value: 1, note_id: "imp-note-06" },
      ],
    },
  ],
};
