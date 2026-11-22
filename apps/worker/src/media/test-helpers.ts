import net from "node:net";
import type { Scanner } from "./clamd";
import type { MetadataVerifier } from "./verify";
import { sharpVerifier } from "./verify";

/** Scanner double that flags the EICAR test string, like clamd does. */
export const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
export const fakeScanner = (o: { signatureDate?: Date; fail?: boolean } = {}): Scanner & { scans: number } => {
  const s = {
    scans: 0,
    async version() {
      return { engine: "1.4.1", signatureVersion: "27000", signatureDate: o.signatureDate ?? new Date() };
    },
    async scan(b: Buffer) {
      s.scans++;
      if (o.fail) throw new (await import("./clamd")).ScannerUnavailable("down");
      return b.includes(Buffer.from(EICAR)) ? { clean: false as const, threat: "Eicar-Signature" } : { clean: true as const };
    },
  };
  return s;
};
export const testVerifier: MetadataVerifier = sharpVerifier;

/** In-process clamd speaking the real wire protocol (zVERSION, zINSTREAM). */
export function startFakeClamd(o: { signatureDate?: Date } = {}): Promise<{ port: number; close(): Promise<void> }> {
  const server = net.createServer((sock) => {
    let buf = Buffer.alloc(0);
    sock.on("data", (c) => {
      buf = Buffer.concat([buf, c]);
      if (buf.subarray(0, 9).toString() === "zVERSION\0") {
        sock.end(`ClamAV 1.4.1/27000/${(o.signatureDate ?? new Date()).toUTCString().replace(/^(\w+), (\d+) (\w+) (\d+) ([\d:]+) GMT$/, "$1 $3 $2 $5 $4")}\0`);
        return;
      }
      if (buf.subarray(0, 10).toString() !== "zINSTREAM\0") return;
      let off = 10;
      const parts: Buffer[] = [];
      for (;;) {
        if (buf.length < off + 4) return;
        const n = buf.readUInt32BE(off);
        if (n === 0) break;
        if (buf.length < off + 4 + n) return;
        parts.push(buf.subarray(off + 4, off + 4 + n));
        off += 4 + n;
      }
      sock.end(Buffer.concat(parts).includes(Buffer.from(EICAR)) ? "stream: Win.Test.EICAR_HDB-1 FOUND\0" : "stream: OK\0");
    });
  });
  return new Promise((res) => server.listen(0, "127.0.0.1", () => res({ port: (server.address() as net.AddressInfo).port, close: () => new Promise((r) => server.close(() => r())) })));
}
