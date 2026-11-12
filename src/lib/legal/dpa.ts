/**
 * The data processing agreement shown at /data-processing-agreement (only where self-serve sign-up is switched on –
 * src/lib/self-signup.ts). SINGLE SOURCE: content/dpa.json. It is a DRAFT pending legal review (its `status`): the
 * page shows that in a banner above the text, and the version accepted at sign-up is `DPA_VERSION`. Change the text
 * there and bump `version` + `lastUpdated` together – a new version is recorded for every acceptance after it.
 */
import raw from "../../../content/dpa.json";

export interface DpaSection {
  id: string;
  heading: string;
  paragraphs: readonly string[];
}

export interface DpaContent {
  status: string;
  statusNote: string;
  version: string;
  lastUpdated: string;
  title: string;
  intro: string;
  sections: readonly DpaSection[];
}

export const DPA: DpaContent = raw as DpaContent;

export const DPA_VERSION: string = DPA.version;

/** Whether the text is still a draft (its status says so) – the page then shows the draft banner. */
export function dpaIsDraft(content: DpaContent = DPA): boolean {
  return /\bdraft\b/i.test(content.status) || /draft/i.test(content.version);
}

/** Fills {product} and {company} into a paragraph. */
export function fillDpa(text: string, vars: { product: string; company: string }): string {
  return text.replace(/\{product\}/g, vars.product).replace(/\{company\}/g, vars.company);
}
