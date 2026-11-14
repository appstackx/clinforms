/**
 * Renders every email the self-serve trial sends – and the existing transactional emails in the same branded layout –
 * to HTML (+ plain text) files for review, both brands, with FICTIONAL data. Local only: it writes files and sends
 * nothing (no database, no email provider).
 *
 *   npm run trial:email-previews -- --out /path/to/folder        # default: ./.data/email-previews
 *
 * Open <out>/index.html in a browser.
 */
import fs from "node:fs";
import path from "node:path";
import { TRIAL_EMAIL_KINDS } from "../../src/lib/trial";
import type { BrandId } from "../../src/lib/brand";
import { trialEmail } from "../../src/server/email/trial-templates";
import { invitationEmail, passwordResetEmail, signupConfirmEmail, signupExistingAccountEmail, billingNoticeEmail } from "../../src/server/email/templates";
import type { EmailMessage } from "../../src/server/email/types";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const out = path.resolve(arg("--out") ?? ".data/email-previews");
fs.mkdirSync(out, { recursive: true });

const started = "2026-11-16T15:00:00.000Z";
const ends = "2026-11-30T15:00:00.000Z";
const files: { name: string; subject: string }[] = [];

function save(name: string, m: EmailMessage): void {
  fs.writeFileSync(path.join(out, `${name}.html`), m.html);
  fs.writeFileSync(path.join(out, `${name}.txt`), `Subject: ${m.subject}\n\n${m.text}\n`);
  files.push({ name, subject: m.subject });
}

for (const brand of ["clinic", "clinforms"] as BrandId[]) {
  const origin = brand === "clinic" ? "https://clindesk.co.uk" : "https://clinforms.co.uk";
  const prefix = brand === "clinic" ? "clindesk" : "clinforms";
  TRIAL_EMAIL_KINDS.forEach((kind, i) => {
    save(
      `${prefix}-trial-${i + 1}-${kind}`,
      trialEmail({
        kind,
        to: { email: "dana@larkfield-physio.example", name: "Dana Lark" },
        brand,
        clinicName: "Larkfield Physio (fictional)",
        origin,
        days: 14,
        endsAt: ends,
        reportsIncluded: 10,
        reportsUsed: kind === "welcome" ? 0 : 3,
        textsGranted: brand === "clinic" ? 10 : 0,
        stopTipsUrl: `${origin}/trial/stop-tips?c=larkfield-physio-fictional&t=FICTIONALTOKEN0000000000000000000`,
        planName: brand === "clinic" ? "ClinDesk Small with Reports" : "ClinForms Starter",
        daysToEnd: 1,
        deletionDay: "2027-03-01",
      }),
    );
  });
  void started;
  const expires = "2026-11-23T15:00:00.000Z";
  save(`${prefix}-existing-1-invitation`, invitationEmail({ to: { email: "sam@larkfield-physio.example", name: "Sam Reed" }, brand, clinicName: "Larkfield Physio (fictional)", role: "clinician", inviterName: "Dana Lark", link: `${origin}/accept-invite?token=FICTIONAL`, expiresAt: expires }));
  save(`${prefix}-existing-2-password-reset`, passwordResetEmail({ to: { email: "dana@larkfield-physio.example", name: "Dana Lark" }, brand, link: `${origin}/reset-password?token=FICTIONAL`, expiresAt: expires }));
  save(`${prefix}-existing-3-signup-confirm`, signupConfirmEmail({ to: { email: "dana@larkfield-physio.example", name: "Dana Lark" }, brand, clinicName: "Larkfield Physio (fictional)", link: `${origin}/start-trial/confirm?token=FICTIONAL`, expiresAt: expires }));
  save(`${prefix}-existing-4-signup-existing-account`, signupExistingAccountEmail({ to: { email: "dana@larkfield-physio.example" }, brand, signInLink: `${origin}/login`, resetLink: `${origin}/reset-password` }));
  save(`${prefix}-existing-5-billing-notice`, billingNoticeEmail({ to: { email: "dana@larkfield-physio.example", name: "Dana Lark" }, brand, clinicName: "Larkfield Physio (fictional)", notice: { kind: "payment_received" }, billingUrl: `${origin}/app/settings/billing` }));
}

const index =
  `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>Email previews (fictional data)</title>` +
  `<style>body{font-family:Arial,sans-serif;margin:24px;color:#0f172a}li{margin:6px 0}a{color:#0d9488}</style></head><body>` +
  `<h1>Email previews – fictional data</h1><p>Each email as HTML and plain text. Nothing here was sent.</p><ul>` +
  files.map((f) => `<li><a href="${f.name}.html">${f.name}</a> – ${f.subject.replace(/&/g, "&amp;").replace(/</g, "&lt;")} (<a href="${f.name}.txt">text</a>)</li>`).join("") +
  `</ul></body></html>`;
fs.writeFileSync(path.join(out, "index.html"), index);
console.log(`Wrote ${files.length} emails (HTML + text) to ${out}/ – open index.html.`);
