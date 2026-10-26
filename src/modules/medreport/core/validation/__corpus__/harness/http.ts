/**
 * Safety corpus: the in-process API handlers (POST /sign, POST /render, PUT /store/reports).
 *
 * Tenant mode: the fictional clinic's members are "signed in" through a stub `authenticate` (the x-corpus-member
 * header names a fixtures/people.json key); the clinic is a demo clinic, so the made-up PH-DEMO numbers may approve;
 * the store is the in-memory TenantStore. Demo mode: a public-demo session token, the body's signer.
 */
import type { AuthContext, ClinicProfile, MedreportDeps } from "../../../../api/deps";
import { handleRender } from "../../../../api/handlers/render";
import { handleSign } from "../../../../api/handlers/sign";
import { handleStoreReportGet, handleStoreReportPut } from "../../../../api/handlers/store-reports";
import { bindHandler, type MedreportHandler } from "../../../../api/http";
import { createMemoryTenantStore, type MemoryTenantStore } from "../../../../api/store-memory";
import { createSessionToken } from "../../../../auth/session-token";
import type { FormDefinition, Report, ReportTemplate, SignReceipt } from "../../../types";
import { CORPUS_CLINIC_NAME, CORPUS_TENANT, clinicianOf, person } from "./fixtures";
import type { PersonKey } from "./types";

const MEMBER_HEADER = "x-corpus-member";

function authContextOf(key: PersonKey): AuthContext {
  const p = person(key);
  return {
    userId: p.userId,
    authSessionId: `sess_${p.key}`,
    tenantId: CORPUS_TENANT,
    role: p.role,
    name: p.name,
    ...(p.hcpc || p.role !== "staff" ? { clinician: { name: p.name, ...(p.hcpc ? { hcpc: p.hcpc } : {}), ...(p.jobTitle ? { jobTitle: p.jobTitle } : {}), canSign: p.canSign } } : {}),
    twoFactorVerified: true,
  };
}

const CLINIC: ClinicProfile = {
  tenantId: CORPUS_TENANT,
  displayName: CORPUS_CLINIC_NAME,
  addressLines: ["1 Corpus Road (fictional)", "Testtown"],
  postcode: "ZZ9 9ZZ",
  retentionDays: 30,
  draftingEnabled: false,
  demoClinic: true,
};

export interface HttpHarness {
  store: MemoryTenantStore;
  deps: MedreportDeps;
}

export function createHttpHarness(): HttpHarness {
  const store = createMemoryTenantStore();
  const deps = {
    authenticate: async (req: Request) => {
      const key = req.headers.get(MEMBER_HEADER);
      return key ? authContextOf(key as PersonKey) : null;
    },
    clinicProfile: async () => CLINIC,
    tenantStore: store,
  } as unknown as MedreportDeps;
  return { store, deps };
}

export interface CallResult {
  status: number;
  code: string | null;
  body: unknown;
  bytes: Uint8Array | null;
  headers: Headers;
}

