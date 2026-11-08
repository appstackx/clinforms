/**
 * Product analytics allow-lists (pure, browser-safe; tested in events.test.ts).
 *
 * Rules (docs/production-architecture.md §1, owner brief):
 * - only the events below are ever sent, and only with the properties below – short enumerated values,
 *   small counts or booleans, so nothing can identify a patient, a clinician or a clinic;
 * - page views are sent for the public website pages only (ClinForms' PUBLIC_PAGES on its hosts, ClinDesk's
 *   CLINDESK_PAGES on the clinic brand's hosts);
 * - every URL the analytics library attaches ($current_url, $pathname, $referrer, …) is reduced to the
 *   origin plus a path whose record ids are replaced by ":id", with no query string or fragment (the UTM
 *   parameters utm_source / utm_medium / utm_campaign / utm_content / utm_term are kept on the public pages only);
 * - advertising click ids (gclid and the like) never leave: only `has_gclid` (true/false) is sent with a page view;
 * - without cookie consent ("stats" mode, cookieless usage statistics) only STATS_EVENTS are sent.
 *
 * To add an event or a property for wave 2, extend ANALYTICS_EVENTS / TOKEN_PROPS / COUNT_PROPS /
 * BOOLEAN_PROPS here – never pass free text, names, emails, ids or file names.
 */
import { brandForHost } from "@/lib/brand";
import { CLINDESK_PAGES } from "@/lib/clindesk/site";
import { isAppAreaPath, isAuthPath, isPublicPagePath } from "@/lib/site";

export const ANALYTICS_EVENTS = [
  "request_access_submitted",
  "demo_opened",
  // The product demo video at /demo (src/app/(marketing)/demo/demo-player.tsx): playback started, and played to
  // the end – once each per page view, with area "marketing" only.
  "demo_video_played",
  "demo_video_completed",
  "login_succeeded",
  "two_factor_enabled",
  "form_uploaded",
  "form_confirmed",
  "draft_completed",
  "report_approved",
  "report_downloaded",
  // Public website (08/11/2026): a "Book a demo" / "Book a visit" / "Request access" link clicked; the request-access
  // or ClinDesk demo form started (first field focused) and submitted (only once the server accepted it); a link
  // between clindesk.co.uk and clinforms.co.uk clicked. Never a form value.
  "cta_clicked",
  "form_started",
  "form_submitted",
  "cross_site_clicked",
] as const;

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];

/**
 * The events cookieless usage statistics may send (no cookie consent): page views of the public website pages and
 * these website events. App and Studio events need the visitor's "allow analytics cookies".
 */
export const STATS_EVENTS = [
  "$pageview",
  "demo_opened",
  "demo_video_played",
  "demo_video_completed",
  "request_access_submitted",
  "cta_clicked",
  "form_started",
  "form_submitted",
  "cross_site_clicked",
] as const;

export function isStatsEvent(name: unknown): boolean {
  return typeof name === "string" && (STATS_EVENTS as readonly string[]).includes(name);
}

/** String properties and every value each may take. */
export const TOKEN_PROPS = {
  area: ["marketing", "demo", "app"],
  cta: ["header", "mobile_nav", "hero", "how_it_works", "security", "faq", "final", "footer", "not_found", "request_access", "demo_page", "demo_video_end"],
  source: ["clinic_system", "simulated_clinic_system", "export_upload", "notes_pdf"],
  form_kind: ["docx", "pdf_fillable", "pdf_flat", "questions"],
  format: ["docx", "pdf"],
  mode: ["demo", "live"],
  method: ["totp", "backup_code"],
  referrer_type: ["insurer", "medico_legal", "solicitor", "case_manager", "employer", "other"],
  role: ["owner", "admin", "clinician", "staff"],
  sites: ["1", "2-5", "6-10", "11+"],
  cta_target: ["book_demo", "book_visit", "request_access"],
  form: ["request_access", "demo_request"],
  to_site: ["clindesk", "clinforms"],
} as const satisfies Record<string, readonly string[]>;

/** Whole-number properties (0 – 100 000). */
export const COUNT_PROPS = ["question_count", "answer_count", "gap_count", "patient_count", "duration_s"] as const;

/** Boolean properties. */
export const BOOLEAN_PROPS = ["batch", "first_time", "has_gclid"] as const;

/** UTM properties of a page view (the library adds them from the URL); values must match UTM_VALUE. */
export const UTM_PROPS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;

type TokenProps = { [K in keyof typeof TOKEN_PROPS]?: (typeof TOKEN_PROPS)[K][number] };
type CountProps = { [K in (typeof COUNT_PROPS)[number]]?: number };
type BooleanProps = { [K in (typeof BOOLEAN_PROPS)[number]]?: boolean };
export type AnalyticsProps = TokenProps & CountProps & BooleanProps;

