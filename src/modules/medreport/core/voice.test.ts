/**
 * Wording helpers (core/voice.ts): the signing clinician's own notes in the first person, note
 * shorthand in plain words, job titles as the record gives them – numbers and dates untouched.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { collapseRepeatedBrackets, describeSourceIds, expandNoteShorthand, fictionalNames, inOwnClinicalWording, isOwnVoiceCandidate, keepFictionalLabels, normaliseJobTitles, plainClinicalWording, rewriteInFirstPerson } from "./voice";

test("the signer's recorded opinion becomes their own voice", () => {
  assert.equal(
    rewriteInFirstPerson("On 22/09/2026 Tom Ellis, physiotherapist, recorded that in his opinion Mr Brooks is fit for a phased return to normal duties over 2 weeks.", "Tom Ellis"),
    "On 22/09/2026 I recorded that, in my opinion, Mr Brooks is fit for a phased return to normal duties over 2 weeks.",
  );
  assert.equal(
    rewriteInFirstPerson("At the final review on 07/07/2026, Sarah Reid, Senior Physiotherapist, assessed residual intermittent low-level neck ache. She recorded advice to take workstation breaks every 30–45 minutes.", "Sarah Reid"),
    // bh2 WB design 11 (C-1): only the owner's own name changes – "She recorded" is never taken as the owner.
    "At my final review on 07/07/2026, I assessed residual intermittent low-level neck ache. She recorded advice to take workstation breaks every 30–45 minutes.",
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

test("the signer's own record reads as clinical statements, not record-keeping (\"On 01/10/2026 I recorded that…\")", () => {
  const cases: Array<[string, string]> = [
    ["On 01/10/2026 I recorded that 1 pre-authorised session remained (booked 15/10/2026) and that I had made a further treatment request.", "On 01/10/2026, 1 pre-authorised session remained (booked 15/10/2026) and I had made a further treatment request."],
    ["On 01/10/2026 I recorded the clinical reason as follows: Mrs Lane was improving with progressive exercise (PSFS 5.3).", "Mrs Lane was improving with progressive exercise (PSFS 5.3)."],
    ["On 01/09/2026 I recorded an assessment of right rotator cuff related shoulder pain following a lifting strain on 22/08/2026.", "Assessment on 01/09/2026: right rotator cuff related shoulder pain following a lifting strain on 22/08/2026."],
    ["At the initial assessment on 01/09/2026 I recorded my assessment of the condition being treated as right shoulder pain.", "Assessment on 01/09/2026: right shoulder pain."],
    ["I recorded the goals for the further sessions as: front crawl for 20 minutes; lift a box.", "Goals for the further sessions: front crawl for 20 minutes; lift a box."],
    ["On 01/10/2026 I recorded goals for the further sessions: front crawl for 20 minutes.", "Goals for the further sessions: front crawl for 20 minutes."],
    ["I recorded the guideline followed as the BESS/BOA pathway.", "Guideline followed: the BESS/BOA pathway."],
    ["On 01/10/2026 I recorded a further treatment request to Bupa for 4 further sessions, fortnightly over 8 weeks.", "Further treatment requested on 01/10/2026: 4 further sessions, fortnightly over 8 weeks."],
    ["On 01/09/2026 I recorded in the past medical history hypothyroidism, stable. I also recorded no previous shoulder problems.", "Past medical history: hypothyroidism, stable. No previous shoulder problems."],
    ["On 01/10/2026 I recorded the shoulder as improving: QuickDASH 52.3 to 29.5.", "On 01/10/2026, the shoulder was improving: QuickDASH 52.3 to 29.5."],
    ["On 01/09/2026 I recorded Mrs Lane's medication as ibuprofen 400 mg.", "On 01/09/2026, Mrs Lane's medication was ibuprofen 400 mg."],
    ["At my latest review on 01/10/2026 I recorded right shoulder active range of movement as flexion 155°.", "At my latest review on 01/10/2026, right shoulder active range of movement was flexion 155°."],
    ["On 01/09/2026 I recorded right shoulder active range of movement: flexion 120°, abduction 95°.", "Right shoulder active range of movement on 01/09/2026: flexion 120°, abduction 95°."],
    ["On 01/10/2026 I recorded QuickDASH 29.5 and a painful arc 120–150°.", "On 01/10/2026: QuickDASH 29.5 and a painful arc 120–150°."],
    ["On 24/09/2026 I recorded advice to carry loads close to the body.", "On 24/09/2026, advice was given to carry loads close to the body."],
    ["On 01/09/2026 I recorded that she provided education on load management.", "On 01/09/2026, I provided education on load management."],
    ["On 01/09/2026 I recorded an assessment of shoulder pain, and on 01/10/2026 I recorded the assessment as shoulder pain, improving.", "Assessment on 01/09/2026: shoulder pain, and on 01/10/2026 the assessment was shoulder pain, improving."],
    ["On 22/09/2026 I recorded that, in my opinion, Mr Brooks is fit for a phased return to normal duties over 2 weeks.", "On 22/09/2026, in my opinion, Mr Brooks is fit for a phased return to normal duties over 2 weeks."],
    ["I recorded my assessment that the presentation was consistent with WAD II.", "In my assessment, the presentation was consistent with WAD II."],
    // Fix round 1 (B0-23), seen on an approved Proclaim final report: no dangling "and that" after the rewrite.
    [
      "On 16/09/2026 I recorded that, in my opinion, the remaining occasional stiffness should settle within 4–6 weeks with his home exercise programme, and that no further treatment is needed.",
      "On 16/09/2026, in my opinion, the remaining occasional stiffness should settle within 4–6 weeks with his home exercise programme, and no further treatment is needed.",
    ],
    [
      "On 16/09/2026 I recorded my opinion that the remaining stiffness should settle within 4–6 weeks, and that no further treatment is needed.",
      "On 16/09/2026, in my opinion, the remaining stiffness should settle within 4–6 weeks, and no further treatment is needed.",
    ],
  ];
  for (const [input, expected] of cases) {
    assert.equal(plainClinicalWording(input), expected, input);
    assert.equal(plainClinicalWording(expected), expected, `idempotent: ${expected}`);
  }
  // Untouched: another clinician's attribution, the patient's report, text with no "I recorded".
  for (const keep of ["On 08/04/2026 Tom Ellis recorded no abnormality.", "Mrs Lane reported pain of 4/10 at worst.", "At my review on 01/10/2026, Mrs Lane told me she was swimming."]) {
    assert.equal(plainClinicalWording(keep), keep);
  }
});

test("\"Write in my own voice\" gives plain clinical wording, including a paragraph that only says \"she recorded\"", () => {
  assert.equal(
    inOwnClinicalWording("On 01/10/2026 Sarah Reid, physiotherapist, recorded a further treatment request to Bupa for 4 further sessions. She recorded the goals for the further sessions as: front crawl.", "Sarah Reid"),
    // bh2 WB design 11 (C-1): "She recorded" stays as written (the pronoun may be a colleague or a GP).
    "Further treatment requested on 01/10/2026: 4 further sessions. She recorded the goals for the further sessions as: front crawl.",
  );
  const pronounOnly = "On 01/10/2026 she recorded the shoulder as improving, and Mrs Lane's goals not yet met.";
  assert.equal(inOwnClinicalWording(pronounOnly, "Sarah Reid"), pronounOnly, "without the pronoun option a paragraph that does not name the author is left alone");
  assert.equal(inOwnClinicalWording(pronounOnly, "Sarah Reid", { pronouns: true }), pronounOnly, "bh2 (C-1): the pronoun option changes nothing");
  assert.equal(inOwnClinicalWording("She reported pain on 01/10/2026.", "Sarah Reid", { pronouns: true }), "She reported pain on 01/10/2026.", "the patient's own report is not the clinician's");

  const bundle = { notes: [{ id: "N-004", author: { name: "Sarah Reid" } }, { id: "N-005", author: { name: "Sarah Reid" } }, { id: "N-009", author: { name: "Tom Ellis" } }] } as unknown as Parameters<typeof isOwnVoiceCandidate>[1];
  assert.equal(isOwnVoiceCandidate({ text: pronounOnly, sourceIds: ["N-004", "N-005"], origin: "ai" }, bundle, "Sarah Reid"), false);
  assert.equal(isOwnVoiceCandidate({ text: pronounOnly, sourceIds: ["N-004", "N-005"], origin: "ai" }, bundle, "Sarah Reid", { pronouns: true }), false, "bh2 (C-1)");
  assert.equal(isOwnVoiceCandidate({ text: "On 01/10/2026 I recorded that X.", sourceIds: ["N-005"], origin: "ai" }, bundle, "Sarah Reid", { pronouns: true }), true, "a first-person draft");
  assert.equal(isOwnVoiceCandidate({ text: pronounOnly, sourceIds: ["N-009"], origin: "ai" }, bundle, "Sarah Reid", { pronouns: true }), false, "another clinician's note");
});

test("fix wave 2: speaksInFirstPerson – I / me / my outside quotations; numerals are not the first person", async () => {
  const { speaksInFirstPerson } = await import("./voice");
  assert.equal(speaksInFirstPerson("On 10/04/2026 I recorded that her neck had improved."), true);
  assert.equal(speaksInFirstPerson("At my final review she was discharged."), true);
  assert.equal(speaksInFirstPerson("She told me she was driving again."), true);
  assert.equal(speaksInFirstPerson("Sarah Reid recorded a WAD I presentation and a Grade I strain."), false);
  assert.equal(speaksInFirstPerson("She said “my neck is stiff in the mornings”."), false);
  assert.equal(speaksInFirstPerson('She said "I cannot lift the kettle".'), false);
  assert.equal(speaksInFirstPerson("Type I-II changes were not recorded."), false);
});

test("fix wave 2: otherClinicianVoice – only unedited drafted answers in the author's voice, only for another signer", async () => {
  const { otherClinicianVoice, sameClinician } = await import("./voice");
  const para = (text: string, origin: "ai" | "edited" | "from_records" = "ai") => ({ id: `p-${text.length}`, text, sourceIds: ["N-001"], origin });
  const report = {
    author: { name: "Sarah Reid", hcpc: "PH-DEMO-01" },
    sections: [
      { key: "F-07", paragraphs: [para("On 10/04/2026 I recorded that she was improving.")] },
      { key: "F-08", paragraphs: [para("Tom Ellis recorded full movement.")] },
      { key: "F-09", paragraphs: [para("I progressed her exercises.", "edited")] },
    ],
  } as unknown as Parameters<typeof otherClinicianVoice>[0];
  assert.deepEqual(otherClinicianVoice(report, { name: "Sam Patel", hcpc: "PH123456" }), { author: "Sarah Reid", keys: ["F-07"] });
  assert.equal(otherClinicianVoice(report, { name: "S. Reid", hcpc: "ph-demo-01" }), null, "same HCPC: the author");
  assert.equal(otherClinicianVoice(report, { name: "sarah  reid" }), null, "no HCPC: same name");
  assert.equal(otherClinicianVoice({ ...report, author: undefined } as typeof report, { name: "Sam Patel", hcpc: "PH123456" }), null, "third-person drafts");
  assert.equal(sameClinician({ name: "A", hcpc: "X1" }, { name: "A", hcpc: "X2" }), false);
});

/* Fix round 1 (B0-1): another physio's notes and opinions in the approver's first person. */

