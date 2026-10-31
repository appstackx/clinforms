/**
 * The permission each /app/clinic page needs, by address (pure, browser-safe) – so the clinic shell's layout can
 * answer a real 404 for a page the member may not open (M10).
 *
 * Why: every section has a loading skeleton (loading.tsx). Next.js streams the skeleton as soon as the layouts are
 * ready, so a page that calls notFound() afterwards is answered with status 200 (the 404 page, streamed). The shell's
 * layout sits above every skeleton, and on a full page load it knows the address (x-clinforms-path from the
 * middleware), so it checks the page's permission first. Each page still checks for itself (and on client-side
 * navigation only the page does – the user sees the same 404 page either way).
 *
 * Kept in step with the pages by scripts/pms/route-boundaries.test.ts (each page's requireClinicActor permission).
 */
import type { PmsPermission } from "./permissions";
import { CLINIC_BASE_PATH } from "./modules";

/** [route under /app/clinic with [param] segments, permission] – route groups left out. */
export const PAGE_PERMISSIONS: readonly (readonly [string, PmsPermission])[] = [
  ["/access/[userId]", "settings.members"],
  ["/access", "settings.members"],
  ["/access/roles", "settings.members"],
  ["/billing/claims", "billing.view"],
  ["/billing/invoices/[invoiceId]", "billing.view"],
  ["/billing/invoices/[invoiceId]/print", "billing.view"],
  ["/billing", "billing.view"],
  ["/billing/payers", "billing.view"],
  ["/billing/remittances/new", "billing.pay"],
  ["/billing/statements/print", "billing.view"],
  ["/billing/visits", "billing.edit"],
  ["/design-system", "settings.manage"],
  ["/diary/day-sheet", "diary.view"],
  ["/diary", "diary.view"],
  ["/diary/rotas", "diary.rota"],
  ["/diary/waiting-list", "diary.view"],
  ["/intake/[formId]", "settings.setup"],
  ["/intake/device/[handoffId]", "patients.edit"],
  ["/intake", "settings.setup"],
  ["/letters/[letterId]", "messages.letters"],
  ["/letters/[letterId]/print", "messages.letters"],
  ["/letters/new", "messages.letters"],
  ["/letters", "messages.send"],
  ["/messages", "messages.send"],
  ["/messages/patient-view", "messages.send"],
  ["/messages/settings", "messages.templates"],
  ["/online-booking", "settings.setup"],
  ["/patients/[patientId]/anonymise", "patients.merge"],
  ["/patients/[patientId]/appointments", "diary.view"],
  ["/patients/[patientId]/attachments", "clinical.view"],
  ["/patients/[patientId]/cases/[caseId]", "patients.view"],
  ["/patients/[patientId]/cases/new", "patients.edit"],
  ["/patients/[patientId]/cases", "patients.view"],
  ["/patients/[patientId]/details", "patients.view"],
  ["/patients/[patientId]/edit", "patients.edit"],
  ["/patients/[patientId]/forms/[responseId]", "patients.view"],
  ["/patients/[patientId]/forms", "patients.view"],
  ["/patients/[patientId]/history", "patients.view"],
  ["/patients/[patientId]/invoices", "billing.view"],
  ["/patients/[patientId]/messages", "messages.send"],
  ["/patients/[patientId]/notes", "clinical.view"],
  ["/patients/[patientId]/outcomes", "clinical.view"],
  ["/patients/[patientId]", "patients.view"],
  ["/patients/[patientId]/tab/[tab]", "patients.view"],
  ["/patients/[patientId]/notes/[noteId]", "clinical.view"],
  ["/patients/new", "patients.edit"],
  ["/patients/note-templates", "settings.setup"],
  ["/patients", "patients.view"],
  ["/patients/unsigned-notes", "clinical.view"],
  ["/setup/audit", "settings.members"],
  ["/setup/billing", "settings.setup"],
  ["/setup/import/[batchId]", "settings.import"],
  ["/setup/import", "settings.import"],
  ["/setup/practitioners", "settings.setup"],
  ["/setup/prices", "settings.setup"],
  ["/setup/records", "settings.setup"],
  ["/setup/referrers", "settings.setup"],
  ["/setup/rooms", "settings.setup"],
  ["/setup/services", "settings.setup"],
  ["/setup/sites", "settings.setup"],
  ["/setup/targets", "settings.setup"],
];

/** Pages whose gate is "any of" (their own rules in the page): the Set-up start and the Reports start. */
export const PAGE_ANY_OF: readonly (readonly [string, readonly PmsPermission[]])[] = [
  ["/setup", ["settings.setup", "settings.members", "settings.import", "messages.templates"]],
  ["/reports", ["reports.all", "reports.own"]],
];

function matches(pattern: string, path: string): number | null {
  const a = pattern.split("/").filter(Boolean);
  const b = path.split("/").filter(Boolean);
  if (a.length !== b.length) return null;
  let statics = 0;
  for (let i = 0; i < a.length; i++) {
    if (/^\[[^\]]+\]$/.test(a[i])) continue;
    if (a[i] !== b[i]) return null;
    statics++;
  }
  return statics;
}

/**
 * What the page at `path` (a full address, query allowed) needs: any one of the returned permissions; null = no rule
 * here (not a clinic page, or the page checks something else itself). A static segment beats a [param] one.
 */
export function pagePermissionFor(path: string | null | undefined): readonly PmsPermission[] | null {
  if (!path) return null;
  const bare = path.split(/[?#]/)[0].replace(/\/+$/, "");
  if (bare !== CLINIC_BASE_PATH && !bare.startsWith(`${CLINIC_BASE_PATH}/`)) return null;
  const rest = bare.slice(CLINIC_BASE_PATH.length) || "/";
  let best: { score: number; perms: readonly PmsPermission[] } | null = null;
  for (const [pattern, perm] of PAGE_PERMISSIONS) {
    const score = matches(pattern, rest);
    if (score !== null && (!best || score > best.score)) best = { score, perms: [perm] };
  }
  for (const [pattern, perms] of PAGE_ANY_OF) {
    const score = matches(pattern, rest);
    if (score !== null && (!best || score > best.score)) best = { score, perms };
  }
  return best ? best.perms : null;
}
