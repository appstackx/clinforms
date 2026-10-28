/**
 * Body chart (pure): markers on a simple front and back outline, stored as data – never as an image – in the
 * note's encrypted body_chart_enc column. Coordinates are 0–100 in a fixed 100 × 200 drawing (x across, y down),
 * so the chart renders the same at any size and in the subject-access PDF.
 */
import { z } from "zod";

export const BODY_VIEWS = ["front", "back"] as const;
export type BodyView = (typeof BODY_VIEWS)[number];

/** What the patient describes at the spot. Each kind has its own letter, so the chart never relies on colour. */
export const MARKER_KINDS = ["pain", "ache", "pins_needles", "numbness", "stiffness", "other"] as const;
export type MarkerKind = (typeof MARKER_KINDS)[number];

export const MARKER_KIND_LABELS: Readonly<Record<MarkerKind, string>> = {
  pain: "Pain",
  ache: "Ache",
  pins_needles: "Pins and needles",
  numbness: "Numbness",
  stiffness: "Stiffness",
  other: "Other",
};

/** One letter per kind (shown inside the marker and in the key). */
export const MARKER_KIND_LETTERS: Readonly<Record<MarkerKind, string>> = {
  pain: "P",
  ache: "A",
  pins_needles: "N",
  numbness: "X",
  stiffness: "S",
  other: "O",
};

export const MAX_MARKERS = 30;

/** The drawing's size: x 0–100, y 0–200 (stored y is 0–100 of the height). */
export const CHART_WIDTH = 100;
export const CHART_HEIGHT = 200;

export const BodyMarkerSchema = z.object({
  view: z.enum(BODY_VIEWS),
  /** 0–100 across the drawing. */
  x: z.number().min(0).max(100),
  /** 0–100 down the drawing. */
  y: z.number().min(0).max(100),
  kind: z.enum(MARKER_KINDS),
  /** 0–10 when recorded. */
  intensity: z.union([z.number().int().min(0).max(10), z.null()]).optional().default(null),
  /** Short description ("constant, deep"), encrypted with the rest of the chart. */
  label: z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => (typeof v === "string" ? (v.trim() === "" ? null : v.trim()) : null))
    .refine((v) => v === null || v.length <= 120, "At most 120 characters"),
});
export type BodyMarker = z.output<typeof BodyMarkerSchema>;

export const BodyChartSchema = z.object({
  markers: z.array(BodyMarkerSchema).max(MAX_MARKERS, `At most ${MAX_MARKERS} markers`),
});
export type BodyChart = z.output<typeof BodyChartSchema>;

export const EMPTY_BODY_CHART: BodyChart = { markers: [] };

/** Rounds coordinates to one decimal (keeps the stored data small and stable). */
export function normaliseChart(chart: BodyChart): BodyChart {
  return {
    markers: chart.markers.map((m) => ({ ...m, x: Math.round(m.x * 10) / 10, y: Math.round(m.y * 10) / 10 })),
  };
}

/** Parses a stored chart defensively (null = nothing stored or not a chart). */
export function parseBodyChart(json: string | null | undefined): BodyChart | null {
  if (!json) return null;
  try {
    const result = BodyChartSchema.safeParse(JSON.parse(json));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/** Moves a marker by a keyboard step, kept inside the drawing. */
export function nudgeMarker(marker: BodyMarker, dx: number, dy: number): BodyMarker {
  const clamp = (v: number) => Math.min(100, Math.max(0, Math.round(v * 10) / 10));
  return { ...marker, x: clamp(marker.x + dx), y: clamp(marker.y + dy) };
}

/** Plain-words description of a marker (for screen readers and the PDF). */
export function describeMarker(m: BodyMarker, index: number): string {
  const side = m.x < 45 ? (m.view === "front" ? "patient's right" : "patient's left") : m.x > 55 ? (m.view === "front" ? "patient's left" : "patient's right") : "midline";
  const level = m.y < 12 ? "head and neck" : m.y < 30 ? "shoulders and upper trunk" : m.y < 48 ? "trunk" : m.y < 60 ? "pelvis and hips" : m.y < 80 ? "thighs and knees" : "lower legs and feet";
  const parts = [`${index + 1}. ${MARKER_KIND_LABELS[m.kind]}`, `${m.view}, ${level}, ${side}`];
  if (m.intensity !== null && m.intensity !== undefined) parts.push(`intensity ${m.intensity}/10`);
  if (m.label) parts.push(m.label);
  return parts.join(" – ");
}

/**
 * The outline (SVG path data in the 100 × 200 drawing): head, neck, trunk, arms and legs as simple rounded shapes.
 * The same outline serves front and back (the view is labelled).
 */
export const BODY_OUTLINE_PATHS: readonly string[] = [
  // head
  "M50 6 C57 6 61 11 61 18 C61 25 57 30 50 30 C43 30 39 25 39 18 C39 11 43 6 50 6 Z",
  // neck and trunk
  "M45 30 L55 30 L56 36 C66 37 72 40 74 46 L74 92 C74 98 70 102 64 103 L36 103 C30 102 26 98 26 92 L26 46 C28 40 34 37 44 36 Z",
  // right arm (viewer's left)
  "M26 46 C20 48 18 54 17 62 L13 98 C12 104 14 108 17 108 C20 108 21 104 21 99 L25 66 Z",
  // left arm (viewer's right)
  "M74 46 C80 48 82 54 83 62 L87 98 C88 104 86 108 83 108 C80 108 79 104 79 99 L75 66 Z",
  // right leg
  "M36 103 L49 103 L48 150 L47 186 C47 192 44 194 40 194 C36 194 35 191 35 186 L34 150 Z",
  // left leg
  "M51 103 L64 103 L66 150 L65 186 C65 191 64 194 60 194 C56 194 53 192 53 186 L52 150 Z",
];
