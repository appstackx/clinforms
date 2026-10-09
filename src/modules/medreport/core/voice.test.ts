/**
 * Wording helpers (core/voice.ts): the signing clinician's own notes in the first person, note
 * shorthand in plain words, job titles as the record gives them – numbers and dates untouched.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { collapseRepeatedBrackets, describeSourceIds, expandNoteShorthand, fictionalNames, isOwnVoiceCandidate, keepFictionalLabels, normaliseJobTitles, rewriteInFirstPerson } from "./voice";

test("the signer's recorded opinion becomes their own voice", () => {
  assert.equal(
    rewriteInFirstPerson("On 22/09/2026 Tom Ellis, physiotherapist, recorded that in his opinion Mr Brooks is fit for a phased return to normal duties over 2 weeks.", "Tom Ellis"),
    "On 22/09/2026 I recorded that, in my opinion, Mr Brooks is fit for a phased return to normal duties over 2 weeks.",
  );
  assert.equal(
    rewriteInFirstPerson("At the final review on 07/07/2026, Sarah Reid, Senior Physiotherapist, assessed residual intermittent low-level neck ache. She recorded advice to take workstation breaks every 30–45 minutes.", "Sarah Reid"),
    "At my final review on 07/07/2026, I assessed residual intermittent low-level neck ache. I recorded advice to take workstation breaks every 30–45 minutes.",
  );
  assert.equal(
    rewriteInFirstPerson("At the initial assessment on 09/06/2026, Mr Brooks told Tom Ellis, physiotherapist, that he lifted a carton.", "Tom Ellis"),
    "At the initial assessment on 09/06/2026, Mr Brooks told me that he lifted a carton.",
    "the patient's own 'he lifted' is not touched",
  );
  assert.equal(
    rewriteInFirstPerson("Sarah Reid recorded her assessment that the presentation was consistent with WAD II.", "Sarah Reid"),
    "I recorded my assessment that the presentation was consistent with WAD II.",
  );
  assert.equal(rewriteInFirstPerson("On 08/04/2026 Tom Ellis recorded no abnormality.", "Sarah Reid"), "On 08/04/2026 Tom Ellis recorded no abnormality.", "other clinicians stay named");
});

test("only paragraphs that cite the author's own notes are candidates", () => {
  const bundle = {
    notes: [
      { id: "N-001", author: { name: "Sarah Reid", hcpc: "PH-DEMO-01" } },
      { id: "N-002", author: { name: "Tom Ellis", hcpc: "PH-DEMO-02" } },
    ],
  } as unknown as Parameters<typeof isOwnVoiceCandidate>[1];
  assert.equal(isOwnVoiceCandidate({ text: "Sarah Reid recorded X.", sourceIds: ["N-001", "FACT-age"], origin: "ai" }, bundle, "Sarah Reid"), true);
  assert.equal(isOwnVoiceCandidate({ text: "Sarah Reid and Tom Ellis recorded X.", sourceIds: ["N-001", "N-002"], origin: "ai" }, bundle, "Sarah Reid"), false);
  assert.equal(isOwnVoiceCandidate({ text: "Sarah Reid recorded X.", sourceIds: ["N-001"], origin: "clinician" }, bundle, "Sarah Reid"), false);
});

test("note shorthand becomes plain words, numbers kept", () => {
  assert.equal(expandNoteShorthand("Gym 2–3x/wk; HEP 3x/wk; drives 1 hr; avoid lifting >15 kg; for HR/OH."), "Gym 2–3 times a week; home exercise programme 3 times a week; drives 1 hour; avoid lifting more than 15 kg; for HR and occupational health.");
  assert.equal(expandNoteShorthand("rest 2 hrs, 10 min walks, review in 6 wks"), "rest 2 hours, 10 minutes walks, review in 6 weeks");
  assert.equal(expandNoteShorthand("a 1-hour drive, NPRS 2/10, 10 x 2/day"), "a 1-hour drive, Numeric Pain Rating Scale 2/10, 10 x 2/day");
});

test("clinical abbreviations are written out; references, spinal levels and well-known ones are not", () => {
  assert.equal(
    expandNoteShorthand("Occasional neck ache (NPRS 2/10 at worst). AROM full. HEP continued; minimal TTP."),
    "Occasional neck ache (Numeric Pain Rating Scale 2/10 at worst). Active range of movement full. Home exercise programme continued; minimal tenderness on palpation.",
  );
  assert.equal(expandNoteShorthand("following an RTA on 12/03/2026, consistent with WAD II"), "following a road traffic accident on 12/03/2026, consistent with whiplash-associated disorder grade II");
  assert.equal(expandNoteShorthand("An ODI of 18% and a NDI of 12%."), "An Oswestry Disability Index of 18% and a Neck Disability Index of 12%.");
  assert.equal(expandNoteShorthand("The Neck Disability Index (NDI) improved; mechanical LBP."), "The Neck Disability Index improved; mechanical low back pain.");
  // Left alone: references, spinal levels, GP/HR/HCPC, words that merely contain an abbreviation.
  for (const keep of ["Reference HP/RTA/2291 and KCM-RTW-01.", "Mobilisations at L4–L5 and C3/4.", "Seen by the GP; HR informed; HCPC PH-DEMO-01.", "ROMAN, NADINE, LOCAL, HEPATIC", "AF-OH-0457"]) {
    assert.equal(expandNoteShorthand(keep), keep);
  }
});

test("job titles take the casing the record uses", () => {
  const bundle = { clinicians: [{ name: "Tom Ellis", hcpc: "PH-DEMO-02", role: "Physiotherapist, MCSP" }], notes: [] } as unknown as Parameters<typeof normaliseJobTitles>[1];
  assert.equal(normaliseJobTitles("On 22/09/2026 Tom Ellis, physiotherapist, recorded…", bundle), "On 22/09/2026 Tom Ellis, Physiotherapist, recorded…");
});

test("an abbreviation followed by its own full form in brackets is written out once, in either order", () => {
  assert.equal(
    expandNoteShorthand("Treatment included SNAGs (sustained natural apophyseal glides) and STM."),
    "Treatment included sustained natural apophyseal glides and soft tissue mobilisation.",
  );
  assert.equal(expandNoteShorthand("A worst NPRS (Numeric Pain Rating Scale) score of 6/10."), "A worst Numeric Pain Rating Scale score of 6/10.");
  assert.equal(expandNoteShorthand("NPRS (numeric pain rating scale) was 6/10."), "Numeric pain rating scale was 6/10.", "capitalised at a sentence start");
  assert.equal(expandNoteShorthand("A worst numeric pain rating scale (NPRS) score of 6/10."), "A worst numeric pain rating scale score of 6/10.");
  assert.equal(expandNoteShorthand("Assessed as WAD II (whiplash-associated disorder grade II)."), "Assessed as whiplash-associated disorder grade II.");
  assert.equal(expandNoteShorthand("Assessed as WAD II (whiplash-associated disorder)."), "Assessed as whiplash-associated disorder grade II.");
  assert.equal(expandNoteShorthand("Neck Disability Index (NDI) 42% and ODI (Oswestry Disability Index) 30%."), "Neck Disability Index 42% and Oswestry Disability Index 30%.");
  // A bracket that is not the abbreviation's own full form is kept, and the abbreviation written out.
  assert.equal(expandNoteShorthand("NDI (42% at the first visit) fell."), "Neck Disability Index (42% at the first visit) fell.");
});

test("record IDs in drafted text are replaced by the note's date or the fact's name", () => {
  const names = {
    notes: [
      { id: "N-001", date: "2026-06-09" },
      { id: "N-002", date: "2026-06-16" },
      { id: "N-007", date: "2026-08-01" },
      { id: "N-010", date: "2026-09-22" },
    ],
    facts: [
      { id: "FACT-attendance", label: "Attendance" },
      { id: "FACT-outcomes-NDI", label: "NDI – Neck Disability Index" },
    ],
  };
  assert.equal(
    describeSourceIds("Advice such as breaks every 30–45 minutes in N-010, and posture breaks every 30 minutes with a raised screen in N-001.", names),
    "Advice such as breaks every 30–45 minutes in the note of 22/09/2026, and posture breaks every 30 minutes with a raised screen in the note of 09/06/2026.",
  );
  assert.equal(describeSourceIds("No opinion was recorded. N-010 records only that he was working.", names), "No opinion was recorded. The note of 22/09/2026 records only that he was working.");
  assert.equal(describeSourceIds("The final review (N-010) records his symptoms.", names), "The final review (22/09/2026) records his symptoms.");
  assert.equal(describeSourceIds("Scores fell between N-002..N-007 (N-002–N-007).", names), "Scores fell between the notes of 16/06/2026 and 01/08/2026 (16/06/2026 to 01/08/2026).");
  assert.equal(describeSourceIds("See the N-010 note, the FACT-attendance figures and REG.", names), "See the note of 22/09/2026, the attendance figures and the registration record.");
  // References, unknown IDs and text without IDs are left as written.
  for (const keep of ["Ref HP/RTA/2291, AF-OH-0457, KCM-RTW-01.", "N-099 is not in this record.", "No IDs here."]) assert.equal(describeSourceIds(keep, names), keep);
});

test("a bracket that only repeats the words before it is dropped (\"8 wks (8 weeks)\" once written out)", () => {
  assert.equal(expandNoteShorthand("4 further sessions, fortnightly over 8 wks (8 weeks)."), "4 further sessions, fortnightly over 8 weeks.");
  assert.equal(expandNoteShorthand("over 8 weeks (8 wks)"), "over 8 weeks");
  assert.equal(collapseRepeatedBrackets("consent to share with the insurer (the insurer)"), "consent to share with the insurer");
  assert.equal(collapseRepeatedBrackets("Numeric Pain Rating Scale (numeric  pain rating scale) 4/10"), "Numeric Pain Rating Scale 4/10");
  // Only a whole-word repeat.
  assert.equal(collapseRepeatedBrackets("over 18 weeks (8 weeks)"), "over 18 weeks (8 weeks)");
  assert.equal(collapseRepeatedBrackets("Kents Hill Medical Practice (fictional)"), "Kents Hill Medical Practice (fictional)");
  assert.equal(collapseRepeatedBrackets("pain (7/10), then 4/10 (01/10/2026)"), "pain (7/10), then 4/10 (01/10/2026)");
});

test("names the record labels \"(fictional)\" keep the label in drafted wording", () => {
  const names = fictionalNames([
    "GP referral (Dr A Forsyth, Kents Hill Medical Practice (fictional), letter dated 26/08/2026).",
    "Harrow & Pike Solicitors (fictional)",
    "Ashby Freight Ltd (fictional)",
    "Other (fictional)",
  ]);
  assert.deepEqual(names, ["Kents Hill Medical Practice", "Harrow & Pike Solicitors", "Ashby Freight Ltd"], "two or more capitalised words, longest first");
  assert.equal(
    keepFictionalLabels("Dr A Forsyth, GP, Kents Hill Medical Practice, referred Mrs Lane; his employer, Ashby Freight Ltd. Harrow & Pike Solicitors instructed.", names),
    "Dr A Forsyth, GP, Kents Hill Medical Practice (fictional), referred Mrs Lane; his employer, Ashby Freight Ltd (fictional). Harrow & Pike Solicitors (fictional) instructed.",
  );
  // Already labelled, a possessive, or part of a longer word: unchanged.
  for (const text of ["Kents Hill Medical Practice (fictional) wrote.", "Kents Hill Medical Practice's letter.", "Ashby Freight Ltds"]) {
    assert.equal(keepFictionalLabels(text, names), text);
  }
  assert.deepEqual(fictionalNames(["Kents Hill Medical Practice"]), [], "a real record holds none: nothing changes");
});
