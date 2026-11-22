import net from "node:net";
import { CLAMAV_HARD_SIGNATURE_AGE_HOURS, CLAMAV_MAX_SIGNATURE_AGE_HOURS, systemClock } from "@rp/core";

/** Port the pipeline scans through. The clamd TCP client below is the production implementation; tests pass a fake. */
export interface Scanner {
  version(): Promise<ClamVersion>;
  scan(body: Buffer): Promise<ScanResult>;
}
export interface ClamVersion {
  engine: string;
  signatureVersion: string;
  signatureDate: Date | null;
}
export type ScanResult = { clean: true } | { clean: false; threat: string };

/** Scanner down, timed out, errored, or its signatures are too old: retryable, fail closed (never "clean"). */
export class ScannerUnavailable extends Error {
  override name = "ScannerUnavailable";
}

/** `ClamAV 1.4.1/27123/Mon Nov 20 07:25:00 2026` (zVERSION). */
export function parseClamVersion(line: string): ClamVersion {
  const m = /^ClamAV\s+([^/]+)\/(\d+)\/(.+?)\0?$/.exec(line.trim());
  if (!m) throw new ScannerUnavailable("unrecognised clamd version reply");
  const d = new Date(`${m[3]} UTC`.replace(/ (\d{4}) UTC$/, " $1 UTC"));
  return { engine: m[1]!, signatureVersion: m[2]!, signatureDate: Number.isNaN(d.getTime()) ? null : d };
}

export const signatureAgeHours = (v: ClamVersion, now = systemClock.now()) => (v.signatureDate ? (now.getTime() - v.signatureDate.getTime()) / 3_600_000 : Infinity);

/** INF-003 / M45-Q14: above 24 h alert + degraded, scans continue; above 72 h scans fail closed. */
export function evaluateFreshness(v: ClamVersion, now = systemClock.now(), limits = { max: CLAMAV_MAX_SIGNATURE_AGE_HOURS, hard: CLAMAV_HARD_SIGNATURE_AGE_HOURS }) {
  const ageHours = signatureAgeHours(v, now);
  return { ageHours, state: ageHours > limits.hard ? ("too_old" as const) : ageHours > limits.max ? ("stale" as const) : ("ok" as const) };
}

function command(opts: { host: string; port: number; timeoutMs: number }, cmd: string, body?: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: opts.host, port: opts.port });
    const chunks: Buffer[] = [];
    const fail = (e: Error) => { sock.destroy(); reject(new ScannerUnavailable(e.message)); };
    sock.setTimeout(opts.timeoutMs, () => fail(new Error("clamd timeout")));
    sock.on("error", fail);
    sock.on("data", (c) => chunks.push(c));
    sock.on("close", () => resolve(Buffer.concat(chunks).toString("utf8").replace(/\0+$/, "").trim()));
    sock.on("connect", () => {
      sock.write(`z${cmd}\0`);
      if (body) {
        for (let i = 0; i < body.length; i += 64 * 1024) {
          const part = body.subarray(i, i + 64 * 1024);
          const len = Buffer.alloc(4);
          len.writeUInt32BE(part.length);
          sock.write(len);
          sock.write(part);
        }
        sock.write(Buffer.alloc(4)); // zero-length chunk ends the stream
      }
    });
  });
}

export function createClamd(opts: { host: string; port: number; timeoutMs?: number }): Scanner {
  const o = { ...opts, timeoutMs: opts.timeoutMs ?? 60_000 };
  return {
    async version() {
      return parseClamVersion(await command(o, "VERSION"));
    },
    async scan(body) {
      const reply = await command(o, "INSTREAM", body);
      if (/^stream: OK$/.test(reply)) return { clean: true };
      const found = /^stream: (.+) FOUND$/.exec(reply);
      if (found) return { clean: false, threat: found[1]! };
      throw new ScannerUnavailable("clamd error"); // ERROR, size limit exceeded, empty reply
    },
  };
}

/** Health used by `/healthz` and the 10-minute freshness timer. `alertDue` limits CLAMAV_STALE to one per 6 h. */
export async function clamHealth(s: Scanner, now = systemClock.now()) {
  try {
    const v = await s.version();
    const f = evaluateFreshness(v, now);
    return f.state === "ok"
      ? { ok: true as const, clamav: { engine: v.engine, signatureVersion: v.signatureVersion, signatureAgeHours: Math.round(f.ageHours * 10) / 10 } }
      : { ok: false as const, reason: "clamav_stale" as const, ageHours: f.ageHours };
  } catch {
    return { ok: false as const, reason: "clamav_unreachable" as const };
  }
}

export class StaleAlertLimiter {
  private last = 0;
  constructor(private everyMs = 6 * 3_600_000) {}
  due(now = systemClock.now().getTime()) {
    if (now - this.last < this.everyMs) return false;
    this.last = now;
    return true;
  }
}
