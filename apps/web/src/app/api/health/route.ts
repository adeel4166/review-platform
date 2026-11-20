export const dynamic = "force-dynamic";

/** Liveness only: no dependency checks, so orchestrators don't restart on a DB blip. */
export function GET() {
  return Response.json({ status: "ok" });
}
