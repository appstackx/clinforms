"use client";

/**
 * What the review screen does with the Report API: draft questions that are still pending, approve
 * (POST /sign), download the completed form (POST /render) and save it to the clinic record
 * (POST /connectors/{id}/documents, then the host keeps the browser copy for the simulated record).
 * A clinic's Studio also reports report_approved / report_downloaded through HostHooks.track (counts and
 * enumerated values only – ui/studio-events.ts).
 *
 * Owner: studio-b agent.
 */
import { useCallback, useRef, useState } from "react";
import type { RenderFormat, RenderRequest } from "../../../api/contract";
import { BATCH_CONCURRENCY, NOTICES } from "../../../config.public";
import { sha256HexBytes } from "../../../core/fingerprint";
import { planDraftGroups } from "../../../core/report-factory";
import type { FormDefinition, Report, ReportTemplate } from "../../../core/types";
import { ApiError, api, saveBlob, toBase64, type FileDownload } from "../../api-client";
import { flushStore } from "../../store";
import type { HostHooks } from "../../host-hooks";
import { TENANT_COPY } from "../../studio-copy";
import { downloadFormat, reportEventProps } from "../../studio-events";
import { WORDING } from "../../wording";
import { sessionTokenFor } from "../shared/session";
import type { ApproveInput, ApproveResult } from "./approve-dialog";
import type { FormFileState } from "./preview-panel";
import { markApproved } from "./review-model";
import type { Toast } from "./review-ui";
import type { ReviewAction } from "./use-review-state";

export type DownloadKind = "original" | "pdf" | "docx";

export interface DraftFailure {
  keys: string[];
  message: string;
  code: string;
}

export interface ReviewActions {
  approve(input: ApproveInput): Promise<ApproveResult>;
  download(kind: DownloadKind): Promise<void>;
  downloading: DownloadKind | null;
  /** Shown under the PDF button when Word → PDF cannot run on this deployment. */
  pdfUnavailable: string | null;
  saveToRecord(): Promise<void>;
  filing: boolean;
  draft(keys: string[] | null, prefer?: "auto" | "demo"): Promise<void>;
  draftingKeys: Set<string>;
  draftFailures: DraftFailure[];
}

const CONNECTOR_LABELS: Record<string, string> = {
  "tm3-sim": "Simulated TM3",
  tm3: "TM3",
  "file-import": "uploaded export",
};

function problemText(err: unknown, fallback: string): { title: string; detail?: string; code: string } {
  if (err instanceof ApiError) return { title: err.problem.title, detail: err.problem.detail, code: err.code };
  return { title: fallback, code: "ERROR" };
}

