/**
 * Safety corpus fixtures: fictional people, episode bundles and referrer forms (fixtures/*.json), built into the
 * product's own types. Fictional data only, in ClinForms' own wording; the synthetic forms mirror the KINDS of fields
 * on real referrer forms (narrow cells, choices, yes/no with supporting text, conditional boxes, an opinion box, an
 * assessor sign-off, a registration-number box, a printed list, a session table, initial/current columns) – never
 * their wording (corpus-self.test.ts and the env-gated third-party-wording.test.ts check it).
 *
 * The Word file of a fictional form is generated from its `layout` (zipStored, deterministic bytes).
 */
import peopleJson from "../fixtures/people.json";
import owenJson from "../fixtures/bundles/owen.json";
import gemmaJson from "../fixtures/bundles/gemma.json";
import dischargeJson from "../fixtures/fictional-forms/cf-discharge.json";
import initialJson from "../fixtures/fictional-forms/cf-initial.json";
import mergeJson from "../fixtures/fictional-forms/cf-merge.json";
import { zipStored } from "../../../rtf/zip";
import type { Clinician, EpisodeBundle, FormDefinition, FormField, Note } from "../../../types";
import type { NoteOverride, PersonKey } from "./types";

export interface Person {
  key: PersonKey;
  memberId: string;
  userId: string;
  name: string;
  hcpc?: string;
  jobTitle?: string;
  role: "owner" | "admin" | "clinician" | "staff";
  canSign: boolean;
}

export const CORPUS_TENANT = peopleJson.tenantId;
export const CORPUS_CLINIC_NAME = peopleJson.clinicName;
export const DEMO_TENANT = "demo";

export const PEOPLE: Record<PersonKey, Person> = Object.fromEntries(
  Object.entries(peopleJson.people).map(([key, p]) => [key, { key: key as PersonKey, ...(p as Omit<Person, "key">) }]),
) as Record<PersonKey, Person>;

export function person(key: PersonKey): Person {
  const p = PEOPLE[key];
  if (!p) throw new Error(`unknown person ${key}`);
  return p;
}

export function clinicianOf(key: PersonKey): Clinician {
  const p = person(key);
  if (!p.hcpc) throw new Error(`${p.name} is not a clinician`);
  return { name: p.name, hcpc: p.hcpc, ...(p.jobTitle ? { role: p.jobTitle } : {}) };
}

/** The release's Actor shape (W0.3): {memberId, name, role, canSign, hcpc?}. Older code ignores it. */
export function actorOf(key: PersonKey): { memberId: string; name: string; role: Person["role"]; canSign: boolean; hcpc?: string } {
  const p = person(key);
  return { memberId: p.memberId, name: p.name, role: p.role, canSign: p.canSign, ...(p.hcpc ? { hcpc: p.hcpc } : {}) };
}

/* ------------------------------------------------------------------------------------------------
 * Bundles
 * ----------------------------------------------------------------------------------------------*/

type BundleJson = Omit<EpisodeBundle, "tenantId" | "notes"> & { notes: Array<Omit<Note, "author"> & { author: PersonKey }> };
const BUNDLES: Record<string, BundleJson> = {
  owen: stripAbout(owenJson) as unknown as BundleJson,
  gemma: stripAbout(gemmaJson) as unknown as BundleJson,
};

