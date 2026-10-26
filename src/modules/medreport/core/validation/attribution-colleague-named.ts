/**
 * W0.6 stub for WB (plan WB design 8, N-ATTR-1, B2-2): every finding or opinion cited from another clinician's note
 * names that clinician in the same sentence (in compact cells a prefix, or a suffix such as "(Priya Shah, 01/09/2026)"),
 * keyed on the cited notes' authors against the voice owner – not on the drafted basis label. A drafted sentence that
 * names two clinicians around one act blocks.
 *
 * Registered in registry.ts (VALIDATORS "attribution-colleague-named"). Returns no flags until WB fills it in.
 * Owner: WB (opinion guard and attribution) – docs/bh2-ownership.json.
 */
import type { Validator } from "./registry";

export const validateColleagueNamed: Validator = () => [];
