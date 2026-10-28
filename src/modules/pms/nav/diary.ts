/**
 * Navigation entries of the diary module (owned by the diary builder – contract §3). Band 10–19.
 * The waiting list is reached from the diary's toolbar ("Waiting list (n)") – the shell marks an entry current for
 * every page below its address, so a second top-bar entry under /diary would show two current pages.
 */
import type { PmsNavEntry } from "../core/nav";
import { CLINIC_BASE_PATH } from "../core/modules";

export const DIARY_NAV: readonly PmsNavEntry[] = [
  { id: "diary.diary", module: "diary", label: "Diary", href: `${CLINIC_BASE_PATH}/diary`, order: 10, permission: "diary.view", group: "main" },
  { id: "diary.rotas", module: "diary", label: "Rotas", href: `${CLINIC_BASE_PATH}/diary/rotas`, order: 12, permission: "diary.manage", group: "manage" },
];
