/**
 * Product analytics for the host app (src/app, src/components). Consent-gated and allow-listed:
 *
 *   import { track } from "@/components/analytics";
 *   track("report_approved", { area: "app", form_kind: "docx", gap_count: 0 });
 *
 * The medreport module may not import this (ESLint boundary): pass a callback through HostHooks instead.
 */
export { track, startAnalytics, stopAnalytics } from "./posthog";
export {
  ANALYTICS_EVENTS,
  BOOLEAN_PROPS,
  COUNT_PROPS,
  TOKEN_PROPS,
  sanitizePath,
  sanitizeProps,
  type AnalyticsEvent,
  type AnalyticsProps,
} from "./events";
export { AnalyticsProvider } from "./analytics-provider";
export { TrackedLink } from "./tracked-link";
