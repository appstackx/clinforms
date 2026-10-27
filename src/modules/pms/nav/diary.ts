/**
 * Navigation entries of the diary module (owned by the diary builder – contract §3). Band 10–19.
 *
 * Empty until the diary's pages exist (the screens wait for their design): an entry here shows in the shell's
 * navigation, and a link to a page that is not there would be the 404 page. When the pages land:
 *   { id: "diary.diary", module: "diary", label: "Diary", href: `${CLINIC_BASE_PATH}/diary`, order: 10, permission: "diary.view", group: "main" },
 *   { id: "diary.rotas", module: "diary", label: "Rotas", href: `${CLINIC_BASE_PATH}/diary/rotas`, order: 12, permission: "diary.manage", group: "manage" },
 * (the waiting list is reached from the diary's own tabs – the shell marks an entry current for every page below
 * its address, so a second top-bar entry under /diary would show two current pages).
 */
import type { PmsNavEntry } from "../core/nav";

export const DIARY_NAV: readonly PmsNavEntry[] = [];
