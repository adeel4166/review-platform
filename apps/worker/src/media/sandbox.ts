import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import path from "node:path";

/**
 * U-1 / SEC-M5-01 / MED-035 / MED-047: every decoder of untrusted bytes (ffmpeg, ffprobe, pdfinfo, pdftoppm) runs under
 * `bwrap --unshare-all` (no network, read-only root, private /job dir) wrapped in `prlimit` (memory, CPU, file size, fds).
 * docs/security/media-pipeline-runtime.md section "Parser sandbox" describes the deployment side.
 */
export type SandboxKind = "image" | "video" | "pdf";

/** Limits per spec 8.4: AS bytes, CPU seconds, max written file bytes. */
export const SANDBOX_LIMITS: Record<SandboxKind, { as: number; cpu: number; fsize: number }> = {
  image: { as: 1.5 * 1024 ** 3, cpu: 30, fsize: 256 * 1024 ** 2 },
  video: { as: 2 * 1024 ** 3, cpu: 280, fsize: 512 * 1024 ** 2 },
  pdf: { as: 1024 ** 3, cpu: 60, fsize: 256 * 1024 ** 2 },
};

export class SandboxUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxUnavailable";
  }
}

type Env = Record<string, string | undefined>;

/** Startup default: required in production and CI, warning only in dev. An explicit MEDIA_SANDBOX_REQUIRED always wins. */
export function isSandboxRequired(env: Env): boolean {
  if (env.MEDIA_SANDBOX_REQUIRED === "true") return true;
  if (env.MEDIA_SANDBOX_REQUIRED === "false") return false;
  return env.NODE_ENV === "production" || env.CI === "true";
}

const which = (bin: string, env: Env): string | null => {
  for (const dir of (env.PATH ?? "").split(":")) {
    if (!dir) continue;
    try {
      accessSync(path.join(dir, bin), constants.X_OK);
      return path.join(dir, bin);
    } catch {
      /* next */
    }
  }
  return null;
};

export interface Wrapped { cmd: string; args: string[]; sandboxed: boolean }

/** Pure: the exact argv for one sandboxed command. `jobDir` is bound read-write as /job; everything else is read-only or absent. */
export function bwrapArgv(bwrap: string, prlimit: string, kind: SandboxKind, jobDir: string, cmd: string, args: string[]): Wrapped {
  const l = SANDBOX_LIMITS[kind];
  return {
    cmd: bwrap,
    sandboxed: true,
    args: [
      "--unshare-all", "--die-with-parent", "--new-session", "--cap-drop", "ALL",
      "--ro-bind", "/usr", "/usr", "--ro-bind-try", "/lib", "/lib", "--ro-bind-try", "/lib64", "/lib64", "--ro-bind-try", "/bin", "/bin", "--ro-bind-try", "/sbin", "/sbin",
      "--ro-bind-try", "/etc/ld.so.cache", "/etc/ld.so.cache", "--ro-bind-try", "/etc/alternatives", "/etc/alternatives", "--ro-bind-try", "/etc/fonts", "/etc/fonts",
      "--bind", jobDir, "/job", "--tmpfs", "/tmp", "--proc", "/proc", "--dev", "/dev", "--chdir", "/job",
      "--", prlimit, `--as=${Math.floor(l.as)}`, `--cpu=${l.cpu}`, `--fsize=${l.fsize}`, "--nofile=64", cmd, ...args,
    ],
  };
}

/** Wraps a command for the sandbox. Without bwrap: throws when MEDIA_SANDBOX_REQUIRED=true, otherwise runs unsandboxed (dev). */
export function wrapSandboxed(kind: SandboxKind, jobDir: string, cmd: string, args: string[], env: Env = process.env): Wrapped {
  const bwrap = which("bwrap", env);
  const prlimit = which("prlimit", env);
  if (bwrap && prlimit) return bwrapArgv(bwrap, prlimit, kind, jobDir, cmd, args);
  if (env.MEDIA_SANDBOX_REQUIRED === "true") throw new SandboxUnavailable("bwrap/prlimit not available and MEDIA_SANDBOX_REQUIRED=true");
  return { cmd, args, sandboxed: false };
}

