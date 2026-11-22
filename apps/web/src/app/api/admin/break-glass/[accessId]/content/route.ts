import { serveOriginal } from "@/server/break-glass";
import { handle } from "@/server/http";
import { clock, m6db, staffOf } from "@/server/m6-routes";
import { requireAdmin } from "@/server/session";
import { getStorage } from "@/server/storage";
import { idParam } from "@/server/validation";

export const runtime = "nodejs";
const MAX_BYTES = 25 * 1024 * 1024;

/** Single-use, session-bound, 60 s (ADR-0027). Bytes are streamed server-side from the private bucket; the key is never presigned. */
export async function GET(_req: Request, ctx: { params: Promise<{ accessId: string }> }) {
  return handle(async () => {
    const actor = await requireAdmin();
    const s = staffOf(actor);
    const { store, buckets } = getStorage();
    const out = await serveOriginal(m6db, { getObject: async (key) => { const b = await store.get(buckets.private, key, MAX_BYTES); if (!b) throw Object.assign(new Error("gone"), { status: 410 }); return { body: new Uint8Array(b), contentType: "application/octet-stream" }; } }, { staffId: s.id, sessionId: s.sessionId }, idParam.parse((await ctx.params).accessId), clock);
    return new Response(out.body as unknown as BodyInit, { status: 200, headers: out.headers });
  });
}
