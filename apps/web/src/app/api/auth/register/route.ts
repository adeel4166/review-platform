import { hashPassword } from "@rp/db";
import { db } from "@/server/db";
import { handle, HttpError, json, readJson } from "@/server/http";
import { registerInput } from "@/server/validation";

export const runtime = "nodejs";

export async function POST(req: Request) {
  return handle(async () => {
    const input = registerInput.parse(await readJson(req));
    try {
      const user = await db.user.create({
        data: { email: input.email, handle: input.handle, displayName: input.displayName, passwordHash: await hashPassword(input.password) },
        select: { id: true, handle: true, displayName: true },
      });
      return json(user, 201);
    } catch (e) {
      if ((e as { code?: string }).code === "P2002") throw new HttpError(409, "conflict", "Email or handle already in use");
      throw e;
    }
  });
}
