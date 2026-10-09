# Demo drafts

Pre-written or recorded drafts used when live AI is unavailable (or "Use demo draft" is chosen).

- Built-in templates (fallback when a referrer sends no form): `{externalPatientId}__{templateId}.json`
  (e.g. the simulated TM3 patient ID of Megan Hart + `solicitor-rta-treating-physio`).
- Referrer forms (Revision 2): `{externalPatientId}__form-{sampleId}.json` (e.g.
  `sim-pat-001__form-harrow-pike-treating-physio.json`), with `sampleId` and `formSha256` – the answers
  are only used for that exact referrer file, because their field IDs (F-01…) belong to it. Each field
  carries the model's structured `answer` ("Yes"/"No", an option, DD/MM/YYYY, digits or "").
- Content: the raw structured output per section group (`"F-07+F-08"`), plus provenance (`mode:
  "demo_prewritten" | "demo_recorded"`, and for recorded output `recordedAt`, `model`, `promptVersion`).
- Same schema, assembly and validators as live output. Fictional data only.
  `scripts/medreport/demo-draft-quality.test.ts` assembles every file as the demo replays it and fails
  on an uncited paragraph, a blocking flag other than an open gap or missing answer (for example a
  corrupted clinical term), or record ids, abbreviations or "[CLAIMANT]" left in answers or gaps.
- `scripts/medreport/record-demo-drafts.ts` records them with real Claude output when a key is available
  (re-record after the sample form files or their maps change) and rewrites `index.ts`.

Owner: ai agent.
