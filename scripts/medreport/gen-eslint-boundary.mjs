/**
 * Regenerates the medreport module's import boundary in .eslintrc.json (keeps "extends").
 * Run: npm run medreport:eslint-boundary (= node scripts/medreport/gen-eslint-boundary.mjs)
 *
 * Why generated: ESLint overrides REPLACE (not merge) a rule's options, and relative escapes out of the
 * module depend on file depth, so each depth (and each browser-safe folder) gets its own full pattern list.
 * Orchestrator-owned.
 */
import fs from "node:fs";

const M = "src/modules/medreport";
const MAX_DEPTH = 6;
const ext = "{ts,tsx}";

const LIB = { group: ["@/lib", "@/lib/*"], message: "The medreport module may not import src/lib. Use ui/primitives.ts (cn) or the module's own core/." };
const COMPONENTS = { group: ["@/components", "@/components/*"], message: "Import host UI components only via src/modules/medreport/ui/primitives.ts." };
const SANDBOX = { group: ["@/sandbox", "@/sandbox/*", "**/sandbox/*"], message: "The module may not import the simulated TM3 sandbox; they talk over HTTP only (src/app glue wires them)." };
const APP = { group: ["@/app", "@/app/*"], message: "The module may not import the app (src/app). Receive what you need via MedreportDeps or HostHooks." };
// Production data layer (src/server: database, encryption, repositories) is host code: the module receives
// what it needs through MedreportDeps / HostHooks (docs/production-architecture.md §0).
const SERVER = { group: ["@/server", "@/server/*"], message: "The module may not import src/server (host code). Receive capabilities via MedreportDeps / HostHooks." };
// The data gateway Worker (workers/) is deployed separately; the Next app never imports its code.
const WORKERS = { group: ["**/workers/*", "**/workers/**"], message: "The Next app may not import the Worker code in workers/ (it is deployed separately; talk to it over HTTP)." };
const escape = (d) => ({
  group: ["../".repeat(d + 1) + "*"],
  message: "Relative imports may not leave src/modules/medreport (use the module's own files; host UI via ui/primitives.ts).",
});
const CLIENT_UNSAFE = {
  group: [
    "server-only",
    "node:*",
    "@anthropic-ai/sdk",
    "@anthropic-ai/sdk/*",
    "docx",
    "docxtemplater",
    "pizzip",
    "@react-pdf/renderer",
    "@react-pdf/*",
    "@xmldom/xmldom",
    "pdf-lib",
    "kysely",
    "kysely/*",
    "pg",
    "@electric-sql/pglite",
    "@electric-sql/pglite/*",
    // identity layer (src/server/auth, src/server/email): server-only. Better Auth's browser client stays allowed.
    "better-auth",
    "better-auth/*",
    "!better-auth/react",
    "!better-auth/client",
    "!better-auth/client/*",
    "mailersend",
    "mailersend/*",
  ],
  message:
    "core/, templates/, ui/, config.public.ts and api/contract.ts run in the browser: no server-only code, Node built-ins, Anthropic SDK, docx, docxtemplater, pizzip, react-pdf, @xmldom/xmldom or pdf-lib here (forms are read and filled on the server, in forms/).",
};
// Browser preview libraries (Revision 2): docx-preview and pdfjs-dist render the referrer's form in its
// original layout in the Studio, so only ui/ may import them. forms/ may use pdfjs-dist's LEGACY build
// for server-side text extraction (via forms/pdfjs.ts), never its browser entry points.
const DOCX_PREVIEW = {
  group: ["docx-preview", "docx-preview/*"],
  message: "docx-preview renders Word files in the browser: import it only in ui/ (dynamically, in a client component).",
};
const PDFJS = {
  group: ["pdfjs-dist", "pdfjs-dist/*"],
  message: "pdfjs-dist: the browser preview imports it in ui/; server-side PDF text extraction goes through forms/pdfjs.ts.",
};
const PDFJS_BROWSER_MESSAGE =
  "forms/ runs in Node: use pdfjs-dist's legacy build via forms/pdfjs.ts loadPdfjs(), not the browser entry points.";
