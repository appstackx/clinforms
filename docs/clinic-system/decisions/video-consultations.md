# Decision pack – video consultations (vi01)

**Internal.** 11/11/2026. Research + design only; no code changed, nothing signed up for. Prices are list prices in
USD from the providers' own pages (checked 11/11/2026) unless marked; £ figures use $1 ≈ £0.75 and are rough.

## Recommendation

**Use Whereby Embedded (Build plan, ~$11/month + usage) as the video provider.** Keep Daily as the named fallback.

Why, in one line each:
- Whereby is a European company (Oslo, EEA), "GDPR compliant, ISO 27001 certified", and already powers UK
  healthcare video (Accurx, DrDoctor for NHS trusts) – the easiest DPIA story for a UK physio clinic.
- It has the exact pieces we need out of the box: locked rooms with **knock / waiting list**, separate host and
  patient room links, rooms with an end time, React hooks (`@whereby.com/browser-sdk`), browser only, no install.
- Recording is a separate paid add-on – off unless we switch it on (we won't).
- Cost is small and linear: ~$13/month for a typical clinic, ~$10/clinic/month at 50 clinics.
- Daily is the fallback: cheaper at the start (10,000 free minutes/month), the best React SDK, a London media
  region (`geo: eu-west-2`), but it is a US company and its own blog says calls "still rely on some US-based
  services" – a harder DPIA.

Not chosen: Twilio and Vonage (fine but no advantage, US-led, BAA via sales), LiveKit (great value at scale, but EU
region pinning only on the $500/month Scale plan), Cloudflare Realtime (cheapest, but no confirmed region control or
health-data terms, and RealtimeKit is still in beta), Jitsi as a Service (billed per monthly user, dearest for us).

## Provider comparison

| Provider | Price per participant-minute | Free tier | UK/EU data | DPA / health terms | Recording default | Browser, no install | React SDK |
|---|---|---|---|---|---|---|---|
| **Whereby Embedded** | Build $10.99/mo incl. 2,000 min, then $0.0042 | 2,000 min/mo (Explore) | EEA company; Accurx says service is EEA-hosted – **confirm region in DPA** | GDPR + ISO 27001; HIPAA add-on $16.99/mo (not needed in UK) | Off – cloud recording is a paid extra ($0.01/min) | Yes | Yes – `@whereby.com/browser-sdk` hooks, or web component |
| **Daily** | $0.004 (10k–100k), falls to $0.0015 at volume | 10,000 min/mo | `geo` per room incl. `eu-west-2` London and `eu-central-1` Frankfurt; "some US-based services" remain | DPF certified; HIPAA + BAA add-on $500/mo; data residency = enterprise | Off – recording billed per minute only if started | Yes (Daily Prebuilt or custom) | Yes – `@daily-co/daily-react` |
| **Twilio Video** | $0.004 (group rooms) | None | Not confirmed in research | HIPAA-eligible via Twilio BAA (sales) | Off unless recording rules set | Yes | JS SDK, React samples |
| **Vonage Video API** | $0.0041 (≤25 publishers) | 100,000 min one-off for new customers | Not confirmed | HIPAA with BAA = "contact sales" | Off (archiving is opt-in) | Yes | JS SDK, React samples |
| **LiveKit Cloud** | Ship $50/mo incl. 150k, then $0.0005; Scale $500/mo incl. 1.5M | 5,000 min/mo (Build) | EU data region (Frankfurt) chosen at project creation; **region pinning only on Scale+** | DPA with SCCs; HIPAA only Scale+ | Off – egress is explicit | Yes | Yes – `@livekit/components-react` |
| **LiveKit self-host** | Server cost only (~£20–40/mo London VM) | – | Wherever we host it (e.g. London) | We are the processor; no vendor DPA | Off | Yes | Same React SDK |
| **Cloudflare Realtime** | SFU: $0.05/GB after 1,000 GB free; RealtimeKit $0.002/min at GA (free in beta) | 1,000 GB/mo | Global anycast; no confirmed region pinning for Realtime | Cloudflare DPA (SCCs); no BAA found | Off – export is opt-in ($0.01/min) | Yes | RealtimeKit React UI kit (beta) |
| **Jitsi as a Service (8x8)** | Per monthly active user: 25 free, $99/300 MAU, $499/1.5k, $0.99 per extra MAU | 25 MAU | 8x8 lists UK/DE residency; JaaS pinning not confirmed | GDPR; 8x8 offers BAAs | Off ($0.01/min if used) | Yes | `@jitsi/react-sdk` (iframe) |

Twilio Video is **not** being retired: the Dec 2026 end-of-life was reversed in Oct 2024 and Twilio is still shipping
Video features in 2026.

## Cost model

Typical clinic: 5 practitioners, 40 video sessions/month × 30 min × 2 people = **2,400 participant-minutes/month**.
50 clinics = **120,000/month** on one ClinDesk account.

| Provider | 1 clinic / month | 50 clinics / month | Per clinic at 50 |
|---|---|---|---|
| **Whereby Build** | $10.99 + 400 × $0.0042 = **$12.67 (~£10)** | $10.99 + 118,000 × $0.0042 = **$507 (~£380)** | ~$10 (~£7.60) |
| Daily | **$0** (inside 10k free) | ≤ 110,000 × $0.004 = **≤ $440 (~£330)** | ~$9 |
| Twilio | $9.60 | $480 | $9.60 |
| Vonage | $9.84 (free for the first 100k min) | $492 | $9.84 |
| LiveKit Cloud | $0 (Build) | $50 (Ship) – or **$500 (Scale) for EU pinning** | $1 / $10 |
| Cloudflare RealtimeKit | $4.80 (free in beta) | $240 | $4.80 |
| Cloudflare raw SFU (est. ~0.7 GB per session) | $0 | ~$17.50 – plus we build all UI | ~$0.35 |
| Jitsi as a Service (~45 MAU/clinic) | $99 (Basic) | ~$742 (Standard + 750 extra MAU) | ~$15 |

Video is a rounding error against the subscription either way. If we charge for it, **£5/month per clinic** covers
Whereby with margin at any size. SMS reminders carrying the link cost more than the video itself.

## How it fits what exists today (read from the repo)

- **Appointments** are `pms_appointments` (diary module, migration 0110 + SQLite twin, parity test). An appointment
  needs a practitioner, patient and service; `room_id` is optional. Note: "room" already means a **physical room**
  (`pms_rooms`) – the video table must not be called rooms.
- **Services** (`pms_services`) carry duration, price, `online_bookable`. No video flag yet (TM3 has one per service).
- **Reminders**: `pms_reminder_rules` + `pms_message_schedule` plan messages per appointment; templates use merge fields
  (`src/modules/pms/comms/merge-fields.ts`). Reminders are skipped < 30 min before start (`SEND_CUTOFF_MINUTES`).
- **Patient secrets**: 32 random bytes, only SHA-256 stored (`src/server/pms/portal/tokens.ts`); key-like links are
  redacted from the message log (`src/modules/pms/comms/secret-links.ts`). Manage-booking links already live in
  `pms_online_bookings.manage_token_hash`.
- **Portal**: appointment cards built in `src/server/pms/portal/appointment-panel-data.ts`, shared by the portal and the
  manage link. Public pages under `src/app/(public-clinic)/clinics/[clinicId]/`.
- **Audit**: per-module label files in `src/modules/pms/audit/`; codes `pms.<entity>.<verb>`; no patient names in details.
- **Blocker to note**: `next.config.mjs` sends `Permissions-Policy: camera=(), microphone=()` on every page, and CSP
  (report-only) has no video origins. The video page needs its own header (`camera=(self "<provider>")`,
  `microphone=(...)`) and provider origins in `frame-src` / `connect-src` / `media-src`.

## Design

| Piece | Design |
|---|---|
| **Appointment type flag** | `pms_services.default_mode` ('in_person' / 'video') and `pms_appointments.mode` (copied at booking, changeable per booking like TM3). Video appointments need no physical room; `site_id` stays (billing/reporting site). Online booking shows "Video" on the slot. |
| **Video session record** | New `pms_video_sessions` (tenant_id, id, appointment_id, provider, provider_room_id, patient_token_hash, opens_at, closes_at, status `planned/open/patient_waiting/live/ended`, clinician_joined_at, patient_joined_at, ended_at). Postgres + SQLite twin. No call content stored. |
| **Room per appointment, on demand** | Nothing is created at the provider at booking. The provider room is created the first time either side opens the join page inside the window (idempotent: one row per appointment, locked with the same advisory-lock pattern). Room end time = appointment end + 30 min, so it dies on its own. Moving the appointment moves the window; cancelling/DNA closes it and deletes the provider room. |
| **Join link (patient)** | `/clinics/<clinic>/video/<43-char secret>` on our domain – never the provider URL. Secret hashed like the manage link, valid until the window closes. Added to `secret-links.ts` so staff copies show HIDDEN_LINK. |
| **Short-lived tokens** | Our page exchanges the secret for a provider join (Whereby: patient room URL of a locked room; Daily: meeting token with `exp` ≈ 10 min and `eject_at_token_exp` off). Host access only ever issued to a signed-in staff user with diary rights for that practitioner. Provider links are fetched at click time, not stored in messages. |
| **Window** | Opens 15 min before start (clinic setting 5–30), closes end + 30 min. Before: "Your video appointment opens at 14:15". After: "This appointment has ended – call the clinic". |
| **Link in reminders** | New merge field `appointment.video_link` (appointment context, email + SMS) and a default "video" variant of the confirmation + reminder templates (includes "use Chrome/Safari, allow camera"). Because reminders stop 30 min before, the portal/manage page is the always-available route. |
| **Link in the portal** | Appointment card shows "Join video" (enabled inside the window) for video appointments; same on the manage-booking page. |
| **Waiting room** | Room is locked. Patient lands on our page: camera/mic check, name pre-filled, then **knocks**. Patient sees "You're in the waiting room – Sarah Reid will let you in". |
| **Clinician joined state** | Diary card for a video appointment shows a camera badge, then "Patient waiting" (from provider knock/participant webhook, or 10-second poll of our API). Clinician clicks "Join video" from the diary → host view → admits patient. Patient view flips to the call; if the clinician is in but hasn't admitted, patient sees "Sarah has joined and will let you in shortly". Optional: patient joining marks the appointment `arrived` (same as reception does today). |
| **Audit trail** | New `src/modules/pms/audit/video.ts`: `pms.video.open` (room created), `pms.video.patient_wait`, `pms.video.admit`, `pms.video.clinician_join`, `pms.video.end`, `pms.video.link_refused` (bad/expired secret), `pms.video_settings.update`. Details: ids and times only. Join/leave times also kept on the session row for disputes and billing. |
| **No recording** | Recording, transcription, chat-file upload and screen recording disabled at account and room level; we never call a recording API; a test asserts the room-create payload has recording off. Screen share allowed (exercise videos). |
| **Fallback** | If the call fails, the page shows the clinic phone (`site.phone`) – phone consult can be recorded in notes as normal. |

## Tracker mapping

| Task | Scope |
|---|---|
| **vi01** | This decision (provider + plan). Khuram's call – see below. |
| **vi03 rooms** | `mode` on services/appointments, `pms_video_sessions` + migrations (both dialects), provider adapter (`createRoom`, `hostJoin`, `patientJoin`, `deleteRoom`) behind one interface so the provider can be swapped, join page, secret links, merge field + default templates, portal/manage card button, Permissions-Policy/CSP for the video route, audit codes. |
| **vi04 waiting room** | Locked room + knock, patient waiting screen, diary "Patient waiting" badge, admit from diary, "clinician has joined" state, webhook receiver (signed) or poll, optional auto-`arrived`. |
| **vi05 tests** | Unit: window maths (clock changes), token expiry, secret redaction, room-create payload (recording off, end time). Repo: one session per appointment under concurrency; cancel/move closes/moves window. E2E (Playwright, fake media flags `--use-fake-device-for-media-stream`): patient knocks → clinician admits → both connected; expired link refused; staff without diary rights can't host. Provider mocked in CI, one live smoke test against the test account. |
| **vi06 privacy/DPIA** | Sign provider DPA; add provider to sub-processor list and clinic privacy notice template; DPIA (below); update `docs/clinic-system/contract.md` data-flow section. |
| **vi07 website** | ClinDesk site + TM3 comparison: move "video consultations" from "not in this version" to included; a short "how your patient joins" page (no app, works on phone, not recorded). Per the hard rule, no vendor name on screens or the site – the provider is named only in the DPA / sub-processor list. |

(vi02 was not in this brief.)

## DPIA / privacy notes

- **Roles**: clinic = controller; AppstackX = processor; Whereby (or chosen provider) = sub-processor. Needs the
  provider's DPA signed and listed in our sub-processor list before any live call.
- **Data the provider sees**: live audio/video, IP addresses, browser/device data, the display name we pass (use
  first name only, e.g. "Megan", and "Sarah (physio)"), join/leave times. No patient ID, DOB or notes sent.
- **Health data (special category)**: the call content is health data. Lawful basis is the clinic's (Art. 6(1)(b)/(f)
  + Art. 9(2)(h) health care). Minimise by: no recording, no chat transcripts, no provider analytics beyond what billing needs.
