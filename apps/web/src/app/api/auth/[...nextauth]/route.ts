import { handlers } from "@/server/auth";
import { handle } from "@/server/http";
import { limitLogin } from "@/server/ratelimit";

export const GET = handlers.GET;

/** SEC-03: throttle credential sign-in per client IP + email before Auth.js runs the argon2 verify. */
export async function POST(req: Request) {
  if (new URL(req.url).pathname.endsWith("/callback/credentials")) {
    const limited = await handle(async () => {
      let email = "";
      try {
        const v = (await req.clone().formData()).get("email");
        if (typeof v === "string") email = v.slice(0, 254);
      } catch { /* unparsable body: counted under the empty email bucket */ }
      await limitLogin(req, email);
      return new Response(null);
    });
    if (limited.status === 429) return limited;
  }
  return handlers.POST(req as Parameters<typeof handlers.POST>[0]);
}
