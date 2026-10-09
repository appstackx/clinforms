import type { FormMimeType } from "../../core/types";

/** A referrer's original form file as the Studio holds it (re-exported by ui/store.ts). */
export interface StoredFormFile {
  sha256: string;
  fileName: string;
  mimeType: FormMimeType;
  bytes: Uint8Array;
}
