"use client";

/**
 * The original file of a form map (this browser's IndexedDB, or a bundled sample downloaded and
 * checked against the map's SHA-256), plus a download helper.
 *
 * Owner: studio-a agent.
 */
import { useEffect, useState } from "react";
import type { FormDefinition } from "../../../core/types";
import { saveBlob } from "../../api-client";
import { getStoreMode, loadFormFile, type StoredFormFile } from "../../store";
import { TENANT_COPY } from "../../studio-copy";

export interface FormFileState {
  file: StoredFormFile | null;
  loading: boolean;
  /** Plain-English reason when the file is not available. */
  error: string | null;
}

export const MISSING_FILE_MESSAGE =
  "The original file is not stored in this browser. Upload the referrer's form again to preview, fill or download it.";

/** The missing-file message for the store in use (a clinic's Studio keeps files in the clinic's storage). */
export function missingFileMessage(): string {
  return getStoreMode() === "server" ? TENANT_COPY.files.missing : MISSING_FILE_MESSAGE;
}

export function useFormFile(form: Pick<FormDefinition, "file" | "sampleId"> | null): FormFileState {
  const [state, setState] = useState<FormFileState>({ file: null, loading: true, error: null });
  const sha = form?.file.sha256;
  const sampleId = form?.sampleId;
  const fileName = form?.file.fileName;
  const mimeType = form?.file.mimeType;
  const sizeBytes = form?.file.sizeBytes;

  useEffect(() => {
    if (!sha || !fileName || !mimeType) {
      setState({ file: null, loading: false, error: null });
      return;
    }
    const controller = new AbortController();
    setState({ file: null, loading: true, error: null });
    loadFormFile({ file: { sha256: sha, fileName, mimeType, sizeBytes: sizeBytes ?? 0 }, sampleId } as FormDefinition, {
      signal: controller.signal,
    }).then(
      (file) => {
        if (!controller.signal.aborted) setState({ file, loading: false, error: file ? null : missingFileMessage() });
      },
      () => {
        if (!controller.signal.aborted) setState({ file: null, loading: false, error: missingFileMessage() });
      },
    );
    return () => controller.abort();
  }, [sha, sampleId, fileName, mimeType, sizeBytes]);

  return state;
}

/** Download a stored original file. */
export function downloadStoredFile(file: StoredFormFile): void {
  saveBlob(new Blob([file.bytes.slice()], { type: file.mimeType }), file.fileName);
}
