import { handle } from "@/server/http";
import { stepUpRoute } from "@/server/two-factor-routes";

export const runtime = "nodejs";

export const POST = (req: Request) => handle(() => stepUpRoute(req));
