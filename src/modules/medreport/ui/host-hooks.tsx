"use client";

/**
 * Host integration points. The module never imports the host app or the sandbox; instead the host
 * (src/app/reports/medreport-host.tsx for the public demo, src/app/app/studio/tenant-host.tsx for a
 * clinic's own Studio) provides these callbacks and settings through <HostHooksProvider>.
 *
 * Example: after a successful POST /connectors/{id}/documents, the review screen calls
 * `onDocumentFiled` so the host can keep the signed file in the simulated TM3 record held in this
 * browser ("stored in this browser – simulated record").
 *
 * Shared contract (orchestrator-owned): additive optional hooks only.
 */
import { Fragment, createContext, useContext, type ReactNode } from "react";
import type { AttachReceipt, ConnectorId, SignReceipt } from "../core/types";
import { setStoreMode, setStoreScope } from "./store/mode";

export interface FiledDocument {
  connectorId: ConnectorId;
  /** External IDs in the clinic system. */
  patientId: string;
  episodeId: string;
  reportId: string;
  title: string;
  fileName: string;
  mimeType: string;
  bytes: Blob;
  /** Receipt from the clinic system (externalDocumentId, receivedAt, sha256). */
  attachReceipt: AttachReceipt;
  signReceipt: SignReceipt;
}

/**
 * Which Studio this is (wave 2):
 * - "demo"   – the public demo at /reports: fictional data, browser storage, Simulated TM3, demo tools;
 * - "tenant" – a clinic's own Studio at /app/studio for a signed-in member: no demo-only UI, notes
 *              upload as the source, neutral production copy.
 */
export type StudioMode = "demo" | "tenant";

/** The signed-in member's clinic (tenant mode; worked out by the host on the server, never from the browser). */
export interface StudioClinic {
  /** The clinic's id (organization slug = tenantId). */
  tenantId: string;
  /** Name shown in the Studio header. */
  name: string;
  /** Drafting from the notes is switched on for this clinic (clinic_profile.drafting_enabled). */
  draftingEnabled?: boolean;
}

/** The signed-in member (tenant mode). Their signing details are the default signer on approvals. */
export interface StudioMember {
  name: string;
  /** The member's account id (fix wave 2): scopes the Studio's in-memory records to this member. Not a secret. */
  userId?: string;
  /** The member's role in the clinic (fix wave 2): staff prepare reports but never approve. */
  role?: "owner" | "admin" | "clinician" | "staff";
  email?: string;
  /** The role as the host words it ("Clinician"). */
  roleLabel?: string;
  /** Signing details from the member's clinic profile. */
  hcpc?: string;
  jobTitle?: string;
  canSign?: boolean;
}

/**
 * Product events the Studio reports through `HostHooks.track` (the host's allow-listed analytics). Every
 * property is an enumerated value, a small count or a boolean – never a name, an id, a file name or text
 * from a record (ui/studio-events.ts builds them).
 */
export type StudioEvent = "form_uploaded" | "form_confirmed" | "draft_completed" | "report_approved" | "report_downloaded";

export interface StudioEventProps {
  source?: "clinic_system" | "simulated_clinic_system" | "export_upload" | "notes_pdf";
  form_kind?: "docx" | "pdf_fillable" | "pdf_flat" | "questions";
  format?: "docx" | "pdf";
  mode?: "demo" | "live";
  referrer_type?: "insurer" | "medico_legal" | "solicitor" | "case_manager" | "employer" | "other";
  question_count?: number;
  answer_count?: number;
  gap_count?: number;
  duration_s?: number;
  batch?: boolean;
}

export interface HostHooks {
  /** A signed document was written back; keep a browser copy for the (simulated) clinic record. */
  onDocumentFiled?(doc: FiledDocument): Promise<void> | void;
  /** "Reset demo" was pressed; clear any host-side demo state too. */
  onResetDemo?(): Promise<void> | void;
  /** URL of the clinic-system record to link back to, if the host knows one. */
  clinicRecordUrl?(ref: { connectorId: ConnectorId; patientId: string }): string | null;

  /* Wave 2 (additive, optional): the same screens serve the public demo and a clinic's own Studio. ---- */

  /** Where the Studio is mounted (ui/routes.ts useStudioPaths). Default "/reports". */
  basePath?: string;
  /** Default "demo". "tenant" hides every demo-only control and wording. */
  mode?: StudioMode;
  /**
   * Where reports and form maps are kept (read by ui/store.ts; <HostHooksProvider> applies it). Default "browser"
   * (the public demo). "server" = the signed-in clinic's storage (/api/reports/v1/store/**); nothing from a report
   * or form map is then written to browser storage.
   */
  storage?: "browser" | "server";
  /** Tenant mode: the active clinic. */
  clinic?: StudioClinic;
  /** Tenant mode: the signed-in member (the default signer and the name on activity entries). */
  member?: StudioMember;
  /** Product analytics (tenant mode only; the host's consent-gated, allow-listed tracker). */
  track?(event: StudioEvent, props?: StudioEventProps): void;
  /** Tenant mode: the clinic's own pages (overview and settings), linked from the header. */
  accountHref?: string;
  /** Tenant mode: sign the member out (the host redirects). */
  onSignOut?(): Promise<void> | void;
  /** Tenant mode (fix wave 2): where a clinic asks for help (e.g. setting up its practice system's notes layout). */
  supportEmail?: string;
}

const HostHooksContext = createContext<HostHooks>({});

export function HostHooksProvider({ hooks, children }: { hooks: HostHooks; children: ReactNode }) {
  // The store backend must be chosen before any child reads the store (children render after this line).
  setStoreMode(hooks.storage ?? "browser");
  // A clinic's Studio: its records in memory belong to this clinic and member only. Another scope (a different
  // sign-in or clinic without a full page load) empties them, and the screens below remount and load afresh.
  const scope = hooks.storage === "server" && hooks.clinic ? { tenantId: hooks.clinic.tenantId, userId: hooks.member?.userId ?? null } : null;
  if (hooks.storage === "server") setStoreScope(scope);
  const scopeKey = scope ? `${scope.tenantId}|${scope.userId ?? ""}` : "browser";
  return (
    <HostHooksContext.Provider value={hooks}>
      <Fragment key={scopeKey}>{children}</Fragment>
    </HostHooksContext.Provider>
  );
}

export function useHostHooks(): HostHooks {
  return useContext(HostHooksContext);
}

/** "demo" unless the host mounted the Studio for a clinic. */
export function useStudioMode(): StudioMode {
  return useContext(HostHooksContext).mode === "tenant" ? "tenant" : "demo";
}
