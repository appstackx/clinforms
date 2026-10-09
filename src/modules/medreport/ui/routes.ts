/**
 * Studio paths (wave 2). The same screens serve the public demo at /reports and a clinic's own Studio at
 * /app/studio, so no screen hard-codes "/reports": links and navigation come from `useStudioPaths()`,
 * which reads `HostHooks.basePath` (default "/reports").
 *
 * The Security link is the exception: the demo has its own "Security & data protection" page; a clinic's
 * Studio links to the public trust page (/security), which states only what is in place today.
 *
 * Pure helpers (studioPaths, studioSection) are browser-safe and unit-tested in routes.test.ts.
 */
import { useMemo } from "react";
import { useHostHooks, type StudioMode } from "./host-hooks";

export const DEFAULT_STUDIO_BASE_PATH = "/reports";

/** Path of the public security page that a clinic's Studio links to. */
export const PUBLIC_SECURITY_PATH = "/security";

export interface StudioPaths {
  /** e.g. "/reports" or "/app/studio" (no trailing slash). */
  basePath: string;
  /** The Studio home: reports list. */
  home: string;
  /** "Complete a form" wizard. */
  newReport: string;
  /** The wizard with a referrer form preselected. */
  newReportWithForm(formId: string): string;
  /** Referrer forms library. */
  forms: string;
  /** One form map. */
  form(formId: string): string;
  batch: string;
  templates: string;
  /** Security & data protection (demo) or the public trust page (tenant). */
  security: string;
  /** One report (review). */
  report(reportId: string): string;
}

/** "/app/studio/" → "/app/studio"; anything that is not an absolute, same-origin path → the default. */
export function normaliseBasePath(basePath: string | undefined | null): string {
  if (typeof basePath !== "string") return DEFAULT_STUDIO_BASE_PATH;
  const trimmed = basePath.trim().replace(/\/+$/, "");
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || /[?#\\\s]/.test(trimmed)) return DEFAULT_STUDIO_BASE_PATH;
  return trimmed;
}

export function studioPaths(basePath?: string | null, mode: StudioMode = "demo"): StudioPaths {
  const base = normaliseBasePath(basePath);
  const id = (value: string) => encodeURIComponent(value);
  return {
    basePath: base,
    home: base,
    newReport: `${base}/new`,
    newReportWithForm: (formId) => `${base}/new?form=${id(formId)}`,
    forms: `${base}/forms`,
    form: (formId) => `${base}/forms/${id(formId)}`,
    batch: `${base}/batch`,
    templates: `${base}/templates`,
    security: mode === "tenant" ? PUBLIC_SECURITY_PATH : `${base}/security`,
    report: (reportId) => `${base}/${id(reportId)}`,
  };
}

/** The Studio's named sub-pages; any other single segment under the base path is a report id. */
const NAMED_SECTIONS = ["new", "forms", "batch", "templates", "security"] as const;

export type StudioSection = "reports" | (typeof NAMED_SECTIONS)[number];

/**
 * Which navigation item a path belongs to: the home page and a report's review are "reports", the named
 * pages (and anything below them) are their own section; paths outside the Studio give null.
 */
export function studioSection(pathname: string | null | undefined, basePath?: string | null): StudioSection | null {
  const base = normaliseBasePath(basePath);
  const path = (pathname ?? "").split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  if (path === base) return "reports";
  if (!path.startsWith(`${base}/`)) return null;
  const rest = path.slice(base.length + 1).split("/");
  const first = rest[0];
  if ((NAMED_SECTIONS as readonly string[]).includes(first)) return first as StudioSection;
  return rest.length === 1 && first ? "reports" : null;
}

/** The current Studio's paths (from HostHooks.basePath and mode). */
export function useStudioPaths(): StudioPaths {
  const { basePath, mode } = useHostHooks();
  const studioMode: StudioMode = mode === "tenant" ? "tenant" : "demo";
  return useMemo(() => studioPaths(basePath, studioMode), [basePath, studioMode]);
}
