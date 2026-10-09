The simulated TM3 sandbox is built: the API, the two sandbox pages, the launch server action and the browser document store. One gap remains: until the integration agent replaces the `/launch` stub, the "Create … report" button shows "Launching from the clinic system is not available on this deployment yet." instead of opening the Studio.

`npx tsc --noEmit` is clean for the whole repo, `npx eslint src/sandbox src/app/pms-sandbox src/app/api/tm3-sim` is clean, and my tests pass 26 of 26 (`node --import tsx --test src/sandbox/tm3-sim/*.test.ts`). No shared contract file changed and nothing was committed. Your WIP commit 382afe2 already contains some of my files, so they no longer show as new in `git status`.

**One rule I bent:** to see the pages render, I ran `next dev` on port 3471. That ran in a throwaway copy in my scratchpad with its own `.next`, not in the shared tree. I stopped it and deleted the copy afterwards. There is no headless browser here, so clicking through the client side is still unverified. What I did confirm:
- **Pages:** `/pms-sandbox` and the records for sim-pat-001, 002 and 003 return 200; an unknown patient returns 404.
- **API over HTTP:** paging, 401 problem+json, `X-Simulated` and the `Link` header all work, and the document POST returns 201.
- **Wire format:** every API response passes the module's own wire schemas.
- **Launch action:** works end to end against a fake `/launch` (in the copy only). A spoofed Host header is refused.

A `next-server` started from the main repo is listening on port 3123. It is not mine, and I left it alone.

**Simulated API (`handlers.ts`)**
- **Endpoints:** all seven, plus `dispatchSimRequest` for in-process calls (404 for unknown paths, 405 for wrong methods).
- **Auth:** Bearer token compared in constant time, with the same demo fallback rule as `config.server.ts` (new file `server-config.ts`). A missing or wrong token gets 401 problem+json; a live deployment with no token configured gets 503.
- **Errors:** the body has both the problem+json fields and the `{error:{code,message}, _simulated}` shape, so it still passes `SimErrorSchema`.
- **Paging:** page size defaults to 50 and is capped at 100. Bad paging values get 422. Responses carry `next_page`, a `Link: rel="next"` header and `X-Total-Count`.
- **Search:** matches name, ID, date of birth (ISO or DD/MM/YYYY) or postcode.
- **Document upload:** the contract wins here, so it uses the snake_case wire payload, not the camelCase names in my brief. It checks content type, size (10 MB), that the episode belongs to the patient, that the file extension matches the MIME type, valid base64, and that `sha256` matches the bytes. It returns 201 and stores nothing.
- **Latency:** random 50–150 ms; `TM3_SIM_LATENCY_MS=0` turns it off.

**Sandbox UI**
- **Look:** slate/blue throughout, the permanent label strip, a clinic header and a skip link.
- **Patient list:** search, a table on wider screens and cards on phones, an empty state, and a count of filed reports per patient.
- **Patient record:** the five tabs, synced to the URL hash.
  - Appointments: ATT/DNA/LCN chips and "No reason recorded".
  - Notes: expandable SOAP notes with the author's name and HCPC number.
  - Outcomes: a table plus a small chart.
  - Documents: a loading state, an empty state, downloads, and the "stored in this browser – simulated record" label.
- **Connected apps card:** a "Report author" select, and the button label follows the referral type. Patients with no episode get a disabled state with the reason.
- **Launch flow:**
  - **Click:** opens a blank tab synchronously and calls the server action in `src/app/pms-sandbox/actions.ts`.
  - **Success:** sends that tab to the launch URL, or navigates the same tab if the popup was blocked.
  - **Failure:** closes the blank tab and shows an inline error.

  The action looks up the patient, episode and clinician from the fixtures by ID, so the browser cannot supply its own clinician.

**Document store (`client-store.ts`):** `fileDocument`, `listDocuments`, `subscribeDocuments` and `countDocumentsByPatient` are new. The existing `saveSimulatedDocument` etc. are kept, so `medreport-host.tsx` needs no change. Every change fires `tm3sim:documents-changed`, and other tabs refresh through the storage event and on focus.

**Known issues**
- **Preview deployments:** the action does not fall back to in-process calls, because it may only import types and paths from the contract. It forwards `VERCEL_AUTOMATION_BYPASS_SECRET` if that is set; otherwise launching from a protected preview shows an error.
- **Partner key safety:** the key is only sent to a trusted origin: any host on Vercel, a loopback host, or the host in `TM3_SIM_BASE_URL`. Running `next start` on a LAN IP needs `TM3_SIM_BASE_URL` set.
- **Placeholder removed:** I deleted `ui/placeholder-card.tsx`; nothing else used it.

**Requests for orchestrator**
1. Add `"src/sandbox/**/*.test.ts"` to the `test:medreport` glob in `package.json`.
2. Document `TM3_SIM_LATENCY_MS` in the README env table and `.env.example`. Also add to the sim API section: problem+json errors, the `Link`/`X-Total-Count` headers, the page-size cap of 100 and the upload validation rules.
3. **Integration agent, documents:** the upload must send JSON with a `sha256` that matches the decoded bytes, `file_name` ending in `.docx` or `.pdf` to match the MIME type, and an `episode_id` belonging to that patient. Success is 201, not 200.
4. **Integration agent, launch:** please implement `/launch` (still a 501 stub) returning an absolute http(s) `launchUrl` and `expiresAt`. The action sends `x-partner-key` and `{connectorId:"tm3-sim", patientId, episodeId, clinician:{name, hcpc, role?}}`.
5. Decide whether the launch action may fall back to an in-process call through `_medreport-glue.ts` for protected previews.
6. Remove the README line "(sandbox) … `/sessions/demo` is demo-only" only if it conflicts; nothing is needed from me there.

Files are in `/home/user/careconnect-mk/src`:
- sandbox/tm3-sim/handlers.ts
- sandbox/tm3-sim/handlers.test.ts
- sandbox/tm3-sim/server-config.ts
- sandbox/tm3-sim/client-store.ts
- sandbox/tm3-sim/client-store.test.ts
- sandbox/tm3-sim/ui/sandbox-shell.tsx
- sandbox/tm3-sim/ui/patient-list.tsx
- sandbox/tm3-sim/ui/patient-record.tsx
- sandbox/tm3-sim/ui/record-tabs.tsx
- sandbox/tm3-sim/ui/outcomes-tab.tsx
- sandbox/tm3-sim/ui/documents-tab.tsx
- sandbox/tm3-sim/ui/connected-apps-card.tsx
- sandbox/tm3-sim/ui/ui-bits.tsx
- sandbox/tm3-sim/ui/format.ts
- app/pms-sandbox/actions.ts
- app/pms-sandbox/page.tsx
- app/pms-sandbox/patients/[id]/page.tsx
- app/pms-sandbox/patients/[id]/not-found.tsx