export interface RunResult { code: number; out: string }
/** Runs a command with no shell, a kill timeout and a bounded stdout. Exported for tests. */
export function runCommand(cmd: string, args: string[], cwd: string, timeoutMs: number, maxOut = 16 * 1024 * 1024): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let n = 0;
    const t = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
    p.stdout.on("data", (c: Buffer) => { n += c.length; if (n <= maxOut) out.push(c); else p.kill("SIGKILL"); });
    p.stderr.on("data", () => undefined);
    p.on("error", (e) => { clearTimeout(t); reject(e); });
    p.on("close", (code) => { clearTimeout(t); resolve({ code: code ?? -1, out: Buffer.concat(out).toString("utf8") }); });
  });
}

/** Runs `cmd` inside the sandbox (or unsandboxed in dev). Paths in `args` must be relative to `jobDir`. */
export async function runSandboxed(kind: SandboxKind, jobDir: string, cmd: string, args: string[], timeoutMs: number, env: Env = process.env): Promise<RunResult> {
  const w = wrapSandboxed(kind, jobDir, cmd, args, env);
  return runCommand(w.cmd, w.args, jobDir, timeoutMs);
}

/** Probe run inside the sandbox: exit 3 = /usr writable, exit 4 = a non-loopback network interface exists, 0 = confined. */
export const SANDBOX_PROBE = ["/bin/sh", "-c", 'n=$(tail -n +3 /proc/net/dev | grep -v "^ *lo:" | wc -l); [ "$n" = 0 ] || exit 4; ( : > /usr/.probe ) 2>/dev/null && exit 3; exit 0'];

export type ProbeRunner = (cmd: string, args: string[]) => Promise<{ code: number }>;
export interface SelfTestResult { ok: boolean; sandboxed: boolean; problem?: string }

/**
 * MED-047 startup self-test. Runs the probe inside bwrap; bwrap missing, a reachable network or a writable /usr is a
 * failure. Callers exit 1 when `required` (MEDIA_SANDBOX_REQUIRED, default on in production/CI) and log a warning otherwise.
 */
export async function sandboxSelfTest(env: Env = process.env, run: ProbeRunner = (c, a) => runCommand(c, a, "/", 15_000)): Promise<SelfTestResult> {
  const bwrap = which("bwrap", env);
  const prlimit = which("prlimit", env);
  if (!bwrap || !prlimit) return { ok: false, sandboxed: false, problem: `${bwrap ? "prlimit" : "bwrap"} is not installed` };
  const dir = env.TMPDIR || "/tmp";
  const w = bwrapArgv(bwrap, prlimit, "image", dir, SANDBOX_PROBE[0]!, SANDBOX_PROBE.slice(1));
  let code: number;
  try {
    code = (await run(w.cmd, w.args)).code;
  } catch (e) {
    return { ok: false, sandboxed: false, problem: `sandbox probe could not run: ${(e as Error).message}` };
  }
  if (code === 4) return { ok: false, sandboxed: false, problem: "network is reachable inside the sandbox" };
  if (code === 3) return { ok: false, sandboxed: false, problem: "/usr is writable inside the sandbox" };
  if (code !== 0) return { ok: false, sandboxed: false, problem: `sandbox probe failed (exit ${code}); are unprivileged user namespaces enabled?` };
  return { ok: true, sandboxed: true };
}

/** Throws (caller exits 1) when the sandbox is required and the self-test fails; logs a warning when not required. */
export async function assertMediaSandbox(env: Env = process.env, run?: ProbeRunner, warn: (m: string) => void = (m) => console.warn(m)): Promise<SelfTestResult> {
  const r = await sandboxSelfTest(env, run);
  if (r.ok) return r;
  if (isSandboxRequired(env)) throw new SandboxUnavailable(`media sandbox self-test failed: ${r.problem}`);
  warn(JSON.stringify({ msg: "media.sandbox.disabled", problem: r.problem, hint: "set MEDIA_SANDBOX_REQUIRED=true in production" }));
  return r;
}
