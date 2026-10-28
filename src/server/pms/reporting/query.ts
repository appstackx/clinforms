/**
 * What a report asks a source for (plain data; no Next imports, so tests and sources can use it).
 */

export interface ReportingQuery {
  /** UK calendar dates, both included. */
  from: string;
  to: string;
  /** The same period as instants: [start, end), ISO UTC (UK midnight to UK midnight). */
  start: string;
  end: string;
  /** When the report is made (ISO): separates upcoming from not-recorded appointments; the day debt is aged on. */
  now: string;
  /** null = every site; else only these sites (rows without a site are then left out). */
  siteIds: readonly string[] | null;
  /** Only this practitioner's rows (null = everyone). */
  practitionerId: string | null;
}
