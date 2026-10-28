/**
 * Record id prefixes of the records module (contract §4: declared here, never reused by another module).
 * An id is "<prefix>_<ULID>" (src/server/repos/pms/context.ts pmsId). Attachment chunks are keyed
 * "<attachment id>.<index>" (no prefix of their own).
 */
export const RECORDS_ID_PREFIXES = {
  note: "note",
  noteTemplate: "ntpl",
  amendment: "namd",
  attachment: "natt",
  outcome: "om",
  anonymisation: "anon",
  clinicalFlag: "cflg",
} as const;

/** Built-in note templates have fixed ids (no row in pms_note_templates). */
export const BUILTIN_TEMPLATE_PREFIX = "builtin-";

/** A clinic-system id of one of this module's record types (or a built-in template id). */
export function isRecordsId(id: unknown, prefix: (typeof RECORDS_ID_PREFIXES)[keyof typeof RECORDS_ID_PREFIXES]): id is string {
  return typeof id === "string" && new RegExp(`^${prefix}_[0-9A-HJKMNP-TV-Z]{26}$`).test(id);
}
