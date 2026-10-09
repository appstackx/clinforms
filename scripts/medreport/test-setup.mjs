/**
 * node:test setup for ClinForms. Loaded with `node --import ./scripts/medreport/test-setup.mjs`.
 *
 * Server-only module files start with `import "server-only"`, a marker that throws outside Next's
 * react-server build layer. Next still enforces it at build time; under node:test we resolve it to the
 * package's own empty module. (We do not use `--conditions=react-server`, which would also swap React
 * for its server subset and break react-pdf/docx tests.)
 */
import Module, { createRequire, register } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const EMPTY = path.join(path.dirname(require.resolve("server-only")), "empty.js");

// CommonJS (tsx compiles the module's .ts files to CJS in this package).
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function resolveServerOnly(request, ...rest) {
  if (request === "server-only") return EMPTY;
  return originalResolve.call(this, request, ...rest);
};

// ESM.
const hook = `export async function resolve(specifier, context, next) {
  if (specifier === "server-only") return { url: ${JSON.stringify(pathToFileURL(EMPTY).href)}, shortCircuit: true };
  return next(specifier, context);
}`;
register(`data:text/javascript,${encodeURIComponent(hook)}`);