export function isAnalyticsEvent(name: unknown): name is AnalyticsEvent {
  return typeof name === "string" && (ANALYTICS_EVENTS as readonly string[]).includes(name);
}

/** Keeps only allow-listed keys with allowed values; drops everything else silently. */
export function sanitizeProps(props: unknown): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!props || typeof props !== "object" || Array.isArray(props)) return out;
  for (const [key, value] of Object.entries(props as Record<string, unknown>)) {
    if (Object.prototype.hasOwnProperty.call(TOKEN_PROPS, key)) {
      const allowed = TOKEN_PROPS[key as keyof typeof TOKEN_PROPS] as readonly string[];
      if (typeof value === "string" && allowed.includes(value)) out[key] = value;
    } else if ((COUNT_PROPS as readonly string[]).includes(key)) {
      if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100_000) out[key] = value;
    } else if ((BOOLEAN_PROPS as readonly string[]).includes(key)) {
      if (typeof value === "boolean") out[key] = value;
    } else if ((UTM_PROPS as readonly string[]).includes(key)) {
      if (typeof value === "string" && UTM_VALUE.test(value)) out[key] = value;
    }
  }
  return out;
}

/**
 * Path segments that are route names, not record ids. Any other segment is replaced by ":id"
 * ("/reports/rep_9f3…" → "/reports/:id", "/pms-sandbox/patients/sim-pat-001" → "/pms-sandbox/patients/:id").
 */
const STATIC_SEGMENTS = new Set<string>([
  // public site
  "demo",
  "request-access",
  "security",
  "privacy",
  "cookies",
  "terms",
  // ClinDesk's website (clindesk.co.uk)
  "features",
  "pricing",
  "switching",
  "tour",
  "thanks",
  "accessibility",
  // sign-in
  "login",
  "two-factor",
  "accept-invite",
  "reset-password",
  // Studio (demo and signed-in app)
  "app",
  "studio",
  "reports",
  "new",
  "forms",
  "batch",
  "templates",
  "settings",
  "clinic",
  "members",
  "api-keys",
  // simulated clinic system
  "pms-sandbox",
  "patients",
]);

