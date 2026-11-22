/**
 * Media fixture generator (M5-01). Everything is built in memory on demand: no binary blobs are committed and no real
 * malware is involved. EICAR is the standard harmless AV test string. Video fixtures need ffmpeg on PATH.
 *
 *   import { fixtures } from "../../../../test/fixtures/media/generate";
 *   const f = await fixtures.jpegWithGps();
 * CLI: `node --experimental-strip-types test/fixtures/media/generate.ts <outDir>` writes every fixture to files.
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// `sharp` is a dependency of apps/worker only; resolve it from there so this root-level file needs no package of its own.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sharp: any = createRequire(fileURLToPath(new URL("../../../apps/worker/package.json", import.meta.url)))("sharp");

export const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

const photo = (w = 1600, h = 1200) => sharp({ create: { width: w, height: h, channels: 3, background: "#3a7" } });
const GPS = { GPSVersionID: "2 3 0 0", GPSLatitudeRef: "N", GPSLatitude: "40/1 26/1 46/1", GPSLongitudeRef: "W", GPSLongitude: "79/1 58/1 56/1" };
/** Minimal stored (uncompressed) zip with one entry: enough for a `PK\x03\x04` polyglot. */
const tinyZip = () => Buffer.concat([Buffer.from("PK\x03\x04\x0a\0\0\0\0\0", "latin1"), Buffer.alloc(40, 0x41)]);

function ffmpeg(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", ["-nostdin", "-loglevel", "error", "-y", ...args], { cwd, stdio: "ignore" });
    p.on("error", reject);
    p.on("close", (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg exited ${c}`))));
  });
}
async function video(seconds: number, extra: string[] = [], size = "320x240", audio = true): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), "rp-fixture-"));
  try {
    await ffmpeg(["-f", "lavfi", "-i", `testsrc=size=${size}:rate=15:duration=${seconds}`, ...(audio ? ["-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`] : []), "-c:v", "libx264", "-pix_fmt", "yuv420p", ...(audio ? ["-c:a", "aac"] : []), ...extra, "out.mp4"], dir);
    return await readFile(path.join(dir, "out.mp4"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export const fixtures = {
  eicar: async () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(EICAR), Buffer.from([0xff, 0xd9])]), // MED-014 family: scanner must flag it
  jpeg: () => photo().jpeg().toBuffer(),
  /** MED-002: GPS + camera strings + Orientation 6 (pixels must come out rotated). */
  jpegWithGps: () => photo(1600, 1200).withExif({ IFD0: { Make: "PhoneCo", Model: "Pocket 9", Software: "fw-1.2" }, IFD3: GPS }).withMetadata({ orientation: 6 }).jpeg().toBuffer(),
  /** MED-003: PNG carrying XMP. */
  pngWithXmp: () => photo(800, 600).withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>secret-owner</dc:creator></rdf:Description></rdf:RDF></x:xmpmeta>').png().toBuffer(),
  webp: () => photo(640, 480).webp().toBuffer(),
  /** MED-006: tiny file declaring 64 MP (limit 50 MP). */
  imageBomb: () => sharp({ create: { width: 8000, height: 8000, channels: 3, background: "#000" } }).png({ compressionLevel: 9 }).toBuffer(),
  /** MED-007: valid JPEG with a second container appended. */
  jpegPlusZip: async () => Buffer.concat([await fixtures.jpeg(), tinyZip()]),
  jpegPlusPdf: async () => Buffer.concat([await fixtures.jpeg(), Buffer.from("%PDF-1.4\n%%EOF")]),
  jpegPlusSvg: async () => Buffer.concat([await fixtures.jpeg(), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>')]),
  jpegPlusPe: async () => {
    const stub = Buffer.alloc(0x100);
    stub.write("MZ", 0, "latin1");
    stub.writeUInt32LE(0x80, 0x3c);
    stub.write("PE\0\0", 0x80, "latin1");
    return Buffer.concat([await fixtures.jpeg(), stub]);
  },
  /** MED-009/010: types we never accept. */
  gif: async () => Buffer.from("GIF89a\x01\0\x01\0\x80\0\0\0\0\0\xff\xff\xff!\xf9\x04\x01\0\0\0\0,\0\0\0\0\x01\0\x01\0\0\x02\x02D\x01\0;", "latin1"),
  svg: async () => Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
  exe: async () => Buffer.concat([Buffer.from("MZ"), Buffer.alloc(200)]),
  /** Zip bomb stand-in: a zip whose first bytes are the local header (never expanded by us; ClamAV handles real bombs). */
  zip: async () => tinyZip(),
  truncatedJpeg: async () => (await fixtures.jpeg()).subarray(0, 300),
  /** MED-005: exactly 10 MiB, and one byte more. */
  jpegTenMiB: async () => {
    const j = await fixtures.jpeg();
    return Buffer.concat([j.subarray(0, j.length - 2), Buffer.alloc(10 * 1024 * 1024 - j.length, 0), Buffer.from([0xff, 0xd9])]);
  },
  /** Valid short MP4 with location + title metadata (MED-021). */
  videoWithLocation: () => video(3, ["-metadata", "location=+40.7128-074.0060/", "-metadata", "title=secret-owner", "-metadata:s:v", "handler_name=PhoneCo"]),
  /** MED-017: 30.0 s passes, 31 s does not. */
  video30s: () => video(30),
  video31s: () => video(31),
  /** MED-019: a file with two video streams. */
  videoTwoStreams: async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rp-fixture-"));
    try {
      await ffmpeg(["-f", "lavfi", "-i", "testsrc=size=160x120:rate=10:duration=2", "-f", "lavfi", "-i", "testsrc2=size=160x120:rate=10:duration=2", "-map", "0", "-map", "1", "-c:v", "libx264", "out.mp4"], dir);
      return await readFile(path.join(dir, "out.mp4"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
  /** MED-022: WebM is not accepted. */
  webm: async () => Buffer.from([0x1a, 0x45, 0xdf, 0xa3, ...Array(64).fill(0)]),
};
export type FixtureName = keyof typeof fixtures;
export const hasFfmpeg = () => new Promise<boolean>((r) => { const p = spawn("ffmpeg", ["-version"], { stdio: "ignore" }); p.on("error", () => r(false)); p.on("close", (c) => r(c === 0)); });

if (process.argv[1] && /generate\.ts$/.test(process.argv[1]) && process.argv[2]) {
  const out = process.argv[2];
  void (async () => {
    for (const [name, make] of Object.entries(fixtures)) {
      try {
        await writeFile(path.join(out, `${name}.bin`), await make());
      } catch (e) {
        console.error(`skip ${name}: ${(e as Error).message}`);
      }
    }
  })();
}
