import "server-only";

/**
 * Word → PDF copy of a completed form, with LibreOffice (headless) where it is installed (this
 * machine: /usr/bin/soffice; the production converter). Vercel functions have no LibreOffice, so
 * docxToPdf() returns null there and /render answers 503 PDF_CONVERSION_UNAVAILABLE with
 * NOTICES.pdfConversionUnavailable ("download Word").
 *
 * The binary is MEDREPORT_SOFFICE_PATH, else the first of the usual install paths that exists.
 * Each conversion uses its own temporary, hardened profile and folder and is removed afterwards
 * (see "Hardening" below).
 *
 * Owner: forms-engine agent (contract-stage implementation; signatures are final).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CANDIDATES = [
  "/usr/bin/soffice",
  "/usr/local/bin/soffice",
  "/usr/lib/libreoffice/program/soffice",
  "/opt/libreoffice/program/soffice",
  "/Applications/LibreOffice.app/Contents/MacOS/soffice",
];

let cached: string | null | undefined;

/** Path of the LibreOffice binary, or null when PDF conversion is not available on this deployment. */
export function findSoffice(): string | null {
  if (cached !== undefined) return cached;
  const configured = process.env.MEDREPORT_SOFFICE_PATH?.trim();
  const list = configured ? [configured] : process.env.VERCEL ? [] : CANDIDATES;
  cached = list.find((p) => {
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }) ?? null;
  return cached;
}

export function pdfConversionAvailable(): boolean {
  return findSoffice() !== null;
}

/* ------------------------------------------------------------------------------------------------
 * Hardening (the converter opens files that arrived from outside the clinic):
 * - a minimal environment: PATH, LANG and a throw-away HOME only – no API keys, signing secrets or
 *   proxy settings reach LibreOffice;
 * - a fresh profile per conversion with macros disabled (security level "very high", macro execution
 *   off), active content (OLE/DDE links, linked objects) disabled and links from the document blocked;
 * - at most MAX_CONCURRENT conversions at once (each soffice is ~200 MB); others wait in a queue for at
 *   most QUEUE_TIMEOUT_MS;
 * - soffice runs in its own process group, and on timeout the whole group is killed (the soffice
 *   script exec's oosplash → soffice.bin, which would otherwise survive as an orphan).
 * On the production converter host, also keep LibreOffice patched and block its outbound network.
 * ----------------------------------------------------------------------------------------------*/

export const MAX_CONCURRENT = 2;
const QUEUE_TIMEOUT_MS = 30_000;

let running = 0;
const waiting: Array<() => void> = [];

async function acquireSlot(): Promise<() => void> {
  if (running >= MAX_CONCURRENT) {
    await new Promise<void>((resolve, reject) => {
      const wake = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        const i = waiting.indexOf(wake);
        if (i >= 0) waiting.splice(i, 1);
        reject(new Error("LibreOffice conversion queue is full."));
      }, QUEUE_TIMEOUT_MS);
      waiting.push(wake);
    });
  }
  running += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    running -= 1;
    waiting.shift()?.();
  };
}

/** registrymodifications.xcu for the throw-away profile: no macros, no active content, no links. */
const HARDENED_REGISTRY = `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="DisableMacrosExecution" oor:op="fuse"><value>true</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="DisableActiveContent" oor:op="fuse"><value>true</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="BlockUntrustedRefererLinks" oor:op="fuse"><value>true</value></prop></item>
</oor:items>
`;

/** The environment LibreOffice runs with: nothing from process.env except PATH. */
export function converterEnv(home: string): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    HOME: home,
    LANG: "en_GB.UTF-8",
    TMPDIR: home,
  };
}

function runSoffice(soffice: string, args: string[], dir: string, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let done = false;
    const child = spawn(soffice, args, {
      cwd: dir,
      env: converterEnv(dir) as unknown as NodeJS.ProcessEnv,
      detached: true, // own process group, so the timeout can kill oosplash and soffice.bin too
      stdio: "ignore",
      windowsHide: true,
    });
    const killGroup = () => {
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        try {
          child.kill("SIGKILL");
        } catch {
          // already gone
        }
      }
    };
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      killGroup();
      reject(new Error("LibreOffice conversion failed: timeout"));
    }, timeoutMs);
    child.on("error", (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(new Error(`LibreOffice conversion failed: ${err.name}`));
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      // soffice can leave helpers behind even after a clean exit; the group is ours alone.
      killGroup();
      if (done) return;
      done = true;
      if (code === 0) resolve();
      else reject(new Error(`LibreOffice conversion failed: exit ${code ?? signal ?? "unknown"}`));
    });
  });
}

/**
 * Convert a .docx to PDF. Resolves to null when LibreOffice is unavailable; rejects if a conversion
 * that should work fails (timeout, crash, no output, queue full).
 */
export async function docxToPdf(buf: Uint8Array, opts: { timeoutMs?: number } = {}): Promise<Uint8Array | null> {
  const soffice = findSoffice();
  if (!soffice) return null;
  const release = await acquireSlot();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "appstackx-convert-"));
  try {
    const input = path.join(dir, "form.docx");
    fs.writeFileSync(input, buf);
    const profile = path.join(dir, "profile");
    fs.mkdirSync(path.join(profile, "user"), { recursive: true });
    fs.writeFileSync(path.join(profile, "user", "registrymodifications.xcu"), HARDENED_REGISTRY);
    await runSoffice(
      soffice,
      [
        `-env:UserInstallation=file://${profile}`,
        "--headless",
        "--invisible",
        "--norestore",
        "--nologo",
        "--nodefault",
        "--nolockcheck",
        "--convert-to",
        "pdf",
        "--outdir",
        dir,
        input,
      ],
      dir,
      opts.timeoutMs ?? 60_000,
    );
    const output = path.join(dir, "form.pdf");
    if (!fs.existsSync(output)) throw new Error("LibreOffice produced no PDF.");
    return new Uint8Array(fs.readFileSync(output));
  } finally {
    release();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
