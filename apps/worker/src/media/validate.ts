import { createHash } from "node:crypto";
import { sniffImageMime } from "@rp/core";

export const sha256Hex = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

export type DetectedType = { mime: "image/jpeg" | "image/png" | "image/webp" | "video/mp4" | "video/quicktime"; kind: "IMAGE" | "VIDEO" } | null;

/** Content-based type detection (the declared type and file name are never trusted). ISO-BMFF `ftyp` brand: `qt  ` = MOV, anything else mp4. */
export function detectType(b: Buffer): DetectedType {
  const img = sniffImageMime(b);
  if (img) return { mime: img, kind: "IMAGE" };
  if (b.length >= 12 && b.toString("latin1", 4, 8) === "ftyp") {
    const brand = b.toString("latin1", 8, 12);
    if (/^(isom|iso2|iso4|iso5|iso6|mp41|mp42|avc1|M4V |qt {2}|dash|MSNV)/.test(brand)) return { mime: brand === "qt  " ? "video/quicktime" : "video/mp4", kind: "VIDEO" };
  }
  return null;
}

const SIGNATURES: [string, Buffer][] = [
  ["zip", Buffer.from("PK\x03\x04", "latin1")],
  ["pdf", Buffer.from("%PDF-", "latin1")],
  ["svg", Buffer.from("<svg", "latin1")],
  ["script", Buffer.from("<script", "latin1")],
  ["xml", Buffer.from("<?xml", "latin1")],
  ["rar", Buffer.from("Rar!", "latin1")],
  ["7z", Buffer.from([0x37, 0x7a, 0xbc, 0xaf])],
];

/** MED-007: a second container signature after offset 0 (or a PE header) means a polyglot, not a photo. */
export function findPolyglot(b: Buffer): string | null {
  for (const [name, sig] of SIGNATURES) if (b.indexOf(sig, 1) !== -1) return name;
  // `MZ` stub with a PE header (e_lfanew points at "PE\0\0") anywhere after offset 0.
  let i = b.indexOf("MZ", 1, "latin1");
  while (i !== -1 && i + 0x40 <= b.length) {
    const pe = b.readUInt32LE(i + 0x3c);
    if (pe < 0x1000 && b.toString("latin1", i + pe, i + pe + 4) === "PE\0\0") return "pe";
    i = b.indexOf("MZ", i + 1, "latin1");
  }
  return null;
}
