# ClinDesk showcase video tooling (`scripts/clindesk/showcase-video`)

Records and edits "a day at Pebblegate Physio (fictional)" – the ClinDesk product showcase. LOCAL only: a production
build of `main` on `next start -p 3320` with a local SQLite database seeded with fictional data; never clindesk.co.uk.
Working files (takes, frames, voice, database, credentials) live outside the repo in
`marketing/clindesk/showcase-video-v1-src/`; deliverables in `marketing/clindesk/showcase-video-v1/`.

1. Seed: `node patch-seed.mjs <worktree>` (re-skins the demo seed as Pebblegate; do not commit), `db:migrate`,
   `pms:seed-demo -- --slug pebblegate-demo --name "Pebblegate Physio (fictional)"` with `fakeclock.cjs` preloaded
   (FAKE_NOW = Tue 10/11/2026), `admin:set-demo-clinic --on`; `onboard.cjs` (owner/physio/reception; passwords and
   two-step keys only in a chmod 600 local file), `prep-clinic.cjs`.
2. Takes: `reset.sh <story time> [checkpoint]`, then `take-s1…s6a.cjs` (CDP screencast at 2880×1620, drawn cursor,
   cuts; `origin-fix.cjs` = local-only same-origin workaround for clinic.localhost). `ckpt.sh` between scenes.
3. Narration: one take per chapter (ElevenLabs, voice Beth), transcribed for word times → `voice/paras.json`.
4. Edit: `edl.cjs` (timeline: chapter cards, camera moves, rings, callouts, captions ≤ 2×42, audio placement) →
   `render.cjs` (frame-accurate, `motion/render.html` + `engine.js`, site fonts and drawings copied locally) →
   `finish.cjs` (-16 LUFS, master, ≤13.5 MB e-mail copy, SRT, chapters).
