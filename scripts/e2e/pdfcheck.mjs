import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
const buf = readFileSync(process.argv[2]);
const doc = await PDFDocument.load(buf);
const fields = doc.getForm().getFields();
console.log("pages", doc.getPageCount(), "acroform fields", fields.length);
for (const f of fields.slice(0, 40)) { let v = ""; try { v = f.getText?.() ?? (f.isChecked?.() ? "checked" : f.getSelected?.() ?? ""); } catch {} console.log(" ", f.getName(), JSON.stringify(v).slice(0, 80)); }
