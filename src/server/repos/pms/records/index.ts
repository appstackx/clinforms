/**
 * The records module's repositories: note templates, clinical notes with sign and lock and amendments, outcome
 * measures, attached files, the patient's history, the subject-access collection and anonymisation. Rules:
 * src/server/repos/pms/context.ts and docs/clinic-system/contract.md §4 – the tenant is explicit, every write is
 * audited, free text and files are encrypted, nothing clinical is deleted.
 */
export * from "./anonymise";
export * from "./attachments";
export * from "./history";
export * from "./notes";
export * from "./outcomes";
export * from "./subject-access";
export * from "./templates";
export * from "./patient-extras";
export * from "./patient-list";
