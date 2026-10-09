/**
 * Inline fixtures for the validator unit tests (module tests may not import the sandbox).
 * Fictional data only. Not imported by app code.
 *
 * Owner: ai agent.
 */
import { createReport } from "../report-factory";
import type { EpisodeBundle, Paragraph, Report, ReportSection, ReportTemplate } from "../types";
import { computeFacts } from "../computed-facts";

export const TEST_FACTS_DATE = "2026-10-06";

export function testBundle(): EpisodeBundle {
  return {
    tenantId: "demo",
    source: {
      connectorId: "tm3-sim",
      simulated: true,
      fetchedAt: "2026-10-06T09:00:00.000Z",
      externalPatientId: "t-pat-1",
      externalEpisodeId: "t-ep-1",
      label: "Simulated TM3 sandbox",
    },
    registration: {
      id: "REG",
      externalPatientId: "t-pat-1",
      title: "Mr",
      firstName: "Owen",
      lastName: "Testcase",
      fullName: "Owen Testcase",
      dob: "1985-05-14",
      sex: "male",
      addressSummary: "1 Test Street (fictional), Milton Keynes",
      occupation: "Delivery driver",
      employer: "Example Freight Ltd (fictional)",
      contact: { phone: "07700 900999", email: "owen@example.com" },
    },
    referral: {
      type: "employer",
      name: "Example Freight Ltd (fictional)",
      reference: "EF-OH-01",
      contactName: "J. Adviser",
      address: "Milton Keynes",
      referralDate: "2026-03-16",
      reason: "Back pain after a lifting incident at work on 12/03/2026.",
    },
    incident: { date: "2026-03-12", mechanism: "Lifted a 20 kg parcel with a twist.", type: "workplace" },
    clinicians: [
      { name: "Sarah Reid", hcpc: "PH-DEMO-01", role: "Senior Physiotherapist, MCSP" },
      { name: "Tom Ellis", hcpc: "PH-DEMO-02", role: "Physiotherapist, MCSP" },
    ],
    notes: [
      {
        id: "N-001",
        date: "2026-03-18",
        time: "09:00",
        type: "initial_assessment",
        author: { name: "Sarah Reid", hcpc: "PH-DEMO-01", role: "Senior Physiotherapist, MCSP" },
        subjective:
          "Lifting injury at work on 12/03/2026. Central LBP, NPRS 7/10 at worst. Sitting tolerance 20 min. Off work since 13/03/2026. Non-smoker; drinks alcohol at weekends.",
        objective: "Lumbar flexion 50% limited. TTP L4/5 paraspinals. SLR 70° R. ODI 48%.",
        assessment: "Presentation consistent with acute mechanical low back pain. No red flags.",
        plan: "HEP: pelvic tilts 10 x 3/day. Review in about 6–7 wks.",
        pastMedicalHistory: "Right knee arthroscopy 2015. Mild asthma.",
        socialHistory: "Lives with partner. Smoker, 10 a day.",
      },
      {
        id: "N-002",
        date: "2026-05-06",
        time: "09:00",
        type: "discharge",
        author: { name: "Tom Ellis", hcpc: "PH-DEMO-02", role: "Physiotherapist, MCSP" },
        subjective: "LBP 2/10 at worst after shifts. Working amended duties.",
        objective: "Lumbar AROM full and pain-free. ODI 18%.",
        assessment:
          "Opinion on work: in my opinion he is fit for a phased return to normal duties over 2 weeks; he should avoid repetitive lifting >15 kg for 4 weeks; review in 6 weeks.",
        plan: "Discharged to self-management.",
      },
    ],
    appointments: [
      { id: "A-001", date: "2026-03-18", time: "09:00", status: "ATT", noteId: "N-001" },
      { id: "A-002", date: "2026-04-01", time: "09:00", status: "DNA" },
      { id: "A-003", date: "2026-05-06", time: "09:00", status: "ATT", noteId: "N-002" },
    ],
    outcomeMeasures: [
      {
        id: "OM-ODI",
        instrument: "ODI",
        unit: "%",
        higherIsWorse: true,
        points: [
          { date: "2026-03-18", value: 48, noteId: "N-001" },
          { date: "2026-05-06", value: 18, noteId: "N-002" },
        ],
      },
    ],
    consent: { disclosureConsentRecorded: true, date: "2026-03-18" },
    episodeStatus: "discharged",
  };
}

export function testReport(template: ReportTemplate, bundle: EpisodeBundle = testBundle()): Report {
  return createReport({
    template,
    bundle,
    instructingParty: bundle.referral,
    computedFacts: computeFacts(bundle, { asOf: TEST_FACTS_DATE }),
    id: "rpt_test",
    now: new Date(`${TEST_FACTS_DATE}T09:00:00.000Z`),
  });
}

let counter = 0;

/** An AI paragraph (override any field). */
export function para(text: string, sourceIds: string[], extra: Partial<Paragraph> = {}): Paragraph {
  counter += 1;
  return { id: `p${counter}`, text, sourceIds, origin: "ai", basis: "clinician_observed", ...extra };
}

/** Replace the paragraphs of one section (immutable). */
export function withSection(report: Report, key: string, paragraphs: Paragraph[], status: ReportSection["status"] = "drafted"): Report {
  return {
    ...report,
    sections: report.sections.map((s) => (s.key === key ? { ...s, paragraphs, status } : s)),
  };
}