export function useReviewActions(opts: {
  report: Report;
  form: FormDefinition | null;
  template: ReportTemplate | null;
  file: FormFileState;
  actor: string;
  hooks: HostHooks;
  dispatch(action: ReviewAction): void;
  commit(next: Report): boolean;
  validateNow(): Report;
  toast(t: Omit<Toast, "id">): void;
}): ReviewActions {
  const { report, form, template, file, actor, hooks, dispatch, commit, validateNow, toast } = opts;
  const isForm = Boolean(report.form);
  const [downloading, setDownloading] = useState<DownloadKind | null>(null);
  const [pdfUnavailable, setPdfUnavailable] = useState<string | null>(null);
  const [filing, setFiling] = useState(false);
  const [draftingKeys, setDraftingKeys] = useState<Set<string>>(new Set());
  const [draftFailures, setDraftFailures] = useState<DraftFailure[]>([]);
  const reportRef = useRef(report);
  reportRef.current = report;

  /* Approve ------------------------------------------------------------------------------------- */

  const approve = useCallback(
    async (input: ApproveInput): Promise<ApproveResult> => {
      const fresh = validateNow();
      try {
        // Approval is authenticated: the tab's launch session for this patient (bound to the clinician
        // the clinic system opened it for), else a demo-tenant session.
        const { connectorId, patientId, episodeId } = fresh.episodeRef;
        const sessionToken = await sessionTokenFor({ tenantId: fresh.tenantId, connectorId, patientId, episodeId });
        const res = await api.sign({ report: fresh, ...input, ...(form ? { form } : {}) }, { sessionToken });
        const approved = markApproved(fresh, res.receipt, res.flags, { isForm });
        // The approval must reach the store before the clinician moves on (a clinic's Studio: the server).
        const saved = commit(approved) && (await flushStore());
        hooks.track?.("report_approved", reportEventProps(approved));
        toast({
          tone: "success",
          title: isForm ? "Form approved" : "Report signed",
          detail: saved
            ? "The server signed a receipt over the approved content. The final completed document is ready to download and save to the record."
            : hooks.mode === "tenant"
              ? TENANT_COPY.review.approveSavedFailed
              : "Approved, but this browser could not save the change. Download the completed form now.",
        });
        return { ok: true };
      } catch (err) {
        if (err instanceof ApiError) {
          const p = err.problem;
          if (err.code === "SIGNOFF_BLOCKED") return { ok: false, title: "Blocking items remain", detail: p.detail, blocking: p.flags };
          if (err.code === "VALIDATION_FAILED") return { ok: false, title: p.title, detail: p.detail, issues: (p.issues ?? []).map((i) => i.message) };
          if (err.code === "SIGNER_MISMATCH" || err.code === "SESSION_MISMATCH" || err.code === "FORM_NOT_CONFIRMED" || err.code === "FORM_MISMATCH") {
            return { ok: false, title: p.title, detail: p.detail };
          }
          return { ok: false, title: p.title, detail: p.detail ?? (err.retryable ? "Please try again." : undefined) };
        }
        return { ok: false, title: "The approval could not be completed", detail: "Check your connection and try again." };
      }
    },
    [validateNow, form, isForm, commit, toast, hooks],
  );

  /* Render -------------------------------------------------------------------------------------- */

  const render = useCallback(
    async (kind: DownloadKind, final: boolean): Promise<FileDownload> => {
      const current = reportRef.current;
      const body: RenderRequest = { report: current };
      if (final && current.receipt) {
        body.receipt = current.receipt;
        body.requireFinal = true;
      }
      if (isForm) {
        if (!form) throw new Error(hooks.mode === "tenant" ? TENANT_COPY.files.mapMissing : "The form map is not in this browser.");
        body.form = form;
        // A portal question set has no file: the server renders its summary PDF from the answers.
        if (form.kind !== "questions") {
          if (file.status !== "ready") throw new Error(hooks.mode === "tenant" ? TENANT_COPY.files.fileMissing : "The referrer's original file is not in this browser.");
          body.fileBase64 = file.base64;
        }
      }
      const format: RenderFormat = kind;
      return api.render(format, body);
    },
    [isForm, form, file, hooks.mode],
  );

  const download = useCallback(
    async (kind: DownloadKind) => {
      const current = reportRef.current;
      const final = current.status === "signed" && Boolean(current.receipt);
      setDownloading(kind);
      try {
        const out = await render(kind, final);
        saveBlob(out.blob, out.fileName);
        if (out.kind === "final") {
          const { form_kind, referrer_type, source } = reportEventProps(current);
          hooks.track?.("report_downloaded", { format: downloadFormat(out.contentType), form_kind, referrer_type, source });
        }
        dispatch({
          type: "activity",
          action: "rendered",
          actor,
          detail: `Downloaded ${out.kind === "final" ? "the FINAL" : "a DRAFT"} ${out.contentType.includes("pdf") ? "PDF" : "Word file"}: ${out.fileName}.`,
        });
        toast({
          tone: "success",
          title: out.kind === "final" ? "Final document downloaded" : "Draft downloaded",
          detail: out.warnings.length ? out.warnings.join(" ") : out.fileName,
        });
      } catch (err) {
        if (err instanceof ApiError && err.code === "PDF_CONVERSION_UNAVAILABLE") {
          const message = err.problem.detail ?? NOTICES.pdfConversionUnavailable;
          setPdfUnavailable(message);
          toast({ tone: "info", title: "PDF copy not available here", detail: message });
        } else {
          const p = err instanceof Error && !(err instanceof ApiError) ? { title: err.message } : problemText(err, "The download failed");
          toast({ tone: "error", title: p.title, detail: "detail" in p ? p.detail : undefined });
        }
      } finally {
        setDownloading(null);
      }
    },
    [render, dispatch, actor, toast, hooks],
  );

  /* Save to clinic record --------------------------------------------------------------------- */

  const saveToRecord = useCallback(async () => {
    const current = reportRef.current;
    const receipt = current.receipt;
    if (!receipt || current.status !== "signed") return;
    const { connectorId, patientId, episodeId } = current.episodeRef;
    if (connectorId !== "tm3-sim") {
      toast({
        tone: "info",
        title: "Not connected for filing",
        detail:
          connectorId === "file-import"
            ? "This report was made from an uploaded export, so there is no clinic system to file it to. Download the completed form and attach it to the patient record."
            : "Filing to TM3 needs the live TM3 connection (partner access). Download the completed form and attach it to the patient record.",
      });
      return;
    }
    setFiling(true);
    try {
      const sessionToken = await sessionTokenFor({ tenantId: current.tenantId, connectorId, patientId, episodeId });
      const baseTitle = isForm ? `${current.form?.title ?? "Completed form"} – ${current.form?.referrer.name ?? current.instructingParty.name}` : template?.documentTitle ?? "Report";

      /** File one FINAL rendition (the server's file token ties these exact bytes to this approval). */
      const fileOne = async (out: FileDownload): Promise<string> => {
        if (out.kind !== "final" || !out.fileToken) throw new Error("Only the final, approved document can be filed.");
        const bytes = new Uint8Array(await out.blob.arrayBuffer());
        const sha256 = await sha256HexBytes(bytes);
        const contentBase64 = await toBase64(out.blob);
        const isPdf = out.contentType.includes("pdf");
        const mimeType = isPdf ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        const title = `${baseTitle} (${isPdf ? "PDF" : "Word"})`;
        const res = await api.attachDocument(
          connectorId,
          { patientId, episodeId, title, fileName: out.fileName, mimeType, contentBase64, sha256, signReceipt: receipt, fileToken: out.fileToken },
          { sessionToken },
        );
        let browserCopy = true;
        try {
          await hooks.onDocumentFiled?.({
            connectorId,
            patientId,
            episodeId,
            reportId: current.id,
            title,
            fileName: out.fileName,
            mimeType,
            bytes: out.blob,
            attachReceipt: res.attachReceipt,
            signReceipt: receipt,
          });
        } catch {
          browserCopy = false;
        }
        dispatch({
          type: "activity",
          action: "filed",
          actor,
          detail: `Saved “${out.fileName}” to the ${CONNECTOR_LABELS[connectorId]} record (document ${res.attachReceipt.externalDocumentId}, SHA-256 ${res.attachReceipt.sha256.slice(0, 12)}…).${browserCopy ? "" : " This browser could not keep a copy for the simulated record."}`,
        });
        return out.fileName;
      };

      // The referrer's own format first (Word in → Word; PDF in → PDF), then the PDF copy of a Word
      // file where this deployment can convert it – clinics usually send the PDF to the referrer.
      const filedNames: string[] = [];
      const primaryKind: DownloadKind = isForm ? "original" : "docx";
      filedNames.push(await fileOne(await render(primaryKind, true)));
      const wantsPdfCopy = isForm ? current.form?.kind === "docx" : true;
      let pdfNote: string | null = null;
      if (wantsPdfCopy) {
        try {
          filedNames.push(await fileOne(await render("pdf", true)));
        } catch (err) {
          if (err instanceof ApiError && err.code === "PDF_CONVERSION_UNAVAILABLE") {
            pdfNote = "The PDF copy is made on the production converter; the Word file was filed.";
            setPdfUnavailable(err.problem.detail ?? NOTICES.pdfConversionUnavailable);
          } else {
            throw err;
          }
        }
      }
      const href = hooks.clinicRecordUrl?.({ connectorId, patientId }) ?? null;
      toast({
        tone: "success",
        title: "Filed to the Simulated TM3 record (stored in this browser)",
        detail: `${filedNames.join(" and ")}${pdfNote ? `. ${pdfNote}` : ""}`,
        ...(href ? { action: { label: "Open the patient record", href } } : {}),
      });
    } catch (err) {
      const p = err instanceof Error && !(err instanceof ApiError) ? { title: err.message, detail: undefined } : problemText(err, "Saving to the clinic record failed");
      toast({ tone: "error", title: p.title, detail: p.detail });
    } finally {
      setFiling(false);
    }
  }, [render, isForm, template, hooks, dispatch, actor, toast]);

  /* Drafting (pending questions, retries) ------------------------------------------------------ */

  const draft = useCallback(
    async (keys: string[] | null, prefer: "auto" | "demo" = "auto") => {
      const current = reportRef.current;
      if (!template || current.status === "signed") return;
      const wanted = new Set(keys ?? current.sections.filter((s) => s.status === "pending").map((s) => s.key));
      const groups = planDraftGroups(current, template)
        .map((g) => g.filter((k) => wanted.has(k)))
        .filter((g) => g.length > 0);
      if (groups.length === 0) return;
      setDraftFailures((list) => list.filter((f) => !f.keys.some((k) => wanted.has(k))));
      setDraftingKeys((prev) => new Set(Array.from(prev).concat(groups.flat())));
      const queue = groups.slice();
      const worker = async () => {
        while (queue.length > 0) {
          const group = queue.shift();
          if (!group) break;
          try {
            const res = await api.drafts({
              templateId: current.templateId,
              bundle: current.bundleSnapshot,
              instructingParty: current.instructingParty,
              sectionKeys: group,
              prefer,
              ...(form ? { form } : {}),
              ...(form && current.author ? { author: current.author } : {}),
            });
            dispatch({ type: "applyDraft", result: res });
          } catch (err) {
            const p = problemText(err, "Drafting failed");
            setDraftFailures((list) => [...list, { keys: group, message: p.detail ? `${p.title}: ${p.detail}` : p.title, code: p.code }]);
            dispatch({ type: "activity", action: "draft_failed", actor: "System", detail: `Drafting ${group.join(", ")} failed (${WORDING.drafting.failureCode(p.code)}).` });
          } finally {
            setDraftingKeys((prev) => {
              const next = new Set(prev);
              group.forEach((k) => next.delete(k));
              return next;
            });
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(BATCH_CONCURRENCY, groups.length) }, worker));
    },
    [template, form, dispatch],
  );

  return { approve, download, downloading, pdfUnavailable, saveToRecord, filing, draft, draftingKeys, draftFailures };
}
