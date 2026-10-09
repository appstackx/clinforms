/**
 * Security headers (docs/production-architecture.md §6), the analytics proxy (§1) and robots headers.
 *
 * - The Content Security Policy runs in REPORT-ONLY mode first: switch the header name to
 *   `Content-Security-Policy` (and add `upgrade-insecure-requests`, which is ignored in report-only mode)
 *   once the Studio's review, form-mapping, Word preview and PDF preview screens run clean in Chrome.
 *   Why each source is needed: Next.js inline bootstrap scripts ('unsafe-inline' script), docx-preview's
 *   injected styles and data: fonts/images, pdf.js's module worker ('self') and blob: downloads/previews.
 * - Analytics goes through /ingest on our own domain (rewrites below), so connect-src stays 'self'.
 *   A custom NEXT_PUBLIC_POSTHOG_HOST (absolute URL) is added to script-src/connect-src.
 * - skipTrailingSlashRedirect: the analytics API paths end in "/" and must not be redirected.
 */

const isDev = process.env.NODE_ENV !== "production";

function analyticsOrigin() {
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;
  if (!host || !/^https:\/\//.test(host)) return null;
  try {
    return new URL(host).origin;
  } catch {
    return null;
  }
}

function contentSecurityPolicy() {
  const extra = analyticsOrigin();
  const directives = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", ...(isDev ? ["'unsafe-eval'"] : []), ...(extra ? [extra] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:"],
    "font-src": ["'self'", "data:"],
    "worker-src": ["'self'", "blob:"],
    "connect-src": ["'self'", ...(extra ? [extra] : [])],
    "frame-src": ["'none'"],
    "frame-ancestors": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "object-src": ["'none'"],
  };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");
}

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Content-Security-Policy-Report-Only", value: contentSecurityPolicy() },
];

/** Never indexed: the APIs, the signed-in app, the public demo, the sign-in pages and the analytics proxy. */
const NOINDEX_SOURCES = [
  "/api/:path*",
  "/app",
  "/app/:path*",
  "/reports",
  "/reports/:path*",
  "/pms-sandbox",
  "/pms-sandbox/:path*",
  "/login",
  "/two-factor",
  "/accept-invite",
  "/reset-password",
  "/ingest/:path*",
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // No `x-powered-by: Next.js` header on responses.
  poweredByHeader: false,
  skipTrailingSlashRedirect: true,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      ...NOINDEX_SOURCES.map((source) => ({ source, headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] })),
    ];
  },
  async rewrites() {
    return [
      { source: "/ingest/static/:path*", destination: "https://eu-assets.i.posthog.com/static/:path*" },
      { source: "/ingest/:path*", destination: "https://eu.i.posthog.com/:path*" },
    ];
  },
};

export default nextConfig;
