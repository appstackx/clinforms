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
 * - media-src: the product demo video at /demo plays from MEDIA_ORIGIN (src/lib/site/demo-video.ts, which a test
 *   holds to this value); its captions track and poster are on our own domain ('self').
 * - skipTrailingSlashRedirect: the analytics API paths end in "/" and must not be redirected.
 */

const isDev = process.env.NODE_ENV !== "production";

/** Where the demo video's MP4s are served from (DEMO_VIDEO_MEDIA_ORIGIN in src/lib/site/demo-video.ts). */
const MEDIA_ORIGIN = "https://media.clinforms.co.uk";

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
    "media-src": ["'self'", MEDIA_ORIGIN],
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
  experimental: {
    // pdfkit (under @react-pdf/renderer) opens its default Helvetica with a runtime require that file tracing
    // cannot see, so without this every PDF render fails on Vercel with "Cannot find module …/Helvetica.cjs".
    // Keep the list in step with the routes that render PDFs (route.js.nft.json naming pdfkit.node.mjs).
    outputFileTracingIncludes: {
      "/api/reports/v1/render": ["./node_modules/pdfkit/js/standard-fonts/**/*"],
      "/api/reports/v1/forms/fill-preview": ["./node_modules/pdfkit/js/standard-fonts/**/*"],
      // Clinic system: letters as PDF (src/app/app/clinic/letters/[letterId]/file).
      "/app/clinic/letters/[letterId]/file": ["./node_modules/pdfkit/js/standard-fonts/**/*"],
    },
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      ...NOINDEX_SOURCES.map((source) => ({ source, headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] })),
      // A clinic's public booking pages and patient portal (clinic system, contract §6): never indexed, and the
      // patient's OWN browser may use its location for "distance from you" (worked out on the device, never sent).
      // Later entries win for the same header, so only these paths differ from the site-wide policy above.
      {
        source: "/clinics/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self), payment=(), usb=()" },
        ],
      },
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
