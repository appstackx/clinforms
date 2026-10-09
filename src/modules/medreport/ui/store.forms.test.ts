import { test } from "node:test";
import assert from "node:assert/strict";
import { deleteFormFile, getFormFile, listForms, saveForm, saveFormFile } from "./store";

// Node has no window/localStorage/indexedDB: the store must degrade, not throw.
test("forms library degrades without browser storage (memory fallback for files)", async () => {
  assert.deepEqual(listForms(), []);
  const bytes = new Uint8Array([1, 2, 3]);
  const persisted = await saveFormFile({ sha256: "f".repeat(64), fileName: "form.pdf", mimeType: "application/pdf", bytes });
  assert.equal(persisted, false, "kept in memory only");
  bytes[0] = 9; // the store keeps its own copy
  const file = await getFormFile("f".repeat(64));
  assert.deepEqual(Array.from(file?.bytes ?? []), [1, 2, 3]);
  await deleteFormFile("f".repeat(64));
  assert.equal(await getFormFile("f".repeat(64)), null);
  assert.equal(saveForm({} as never), false);
});
