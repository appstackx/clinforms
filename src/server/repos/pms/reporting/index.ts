/**
 * Repositories of the reporting and set-up module: opening hours and closures, staff site access, the audit
 * search and the read-only figures from the shared record. Rules: src/server/repos/pms/context.ts and
 * docs/clinic-system/contract.md §4.
 */
export * from "./audit-search";
export * from "./opening-hours";
export * from "./record-figures";
export * from "./staff-access";
