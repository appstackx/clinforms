/**
 * bh2 W0 follow-up stub for WB (plan WB design 10, seam "fix-generators", bh2-base2): WB's one-click fix generators,
 * listed once for WD's engine (ui/components/review/fixes.ts offeredFixes and planFix, WD design 6) – the "<Author>'s
 * note (date): …" prefix, "Use the note's words", "Name X instead" (only when every cited note is X's and no
 * OWN_OPINION wording is present), "Remove the note link" (approver only, B3-6) and the commentary removal (design 12).
 * WD reads this list; WB fills it in without touching WD's files, and WD's engine checks every proposal against its
 * rules before offering it (I8). The cross-workstream test "WB fix generators through WD's engine" runs them together.
 *
 * Empty until WB fills it in. Pure; browser and server.
 * Owner: WB (opinion guard and attribution) – docs/bh2-ownership.json.
 */
import type { FixGenerator } from "../fix-types";

export const ATTRIBUTION_FIX_GENERATORS: readonly FixGenerator[] = [];