function stripAbout<T extends Record<string, unknown>>(o: T): Omit<T, "_about"> {
  const { _about: _unused, ...rest } = o as T & { _about?: unknown };
  return rest;
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** A bundle with the case's note overrides applied (replace by id, or add with an attended appointment). */
export function buildBundle(name: string, tenantId: string, notes: readonly NoteOverride[] = [], dropNotes: readonly string[] = []): EpisodeBundle {
  const src = BUNDLES[name];
  if (!src) throw new Error(`unknown bundle ${name}`);
  const b = clone(src);
  const out: EpisodeBundle = { ...(b as unknown as EpisodeBundle), tenantId, notes: b.notes.map((n) => ({ ...n, author: clinicianOf(n.author) })) };
  for (const o of notes) {
    const i = out.notes.findIndex((n) => n.id === o.id);
    const before = i >= 0 ? out.notes[i] : undefined;
    const note: Note = {
      id: o.id,
      date: o.date,
      time: before?.time ?? "09:00",
      type: o.type ?? before?.type ?? "follow_up",
      author: clinicianOf(o.author),
      subjective: o.subjective ?? (before && !hasAny(o) ? before.subjective : ""),
      objective: o.objective ?? (before && !hasAny(o) ? before.objective : ""),
      assessment: o.assessment ?? (before && !hasAny(o) ? before.assessment : ""),
      plan: o.plan ?? (before && !hasAny(o) ? before.plan : ""),
    };
    if (i >= 0) {
      out.notes[i] = note;
      for (const a of out.appointments) if (a.noteId === o.id) a.date = o.date;
    } else {
      out.notes.push(note);
      if (o.attended !== false) out.appointments.push({ id: `A-${o.id.slice(2)}`, date: o.date, time: "09:00", status: "ATT", noteId: o.id });
    }
  }
  if (dropNotes.length) {
    out.notes = out.notes.filter((n) => !dropNotes.includes(n.id));
    out.appointments = out.appointments.filter((a) => !a.noteId || !dropNotes.includes(a.noteId));
    for (const s of out.outcomeMeasures) s.points = s.points.filter((p) => !p.noteId || !dropNotes.includes(p.noteId));
  }
  out.notes.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  out.appointments.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return out;
}

function hasAny(o: NoteOverride): boolean {
  return o.subjective !== undefined || o.objective !== undefined || o.assessment !== undefined || o.plan !== undefined;
}

/* ------------------------------------------------------------------------------------------------
 * Fictional referrer forms: a layout → Word file, and a form map
 * ----------------------------------------------------------------------------------------------*/

/** A run of text. `color` is a hex colour (e.g. a navy label), `bold` bold. */
export interface RunSpec {
  text: string;
  color?: string;
  bold?: boolean;
}
/**
 * A paragraph: plain text, or runs, with an optional right indent in twentieths of a point (may be negative). `control`
 * (bh2 fix round 1, R1T-WA2-01): a Word content control after the runs, showing its placeholder prompt (e.g. "Click or
 * tap here to enter text.") as Word writes an empty one.
 */
export type ParaSpec = string | { runs?: RunSpec[]; text?: string; color?: string; bold?: boolean; indRight?: number; merge?: string; control?: string };
/** A table cell: one paragraph, or several. */
export type CellSpec = ParaSpec | { paras: ParaSpec[] };
export type BlockSpec = { p: ParaSpec } | { table: CellSpec[][] };

export interface FictionalFormJson {
  _about?: string;
  id: string;
  title: string;
  referrer: { name: string; type: FormDefinition["referrer"]["type"] };
  fileName: string;
  layout: BlockSpec[];
  fields: FormField[];
}

export const FORMS: Record<string, FictionalFormJson> = {
  "cf-discharge": dischargeJson as unknown as FictionalFormJson,
  "cf-initial": initialJson as unknown as FictionalFormJson,
  "cf-merge": mergeJson as unknown as FictionalFormJson,
};

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function runXml(r: RunSpec): string {
  const props = [r.bold ? "<w:b/>" : "", r.color ? `<w:color w:val="${r.color}"/>` : ""].join("");
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${esc(r.text)}</w:t></w:r>`;
}

/** A MERGEFIELD code (as a clinic system's letter template prints it), shown as «name». */
function mergeFieldXml(name: string): string {
  return `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> MERGEFIELD ${esc(name)} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${runXml({ text: `«${name}»` })}<w:r><w:fldChar w:fldCharType="end"/></w:r>`;
}

/** An empty Word content control (w:sdt) showing its placeholder prompt in Word's placeholder style. */
function contentControlXml(prompt: string): string {
  return `<w:sdt><w:sdtPr><w:showingPlcHdr/></w:sdtPr><w:sdtContent><w:r><w:rPr><w:rStyle w:val="PlaceholderText"/></w:rPr><w:t xml:space="preserve">${esc(prompt)}</w:t></w:r></w:sdtContent></w:sdt>`;
}

function paraXml(p: ParaSpec): string {
  if (typeof p === "string") return `<w:p>${p ? runXml({ text: p }) : ""}</w:p>`;
  const runs = p.runs ?? (p.text !== undefined ? [{ text: p.text, color: p.color, bold: p.bold }] : []);
  const pPr = p.indRight !== undefined ? `<w:pPr><w:ind w:right="${p.indRight}"/></w:pPr>` : "";
  return `<w:p>${pPr}${runs.filter((r) => r.text !== "").map(runXml).join("")}${p.merge ? mergeFieldXml(p.merge) : ""}${p.control !== undefined ? contentControlXml(p.control) : ""}</w:p>`;
}

function cellXml(c: CellSpec, width: number): string {
  const paras = typeof c === "object" && c !== null && "paras" in c ? c.paras : [c as ParaSpec];
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr>${paras.map(paraXml).join("") || "<w:p/>"}</w:tc>`;
}

export function layoutDocumentXml(layout: readonly BlockSpec[]): string {
  const body = layout
    .map((b) => {
      if ("p" in b) return paraXml(b.p);
      const cols = Math.max(...b.table.map((r) => r.length));
      const width = Math.floor(9000 / cols);
      const grid = `<w:tblGrid>${Array.from({ length: cols }, () => `<w:gridCol w:w="${width}"/>`).join("")}</w:tblGrid>`;
      const rows = b.table.map((r) => `<w:tr>${r.map((c) => cellXml(c, width)).join("")}</w:tr>`).join("");
      return `<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/></w:tblPr>${grid}${rows}</w:tbl>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`;
}

/** A minimal, valid .docx for a layout (stored zip, fixed dates: the same layout always gives the same bytes). */
export function buildDocx(layout: readonly BlockSpec[]): Uint8Array {
  const enc = new TextEncoder();
  const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R_NS}/officeDocument" Target="word/document.xml"/></Relationships>`;
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
  return zipStored([
    { name: "[Content_Types].xml", data: enc.encode(ct) },
    { name: "_rels/.rels", data: enc.encode(rels) },
    { name: "word/_rels/document.xml.rels", data: enc.encode(docRels) },
    { name: "word/document.xml", data: enc.encode(layoutDocumentXml(layout)) },
  ]);
}

/** A fictional form's layout with cells replaced (a case can plant residue or change a printed default). */
export function layoutWith(formId: string, patches: ReadonlyArray<{ table: number; row: number; cell: number; spec: CellSpec }> = []): BlockSpec[] {
  const f = FORMS[formId];
  if (!f) throw new Error(`unknown fictional form ${formId}`);
  const layout = clone(f.layout);
  for (const patch of patches) {
    let t = -1;
    for (const b of layout) {
      if ("table" in b && ++t === patch.table) {
        const row = b.table[patch.row];
        if (!row) throw new Error(`${formId}: no row ${patch.row} in table ${patch.table}`);
        row[patch.cell] = patch.spec;
      }
    }
  }
  return layout;
}

export function fictionalFormJson(formId: string): FictionalFormJson {
  const f = FORMS[formId];
  if (!f) throw new Error(`unknown fictional form ${formId}`);
  return f;
}
