/**
 * W0.6 stub for WB (plan WB design 9, C-ATTR-2): the wrong clinician named. A clinician from the record's list, named
 * as the subject of recorded / found / assessed / examined / measured / noted / treated / advised / discharged, or as
 * the holder of "<Name>'s assessment/opinion", must have written a cited note – one of that date when a date is given.
 * Blocks on drafted text; the approver may acknowledge it on edited text.
 *
 * Registered in registry.ts (VALIDATORS "attribution-clinician-named"). Returns no flags until WB fills it in.
 * Owner: WB (opinion guard and attribution) – docs/bh2-ownership.json.
 */
import type { Validator } from "./registry";

export const validateClinicianNamed: Validator = () => [];
