/**
 * bh2 WF (AC-CPY-1, DoC-1 C11): the guide terms check (scripts/medreport/guide-terms-check.mjs). The real guide and
 * welcome pack are gitignored, so the check is pinned here on a small guide written for the test in ClinForms' own words,
 * and on this tree's own screen words and source chips. With CLINFORMS_WELCOME_DIR set (the integrator, at release) the
 * real welcome pack is checked too.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { hasBannedTerm } from "@/modules/medreport/core/wording";
import {
  REQUIRED_STEPS,
  checkGuide,
  checkPack,
  greyBoxTerms,
  guideParts,
  hasWords,
  loadUi,
  normalise,
  privateLinks,
  quotedTerms,
  termFragments,
  termOnScreen,
  uiCorpus,
  withoutComments,
} from "./guide-terms-check.mjs";

const ui = (t: string, cls = "") => `<span class="ui${cls ? ` ${cls}` : ""}">${t}</span>`;

/** A two-row source table and five steps, in the shape of the welcome guide. */
function guide(opts: { chips?: string[]; steps?: string[]; extra?: string } = {}): string {
  const chips = opts.chips ?? ["Drafted from notes", "Entered by staff"];
  const steps = opts.steps ?? [
    `Choose the form and the physio who will approve it, then click ${ui("Complete this form")}.`,
    `Optional boxes: ${ui("Leave optional boxes blank…")} in one step.`,
    `What staff type in a physio's box is marked ${ui("Entered by staff")}. It counts once the approving physio clicks ${ui("Adopt")}. Staff then see ${ui("Ready for a signing clinician", "teal wrap")}.`,
  ];
  return [
    "<!doctype html><html><head><style>.ui { color: red }</style></head><body>",
    `<p>Words in grey boxes, such as ${ui("Members")}, are on screen. ${opts.extra ?? ""}</p>`,
    `<table class="sources"><tbody>${chips.map((c) => `<tr><td>${ui(c)}</td><td>What it means.</td></tr>`).join("")}</tbody></table>`,
    `<section aria-labelledby="s5"><h2 id="s5">Complete a report</h2><ol class="steps">${steps.map((s) => `<li>${s}</li>`).join("")}</ol></section>`,
    "</body></html>",
  ].join("\n");
}

const SOURCE = [
  `export const LABELS = { a: "Members", b: "Complete this form", c: "Ready for a signing clinician: staff prepare forms." };`,
  `// "Adopted" only in a comment\n/* Ready for your approval */`,
  `export function Card() { return <button>Leave optional boxes blank…</button>; }`,
  `const x = <p>Entered by staff{" "}<b>Adopt</b> Drafted from notes</p>; const url = "https://clinforms.co.uk/login";`,
];
const CORPUS = uiCorpus(SOURCE);
const UI = { corpus: CORPUS, chips: ["Drafted from notes", "Entered by staff"], hasBannedTerm };

describe("guide terms check – reading the guide", () => {
  it("finds every grey-box term (classes, nested markup, entities) and the run-time parts it declares", () => {
    const terms = greyBoxTerms(`${ui("Patient&apos;s <b>record</b>", "amber wrap")} <span class="ui teal" data-ui-parts="Trial –|left.">Trial – 3 days left.</span> <span class="uix">no</span>`);
    assert.deepEqual(terms, [
      { text: "Patient's record", parts: null },
      { text: "Trial – 3 days left.", parts: ["Trial –", "left."] },
    ]);
    const g = guideParts(guide());
    assert.deepEqual(g.sourceTerms, ["Drafted from notes", "Entered by staff"]);
    assert.equal(g.steps.length, 3);
    assert.deepEqual(g.steps[2].terms, ["Entered by staff", "Adopt", "Ready for a signing clinician"]);
    assert.doesNotMatch(g.text, /color: red/, "styles are not text");
  });

  it("a term filled at run time is checked by its fixed fragments: numbers and '…' are placeholders", () => {
    assert.deepEqual(termFragments({ text: "Invitation emailed to …", parts: null }), ["Invitation emailed to"]);
    assert.deepEqual(termFragments({ text: "Page 2 of 3", parts: null }), ["Page", "of"].filter((f) => f.length >= 3));
    assert.deepEqual(termFragments({ text: "x", parts: ["Trial –", "left."] }), ["Trial –", "left."]);
  });
});

describe("guide terms check – the screen's words", () => {
  it("reads string literals and JSX text, never comments; a URL is kept", () => {
    assert.equal(withoutComments('const u = "https://x.test"; // note'), 'const u = "https://x.test";  ');
    assert.ok(hasWords(CORPUS, "Leave optional boxes blank…"));
    assert.ok(hasWords(CORPUS, "Entered by staff Adopt"), 'JSX {" "} is a space');
    assert.equal(hasWords(CORPUS, "Ready for your approval"), false, "only in a comment");
    assert.equal(hasWords(CORPUS, "Adopted"), false, "only in a comment");
    assert.ok(hasWords(CORPUS, "https://clinforms.co.uk/login"));
  });

  it("matches whole words only: 'Adopt' is not found inside 'Adopted …'", () => {
    const corpus = uiCorpus([`const label = "Adopted by the approving clinician";`]);
    assert.equal(termOnScreen({ text: "Adopt", parts: null }, corpus), false);
    assert.equal(termOnScreen({ text: "Adopted", parts: null }, corpus), true);
    assert.equal(normalise("the note’s  words…"), "the note's words…");
  });
});

