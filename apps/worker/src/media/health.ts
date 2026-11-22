import http from "node:http";
import { StaleAlertLimiter, clamHealth, type Scanner } from "./clamd";

/** Pure handler so INF-007 is testable without a socket: 200 when signatures are fresh, 503 + reason otherwise. */
export async function healthResponse(scanner: Scanner, limiter: StaleAlertLimiter, alert: (kind: string, d: Record<string, unknown>) => void, now = new Date()) {
  const h = await clamHealth(scanner, now);
  if (h.ok) return { status: 200, body: { status: "ok", clamav: h.clamav } };
  if (h.reason === "clamav_stale" && limiter.due(now.getTime())) alert("CLAMAV_STALE", { ageHours: Math.round(h.ageHours) }); // at most one per 6 h
  return { status: 503, body: { status: "degraded", reason: h.reason } };
}

/** `GET /healthz` on WORKER_HEALTH_PORT (pod-local) plus the 10-minute freshness probe that raises the CLAMAV_STALE alert. */
export function startMediaHealth(scanner: Scanner, port: number, alert: (kind: string, d: Record<string, unknown>) => void) {
  const limiter = new StaleAlertLimiter();
  const timer = setInterval(() => void healthResponse(scanner, limiter, alert).catch(() => undefined), 10 * 60_000);
  const server = http
    .createServer((req, res) => {
      if (req.url !== "/healthz") { res.statusCode = 404; res.end(); return; }
      healthResponse(scanner, limiter, alert).then((r) => { res.statusCode = r.status; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(r.body)); }, () => { res.statusCode = 503; res.end(); });
    })
    .listen(port);
  return { close: () => { clearInterval(timer); server.close(); } };
}
