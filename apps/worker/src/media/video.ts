import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runSandboxed } from "./sandbox";
import { MEDIA_MAX_VIDEO_SECONDS, MEDIA_MAX_VIDEO_SIDE, type MediaFailureReason } from "@rp/core";

export class VideoReject extends Error {
  constructor(public reason: MediaFailureReason, public subReason?: string) {
    super(reason);
  }
}

/** SEC-M5-01: every ffmpeg/ffprobe call goes through the bwrap + prlimit sandbox (media/sandbox.ts); paths are relative to the job dir. */
const run = (cmd: string, args: string[], cwd: string, timeoutMs: number) => runSandboxed("video", cwd, cmd, args, timeoutMs);
/** Forced demuxer (ISO-BMFF only: mp4/mov were already identified by `ftyp`), so a hostile file cannot make ffmpeg probe into another format. */
const FORCED_DEMUXER = ["-f", "mov"];

interface Probe {
  format?: { duration?: string; format_name?: string };
  streams?: { codec_type?: string; codec_name?: string; width?: number; height?: number; duration?: string; profile?: string; tags?: Record<string, string>; side_data_list?: { rotation?: number }[] }[];
}
const probe = async (file: string, cwd: string): Promise<Probe> => {
  const r = await run("ffprobe", ["-v", "error", "-protocol_whitelist", "file", ...FORCED_DEMUXER, "-show_format", "-show_streams", "-of", "json", file], cwd, 30_000);
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
 * Every ffmpeg/ffprobe process runs in the bwrap + prlimit sandbox with no network, `-protocol_whitelist file` and a forced demuxer.
 */
export async function transcodeVideo(original: Buffer): Promise<VideoOutput> {
  const dir = await mkdtemp(path.join(tmpdir(), "rp-video-"));
  try {
    const src = "original"; // relative to the job dir (bound as /job in the sandbox)
    await writeFile(path.join(dir, src), original);
    const info = checkProbe(await probe(src, dir));
    const out = "video.mp4";
    const args = [
      "-nostdin", "-hide_banner", "-loglevel", "error", "-protocol_whitelist", "file", ...FORCED_DEMUXER, "-i", src,
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
      const r = await run("ffmpeg", ["-nostdin", "-loglevel", "error", "-protocol_whitelist", "file", ...FORCED_DEMUXER, "-ss", at, "-i", out, "-frames:v", "1", "-vf", `scale='min(${width},iw)':-2`, "-map_metadata", "-1", "-y", name], dir, 30_000);
      if (r.code !== 0) throw new Error("poster extraction failed");
      return readFile(path.join(dir, name));
    };
    return { video: await readFile(path.join(dir, out)), poster: await frame("poster.jpg", 960), posterThumb: await frame("poster_thumb.jpg", 320), width: w, height: h, durationMs: Math.round(info.duration * 1000) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