export function sanitizePath(pathname: string): string {
  const path = (pathname || "/").split(/[?#]/)[0];
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) return "/";
  return "/" + segments.map((s) => (STATIC_SEGMENTS.has(s.toLowerCase()) ? s.toLowerCase() : ":id")).join("/");
}

/**
 * UTM parameters kept on public pages (all five since 08/11/2026). Outreach links must carry campaign-level values
 * only – never a clinic or a person, in utm_content / utm_term either (CLAUDE.md hard rule).
 */
const UTM_KEYS: readonly string[] = UTM_PROPS;
const UTM_VALUE = /^[A-Za-z0-9 _.+-]{1,64}$/;

/** Advertising click ids: never sent, in any property ($initial_… and $set_once included). */
const CLICK_ID = /^(\$initial_|\$)?(gclid|gbraid|wbraid|gclsrc|dclid|gad_source|gad_campaignid|fbclid|msclkid|ttclid|twclid|li_fat_id|igshid|mc_cid|mc_eid|epik|rdt_cid|irclid|_kx)$/i;

function dropClickIds(props: Record<string, unknown> | undefined): void {
  if (!props) return;
  for (const key of Object.keys(props)) if (CLICK_ID.test(key)) delete props[key];
}

/**
 * The public website pages of the brand served on `host`: ClinDesk's pages on its hosts, ClinForms' elsewhere (null =
 * ClinForms). Never the app, the demo Studio, sign-in, patient pages or the APIs.
 */
export function isStatsPagePath(pathname: string, host: string | null): boolean {
  const path = (pathname || "/").split(/[?#]/)[0] || "/";
  if (isAppAreaPath(path) || isAuthPath(path)) return false;
  if (brandForHost(host).publicSite === "clindesk") return CLINDESK_PAGES.some((p) => p.path === path);
  return isPublicPagePath(path);
}

function hostOf(origin: string): string | null {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}

/**
 * A URL safe to send: same-origin URLs keep the sanitised path (plus UTM parameters on public pages);
 * other origins (an external referrer) keep only their origin. Unparseable values become null.
 */
export function sanitizeUrl(raw: unknown, siteOrigin: string): string | null {
  if (typeof raw !== "string" || raw === "") return null;
  if (raw === "$direct") return raw;
  let url: URL;
  try {
    url = new URL(raw, siteOrigin);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.origin !== siteOrigin) return `${url.origin}/`;
  const path = sanitizePath(url.pathname);
  if (!isStatsPagePath(path, url.host)) return `${url.origin}${path}`;
  const utm = new URLSearchParams();
  for (const key of UTM_KEYS) {
    const value = url.searchParams.get(key);
    if (value && UTM_VALUE.test(value)) utm.set(key, value);
  }
  const query = utm.toString();
  return `${url.origin}${path}${query ? `?${query}` : ""}`;
}

/** Properties holding a URL or path that the analytics library adds by itself. */
const URL_PROPERTY = /(^|[_$])(current_url|referrer|url)$/;
const PATH_PROPERTY = /(^|[_$])pathname$/;

function sanitizeUrlProperties(props: Record<string, unknown> | undefined, siteOrigin: string): void {
  if (!props) return;
  for (const key of Object.keys(props)) {
    const value = props[key];
    if (PATH_PROPERTY.test(key)) {
      props[key] = typeof value === "string" ? sanitizePath(value) : null;
    } else if (URL_PROPERTY.test(key)) {
      props[key] = sanitizeUrl(value, siteOrigin);
    }
  }
}

/** Library events allowed besides ours: page views (public pages only). */
const PAGEVIEW = "$pageview";

export interface OutgoingEvent {
  event: string;
  properties: Record<string, unknown>;
  $set?: Record<string, unknown>;
  $set_once?: Record<string, unknown>;
}

/**
 * The last check before anything leaves the browser (wired as the analytics library's before_send):
 * unknown events are dropped, page views outside the public pages are dropped, URL properties are
 * sanitised and our own events keep only allow-listed custom properties.
 */
export function filterOutgoingEvent<T extends OutgoingEvent>(event: T | null, siteOrigin: string, options: { statsOnly?: boolean } = {}): T | null {
  if (!event) return null;
  const name = event.event;
  if (options.statsOnly && !isStatsEvent(name)) return null;
  if (name === PAGEVIEW) {
    const path = sanitizePath(String(event.properties?.$pathname ?? ""));
    if (!isStatsPagePath(path, hostOf(siteOrigin))) return null;
  } else if (!isAnalyticsEvent(name)) {
    return null;
  }
  const properties: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(event.properties ?? {})) {
    // The library's own "$…" properties (browser, screen, URLs…) are kept and sanitised below; custom
    // properties must pass the allow-list.
    if (key.startsWith("$") || key === "token" || key === "distinct_id") properties[key] = value;
  }
  Object.assign(properties, sanitizeProps(event.properties));
  sanitizeUrlProperties(properties, siteOrigin);
  dropClickIds(properties);
  const out = { ...event, properties };
  if (out.$set) {
    out.$set = { ...out.$set };
    sanitizeUrlProperties(out.$set, siteOrigin);
    dropClickIds(out.$set);
  }
  if (out.$set_once) {
    out.$set_once = { ...out.$set_once };
    sanitizeUrlProperties(out.$set_once, siteOrigin);
    dropClickIds(out.$set_once);
  }
  return out;
}

/** Page views are counted for the public website pages only (never the demo, the app or sign-in). */
export function shouldCapturePageview(pathname: string, host: string | null = null): boolean {
  return isStatsPagePath(pathname, host);
}

/** `has_gclid` for a page view: whether the address carried an advertising click id (the value itself is never sent). */
export function hasGclid(search: string): boolean {
  try {
    const params = new URLSearchParams(search);
    return params.has("gclid") || params.has("gbraid") || params.has("wbraid");
  } catch {
    return false;
  }
}

/** The other brand's public website a link points to (cross_site_clicked), or null. */
export function crossSiteTarget(href: string, currentHost: string | null): "clindesk" | "clinforms" | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const target = brandForHost(url.host);
  const known = target.hosts.includes(url.hostname.toLowerCase());
  if (!known || target.publicSite === brandForHost(currentHost).publicSite) return null;
  return target.publicSite;
}

/** Which call to action a link on a public page is (cta_clicked), or null: by its path on this brand's site. */
export function ctaTarget(href: string, currentOrigin: string, marker?: string | null): "book_demo" | "book_visit" | "request_access" | null {
  if (marker === "book_visit" || marker === "book_demo" || marker === "request_access") return marker;
  let url: URL;
  try {
    url = new URL(href, currentOrigin);
  } catch {
    return null;
  }
  if (url.origin !== currentOrigin) return null;
  const clindesk = brandForHost(url.host).publicSite === "clindesk";
  if (clindesk && url.pathname === "/demo") return "book_demo";
  if (!clindesk && url.pathname === "/request-access") return "request_access";
  return null;
}