// Patterns use gitignore semantics, where "pdfjs-dist" would also match every subpath, so the bare
// specifier is banned through `paths` instead.
const PDFJS_BROWSER_ENTRIES = {
  group: ["pdfjs-dist/build/*", "pdfjs-dist/web/*", "pdfjs-dist/image_decoders/*"],
  message: PDFJS_BROWSER_MESSAGE,
};
const PDFJS_BARE_PATH = { name: "pdfjs-dist", message: PDFJS_BROWSER_MESSAGE };
const rule = (patterns, paths) => ({ "no-restricted-imports": ["error", paths ? { paths, patterns } : { patterns }] });
const core = (d) => [LIB, COMPONENTS, SANDBOX, APP, SERVER, escape(d)];
const base = (d) => [...core(d), DOCX_PREVIEW, PDFJS];

const overrides = [];
// 0. All app code: no imports of the Worker. (Listed first: the module and sandbox overrides below replace
//    this rule's options for their files and carry their own escape / WORKERS patterns.)
overrides.push({ files: [`src/**/*.${ext}`], rules: rule([WORKERS]) });
// 1. Every module file, by depth below src/modules/medreport.
for (let d = 0; d <= MAX_DEPTH; d++) {
  overrides.push({ files: [`${M}/${"*/".repeat(d)}*.${ext}`], rules: rule(base(d)) });
}
// 2. forms/ (server-only form engine) may use pdfjs-dist's legacy build, never docx-preview.
for (let d = 1; d <= MAX_DEPTH; d++) {
  overrides.push({
    files: [`${M}/forms/${"*/".repeat(d - 1)}*.${ext}`],
    rules: rule([...core(d), DOCX_PREVIEW, PDFJS_BROWSER_ENTRIES], [PDFJS_BARE_PATH]),
  });
}
// 3. Browser-safe folders also ban server-only libraries (tests excluded: they use node:test).
//    ui/ is the one place allowed to import the browser preview libraries.
for (const folder of ["core", "templates", "ui"]) {
  for (let d = 1; d <= MAX_DEPTH; d++) {
    overrides.push({
      files: [`${M}/${folder}/${"*/".repeat(d - 1)}*.${ext}`],
      excludedFiles: ["**/*.test.ts", "**/*.test.tsx"],
      rules: rule(folder === "ui" ? [...core(d), CLIENT_UNSAFE] : [...base(d), CLIENT_UNSAFE]),
    });
  }
}
overrides.push({ files: [`${M}/config.public.ts`], rules: rule([...base(0), CLIENT_UNSAFE]) });
overrides.push({ files: [`${M}/api/contract.ts`], rules: rule([...base(1), CLIENT_UNSAFE]) });
// 4. The one bridge to the host design system.
overrides.push({
  files: [`${M}/ui/primitives.ts`],
  rules: rule([
    { group: ["@/lib/*", "!@/lib/utils"], message: "ui/primitives.ts may re-export only @/lib/utils (cn) from src/lib." },
    { group: ["@/components/*", "!@/components/ui"], message: "ui/primitives.ts may re-export only @/components/ui/*." },
    SANDBOX,
    APP,
    SERVER,
    escape(1),
    CLIENT_UNSAFE,
  ]),
});
// 5. The sandbox may not import the module at all.
overrides.push({
  files: [`src/sandbox/**/*.${ext}`],
  rules: rule([
    {
      group: ["@/modules", "@/modules/*", "**/modules/*"],
      message: "The simulated TM3 sandbox may not import the medreport module; duplicate wire types in src/sandbox/tm3-sim/wire-types.ts and talk over HTTP.",
    },
    WORKERS,
  ]),
});

// 6. Edge middleware (src/middleware.ts) only looks at cookies: no database, sign-in library, Node built-ins or
//    host/module server code there (Next 14 middleware runs on the Edge runtime; real checks are in Node).
overrides.push({
  files: ["src/middleware.ts"],
  rules: rule([
    {
      group: [
        "@/server",
        "@/server/*",
        "@/modules/*",
        "@/sandbox/*",
        "server-only",
        "node:*",
        "kysely",
        "kysely/*",
        "pg",
        "better-auth",
        "better-auth/*",
        "mailersend",
        "mailersend/*",
      ],
      message: "src/middleware.ts runs on the Edge runtime and only does optimistic cookie checks: no server code, database or sign-in library here.",
    },
    WORKERS,
  ]),
});

const current = JSON.parse(fs.readFileSync(".eslintrc.json", "utf8"));
fs.writeFileSync(".eslintrc.json", JSON.stringify({ extends: current.extends ?? "next/core-web-vitals", overrides }, null, 2) + "\n");
console.log(`.eslintrc.json: ${overrides.length} overrides written`);