async function call(
  h: HttpHarness,
  handler: MedreportHandler,
  url: string,
  init: { method: string; body: unknown; member?: PersonKey; demo?: boolean; headers?: Record<string, string>; params?: Record<string, string> },
): Promise<CallResult> {
  const headers: Record<string, string> = { "content-type": "application/json", ...init.headers };
  if (init.member) headers[MEMBER_HEADER] = init.member;
  if (init.demo) headers.authorization = `Bearer ${createSessionToken({ tenantId: "demo", kind: "demo" }).token}`;
  const req = new Request(`http://localhost/api/reports/v1${url}`, { method: init.method, headers, body: JSON.stringify(init.body) });
  const res = await bindHandler(handler, () => h.deps)(req, { params: init.params ?? {} });
  const type = res.headers.get("content-type") ?? "";
  if (/json/.test(type)) {
    const body = (await res.json()) as { code?: string };
    return { status: res.status, code: body?.code ?? null, body, bytes: null, headers: res.headers };
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { status: res.status, code: null, body: null, bytes, headers: res.headers };
}

export interface SignInput {
  report: Report;
  template: ReportTemplate;
  form: FormDefinition | null;
  signer: PersonKey;
  mode: "tenant" | "demo";
  /**
   * bh2 WA1 design 6: the referrer's file, sent as fileBase64 – the demo Studio sends it with every approval (required
   * there for a Word or PDF form); a clinic's /sign fills its stored copy and takes this one only when it holds none.
   */
  fileBytes?: Uint8Array | null;
}

/** POST /sign as `signer` (a member of the corpus clinic, or the demo's typed signer). */
export async function postSign(h: HttpHarness, input: SignInput): Promise<CallResult & { receipt: SignReceipt | null }> {
  const p = person(input.signer);
  // A member without a registration number still sends a signer: the server takes the signer from the sign-in.
  const signer = p.hcpc ? clinicianOf(input.signer) : clinicianOf("sarah");
  const body = {
    report: input.report,
    signer,
    typedSignature: p.hcpc ? p.name : signer.name,
    statementAccepted: true,
    attestations: [...input.template.attestations],
    ...(input.form ? { form: input.form } : {}),
    ...(input.form && input.form.kind !== "questions" && input.fileBytes ? { fileBase64: bytesToBase64(input.fileBytes) } : {}),
  };
  // bh2 WA1 design 6: a clinic approves only the revision it holds. Like the Studio, which saves the report before it asks
  // for approval, store it first when the clinic holds no revision of it – and take it out again afterwards, so the store
  // is as the case set it up. A revision the case stored itself (an edited or overtaken body) is left as it is.
  const seeded = input.mode === "tenant" && !(await h.store.getReport(CORPUS_TENANT, input.report.id));
  if (seeded) {
    const r = input.report;
    await h.store.createReport(CORPUS_TENANT, { id: r.id, status: r.status, templateId: r.templateId, formId: r.form?.formId ?? null, payload: r });
  }
  let res: CallResult;
  try {
    res = await call(h, handleSign, "/sign", { method: "POST", body, ...(input.mode === "tenant" ? { member: input.signer } : { demo: true }) });
  } finally {
    if (seeded) await h.store.deleteReport(CORPUS_TENANT, input.report.id);
  }
  const receipt = res.status === 200 ? ((res.body as { receipt?: SignReceipt }).receipt ?? null) : null;
  return { ...res, receipt };
}

export interface RenderInput {
  report: Report;
  receipt: SignReceipt;
  form: FormDefinition | null;
  fileBytes: Uint8Array | null;
  member: PersonKey;
  mode: "tenant" | "demo";
}

/** POST /render FINAL (requireFinal), the referrer's own file type for a form report, Word for a built-in one. */
export async function postRenderFinal(h: HttpHarness, input: RenderInput): Promise<CallResult> {
  const format = input.form ? "original" : "docx";
  const body = {
    report: input.report,
    receipt: input.receipt,
    requireFinal: true,
    ...(input.form ? { form: input.form } : {}),
    ...(input.fileBytes ? { fileBase64: bytesToBase64(input.fileBytes) } : {}),
  };
  return call(h, handleRender, `/render?format=${format}`, { method: "POST", body, ...(input.mode === "tenant" ? { member: input.member } : { demo: true }) });
}

/** PUT /store/reports/:id as `member` (If-Match the stored revision when there is one). */
export async function putStoredReport(h: HttpHarness, report: Report, member: PersonKey, rev: number | null): Promise<CallResult> {
  return call(h, handleStoreReportPut, `/store/reports/${report.id}`, {
    method: "PUT",
    body: { report },
    member,
    params: { id: report.id },
    headers: { origin: "http://localhost", ...(rev !== null ? { "if-match": `"${rev}"` } : {}) },
  });
}

/** GET /store/reports/:id as `member`. */
export async function getStoredReport(h: HttpHarness, id: string, member: PersonKey): Promise<CallResult> {
  const req = new Request(`http://localhost/api/reports/v1/store/reports/${id}`, { method: "GET", headers: { [MEMBER_HEADER]: member } });
  const res = await bindHandler(handleStoreReportGet, () => h.deps)(req, { params: { id } });
  const body = (await res.json()) as { code?: string };
  return { status: res.status, code: body?.code ?? null, body, bytes: null, headers: res.headers };
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  return btoa(s);
}