const TOM_ONLY = {
  notes: [
    { id: "N-001", author: { name: "Tom Ellis", hcpc: "PH-DEMO-02" } },
    { id: "N-005", author: { name: "Tom Ellis", hcpc: "PH-DEMO-02" } },
  ],
} as unknown as Parameters<typeof import("./voice").otherCliniciansInFirstPerson>[1];
const SARAH = { name: "Sarah Reid", hcpc: "ZZ0001" };

test("fix round 1: otherCliniciansInFirstPerson – 'I' / 'me' / 'my' citing another clinician's note", async () => {
  const { otherCliniciansInFirstPerson } = await import("./voice");
  const p = (text: string, sourceIds = ["N-001"]) => ({ text, sourceIds });
  // Gemma Whitlock's notes are all Tom Ellis's; Sarah Reid signs.
  for (const text of [
    "Mrs Whitlock told me that she saw her GP on 03/09/2026.",
    "My assessment on 08/09/2026 was acute non-specific (mechanical) low back pain.",
    "In my opinion, she should be able to return to full duties, including 12-hour shifts, within 4 weeks.",
    "I also advised ice and compression.",
  ]) {
    assert.deepEqual(otherCliniciansInFirstPerson(p(text), TOM_ONLY, SARAH), ["Tom Ellis"], text);
  }
  const mine = { notes: [{ id: "N-001", author: { name: "Sarah Reid", hcpc: "ZZ0001" } }, { id: "N-004", author: { name: "Tom Ellis", hcpc: "PH-DEMO-02" } }] } as typeof TOM_ONLY;
  assert.equal(otherCliniciansInFirstPerson(p("Mr Ellery told me that driving was uncomfortable."), mine, SARAH), null, "the signer's own note");
  assert.equal(otherCliniciansInFirstPerson(p("Tom Ellis, physiotherapist, recorded that she told him it eased."), TOM_ONLY, SARAH), null, "third person");
  assert.equal(otherCliniciansInFirstPerson(p("She said “my back aches by the end of the shift”."), TOM_ONLY, SARAH), null, "a quotation from the note");
  // The signer's notes and another's together: fine while the other clinician is named.
  // bh2 WB design 7 (C-ATTR-3, lic-1/lic-2): the first person on drafted text only when every cited note is the owner's.
  // bh2 fix round 1 (R1T-WB-09, Khuram's E7/E8 decision of 26/10/2026): the first person clause by clause – the owner's
  // own clause beside Tom Ellis named in the third person is licensed; an "I" over a date only Tom's note has is not.
  assert.equal(otherCliniciansInFirstPerson(p("I repeated soft tissue release on 22/07/2026, and Tom Ellis, physiotherapist, recorded it on 05/08/2026.", ["N-001", "N-004"]), mine, SARAH), null);
  assert.deepEqual(otherCliniciansInFirstPerson(p("I repeated soft tissue release on 22/07/2026 and on 05/08/2026.", ["N-001", "N-004"]), { notes: [{ ...mine.notes[0], date: "2026-07-22" }, { ...mine.notes[1], date: "2026-08-05" }] } as typeof TOM_ONLY, SARAH), ["Tom Ellis"]);
  // No signing author: nothing is anyone's "I".
  assert.deepEqual(otherCliniciansInFirstPerson(p("Mr Ellery told me that driving was uncomfortable."), mine, null), ["Sarah Reid"]);
  assert.equal(otherCliniciansInFirstPerson(p("7 appointments were attended, and I was told of none missed.", ["FACT-attendance"]), TOM_ONLY, SARAH), null, "no note cited");
});

