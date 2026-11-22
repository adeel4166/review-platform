import { db } from "@/server/db";
import { handle, json } from "@/server/http";
import { listBlocks } from "@/server/social";
import { requireUser } from "@/server/session";

export const runtime = "nodejs";
export async function GET() { return handle(async () => json(await listBlocks(db, (await requireUser()).id))); }
