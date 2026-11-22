import { spawn } from "node:child_process";
import sharp from "sharp";

/** Returns the metadata groups found in a *trusted* (re-encoded) output. Empty = clean (U-6, MED-001/002/003/021/039). */
export type MetadataVerifier = (output: Buffer, kind: "IMAGE" | "VIDEO") => Promise<string[]>;

export class VerifierUnavailable extends Error {}

/** Groups exiftool reports for any file (container/codec technical data, not user metadata). */
const ALLOWED_GROUPS = new Set(["System", "File", "ExifTool", "Composite", "RIFF", "PNG", "JFIF", "PNG-pHYs", "QuickTime", "Track1", "Track2", "Track3", "Movie", "MPEG", "H264"]);
/** QuickTime keys that can carry location or device data even inside the otherwise allowed groups. */
const FORBIDDEN_TAG = /^(GPS|Location|Make$|Model$|Software$|Artist|Copyright|Comment|Author|UserData|Keys|ItemList|com\.apple\.quicktime)/i;

export function runExiftool(input: Buffer, args: string[] = ["-j", "-G1", "-a", "-u", "-ee", "-"]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn("exiftool", args, { stdio: ["pipe", "pipe", "ignore"] });
    const out: Buffer[] = [];
    p.on("error", (e) => reject((e as NodeJS.ErrnoException).code === "ENOENT" ? new VerifierUnavailable("exiftool not installed") : e));
    p.stdout.on("data", (c) => out.push(c));
    p.on("close", () => resolve(Buffer.concat(out).toString("utf8")));
    p.stdin.on("error", () => undefined);
    p.stdin.end(input);
  });
}

/** Pure analysis of `exiftool -j -G1` output; exported for tests. */
export function forbiddenGroups(json: string): string[] {
  const found = new Set<string>();
  const rows = JSON.parse(json || "[]") as Record<string, unknown>[];
  for (const row of rows) {
    for (const k of Object.keys(row)) {
      const [group, tag = ""] = k.split(":");
      if (!ALLOWED_GROUPS.has(group!) || FORBIDDEN_TAG.test(tag)) found.add(group === "XMP-x" ? "XMP" : group!);
    }
  }
  return [...found];
}

export const exiftoolVerifier: MetadataVerifier = async (output) => forbiddenGroups(await runExiftool(output));

/**
 * Dev/CI fallback when exiftool is not installed (MEDIA_EXIFTOOL_REQUIRED=false only): sharp's own metadata view for images.
 * Weaker than exiftool, so production sets MEDIA_EXIFTOOL_REQUIRED=true and the worker image ships libimage-exiftool-perl.
 */
export const sharpVerifier: MetadataVerifier = async (output, kind) => {
  if (kind === "VIDEO") return [];
  const m = await sharp(output).metadata();
  return [m.exif && "EXIF", m.xmp && "XMP", m.iptc && "IPTC", m.icc && "ICC_Profile"].filter((x): x is string => !!x);
};

/** exiftool when available; fail closed when required, else fall back to the sharp check. */
export function defaultVerifier(required: boolean): MetadataVerifier {
  return async (b, kind) => {
    try {
      return await exiftoolVerifier(b, kind);
    } catch (e) {
      if (e instanceof VerifierUnavailable && !required) return sharpVerifier(b, kind);
      throw e;
    }
  };
}