- **Location**: UK GDPR transfer – EEA has UK adequacy (Whereby); a US provider (Daily, Twilio, Vonage) needs the UK
  extension to the DPF or the IDTA/addendum, and a transfer risk note. Get the provider's media-server regions and
  sub-processor list in writing.
- **Encryption**: TLS/DTLS-SRTP in transit for all providers; Whereby small rooms can be peer-to-peer (end-to-end).
- **Retention**: provider rooms deleted at window close; our session row kept with the appointment (same retention as
  the diary). Provider-side logs: get their retention period for the DPIA.
- **Risks to list**: wrong person joins (mitigated: unguessable link, locked room, clinician admits, first-name check
  on screen); link forwarded (expires with the window); patient in a public place (pre-join reminder text);
  safeguarding/consent for under-18s (clinic policy); clinical suitability of remote assessment (clinic decides per service).
- **NHS/insurers**: DTAC and DSPT aren't required for private clinics, but insurers/NHS-contracted clinics may ask –
  provider ISO 27001 + our Cyber Essentials (if held) is the usual answer.

## The decision Khuram must make (vi01)

**"Do we go with Whereby Embedded (Build plan, pay-as-you-go, on the ClinDesk account) as the video provider for ClinDesk?"**

Answer one of:

| Option | What it means |
|---|---|
| **A. Whereby Embedded – recommended** | Open a Whereby Embedded account under AppstackX Ltd (support hello@clindesk.co.uk), Build plan, no HIPAA add-on, no recording. Request DPA + server-region confirmation first. |
| B. Daily | Same build; cheaper first year (free until ~4 clinics); room `geo: eu-west-2`; heavier transfer paperwork (US company). |
| C. LiveKit | Only if we expect 100+ clinics soon; Scale plan ($500/mo) for EU pinning, or self-host in London and own the ops. |

