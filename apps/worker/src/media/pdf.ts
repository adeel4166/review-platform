import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { MediaFailureReason } from "@rp/core";
import { runSandboxed } from "./sandbox";

/** MED-024 / MED-046: purchase-proof PDFs. At most 20 pages; encrypted or unparseable -> CORRUPT. Never stored under a public key. */
export const PDF_MAX_PAGES = 20;

export class PdfReject extends Error {
  constructor(public reason: MediaFailureReason, public subReason?: string) {
    super(reason);
  }
}

/**
 * Cheap pre-check on the raw bytes (no parser runs): rejects encrypted files and an obvious page overflow before anything
 * decodes them. The authoritative page count comes from `pdfinfo` in the sandbox (`rasterisePdf`).
 */
export function inspectPdf(b: Buffer): { pagesHint: number } {
  if (b.subarray(0, 5).toString("latin1") !== "%PDF-") throw new PdfReject("CORRUPT");
  const text = b.toString("latin1");
  if (/\/Encrypt\b/.test(text)) throw new PdfReject("CORRUPT", "PDF_ENCRYPTED");
  const typePages = (text.match(/\/Type\s*\/Page(?![A-Za-z])/g) ?? []).length;
  const counts = [...text.matchAll(/\/Count\s+(\d{1,6})\b/g)].map((m) => Number(m[1]));
  const pagesHint = Math.max(typePages, ...counts, 0);
  if (pagesHint > PDF_MAX_PAGES) throw new PdfReject("TOO_LONG", "PDF_PAGES");
  return { pagesHint };
}

export type PdfRasteriser = (pdf: Buffer) => Promise<Buffer[]>;

/** pdfinfo (page count, encryption) then `pdftoppm -r 150 -png` per page, both in the parser sandbox. Pages come back as PNG buffers. */
export const rasterisePdf: PdfRasteriser = async (pdf) => {
  inspectPdf(pdf);
  const dir = await mkdtemp(path.join(tmpdir(), "rp-pdf-"));
  try {
    await writeFile(path.join(dir, "in.pdf"), pdf);
    const info = await runSandboxed("pdf", dir, "pdfinfo", ["in.pdf"], 60_000);
    if (info.code !== 0) throw new PdfReject("CORRUPT");
    if (/^Encrypted:\s+yes/im.test(info.out)) throw new PdfReject("CORRUPT", "PDF_ENCRYPTED");
    const pages = Number(/^Pages:\s+(\d+)/im.exec(info.out)?.[1]);
    if (!Number.isInteger(pages) || pages < 1) throw new PdfReject("CORRUPT");
    if (pages > PDF_MAX_PAGES) throw new PdfReject("TOO_LONG", "PDF_PAGES");
    const r = await runSandboxed("pdf", dir, "pdftoppm", ["-r", "150", "-png", "-l", String(PDF_MAX_PAGES), "in.pdf", "p"], 60_000 * PDF_MAX_PAGES);
    if (r.code !== 0) throw new PdfReject("CORRUPT");
    const files = (await readdir(dir)).filter((f) => /^p-\d+\.png$/.test(f)).sort();
    if (files.length !== pages) throw new PdfReject("CORRUPT");
    return Promise.all(files.map((f) => readFile(path.join(dir, f))));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};
