import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { handle, json } from "@/server/http";
import { isEmailUnverified } from "@/server/seller-views";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Drives the unverified-email banner. Reads the database (not the JWT). Anonymous callers get `false`, never an error. */
export async function GET() {
  return handle(async () => {
    const id = (await auth())?.user?.id;
    return json({ unverified: id ? await isEmailUnverified(db, id) : false });
  });
}