describe("guide terms check – the checks", () => {
  it("a guide that matches the screen passes", () => {
    const out = checkGuide(guide(), UI);
    assert.deepEqual(out.problems, []);
    assert.equal(out.terms, 7);
  });

  it("names a grey-box term the screen does not show, a chip the source table leaves out and a step that is missing", () => {
    const out = checkGuide(
      guide({
        chips: ["Drafted from notes"],
        steps: [`Click ${ui("Complete this form")}.`, `Then ${ui("Approve and send")}.`],
      }),
      UI,
    );
    const kinds = out.problems.map((p: { kind: string; term?: string }) => `${p.kind}:${p.term ?? ""}`);
    assert.ok(kinds.includes("term-not-on-screen:Approve and send"), kinds.join(", "));
    assert.ok(kinds.includes("chip-not-in-source-table:Entered by staff"));
    for (const req of REQUIRED_STEPS) assert.ok(kinds.includes(`step-missing:${req.id}`), req.id);
  });

  it("refuses AI, model or vendor names anywhere in the guide", () => {
    const out = checkGuide(guide({ extra: "Answers are drafted by Claude." }), UI);
    assert.ok(out.problems.some((p: { kind: string }) => p.kind === "banned-term"));
  });

  it("the welcome pack: the PDF printed from this guide, an email with no private link and the business contact, fictional notes", () => {
    const terms = guideParts(guide()).terms;
    const pdfText = guideParts(guide()).text;
    const email = 'From: khuram@appstackx.co.uk\nSign in at https://clinforms.co.uk/login. Click "Members".\n[PASTE THE OWNER INVITATION LINK HERE]';
    const base = { guideTerms: terms, pdfText, email, readMe: 'Choose "Complete this form".', sampleNoteNames: ["About-these-sample-notes.txt", "Fictional-patient-1-notes.txt"], sampleNoteTexts: {}, guideMtime: 1, pdfMtime: 2 };
    assert.deepEqual(checkPack(base, UI), []);
    const bad = checkPack(
      {
        ...base,
        pdfText: "Members only",
        pdfMtime: 0,
        email: 'From: someone@gmail.com\nYour link: https://clinforms.co.uk/accept-invite?token=abc123 and "Press go"',
        sampleNoteNames: ["Real-patient.txt"],
      },
      UI,
    ).map((p: { kind: string }) => p.kind);
    for (const kind of ["pdf-out-of-date", "pdf-older-than-guide", "email-private-link", "email-personal-address", "email-not-from-business-address", "quoted-term-not-on-screen", "sample-notes-not-marked-fictional"]) {
      assert.ok(bad.includes(kind), kind);
    }
    assert.deepEqual(privateLinks("See https://clinforms.co.uk and https://appstackx.co.uk/ – not https://example.test/x"), ["https://example.test/x"]);
    assert.deepEqual(quotedTerms('Click "Use these notes", then "Use these notes" again.'), ["Use these notes"]);
  });
});

describe("guide terms check – this tree", () => {
  it("the source chips a clinic's Studio shows, read from the code's labels, and the screen words the steps rely on", async () => {
    const tree = await loadUi();
    assert.deepEqual([...tree.chips].sort(), [
      "Calculated from records",
      "Chosen by the physiotherapist",
      "Clinician opinion",
      "Drafted from notes",
      "Entered by staff",
      "Fixed answer",
      "From appointments",
      "From the patient record",
      "From your Clinic details",
      "Leave blank",
      "Sign-off",
    ]);
    for (const words of ["Leave optional boxes blank…", "Ready for a signing clinician", "Complete this form", "Approve…", "Approve and sign", "Check the notes before they are used", "Members"]) {
      assert.ok(hasWords(tree.corpus, words), words);
    }
  });

});

// The real welcome pack is gitignored: checked only when CLINFORMS_WELCOME_DIR points at it (the integrator's release
// check). Without the variable no test is registered – the default chain allows no extra skips.
const WELCOME = process.env.CLINFORMS_WELCOME_DIR;
if (!WELCOME) console.log("guide terms check on the welcome pack: not run (set CLINFORMS_WELCOME_DIR to the welcome folder)");
if (WELCOME) describe("guide terms check – the real welcome pack (env-gated)", () => {
  it("the guide matches the screen, its source table and its steps", async () => {
    const tree = await loadUi();
    const out = checkGuide(fs.readFileSync(path.join(WELCOME, "guide.html"), "utf8"), tree);
    assert.deepEqual(out.problems, []);
  });
});
