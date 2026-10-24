# The clinic system (`src/modules/pms`)

Pure, browser-safe domain code of the clinic system (internal name `pms`; product name: the placeholder
`CLINIC_SYSTEM_NAME` in `src/lib/brand.ts`). The build contract – ownership, migration numbers, conventions – is
**`docs/clinic-system/contract.md`**. Read it first.

## Folder map

| Path | What | Owner |
|---|---|---|
| `core/modules.ts` | Module ids, migration ranges, `CLINIC_BASE_PATH` | foundation |
| `core/entitlements.ts` | Packages (`reports`, `clinic`), statuses, the on/off rule | foundation |
| `core/permissions.ts` | What each role may do (`pmsCan`) | foundation |
| `core/schemas.ts`, `core/types.ts` | The shared patient record and directory: zod inputs, record types | foundation |
| `core/text.ts` | UK postcodes, phone numbers, dates, money, search keys | foundation |
| `core/authorisations.ts`, `core/retention.ts` | Authorisation balance and warnings; record-keeping review dates | foundation |
| `core/ids.ts`, `core/nav.ts`, `core/record-tabs.ts` | Id prefixes; navigation and record-tab types | foundation |
| `nav/<module>.ts`, `record-tabs/<module>.ts`, `audit/<module>.ts` | Each module's navigation entries, patient-record tabs and audit labels (aggregated by the `index.ts` files) | that module |
| `<module>/**` | A module's own domain code (types, schemas, rules, copy) | that module |

## Boundary (ESLint, generated – `npm run medreport:eslint-boundary`)

- No host code here: no `src/lib`, `src/components`, `src/server`, `src/app`, no sandbox, no server-only libraries
  (Node built-ins only in tests), no relative imports out of the module.
- From ClinForms (`src/modules/medreport`) only `@/modules/medreport/connectors/types`, with `import type` (the native
  connector lives host-side in `src/server/pms`). medreport never imports this module.

## Host code

`src/server/repos/pms/*` (repositories: tenant-scoped, encrypted free text, every write audited),
`src/server/pms/*` (actor and package checks, route helper, platform operations, offboarding),
`src/server/db/pms-schema/*` (tables per module), `src/app/app/clinic/**` (pages), `src/components/pms/**` (client
components), `scripts/pms/*` (demo seed, contract test).
