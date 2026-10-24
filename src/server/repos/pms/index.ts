/**
 * The clinic-system repositories (shared patient record, directory, packages). Every function takes the tenant
 * explicitly; every write takes the actor and is audited. Rules: ./context.ts and docs/clinic-system/contract.md §4.
 * Module repositories live next to these files (src/server/repos/pms/<module>.ts) and are imported directly.
 */
export * from "./cases";
export * from "./directory";
export * from "./entitlements";
export * from "./patients";
export * from "./price-lists";
export * from "./referrers";
export * from "./settings";
export { pmsId, type PmsActor } from "./context";