test("fix round 1: nameClinicianInstead – the inverse of the first-person rewrite, or null", async () => {
  const { nameClinicianInstead } = await import("./voice");
  assert.equal(nameClinicianInstead("Mrs Whitlock told me that she saw her GP on 03/09/2026.", "Tom Ellis"), "Mrs Whitlock told Tom Ellis that she saw her GP on 03/09/2026.");
  assert.equal(
    nameClinicianInstead("My assessment on 08/09/2026 was acute non-specific (mechanical) low back pain following a moving and handling incident at work on 01/09/2026.", "Tom Ellis"),
    "Tom Ellis's assessment on 08/09/2026 was acute non-specific (mechanical) low back pain following a moving and handling incident at work on 01/09/2026.",
  );
  assert.equal(
    nameClinicianInstead("On 13/10/2026, in my opinion, she should be able to return to full duties within 4 weeks. I requested 3 further sessions.", "Tom Ellis"),
    null,
    "bh2 WB design 10 (B2-1): never with the owner's own-opinion wording",
  );
  assert.equal(nameClinicianInstead("She said “my back aches”, and I advised heat.", "Tom Ellis"), "She said “my back aches”, and Tom Ellis advised heat.", "quotations untouched");
  assert.equal(nameClinicianInstead("He was graded WAD I and I advised rest.", "Tom Ellis"), "He was graded WAD I and Tom Ellis advised rest.", "a numeral stays");
  assert.equal(nameClinicianInstead("I'm told she improved.", "Tom Ellis"), null, "a contraction: rewritten by hand");
  assert.equal(nameClinicianInstead("Tom Ellis recorded full movement.", "Tom Ellis"), null, "nothing to change");
  // Already named: the "my" may be the signer's own ("covered my leave") – rewriting it would make it false.
  assert.equal(
    nameClinicianInstead("On 05/08/2026 Tom Ellis, physiotherapist, covered my leave and recorded mobilisations and soft tissue release.", "Tom Ellis"),
    null,
    "the clinician is named already: rewritten by hand",
  );
});

