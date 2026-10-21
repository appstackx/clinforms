/**
 * A minimal ZIP writer for the converted Word file: entries are STORED (no compression), with fixed
 * dates, in the order given – so the same input always gives the same bytes (and the same SHA-256) in
 * every browser and in Node. Word, LibreOffice, docx-preview, PizZip and forms/zip-guard.ts all read
 * stored entries.
 *
 * Browser-safe and pure.
 */

let CRC_TABLE: Uint32Array | null = null;

function crcTable(): Uint32Array {
  if (CRC_TABLE) return CRC_TABLE;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  CRC_TABLE = table;
  return table;
}

export function crc32(bytes: Uint8Array): number {
  const table = crcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

/** DOS date 1980-01-01, time 00:00. */
const DOS_DATE = 0x0021;
const DOS_TIME = 0x0000;

/** Build a ZIP archive with stored entries. */
export function zipStored(entries: ZipEntry[]): Uint8Array {
  const enc = new TextEncoder();
  const names = entries.map((e) => enc.encode(e.name));
  const crcs = entries.map((e) => crc32(e.data));
  let localSize = 0;
  for (let i = 0; i < entries.length; i++) localSize += 30 + names[i].length + entries[i].data.length;
  let centralSize = 0;
  for (let i = 0; i < entries.length; i++) centralSize += 46 + names[i].length;
  const out = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(out.buffer);
  let p = 0;
  const offsets: number[] = [];
  for (let i = 0; i < entries.length; i++) {
    const data = entries[i].data;
    offsets.push(p);
    view.setUint32(p, 0x04034b50, true);
    view.setUint16(p + 4, 20, true); // version needed
    view.setUint16(p + 6, 0, true); // flags
    view.setUint16(p + 8, 0, true); // method: stored
    view.setUint16(p + 10, DOS_TIME, true);
    view.setUint16(p + 12, DOS_DATE, true);
    view.setUint32(p + 14, crcs[i], true);
    view.setUint32(p + 18, data.length, true);
    view.setUint32(p + 22, data.length, true);
    view.setUint16(p + 26, names[i].length, true);
    view.setUint16(p + 28, 0, true);
    out.set(names[i], p + 30);
    out.set(data, p + 30 + names[i].length);
    p += 30 + names[i].length + data.length;
  }
  const centralStart = p;
  for (let i = 0; i < entries.length; i++) {
    const data = entries[i].data;
    view.setUint32(p, 0x02014b50, true);
    view.setUint16(p + 4, 20, true); // version made by
    view.setUint16(p + 6, 20, true); // version needed
    view.setUint16(p + 8, 0, true);
    view.setUint16(p + 10, 0, true);
    view.setUint16(p + 12, DOS_TIME, true);
    view.setUint16(p + 14, DOS_DATE, true);
    view.setUint32(p + 16, crcs[i], true);
    view.setUint32(p + 20, data.length, true);
    view.setUint32(p + 24, data.length, true);
    view.setUint16(p + 28, names[i].length, true);
    view.setUint16(p + 30, 0, true); // extra
    view.setUint16(p + 32, 0, true); // comment
    view.setUint16(p + 34, 0, true); // disk
    view.setUint16(p + 36, 0, true); // internal attributes
    view.setUint32(p + 38, 0, true); // external attributes
    view.setUint32(p + 42, offsets[i], true);
    out.set(names[i], p + 46);
    p += 46 + names[i].length;
  }
  view.setUint32(p, 0x06054b50, true);
  view.setUint16(p + 4, 0, true);
  view.setUint16(p + 6, 0, true);
  view.setUint16(p + 8, entries.length, true);
  view.setUint16(p + 10, entries.length, true);
  view.setUint32(p + 12, p - centralStart, true);
  view.setUint32(p + 16, centralStart, true);
  view.setUint16(p + 20, 0, true);
  return out;
}
