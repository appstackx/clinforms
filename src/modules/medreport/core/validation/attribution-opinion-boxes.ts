/**
 * W0.6 stub for WB (plan WB design 3, C-ATTR-1): the positive rule for opinion boxes. In a clinician_opinion box, an
 * opinion-labelled box or a paragraph with basis clinician_opinion_recorded, drafted text is either a framed quotation
 * ("<Name> recorded on <date>: “…”", the quoted span a verbatim substring of a cited note by that clinician) or has no
 * opinion content; anything else blocks and cannot be acknowledged on drafted text.
 *
 * Registered in registry.ts (VALIDATORS "attribution-opinion-boxes"). Returns no flags until WB fills it in.
 * Owner: WB (opinion guard and attribution) – docs/bh2-ownership.json.
 */
import type { Validator } from "./registry";

export const validateOpinionBoxQuotes: Validator = () => [];
