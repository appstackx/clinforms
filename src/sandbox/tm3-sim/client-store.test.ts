/**
 * Unit tests for the sandbox's browser record of filed documents, with a minimal window/localStorage
 * shim (no IndexedDB, so the metadata path and the change events are what is tested here).
 * Run: node --import tsx --test src/sandbox/tm3-sim/client-store.test.ts
 *
 * Owner: sandbox agent.
 */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string) {
    return this.map.has(k) ? (this.map.get(k) as string) : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
}

const target = new EventTarget();
const fakeWindow = {
  localStorage: new MemoryStorage(),
  addEventListener: target.addEventListener.bind(target),
  removeEventListener: target.removeEventListener.bind(target),
  dispatchEvent: target.dispatchEvent.bind(target),
};
(globalThis as unknown as { window: unknown }).window = fakeWindow;

// Imported after the window shim is in place.
let store: typeof import("./client-store");
before(async () => {
  store = await import("./client-store");
});

const receipt = {
  reportId: "rep-1",
  contentSha256: "c".repeat(64),
  signer: { name: "Sarah Reid", hcpc: "PH-DEMO-01" },
  signedAt: "2026-10-06T09:59:00.000Z",
};

describe("client-store", () => {
  beforeEach(() => fakeWindow.localStorage.clear());

  it("files a document, lists it per patient (newest first) and fires the change event", async () => {
    const events: Array<string | null> = [];
    const onChange = (e: Event) => events.push((e as CustomEvent<{ patientId: string | null }>).detail.patientId);
    fakeWindow.addEventListener(store.DOCUMENTS_CHANGED_EVENT, onChange);

    const blob = new Blob(["fictional bytes"], { type: "application/pdf" });
    const meta = await store.fileDocument({
      patientId: "sim-pat-001",
      episodeId: "sim-ep-1001",
      fileName: "report.pdf",
      mimeType: "application/pdf",
      blob,
      sha256: "a".repeat(64),
      receipt,
      externalDocumentId: "sim-doc-1",
      receivedAt: "2026-10-06T10:00:00.000Z",
    });
    assert.equal(meta.signedBy, "Sarah Reid");
    assert.equal(meta.sizeBytes, blob.size);
    assert.equal(meta.title, "report.pdf");

    await store.fileDocument({
      patientId: "sim-pat-001",
      fileName: "report.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      blob,
      sha256: "b".repeat(64),
      receipt,
      externalDocumentId: "sim-doc-2",
      receivedAt: "2026-10-06T11:00:00.000Z",
    });

    const docs = store.listDocuments("sim-pat-001");
    assert.deepEqual(
      docs.map((d) => d.externalDocumentId),
      ["sim-doc-2", "sim-doc-1"],
    );
    assert.deepEqual(store.listDocuments("sim-pat-002"), []);
    assert.deepEqual(store.countDocumentsByPatient(), { "sim-pat-001": 2 });
    assert.deepEqual(events, ["sim-pat-001", "sim-pat-001"]);
    fakeWindow.removeEventListener(store.DOCUMENTS_CHANGED_EVENT, onChange);
  });

  it("upserts by externalDocumentId", async () => {
    const blob = new Blob(["x"]);
    const base = {
      patientId: "sim-pat-002",
      fileName: "a.pdf",
      mimeType: "application/pdf",
      blob,
      sha256: "a".repeat(64),
      receipt,
      externalDocumentId: "sim-doc-9",
    };
    await store.fileDocument(base);
    await store.fileDocument({ ...base, title: "Renamed" });
    const docs = store.listSimulatedDocuments("sim-pat-002");
    assert.equal(docs.length, 1);
    assert.equal(docs[0].title, "Renamed");
  });

  it("ignores corrupt storage and clears everything", async () => {
    fakeWindow.localStorage.setItem("tm3sim.documents", "{not json");
    assert.deepEqual(store.listDocuments("sim-pat-001"), []);
    fakeWindow.localStorage.setItem("tm3sim.documents", JSON.stringify([{ nope: true }]));
    assert.deepEqual(store.listDocuments("sim-pat-001"), []);

    await store.fileDocument({
      patientId: "sim-pat-001",
      fileName: "a.pdf",
      mimeType: "application/pdf",
      blob: new Blob(["x"]),
      sha256: "a".repeat(64),
      receipt,
      externalDocumentId: "sim-doc-3",
    });
    let cleared = false;
    const unsubscribe = store.subscribeDocuments(() => {
      cleared = true;
    });
    await store.clearSimulatedDocuments();
    unsubscribe();
    assert.equal(cleared, true);
    assert.deepEqual(store.listDocuments("sim-pat-001"), []);
    assert.equal(await store.getSimulatedDocumentBlob("sim-doc-3"), null);
  });
});
