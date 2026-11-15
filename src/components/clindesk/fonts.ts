import { Arimo, Bricolage_Grotesque, Courier_Prime, Figtree, Shantell_Sans, Source_Serif_4 } from "next/font/google";

/*
 * The public websites' fonts (ClinDesk's design system, styles/site.css), shared by clindesk.co.uk
 * (src/app/clindesk-site/layout.tsx) and clinforms.co.uk (src/app/(marketing)/layout.tsx) so the two sites keep one
 * type system. Self-hosted by next/font at build time – no font request to a third party from the browser,
 * font-display: swap. The display, text and pen fonts are preloaded; the fonts of the product scenes and referrers'
 * paper forms (Inter comes from the root layout) load when a page uses them.
 */
const bricolage = Bricolage_Grotesque({ subsets: ["latin"], axes: ["opsz", "wdth"], display: "swap", variable: "--cd-font-bricolage" });
const figtree = Figtree({ subsets: ["latin"], style: ["normal", "italic"], display: "swap", variable: "--cd-font-figtree" });
const shantell = Shantell_Sans({ subsets: ["latin"], axes: ["BNCE", "INFM"], display: "swap", variable: "--cd-font-shantell" });
const serif = Source_Serif_4({ subsets: ["latin"], axes: ["opsz"], display: "swap", preload: false, variable: "--cd-font-serif" });
const arimo = Arimo({ subsets: ["latin"], weight: ["400", "700"], display: "swap", preload: false, variable: "--cd-font-arimo" });
const courier = Courier_Prime({ subsets: ["latin"], weight: ["400", "700"], display: "swap", preload: false, variable: "--cd-font-courier" });

/** The class names that define the fonts' CSS variables (put them on the site's outermost element). */
export const SITE_FONT_VARIABLES = [bricolage, figtree, shantell, serif, arimo, courier].map((f) => f.variable).join(" ");
