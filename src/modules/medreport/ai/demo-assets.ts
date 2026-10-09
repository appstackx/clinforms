import "server-only";

/**
 * Local demo assets – DEV / DEMO ONLY, never in git, never in production.
 *
 * Third-party referrer forms (e.g. public insurer PDFs used in a private sales demo) cannot be bundled
 * like the fictional sample forms, so they live in a local folder named by MEDREPORT_DEMO_ASSETS_DIR
 * (absolute, or relative to the working directory – `demo-assets/insurers` for the RED demo, which is
 * gitignored):
 *
 *   <dir>/maps/<sampleId>.json                        RecordedFormAnalysis (ai/recorded-forms.ts), mode
 *                                                     "demo_prewritten", bound to the form's fileSha256
 *   <dir>/drafts/<patientId>__form-<sampleId>.json    DemoDraftFile (ai/demo-format.ts) with formSha256 and
 *                                                     bundleFingerprint (stamp-demo-drafts.ts --dir=…)
 *   <dir>/*.pdf, <dir>/*.docx                         the forms themselves – only hashed here, so an upload of
 *                                                     one is recognised and labelled; their bytes are never served
 *
 * With them, an upload of one of those forms in demo mode gets its pre-written map (no live call), the
 * bundle response advertises the pre-written answers so the Studio sends drafting calls, and every
 * preview and render of the form carries its demonstration footer (FormDefinition.demoNotice).
 *
 * HARD-DISABLED on a production build or deployment (NODE_ENV or VERCEL_ENV "production") unless
 * MEDREPORT_DEMO_ASSETS_ALLOW_PROD=1 – third-party insurer material must never be served from
 * production. The flag exists for a LOCAL production build only (`npm run demo:red` = next build + next
 * start on this machine); never set it on a deployment.
 *
 * Files are read again on every call (no cache), so an edited map or draft shows without a restart.
 * Fine for a demo; production form maps belong in a tenant-scoped database, not in local JSON.
 *
 * Logs nothing but one line when the folder is set but switched off by the production rule.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { MAX_FORM_FILE_BYTES } from "../config.public";

export const DEMO_ASSETS_DIR_ENV = "MEDREPORT_DEMO_ASSETS_DIR";
export const DEMO_ASSETS_ALLOW_PROD_ENV = "MEDREPORT_DEMO_ASSETS_ALLOW_PROD";

/** The form files a demo-assets folder may hold (recognised by SHA-256, never served). */
const FORM_FILE = /\.(pdf|docx)$/i;

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : undefined;
}

/** Why the demo assets are off (null = on). */
export type DemoAssetsState =
  | { on: true; dir: string }
  | { on: false; reason: "unset" | "production" | "missing" };

let warnedProduction = false;

/**
 * Whether the local demo assets are on, and where. Off when the variable is unset, when the folder
 * does not exist, and on a production build or deployment (NODE_ENV or VERCEL_ENV "production")
 * unless MEDREPORT_DEMO_ASSETS_ALLOW_PROD=1.
 */
export function demoAssetsState(): DemoAssetsState {
  const raw = env(DEMO_ASSETS_DIR_ENV);
  if (!raw) return { on: false, reason: "unset" };
  const production = env("VERCEL_ENV") === "production" || process.env.NODE_ENV === "production";
  if (production && env(DEMO_ASSETS_ALLOW_PROD_ENV) !== "1") {
    if (!warnedProduction) {
      warnedProduction = true;
      // Same one-line JSON shape as api/http.ts logEvent(); never the folder path.
      console.warn(JSON.stringify({ at: new Date().toISOString(), svc: "medreport", event: "demo_assets.disabled_in_production" }));
    }
    return { on: false, reason: "production" };
  }
  const dir = path.resolve(process.cwd(), raw);
  try {
    if (!statSync(dir).isDirectory()) return { on: false, reason: "missing" };
  } catch {
    return { on: false, reason: "missing" };
  }
  return { on: true, dir };
}

/** The demo-assets folder, or null when the assets are off (see demoAssetsState). */
export function demoAssetsDir(): string | null {
  const state = demoAssetsState();
  return state.on ? state.dir : null;
}

/** Every *.json file of <dir>/<sub>, parsed (unreadable or invalid JSON is skipped), by file name without ".json". */
function readJsonDir(sub: "maps" | "drafts"): Array<{ key: string; data: unknown }> {
  const root = demoAssetsDir();
  if (!root) return [];
  const dir = path.join(root, sub);
  if (!existsSync(dir)) return [];
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith(".json"))
    .sort()
    .flatMap((name) => {
      try {
        return [{ key: name.slice(0, -".json".length), data: JSON.parse(readFileSync(path.join(dir, name), "utf8")) as unknown }];
      } catch {
        return [];
      }
    });
}

/** Raw pre-written maps of the local demo forms (validated by ai/recorded-forms.ts). */
export function readDemoAssetMaps(): Array<{ key: string; data: unknown }> {
  return readJsonDir("maps");
}

/** Raw pre-written answers of the local demo forms, keyed like DEMO_DRAFT_SOURCES (validated by ai/draft-demo.ts). */
export function readDemoAssetDrafts(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const { key, data } of readJsonDir("drafts")) out[key] = data;
  return out;
}

const hashCache = new Map<string, { stamp: string; sha256: string }>();

/**
 * SHA-256 → file name of every form file (*.pdf, *.docx) directly in the demo-assets folder. Used only
 * to recognise an upload of one of them (so it is labelled as a demonstration form even without a map);
 * the bytes are never returned or served. Files over MAX_FORM_FILE_BYTES (an upload would be refused)
 * are skipped. Hashes are cached by path, size and modification time.
 */
export function demoAssetFileSha256s(): Map<string, string> {
  const out = new Map<string, string>();
  const root = demoAssetsDir();
  if (!root) return out;
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return out;
  }
  for (const name of names.filter((n) => FORM_FILE.test(n)).sort()) {
    const file = path.join(root, name);
    try {
      const st = statSync(file);
      if (!st.isFile() || st.size > MAX_FORM_FILE_BYTES) continue;
      const stamp = `${st.size}:${st.mtimeMs}`;
      let entry = hashCache.get(file);
      if (!entry || entry.stamp !== stamp) {
        entry = { stamp, sha256: createHash("sha256").update(readFileSync(file)).digest("hex") };
        hashCache.set(file, entry);
      }
      if (!out.has(entry.sha256)) out.set(entry.sha256, name);
    } catch {
      // unreadable: ignore
    }
  }
  return out;
}
