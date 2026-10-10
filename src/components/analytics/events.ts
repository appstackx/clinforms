/**
 * Product analytics allow-lists (pure, browser-safe; tested in events.test.ts).
 *
 * Rules (docs/production-architecture.md §1, owner brief):
 * - only the events below are ever sent, and only with the properties below – short enumerated values,
 *   small counts or booleans, so nothing can identify a patient, a clinician or a clinic;
 * - page views are sent for the public marketing pages only;
 * - every URL the analytics library attaches ($current_url, $pathname, $referrer, …) is reduced to the
 *   origin plus a path whose record ids are replaced by ":id", with no query string or fragment (UTM
 *   campaign parameters are kept on the public pages only).
 *
 * To add an event or a property for wave 2, extend ANALYTICS_EVENTS / TOKEN_PROPS / COUNT_PROPS /
 * BOOLEAN_PROPS here – never pass free text, names, emails, ids or file names.
 */
import { isAppAreaPath, isPublicPagePath } from "@/lib/site";

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
] as const;

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];

/** String properties and every value each may take. */
export const TOKEN_PROPS = {
  area: ["marketing", "demo", "app"],
  cta: ["header", "mobile_nav", "hero", "how_it_works", "security", "faq", "final", "footer", "not_found", "request_access", "demo_page"],
  source: ["clinic_system", "simulated_clinic_system", "export_upload", "notes_pdf"],
  form_kind: ["docx", "pdf_fillable", "pdf_flat", "questions"],
  format: ["docx", "pdf"],
  mode: ["demo", "live"],
  method: ["totp", "backup_code"],
  referrer_type: ["insurer", "medico_legal", "solicitor", "case_manager", "employer", "other"],
  role: ["owner", "admin", "clinician", "staff"],
  sites: ["1", "2-5", "6-10", "11+"],
} as const satisfies Record<string, readonly string[]>;

/** Whole-number properties (0 – 100 000). */
export const COUNT_PROPS = ["question_count", "answer_count", "gap_count", "patient_count", "duration_s"] as const;

/** Boolean properties. */
export const BOOLEAN_PROPS = ["batch", "first_time"] as const;

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

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
const UTM_VALUE = /^[A-Za-z0-9 _.+-]{1,64}$/;

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
  if (!isPublicPagePath(path)) return `${url.origin}${path}`;
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
export function filterOutgoingEvent<T extends OutgoingEvent>(event: T | null, siteOrigin: string): T | null {
  if (!event) return null;
  const name = event.event;
  if (name === PAGEVIEW) {
    const path = sanitizePath(String(event.properties?.$pathname ?? ""));
    if (!isPublicPagePath(path)) return null;
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
  const out = { ...event, properties };
  if (out.$set) {
    out.$set = { ...out.$set };
    sanitizeUrlProperties(out.$set, siteOrigin);
  }
  if (out.$set_once) {
    out.$set_once = { ...out.$set_once };
    sanitizeUrlProperties(out.$set_once, siteOrigin);
  }
  return out;
}

/** Page views are counted for the public marketing pages only (never the demo, the app or sign-in). */
export function shouldCapturePageview(pathname: string): boolean {
  return !isAppAreaPath(pathname) && isPublicPagePath(pathname);
}
