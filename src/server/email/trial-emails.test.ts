/**
 * The branded HTML layout (./layout.ts) and the self-serve trial's emails (./trial-templates.ts): every email renders
 * as email clients need it (tables, inline styles, max-width 600, no images or tracking, a plain-text twin), speaks for
 * the right brand, escapes what it is given, uses neutral wording, and only the tips-type emails carry "stop these
 * tips". The existing emails keep their words in the new layout. Run by npm run test:auth.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BANNED_TERM_PATTERNS } from "../../modules/medreport/core/wording";
import { TRIAL_EMAIL_KINDS, type TrialEmailKind } from "../../lib/trial";
import type { BrandId } from "../../lib/brand";
import { checkStopTips, stopTipsUrl } from "../trial/emails";
import { invitationEmail, passwordResetEmail, signupConfirmEmail } from "./templates";
import { trialEmail } from "./trial-templates";

const SECRET = "trial-email-secret-".padEnd(48, "e");

function render(kind: TrialEmailKind, brand: BrandId, clinicName = "Larkfield Physio (fictional)") {
  return trialEmail({
    kind,
    to: { email: "dana@larkfield-physio.example", name: "Dana Lark" },
    brand,
    clinicName,
    origin: brand === "clinic" ? "https://clindesk.co.uk" : "https://clinforms.co.uk",
    days: 14,
    endsAt: "2026-11-30T15:00:00.000Z",
    reportsIncluded: 10,
    reportsUsed: 3,
    textsGranted: brand === "clinic" ? 10 : 0,
    stopTipsUrl: "https://clindesk.co.uk/trial/stop-tips?c=larkfield&t=x",
    planName: null,
    daysToEnd: 1,
    deletionDay: "2027-03-01",
  });
}

describe("trial emails – content and structure", () => {
  for (const brand of ["clinic", "clinforms"] as const) {
    for (const kind of TRIAL_EMAIL_KINDS) {
      it(`${brand} · ${kind}: branded HTML for email clients + plain text, neutral wording`, () => {
        const m = render(kind, brand);
        assert.equal(m.kind, "trial");
        assert.equal(m.brand, brand === "clinic" ? "clinic" : undefined);
        const name = brand === "clinic" ? "ClinDesk" : "ClinForms";
        assert.match(m.subject, new RegExp(name));
        assert.doesNotMatch(`${m.subject}${m.text}${m.html}`, new RegExp(brand === "clinic" ? "ClinForms" : "ClinDesk"), "never the other brand");
        assert.match(m.html, /^<!doctype html>/);
        assert.match(m.html, /role="presentation"/);
        assert.match(m.html, /max-width:600px/);
        assert.match(m.html, /<!--\[if mso\]>/, "Outlook's fixed width");
        assert.doesNotMatch(m.html, /<img|<style|<script|https?:\/\/[^"]*\.(png|gif|jpg)|background-image/i, "no images, no style block, no tracking pixel");
        assert.ok(m.text.length > 200 && !/<[a-z]/i.test(m.text), "a plain-text twin");
        assert.match(m.text, /https:\/\/clin(desk|forms)\.co\.uk\/app\//);
        for (const t of [m.subject, m.text, m.html]) assert.equal(BANNED_TERM_PATTERNS.find((re) => re.test(t)), undefined, `${kind}: ${t.slice(0, 60)}`);
        assert.doesNotMatch(m.text, /coming soon/i);
        const tips = kind === "welcome" || kind === "tips";
        assert.equal(/Stop these tips emails/.test(m.html), tips, "unsubscribe on tips-type emails only");
        assert.equal(/Stop these tips emails/.test(m.text), tips);
      });
    }
  }
  it("escapes the clinic's name", () => {
    const m = render("welcome", "clinic", `<b onmouseover="x">Evil & Co</b>`);
    assert.doesNotMatch(m.html, /<b onmouseover/);
    assert.match(m.html, /&lt;b onmouseover=&quot;x&quot;&gt;Evil &amp; Co&lt;\/b&gt;/);
  });
  it("what each email says: the trial's facts", () => {
    assert.match(render("welcome", "clinic").text, /10 free reports[\s\S]*10 free test texts/);
    assert.doesNotMatch(render("welcome", "clinforms").text, /texts/);
    assert.match(render("four_days", "clinic").text, /Monday 30 November 2026 at 15:00 \(UK time\)[\s\S]*3 of 10 free reports used/);
    assert.match(render("last_day", "clinic").subject, /ends tomorrow/);
    assert.match(render("ended", "clinic").text, /Nothing has been deleted/);
    assert.doesNotMatch(render("ended", "clinic").text, /export/i, "never promises an export");
    assert.match(render("paid", "clinic").text, /everything you set up and recorded during it is kept/);
  });
  it("14/11/2026: no 'made-up patient details' line in any self-serve trial email; the tips no longer say made-up", () => {
    for (const brand of ["clinic", "clinforms"] as const) {
      for (const kind of TRIAL_EMAIL_KINDS) {
        const m = render(kind, brand);
        assert.doesNotMatch(`${m.subject}\n${m.text}\n${m.html}`, /made-up patient details|made-up notes|use made-up|made-up appointments|a made-up patient's/i, `${brand} ${kind}`);
      }
    }
    assert.match(render("welcome", "clinic").text, /A sample clinic with made-up patients/, "the sample clinic is still described as made-up (it is)");
  });
  it("14/11/2026: ended = kept for 90 days with the date (trial end 30 Nov 2026 → kept until 28 February 2027, deleted on 1 March); last day says 90 days", () => {
    for (const brand of ["clinic", "clinforms"] as const) {
      const ended = render("ended", brand);
      assert.match(ended.text, /Nothing has been deleted\. Your clinic's data is kept for 90 days, until Sunday 28 February 2027/);
      assert.match(ended.text, /deleted after those 90 days\. We will email you two weeks before/);
      assert.match(ended.subject, /has ended – your data is safe$/);
      assert.match(render("last_day", brand).text, /for 90 days after the trial you can still sign in/);
    }
  });
  it("14/11/2026: the deletion warning – the date, how to keep it (choose a plan), how to keep a copy (both brands)", () => {
    const desk = render("deletion_warning", "clinic");
    assert.equal(desk.subject, "Your ClinDesk trial clinic will be deleted on Monday 1 March 2027");
    assert.match(desk.text, /Larkfield Physio \(fictional\) and all of its records and files will be deleted permanently on Monday 1 March 2027\. Once they are deleted they cannot be restored\./);
    assert.match(desk.text, /To keep it: choose a plan by Sunday 28 February 2027 under Plan and billing/);
    assert.match(desk.text, /Export CSV on the Patients and Billing pages/);
    assert.match(desk.text, /Choose a plan: https:\/\/clindesk\.co\.uk\/app\/settings\/billing/);
    assert.match(desk.html, /#C4432B/, "ClinDesk's own colours");
    const forms = render("deletion_warning", "clinforms");
    assert.equal(forms.subject, "Your ClinForms trial clinic will be deleted on Monday 1 March 2027");
    assert.match(forms.text, /download the completed forms and reports you want to keep/);
    assert.doesNotMatch(forms.text, /Export CSV|Patients and Billing/);
    assert.match(forms.html, /#0D9488/, "ClinForms' teal");
    assert.doesNotMatch(forms.html, /Stop these tips/, "an account email: no unsubscribe");
  });
});

describe("the existing emails in the branded layout keep their words", () => {
  it("invitation, reset and sign-up link: same text as before, brand colours by brand", () => {
    const inv = invitationEmail({ to: { email: "a@b.example", name: "Sam" }, brand: "clinic", clinicName: "Larkfield (fictional)", role: "clinician", inviterName: "Dana", link: "https://clindesk.co.uk/accept-invite?t=1", expiresAt: "2026-11-23T15:00:00.000Z" });
    assert.match(inv.text, /^Hello Sam,\n\nDana has invited you to join Larkfield \(fictional\) on ClinDesk as Clinician\./);
    assert.match(inv.html, /#C4432B/, "ClinDesk's coral");
    assert.match(inv.html, /Accept the invitation/);
    assert.match(inv.html, /role="presentation"/);
    const reset = passwordResetEmail({ to: { email: "a@b.example" }, link: "https://clinforms.co.uk/r", expiresAt: "2026-11-23T15:00:00.000Z" });
    assert.match(reset.html, /#0D9488/, "ClinForms' teal");
    assert.match(reset.text, /Someone asked to reset the password of your ClinForms account/);
    const confirm = signupConfirmEmail({ to: { email: "a@b.example" }, brand: "clinic", clinicName: "C", link: "https://clindesk.co.uk/l", expiresAt: "2026-11-23T15:00:00.000Z" });
    assert.match(confirm.html, /Confirm and create my clinic/);
    for (const m of [inv, reset, confirm]) assert.doesNotMatch(m.html, /Stop these tips|Questions\? Reply/, "the transactional footer is unchanged");
  });
});

describe("stop-tips link", () => {
  it("is signed for one clinic", () => {
    const url = new URL(stopTipsUrl("https://clindesk.co.uk", SECRET, "larkfield-physio"));
    assert.equal(url.pathname, "/trial/stop-tips");
    const c = url.searchParams.get("c") ?? "";
    const t = url.searchParams.get("t") ?? "";
    assert.equal(checkStopTips(SECRET, c, t), true);
    assert.equal(checkStopTips(SECRET, "other-clinic", t), false);
    assert.equal(checkStopTips("another-secret".padEnd(48, "x"), c, t), false);
    assert.equal(checkStopTips(SECRET, c, `${t.slice(0, -1)}A`), t.endsWith("A"));
    assert.equal(checkStopTips(SECRET, "../x", t), false);
  });
});
