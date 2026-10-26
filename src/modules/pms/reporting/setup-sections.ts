/** The clinic set-up screens (pure): where they live, who may open them and what they are for. */
import type { PmsPermission } from "../core/permissions";
import { SETUP_PATH } from "./catalogue";

export interface SetupSection {
  id: string;
  title: string;
  summary: string;
  href: string;
  permission: PmsPermission;
}

export const SETUP_SECTIONS: readonly SetupSection[] = [
  { id: "sites", title: "Sites and rooms", summary: "Locations, their rooms, opening hours and closures.", href: `${SETUP_PATH}/sites`, permission: "settings.manage" },
  { id: "services", title: "Appointment types", summary: "What can be booked: length, buffer, price, online booking.", href: `${SETUP_PATH}/services`, permission: "settings.manage" },
  { id: "prices", title: "Prices", summary: "Self-pay and insurer price lists, billing codes.", href: `${SETUP_PATH}/prices`, permission: "settings.manage" },
  { id: "practitioners", title: "Practitioners", summary: "Who is in the diary, their registration and home site.", href: `${SETUP_PATH}/practitioners`, permission: "settings.manage" },
  { id: "referrers", title: "Referrers and payers", summary: "GPs, consultants, insurers, medico-legal companies, solicitors, employers.", href: `${SETUP_PATH}/referrers`, permission: "directory.edit" },
  { id: "staff", title: "Staff and access", summary: "Who signs in, their role and the sites they work at.", href: `${SETUP_PATH}/staff`, permission: "settings.manage" },
  { id: "roles", title: "Roles", summary: "What owners, administrators, practitioners and reception may do.", href: `${SETUP_PATH}/roles`, permission: "settings.manage" },
  { id: "records", title: "Record keeping", summary: "How long clinical records are kept.", href: `${SETUP_PATH}/records`, permission: "settings.manage" },
  { id: "audit", title: "Audit trail", summary: "Search everything that was done, by whom and when.", href: `${SETUP_PATH}/audit`, permission: "settings.manage" },
];
