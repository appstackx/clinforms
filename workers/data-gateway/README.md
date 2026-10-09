# clinforms-data – the ClinForms data gateway Worker

An authenticated SQL gateway in front of Cloudflare D1 (binding `DB`), used by the Next app through
`src/server/db/dialects/d1-http.ts`. `GET /v1/health`, `POST /v1/query` (single / atomic batch), HMAC-signed
requests (±60 s), limits and a SQL denylist. Full documentation and runbooks: [`docs/database.md`](../../docs/database.md)
(§4 gateway, §7 backups, §8 switch to Supabase). Contract: `docs/production-architecture.md` §2.

```bash
npm ci                                              # own dependencies (wrangler pinned)
export CLOUDFLARE_ACCOUNT_ID=a04ab546d0f1be2aa339bafebcdb3ffa
npm run typecheck && npx tsc -p test/tsconfig.json
npm run deploy:preview                              # clinforms-data-preview → D1 clinforms-preview
npm run migrate:preview                             # wrangler d1 migrations apply clinforms-preview --remote --env preview
```

Tests run from the repository root: `npm run test:gateway`. Production (`deploy:production`,
`migrate:production`, the production `GATEWAY_SECRET`) is done by the orchestrator after review.
