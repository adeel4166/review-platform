import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MEDIA_MAX_VIDEO_SECONDS, MEDIA_MAX_VIDEO_SIDE, type MediaFailureReason } from "@rp/core";

export class VideoReject extends Error {
  constructor(public reason: MediaFailureReason, public subReason?: string) {
    super(reason);
  }
}

function run(cmd: string, args: string[], cwd: string, timeoutMs: number): Promise<{ code: number; out: string }> {
  return new Promise((resolve, reject) => {
    // No shell, fixed argv; the untrusted file is only ever a path argument. A kill on timeout bounds a hostile file.
    const p = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const t = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
    p.stdout.on("data", (c) => out.push(c));
    p.stderr.on("data", () => undefined);
    p.on("error", (e) => { clearTimeout(t); reject(e); });
    p.on("close", (code) => { clearTimeout(t); resolve({ code: code ?? -1, out: Buffer.concat(out).toString("utf8") }); });
  });
}

interface Probe {
  format?: { duration?: string; format_name?: string };
  streams?: { codec_type?: string; codec_name?: string; width?: number; height?: number; duration?: string; profile?: string; tags?: Record<string, string>; side_data_list?: { rotation?: number }[] }[];
}
const probe = async (file: string, cwd: string): Promise<Probe> => {
  const r = await run("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-of", "json", file], cwd, 30_000);
  if (r.code !== 0) throw new VideoReject("CORRUPT");
  return JSON.parse(r.out) as Probe;
};

const ALLOWED_CODECS = new Set(["h264", "hevc", "mpeg4"]);

/** Input validation on the *original* (MED-017/019/020/022). Pure over the ffprobe JSON, exported for tests. */
export function checkProbe(p: Probe) {
  const v = p.streams?.filter((s) => s.codec_type === "video") ?? [];
  const a = p.streams?.filter((s) => s.codec_type === "audio") ?? [];
  if (v.length !== 1 || a.length > 1) throw new VideoReject("UNSUPPORTED_CODEC", "STREAM_LAYOUT");
  if (!ALLOWED_CODECS.has(v[0]!.codec_name ?? "")) throw new VideoReject("UNSUPPORTED_CODEC");
  const durations = [Number(p.format?.duration), Number(v[0]!.duration)].filter((n) => Number.isFinite(n));
  if (!durations.length || durations.some((d) => d > MEDIA_MAX_VIDEO_SECONDS)) throw new VideoReject("TOO_LONG");
  if (Math.max(v[0]!.width ?? 0, v[0]!.height ?? 0) > MEDIA_MAX_VIDEO_SIDE) throw new VideoReject("TOO_MANY_PIXELS");
  return { duration: Math.min(...durations), hasAudio: a.length === 1 };
}

export interface VideoOutput { video: Buffer; poster: Buffer; posterThumb: Buffer; width: number; height: number; durationMs: number }

/**
 * media-pipeline 4.3: validate, then re-encode to H.264/AAC 720p with every input metadata stream dropped, rotation applied,
 * faststart. The poster is taken from the transcoded output. Temp files live in a private dir that is always removed.
 * (Process sandboxing with bwrap is a deployment concern, see docs/security/media-pipeline-runtime.md.)
 */
export async function transcodeVideo(original: Buffer): Promise<VideoOutput> {
  const dir = await mkdtemp(path.join(tmpdir(), "rp-video-"));
  try {
    const src = path.join(dir, "original");
    await writeFile(src, original);
    const info = checkProbe(await probe(src, dir));
    const out = path.join(dir, "video.mp4");
    const args = [
      "-nostdin", "-hide_banner", "-loglevel", "error", "-protocol_whitelist", "file", "-i", src,
      "-t", "30", "-map", "0:v:0", "-map", "0:a:0?", "-map_metadata", "-1", "-map_chapters", "-1", "-sn", "-dn",
      "-vf", "scale='min(1280,iw)':'min(1280,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,format=yuv420p",
      "-c:v", "libx264", "-profile:v", "high", "-preset", "veryfast", "-crf", "26", "-c:a", "aac", "-b:a", "96k",
      "-movflags", "+faststart", "-fflags", "+bitexact", "-flags:v", "+bitexact", "-flags:a", "+bitexact", "-y", out,
    ];
    if ((await run("ffmpeg", args, dir, 280_000)).code !== 0) throw new VideoReject("CORRUPT");
    const o = await probe(out, dir);
    const vs = o.streams?.find((s) => s.codec_type === "video");
    const w = vs?.width ?? 0, h = vs?.height ?? 0;
    const dur = Number(o.format?.duration);
    if (vs?.codec_name !== "h264" || Math.max(w, h) > 1280 || Math.min(w, h) > 720 || !(dur <= 30.05)) throw new Error("transcode output failed verification");
    if (o.streams?.some((s) => s.codec_type && !["video", "audio"].includes(s.codec_type))) throw new Error("transcode output has extra streams");
    const at = dur < 2 ? "0" : "1";
    const frame = async (name: string, width: number) => {
      const f = path.join(dir, name);
      const r = await run("ffmpeg", ["-nostdin", "-loglevel", "error", "-ss", at, "-i", out, "-frames:v", "1", "-vf", `scale='min(${width},iw)':-2`, "-map_metadata", "-1", "-y", f], dir, 30_000);
      if (r.code !== 0) throw new Error("poster extraction failed");
      return readFile(f);
    };
    return { video: await readFile(out), poster: await frame("poster.jpg", 960), posterThumb: await frame("poster_thumb.jpg", 320), width: w, height: h, durationMs: Math.round(info.duration * 1000) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
