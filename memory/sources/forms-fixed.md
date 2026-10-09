All blocker and major findings from both reviews are fixed, plus most of the minor ones. All checks pass: type-check, lint, 214/214 tests and the build. The demo end-to-end run passes 34/34 with no console errors and no 4xx/5xx responses. Live AI could not be shown: the Anthropic account has no credit left ("credit balance is too low"). Live calls fell back to the recorded analysis and recorded drafts, and the app labels them that way. Nothing is committed or pushed. The patient portal is untouched, and `.eslintrc.json` matches its generator output.

**Security fixes**
- **SSRF:** the simulated TM3 API is only called at the server's own trusted address (TM3_SIM_BASE_URL, else the Vercel deployment's URL, else its own local port), never one taken from the request's Host header. The Vercel bypass header only goes to the deployment's own URL. The sandbox only trusts localhost on the server's own port.
- **Form map binding:** a form mapping only counts as confirmed when the server has signed it (new `POST /forms/confirm`). Drafting, approval and the final file all reject an unsigned or changed mapping. The approval receipt records which mapping was approved. A final file never uses a Word template sent by the browser.
- **Approval and filing:** approving now needs a sign-in for that patient and episode, and the signer must match the clinician who launched it. Launch links work once. Filing to the record needs a token tied to the exact final file and approval.
- **Zip bombs and large PDFs:** Word files and PDFs are size-checked before they are opened, and oversize files get a plain-English error.
- **LibreOffice:** runs with macros and links disabled, a minimal environment, at most 2 at a time, and is killed on timeout.
- **XSS:** links and scripts in an uploaded Word form are stripped from the preview.
- **What the AI sees:** a form that arrives already filled in has its patient details removed before analysis, and dates of birth in notes are removed. A new "See exactly what is sent to the AI" panel shows the minimised record.
- **Other minors:** wrong passcode guesses are now limited; option matching no longer treats a real "Not applicable" answer as unknown; answer text in PDFs is at least 8 pt; production must set real secrets (or they are derived from an existing server secret).

**Product fixes**
- **Gaps:** a gap someone has answered is resolved in one click. An opinion gap can only be closed by writing the opinion or giving a reason. When the clinician's answer contradicts the draft's "not recorded" sentence, the card offers to remove that sentence.
- **Referrer references:** a reference belonging to another organisation is no longer copied in. Staff enter it, with a one-click "Use the referral's reference" option.
- **Signer's voice:** "Write in my own voice" rewrites "Sarah Reid recorded…" as "I recorded…" in the signer's own answers. Drafting now knows who the author is, and note shorthand like "2x/wk" or ">15 kg" is written out in full.
- **New features:**
  - a Security & data protection page;
  - upload of notes printed to PDF;
  - a sample flat (non-fillable) PDF form, Ashcroft, with ready-made answers;
  - amended versions of approved forms;
  - Word and PDF copies both filed;
  - a Demo tools menu.

**Two more fixes found during the end-to-end run**
- The ready-made Ashcroft answers were missing question C3, so generating that form stalled. I added it and a test that checks every bundled demo draft covers every question that gets drafted.
- The form mapping page scrolled sideways on mobile (48–72 px). It now fits; the phone and tablet checks pass.

**Deliberately left, and why**
- **Content-Security-Policy:** Next.js's inline scripts would need nonces and dynamic rendering. The preview sanitiser already covers the uploaded-file risk.
- **Enforcing a 16+ character passcode:** the current 11-character passcode would stop working. It is recommended in `.env.example` and the README instead.
- **Unicode font in PDF fills:** the font library isn't installed. Characters the form's font can't print are reported to the user rather than silently dropped.
- **Scanned notes:** OCR is out of scope; a scanned PDF is rejected with a clear message.
- **Converter host:** keeping LibreOffice patched and blocking its network access are deployment tasks, and are documented.
- **Re-recording live drafts:** not possible until the account has credit.

**Things you might trip over**
- **Production secrets:** production deployments now need `MEDREPORT_SIGNING_SECRET` and `MEDREPORT_LAUNCH_SECRET`, or a server secret to derive them from (`ANTHROPIC_API_KEY` or `VERCEL_AUTOMATION_BYPASS_SECRET`). Otherwise requests fail unless `MEDREPORT_ALLOW_DEMO_SECRETS=1` is set. Previews and local runs are unaffected.
- **Existing form mappings:** mappings already saved in a browser go back to "proposed" and need confirming once. The bundled sample forms are re-confirmed automatically.
- **Blank optional question:** an optional question left blank (C3 on the Ashcroft form) shows as "Needs input" even though nothing blocks approval. I left this unchanged.

The demo video and the Blue Heart Clinics research are separate tasks and not covered here.

Files (outputs under /tmp/claude-0/-home-user-careconnect-mk/bbb24e3a-4b8a-53cc-a42c-4dcbe7e661e1/scratchpad):
- Repo: /home/user/careconnect-mk (branch claude/confident-noether-z6l7kr)
- Docs: /home/user/careconnect-mk/src/modules/medreport/README.md (new "Revision 3 – review fixes" section) and /home/user/careconnect-mk/.env.example
- Data fix: /home/user/careconnect-mk/scripts/medreport/build-prewritten-drafts.ts and /home/user/careconnect-mk/src/modules/medreport/ai/demo-drafts/sim-pat-001__form-ashcroft-update-report.json
- New test: /home/user/careconnect-mk/scripts/medreport/demo-draft-binding.test.ts
- Mobile fix: /home/user/careconnect-mk/src/modules/medreport/ui/screens/forms/form-mapping-screen.tsx
- Completed forms: final-outputs/ — `megan-hart_harrow-pike_FINAL.docx` and `.pdf`, `megan-hart_northfield_FINAL.pdf`, `megan-hart_ashcroft_FINAL.pdf`, `daniel-brooks_kingsway_FINAL.docx` and `.pdf`
- Screenshots: screens/ — 85 images (desktop, phone, tablet, live)
- Run log: e2e-run.log
- End-to-end scripts: e2e/