Two smaller calls to make at the same time:
1. Is video **included** in the ClinDesk subscription or a **paid add-on** (e.g. £5/clinic/month)?
2. Should a patient joining the call **auto-mark the appointment as arrived**? (Recommended: yes.)

## Sources

- Daily pricing: https://www.daily.co/pricing/video-sdk/ ; EU region / `geo`: https://www.daily.co/blog/how-our-new-european-call-server-region-can-benefit-call-performance/ ; room config: https://docs.daily.co/reference/rest-api/rooms/config
- Whereby Embedded pricing: https://whereby.com/information/embedded/pricing ; product page: https://whereby.com/information/embedded ; React hooks (knock, waiting participants): https://docs.whereby.com/reference/react-hooks-reference/api-reference/useroomconnection ; telehealth guide: https://docs.whereby.com/telehealth-industry-solutions/using-whereby-react-hooks-build-a-telehealth-app ; DrDoctor/NHS: https://whereby.com/blog/how-drdoctor-is-using-whereby-to-power-the-future-of-hybrid-healthcare-in-the-uk/ ; Accurx (EEA hosting, P2P, no recording): https://support.accurx.com/en/articles/3778850-video-consultations-is-it-secure
- Twilio Video stays (reversal): https://static1.twilio.com/en-us/changelog/-twilio-video-will-remain-a-standalone-product ; pricing: https://www.twilio.com/en-us/video/pricing ; analysis: https://bloggeek.me/twilio-programmable-video-back/
- Vonage pricing: https://www.vonage.co.uk/communications-apis/video/pricing ; per-participant explainer: https://api.support.vonage.com/hc/en-us/articles/6646227378204-How-does-participant-based-video-pricing-work
- LiveKit pricing: https://livekit.com/pricing ; EU data residency: https://docs.livekit.io/deploy/admin/regions/data-residency ; region pinning: https://docs.livekit.io/deploy/admin/regions/region-pinning ; DPA: https://livekit.com/legal/data-processing-addendum
- Cloudflare Realtime SFU pricing: https://developers.cloudflare.com/realtime/sfu/pricing ; RealtimeKit pricing: https://developers.cloudflare.com/realtime/realtimekit/pricing ; DPA / data localisation: https://www.cloudflare.com/data-localization
- Jitsi as a Service pricing: https://cpaas.8x8.com/en/pricing/jitsi-as-a-service-pricing/ ; 8x8 compliance: https://8x8.com/why-8x8/security-and-compliance
- TM3 telehealth (competitor baseline): https://help.tm3app.com/en/articles/4573123-choose-your-telehealth-mode
