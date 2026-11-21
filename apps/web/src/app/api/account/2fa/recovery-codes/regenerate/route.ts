import { handle } from "@/server/http";
import { regenerateRoute } from "@/server/two-factor-routes";

export const runtime = "nodejs";

export const POST = (req: Request) => handle(() => regenerateRoute(req));