test("fix round 1 (B0-23): gap wording names whose note it is – never “my note” or “your note”", async () => {
  const { notesNamedByAuthor } = await import("./voice");
  const notes = [
    { date: "2026-07-15", author: { name: "Sarah Reid" } },
    { date: "2026-08-05", author: { name: "Tom Ellis" } },
    { date: "2026-09-16", author: { name: "Sarah Reid" } },
  ];
  assert.equal(
    notesNamedByAuthor("Your discharge note of 16/09/2026 says the stiffness should settle within 4–6 weeks.", notes),
    "Sarah Reid's discharge note of 16/09/2026 says the stiffness should settle within 4–6 weeks.",
  );
  assert.equal(notesNamedByAuthor("What did my note of 05/08/2026 record?", notes), "What did Tom Ellis's note of 05/08/2026 record?", "the note's own author, by its date");
  assert.equal(notesNamedByAuthor("Your notes do not record a dose. Check my initial assessment note.", notes), "The notes do not record a dose. Check the initial assessment note.", "no date: “the”");
  assert.equal(notesNamedByAuthor("She said “my notes from the gym say so”.", notes), "She said “my notes from the gym say so”.", "quotations untouched");
  assert.equal(notesNamedByAuthor("Sarah Reid's note of 15/07/2026 records no dose.", notes), "Sarah Reid's note of 15/07/2026 records no dose.", "nothing to change");
  assert.equal(notesNamedByAuthor("Check your records for the date.", notes), "Check your records for the date.", "not a note");
  assert.equal(notesNamedByAuthor("Does your clinic have no notes of it?", notes), "Does your clinic have no notes of it?", "not someone's note");
});
